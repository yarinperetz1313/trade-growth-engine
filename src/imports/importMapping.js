const ROW_SAMPLE_LIMIT = 100;
const FIELD_SAMPLE_LIMIT = 5;
const TASK_STATUSES = new Set(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const {
  isCanonicalNumericLiteralRepresentable,
  isGreaterThanOneLiteral,
  isNegativeNumberLiteral
} = require("./numericEvidence");

class ImportMappingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ImportMappingError";
    this.code = code;
    this.status = status;
  }
}

const commonTimestamps = [
  field("created_at", "TIMESTAMP", false, ["created on", "created", "created date"]),
  field("updated_at", "TIMESTAMP", false, ["updated on", "modified at", "last modified"])
];

const SOURCE_IDENTITY = field(
  "source_id",
  "TEXT",
  true,
  ["source id", "external id", "external key", "record id", "id"]
);

const TARGETS = Object.freeze({
  prospects: Object.freeze({
    fields: [
      field("id", "TEXT", true, ["record id", "record_id", "source id", "source_id", "external key", "external id"]),
      field("business_name", "TEXT", true, ["company", "company name", "business", "business name", "trading name", "customer"]),
      field("website", "TEXT", false, ["web site", "url", "company website"]),
      field("email", "TEXT", false, ["e-mail", "email address", "contact email"]),
      field("phone", "TEXT", false, ["phone number", "telephone", "mobile"]),
      field("service", "TEXT", false, ["service type", "product"]),
      field("location", "TEXT", false, ["address", "region"]),
      field("source", "TEXT", false, ["lead source", "source system"]),
      field("source_url", "TEXT", false, ["source url", "source link"]),
      field("dedupe_key", "TEXT", false, ["dedupe key", "duplicate key"]),
      field("qualification_score", "NUMBER", false, ["qualification score", "lead score", "score"]),
      field("qualification_status", "STATUS", false, ["qualification status", "lead status", "status"]),
      ...commonTimestamps
    ],
    important: ["business_name", "email", "id", "phone", "website"],
    contactability: ["email", "phone", "website"]
  }),
  opportunities: Object.freeze({
    fields: [
      field("id", "TEXT", true, ["record id", "record_id", "source id", "source_id", "external key", "external id", "quote id"]),
      field("prospect_id", "TEXT", false, ["prospect id", "customer id", "business id"]),
      field("business_name", "TEXT", true, ["company", "company name", "business", "business name", "trading name", "customer"]),
      field("stage", "STATUS", true, ["deal stage", "deal_stage", "opportunity stage", "quote status", "status"]),
      field("priority", "STATUS", false, ["deal priority"]),
      field("qualification_score", "NUMBER", false, ["qualification score", "lead score", "score"]),
      field("value", "NUMBER", false, ["amount", "commercial value", "deal value", "quote value"]),
      field("probability", "NUMBER", false, ["win probability", "close probability"]),
      field("weighted_value", "NUMBER", false, ["weighted value"]),
      field("next_action", "TEXT", false, ["next action", "next step"]),
      field("contact_name", "TEXT", false, ["contact", "contact name", "primary contact"]),
      ...commonTimestamps
    ],
    important: ["business_name", "contact_name", "id", "stage", "value"]
  }),
  tasks: Object.freeze({
    fields: [
      field("id", "TEXT", true, ["record id", "record_id", "source id", "source_id", "external key", "external id"]),
      field("opportunity_id", "TEXT", true, ["opportunity id", "deal id", "quote id"]),
      field("title", "TEXT", true, ["task", "task title", "subject"]),
      field("description", "TEXT", false, ["details", "notes"]),
      field("due_at", "TIMESTAMP", false, ["due", "due date", "due on"]),
      field("priority", "STATUS", false, ["task priority"]),
      field("status", "STATUS", true, ["task status"]),
      field("completed_at", "TIMESTAMP", false, ["completed", "completed on"]),
      ...commonTimestamps
    ],
    important: ["id", "opportunity_id", "status", "title"]
  }),
  activities: Object.freeze({
    fields: [
      field("id", "TEXT", true, ["record id", "record_id", "source id", "source_id", "external key", "external id"]),
      field("opportunity_id", "TEXT", true, ["opportunity id", "deal id", "quote id"]),
      field("prospect_id", "TEXT", false, ["prospect id", "customer id", "business id"]),
      field("type", "STATUS", true, ["activity type", "event type"]),
      field("description", "TEXT", false, ["details", "notes"]),
      ...commonTimestamps
    ],
    important: ["id", "opportunity_id", "type"]
  })
});

function field(targetField, declaredType, required, aliases) {
  return Object.freeze({ targetField, declaredType, required, aliases });
}

function buildImportAnalysis(staged, options = {}) {
  return buildImportAnalysisInternal(staged, options, false);
}

function buildCompleteImportAnalysis(staged, options = {}) {
  return buildImportAnalysisInternal(staged, options, true);
}

function buildImportAnalysisInternal(staged, options, includeAllRows) {
  validateEvidence(staged);
  if (
    !options
    || typeof options !== "object"
    || Array.isArray(options)
    || !Object.keys(options).every(key => [
      "selections", "sourceIdentitySelection"
    ].includes(key))
    || Object.keys(options).length > 2
  ) selectionInvalid();
  const targetCollection = staged.records[0]?.sourceCollection
    || staged.batch?.previewSummary?.sourceCollection
    || null;
  const headers = staged.batch.previewSummary.headers;
  const target = TARGETS[targetCollection];
  const hasSelections = Object.hasOwn(options, "selections");
  const selectionInput = options.selections;
  const hasSourceIdentitySelection = Object.hasOwn(options, "sourceIdentitySelection");
  if (hasSelections && !Array.isArray(selectionInput)) selectionInvalid();
  if (!target) {
    if (
      (hasSelections && selectionInput.length > 0)
      || hasSourceIdentitySelection
    ) selectionInvalid();
    return unsupportedAnalysis(staged, targetCollection);
  }

  const selections = hasSelections
    ? validateSelections(selectionInput, target, headers)
    : new Map();
  const fields = target.fields.map(definition => mapField(
    definition,
    headers,
    staged.records,
    selections
  ));
  markAutomaticSourceReuse(fields);
  const sourceIdentity = mapSourceIdentity(
    headers,
    staged.records,
    hasSourceIdentitySelection
      ? validateSourceIdentitySelection(options.sourceIdentitySelection, headers)
      : undefined
  );

  const allRows = validateRows(
    staged.records,
    headers,
    fields,
    targetCollection,
    sourceIdentity
  );
  for (const mappedField of fields) {
    mappedField.validationIssues.push(...allRows.slice(0, ROW_SAMPLE_LIMIT).flatMap(row => [
      ...row.errors,
      ...row.warnings
    ]).filter(issue => (
      issue.targetField === mappedField.targetField
      && !(
        issue.code === "REQUIRED_MAPPING_MISSING"
        && mappedField.suggestion.state === "CONFLICT"
      )
    )));
  }
  sourceIdentity.validationIssues.push(...allRows.slice(0, ROW_SAMPLE_LIMIT).flatMap(row => [
    ...row.errors,
    ...row.warnings
  ]).filter(issue => issue.identityRole === "SOURCE_IDENTITY"));

  return {
    mapping: {
      status: "DRAFT",
      authoritative: false,
      accepted: false,
      selectionState: selections.size > 0 || hasSourceIdentitySelection
        ? "USER_EDITED_DRAFT"
        : "SUGGESTED_DRAFT",
      targetCollection,
      sourceIdentity,
      fields,
      unmappedSourceColumns: unmappedSourceColumns(headers, fields, sourceIdentity)
    },
    rows: includeAllRows ? allRows : allRows.slice(0, ROW_SAMPLE_LIMIT),
    rowSampleLimit: ROW_SAMPLE_LIMIT,
    dataHealth: buildDataHealth(allRows, fields, target, headers, sourceIdentity)
  };
}

function validateEvidence(staged) {
  const headers = staged?.batch?.previewSummary?.headers;
  const rowCount = staged?.batch?.previewSummary?.rowCount;
  if (
    !Array.isArray(headers)
    || !Array.isArray(staged?.records)
    || !Number.isSafeInteger(rowCount)
    || rowCount < 0
    || rowCount !== staged.records.length
  ) {
    throw new ImportMappingError(
      "IMPORT_MAPPING_EVIDENCE_INVALID",
      "Immutable import staging evidence is required."
    );
  }
}

function validateSourceIdentitySelection(input, headers) {
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || !exactKeys(input, ["sourceColumn"])
    || !(input.sourceColumn === null || headers.includes(input.sourceColumn))
  ) selectionInvalid();
  return input;
}

function validateSelections(input, target, headers) {
  if (!Array.isArray(input)) selectionInvalid();
  const definitions = new Map(target.fields.map(item => [item.targetField, item]));
  const selections = new Map();
  const usedSources = new Set();
  for (const selection of input) {
    if (
      !selection
      || typeof selection !== "object"
      || Array.isArray(selection)
      || !exactKeys(selection, ["targetField", "sourceColumn", "selectedType"])
      || !definitions.has(selection.targetField)
      || selections.has(selection.targetField)
      || !(selection.sourceColumn === null || headers.includes(selection.sourceColumn))
      || typeof selection.selectedType !== "string"
      || !["TEXT", "NUMBER", "TIMESTAMP", "STATUS"].includes(selection.selectedType)
    ) selectionInvalid();
    if (selection.sourceColumn !== null && usedSources.has(selection.sourceColumn)) {
      selectionInvalid();
    }
    if (selection.sourceColumn !== null) usedSources.add(selection.sourceColumn);
    selections.set(selection.targetField, selection);
  }
  return selections;
}

function selectionInvalid() {
  throw new ImportMappingError(
    "IMPORT_MAPPING_SELECTION_INVALID",
    "The draft import mapping selection is invalid."
  );
}

function mapField(definition, headers, records, selections) {
  const selected = selections.get(definition.targetField);
  let sourceColumn = null;
  let suggestion;
  const validationIssues = [];
  if (selected) {
    sourceColumn = selected.sourceColumn;
    suggestion = suggestionState(sourceColumn === null ? "USER_UNMAPPED" : "USER_SELECTED", "USER_SELECTION");
  } else {
    const exact = headers.filter(header => normalizeExact(header) === definition.targetField.toLowerCase());
    if (exact.length === 1) {
      sourceColumn = exact[0];
      suggestion = suggestionState("SUGGESTED_EXACT", "EXACT_TARGET_NAME");
    } else if (exact.length > 1) {
      suggestion = conflictSuggestion();
      validationIssues.push(mappingIssue("MAPPING_EXACT_TIE", exact));
    } else {
      const match = firstAliasMatch(headers, definition.aliases);
      if (match.columns.length === 1) {
        sourceColumn = match.columns[0];
        suggestion = suggestionState("SUGGESTED_ALIAS", "ORDERED_ALIAS");
      } else if (match.columns.length > 1) {
        suggestion = conflictSuggestion();
        validationIssues.push(mappingIssue("MAPPING_ALIAS_TIE", match.columns));
      } else {
        suggestion = suggestionState("UNMAPPED", "NO_DETERMINISTIC_MATCH");
      }
    }
  }
  const sourceIndex = sourceColumn === null ? -1 : headers.indexOf(sourceColumn);
  const samples = sourceIndex < 0 ? [] : records.slice(0, FIELD_SAMPLE_LIMIT).map(record => {
    const evidence = rawEvidence(record, sourceIndex);
    return {
      sourceOrdinal: record.sourceOrdinal,
      sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
      present: evidence.present,
      raw: evidence.raw,
      valueKind: evidence.valueKind
    };
  });
  const declaredType = definition.declaredType;
  return {
    sourceColumn,
    sourceColumnOrdinal: sourceIndex < 0 ? null : sourceIndex,
    targetField: definition.targetField,
    sampleValues: samples,
    inferredType: inferType(samples),
    declaredType,
    selectedType: selected?.selectedType || declaredType,
    required: definition.required,
    optional: !definition.required,
    suggestion,
    validationIssues
  };
}

function mapSourceIdentity(headers, records, selection) {
  const selections = new Map();
  if (selection) {
    selections.set(SOURCE_IDENTITY.targetField, {
      targetField: SOURCE_IDENTITY.targetField,
      sourceColumn: selection.sourceColumn,
      selectedType: SOURCE_IDENTITY.declaredType
    });
  }
  const mapped = mapField(SOURCE_IDENTITY, headers, records, selections);
  return {
    role: "SOURCE_IDENTITY",
    sourceField: SOURCE_IDENTITY.targetField,
    sourceColumn: mapped.sourceColumn,
    sourceColumnOrdinal: mapped.sourceColumnOrdinal,
    sampleValues: mapped.sampleValues,
    inferredType: mapped.inferredType,
    identityType: mapped.declaredType,
    required: true,
    suggestion: mapped.suggestion,
    validationIssues: mapped.validationIssues
  };
}

function firstAliasMatch(headers, aliases) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeAlias(alias);
    const columns = headers.filter(header => normalizeAlias(header) === normalizedAlias);
    if (columns.length > 0) return { columns };
  }
  return { columns: [] };
}

function markAutomaticSourceReuse(fields) {
  const sources = new Map();
  for (const item of fields) {
    if (item.sourceColumn === null) continue;
    const owners = sources.get(item.sourceColumn) || [];
    owners.push(item);
    sources.set(item.sourceColumn, owners);
  }
  for (const [sourceColumn, owners] of sources) {
    if (owners.length < 2) continue;
    for (const owner of owners) {
      owner.sourceColumn = null;
      owner.sourceColumnOrdinal = null;
      owner.sampleValues = [];
      owner.inferredType = "UNKNOWN";
      owner.suggestion = conflictSuggestion();
      owner.validationIssues.push(mappingIssue("MAPPING_SOURCE_REUSE", [sourceColumn]));
    }
  }
}

function validateRows(records, headers, fields, targetCollection, sourceIdentity) {
  const sourceIds = new Map();
  const payloadHashes = new Map();
  return records.map(record => {
    const errors = [];
    const warnings = [];
    for (const mappedField of fields) {
      if (mappedField.sourceColumn === null) {
        if (mappedField.required) {
          errors.push({
            code: "REQUIRED_MAPPING_MISSING",
            targetField: mappedField.targetField,
            sourceColumn: null,
            sourceOrdinal: record.sourceOrdinal,
            sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
            mappingState: "UNMAPPED_REQUIRED_TARGET",
            rawEvidence: null
          });
        }
        continue;
      }
      const columnOrdinal = headers.indexOf(mappedField.sourceColumn);
      const evidence = rawEvidence(record, columnOrdinal);
      const issueBase = {
        targetField: mappedField.targetField,
        sourceColumn: mappedField.sourceColumn,
        sourceOrdinal: record.sourceOrdinal,
        sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
        rawEvidence: evidence
      };
      if (evidence.valueKind === "UNKNOWN" || evidence.valueKind === "NULL") {
        warnings.push({ code: "UNKNOWN_VALUE_PRESERVED", ...issueBase });
        if (mappedField.required) {
          errors.push({ code: "REQUIRED_VALUE_MISSING", ...issueBase });
        }
        continue;
      }
      if (mappedField.required && isAbsent(evidence)) {
        errors.push({ code: "REQUIRED_VALUE_MISSING", ...issueBase });
        continue;
      }
      if (isAbsent(evidence)) continue;
      if (
        mappedField.required
        && typeof evidence.raw === "string"
        && evidence.raw.trim() === ""
      ) {
        errors.push({ code: "REQUIRED_VALUE_MISSING", ...issueBase });
        continue;
      }
      if (mappedField.declaredType === "NUMBER" && !["NUMERIC", "KNOWN_ZERO"].includes(evidence.valueKind)) {
        warnings.push({ code: "NONNUMERIC_VALUE_PRESERVED", ...issueBase });
      }
      if (
        mappedField.declaredType === "NUMBER"
        && ["NUMERIC", "KNOWN_ZERO"].includes(evidence.valueKind)
        && !isCanonicalNumericLiteralRepresentable(evidence.raw)
      ) {
        errors.push({ code: "POSTGRES_NUMERIC_UNREPRESENTABLE", ...issueBase });
      }
      if (mappedField.declaredType === "TIMESTAMP" && !validTimestamp(evidence.raw)) {
        errors.push({ code: "TIMESTAMP_INVALID", ...issueBase });
      }
      if (
        targetCollection === "opportunities"
        && mappedField.targetField === "probability"
        && ["NUMERIC", "KNOWN_ZERO"].includes(evidence.valueKind)
        && (
          isNegativeNumberLiteral(evidence.raw)
          || isGreaterThanOneLiteral(evidence.raw)
        )
      ) {
        errors.push({ code: "PROBABILITY_OUT_OF_RANGE", ...issueBase });
      }
      if (
        targetCollection === "opportunities"
        && mappedField.targetField === "value"
        && ["NUMERIC", "KNOWN_ZERO"].includes(evidence.valueKind)
        && isNegativeNumberLiteral(evidence.raw)
      ) {
        errors.push({ code: "COMMERCIAL_VALUE_OUT_OF_RANGE", ...issueBase });
      }
      if (
        targetCollection === "tasks"
        && mappedField.targetField === "status"
        && !TASK_STATUSES.has(evidence.raw)
      ) {
        errors.push({ code: "TASK_STATUS_INVALID", ...issueBase });
      }
    }

    if (targetCollection === "tasks") {
      validateTaskCompletionConsistency(record, headers, fields, errors);
    }

    const identityEvidence = sourceIdentity?.sourceColumn
      ? rawEvidence(record, headers.indexOf(sourceIdentity.sourceColumn))
      : null;
    if (identityEvidence && !isMissingSourceIdentity(identityEvidence)) {
      const key = String(identityEvidence.raw);
      if (sourceIds.has(key)) {
        errors.push({
          code: "DUPLICATE_SOURCE_ID",
          identityRole: "SOURCE_IDENTITY",
          sourceField: sourceIdentity.sourceField,
          sourceColumn: sourceIdentity.sourceColumn,
          sourceOrdinal: record.sourceOrdinal,
          sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
          firstSourceOrdinal: sourceIds.get(key),
          rawEvidence: identityEvidence
        });
      } else sourceIds.set(key, record.sourceOrdinal);
    }
    const exactEvidenceKey = JSON.stringify(record.rawPayload?.cells || []);
    if (exactEvidenceKey) {
      if (payloadHashes.has(exactEvidenceKey)) {
        errors.push({
          code: "EXACT_REPEATED_SOURCE_ROW",
          sourceOrdinal: record.sourceOrdinal,
          sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
          firstSourceOrdinal: payloadHashes.get(exactEvidenceKey),
          rawEvidence: record.rawPayload
        });
      } else payloadHashes.set(exactEvidenceKey, record.sourceOrdinal);
    }
    return {
      id: record.id,
      sourceOrdinal: record.sourceOrdinal,
      sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
      rawPayload: record.rawPayload,
      rawPayloadSha256: record.rawPayloadSha256,
      disposition: record.disposition,
      errors,
      warnings,
      valid: errors.length === 0
    };
  });
}

function validateTaskCompletionConsistency(record, headers, fields, errors) {
  const statusField = fields.find(item => item.targetField === "status");
  const completedField = fields.find(item => item.targetField === "completed_at");
  const statusEvidence = statusField?.sourceColumn
    ? rawEvidence(record, headers.indexOf(statusField.sourceColumn))
    : null;
  const completedEvidence = completedField?.sourceColumn
    ? rawEvidence(record, headers.indexOf(completedField.sourceColumn))
    : null;
  if (!statusEvidence || isAbsent(statusEvidence) || !TASK_STATUSES.has(statusEvidence.raw)) {
    return;
  }
  const issue = {
    targetField: "completed_at",
    sourceColumn: completedField?.sourceColumn ?? null,
    sourceOrdinal: record.sourceOrdinal,
    sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
    rawEvidence: completedEvidence
  };
  if (statusEvidence.raw === "COMPLETED" && isAbsent(completedEvidence)) {
    errors.push({ code: "TASK_COMPLETION_TIMESTAMP_REQUIRED", ...issue });
  } else if (statusEvidence.raw !== "COMPLETED" && !isAbsent(completedEvidence)) {
    errors.push({ code: "TASK_COMPLETION_TIMESTAMP_INCONSISTENT", ...issue });
  }
}

function buildDataHealth(rows, fields, target, headers, sourceIdentity) {
  const totalRows = rows.length;
  const mapped = new Map(fields.map(item => [item.targetField, item]));
  const missingValueCounts = {};
  for (const targetField of [...target.important].sort()) {
    const item = mapped.get(targetField);
    missingValueCounts[targetField] = item?.sourceColumn
      ? rows.filter(row => isMissingForCount(cellForRow(row, item))).length
      : totalRows;
  }
  const dataHealth = {
    totalRows,
    validRows: rows.filter(row => row.valid).length,
    rowsWithBlockingErrors: rows.filter(row => !row.valid).length,
    duplicateConflictCount: rows.filter(row => row.errors.some(issue => [
      "DUPLICATE_SOURCE_ID", "EXACT_REPEATED_SOURCE_ROW"
    ].includes(issue.code))).length,
    missingValueCounts,
    unknownUnmappedStatuses: {
      unknownValueCount: rows.reduce((count, row) => count + row.rawPayload.cells.filter(cell => ["UNKNOWN", "NULL"].includes(cell.valueKind)).length, 0),
      unmappedTargetFields: fields.filter(item => item.sourceColumn === null).map(item => item.targetField),
      unmappedSourceColumns: unmappedSourceColumns(headers, fields, sourceIdentity)
    },
    timestampCoverage: Object.fromEntries(
      fields.filter(item => item.declaredType === "TIMESTAMP").map(item => [
        item.targetField,
        coverage(rows, item, "TIMESTAMP")
      ])
    ),
    sourceIdCoverage: coverage(rows, sourceIdentity, "PRESENT")
  };
  if (target.contactability) {
    const contactFields = target.contactability.map(name => mapped.get(name));
    const coveredRows = rows.filter(row => contactFields.some(item => item?.sourceColumn && !isAbsent(cellForRow(row, item, fields)))).length;
    dataHealth.contactabilityCoverage = {
      coveredRows,
      totalRows,
      percentage: percentage(coveredRows, totalRows),
      fields: [...target.contactability]
    };
  }
  return dataHealth;
}

function coverage(rows, item, kind) {
  let coveredRows = 0;
  let invalidRows = 0;
  let missingRows = 0;
  for (const row of rows) {
    const evidence = item?.sourceColumn ? cellForRow(row, item) : null;
    if (
      !evidence
      || isAbsent(evidence)
      || (item?.role === "SOURCE_IDENTITY" && isMissingSourceIdentity(evidence))
    ) {
      missingRows += 1;
    } else if (kind === "TIMESTAMP" && !validTimestamp(evidence.raw)) {
      invalidRows += 1;
    } else coveredRows += 1;
  }
  const result = { coveredRows, totalRows: rows.length, percentage: percentage(coveredRows, rows.length) };
  if (kind === "TIMESTAMP") return { coveredRows, invalidRows, missingRows, totalRows: rows.length, percentage: result.percentage };
  return result;
}

function unmappedSourceColumns(headers, fields, sourceIdentity) {
  const mappedColumns = new Set(fields.map(item => item.sourceColumn).filter(Boolean));
  if (sourceIdentity?.sourceColumn) mappedColumns.add(sourceIdentity.sourceColumn);
  return headers.filter(header => !mappedColumns.has(header));
}

function cellForRow(row, item) {
  const issue = [...row.errors, ...row.warnings].find(candidate => (
    item.role === "SOURCE_IDENTITY"
      ? candidate.identityRole === item.role
      : candidate.targetField === item.targetField
  ));
  if (issue?.rawEvidence && Object.hasOwn(issue.rawEvidence, "columnOrdinal")) return issue.rawEvidence;
  const columnOrdinal = item.sourceColumnOrdinal;
  if (!Number.isInteger(columnOrdinal) || columnOrdinal < 0) return null;
  return rawEvidence({ rawPayload: row.rawPayload }, columnOrdinal);
}

function unsupportedAnalysis(staged, targetCollection) {
  const rows = staged.records.map(record => ({
    id: record.id,
    sourceOrdinal: record.sourceOrdinal,
    sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
    rawPayload: record.rawPayload,
    rawPayloadSha256: record.rawPayloadSha256,
    disposition: record.disposition,
    errors: [{
      code: "IMPORT_TARGET_UNSUPPORTED",
      sourceOrdinal: record.sourceOrdinal,
      sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
      rawEvidence: record.rawPayload
    }],
    warnings: [],
    valid: false
  }));
  return {
    mapping: {
      status: "UNSUPPORTED_TARGET",
      authoritative: false,
      accepted: false,
      selectionState: "UNAVAILABLE",
      targetCollection,
      fields: [],
      unmappedSourceColumns: [...staged.batch.previewSummary.headers]
    },
    rows: rows.slice(0, ROW_SAMPLE_LIMIT),
    rowSampleLimit: ROW_SAMPLE_LIMIT,
    dataHealth: {
      totalRows: rows.length,
      validRows: 0,
      rowsWithBlockingErrors: rows.length,
      duplicateConflictCount: 0,
      missingValueCounts: {},
      unknownUnmappedStatuses: {
        unknownValueCount: rows.reduce((count, row) => count + row.rawPayload.cells.filter(cell => ["UNKNOWN", "NULL"].includes(cell.valueKind)).length, 0),
        unmappedTargetFields: [],
        unmappedSourceColumns: [...staged.batch.previewSummary.headers]
      },
      timestampCoverage: {},
      sourceIdCoverage: { coveredRows: 0, totalRows: rows.length, percentage: 0 }
    }
  };
}

function rawEvidence(record, columnOrdinal) {
  const cell = record.rawPayload?.cells?.[columnOrdinal];
  return cell ? {
    columnOrdinal,
    present: cell.present,
    raw: cell.raw,
    valueKind: cell.valueKind
  } : { columnOrdinal, present: false, raw: null, valueKind: "MISSING" };
}

function inferType(samples) {
  const usable = samples.filter(sample => !isAbsent(sample));
  if (usable.length === 0) return "UNKNOWN";
  const types = new Set(usable.map(sample => {
    if (["NUMERIC", "KNOWN_ZERO"].includes(sample.valueKind)) return "NUMBER";
    if (validTimestamp(sample.raw)) return "TIMESTAMP";
    return "TEXT";
  }));
  return types.size === 1 ? [...types][0] : "MIXED";
}

function validTimestamp(raw) {
  if (typeof raw !== "string") return false;
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/
  );
  if (!match) return false;
  const [
    , yearText, monthText, dayText, hourText, minuteText, secondText,
    , offsetSign, offsetHourText, offsetMinuteText
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
  ) return false;
  if (hourText !== undefined && (
    Number(hourText) > 23
    || Number(minuteText) > 59
    || (secondText !== undefined && Number(secondText) > 59)
  )) return false;
  if (offsetSign && (
    Number(offsetHourText) > 14
    || Number(offsetMinuteText) > 59
    || (Number(offsetHourText) === 14 && Number(offsetMinuteText) !== 0)
  )) return false;
  return true;
}

function daysInMonth(year, month) {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isAbsent(evidence) {
  return !evidence || ["MISSING", "BLANK", "NULL", "UNKNOWN"].includes(evidence.valueKind);
}

function isMissingSourceIdentity(evidence) {
  return isAbsent(evidence)
    || (typeof evidence?.raw === "string" && evidence.raw.trim() === "");
}

function isMissingForCount(evidence) {
  return !evidence || ["MISSING", "BLANK", "NULL"].includes(evidence.valueKind);
}

function suggestionState(state, strategy) {
  return { state, strategy, nonAuthoritative: true, accepted: false };
}

function conflictSuggestion() {
  return suggestionState("CONFLICT", "DETERMINISTIC_CONFLICT");
}

function mappingIssue(code, sourceColumns) {
  return { code, sourceColumns: [...sourceColumns] };
}

function normalizeExact(value) {
  return String(value).trim().toLowerCase();
}

function normalizeAlias(value) {
  return normalizeExact(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function exactKeys(value, keys) {
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function percentage(covered, total) {
  return total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2));
}

module.exports = {
  FIELD_SAMPLE_LIMIT,
  ImportMappingError,
  ROW_SAMPLE_LIMIT,
  TARGETS,
  buildCompleteImportAnalysis,
  buildImportAnalysis
};
