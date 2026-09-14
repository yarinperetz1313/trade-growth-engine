"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const guidance = import("../web/lib/importGuidance.mjs");
const resume = import("../web/lib/importResume.mjs");
const contracts = import("../web/lib/importContracts.mjs");
const fixtures = import("./e2e/fixtures/import-contracts.mjs");
const {
  validateCanonicalCommitInput
} = require("../src/imports/importCommit");

function canonicalCommitInput(sourceSystem) {
  return {
    sourceSystem,
    idempotencyKey: "guided-source-contract-1",
    sourceIdentitySelection: { sourceColumn: "source_id" },
    selections: []
  };
}

test("every displayed import collection has one truthful capability", async () => {
  const { listImportCollectionCapabilities } = await guidance;
  const capabilities = listImportCollectionCapabilities();

  assert.deepEqual(
    capabilities.map(item => [item.collection, item.commitSupported]),
    [
      ["prospects", true],
      ["opportunities", true],
      ["tasks", true],
      ["activities", true],
      ["revenue_actions", false]
    ]
  );
  assert.equal(new Set(capabilities.map(item => item.collection)).size, 5);
  assert.equal(capabilities.at(-1).capabilityLabel, "Preview only");
  assert.equal(capabilities.at(-1).templateFilename, null);
});

test("supported collection templates are inert header-only CSV downloads", async () => {
  const {
    buildImportTemplateDownload,
    listImportCollectionCapabilities
  } = await guidance;

  for (const capability of listImportCollectionCapabilities()) {
    if (!capability.commitSupported) continue;
    const template = buildImportTemplateDownload(capability.collection);
    assert.equal(template.filename, capability.templateFilename);
    assert.equal(template.mediaType, "text/csv;charset=utf-8");
    assert.equal(template.csv.split("\n").filter(Boolean).length, 1);
    assert.deepEqual(
      template.csv.trimEnd().split(","),
      capability.fields.map(field => field.name)
    );
    assert.ok(capability.fields.some(field => field.required));
    assert.match(capability.sourceIdentityGuidance, /source identity/i);
    assert.doesNotMatch(template.csv, /sample|example|acme|\$0/i);
  }

  assert.throws(
    () => buildImportTemplateDownload("revenue_actions"),
    error => error?.code === "IMPORT_TEMPLATE_UNAVAILABLE"
  );
});

test("template and field guidance preserves exact opportunity currency truth", async () => {
  const { getImportCollectionCapability } = await guidance;
  const opportunities = getImportCollectionCapability("opportunities");
  const currency = opportunities.fields.find(field => field.name === "currency");
  const value = opportunities.fields.find(field => field.name === "value");

  assert.equal(currency.required, false);
  assert.match(currency.guidance, /uppercase three-letter/);
  assert.match(currency.guidance, /missing remains unknown/i);
  assert.match(value.guidance, /missing remains unknown/i);
  assert.doesNotMatch(`${currency.guidance} ${value.guidance}`, /default|infer from locale/i);
});

test("guided source namespace rejects human labels before the canonical commit boundary", async () => {
  const {
    IMPORT_SOURCE_SYSTEM_EXAMPLE,
    validateImportSourceSystem
  } = await guidance;

  assert.equal(IMPORT_SOURCE_SYSTEM_EXAMPLE, "quarterly-crm-export");
  assert.throws(
    () => validateCanonicalCommitInput(canonicalCommitInput("Quarterly CRM export")),
    error => error?.code === "IMPORT_COMMIT_REQUEST_INVALID"
  );
  assert.doesNotThrow(() => (
    validateCanonicalCommitInput(canonicalCommitInput(IMPORT_SOURCE_SYSTEM_EXAMPLE))
  ));

  for (const [value, expectedValid] of [
    ["", false],
    ["Quarterly CRM export", false],
    ["-quarterly-crm", false],
    ["quarterly/crm", false],
    ["a".repeat(128), true],
    ["a".repeat(129), false],
    ["quarterly-crm-export", true],
    ["CRM:au_q3.2026", true]
  ]) {
    const result = validateImportSourceSystem(value);
    assert.equal(result.valid, expectedValid, value || "blank");
    if (expectedValid) {
      assert.equal(result.message, null);
      assert.doesNotThrow(() => validateCanonicalCommitInput(canonicalCommitInput(value)));
    } else {
      assert.match(result.message, /1–128|letter or number|letters, numbers|source namespace/i);
      assert.throws(
        () => validateCanonicalCommitInput(canonicalCommitInput(value)),
        error => error?.code === "IMPORT_COMMIT_REQUEST_INVALID"
      );
    }
  }
});

test("resume deep links carry only a bounded batch pointer", async () => {
  const {
    importResumeHash,
    parseImportResumeHash
  } = await resume;

  assert.equal(
    importResumeHash("batch/with spaces"),
    "imports?batch=batch%2Fwith+spaces"
  );
  assert.deepEqual(parseImportResumeHash("#imports?batch=batch%2Fwith+spaces"), {
    kind: "BATCH",
    batchId: "batch/with spaces"
  });
  assert.deepEqual(parseImportResumeHash("#imports"), {
    kind: "NONE",
    batchId: null
  });
  for (const hash of [
    "#imports?batch=",
    `#imports?batch=${"x".repeat(201)}`,
    "#imports?batch=%00tenant-secret",
    "#imports?batch=batch-1&tenant_id=client-selected",
    "#opportunities?batch=batch-1"
  ]) {
    assert.deepEqual(parseImportResumeHash(hash), {
      kind: "INVALID",
      batchId: null
    });
  }
});

test("expired and cleaned preview responses retain authoritative restart truth", async () => {
  const { unwrapImportPreviewResponse } = await contracts;
  const { cleanedPreviewFixture, previewFixture } = await fixtures;

  for (const [cleanup, expectedCode] of [
    [{
      state: "PENDING",
      due: true,
      attempts: 0,
      retryable: false
    }, "IMPORT_RAW_EVIDENCE_EXPIRED"],
    [null, "IMPORT_RAW_EVIDENCE_CLEANED"]
  ]) {
    const preview = cleanup === null
      ? cleanedPreviewFixture()
      : previewFixture();
    if (cleanup !== null) {
      preview.batch.rawExpiresAt = "2026-09-14T00:00:00.000Z";
      preview.batch.rawCleanup = cleanup;
      preview.records = [];
    }

    assert.throws(
      () => unwrapImportPreviewResponse(
        { ok: true, data: preview },
        "browser-batch-1"
      ),
      error => error?.code === expectedCode
        && error?.status === 200
        && error?.details?.attemptedId === "browser-batch-1"
    );
  }
});

test("migration-015 minimized committed results preserve authoritative continuation truth", async () => {
  const { unwrapImportCommitResponse } = await contracts;
  const { cleanedCommittedFixture } = await fixtures;
  const committed = cleanedCommittedFixture();

  assert.deepEqual(
    unwrapImportCommitResponse(
      { ok: true, data: committed },
      "browser-batch-1"
    ),
    committed
  );

  assert.throws(
    () => unwrapImportCommitResponse(
      { ok: true, data: committed },
      "another-tenant-batch"
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );

  for (const mutate of [
    value => { delete value.rawEvidenceAvailable; },
    value => { value.batch.previewSummary.rawEvidenceAvailable = true; },
    value => { value.summary.total = 3; }
  ]) {
    const malformed = cleanedCommittedFixture();
    mutate(malformed);
    assert.throws(
      () => unwrapImportCommitResponse(
        { ok: true, data: malformed },
        "browser-batch-1"
      ),
      error => error?.code === "IMPORT_RESPONSE_INVALID"
    );
  }
});

test("terminal lifecycle classification stays strict and tenant-neutral", async () => {
  const { unwrapImportPreviewResponse } = await contracts;
  const { cleanedPreviewFixture, previewFixture } = await fixtures;
  const malformed = previewFixture();
  malformed.batch.rawExpiresAt = "not-a-timestamp";
  malformed.batch.rawCleanup = {
    state: "SUCCEEDED",
    due: true,
    attempts: 1,
    retryable: false
  };
  malformed.records = [];

  assert.throws(
    () => unwrapImportPreviewResponse(
      { ok: true, data: malformed },
      "browser-batch-1"
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );
  assert.throws(
    () => unwrapImportPreviewResponse(
      { ok: true, data: {
        ...malformed,
        batch: { ...malformed.batch, rawExpiresAt: "2026-09-14T00:00:00.000Z" }
      } },
      "another-tenant-batch"
    ),
    error => error?.code === "IMPORT_RESPONSE_INVALID"
  );

  for (const mutate of [
    value => { value.batch.status = "PREVIEWED"; },
    value => { value.batch.previewSummary.rawEvidenceAvailable = true; },
    value => { value.batch.previewSummary.headers = ["deleted_raw_header"]; }
  ]) {
    const cleaned = cleanedPreviewFixture();
    mutate(cleaned);
    assert.throws(
      () => unwrapImportPreviewResponse(
        { ok: true, data: cleaned },
        "browser-batch-1"
      ),
      error => error?.code === "IMPORT_RESPONSE_INVALID"
    );
  }
});

test("the browser composes guidance and server reads without local authority or unsupported auth claims", () => {
  const workspace = fs.readFileSync(
    path.join(repositoryRoot, "web/components/ImportWorkspace.jsx"),
    "utf8"
  );
  const app = fs.readFileSync(path.join(repositoryRoot, "web/main.jsx"), "utf8");
  const combined = `${workspace}\n${app}`;

  assert.match(workspace, /TGE import workspace/);
  assert.doesNotMatch(workspace, /Authenticated TGE workspace/);
  assert.match(workspace, /Canonical commit supported/);
  assert.match(workspace, /Preview only/);
  assert.match(workspace, /Download blank CSV template/);
  assert.match(workspace, /getImportCommit/);
  assert.match(workspace, /getImportPreview/);
  assert.match(workspace, /if \(batchId\) setResumeRoute\(batchId\)/);
  assert.match(workspace, /Setup could not be resumed/);
  assert.match(workspace, /IMPORT_RAW_EVIDENCE_EXPIRED/);
  assert.match(workspace, /IMPORT_RAW_EVIDENCE_CLEANED/);
  assert.match(app, /imports\?batch=/);
  assert.doesNotMatch(combined, /localStorage|sessionStorage/);
  assert.doesNotMatch(combined, /tenantId\s*[:=].*window|tenant_id=.*batch/);
});
