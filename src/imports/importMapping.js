const ROW_SAMPLE_LIMIT = 100;
const FIELD_SAMPLE_LIMIT = 5;

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
  validateEvidence(staged);
  if (
    !options
    || typeof options !== "object"
    || Array.isArray(options)
    || !Object.keys(options).every(key => key === "selections")
    || Object.keys(options).length > 1
  ) selectionInvalid();
  const targetCollection = staged.records[0]?.sourceCollection
    || staged.batch?.previewSummary?.sourceCollection
    || null;
  const headers = staged.batch.previewSummary.headers;
  const target = TARGETS[targetCollection];
  const hasSelections = Object.hasOwn(options, "selections");
  const selectionInput = options.selections;
  if (hasSelections && !Array.isArray(selectionInput)) selectionInvalid();
  if (!target) {
    if (hasSelections && selectionInput.length > 0) selectionInvalid();
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

  const allRows = validateRows(staged.records, headers, fields);
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

  return {
    mapping: {
      status: "DRAFT",
      authoritative: false,
      accepted: false,
      selectionState: selections.size > 0 ? "USER_EDITED_DRAFT" : "SUGGESTED_DRAFT",
      targetCollection,
      fields,
      unmappedSourceColumns: headers.filter(header => !fields.some(item => item.sourceColumn === header))
    },
    rows: allRows.slice(0, ROW_SAMPLE_LIMIT),
    rowSampleLimit: ROW_SAMPLE_LIMIT,
    dataHealth: buildDataHealth(allRows, fields, target, headers)
  };
}

function validateEvidence(staged) {
  const headers = staged?.batch?.previewSummary?.headers;
  if (!Array.isArray(headers) || !Array.isArray(staged?.records)) {
    throw new ImportMappingError(
      "IMPORT_MAPPING_EVIDENCE_INVALID",
      "Immutable import staging evidence is required."
    );
  }
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
    inferredType: inferType(samples, declaredType),
    declaredType,
    selectedType: selected?.selectedType || declaredType,
    required: definition.required,
    optional: !definition.required,
    suggestion,
    validationIssues
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

function validateRows(records, headers, fields) {
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
      if (mappedField.selectedType === "NUMBER" && !["NUMERIC", "KNOWN_ZERO"].includes(evidence.valueKind)) {
        warnings.push({ code: "NONNUMERIC_VALUE_PRESERVED", ...issueBase });
      }
      if (mappedField.selectedType === "TIMESTAMP" && !validTimestamp(evidence.raw)) {
        errors.push({ code: "TIMESTAMP_INVALID", ...issueBase });
      }
    }

    const idField = fields.find(item => item.targetField === "id" && item.sourceColumn !== null);
    const idEvidence = idField ? rawEvidence(record, headers.indexOf(idField.sourceColumn)) : null;
    if (idEvidence && !isAbsent(idEvidence)) {
      const key = String(idEvidence.raw);
      if (sourceIds.has(key)) {
        errors.push({
          code: "DUPLICATE_SOURCE_ID",
          targetField: "id",
          sourceColumn: idField.sourceColumn,
          sourceOrdinal: record.sourceOrdinal,
          sourceRowNumber: record.sourceRowNumber ?? record.rawPayload?.sourceRowNumber,
          firstSourceOrdinal: sourceIds.get(key),
          rawEvidence: idEvidence
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

function buildDataHealth(rows, fields, target, headers) {
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
      unmappedSourceColumns: headers.filter(header => !fields.some(item => item.sourceColumn === header))
    },
    timestampCoverage: Object.fromEntries(
      fields.filter(item => item.declaredType === "TIMESTAMP").map(item => [
        item.targetField,
        coverage(rows, item, "TIMESTAMP")
      ])
    ),
    sourceIdCoverage: coverage(rows, mapped.get("id"), "PRESENT")
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
    if (!evidence || isAbsent(evidence)) {
      missingRows += 1;
    } else if (kind === "TIMESTAMP" && !validTimestamp(evidence.raw)) {
      invalidRows += 1;
    } else coveredRows += 1;
  }
  const result = { coveredRows, totalRows: rows.length, percentage: percentage(coveredRows, rows.length) };
  if (kind === "TIMESTAMP") return { coveredRows, invalidRows, missingRows, totalRows: rows.length, percentage: result.percentage };
  return result;
}

function cellForRow(row, item) {
  const issue = [...row.errors, ...row.warnings].find(candidate => candidate.targetField === item.targetField);
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

function inferType(samples, declaredType) {
  const usable = samples.filter(sample => !isAbsent(sample));
  if (usable.length === 0) return "UNKNOWN";
  const matches = usable.map(sample => valueMatchesType(sample, declaredType));
  if (matches.every(Boolean)) return declaredType;
  if (matches.some(Boolean)) return "MIXED";
  return "TEXT";
}

function valueMatchesType(sample, type) {
  if (["TEXT", "STATUS"].includes(type)) return true;
  if (type === "NUMBER") return ["NUMERIC", "KNOWN_ZERO"].includes(sample.valueKind);
  if (type === "TIMESTAMP") return validTimestamp(sample.raw);
  return false;
}

function validTimestamp(raw) {
  return typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Date.parse(raw));
}

function isAbsent(evidence) {
  return !evidence || ["MISSING", "BLANK", "NULL", "UNKNOWN"].includes(evidence.valueKind);
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
  buildImportAnalysis
};
