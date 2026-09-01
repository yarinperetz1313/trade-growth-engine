const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CSV_LIMITS,
  ImportCsvError,
  parseCsvUpload
} = require("../src/imports/csvParser");

function upload(csv, overrides = {}) {
  return {
    filename: "pilot-export.csv",
    mediaType: "text/csv",
    contentBase64: Buffer.from(csv, "utf8").toString("base64"),
    ...overrides
  };
}

test("CSV staging preserves exact raw cells and distinct unknown-value semantics", () => {
  const parsed = parseCsvUpload(upload([
    "source_id,value,note,optional",
    "one,0,unknown,",
    "two,null,abc",
    "three,   ,=2+2,n/a"
  ].join("\r\n")));

  assert.deepEqual(parsed.headers, ["source_id", "value", "note", "optional"]);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(
    parsed.rows.map(row => row.rawPayload.cells.map(cell => [
      cell.present,
      cell.raw,
      cell.valueKind
    ])),
    [
      [[true, "one", "NONNUMERIC"], [true, "0", "KNOWN_ZERO"], [true, "unknown", "UNKNOWN"], [true, "", "BLANK"]],
      [[true, "two", "NONNUMERIC"], [true, "null", "NULL"], [true, "abc", "NONNUMERIC"], [false, null, "MISSING"]],
      [[true, "three", "NONNUMERIC"], [true, "   ", "BLANK"], [true, "=2+2", "NONNUMERIC"], [true, "n/a", "UNKNOWN"]]
    ]
  );
});

test("CSV parsing is deterministic for quoted fields and content hashes", () => {
  const input = upload("id,note\n1,\"quoted, value\"\n2,\"line one\nline two\"");
  const first = parseCsvUpload(input);
  const second = parseCsvUpload({
    ...input,
    filename: "untrusted.xlsx",
    mediaType: "application/octet-stream"
  });

  assert.equal(first.sourceSha256, second.sourceSha256);
  assert.deepEqual(first.rows, second.rows);
  assert.equal(first.rows[0].rawPayload.cells[1].raw, "quoted, value");
  assert.equal(first.rows[1].rawPayload.cells[1].raw, "line one\nline two");
});

test("CSV upload and parser limits fail with stable codes at their boundaries", () => {
  const cases = [
    [
      { filename: "x.csv", mediaType: "text/csv", contentBase64: "%%%" },
      "CSV_BASE64_INVALID"
    ],
    [
      upload(`a\n${"x".repeat(CSV_LIMITS.maxCellBytes + 1)}`),
      "CSV_CELL_LIMIT_EXCEEDED"
    ],
    [
      upload(`${"h".repeat(CSV_LIMITS.maxHeaderBytes + 1)}\nx`),
      "CSV_HEADER_LIMIT_EXCEEDED"
    ],
    [
      upload(`${Array.from({ length: CSV_LIMITS.maxColumns + 1 }, (_, index) => `h${index}`).join(",")}\nvalue`),
      "CSV_COLUMN_LIMIT_EXCEEDED"
    ],
    [
      upload("a,b\n1,2,3"),
      "CSV_SHAPE_INVALID"
    ],
    [
      upload("a,a\n1,2"),
      "CSV_HEADER_INVALID"
    ],
    [
      upload('a\n"unterminated'),
      "CSV_MALFORMED"
    ],
    [
      upload(`a\n${Array.from({ length: CSV_LIMITS.maxRows + 1 }, () => "x").join("\n")}`),
      "CSV_ROW_LIMIT_EXCEEDED"
    ],
    [
      upload(Buffer.alloc(CSV_LIMITS.maxFileBytes + 1, 0x61).toString("utf8")),
      "CSV_FILE_LIMIT_EXCEEDED"
    ],
    [
      upload([
        Array.from({ length: CSV_LIMITS.maxColumns }, (_, index) => `h${index}`).join(","),
        ...Array.from(
          { length: 500 },
          () => Array.from({ length: CSV_LIMITS.maxColumns }, () => "\t".repeat(7)).join(",")
        )
      ].join("\n")),
      "CSV_STAGING_LIMIT_EXCEEDED"
    ],
    [
      upload([
        Array.from({ length: CSV_LIMITS.maxColumns }, (_, index) => `h${index}`).join(","),
        ...Array.from(
          { length: 100 },
          () => Array.from({ length: CSV_LIMITS.maxColumns }, () => "\t".repeat(39)).join(",")
        )
      ].join("\n")),
      "CSV_PREVIEW_LIMIT_EXCEEDED"
    ],
    [
      upload([
        Array.from({ length: CSV_LIMITS.maxColumns }, (_, index) => `h${index}`).join(","),
        ...Array.from(
          { length: Math.floor(CSV_LIMITS.maxCells / CSV_LIMITS.maxColumns) + 1 },
          () => Array.from({ length: CSV_LIMITS.maxColumns }, () => "x").join(",")
        )
      ].join("\n")),
      "CSV_CELL_COUNT_LIMIT_EXCEEDED"
    ],
    ...[
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
      [0x50, 0x4b, 0x07, 0x08],
      [0xef, 0xbb, 0xbf, 0x50, 0x4b, 0x03, 0x04]
    ].map(signature => [{
      filename: "binary.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from(signature).toString("base64")
    }, "CSV_SIGNATURE_INVALID"]),
    [
      {
        filename: "invalid-utf8.csv",
        mediaType: "text/csv",
        contentBase64: Buffer.from([0x61, 0x0a, 0xc3, 0x28]).toString("base64")
      },
      "CSV_ENCODING_INVALID"
    ]
  ];

  for (const [input, code] of cases) {
    assert.throws(
      () => parseCsvUpload(input),
      error =>
        error instanceof ImportCsvError
        && error.code === code
        && error.status === (code.endsWith("LIMIT_EXCEEDED") ? 413 : 400),
      code
    );
  }
});

test("CSV parser accepts the exact row, column, cell, and total-cell boundaries", () => {
  const exactCell = parseCsvUpload(upload(`h\n${"x".repeat(CSV_LIMITS.maxCellBytes)}`));
  assert.equal(
    Buffer.byteLength(exactCell.rows[0].rawPayload.cells[0].raw),
    CSV_LIMITS.maxCellBytes
  );

  const headers = Array.from(
    { length: CSV_LIMITS.maxColumns },
    (_, index) => `h${index}`
  ).join(",");
  const exactTotalRows = Math.floor(CSV_LIMITS.maxCells / CSV_LIMITS.maxColumns);
  const exactShape = parseCsvUpload(upload([
    headers,
    ...Array.from(
      { length: exactTotalRows },
      () => Array.from({ length: CSV_LIMITS.maxColumns }, () => "x").join(",")
    )
  ].join("\n")));
  assert.equal(exactShape.headers.length, CSV_LIMITS.maxColumns);
  assert.equal(exactShape.rows.length * exactShape.headers.length, CSV_LIMITS.maxCells);

  const exactRows = parseCsvUpload(upload([
    "h",
    ...Array.from({ length: CSV_LIMITS.maxRows }, () => "x")
  ].join("\n")));
  assert.equal(exactRows.rows.length, CSV_LIMITS.maxRows);

  const exactHeader = "h".repeat(CSV_LIMITS.maxHeaderBytes);
  assert.equal(parseCsvUpload(upload(`${exactHeader}\nx`)).headers[0], exactHeader);

  const fileOverhead = Buffer.byteLength("h\n") + CSV_LIMITS.maxRows - 1;
  let remaining = CSV_LIMITS.maxFileBytes - fileOverhead;
  const fileRows = Array.from({ length: CSV_LIMITS.maxRows }, () => {
    const length = Math.min(CSV_LIMITS.maxCellBytes, remaining);
    remaining -= length;
    return "x".repeat(length);
  });
  assert.equal(remaining, 0);
  const exactFile = ["h", ...fileRows].join("\n");
  assert.equal(Buffer.byteLength(exactFile), CSV_LIMITS.maxFileBytes);
  assert.equal(parseCsvUpload(upload(exactFile)).byteCount, CSV_LIMITS.maxFileBytes);
});

test("CSV headers are stored once and serialized staging/preview amplification is bounded", () => {
  const headers = Array.from(
    { length: 32 },
    (_, index) => `${index}-${"h".repeat(CSV_LIMITS.maxHeaderBytes - 3)}`
  ).join(",");
  const parsed = parseCsvUpload(upload([
    headers,
    ...Array.from({ length: 1000 }, () => "")
  ].join("\n")));
  assert.equal(parsed.headers.length, 32);
  assert.equal(Object.hasOwn(parsed.rows[0].rawPayload.cells[0], "sourceColumn"), false);
  const stagingBytes = parsed.rows.reduce(
    (total, row) => total + Buffer.byteLength(JSON.stringify(row.rawPayload)),
    0
  );
  const previewBytes = Buffer.byteLength(JSON.stringify({
    headers: parsed.headers,
    records: parsed.rows.slice(0, 100).map(row => row.rawPayload)
  }));
  assert.ok(stagingBytes <= CSV_LIMITS.maxSerializedStagingBytes);
  assert.ok(previewBytes <= CSV_LIMITS.maxSerializedPreviewBytes);
});
