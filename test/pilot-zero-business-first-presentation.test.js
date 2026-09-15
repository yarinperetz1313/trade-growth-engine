"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const journeyContracts = import("../web/lib/firstValueJourney.mjs");

function source(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("opportunity exports are the explicit first-run business path", () => {
  const workspace = source("web/components/ImportWorkspace.jsx");

  assert.match(workspace, /useState\("opportunities"\)/);
  assert.match(workspace, /Find a revenue problem in your sales pipeline/);
  assert.match(workspace, /Start with an opportunity export/);
  assert.match(workspace, /Other supported business data/);
  assert.match(workspace, /Required to continue/);
  assert.match(workspace, /Exact mapping evidence/);
});

test("customer and demo cases are partitioned without changing server order", async () => {
  const { partitionCredibleCases } = await journeyContracts;
  const customerA = { case: { id: "customer-a" }, data_origin: "IMPORTED_CUSTOMER" };
  const demoA = { case: { id: "demo-a" }, data_origin: "SAMPLE_DEMO" };
  const customerB = { case: { id: "customer-b" }, data_origin: "EXISTING_CUSTOMER" };
  const demoB = { case: { id: "demo-b" }, data_origin: "SAMPLE_DEMO" };

  assert.deepEqual(
    partitionCredibleCases([demoA, customerA, demoB, customerB]),
    {
      customerEntries: [customerA, customerB],
      demoEntries: [demoA, demoB]
    }
  );
});

test("readiness leads an explicit calm three-step scan and customer review", () => {
  const commandCenter = source("web/components/RevenueCommandCenter.jsx");
  const readinessAt = commandCenter.indexOf("<OperationalDataHealth");
  const scanAt = commandCenter.indexOf("<ScanAction");

  assert.ok(readinessAt >= 0 && scanAt > readinessAt);
  assert.match(commandCenter, /How TGE gets to a safe action/);
  assert.match(commandCenter, /Check your data/);
  assert.match(commandCenter, /Scan when ready/);
  assert.match(commandCenter, /Review the strongest case/);
  assert.match(commandCenter, /Priority customer review/);
  assert.match(commandCenter, /Demo and sample cases/);
  assert.match(commandCenter, /Operator diagnostics/);
  assert.doesNotMatch(commandCenter, /DATA → TRUTH → MONEY → PROBLEM → WHY → ACTION/);
});

test("the action surface communicates the safe sequence and truthful task result", () => {
  const opportunity = source("web/components/OpportunityCommandCenter.jsx");

  assert.match(opportunity, /Review → Approve → Create internal task/);
  assert.match(opportunity, /data-testid="internal-task-completion"/);
  assert.match(opportunity, /Internal task created/);
  assert.match(opportunity, /No message was sent/);
  assert.match(opportunity, /does not claim recovered revenue, attribution, or return on investment/i);
});
