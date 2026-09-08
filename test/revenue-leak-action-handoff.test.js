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

function replaceOpportunity(changes) {
  writeCollection("opportunities", [{
    ...readCollection("opportunities")[0],
    ...changes
  }]);
}

function readStoreFile(collection) {
  return fs.readFileSync(path.join(tempDir, `${collection}.json`), "utf8");
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

for (const [literal, expectedActionType] of [
  ["unknown", "CREATE_TASK"],
  ["n/a", "FOLLOW_UP"],
  ["na", "FOLLOW_UP"],
  ["not known", "FOLLOW_UP"]
]) {
  test(`handoff preflights detector missing literal ${literal} before mutation`, async () => {
    seedEligibleOpportunity();
    replaceOpportunity({ next_action: literal });
    let materializeCalls = 0;
    const service = localService({
      revenueActionAuthority: {
        async materializeRevenueAction(opportunityId) {
          materializeCalls += 1;
          return legacyRevenueActionService.materializeRevenueAction(opportunityId);
        },
        getRevenueAction: legacyRevenueActionService.getRevenueAction
      }
    });
    const detected = await createDetectedCase(service);

    const result = await service.createRevenueActionForCase(detected.id);

    if (expectedActionType === "CREATE_TASK") {
      assert.equal(result.ok, true);
      assert.equal(result.data.revenue_action.action_type, expectedActionType);
      assert.equal(materializeCalls, 1);
      assert.equal(readCollection("revenue_actions").length, 1);
    } else {
      assert.equal(result.ok, false);
      assert.equal(result.error, "REVENUE_LEAK_CASE_ACTION_INCOMPATIBLE");
      assert.equal(result.details.action_type, expectedActionType);
      assert.equal(materializeCalls, 0);
      assert.deepEqual(readCollection("revenue_actions"), []);
      assert.equal(
        readCollection("revenue_leak_cases")[0].revenue_action_id,
        null
      );
    }
  });
}

for (const literal of ["n/a", "na", "not known"]) {
  test(`incompatible ${literal} retry preserves lifecycle and performs zero JSON writes`, async () => {
    seedEligibleOpportunity();
    const existing = legacyRevenueActionService.materializeRevenueAction(
      "opp-handoff"
    );
    assert.equal(existing.ok, true);
    const prepared = legacyRevenueActionService.prepareRevenueAction(
      existing.data.id
    );
    assert.equal(prepared.ok, true);
    assert.equal(prepared.data.status, "PREPARED");
    replaceOpportunity({ next_action: literal });

    let materializeCalls = 0;
    const service = localService({
      revenueActionAuthority: {
        async materializeRevenueAction(opportunityId) {
          materializeCalls += 1;
          return legacyRevenueActionService.materializeRevenueAction(opportunityId);
        },
        getRevenueAction: legacyRevenueActionService.getRevenueAction
      }
    });
    const detected = await createDetectedCase(service);
    const actionsBefore = readStoreFile("revenue_actions");
    const casesBefore = readStoreFile("revenue_leak_cases");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await service.createRevenueActionForCase(detected.id);
      assert.equal(result.ok, false);
      assert.equal(result.error, "REVENUE_LEAK_CASE_ACTION_INCOMPATIBLE");
      assert.equal(result.details.action_type, "FOLLOW_UP");
    }

    assert.equal(materializeCalls, 0);
    assert.equal(readStoreFile("revenue_actions"), actionsBefore);
    assert.equal(readStoreFile("revenue_leak_cases"), casesBefore);
    assert.equal(readCollection("revenue_actions").length, 1);
    assert.equal(readCollection("revenue_actions")[0].status, "PREPARED");
    assert.equal(
      readCollection("revenue_actions")[0].audit.at(-1).transition,
      "PREPARED"
    );
  });
}

test("JSON handoff links at a fresh server time after action creation", async () => {
  seedEligibleOpportunity();
  const detected = await createDetectedCase();
  const actionCreatedAt = "2026-09-08T00:01:00.000Z";
  const linkTime = "2026-09-08T00:02:00.000Z";
  const ticks = [FIXED_NOW, linkTime];
  const action = {
    id: "advancing-clock-action",
    opportunity_id: "opp-handoff",
    action_type: "CREATE_TASK",
    basis_fingerprint: "c".repeat(64),
    status: "RECOMMENDED",
    created_at: actionCreatedAt
  };
  const service = localService({
    clock: () => new Date(ticks.shift() || linkTime),
    revenueActionAuthority: {
      async materializeRevenueAction() {
        writeCollection("revenue_actions", [action]);
        return {
          ok: true,
          created: true,
          duplicate: false,
          data: action
        };
      },
      async getRevenueAction(id) {
        return id === action.id ? action : null;
      }
    }
  });

  const result = await service.createRevenueActionForCase(detected.id);

  assert.equal(result.ok, true);
  assert.equal(result.data.revenue_action.created_at, actionCreatedAt);
  assert.equal(result.data.case.revenue_action_linked_at, linkTime);
  assert.equal(result.data.case.audit.at(-1).at, linkTime);
  assert.ok(
    Date.parse(result.data.case.revenue_action_linked_at) >=
      Date.parse(result.data.revenue_action.created_at)
  );
});

test("PostgreSQL handoff exposes an unknown transaction outcome without retrying", async () => {
  let transactionAttempts = 0;
  const persistence = {
    adapter: "postgres",
    repositories: {
      revenueLeakCases: {},
      async transaction() {
        transactionAttempts += 1;
        const error = new Error("The transaction commit outcome is unknown.");
        error.outcomeUnknown = true;
        error.details = { operation: "commit" };
        throw error;
      }
    },
    forTenant() {
      return { revenueLeakCases: {} };
    }
  };
  const service = createRevenueLeakCaseService({
    persistence,
    clock: () => new Date(FIXED_NOW)
  }).forTenant(localContext());

  const result = await service.createRevenueActionForCase("case-unknown-outcome");

  assert.equal(transactionAttempts, 1);
  assert.deepEqual(result, {
    ok: false,
    error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
    message: "The transaction commit outcome is unknown.",
    statusCode: 500,
    details: { operation: "commit" }
  });
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
