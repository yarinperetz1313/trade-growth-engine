"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "tge-revenue-leak-handoff-")
);
process.env.LOCAL_STORE_DIR = tempDir;

const { app } = require("../src/app/server");
const { createPersistence } = require("../src/persistence/createPersistence");
const { createTenantContext } = require("../src/persistence/tenantContext");
const legacyRevenueActionService = require(
  "../src/revenueActions/revenueActionService"
);
const {
  LOCAL_REVENUE_LEAK_TENANT_ID
} = require("../src/revenueLeakCases/jsonRevenueLeakCaseRepository");
const {
  createRevenueLeakCaseService
} = require("../src/revenueLeakCases/revenueLeakCaseService");
const {
  readCollection,
  writeCollection
} = require("../src/services/localStore");

const FIXED_NOW = "2026-09-08T00:00:00.000Z";
const DAY_MS = 86400000;

function isoDaysBefore(days) {
  return new Date(Date.parse(FIXED_NOW) - days * DAY_MS).toISOString();
}

function seedEligibleOpportunity() {
  writeCollection("prospects", []);
  writeCollection("opportunities", [{
    id: "opp-handoff",
    business_name: "Handoff Roofing",
    contact_name: "Jordan Lee",
    service: "Commercial Roofing",
    location: "Melbourne",
    stage: "PROPOSAL",
    next_action: "",
    value: "42000.500000",
    currency: "AUD",
    created_at: isoDaysBefore(60),
    updated_at: isoDaysBefore(1)
  }]);
  writeCollection("activities", [{
    id: "activity-handoff",
    opportunity_id: "opp-handoff",
    type: "FOLLOW_UP_RECORDED",
    description: "Recorded source activity",
    created_at: isoDaysBefore(21),
    updated_at: isoDaysBefore(21)
  }]);
  writeCollection("tasks", []);
  writeCollection("revenue_actions", []);
  writeCollection("revenue_leak_cases", []);
}

function localContext() {
  return createTenantContext({
    tenantId: LOCAL_REVENUE_LEAK_TENANT_ID,
    subjectId: "handoff-operator"
  });
}

function localService(options = {}) {
  let caseSequence = 0;
  let actionSequence = 0;
  return createRevenueLeakCaseService({
    persistence: createPersistence({ adapter: "json" }),
    revenueActionAuthority: legacyRevenueActionService,
    createId: () => `handoff-case-${++caseSequence}`,
    createRevenueActionId: () => `handoff-action-${++actionSequence}`,
    clock: () => new Date(FIXED_NOW),
    ...options
  }).forTenant(localContext());
}

async function withServer(serverApp, operation) {
  const server = serverApp.listen(0);
  try {
    await new Promise(resolve => server.once("listening", resolve));
    await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

async function createDetectedCase(service = localService()) {
  const scan = await service.scanStalledOpportunities();
  assert.equal(scan.ok, true);
  assert.equal(scan.summary.reconciliation.detected_count, 1);
  return readCollection("revenue_leak_cases")[0];
}

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("case handoff composes one existing RevenueAction and one immutable link", async () => {
  seedEligibleOpportunity();
  const detected = await createDetectedCase();

  await withServer(app, async baseUrl => {
    const first = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${detected.id}/revenue-action`,
      {}
    );
    assert.equal(first.status, 201);
    assert.equal(first.data.ok, true);
    assert.deepEqual(first.data.handoff, {
      action_created: true,
      action_reused: false,
      link_created: true,
      reconciled: false
    });
    assert.equal(first.data.data.case.id, detected.id);
    assert.equal(first.data.data.case.state, "OPEN");
    assert.equal(first.data.data.revenue_action.action_type, "CREATE_TASK");
    assert.equal(first.data.data.revenue_action.status, "RECOMMENDED");
    assert.equal(
      first.data.data.case.revenue_action_id,
      first.data.data.revenue_action.id
    );
    assert.equal(
      first.data.data.case.audit.at(-1).transition,
      "REVENUE_ACTION_LINKED"
    );
    assert.equal(readCollection("revenue_actions").length, 1);

    const prepared = await request(
      baseUrl,
      "POST",
      `/api/revenue-actions/${first.data.data.revenue_action.id}/prepare`,
      {}
    );
    assert.equal(prepared.status, 200);
    assert.equal(prepared.data.data.status, "PREPARED");

    const replay = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${detected.id}/revenue-action`,
      {}
    );
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.data.handoff, {
      action_created: false,
      action_reused: true,
      link_created: false,
      reconciled: true
    });
    assert.equal(
      replay.data.data.revenue_action.id,
      first.data.data.revenue_action.id
    );
    assert.equal(replay.data.data.revenue_action.status, "PREPARED");
    assert.equal(readCollection("revenue_actions").length, 1);
    assert.equal(
      readCollection("revenue_leak_cases")[0].audit.filter(
        entry => entry.transition === "REVENUE_ACTION_LINKED"
      ).length,
      1
    );
  });
});

test("JSON retry repairs an action-only partial write without duplicating the action", async () => {
  seedEligibleOpportunity();
  const firstService = localService({
    async handoffCheckpoint(name) {
      if (name === "afterRevenueActionMaterialized") {
        throw new Error("simulated response-path interruption");
      }
    }
  });
  const detected = await createDetectedCase(firstService);

  await assert.rejects(
    firstService.createRevenueActionForCase(detected.id),
    /simulated response-path interruption/
  );
  assert.equal(readCollection("revenue_actions").length, 1);
  assert.equal(readCollection("revenue_leak_cases")[0].revenue_action_id, null);

  const restartedService = localService();
  const recovered = await restartedService.createRevenueActionForCase(detected.id);
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.handoff, {
    action_created: false,
    action_reused: true,
    link_created: true,
    reconciled: true
  });
  assert.equal(readCollection("revenue_actions").length, 1);
  assert.equal(
    readCollection("revenue_leak_cases")[0].revenue_action_id,
    readCollection("revenue_actions")[0].id
  );
});

test("handoff rejects stale current evidence before creating any RevenueAction", async () => {
  seedEligibleOpportunity();
  const service = localService();
  const detected = await createDetectedCase(service);
  writeCollection("opportunities", [{
    ...readCollection("opportunities")[0],
    next_action: "Customer meeting booked",
    updated_at: FIXED_NOW
  }]);

  const result = await service.createRevenueActionForCase(detected.id);
  assert.equal(result.ok, false);
  assert.equal(result.error, "REVENUE_LEAK_CASE_STALE");
  assert.equal(result.statusCode, 409);
  assert.deepEqual(readCollection("revenue_actions"), []);
  assert.equal(readCollection("revenue_leak_cases")[0].revenue_action_id, null);
});

test("handoff fails closed when RevenueAction authority returns incompatible semantics", async () => {
  seedEligibleOpportunity();
  const service = localService({
    revenueActionAuthority: {
      async materializeRevenueAction(opportunityId) {
        return {
          ok: true,
          created: true,
          duplicate: false,
          data: {
            id: "incompatible-action",
            opportunity_id: opportunityId,
            action_type: "FOLLOW_UP",
            basis_fingerprint: "a".repeat(64),
            status: "RECOMMENDED"
          }
        };
      },
      async getRevenueAction() {
        return null;
      }
    }
  });
  const detected = await createDetectedCase(service);

  const result = await service.createRevenueActionForCase(detected.id);
  assert.equal(result.ok, false);
  assert.equal(result.error, "REVENUE_LEAK_CASE_ACTION_INCOMPATIBLE");
  assert.equal(result.statusCode, 409);
  assert.equal(readCollection("revenue_leak_cases")[0].revenue_action_id, null);
});

test("handoff accepts only an empty command and keeps missing cases non-oracular", async () => {
  seedEligibleOpportunity();
  const detected = await createDetectedCase();

  await withServer(app, async baseUrl => {
    const override = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${detected.id}/revenue-action`,
      { opportunity_id: "attacker", action_type: "FOLLOW_UP" }
    );
    assert.equal(override.status, 400);
    assert.equal(override.data.error, "REVENUE_LEAK_ACTION_HANDOFF_REQUEST_INVALID");

    const queryOverride = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${detected.id}/revenue-action?tenant_id=attacker`,
      {}
    );
    assert.equal(queryOverride.status, 400);
    assert.equal(
      queryOverride.data.error,
      "REVENUE_LEAK_ACTION_HANDOFF_REQUEST_INVALID"
    );

    for (const id of ["missing-case", "cross-tenant-placeholder"]) {
      const missing = await request(
        baseUrl,
        "POST",
        `/api/revenue-leak-cases/${id}/revenue-action`,
        {}
      );
      assert.equal(missing.status, 404);
      assert.equal(missing.data.error, "REVENUE_LEAK_CASE_NOT_FOUND");
      assert.equal(missing.data.message, "Revenue leak case was not found.");
    }
    assert.deepEqual(readCollection("revenue_actions"), []);
  });
});
