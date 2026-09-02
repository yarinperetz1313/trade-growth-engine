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
        rowCount: parsed.rows.length
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
});

function fieldNames(analysis) {
  return analysis.mapping.fields.map(item => item.targetField);
}
