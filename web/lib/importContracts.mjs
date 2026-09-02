const INVALID_RESPONSE_MESSAGE = "The import service returned an invalid successful response.";

export function unwrapImportPreviewResponse(body, expectedBatchId = null) {
  return unwrapImportResponse(body, value => (
    isPreview(value) && matchesExpectedBatch(value, expectedBatchId)
  ));
}

export function unwrapImportAnalysisResponse(body) {
  return unwrapImportResponse(body, isAnalysis);
}

export function unwrapImportCommitResponse(body, expectedBatchId = null) {
  return unwrapImportResponse(body, value => (
    isCommittedResult(value) && matchesExpectedBatch(value, expectedBatchId)
  ));
}

export function hasCompleteSourceIdentity(dataHealth) {
  const coverage = dataHealth?.sourceIdCoverage;
  return isNonNegativeInteger(dataHealth?.totalRows)
    && dataHealth.totalRows > 0
    && isNonNegativeInteger(coverage?.coveredRows)
    && isNonNegativeInteger(coverage?.totalRows)
    && coverage.totalRows === dataHealth.totalRows
    && coverage.coveredRows === coverage.totalRows
    && coverage.percentage === 100;
}

export function isConfirmedMissingReconciliation(error) {
  return error?.status === 404;
}

function unwrapImportResponse(body, validatesData) {
  if (
    !isObject(body)
    || body.ok !== true
    || !Object.hasOwn(body, "data")
    || !validatesData(body.data)
  ) {
    const error = new Error(INVALID_RESPONSE_MESSAGE);
    error.name = "ApiError";
    error.code = "IMPORT_RESPONSE_INVALID";
    error.status = null;
    throw error;
  }
  return body.data;
}

function isPreview(value) {
  const summary = value?.batch?.previewSummary;
  return isObject(value)
    && isObject(value.batch)
    && isNonEmptyString(value.batch.id)
    && value.batch.status === "PREVIEWED"
    && isObject(summary)
    && isNonEmptyString(summary.sourceCollection)
    && isNonNegativeInteger(summary.byteCount)
    && isNonNegativeInteger(summary.rowCount)
    && isNonNegativeInteger(summary.columnCount)
    && Array.isArray(summary.headers)
    && summary.headers.length === summary.columnCount
    && summary.headers.every(header => typeof header === "string")
    && Array.isArray(value.records)
    && value.records.every(record => (
      isObject(record)
      && isNonNegativeInteger(record.sourceOrdinal)
      && isObject(record.rawPayload)
      && Array.isArray(record.rawPayload.cells)
    ));
}

function isAnalysis(value) {
  const mapping = value?.mapping;
  const health = value?.dataHealth;
  const supportedMapping = mapping?.status !== "UNSUPPORTED_TARGET";
  return isObject(value)
    && isObject(mapping)
    && typeof mapping.status === "string"
    && Array.isArray(mapping.fields)
    && (!supportedMapping || isObject(mapping.sourceIdentity))
    && Array.isArray(value.rows)
    && isObject(health)
    && isNonNegativeInteger(health.totalRows)
    && isNonNegativeInteger(health.validRows)
    && isNonNegativeInteger(health.rowsWithBlockingErrors)
    && isNonNegativeInteger(health.duplicateConflictCount)
    && isObject(health.sourceIdCoverage)
    && isNonNegativeInteger(health.sourceIdCoverage.coveredRows)
    && isNonNegativeInteger(health.sourceIdCoverage.totalRows)
    && health.sourceIdCoverage.totalRows === health.totalRows
    && health.sourceIdCoverage.coveredRows <= health.sourceIdCoverage.totalRows
    && typeof health.sourceIdCoverage.percentage === "number"
    && Number.isFinite(health.sourceIdCoverage.percentage)
    && health.sourceIdCoverage.percentage >= 0
    && health.sourceIdCoverage.percentage <= 100;
}

function isCommittedResult(value) {
  const summary = value?.summary;
  return isObject(value)
    && value.outcome === "COMMITTED"
    && isObject(value.batch)
    && isNonEmptyString(value.batch.id)
    && value.batch.status === "COMMITTED"
    && Array.isArray(value.rows)
    && isObject(summary)
    && ["total", "committed", "skipped", "conflicted", "failed"]
      .every(key => isNonNegativeInteger(summary[key]))
    && summary.total === summary.committed
      + summary.skipped
      + summary.conflicted
      + summary.failed
    && value.rows.length === summary.total
    && summary.conflicted === 0
    && summary.failed === 0
    && typeof value.reconciled === "boolean";
}

function matchesExpectedBatch(value, expectedBatchId) {
  return expectedBatchId === null || value.batch.id === expectedBatchId;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}
