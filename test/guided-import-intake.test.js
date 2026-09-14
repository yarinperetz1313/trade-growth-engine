"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const guidance = import("../web/lib/importGuidance.mjs");
const resume = import("../web/lib/importResume.mjs");

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

test("the browser composes guidance and server reads without local authority", () => {
  const workspace = fs.readFileSync(
    path.join(repositoryRoot, "web/components/ImportWorkspace.jsx"),
    "utf8"
  );
  const app = fs.readFileSync(path.join(repositoryRoot, "web/main.jsx"), "utf8");
  const combined = `${workspace}\n${app}`;

  assert.match(workspace, /Authenticated TGE workspace/);
  assert.match(workspace, /Canonical commit supported/);
  assert.match(workspace, /Preview only/);
  assert.match(workspace, /Download blank CSV template/);
  assert.match(workspace, /getImportCommit/);
  assert.match(workspace, /getImportPreview/);
  assert.match(workspace, /if \(batchId\) setResumeRoute\(batchId\)/);
  assert.match(workspace, /Setup could not be resumed/);
  assert.match(app, /imports\?batch=/);
  assert.doesNotMatch(combined, /localStorage|sessionStorage/);
  assert.doesNotMatch(combined, /tenantId\s*[:=].*window|tenant_id=.*batch/);
});
