const INVALID_RESPONSE_MESSAGE = "The import service returned an invalid successful response.";
const PREVIEW_ROW_LIMIT = 100;
const ROW_SAMPLE_LIMIT = 100;
const FIELD_SAMPLE_LIMIT = 5;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 64;
const MAX_CELLS = 32000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_HEADER_BYTES = 256;
const MAX_CELL_BYTES = 4096;
const MAX_ISSUES_PER_ROW = 128;
const MAX_MAPPING_ISSUES = ROW_SAMPLE_LIMIT * 2;
const VALUE_KINDS = new Set([
  "BLANK",
  "KNOWN_ZERO",
  "MISSING",
  "NONNUMERIC",
  "NULL",
  "NUMERIC",
  "UNKNOWN"
]);
const SELECTED_TYPES = new Set(["NUMBER", "STATUS", "TEXT", "TIMESTAMP"]);
const INFERRED_TYPES = new Set(["MIXED", "NUMBER", "TEXT", "TIMESTAMP", "UNKNOWN"]);
const SOURCE_COLLECTIONS = new Set([
  "activities",
  "opportunities",
  "prospects",
  "revenue_actions",
  "tasks"
]);

export function unwrapImportPreviewResponse(body, expectedBatchId = null) {
  return unwrapImportResponse(body, value => (
    isPreview(value) && matchesExpectedBatch(value, expectedBatchId)
  ));
}

export function unwrapImportAnalysisResponse(body, expectations = {}) {
  return unwrapImportResponse(body, value => isAnalysis(value, expectations));
}

export function unwrapImportCommitResponse(
  body,
  expectedBatchId = null,
  expectations = {}
) {
  return unwrapImportResponse(body, value => (
    isCommittedResult(value, expectations)
    && matchesExpectedBatch(value, expectedBatchId)
  ));
}

export function hasCompleteSourceIdentity(dataHealth) {
  const coverage = dataHealth?.sourceIdCoverage;
  return isNonNegativeInteger(dataHealth?.totalRows)
    && dataHealth.totalRows > 0
    && isCoherentCoverage(coverage, dataHealth.totalRows)
    && coverage.coveredRows === coverage.totalRows
    && coverage.percentage === 100;
}

export function isConfirmedMissingReconciliation(error) {
  return error?.status === 404;
}

export function requiresImportPostReconciliation(error) {
  const status = error?.status;
  if ([
    "BROWSER_AUTHORITY_INVALID",
    "BROWSER_AUTH_UNAVAILABLE"
  ].includes(error?.code)) return false;
  return error?.code === "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN"
    || error?.code === "IMPORT_RESPONSE_INVALID"
    || !Number.isInteger(status)
    || (status >= 200 && status < 300)
    || status === 408
    || status >= 500;
}

export function createImportOperationGuard() {
  let generation = 0;
  let active = null;

  return Object.freeze({
    begin(kind) {
      if (active !== null) return null;
      active = Object.freeze({ generation, kind });
      return active;
    },
    finish(token) {
      if (active !== token || token?.generation !== generation) return false;
      active = null;
      return true;
    },
    invalidate() {
      generation += 1;
      active = null;
    },
    isCurrent(token) {
      return active === token && token?.generation === generation;
    },
    isPending() {
      return active !== null;
    }
  });
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
    const attemptedId = body?.data?.batch?.id;
    if (isBoundedString(attemptedId, 200)) {
      error.details = { attemptedId };
    }
    throw error;
  }
  return body.data;
}

function isPreview(value) {
  const summary = value?.batch?.previewSummary;
  if (
    !isObject(value)
    || !isObject(value.batch)
    || !isBoundedString(value.batch.id, 200)
    || value.batch.status !== "PREVIEWED"
    || !isObject(summary)
    || summary.format !== "CSV"
    || !SOURCE_COLLECTIONS.has(summary.sourceCollection)
    || !isIntegerBetween(summary.byteCount, 1, MAX_FILE_BYTES)
    || !isIntegerBetween(summary.rowCount, 0, MAX_ROWS)
    || !isIntegerBetween(summary.columnCount, 1, MAX_COLUMNS)
    || summary.rowCount * summary.columnCount > MAX_CELLS
    || !isHeaderList(summary.headers, summary.columnCount)
    || value.previewRowLimit !== PREVIEW_ROW_LIMIT
    || !Array.isArray(value.records)
    || value.records.length !== Math.min(summary.rowCount, PREVIEW_ROW_LIMIT)
    || !isValueKindCounts(summary.valueKindCounts, summary.rowCount * summary.columnCount)
  ) return false;

  return value.records.every((record, sourceOrdinal) => (
    isStagedEvidenceRow(record, sourceOrdinal, summary.headers, false, {
      batchId: value.batch.id,
      sourceCollection: summary.sourceCollection
    })
  ));
}

function isAnalysis(value, expectations) {
  const mapping = value?.mapping;
  const health = value?.dataHealth;
  const headers = validExpectedHeaders(expectations?.headers)
    ? expectations.headers
    : null;
  const expectedTotalRows = expectations?.totalRows;

  if (
    !isObject(value)
    || !isObject(mapping)
    || !["DRAFT", "UNSUPPORTED_TARGET"].includes(mapping.status)
    || mapping.authoritative !== false
    || mapping.accepted !== false
    || !SOURCE_COLLECTIONS.has(mapping.targetCollection)
    || (isBoundedString(expectations?.sourceCollection, 64)
      && mapping.targetCollection !== expectations.sourceCollection)
    || !isDataHealth(health, headers?.length)
    || (isNonNegativeInteger(expectedTotalRows) && health.totalRows !== expectedTotalRows)
    || value.rowSampleLimit !== ROW_SAMPLE_LIMIT
    || !Array.isArray(value.rows)
    || value.rows.length !== Math.min(health.totalRows, ROW_SAMPLE_LIMIT)
    || !value.rows.every((row, sourceOrdinal) => (
      isStagedEvidenceRow(row, sourceOrdinal, headers, true)
    ))
  ) return false;

  if (health.totalRows <= ROW_SAMPLE_LIMIT) {
    const sampledValid = value.rows.filter(row => row.valid).length;
    if (
      sampledValid !== health.validRows
      || value.rows.length - sampledValid !== health.rowsWithBlockingErrors
    ) return false;
  }

  if (mapping.status === "UNSUPPORTED_TARGET") {
    return mapping.selectionState === "UNAVAILABLE"
      && Array.isArray(mapping.fields)
      && mapping.fields.length === 0
      && !Object.hasOwn(mapping, "sourceIdentity")
      && isStringList(mapping.unmappedSourceColumns, MAX_COLUMNS, headers)
      && health.validRows === 0
      && health.rowsWithBlockingErrors === health.totalRows
      && health.unknownUnmappedStatuses.unmappedTargetFields.length === 0
      && sameStringList(
        health.unknownUnmappedStatuses.unmappedSourceColumns,
        mapping.unmappedSourceColumns
      )
      && Object.keys(health.timestampCoverage).length === 0;
  }

  if (
    !["SUGGESTED_DRAFT", "USER_EDITED_DRAFT"].includes(mapping.selectionState)
    || !Array.isArray(mapping.fields)
    || mapping.fields.length === 0
    || mapping.fields.length > MAX_COLUMNS
    || !isSourceIdentity(
      mapping.sourceIdentity,
      headers,
      health.totalRows,
      value.rows
    )
    || !isStringList(mapping.unmappedSourceColumns, MAX_COLUMNS, headers)
  ) return false;

  const targetFields = new Set();
  const sourceColumns = new Set();
  for (const field of mapping.fields) {
    if (
      !isMappingField(field, headers, health.totalRows, value.rows)
      || targetFields.has(field.targetField)
    ) return false;
    targetFields.add(field.targetField);
    if (field.sourceColumn !== null) {
      if (sourceColumns.has(field.sourceColumn)) return false;
      sourceColumns.add(field.sourceColumn);
    }
  }
  const expectedUnmappedTargets = mapping.fields
    .filter(field => field.sourceColumn === null)
    .map(field => field.targetField);
  const expectedTimestampFields = mapping.fields
    .filter(field => field.declaredType === "TIMESTAMP")
    .map(field => field.targetField);
  return sameStringList(
    health.unknownUnmappedStatuses.unmappedTargetFields,
    expectedUnmappedTargets
  )
    && sameStringList(
      health.unknownUnmappedStatuses.unmappedSourceColumns,
      mapping.unmappedSourceColumns
    )
    && sameStringSet(Object.keys(health.timestampCoverage), expectedTimestampFields);
}

function isCommittedResult(value, expectations) {
  const summary = value?.summary;
  if (
    !isObject(value)
    || value.outcome !== "COMMITTED"
    || !isObject(value.batch)
    || !isBoundedString(value.batch.id, 200)
    || value.batch.status !== "COMMITTED"
    || !Array.isArray(value.rows)
    || !isObject(summary)
    || !["total", "committed", "skipped", "conflicted", "failed"]
      .every(key => isNonNegativeInteger(summary[key]))
    || summary.total === 0
    || summary.total > MAX_ROWS
    || summary.total !== summary.committed
      + summary.skipped
      + summary.conflicted
      + summary.failed
    || summary.conflicted !== 0
    || summary.failed !== 0
    || value.rows.length !== summary.total
    || (isNonNegativeInteger(expectations?.totalRows)
      && summary.total !== expectations.totalRows)
    || typeof value.reconciled !== "boolean"
    || (typeof expectations?.reconciled === "boolean"
      && value.reconciled !== expectations.reconciled)
  ) return false;

  const ordinals = new Set();
  let committed = 0;
  let skipped = 0;
  for (const row of value.rows) {
    if (
      !isObject(row)
      || !isIntegerBetween(row.sourceOrdinal, 0, summary.total - 1)
      || ordinals.has(row.sourceOrdinal)
      || row.sourceRowNumber !== row.sourceOrdinal + 2
      || !isBoundedString(row.sourceRecordId, 512)
      || !isBoundedString(row.targetId, 512)
      || !isSha256(row.canonicalPayloadSha256)
      || !["COMMITTED", "EXACT_DUPLICATE"].includes(row.disposition)
    ) return false;
    ordinals.add(row.sourceOrdinal);
    if (row.disposition === "COMMITTED") committed += 1;
    else skipped += 1;
  }

  return committed === summary.committed
    && skipped === summary.skipped
    && ordinals.size === summary.total;
}

function isDataHealth(health, columnCount = MAX_COLUMNS) {
  if (
    !isObject(health)
    || !isIntegerBetween(health.totalRows, 0, MAX_ROWS)
    || !isIntegerBetween(health.validRows, 0, health.totalRows)
    || !isIntegerBetween(health.rowsWithBlockingErrors, 0, health.totalRows)
    || health.validRows + health.rowsWithBlockingErrors !== health.totalRows
    || !isIntegerBetween(health.duplicateConflictCount, 0, health.rowsWithBlockingErrors)
    || !isCountMap(health.missingValueCounts, health.totalRows)
    || !isObject(health.unknownUnmappedStatuses)
    || !isIntegerBetween(
      health.unknownUnmappedStatuses.unknownValueCount,
      0,
      health.totalRows * columnCount
    )
    || !isStringList(health.unknownUnmappedStatuses.unmappedTargetFields, MAX_COLUMNS)
    || !isStringList(health.unknownUnmappedStatuses.unmappedSourceColumns, MAX_COLUMNS)
    || !isObject(health.timestampCoverage)
    || !Object.values(health.timestampCoverage).every(value => (
      isTimestampCoverage(value, health.totalRows)
    ))
    || !isCoherentCoverage(health.sourceIdCoverage, health.totalRows)
  ) return false;

  return health.contactabilityCoverage === undefined
    || (
      isCoherentCoverage(health.contactabilityCoverage, health.totalRows)
      && isStringList(health.contactabilityCoverage.fields, MAX_COLUMNS)
    );
}

function isStagedEvidenceRow(
  row,
  sourceOrdinal,
  headers,
  analysisRow,
  expectedLinks = null
) {
  const columnCount = headers?.length ?? row?.rawPayload?.cells?.length;
  if (
    !isObject(row)
    || !isBoundedString(row.id, 512)
    || row.sourceOrdinal !== sourceOrdinal
    || row.sourceRowNumber !== sourceOrdinal + 2
    || row.disposition !== "PENDING"
    || !isSha256(row.rawPayloadSha256)
    || !isRawPayload(row.rawPayload, row.sourceRowNumber, columnCount)
    || (isBoundedString(expectedLinks?.batchId, 200)
      && row.importBatchId !== expectedLinks.batchId)
    || (SOURCE_COLLECTIONS.has(expectedLinks?.sourceCollection)
      && row.sourceCollection !== expectedLinks.sourceCollection)
  ) return false;

  if (!analysisRow) return true;
  return typeof row.valid === "boolean"
    && Array.isArray(row.errors)
    && row.errors.length <= MAX_ISSUES_PER_ROW
    && row.errors.every(issue => isIssue(issue, columnCount))
    && Array.isArray(row.warnings)
    && row.warnings.length <= MAX_ISSUES_PER_ROW
    && row.warnings.every(issue => isIssue(issue, columnCount))
    && row.valid === (row.errors.length === 0);
}

function isRawPayload(payload, sourceRowNumber, columnCount) {
  return isObject(payload)
    && payload.sourceRowNumber === sourceRowNumber
    && isIntegerBetween(columnCount, 1, MAX_COLUMNS)
    && Array.isArray(payload.cells)
    && payload.cells.length === columnCount
    && payload.cells.every((cell, columnOrdinal) => (
      isCellEvidence(cell, columnOrdinal)
    ));
}

function isCellEvidence(cell, expectedOrdinal = null) {
  if (
    !isObject(cell)
    || !isIntegerBetween(cell.columnOrdinal, 0, MAX_COLUMNS - 1)
    || (expectedOrdinal !== null && cell.columnOrdinal !== expectedOrdinal)
    || typeof cell.present !== "boolean"
    || !VALUE_KINDS.has(cell.valueKind)
  ) return false;
  if (!cell.present) return cell.raw === null && cell.valueKind === "MISSING";
  return cell.valueKind !== "MISSING"
    && typeof cell.raw === "string"
    && utf8Length(cell.raw) <= MAX_CELL_BYTES;
}

function isMappingField(field, headers, totalRows, rows) {
  return isObject(field)
    && isBoundedString(field.targetField, 128)
    && isMappedColumn(field.sourceColumn, field.sourceColumnOrdinal, headers)
    && Array.isArray(field.sampleValues)
    && field.sampleValues.length === (field.sourceColumn === null
      ? 0
      : Math.min(totalRows, FIELD_SAMPLE_LIMIT))
    && field.sampleValues.every((sample, sourceOrdinal) => (
      isSampleValue(sample, sourceOrdinal)
    ))
    && samplesMatchRows(field.sampleValues, field.sourceColumnOrdinal, rows)
    && INFERRED_TYPES.has(field.inferredType)
    && SELECTED_TYPES.has(field.declaredType)
    && SELECTED_TYPES.has(field.selectedType)
    && typeof field.required === "boolean"
    && field.optional === !field.required
    && isDraftSuggestion(field.suggestion)
    && Array.isArray(field.validationIssues)
    && field.validationIssues.length <= MAX_MAPPING_ISSUES
    && field.validationIssues.every(issue => isIssue(issue, headers?.length))
    && (field.sourceColumn !== null || field.sampleValues.length === 0);
}

function isSourceIdentity(identity, headers, totalRows, rows) {
  return isObject(identity)
    && identity.role === "SOURCE_IDENTITY"
    && identity.sourceField === "source_id"
    && isMappedColumn(identity.sourceColumn, identity.sourceColumnOrdinal, headers)
    && Array.isArray(identity.sampleValues)
    && identity.sampleValues.length === (identity.sourceColumn === null
      ? 0
      : Math.min(totalRows, FIELD_SAMPLE_LIMIT))
    && identity.sampleValues.every((sample, sourceOrdinal) => (
      isSampleValue(sample, sourceOrdinal)
    ))
    && samplesMatchRows(identity.sampleValues, identity.sourceColumnOrdinal, rows)
    && INFERRED_TYPES.has(identity.inferredType)
    && identity.identityType === "TEXT"
    && identity.required === true
    && isDraftSuggestion(identity.suggestion)
    && Array.isArray(identity.validationIssues)
    && identity.validationIssues.length <= MAX_MAPPING_ISSUES
    && identity.validationIssues.every(issue => isIssue(issue, headers?.length))
    && (identity.sourceColumn !== null || identity.sampleValues.length === 0);
}

function isMappedColumn(sourceColumn, sourceColumnOrdinal, headers) {
  if (sourceColumn === null) return sourceColumnOrdinal === null;
  if (!isBoundedString(sourceColumn, MAX_HEADER_BYTES)) return false;
  if (!isIntegerBetween(sourceColumnOrdinal, 0, MAX_COLUMNS - 1)) return false;
  return headers === null || (
    headers[sourceColumnOrdinal] === sourceColumn
    && headers.indexOf(sourceColumn) === sourceColumnOrdinal
  );
}

function isSampleValue(sample, expectedOrdinal) {
  return isObject(sample)
    && sample.sourceOrdinal === expectedOrdinal
    && sample.sourceRowNumber === sample.sourceOrdinal + 2
    && typeof sample.present === "boolean"
    && VALUE_KINDS.has(sample.valueKind)
    && (sample.present
      ? sample.valueKind !== "MISSING"
        && typeof sample.raw === "string"
        && utf8Length(sample.raw) <= MAX_CELL_BYTES
      : sample.valueKind === "MISSING" && sample.raw === null);
}

function samplesMatchRows(samples, sourceColumnOrdinal, rows) {
  if (samples.length === 0) {
    return sourceColumnOrdinal === null || (Array.isArray(rows) && rows.length === 0);
  }
  if (!Array.isArray(rows) || !Number.isInteger(sourceColumnOrdinal)) return false;
  return samples.every(sample => {
    const row = rows[sample.sourceOrdinal];
    const cell = row?.rawPayload?.cells?.[sourceColumnOrdinal];
    return cell
      && sample.sourceRowNumber === row.sourceRowNumber
      && sample.present === cell.present
      && sample.raw === cell.raw
      && sample.valueKind === cell.valueKind;
  });
}

function isDraftSuggestion(suggestion) {
  return isObject(suggestion)
    && isBoundedString(suggestion.state, 64)
    && isBoundedString(suggestion.strategy, 64)
    && suggestion.nonAuthoritative === true
    && suggestion.accepted === false;
}

function isIssue(issue, columnCount = MAX_COLUMNS) {
  if (
    !isObject(issue)
    || !isBoundedString(issue.code, 128)
    || !["targetField", "sourceColumn", "identityRole", "mappingState"]
      .every(key => isOptionalBoundedString(issue[key], MAX_HEADER_BYTES))
    || (issue.sourceOrdinal !== undefined
      && !isIntegerBetween(issue.sourceOrdinal, 0, MAX_ROWS - 1))
    || (issue.sourceRowNumber !== undefined
      && !isIntegerBetween(issue.sourceRowNumber, 2, MAX_ROWS + 1))
    || (issue.sourceColumns !== undefined
      && !isStringList(issue.sourceColumns, MAX_COLUMNS))
  ) return false;
  if (issue.rawEvidence === undefined || issue.rawEvidence === null) return true;
  if (Object.hasOwn(issue.rawEvidence, "valueKind")) {
    return isCellEvidence(issue.rawEvidence)
      && issue.rawEvidence.columnOrdinal < columnCount;
  }
  const cells = issue.rawEvidence?.cells;
  return Array.isArray(cells)
    && cells.length === columnCount
    && cells.every((cell, ordinal) => isCellEvidence(cell, ordinal));
}

function isHeaderList(headers, columnCount) {
  return Array.isArray(headers)
    && headers.length === columnCount
    && headers.every(header => isBoundedString(header, MAX_HEADER_BYTES))
    && new Set(headers).size === headers.length;
}

function validExpectedHeaders(headers) {
  return Array.isArray(headers) && isHeaderList(headers, headers.length);
}

function isValueKindCounts(counts, expectedTotal) {
  return isObject(counts)
    && Object.entries(counts).every(([kind, count]) => (
      VALUE_KINDS.has(kind) && isNonNegativeInteger(count)
    ))
    && Object.values(counts).reduce((total, count) => total + count, 0) === expectedTotal;
}

function isCountMap(counts, totalRows) {
  return isObject(counts)
    && Object.keys(counts).length <= MAX_COLUMNS
    && Object.entries(counts).every(([key, count]) => (
      isBoundedString(key, 128) && isIntegerBetween(count, 0, totalRows)
    ));
}

function isTimestampCoverage(value, totalRows) {
  return isCoherentCoverage(value, totalRows)
    && isIntegerBetween(value.invalidRows, 0, totalRows)
    && isIntegerBetween(value.missingRows, 0, totalRows)
    && value.coveredRows + value.invalidRows + value.missingRows === totalRows;
}

function isCoherentCoverage(value, totalRows) {
  return isObject(value)
    && isIntegerBetween(value.coveredRows, 0, totalRows)
    && value.totalRows === totalRows
    && value.percentage === percentage(value.coveredRows, totalRows);
}

function isStringList(values, maximum, allowedValues = null) {
  return Array.isArray(values)
    && values.length <= maximum
    && values.every(value => (
      isBoundedString(value, MAX_HEADER_BYTES)
      && (allowedValues === null || allowedValues.includes(value))
    ))
    && new Set(values).size === values.length;
}

function sameStringList(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameStringSet(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every(value => right.includes(value));
}

function matchesExpectedBatch(value, expectedBatchId) {
  return expectedBatchId === null || value.batch.id === expectedBatchId;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value, maximumBytes) {
  return typeof value === "string"
    && value.length > 0
    && utf8Length(value) <= maximumBytes;
}

function isOptionalBoundedString(value, maximumBytes) {
  return value === undefined
    || value === null
    || isBoundedString(value, maximumBytes);
}

function utf8Length(value) {
  return new TextEncoder().encode(value).byteLength;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isIntegerBetween(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function percentage(covered, total) {
  return total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2));
}
