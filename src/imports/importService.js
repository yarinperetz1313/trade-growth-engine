const crypto = require("node:crypto");

const {
  AuthorizationError,
  PERMISSIONS,
  assertPermission
} = require("../auth/authorization");
const { requireTenantContext } = require("../persistence/tenantContext");
const { CSV_LIMITS, parseCsvUpload } = require("./csvParser");
const { buildImportAnalysis } = require("./importMapping");

const SOURCE_COLLECTIONS = new Set([
  "prospects", "opportunities", "activities", "tasks", "revenue_actions"
]);

class ImportContractError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ImportContractError";
    this.code = code;
    this.status = status;
  }
}

function createImportService({
  persistence,
  clock = () => new Date(),
  idFactory = () => crypto.randomUUID()
} = {}) {
  if (persistence?.adapter !== "postgres" || typeof persistence.forTenant !== "function") {
    throw new TypeError("Import staging requires tenant-bound PostgreSQL persistence.");
  }
  if (typeof clock !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Import staging clock and ID factory must be functions.");
  }

  function authorize(authorizationContext, persistenceContext) {
    const authorized = assertPermission(
      authorizationContext,
      PERMISSIONS.OPERATIONAL_ADMIN
    );
    const trustedPersistence = requireTenantContext(persistenceContext);
    if (authorized.tenantId !== trustedPersistence.tenantId) {
      throw new AuthorizationError();
    }
    return { authorized, trustedPersistence };
  }

  async function createPreview({ authorizationContext, persistenceContext, input }) {
    const { authorized, trustedPersistence } = authorize(
      authorizationContext,
      persistenceContext
    );
    validateCreateInput(input);
    const parsed = parseCsvUpload(input.upload);
    const at = normalizeClock(clock());
    const batchId = normalizeGeneratedId(idFactory());
    const valueKindCounts = {};
    const records = parsed.rows.map(row => {
      for (const cell of row.rawPayload.cells) {
        valueKindCounts[cell.valueKind] = (valueKindCounts[cell.valueKind] || 0) + 1;
      }
      const sourceId = `csv-row:${row.sourceOrdinal}:${row.rawPayloadSha256}`;
      return {
        id: `row:${row.sourceOrdinal}`,
        sourceCollection: input.sourceCollection,
        sourceId,
        sourceOrdinal: row.sourceOrdinal,
        sourceRowNumber: row.sourceRowNumber,
        rawPayload: row.rawPayload,
        rawPayloadSha256: row.rawPayloadSha256,
        disposition: "PENDING",
        idempotencyKey: sha256([
          parsed.sourceSha256,
          input.sourceCollection,
          row.sourceOrdinal,
          row.rawPayloadSha256
        ].join(":")),
        metadata: { source_id_kind: "SYNTHETIC_ROW_EVIDENCE" }
      };
    });
    const previewSummary = {
      format: "CSV",
      sourceCollection: input.sourceCollection,
      byteCount: parsed.byteCount,
      rowCount: records.length,
      columnCount: parsed.headers.length,
      headers: parsed.headers,
      reportedMediaType: input.upload.mediaType,
      parserLimits: CSV_LIMITS,
      valueKindCounts: Object.fromEntries(
        Object.entries(valueKindCounts).sort(([left], [right]) => left.localeCompare(right))
      )
    };
    const rawExpiresAt = addDays(at, 7);
    const metadataRetainUntil = addYears(at, 1);
    const draft = {
      batch: {
        id: batchId,
        status: "PREVIEWED",
        sourceFilename: input.upload.filename,
        sourceMediaType: input.upload.mediaType,
        sourceSha256: parsed.sourceSha256,
        authorizedBySubjectId: authorized.subject,
        authorizationVerifiedAt: at,
        previewSummary,
        rawStorageKey: null,
        rawExpiresAt,
        metadataRetainUntil,
        createdAt: at
      },
      records,
      auditEvent: {
        id: `import-preview:${batchId}`,
        eventType: "IMPORT_PREVIEW_CREATED",
        subjectId: authorized.subject,
        entityType: "import_batch",
        entityId: batchId,
        payload: {
          source_collection: input.sourceCollection,
          source_sha256: parsed.sourceSha256,
          row_count: records.length,
          column_count: parsed.headers.length,
          external_action_performed: false
        },
        occurredAt: at,
        retainUntil: metadataRetainUntil
      }
    };
    return persistence.forTenant(trustedPersistence).imports.stagePreview(draft);
  }

  async function readPreview({ authorizationContext, persistenceContext, batchId }) {
    const { trustedPersistence } = authorize(
      authorizationContext,
      persistenceContext
    );
    if (typeof batchId !== "string" || !batchId || batchId.length > 200) {
      unavailable();
    }
    const preview = await persistence
      .forTenant(trustedPersistence)
      .imports.findPreview(batchId);
    if (!preview) unavailable();
    return preview;
  }

  async function analyzePreview({
    authorizationContext,
    persistenceContext,
    batchId,
    input = {}
  }) {
    const { trustedPersistence } = authorize(
      authorizationContext,
      persistenceContext
    );
    validateBatchId(batchId);
    if (
      !input
      || typeof input !== "object"
      || Array.isArray(input)
      || !Object.keys(input).every(key => key === "selections")
      || Object.keys(input).length > 1
    ) invalidRequest();
    const evidence = await persistence
      .forTenant(trustedPersistence)
      .imports.findAnalysisEvidence(batchId);
    if (!evidence) unavailable();
    return buildImportAnalysis(evidence, input);
  }

  return Object.freeze({ analyzePreview, createPreview, readPreview });
}

function validateCreateInput(input) {
  if (!exactObject(input, ["sourceCollection", "upload"])) invalidRequest();
  if (!SOURCE_COLLECTIONS.has(input.sourceCollection)) invalidRequest();
  if (!exactObject(input.upload, ["filename", "mediaType", "contentBase64"])) {
    invalidRequest();
  }
  if (
    typeof input.upload.filename !== "string"
    || !input.upload.filename.trim()
    || Buffer.byteLength(input.upload.filename, "utf8") > 255
    || /[\0-\x1f\x7f]/.test(input.upload.filename)
    || typeof input.upload.mediaType !== "string"
    || !input.upload.mediaType.trim()
    || Buffer.byteLength(input.upload.mediaType, "utf8") > 255
    || /[\0-\x1f\x7f]/.test(input.upload.mediaType)
  ) {
    invalidRequest();
  }
}

function exactObject(value, keys) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
  );
}

function invalidRequest() {
  throw new ImportContractError(
    "IMPORT_REQUEST_INVALID",
    "The import preview request is invalid."
  );
}

function unavailable() {
  throw new ImportContractError(
    "IMPORT_BATCH_UNAVAILABLE",
    "The requested import batch is unavailable.",
    404
  );
}

function validateBatchId(batchId) {
  if (typeof batchId !== "string" || !batchId || batchId.length > 200) {
    unavailable();
  }
}

function normalizeClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new TypeError("Import staging clock must return a valid date.");
  }
  return date.toISOString();
}

function normalizeGeneratedId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new TypeError("Import staging ID factory must return a nonblank string.");
  }
  return value;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addYears(value, years) {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

module.exports = { ImportContractError, createImportService };
