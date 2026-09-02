const assert = require("node:assert/strict");
const test = require("node:test");

const fixtures = import("./e2e/fixtures/import-contracts.mjs");
const contracts = import("../web/lib/importContracts.mjs");

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
