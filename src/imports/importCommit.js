const {
  TARGETS,
  buildCompleteImportAnalysis
} = require("./importMapping");
const { hashImportEvidence } = require("./csvParser");

const SOURCE_SYSTEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY_MAX_BYTES = 255;
const SOURCE_RECORD_ID_MAX_BYTES = 512;
const COMMIT_OUTCOME_ISSUE_LIMIT = 100;
const RELATIONSHIP_TARGET_FIELDS = new Set(["opportunity_id", "prospect_id"]);

class ImportCommitError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ImportCommitError";
    this.code = code;
    this.status = status;
  }
}

function buildCanonicalCommitPlan(evidence, input) {
  validateCanonicalCommitInput(input);
  const sourceCollection = evidence?.records?.[0]?.sourceCollection
    || evidence?.batch?.previewSummary?.sourceCollection;
  const target = TARGETS[sourceCollection];
  if (!target) {
    return blockedPlan(evidence, input, "FAILED", [{
      code: "IMPORT_TARGET_UNSUPPORTED",
      sourceCollection
    }]);
  }

  const definitions = new Map(
    target.fields.map(definition => [definition.targetField, definition])
  );
  const supplied = new Map(input.selections.map(selection => [
    selection.targetField,
    selection
  ]));
  if (
    input.selections.some(selection => (
      !definitions.has(selection.targetField)
      || definitions.get(selection.targetField).declaredType !== selection.selectedType
    ))
  ) invalidRequest();

  const reviewedSelections = target.fields.map(definition => (
    supplied.get(definition.targetField) || {
      targetField: definition.targetField,
      sourceColumn: null,
      selectedType: definition.declaredType
    }
  ));
  const analysis = buildCompleteImportAnalysis(evidence, {
    selections: reviewedSelections,
    sourceIdentitySelection: input.sourceIdentitySelection
  });
  if (!analysis.mapping.sourceIdentity.sourceColumn) invalidRequest();

  const requestFingerprint = hashImportEvidence({
    batchId: evidence.batch.id,
    idempotencyKey: input.idempotencyKey,
    selections: [...reviewedSelections].sort((left, right) =>
      left.targetField.localeCompare(right.targetField)),
    sourceIdentitySelection: input.sourceIdentitySelection,
    sourceSha256: evidence.batch.sourceSha256,
    sourceSystem: input.sourceSystem,
    targetCollection: sourceCollection
  });
  const sourceIdentityOrdinal = analysis.mapping.sourceIdentity.sourceColumnOrdinal;
  const analysisByOrdinal = new Map(
    analysis.rows.map(row => [row.sourceOrdinal, row])
  );
  const mappedFields = analysis.mapping.fields.filter(field => field.sourceColumn !== null);
  const prepared = evidence.records.map(record => {
    const analysisRow = analysisByOrdinal.get(record.sourceOrdinal);
    const sourceIdentityCell = record.rawPayload?.cells?.[sourceIdentityOrdinal];
    const sourceIdentity = cellValue(record, sourceIdentityOrdinal, "TEXT", null);
    const canonicalRecord = Object.fromEntries(mappedFields.flatMap(field => {
      const value = cellValue(
        record,
        field.sourceColumnOrdinal,
        field.declaredType,
        field.targetField
      );
      return value === MISSING ? [] : [[field.targetField, value]];
    }));
    const numericEvidence = Object.fromEntries(mappedFields.flatMap(field => {
      if (field.declaredType !== "NUMBER") return [];
      const cell = record.rawPayload?.cells?.[field.sourceColumnOrdinal];
      if (!cell || !["NUMERIC", "KNOWN_ZERO", "UNKNOWN"].includes(cell.valueKind)) {
        return [];
      }
      return [[field.targetField, cell.valueKind === "NUMERIC"
        ? { valueKind: cell.valueKind, raw: cell.raw }
        : { valueKind: cell.valueKind }]];
    }));
    const validationErrors = [...(analysisRow?.errors || [])];
    if (sourceIdentityCell?.valueKind === "UNKNOWN") {
      validationErrors.push({
        code: "SOURCE_IDENTITY_UNKNOWN",
        identityRole: "SOURCE_IDENTITY",
        sourceOrdinal: record.sourceOrdinal
      });
    }
    return {
      stagingRecordId: record.id,
      stagingSourceId: record.sourceId,
      sourceCollection,
      sourceOrdinal: record.sourceOrdinal,
      sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
      sourceRecordId: sourceIdentity,
      rawPayloadSha256: record.rawPayloadSha256,
      rawCellsSha256: hashImportEvidence(record.rawPayload?.cells || []),
      canonicalTargetId: canonicalRecord.id,
      canonicalPayloadSha256: hashImportEvidence({
        canonicalRecord,
        numericEvidence,
        sourceCollection
      }),
      canonicalRecord,
      numericEvidence,
      disposition: "COMMITTED",
      duplicateOfSourceOrdinal: null,
      validationErrors
    };
  });

  const invalidRows = prepared.filter(row => {
    const nonDuplicateErrors = row.validationErrors.filter(issue => ![
      "DUPLICATE_SOURCE_ID",
      "EXACT_REPEATED_SOURCE_ROW"
    ].includes(issue.code));
    return nonDuplicateErrors.length > 0
      || typeof row.sourceRecordId !== "string"
      || row.sourceRecordId.trim() === ""
      || Buffer.byteLength(row.sourceRecordId, "utf8") > SOURCE_RECORD_ID_MAX_BYTES;
  });
  if (invalidRows.length > 0) {
    return blockedPlan(evidence, input, "FAILED", invalidRows.map(row => ({
      code: "CANONICAL_ROW_VALIDATION_FAILED",
      sourceOrdinal: row.sourceOrdinal,
      validationErrors: row.validationErrors
    })), requestFingerprint);
  }

  const firstByIdentity = new Map();
  const conflicts = [];
  for (const row of prepared) {
    const first = firstByIdentity.get(row.sourceRecordId);
    if (!first) {
      firstByIdentity.set(row.sourceRecordId, row);
      continue;
    }
    if (first.canonicalPayloadSha256 !== row.canonicalPayloadSha256) {
      conflicts.push({
        code: "SOURCE_IDENTITY_PAYLOAD_CONFLICT",
        sourceRecordId: row.sourceRecordId,
        sourceOrdinals: [first.sourceOrdinal, row.sourceOrdinal]
      });
      continue;
    }
    if (first.rawCellsSha256 !== row.rawCellsSha256) {
      conflicts.push({
        code: "SOURCE_IDENTITY_EVIDENCE_CONFLICT",
        sourceRecordId: row.sourceRecordId,
        sourceOrdinals: [first.sourceOrdinal, row.sourceOrdinal]
      });
      continue;
    }
    row.disposition = "EXACT_DUPLICATE";
    row.canonicalRecord = null;
    row.duplicateOfSourceOrdinal = first.sourceOrdinal;
  }

  if (conflicts.length > 0) {
    return blockedPlan(
      evidence,
      input,
      "CONFLICTED",
      conflicts,
      requestFingerprint
    );
  }

  return {
    outcome: "READY",
    batchId: evidence.batch.id,
    sourceCollection,
    sourceSystem: input.sourceSystem,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    rows: prepared,
    summary: summarize(prepared),
    conflicts: [],
    evidence
  };
}

const MISSING = Symbol("missing canonical cell");

function cellValue(record, columnOrdinal, declaredType, targetField) {
  const cell = record.rawPayload?.cells?.[columnOrdinal];
  if (!cell || !cell.present || cell.valueKind === "MISSING") return MISSING;
  if (cell.valueKind === "NULL") return targetField === "value" ? null : MISSING;
  if (
    cell.valueKind === "BLANK"
    && RELATIONSHIP_TARGET_FIELDS.has(targetField)
  ) return MISSING;
  if (declaredType === "NUMBER") {
    if (cell.valueKind === "KNOWN_ZERO") return 0;
    if (cell.valueKind === "NUMERIC") return cell.raw;
    if (cell.valueKind === "UNKNOWN") {
      return targetField === "value" ? "unknown" : MISSING;
    }
    return targetField === "value" ? cell.raw : MISSING;
  }
  if (declaredType === "TIMESTAMP" && ["UNKNOWN", "BLANK"].includes(cell.valueKind)) {
    return MISSING;
  }
  return cell.raw;
}

function blockedPlan(
  evidence,
  input,
  outcome,
  issues,
  requestFingerprint = null
) {
  const total = Array.isArray(evidence?.records) ? evidence.records.length : 0;
  return {
    outcome,
    batchId: evidence?.batch?.id || null,
    sourceCollection: evidence?.batch?.previewSummary?.sourceCollection || null,
    sourceSystem: input?.sourceSystem || null,
    idempotencyKey: input?.idempotencyKey || null,
    requestFingerprint,
    rows: (evidence?.records || []).map(record => ({
      stagingRecordId: record.id,
      stagingSourceId: record.sourceId,
      sourceOrdinal: record.sourceOrdinal,
      canonicalRecord: null,
      disposition: outcome
    })),
    summary: {
      total,
      committed: 0,
      skipped: 0,
      conflicted: outcome === "CONFLICTED" ? total : 0,
      failed: outcome === "FAILED" ? total : 0
    },
    conflicts: outcome === "CONFLICTED" ? issues : [],
    failures: outcome === "FAILED"
      ? issues.slice(0, COMMIT_OUTCOME_ISSUE_LIMIT)
      : [],
    evidence
  };
}

function summarize(rows) {
  return {
    total: rows.length,
    committed: rows.filter(row => row.disposition === "COMMITTED").length,
    skipped: rows.filter(row => row.disposition === "EXACT_DUPLICATE").length,
    conflicted: 0,
    failed: 0
  };
}

function validateCanonicalCommitInput(input) {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || !exactKeys(input, [
      "sourceSystem",
      "idempotencyKey",
      "sourceIdentitySelection",
      "selections"
    ])
    || typeof input.sourceSystem !== "string"
    || !SOURCE_SYSTEM_PATTERN.test(input.sourceSystem)
    || typeof input.idempotencyKey !== "string"
    || !input.idempotencyKey.trim()
    || Buffer.byteLength(input.idempotencyKey, "utf8") > IDEMPOTENCY_KEY_MAX_BYTES
    || /[\0-\x1f\x7f]/.test(input.idempotencyKey)
    || !Array.isArray(input.selections)
    || input.selections.some(selection => (
      !selection
      || typeof selection !== "object"
      || Array.isArray(selection)
      || !exactKeys(selection, ["targetField", "sourceColumn", "selectedType"])
      || typeof selection.targetField !== "string"
      || !selection.targetField
      || !(
        selection.sourceColumn === null
        || (
          typeof selection.sourceColumn === "string"
          && selection.sourceColumn.length > 0
        )
      )
      || !["TEXT", "NUMBER", "TIMESTAMP", "STATUS"].includes(
        selection.selectedType
      )
    ))
    || new Set(input.selections.map(selection => selection.targetField)).size
      !== input.selections.length
    || !input.sourceIdentitySelection
    || typeof input.sourceIdentitySelection !== "object"
    || Array.isArray(input.sourceIdentitySelection)
    || !exactKeys(input.sourceIdentitySelection, ["sourceColumn"])
    || typeof input.sourceIdentitySelection.sourceColumn !== "string"
    || !input.sourceIdentitySelection.sourceColumn
  ) invalidRequest();
}

function exactKeys(value, keys) {
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function invalidRequest() {
  throw new ImportCommitError(
    "IMPORT_COMMIT_REQUEST_INVALID",
    "The canonical import commit request is invalid."
  );
}

module.exports = {
  IDEMPOTENCY_KEY_MAX_BYTES,
  ImportCommitError,
  SOURCE_RECORD_ID_MAX_BYTES,
  SOURCE_SYSTEM_PATTERN,
  buildCanonicalCommitPlan,
  validateCanonicalCommitInput
};
