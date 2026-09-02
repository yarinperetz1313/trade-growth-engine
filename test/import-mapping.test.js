const assert = require("node:assert/strict");
const test = require("node:test");

const { parseCsvUpload } = require("../src/imports/csvParser");
const {
  ImportMappingError,
  buildImportAnalysis
} = require("../src/imports/importMapping");

function evidence(csv, sourceCollection = "prospects") {
  const parsed = parseCsvUpload({
    contentBase64: Buffer.from(csv, "utf8").toString("base64")
  });
  return {
    batch: {
      id: "batch-mapping",
      previewSummary: {
        headers: parsed.headers,
        rowCount: parsed.rows.length,
        sourceCollection
      }
    },
    records: parsed.rows.map(row => ({
      id: `row:${row.sourceOrdinal}`,
      importBatchId: "batch-mapping",
      sourceCollection,
      sourceOrdinal: row.sourceOrdinal,
      sourceRowNumber: row.sourceRowNumber,
      rawPayload: row.rawPayload,
      rawPayloadSha256: row.rawPayloadSha256,
      disposition: "PENDING"
    }))
  };
}

function field(analysis, targetField) {
  return analysis.mapping.fields.find(item => item.targetField === targetField);
}

test("mapping is deterministic, exact-name first, reviewable, and non-authoritative", () => {
  const staged = evidence([
    "Record ID,Company,business_name,E-mail,Created On,Mystery",
    "p-1,Alias Co,Exact Co,hello@example.com,2026-08-01T10:00:00Z,raw",
    "p-2,Other Alias,Other Exact,,not-a-date,unknown"
  ].join("\n"));

  const first = buildImportAnalysis(staged);
  const second = buildImportAnalysis(structuredClone(staged));
  assert.deepEqual(second, first);

  assert.deepEqual(
    {
      status: first.mapping.status,
      authoritative: first.mapping.authoritative,
      accepted: first.mapping.accepted,
      targetCollection: first.mapping.targetCollection
    },
    {
      status: "DRAFT",
      authoritative: false,
      accepted: false,
      targetCollection: "prospects"
    }
  );
  assert.deepEqual(
    field(first, "business_name").suggestion,
    {
      state: "SUGGESTED_EXACT",
      strategy: "EXACT_TARGET_NAME",
      nonAuthoritative: true,
      accepted: false
    }
  );
  assert.equal(field(first, "business_name").sourceColumn, "business_name");
  assert.equal(field(first, "email").sourceColumn, "E-mail");
  assert.equal(field(first, "email").suggestion.state, "SUGGESTED_ALIAS");
  assert.equal(field(first, "id").sourceColumn, "Record ID");
  assert.equal(field(first, "id").required, true);
  assert.equal(field(first, "website").required, false);
  assert.equal(field(first, "created_at").declaredType, "TIMESTAMP");
  assert.equal(field(first, "created_at").selectedType, "TIMESTAMP");
  assert.equal(field(first, "created_at").inferredType, "MIXED");
  assert.deepEqual(field(first, "created_at").sampleValues[1], {
    sourceOrdinal: 1,
    sourceRowNumber: 3,
    present: true,
    raw: "not-a-date",
    valueKind: "NONNUMERIC"
  });
  assert.deepEqual(first.mapping.unmappedSourceColumns, ["Company", "Mystery"]);
  assert.ok(first.mapping.fields.every(item =>
    Object.hasOwn(item, "sourceColumn")
    && Object.hasOwn(item, "targetField")
    && Object.hasOwn(item, "sampleValues")
    && Object.hasOwn(item, "inferredType")
    && Object.hasOwn(item, "selectedType")
    && Object.hasOwn(item, "required")
    && Object.hasOwn(item, "suggestion")
    && Object.hasOwn(item, "validationIssues")
  ));
});

test("alias ties and source reuse are explicit conflicts rather than silent winners", () => {
  const tied = buildImportAnalysis(evidence([
    "record_id,company-name,company name",
    "p-1,One,Two"
  ].join("\n")));
  assert.equal(field(tied, "business_name").sourceColumn, null);
  assert.equal(field(tied, "business_name").suggestion.state, "CONFLICT");
  assert.deepEqual(
    field(tied, "business_name").validationIssues.map(issue => issue.code),
    ["MAPPING_ALIAS_TIE"]
  );
  assert.deepEqual(
    field(tied, "business_name").validationIssues[0].sourceColumns,
    ["company-name", "company name"]
  );

  assert.throws(
    () => buildImportAnalysis(evidence("id,name\np-1,Acme"), {
      selections: [
        { targetField: "id", sourceColumn: "id", selectedType: "TEXT" },
        { targetField: "business_name", sourceColumn: "id", selectedType: "TEXT" }
      ]
    }),
    error => error instanceof ImportMappingError
      && error.code === "IMPORT_MAPPING_SELECTION_INVALID"
  );
});

test("explicit user selections are representable but remain draft and unaccepted", () => {
  const analysis = buildImportAnalysis(
    evidence("External Key,Trading Name,Email Address\np-1,Acme,a@example.com"),
    {
      selections: [
        { targetField: "id", sourceColumn: "External Key", selectedType: "TEXT" },
        { targetField: "business_name", sourceColumn: "Trading Name", selectedType: "TEXT" },
        { targetField: "email", sourceColumn: null, selectedType: "TEXT" }
      ]
    }
  );

  assert.equal(field(analysis, "id").suggestion.state, "USER_SELECTED");
  assert.equal(field(analysis, "business_name").sourceColumn, "Trading Name");
  assert.equal(field(analysis, "email").sourceColumn, null);
  assert.equal(field(analysis, "email").suggestion.state, "USER_UNMAPPED");
  assert.equal(analysis.mapping.selectionState, "USER_EDITED_DRAFT");
  assert.equal(analysis.mapping.authoritative, false);
  assert.equal(analysis.mapping.accepted, false);
});

test("zero-row evidence retains its declared target and malformed selections fail closed", () => {
  const analysis = buildImportAnalysis(evidence("id,business_name"));
  assert.equal(analysis.mapping.targetCollection, "prospects");
  assert.equal(analysis.mapping.status, "DRAFT");
  assert.equal(analysis.dataHealth.totalRows, 0);
  assert.throws(
    () => buildImportAnalysis(evidence("id\np-1"), { selections: undefined }),
    error => error instanceof ImportMappingError
      && error.code === "IMPORT_MAPPING_SELECTION_INVALID"
  );
  assert.throws(
    () => buildImportAnalysis(evidence("id\np-1"), { selections: null }),
    error => error instanceof ImportMappingError
      && error.code === "IMPORT_MAPPING_SELECTION_INVALID"
  );
  assert.throws(
    () => buildImportAnalysis(evidence("id\np-1"), {
      selections: [{
        targetField: "id",
        sourceColumn: "id",
        selectedType: "TEXT",
        accepted: true
      }]
    }),
    error => error instanceof ImportMappingError
      && error.code === "IMPORT_MAPPING_SELECTION_INVALID"
  );
});

test("analysis fails closed when preview row count does not match fetched staging evidence", () => {
  const staged = evidence("id,business_name\np-1,Acme");
  staged.batch.previewSummary.rowCount = 2;

  assert.throws(
    () => buildImportAnalysis(staged),
    error => error instanceof ImportMappingError
      && error.code === "IMPORT_MAPPING_EVIDENCE_INVALID"
  );
});

test("inferred types describe source samples independently from declared target types", () => {
  const analysis = buildImportAnalysis(evidence([
    "id,business_name,qualification_score,qualification_status",
    "101,2026-08-01T10:00:00Z,high,QUALIFIED"
  ].join("\n")));

  assert.deepEqual(
    ["id", "business_name", "qualification_score", "qualification_status"].map(targetField => ({
      targetField,
      inferredType: field(analysis, targetField).inferredType,
      declaredType: field(analysis, targetField).declaredType
    })),
    [
      { targetField: "id", inferredType: "NUMBER", declaredType: "TEXT" },
      { targetField: "business_name", inferredType: "TIMESTAMP", declaredType: "TEXT" },
      { targetField: "qualification_score", inferredType: "TEXT", declaredType: "NUMBER" },
      { targetField: "qualification_status", inferredType: "TEXT", declaredType: "STATUS" }
    ]
  );
});

test("source identity is mapped separately from canonical target id for coverage and duplicates", () => {
  const analysis = buildImportAnalysis(evidence([
    "id,external id,business_name",
    "canonical-1,source-1,Acme",
    "canonical-2,source-1,Beta",
    "canonical-3,,Gamma",
    "canonical-4,   ,Delta"
  ].join("\n")));

  assert.equal(field(analysis, "id").sourceColumn, "id");
  assert.deepEqual(
    {
      role: analysis.mapping.sourceIdentity.role,
      sourceColumn: analysis.mapping.sourceIdentity.sourceColumn,
      inferredType: analysis.mapping.sourceIdentity.inferredType,
      suggestion: analysis.mapping.sourceIdentity.suggestion
    },
    {
      role: "SOURCE_IDENTITY",
      sourceColumn: "external id",
      inferredType: "TEXT",
      suggestion: {
        state: "SUGGESTED_ALIAS",
        strategy: "ORDERED_ALIAS",
        nonAuthoritative: true,
        accepted: false
      }
    }
  );
  assert.deepEqual(analysis.dataHealth.sourceIdCoverage, {
    coveredRows: 2,
    totalRows: 4,
    percentage: 50
  });
  assert.ok(!analysis.mapping.unmappedSourceColumns.includes("external id"));
  assert.ok(!analysis.dataHealth.unknownUnmappedStatuses.unmappedSourceColumns.includes("external id"));
  assert.ok(analysis.rows[1].errors.some(issue =>
    issue.code === "DUPLICATE_SOURCE_ID"
    && issue.sourceColumn === "external id"
    && issue.rawEvidence.raw === "source-1"
  ));
  assert.ok(!analysis.rows[1].errors.some(issue =>
    issue.code === "DUPLICATE_SOURCE_ID"
    && issue.rawEvidence.raw === "canonical-2"
  ));
});

test("row validation enforces canonical probability, task state, and calendar timestamp constraints", () => {
  const opportunities = buildImportAnalysis(evidence([
    "id,business_name,stage,value,probability,created_at",
    "o-1,Acme,NEW,0,0,2024-02-29T10:00:00Z",
    "o-2,Beta,NEW,100,1,2026-08-01T10:00:00+10:00",
    "o-3,Gamma,NEW,50,-0.01,2026-02-29T10:00:00Z",
    "o-4,Delta,NEW,50,1.01,2026-04-31",
    "o-5,   ,NEW,-1,0.5,2026-08-01"
  ].join("\n"), "opportunities"));

  assert.equal(opportunities.rows[0].valid, true);
  assert.equal(opportunities.rows[1].valid, true);
  assert.ok(opportunities.rows[2].errors.some(issue =>
    issue.code === "PROBABILITY_OUT_OF_RANGE"
    && issue.rawEvidence.raw === "-0.01"
  ));
  assert.ok(opportunities.rows[2].errors.some(issue =>
    issue.code === "TIMESTAMP_INVALID"
    && issue.rawEvidence.raw === "2026-02-29T10:00:00Z"
  ));
  assert.ok(opportunities.rows[3].errors.some(issue =>
    issue.code === "PROBABILITY_OUT_OF_RANGE"
    && issue.rawEvidence.raw === "1.01"
  ));
  assert.ok(opportunities.rows[3].errors.some(issue =>
    issue.code === "TIMESTAMP_INVALID"
    && issue.rawEvidence.raw === "2026-04-31"
  ));
  assert.ok(opportunities.rows[4].errors.some(issue =>
    issue.code === "REQUIRED_VALUE_MISSING"
    && issue.targetField === "business_name"
    && issue.rawEvidence.raw === "   "
  ));
  assert.ok(opportunities.rows[4].errors.some(issue =>
    issue.code === "COMMERCIAL_VALUE_OUT_OF_RANGE"
    && issue.rawEvidence.raw === "-1"
  ));

  const tasks = buildImportAnalysis(evidence([
    "id,opportunity_id,title,status,completed_at",
    "t-1,o-1,Call,OPEN,",
    "t-2,o-1,Follow up,IN_PROGRESS,",
    "t-3,o-1,Close,DONE,",
    "t-4,o-1,Won,COMPLETED,",
    "t-5,o-1,Reopened,OPEN,2026-08-01T10:00:00Z",
    "t-6,o-1,Finished,COMPLETED,2026-08-01T10:00:00Z",
    "t-7,o-1,Bad date,COMPLETED,2026-02-29T10:00:00Z"
  ].join("\n"), "tasks"), {
    selections: [{
      targetField: "completed_at",
      sourceColumn: "completed_at",
      selectedType: "TEXT"
    }]
  });

  assert.equal(tasks.rows[0].valid, true);
  assert.equal(tasks.rows[1].valid, true);
  assert.ok(tasks.rows[2].errors.some(issue => issue.code === "TASK_STATUS_INVALID"));
  assert.ok(tasks.rows[3].errors.some(issue =>
    issue.code === "TASK_COMPLETION_TIMESTAMP_REQUIRED"
  ));
  assert.ok(tasks.rows[4].errors.some(issue =>
    issue.code === "TASK_COMPLETION_TIMESTAMP_INCONSISTENT"
  ));
  assert.equal(tasks.rows[5].valid, true);
  assert.ok(tasks.rows[6].errors.some(issue => issue.code === "TIMESTAMP_INVALID"));
});

test("row validation enforces NUMERIC(20,6) for every mapped canonical numeric", () => {
  const analysis = buildImportAnalysis(evidence([
    "id,business_name,stage,value,probability,qualification_score,weighted_value",
    "o-valid,Valid,QUALIFIED,99999999999999.999999,1,1.25,1000e-2",
    "o-large,Large,QUALIFIED,100000000000000.000000,0.5,99999999999999.999999,10",
    "o-small,Small,QUALIFIED,0.0000001,0.0000001,1.0000001,1e-7"
  ].join("\n"), "opportunities"));

  assert.equal(analysis.rows[0].valid, true);
  assert.deepEqual(
    analysis.rows[1].errors
      .filter(issue => issue.code === "POSTGRES_NUMERIC_UNREPRESENTABLE")
      .map(issue => issue.targetField),
    ["value"]
  );
  assert.deepEqual(
    analysis.rows[2].errors
      .filter(issue => issue.code === "POSTGRES_NUMERIC_UNREPRESENTABLE")
      .map(issue => issue.targetField),
    ["qualification_score", "value", "probability", "weighted_value"]
  );
  assert.equal(
    analysis.rows[1].errors.find(issue =>
      issue.code === "POSTGRES_NUMERIC_UNREPRESENTABLE"
      && issue.targetField === "value"
    ).rawEvidence.raw,
    "100000000000000.000000"
  );
});

test("unmapped required targets make every affected row explicitly blocking", () => {
  const analysis = buildImportAnalysis(evidence("mystery\nvalue"));
  assert.equal(analysis.dataHealth.validRows, 0);
  assert.equal(analysis.dataHealth.rowsWithBlockingErrors, 1);
  assert.deepEqual(
    analysis.rows[0].errors.map(issue => issue.code),
    ["REQUIRED_MAPPING_MISSING", "REQUIRED_MAPPING_MISSING"]
  );
  assert.equal(analysis.rows[0].errors[0].mappingState, "UNMAPPED_REQUIRED_TARGET");
  assert.equal(analysis.rows[0].errors[0].rawEvidence, null);
});

test("row validation preserves raw distinctions and Data Health reconciles all staged rows", () => {
  const rows = [
    "o-1,Acme,PROPOSAL,0,2026-08-01T10:00:00Z,Ada",
    "o-1,Acme,not-a-stage,unknown,not-a-date,",
    ",,NEW,abc,,null"
  ];
  for (let index = 3; index < 105; index += 1) {
    rows.push(`o-${index},Business ${index},NEW,${index},2026-08-01T10:00:00Z,Person ${index}`);
  }
  const analysis = buildImportAnalysis(evidence([
    "source_id,company,deal_stage,amount,created_on,contact",
    ...rows
  ].join("\n"), "opportunities"));

  assert.equal(analysis.rows.length, 100);
  assert.equal(analysis.rowSampleLimit, 100);
  assert.equal(analysis.dataHealth.totalRows, 105);
  assert.equal(analysis.dataHealth.validRows, 103);
  assert.equal(analysis.dataHealth.rowsWithBlockingErrors, 2);
  assert.equal(analysis.dataHealth.duplicateConflictCount, 1);
  assert.deepEqual(analysis.dataHealth.missingValueCounts, {
    business_name: 1,
    contact_name: 2,
    id: 1,
    stage: 0,
    value: 0
  });
  assert.deepEqual(analysis.dataHealth.sourceIdCoverage, {
    coveredRows: 104,
    totalRows: 105,
    percentage: 99.05
  });
  assert.deepEqual(analysis.dataHealth.timestampCoverage, {
    created_at: {
      coveredRows: 103,
      invalidRows: 1,
      missingRows: 1,
      totalRows: 105,
      percentage: 98.1
    },
    updated_at: {
      coveredRows: 0,
      invalidRows: 0,
      missingRows: 105,
      totalRows: 105,
      percentage: 0
    }
  });
  assert.equal(analysis.dataHealth.unknownUnmappedStatuses.unknownValueCount, 2);
  assert.deepEqual(
    analysis.dataHealth.unknownUnmappedStatuses.unmappedTargetFields,
    fieldNames(analysis).filter(name => [
      "prospect_id", "priority", "qualification_score", "probability",
      "weighted_value", "next_action", "updated_at"
    ].includes(name))
  );

  const duplicate = analysis.rows[1];
  assert.equal(duplicate.sourceOrdinal, 1);
  assert.equal(duplicate.sourceRowNumber, 3);
  assert.ok(duplicate.errors.some(issue => issue.code === "DUPLICATE_SOURCE_ID"));
  const timestampIssue = duplicate.errors.find(issue => issue.code === "TIMESTAMP_INVALID");
  assert.deepEqual(timestampIssue.rawEvidence, {
    columnOrdinal: 4,
    present: true,
    raw: "not-a-date",
    valueKind: "NONNUMERIC"
  });
  assert.ok(duplicate.warnings.some(issue =>
    issue.code === "UNKNOWN_VALUE_PRESERVED"
    && issue.rawEvidence.raw === "unknown"
    && issue.rawEvidence.valueKind === "UNKNOWN"
  ));
  const missing = analysis.rows[2];
  assert.ok(missing.errors.some(issue =>
    issue.code === "REQUIRED_VALUE_MISSING"
    && issue.rawEvidence.raw === ""
    && issue.rawEvidence.valueKind === "BLANK"
  ));
  assert.ok(missing.warnings.some(issue =>
    issue.code === "NONNUMERIC_VALUE_PRESERVED"
    && issue.rawEvidence.raw === "abc"
  ));
  assert.ok(missing.warnings.some(issue =>
    issue.code === "UNKNOWN_VALUE_PRESERVED"
    && issue.rawEvidence.raw === "null"
    && issue.rawEvidence.valueKind === "NULL"
  ));
});

test("exact repeated rows and prospect contactability are deterministic", () => {
  const analysis = buildImportAnalysis(evidence([
    "id,business_name,email,phone,website",
    "p-1,Acme,,",
    "p-2,Beta,hello@example.com,,https://beta.example",
    "p-1,Acme,,"
  ].join("\n")));

  assert.equal(analysis.dataHealth.duplicateConflictCount, 1);
  assert.deepEqual(analysis.dataHealth.contactabilityCoverage, {
    coveredRows: 1,
    totalRows: 3,
    percentage: 33.33,
    fields: ["email", "phone", "website"]
  });
  assert.ok(analysis.rows[2].errors.some(issue =>
    issue.code === "EXACT_REPEATED_SOURCE_ROW"
  ));
  assert.equal(analysis.rows[0].errors.length, 0);
});

test("unsupported staged collections are explicit and never treated as accepted mappings", () => {
  const analysis = buildImportAnalysis(evidence(
    "id,status\naction-1,RECOMMENDED",
    "revenue_actions"
  ));
  assert.equal(analysis.mapping.status, "UNSUPPORTED_TARGET");
  assert.equal(analysis.mapping.authoritative, false);
  assert.equal(analysis.mapping.accepted, false);
  assert.deepEqual(analysis.mapping.fields, []);
  assert.equal(analysis.dataHealth.totalRows, 1);
  assert.equal(analysis.dataHealth.rowsWithBlockingErrors, 1);
  assert.equal(analysis.rows[0].errors[0].code, "IMPORT_TARGET_UNSUPPORTED");
  assert.throws(
    () => buildImportAnalysis(evidence(
      "id,status\naction-1,RECOMMENDED",
      "revenue_actions"
    ), { selections: "bad" }),
    error => error instanceof ImportMappingError
      && error.code === "IMPORT_MAPPING_SELECTION_INVALID"
  );
});

function fieldNames(analysis) {
  return analysis.mapping.fields.map(item => item.targetField);
}
