export const adversarialCsv = [
  "external_id,company,deal_stage,amount,quoted value,probability,note,null_literal,optional_trailing",
  "source-1,Alpha Roofing,QUALIFIED,0,1250.50,0,unknown,null,",
  "source-2,Beta Plumbing,PROPOSAL,unknown,2500,0.5,=2+2,n/a"
].join("\n");

const headers = [
  "external_id",
  "company",
  "deal_stage",
  "amount",
  "quoted value",
  "probability",
  "note",
  "null_literal",
  "optional_trailing"
];

const cells = [
  [
    cell("source-1", "NONNUMERIC"),
    cell("Alpha Roofing", "NONNUMERIC"),
    cell("QUALIFIED", "NONNUMERIC"),
    cell("0", "KNOWN_ZERO"),
    cell("1250.50", "NUMERIC"),
    cell("0", "KNOWN_ZERO"),
    cell("unknown", "UNKNOWN"),
    cell("null", "NULL"),
    cell("", "BLANK")
  ],
  [
    cell("source-2", "NONNUMERIC"),
    cell("Beta Plumbing", "NONNUMERIC"),
    cell("PROPOSAL", "NONNUMERIC"),
    cell("unknown", "UNKNOWN"),
    cell("2500", "NUMERIC"),
    cell("0.5", "NUMERIC"),
    cell("=2+2", "NONNUMERIC"),
    cell("n/a", "UNKNOWN"),
    { present: false, raw: null, valueKind: "MISSING" }
  ]
].map(row => row.map((evidence, columnOrdinal) => ({
  columnOrdinal,
  ...evidence
})));

export function previewFixture({ rowCount = 2 } = {}) {
  const records = cells.slice(0, rowCount).map((rowCells, sourceOrdinal) => {
    const rawPayloadSha256 = String(sourceOrdinal + 1).repeat(64);
    return {
      id: `row:${sourceOrdinal}`,
      importBatchId: "browser-batch-1",
      sourceCollection: "opportunities",
      sourceId: `csv-row:${sourceOrdinal}:${rawPayloadSha256}`,
      sourceOrdinal,
      sourceRowNumber: sourceOrdinal + 2,
      rawPayload: {
        sourceRowNumber: sourceOrdinal + 2,
        cells: rowCells
      },
      rawPayloadSha256,
      disposition: "PENDING"
    };
  });

  return {
    batch: {
      id: "browser-batch-1",
      status: "PREVIEWED",
      sourceFilename: "adversarial-opportunities.csv",
      sourceSha256: "f".repeat(64),
      previewSummary: {
        format: "CSV",
        sourceCollection: "opportunities",
        byteCount: rowCount === 0 ? headers.join(",").length : adversarialCsv.length,
        rowCount,
        columnCount: headers.length,
        headers,
        reportedMediaType: "text/csv",
        valueKindCounts: rowCount === 0
          ? {}
          : {
              BLANK: 1,
              KNOWN_ZERO: 2,
              MISSING: 1,
              NONNUMERIC: 7,
              NULL: 1,
              NUMERIC: 3,
              UNKNOWN: 3
            }
      }
    },
    records
  };
}

export function analysisFixture({ valueColumn = "amount", rowCount = 2 } = {}) {
  const fieldDefinitions = [
    ["id", "external_id", "TEXT", true],
    ["prospect_id", null, "TEXT", false],
    ["business_name", "company", "TEXT", true],
    ["stage", "deal_stage", "STATUS", true],
    ["priority", null, "STATUS", false],
    ["qualification_score", null, "NUMBER", false],
    ["value", valueColumn, "NUMBER", false],
    ["probability", "probability", "NUMBER", false],
    ["weighted_value", null, "NUMBER", false],
    ["next_action", null, "TEXT", false],
    ["contact_name", null, "TEXT", false],
    ["created_at", null, "TIMESTAMP", false],
    ["updated_at", null, "TIMESTAMP", false]
  ];
  const fields = fieldDefinitions.map(([targetField, sourceColumn, declaredType, required]) => ({
    targetField,
    sourceColumn,
    sourceColumnOrdinal: sourceColumn === null ? null : headers.indexOf(sourceColumn),
    sampleValues: sourceColumn === null
      ? []
      : cells.slice(0, rowCount).map((rowCells, sourceOrdinal) => ({
          sourceOrdinal,
          sourceRowNumber: sourceOrdinal + 2,
          present: rowCells[headers.indexOf(sourceColumn)].present,
          raw: rowCells[headers.indexOf(sourceColumn)].raw,
          valueKind: rowCells[headers.indexOf(sourceColumn)].valueKind
        })),
    inferredType: declaredType === "NUMBER" ? "NUMBER" : "TEXT",
    declaredType,
    selectedType: declaredType,
    required,
    optional: !required,
    suggestion: {
      state: valueColumn === "quoted value" ? "USER_SELECTED" : sourceColumn ? "SUGGESTED_ALIAS" : "UNMAPPED",
      strategy: valueColumn === "quoted value" ? "USER_SELECTION" : sourceColumn ? "ORDERED_ALIAS" : "NO_DETERMINISTIC_MATCH",
      nonAuthoritative: true,
      accepted: false
    },
    validationIssues: []
  }));

  return {
    mapping: {
      status: "DRAFT",
      authoritative: false,
      accepted: false,
      selectionState: valueColumn === "quoted value" ? "USER_EDITED_DRAFT" : "SUGGESTED_DRAFT",
      targetCollection: "opportunities",
      sourceIdentity: {
        role: "SOURCE_IDENTITY",
        sourceField: "source_id",
        sourceColumn: "external_id",
        sourceColumnOrdinal: 0,
        sampleValues: cells.slice(0, rowCount).map((rowCells, sourceOrdinal) => ({
          sourceOrdinal,
          sourceRowNumber: sourceOrdinal + 2,
          present: rowCells[0].present,
          raw: rowCells[0].raw,
          valueKind: rowCells[0].valueKind
        })),
        inferredType: "TEXT",
        identityType: "TEXT",
        required: true,
        suggestion: {
          state: "SUGGESTED_ALIAS",
          strategy: "ORDERED_ALIAS",
          nonAuthoritative: true,
          accepted: false
        },
        validationIssues: []
      },
      fields,
      unmappedSourceColumns: ["note", "null_literal", "optional_trailing", valueColumn === "amount" ? "quoted value" : "amount"]
    },
    rows: previewFixture({ rowCount }).records.map(record => ({
      ...record,
      errors: [],
      warnings: valueColumn === "amount" && record.sourceOrdinal === 1
        ? [{
            code: "UNKNOWN_VALUE_PRESERVED",
            targetField: "value",
            sourceColumn: "amount",
            sourceOrdinal: 1,
            sourceRowNumber: 3,
            rawEvidence: record.rawPayload.cells[3]
          }]
        : [],
      valid: true
    })),
    rowSampleLimit: 100,
    dataHealth: {
      totalRows: rowCount,
      validRows: rowCount,
      rowsWithBlockingErrors: 0,
      duplicateConflictCount: 0,
      missingValueCounts: {
        business_name: 0,
        contact_name: rowCount,
        id: 0,
        stage: 0,
        value: 0
      },
      unknownUnmappedStatuses: {
        unknownValueCount: rowCount === 0 ? 0 : 4,
        unmappedTargetFields: fields.filter(field => field.sourceColumn === null).map(field => field.targetField),
        unmappedSourceColumns: ["note", "null_literal", "optional_trailing", valueColumn === "amount" ? "quoted value" : "amount"]
      },
      timestampCoverage: {
        created_at: { coveredRows: 0, invalidRows: 0, missingRows: rowCount, totalRows: rowCount, percentage: 0 },
        updated_at: { coveredRows: 0, invalidRows: 0, missingRows: rowCount, totalRows: rowCount, percentage: 0 }
      },
      sourceIdCoverage: { coveredRows: rowCount, totalRows: rowCount, percentage: rowCount === 0 ? 0 : 100 }
    }
  };
}

export function committedFixture({ reconciled = false } = {}) {
  return {
    outcome: "COMMITTED",
    batch: { id: "browser-batch-1", status: "COMMITTED" },
    rows: [
      {
        sourceOrdinal: 0,
        sourceRowNumber: 2,
        sourceRecordId: "source-1",
        targetId: "source-1",
        canonicalPayloadSha256: "a".repeat(64),
        disposition: "COMMITTED"
      },
      {
        sourceOrdinal: 1,
        sourceRowNumber: 3,
        sourceRecordId: "source-2",
        targetId: "source-2",
        canonicalPayloadSha256: "b".repeat(64),
        disposition: "COMMITTED"
      }
    ],
    summary: { total: 2, committed: 2, skipped: 0, conflicted: 0, failed: 0 },
    reconciled
  };
}

export function conflictFixture() {
  return {
    outcome: "CONFLICTED",
    batch: { id: "browser-batch-1", status: "PREVIEWED" },
    rows: [
      { sourceOrdinal: 0, disposition: "CONFLICTED" },
      { sourceOrdinal: 1, disposition: "CONFLICTED" }
    ],
    summary: { total: 2, committed: 0, skipped: 0, conflicted: 2, failed: 0 },
    conflicts: [{
      code: "SOURCE_IDENTITY_PAYLOAD_CONFLICT",
      sourceRecordId: "source-2",
      sourceOrdinals: [0, 1]
    }],
    failures: [],
    reconciled: false
  };
}

export function validationFailureFixture() {
  return {
    outcome: "FAILED",
    batch: { id: "browser-batch-1", status: "PREVIEWED" },
    rows: [
      { sourceOrdinal: 0, disposition: "FAILED" },
      { sourceOrdinal: 1, disposition: "FAILED" }
    ],
    summary: { total: 2, committed: 0, skipped: 0, conflicted: 0, failed: 2 },
    conflicts: [],
    failures: [{
      code: "CANONICAL_ROW_VALIDATION_FAILED",
      sourceOrdinal: 1,
      validationErrors: [{
        code: "SOURCE_IDENTITY_UNKNOWN",
        identityRole: "SOURCE_IDENTITY",
        sourceOrdinal: 1
      }]
    }],
    reconciled: false
  };
}

function cell(raw, valueKind) {
  return { present: true, raw, valueKind };
}
