const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");

const CSV_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024,
  maxRows: 1000,
  maxColumns: 64,
  maxHeaderBytes: 256,
  maxCellBytes: 4096,
  maxCells: 32000,
  maxSerializedStagingBytes: 2516582,
  maxSerializedPreviewBytes: 917504
});

class ImportCsvError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ImportCsvError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message) {
  throw new ImportCsvError(
    code,
    message,
    code.endsWith("LIMIT_EXCEEDED") ? 413 : 400
  );
}

function parseCsvUpload(upload) {
  if (
    !upload
    || typeof upload !== "object"
    || Array.isArray(upload)
    || typeof upload.contentBase64 !== "string"
  ) {
    fail("CSV_UPLOAD_INVALID", "A base64-encoded CSV upload is required.");
  }

  const bytes = decodeBase64(upload.contentBase64);
  if (bytes.length === 0) {
    fail("CSV_EMPTY", "The CSV upload is empty.");
  }
  if (bytes.length > CSV_LIMITS.maxFileBytes) {
    fail("CSV_FILE_LIMIT_EXCEEDED", "The CSV upload exceeds the byte limit.");
  }
  if (hasZipSignature(bytes)) {
    fail("CSV_SIGNATURE_INVALID", "The upload is not CSV content.");
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("CSV_ENCODING_INVALID", "The CSV upload must be valid UTF-8.");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\0")) {
    fail("CSV_ENCODING_INVALID", "The CSV upload contains a null byte.");
  }

  const records = parseRecords(text);
  if (records.length === 0) {
    fail("CSV_EMPTY", "The CSV upload has no header row.");
  }
  const headers = records.shift();
  validateHeaders(headers);
  if (records.length > CSV_LIMITS.maxRows) {
    fail("CSV_ROW_LIMIT_EXCEEDED", "The CSV upload exceeds the row limit.");
  }
  if (records.length * headers.length > CSV_LIMITS.maxCells) {
    fail("CSV_CELL_COUNT_LIMIT_EXCEEDED", "The CSV upload exceeds the total cell limit.");
  }

  let serializedStagingBytes = 0;
  let serializedPreviewBytes = Buffer.byteLength(canonicalJson({ headers }), "utf8");
  const rows = records.map((record, sourceOrdinal) => {
    if (record.length > headers.length) {
      fail("CSV_SHAPE_INVALID", "A CSV row contains more cells than the header.");
    }
    const cells = headers.map((_, columnOrdinal) => {
      const present = columnOrdinal < record.length;
      const raw = present ? record[columnOrdinal] : null;
      return {
        columnOrdinal,
        present,
        raw,
        valueKind: classifyCell(raw, present)
      };
    });
    const rawPayload = {
      sourceRowNumber: sourceOrdinal + 2,
      cells
    };
    const serializedPayload = canonicalJson(rawPayload);
    const serializedPayloadBytes = Buffer.byteLength(serializedPayload, "utf8");
    serializedStagingBytes += serializedPayloadBytes;
    if (sourceOrdinal < 100) serializedPreviewBytes += serializedPayloadBytes;
    return {
      sourceOrdinal,
      sourceRowNumber: sourceOrdinal + 2,
      rawPayload,
      rawPayloadSha256: sha256(serializedPayload)
    };
  });
  if (serializedStagingBytes > CSV_LIMITS.maxSerializedStagingBytes) {
    fail("CSV_STAGING_LIMIT_EXCEEDED", "The CSV upload exceeds the serialized staging limit.");
  }
  if (serializedPreviewBytes > CSV_LIMITS.maxSerializedPreviewBytes) {
    fail("CSV_PREVIEW_LIMIT_EXCEEDED", "The CSV upload exceeds the serialized preview limit.");
  }

  return {
    format: "CSV",
    sourceSha256: sha256(bytes),
    byteCount: bytes.length,
    headers,
    rows,
    limits: CSV_LIMITS
  };
}

function decodeBase64(value) {
  if (
    value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    fail("CSV_BASE64_INVALID", "CSV content must use canonical base64 encoding.");
  }
  const maximumEncodedLength = Math.ceil(CSV_LIMITS.maxFileBytes / 3) * 4;
  if (value.length > maximumEncodedLength) {
    fail("CSV_FILE_LIMIT_EXCEEDED", "The CSV upload exceeds the byte limit.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail("CSV_BASE64_INVALID", "CSV content must use canonical base64 encoding.");
  }
  return bytes;
}

function hasZipSignature(bytes) {
  const offset = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? 3
    : 0;
  const signature = bytes.subarray(offset, offset + 4);
  return [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08]
  ].some(candidate => signature.equals(Buffer.from(candidate)));
}

function parseRecords(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let recordStarted = false;

  const pushField = () => {
    if (Buffer.byteLength(field, "utf8") > CSV_LIMITS.maxCellBytes) {
      fail("CSV_CELL_LIMIT_EXCEEDED", "A CSV cell exceeds the byte limit.");
    }
    record.push(field);
    if (record.length > CSV_LIMITS.maxColumns) {
      fail("CSV_COLUMN_LIMIT_EXCEEDED", "The CSV upload exceeds the column limit.");
    }
    field = "";
    afterQuote = false;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    if (records.length > CSV_LIMITS.maxRows + 1) {
      fail("CSV_ROW_LIMIT_EXCEEDED", "The CSV upload exceeds the row limit.");
    }
    record = [];
    recordStarted = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && ![",", "\r", "\n"].includes(character)) {
      fail("CSV_MALFORMED", "A quoted CSV cell has invalid trailing content.");
    }
    if (character === '"') {
      if (field.length > 0 || afterQuote) {
        fail("CSV_MALFORMED", "A CSV quote appears outside a quoted cell.");
      }
      quoted = true;
      recordStarted = true;
    } else if (character === ",") {
      pushField();
      recordStarted = true;
    } else if (character === "\r" || character === "\n") {
      pushRecord();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
      recordStarted = true;
    }
  }

  if (quoted) {
    fail("CSV_MALFORMED", "A quoted CSV cell is not terminated.");
  }
  if (recordStarted || field.length > 0 || record.length > 0 || afterQuote) {
    pushRecord();
  }
  return records;
}

function validateHeaders(headers) {
  if (headers.length > CSV_LIMITS.maxColumns) {
    fail("CSV_COLUMN_LIMIT_EXCEEDED", "The CSV upload exceeds the column limit.");
  }
  const normalized = headers.map(header => header.trim().toLowerCase());
  if (headers.some(header => Buffer.byteLength(header, "utf8") > CSV_LIMITS.maxHeaderBytes)) {
    fail("CSV_HEADER_LIMIT_EXCEEDED", "A CSV header exceeds the byte limit.");
  }
  if (normalized.some(header => !header) || new Set(normalized).size !== headers.length) {
    fail("CSV_HEADER_INVALID", "CSV headers must be nonblank and unique.");
  }
}

function classifyCell(raw, present) {
  if (!present) return "MISSING";
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return "BLANK";
  if (normalized === "null") return "NULL";
  if (["unknown", "n/a", "na", "not known"].includes(normalized)) {
    return "UNKNOWN";
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric === 0 ? "KNOWN_ZERO" : "NUMERIC";
  return "NONNUMERIC";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashImportEvidence(value) {
  return sha256(canonicalJson(value));
}

module.exports = {
  CSV_LIMITS,
  ImportCsvError,
  hashImportEvidence,
  parseCsvUpload
};
