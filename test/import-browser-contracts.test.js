const assert = require("node:assert/strict");
const test = require("node:test");
const { parseCsvUpload } = require("../src/imports/csvParser");
const { buildImportAnalysis } = require("../src/imports/importMapping");

const fixtures = import("./e2e/fixtures/import-contracts.mjs");
const contracts = import("../web/lib/importContracts.mjs");
const importFiles = import("../web/lib/importFile.mjs");

test("browser import responses fail closed on malformed and negative 2xx envelopes", async () => {
  const {
    unwrapImportAnalysisResponse,
    unwrapImportCommitResponse,
    unwrapImportPreviewResponse
  } = await contracts;
  const parsers = [
    unwrapImportPreviewResponse,
    unwrapImportAnalysisResponse,
    unwrapImportCommitResponse
  ];

  for (const parse of parsers) {
    for (const body of [null, [], {}, { ok: true }, { ok: false, data: {} }]) {
      assert.throws(
        () => parse(body),
        error => error?.code === "IMPORT_RESPONSE_INVALID"
      );
    }
  }
});

test("browser import response contracts accept only their semantic success result", async () => {
  const {
    analysisFixture,
    committedFixture,
    previewFixture,
    validationFailureFixture
  } = await fixtures;
  const {
    unwrapImportAnalysisResponse,
    unwrapImportCommitResponse,
    unwrapImportPreviewResponse
  } = await contracts;

  assert.deepEqual(
    unwrapImportPreviewResponse({ ok: true, data: previewFixture() }),
    previewFixture()
  );
  assert.deepEqual(
    unwrapImportAnalysisResponse({ ok: true, data: analysisFixture() }),
    analysisFixture()
  );
  assert.deepEqual(
    unwrapImportAnalysisResponse(
      { ok: true, data: analysisFixture({ rowCount: 0 }) },
      {
        headers: previewFixture({ rowCount: 0 }).batch.previewSummary.headers,
        sourceCollection: "opportunities",
        totalRows: 0
      }
    ),
    analysisFixture({ rowCount: 0 })
  );
  assert.deepEqual(
    unwrapImportCommitResponse({ ok: true, data: committedFixture() }),
    committedFixture()
  );
  assert.throws(
    () => unwrapImportPreviewResponse({ ok: true, data: { batch: {}, records: [] } }),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
  assert.throws(
    () => unwrapImportAnalysisResponse({ ok: true, data: { mapping: {}, rows: [], dataHealth: {} } }),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
  assert.throws(
    () => unwrapImportCommitResponse({ ok: true, data: validationFailureFixture() }),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
  assert.throws(
    () => unwrapImportPreviewResponse({ ok: true, data: previewFixture() }, "another-batch"),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
  assert.throws(
    () => unwrapImportCommitResponse({ ok: true, data: committedFixture() }, "another-batch"),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
});

test("source identity is complete only when every analyzed row is covered", async () => {
  const { hasCompleteSourceIdentity } = await contracts;

  assert.equal(hasCompleteSourceIdentity({
    totalRows: 2,
    sourceIdCoverage: { coveredRows: 2, totalRows: 2, percentage: 100 }
  }), true);
  assert.equal(hasCompleteSourceIdentity({
    totalRows: 2,
    sourceIdCoverage: { coveredRows: 1, totalRows: 2, percentage: 50 }
  }), false);
  assert.equal(hasCompleteSourceIdentity({
    totalRows: 2,
    sourceIdCoverage: { coveredRows: 2, totalRows: 1, percentage: 100 }
  }), false);
  assert.equal(hasCompleteSourceIdentity({
    totalRows: 2,
    sourceIdCoverage: { coveredRows: 2, totalRows: 2, percentage: 50 }
  }), false);
  assert.equal(hasCompleteSourceIdentity({ totalRows: 2 }), false);
});

test("only HTTP 404 proves reconciliation absence is safe to retry", async () => {
  const { isConfirmedMissingReconciliation } = await contracts;

  assert.equal(isConfirmedMissingReconciliation({
    status: 404,
    code: "IMPORT_BATCH_UNAVAILABLE"
  }), true);
  assert.equal(isConfirmedMissingReconciliation({
    status: 200,
    code: "IMPORT_BATCH_UNAVAILABLE"
  }), false);
  assert.equal(isConfirmedMissingReconciliation({
    status: 503,
    code: "IMPORT_RECONCILIATION_UNAVAILABLE"
  }), false);
});

test("preview evidence is bounded and internally coherent before rendering", async () => {
  const { previewFixture } = await fixtures;
  const { unwrapImportPreviewResponse } = await contracts;
  const invalidPreviews = [];

  const missingRecord = previewFixture();
  missingRecord.records.pop();
  invalidPreviews.push(missingRecord);

  const wrongCellShape = previewFixture();
  wrongCellShape.records[0].rawPayload.cells.pop();
  invalidPreviews.push(wrongCellShape);

  const unsafeCell = previewFixture();
  unsafeCell.records[0].rawPayload.cells[0] = {
    columnOrdinal: 0,
    present: true,
    raw: "source-1"
  };
  invalidPreviews.push(unsafeCell);

  const wrongBatchLink = previewFixture();
  wrongBatchLink.records[0].importBatchId = "another-batch";
  invalidPreviews.push(wrongBatchLink);

  const wrongCollectionLink = previewFixture();
  wrongCollectionLink.records[0].sourceCollection = "prospects";
  invalidPreviews.push(wrongCollectionLink);

  const outOfOrderRow = previewFixture();
  outOfOrderRow.records[0].sourceOrdinal = 1;
  invalidPreviews.push(outOfOrderRow);

  const incoherentCounts = previewFixture();
  incoherentCounts.batch.previewSummary.valueKindCounts.NONNUMERIC += 1;
  invalidPreviews.push(incoherentCounts);

  const redistributedCounts = previewFixture();
  redistributedCounts.batch.previewSummary.valueKindCounts.NONNUMERIC -= 1;
  redistributedCounts.batch.previewSummary.valueKindCounts.NUMERIC += 1;
  invalidPreviews.push(redistributedCounts);

  const unboundedRows = previewFixture();
  unboundedRows.batch.previewSummary.rowCount = 1001;
  invalidPreviews.push(unboundedRows);

  for (const preview of invalidPreviews) {
    assert.throws(
      () => unwrapImportPreviewResponse({ ok: true, data: preview }),
      error => error?.code === "IMPORT_RESPONSE_INVALID"
    );
  }

  const unsafeWithBatchId = previewFixture();
  unsafeWithBatchId.records[0].rawPayload.cells[0].valueKind = null;
  assert.throws(
    () => unwrapImportPreviewResponse({ ok: true, data: unsafeWithBatchId }),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
      && error?.details?.attemptedId === "browser-batch-1"
  );
});

test("analysis requires coherent totals and non-authoritative draft mapping shapes", async () => {
  const { analysisFixture } = await fixtures;
  const { unwrapImportAnalysisResponse } = await contracts;
  const expectations = {
    batchId: "browser-batch-1",
    headers: previewHeaders(await fixtures),
    previewRecords: (await fixtures).previewFixture().records,
    sourceCollection: "opportunities",
    totalRows: 2
  };
  const invalidAnalyses = [];

  assert.deepEqual(
    unwrapImportAnalysisResponse({ ok: true, data: analysisFixture() }, expectations),
    analysisFixture()
  );

  const incoherentTotals = analysisFixture();
  incoherentTotals.dataHealth.validRows = 1;
  invalidAnalyses.push(incoherentTotals);

  const authoritativeDraft = analysisFixture();
  authoritativeDraft.mapping.authoritative = true;
  invalidAnalyses.push(authoritativeDraft);

  const acceptedSuggestion = analysisFixture();
  acceptedSuggestion.mapping.fields[0].suggestion.accepted = true;
  invalidAnalyses.push(acceptedSuggestion);

  const invalidField = analysisFixture();
  invalidField.mapping.fields[0].sourceColumnOrdinal = 99;
  invalidAnalyses.push(invalidField);

  const missingMappedSamples = analysisFixture();
  missingMappedSamples.mapping.fields[0].sampleValues.pop();
  invalidAnalyses.push(missingMappedSamples);

  const mismatchedMappedSample = analysisFixture();
  mismatchedMappedSample.mapping.fields[0].sampleValues[0].raw = "tampered";
  invalidAnalyses.push(mismatchedMappedSample);

  const outOfRangeIssueEvidence = analysisFixture();
  outOfRangeIssueEvidence.mapping.fields[0].validationIssues = [{
    code: "INVALID_EVIDENCE",
    rawEvidence: {
      columnOrdinal: 63,
      present: true,
      raw: "tampered",
      valueKind: "NONNUMERIC"
    }
  }];
  invalidAnalyses.push(outOfRangeIssueEvidence);

  const wrongTargetCollection = analysisFixture();
  wrongTargetCollection.mapping.targetCollection = "prospects";
  invalidAnalyses.push(wrongTargetCollection);

  const incoherentUnmappedFields = analysisFixture();
  incoherentUnmappedFields.dataHealth.unknownUnmappedStatuses.unmappedTargetFields = [];
  invalidAnalyses.push(incoherentUnmappedFields);

  const missingTimestampCoverage = analysisFixture();
  delete missingTimestampCoverage.dataHealth.timestampCoverage.created_at;
  invalidAnalyses.push(missingTimestampCoverage);

  const incoherentTimestampCoverage = analysisFixture();
  incoherentTimestampCoverage.dataHealth.timestampCoverage.created_at.missingRows = 1;
  invalidAnalyses.push(incoherentTimestampCoverage);

  const contradictoryDuplicateCount = analysisFixture();
  contradictoryDuplicateCount.dataHealth.duplicateConflictCount = 1;
  invalidAnalyses.push(contradictoryDuplicateCount);

  const contradictoryUnknownCount = analysisFixture();
  contradictoryUnknownCount.dataHealth.unknownUnmappedStatuses.unknownValueCount = 3;
  invalidAnalyses.push(contradictoryUnknownCount);

  const contradictoryMissingCount = analysisFixture();
  contradictoryMissingCount.dataHealth.missingValueCounts.business_name = 1;
  invalidAnalyses.push(contradictoryMissingCount);

  const contradictorySourceCoverage = analysisFixture();
  contradictorySourceCoverage.dataHealth.sourceIdCoverage = {
    coveredRows: 1,
    totalRows: 2,
    percentage: 50
  };
  invalidAnalyses.push(contradictorySourceCoverage);

  const contradictoryTimestampEvidence = analysisFixture();
  contradictoryTimestampEvidence.dataHealth.timestampCoverage.created_at = {
    coveredRows: 1,
    invalidRows: 0,
    missingRows: 1,
    totalRows: 2,
    percentage: 50
  };
  invalidAnalyses.push(contradictoryTimestampEvidence);

  const contradictoryPreviewEvidence = analysisFixture();
  contradictoryPreviewEvidence.rows[0].rawPayload.cells[6] = {
    columnOrdinal: 6,
    present: true,
    raw: "changed after preview",
    valueKind: "NONNUMERIC"
  };
  invalidAnalyses.push(contradictoryPreviewEvidence);

  const unsafeRows = analysisFixture();
  unsafeRows.rows[0].warnings = null;
  invalidAnalyses.push(unsafeRows);

  for (const analysis of invalidAnalyses) {
    assert.throws(
      () => unwrapImportAnalysisResponse({ ok: true, data: analysis }, expectations),
      error => error?.code === "IMPORT_RESPONSE_INVALID"
    );
  }
});

test("unsupported staged targets retain a coherent fail-closed analysis envelope", async () => {
  const { analysisFixture } = await fixtures;
  const { unwrapImportAnalysisResponse } = await contracts;
  const unsupported = analysisFixture();
  const headers = previewHeaders(await fixtures);
  unsupported.mapping = {
    status: "UNSUPPORTED_TARGET",
    authoritative: false,
    accepted: false,
    selectionState: "UNAVAILABLE",
    targetCollection: "revenue_actions",
    fields: [],
    unmappedSourceColumns: headers
  };
  unsupported.rows = unsupported.rows.map(row => ({
    ...row,
    sourceCollection: "revenue_actions",
    errors: [{
      code: "IMPORT_TARGET_UNSUPPORTED",
      sourceOrdinal: row.sourceOrdinal,
      sourceRowNumber: row.sourceRowNumber,
      rawEvidence: row.rawPayload
    }],
    warnings: [],
    valid: false
  }));
  unsupported.dataHealth = {
    totalRows: 2,
    validRows: 0,
    rowsWithBlockingErrors: 2,
    duplicateConflictCount: 0,
    missingValueCounts: {},
    unknownUnmappedStatuses: {
      unknownValueCount: 4,
      unmappedTargetFields: [],
      unmappedSourceColumns: headers
    },
    timestampCoverage: {},
    sourceIdCoverage: { coveredRows: 0, totalRows: 2, percentage: 0 }
  };

  assert.deepEqual(
    unwrapImportAnalysisResponse(
      { ok: true, data: unsupported },
      { headers, sourceCollection: "revenue_actions", totalRows: 2 }
    ),
    unsupported
  );

  const incompleteComplement = structuredClone(unsupported);
  incompleteComplement.mapping.unmappedSourceColumns = headers.slice(1);
  incompleteComplement.dataHealth.unknownUnmappedStatuses.unmappedSourceColumns =
    headers.slice(1);
  assert.throws(
    () => unwrapImportAnalysisResponse(
      { ok: true, data: incompleteComplement },
      { headers, sourceCollection: "revenue_actions", totalRows: 2 }
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );

  const falseUnsupported = structuredClone(unsupported);
  falseUnsupported.mapping.targetCollection = "opportunities";
  assert.throws(
    () => unwrapImportAnalysisResponse(
      { ok: true, data: falseUnsupported },
      { headers, sourceCollection: "opportunities", totalRows: 2 }
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );

  unsupported.dataHealth.unknownUnmappedStatuses.unmappedSourceColumns = [];
  assert.throws(
    () => unwrapImportAnalysisResponse(
      { ok: true, data: unsupported },
      { headers, sourceCollection: "revenue_actions", totalRows: 2 }
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
});

test("browser analysis validation accepts the real deterministic mapping response shape", async () => {
  const { unwrapImportAnalysisResponse } = await contracts;
  const parsed = parseCsvUpload({
    contentBase64: Buffer.from([
      "external_id,company,created_at",
      "source-1,Alpha Roofing,2026-08-01T10:00:00Z",
      "source-2,Beta Plumbing,not-a-date"
    ].join("\n"), "utf8").toString("base64")
  });
  const staged = {
    batch: {
      id: "batch-real-analysis",
      previewSummary: {
        headers: parsed.headers,
        rowCount: parsed.rows.length,
        sourceCollection: "prospects"
      }
    },
    records: parsed.rows.map(row => ({
      id: `row:${row.sourceOrdinal}`,
      importBatchId: "batch-real-analysis",
      sourceCollection: "prospects",
      sourceOrdinal: row.sourceOrdinal,
      sourceRowNumber: row.sourceRowNumber,
      rawPayload: row.rawPayload,
      rawPayloadSha256: row.rawPayloadSha256,
      disposition: "PENDING"
    }))
  };
  const analysis = buildImportAnalysis(staged);

  assert.deepEqual(
    unwrapImportAnalysisResponse(
      { ok: true, data: analysis },
      {
        headers: parsed.headers,
        sourceCollection: "prospects",
        totalRows: parsed.rows.length
      }
    ),
    analysis
  );

  const contradictoryContactability = structuredClone(analysis);
  contradictoryContactability.dataHealth.contactabilityCoverage = {
    ...contradictoryContactability.dataHealth.contactabilityCoverage,
    coveredRows: 1,
    percentage: 50
  };
  assert.throws(
    () => unwrapImportAnalysisResponse(
      { ok: true, data: contradictoryContactability },
      {
        headers: parsed.headers,
        previewRecords: staged.records,
        sourceCollection: "prospects",
        totalRows: parsed.rows.length
      }
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
});

test("analysis enforces each collection's complete canonical field contract", async () => {
  const { unwrapImportAnalysisResponse } = await contracts;
  const cases = [
    ["prospects", "external_id,company,email\np-1,Acme,hello@example.com", "service"],
    ["opportunities", "external_id,company,deal_stage,amount\no-1,Acme,PROPOSAL,100", "priority"],
    ["tasks", "external_id,opportunity_id,title,status\nt-1,o-1,Call,OPEN", "description"],
    ["activities", "external_id,opportunity_id,type\na-1,o-1,CALL", "description"]
  ];

  for (const [sourceCollection, csv, removableField] of cases) {
    const { analysis, expectations } = browserAnalysis(csv, sourceCollection);
    assert.deepEqual(
      unwrapImportAnalysisResponse({ ok: true, data: analysis }, expectations),
      analysis
    );

    const omitted = structuredClone(analysis);
    omitted.mapping.fields = omitted.mapping.fields.filter(field => (
      field.targetField !== removableField
    ));
    omitted.dataHealth.unknownUnmappedStatuses.unmappedTargetFields =
      omitted.dataHealth.unknownUnmappedStatuses.unmappedTargetFields.filter(field => (
        field !== removableField
      ));

    const invented = structuredClone(analysis);
    invented.mapping.fields.push({
      targetField: "invented_canonical_field",
      sourceColumn: null,
      sourceColumnOrdinal: null,
      sampleValues: [],
      inferredType: "UNKNOWN",
      declaredType: "TEXT",
      selectedType: "TEXT",
      required: false,
      optional: true,
      suggestion: {
        state: "UNMAPPED",
        strategy: "NO_DETERMINISTIC_MATCH",
        nonAuthoritative: true,
        accepted: false
      },
      validationIssues: []
    });
    invented.dataHealth.unknownUnmappedStatuses.unmappedTargetFields.push(
      "invented_canonical_field"
    );

    const reordered = structuredClone(analysis);
    reordered.mapping.fields.reverse();
    reordered.dataHealth.unknownUnmappedStatuses.unmappedTargetFields =
      reordered.mapping.fields
        .filter(field => field.sourceColumn === null)
        .map(field => field.targetField);

    const wrongType = structuredClone(analysis);
    wrongType.mapping.fields[0].declaredType = "NUMBER";

    const wrongRequiredState = structuredClone(analysis);
    wrongRequiredState.mapping.fields[0].required = false;
    wrongRequiredState.mapping.fields[0].optional = true;

    for (const invalid of [
      omitted,
      invented,
      reordered,
      wrongType,
      wrongRequiredState
    ]) {
      assert.throws(
        () => unwrapImportAnalysisResponse({ ok: true, data: invalid }, expectations),
        error => error?.code === "IMPORT_RESPONSE_INVALID",
        `${sourceCollection} must reject a non-canonical mapping vector`
      );
    }
  }
});

test("analysis requires the exact unmapped source and commercial missing-count complements", async () => {
  const { analysisFixture, previewFixture } = await fixtures;
  const { unwrapImportAnalysisResponse } = await contracts;
  const expectations = {
    headers: previewHeaders(await fixtures),
    previewRecords: previewFixture().records,
    sourceCollection: "opportunities",
    totalRows: 2
  };

  const omittedUnmappedSource = analysisFixture();
  omittedUnmappedSource.mapping.unmappedSourceColumns.shift();
  omittedUnmappedSource.dataHealth.unknownUnmappedStatuses.unmappedSourceColumns.shift();

  const mappedSourceReportedUnmapped = analysisFixture();
  mappedSourceReportedUnmapped.mapping.unmappedSourceColumns.push("company");
  mappedSourceReportedUnmapped.dataHealth.unknownUnmappedStatuses.unmappedSourceColumns.push(
    "company"
  );

  const omittedMissingCount = analysisFixture();
  delete omittedMissingCount.dataHealth.missingValueCounts.value;

  const inventedMissingCount = analysisFixture();
  inventedMissingCount.dataHealth.missingValueCounts.probability = 0;

  for (const invalid of [
    omittedUnmappedSource,
    mappedSourceReportedUnmapped,
    omittedMissingCount,
    inventedMissingCount
  ]) {
    assert.throws(
      () => unwrapImportAnalysisResponse({ ok: true, data: invalid }, expectations),
      error => error?.code === "IMPORT_RESPONSE_INVALID"
    );
  }
});

test("prospect contactability is mandatory, exact, and forbidden for other collections", async () => {
  const { unwrapImportAnalysisResponse } = await contracts;
  const prospects = browserAnalysis(
    "external_id,company,email\np-1,Acme,hello@example.com\np-2,Beta,",
    "prospects"
  );
  const opportunities = browserAnalysis(
    "external_id,company,deal_stage\no-1,Acme,PROPOSAL\no-2,Beta,QUALIFIED",
    "opportunities"
  );

  const omitted = structuredClone(prospects.analysis);
  delete omitted.dataHealth.contactabilityCoverage;

  const wrongOrder = structuredClone(prospects.analysis);
  wrongOrder.dataHealth.contactabilityCoverage.fields = ["website", "phone", "email"];

  const wrongEvidenceVector = structuredClone(prospects.analysis);
  wrongEvidenceVector.dataHealth.contactabilityCoverage = {
    coveredRows: 2,
    totalRows: 2,
    percentage: 100,
    fields: ["business_name"]
  };

  const extraneous = structuredClone(opportunities.analysis);
  extraneous.dataHealth.contactabilityCoverage = {
    coveredRows: 2,
    totalRows: 2,
    percentage: 100,
    fields: ["business_name"]
  };

  for (const invalid of [omitted, wrongOrder, wrongEvidenceVector]) {
    assert.throws(
      () => unwrapImportAnalysisResponse(
        { ok: true, data: invalid },
        prospects.expectations
      ),
      error => error?.code === "IMPORT_RESPONSE_INVALID"
    );
  }
  assert.throws(
    () => unwrapImportAnalysisResponse(
      { ok: true, data: extraneous },
      opportunities.expectations
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
});

test("browser analysis validation respects the 100-row evidence boundary", async () => {
  const { unwrapImportAnalysisResponse } = await contracts;
  const parsed = parseCsvUpload({
    contentBase64: Buffer.from([
      "external_id,company",
      ...Array.from({ length: 105 }, (_, index) => (
        `source-${index + 1},Company ${index + 1}`
      ))
    ].join("\n"), "utf8").toString("base64")
  });
  const staged = {
    batch: {
      id: "batch-capped-analysis",
      previewSummary: {
        headers: parsed.headers,
        rowCount: parsed.rows.length,
        sourceCollection: "prospects"
      }
    },
    records: parsed.rows.map(row => ({
      id: `row:${row.sourceOrdinal}`,
      sourceOrdinal: row.sourceOrdinal,
      sourceRowNumber: row.sourceRowNumber,
      rawPayload: row.rawPayload,
      rawPayloadSha256: row.rawPayloadSha256,
      disposition: "PENDING"
    }))
  };
  const analysis = buildImportAnalysis(staged);

  assert.equal(analysis.rows.length, 100);
  assert.deepEqual(
    unwrapImportAnalysisResponse(
      { ok: true, data: analysis },
      {
        headers: parsed.headers,
        previewRecords: staged.records.slice(0, 100),
        sourceCollection: "prospects",
        totalRows: parsed.rows.length
      }
    ),
    analysis
  );
});

test("committed results reconcile dispositions and the reviewed staged-row total", async () => {
  const { committedFixture } = await fixtures;
  const { unwrapImportCommitResponse } = await contracts;
  const invalidResults = [];

  const allSkipped = committedFixture();
  allSkipped.rows.forEach(row => {
    row.disposition = "EXACT_DUPLICATE";
  });
  allSkipped.summary = { total: 2, committed: 0, skipped: 2, conflicted: 0, failed: 0 };
  assert.deepEqual(
    unwrapImportCommitResponse(
      { ok: true, data: allSkipped },
      "browser-batch-1",
      { totalRows: 2 }
    ),
    allSkipped
  );

  const empty = committedFixture();
  empty.rows = [];
  empty.summary = { total: 0, committed: 0, skipped: 0, conflicted: 0, failed: 0 };
  invalidResults.push(empty);

  const wrongDispositionCount = committedFixture();
  wrongDispositionCount.rows[0].disposition = "EXACT_DUPLICATE";
  invalidResults.push(wrongDispositionCount);

  const invalidDisposition = committedFixture();
  invalidDisposition.rows[0].disposition = "PENDING";
  invalidResults.push(invalidDisposition);

  const duplicateOrdinal = committedFixture();
  duplicateOrdinal.rows[1].sourceOrdinal = 0;
  invalidResults.push(duplicateOrdinal);

  for (const result of invalidResults) {
    assert.throws(
      () => unwrapImportCommitResponse(
        { ok: true, data: result },
        "browser-batch-1",
        { totalRows: 2 }
      ),
      error => error?.code === "IMPORT_RESPONSE_INVALID"
    );
  }

  assert.throws(
    () => unwrapImportCommitResponse(
      { ok: true, data: committedFixture() },
      "browser-batch-1",
      { totalRows: 3 }
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );

  assert.throws(
    () => unwrapImportCommitResponse(
      { ok: true, data: committedFixture() },
      "browser-batch-1",
      { totalRows: 2, reconciled: true }
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
});

test("unusable mutation POST outcomes require reconciliation unless failure is definitive", async () => {
  const { requiresImportPostReconciliation } = await contracts;

  assert.equal(requiresImportPostReconciliation({ code: "IMPORT_RESPONSE_INVALID" }), true);
  assert.equal(requiresImportPostReconciliation({ status: 200, code: "IMPORT_PREVIEW_REJECTED" }), true);
  assert.equal(requiresImportPostReconciliation(new TypeError("fetch failed")), true);
  assert.equal(requiresImportPostReconciliation({ status: 503, code: "SERVICE_UNAVAILABLE" }), true);
  assert.equal(requiresImportPostReconciliation({ status: 400, code: "CSV_MALFORMED" }), false);
  assert.equal(requiresImportPostReconciliation({ status: 413, code: "CSV_FILE_LIMIT_EXCEEDED" }), false);
  assert.equal(requiresImportPostReconciliation({ status: 401, code: "AUTHENTICATION_REQUIRED" }), false);
  assert.equal(requiresImportPostReconciliation({ status: 403, code: "ACCESS_DENIED" }), false);
  assert.equal(requiresImportPostReconciliation({ status: 422, code: "IMPORT_COMMIT_VALIDATION_FAILED" }), false);
  assert.equal(requiresImportPostReconciliation({ status: 409, code: "IMPORT_COMMIT_CONFLICT" }), false);
  assert.equal(requiresImportPostReconciliation({ code: "BROWSER_AUTH_UNAVAILABLE" }), false);
  assert.equal(requiresImportPostReconciliation({ code: "BROWSER_AUTHORITY_INVALID" }), false);
});

test("operation generations reject late responses after reset or a newer import", async () => {
  const { createImportOperationGuard } = await contracts;
  const guard = createImportOperationGuard();
  const first = guard.begin("preview");

  assert.equal(guard.isCurrent(first), true);
  assert.equal(guard.begin("analysis"), null);

  guard.invalidate();
  const second = guard.begin("preview");
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.finish(first), false);
  assert.equal(guard.isCurrent(second), true);
  assert.equal(guard.finish(second), true);
  assert.equal(guard.isPending(), false);
});

test("oversized browser files fail before arrayBuffer while the inclusive server limit is readable", async () => {
  const { IMPORT_CSV_MAX_BYTES, readImportFileAsBase64 } = await importFiles;
  let oversizedReads = 0;
  const oversized = {
    size: IMPORT_CSV_MAX_BYTES + 1,
    async arrayBuffer() {
      oversizedReads += 1;
      throw new Error("oversized file must not be read");
    }
  };

  await assert.rejects(
    readImportFileAsBase64(oversized),
    error => error?.status === 413 && error?.code === "CSV_FILE_LIMIT_EXCEEDED"
  );
  assert.equal(oversizedReads, 0);

  let boundedReads = 0;
  const bounded = {
    size: IMPORT_CSV_MAX_BYTES,
    async arrayBuffer() {
      boundedReads += 1;
      return Uint8Array.from([65, 44, 66]).buffer;
    }
  };
  assert.equal(await readImportFileAsBase64(bounded), "QSxC");
  assert.equal(boundedReads, 1);
});

function previewHeaders(loadedFixtures) {
  return loadedFixtures.previewFixture().batch.previewSummary.headers;
}

function browserAnalysis(csv, sourceCollection) {
  const parsed = parseCsvUpload({
    contentBase64: Buffer.from(csv, "utf8").toString("base64")
  });
  const records = parsed.rows.map(row => ({
    id: `row:${row.sourceOrdinal}`,
    importBatchId: "browser-analysis-batch",
    sourceCollection,
    sourceOrdinal: row.sourceOrdinal,
    sourceRowNumber: row.sourceRowNumber,
    rawPayload: row.rawPayload,
    rawPayloadSha256: row.rawPayloadSha256,
    disposition: "PENDING"
  }));
  const staged = {
    batch: {
      id: "browser-analysis-batch",
      previewSummary: {
        headers: parsed.headers,
        rowCount: records.length,
        sourceCollection
      }
    },
    records
  };
  return {
    analysis: buildImportAnalysis(staged),
    expectations: {
      headers: parsed.headers,
      previewRecords: records,
      sourceCollection,
      totalRows: records.length
    }
  };
}
