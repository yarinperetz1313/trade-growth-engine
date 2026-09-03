"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tge-revenue-leak-cases-"));
process.env.LOCAL_STORE_DIR = tempDir;

const { app } = require("../src/app/server");
const {
  createRevenueLeakCasesRouter
} = require("../src/api/revenueLeakCases");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");
const {
  createPersistence
} = require("../src/persistence/createPersistence");
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

function detection(overrides = {}) {
  return {
    leak_type: "STALLED_OPPORTUNITY",
    source: {
      system: "TGE",
      entity_type: "OPPORTUNITY",
      entity_id: "opp-stalled",
      observed_at: "2026-09-01T00:00:00.000Z",
      observed_version: "opportunity-v4"
    },
    detector: { id: "stalled-opportunity", version: "1" },
    reason_code: "NO_MEANINGFUL_ACTIVITY",
    evidence_classification: "OBSERVED",
    evidence: {
      threshold_days: 14,
      last_meaningful_activity_at: "2026-08-01T00:00:00.000Z"
    },
    commercial_value: { classification: "UNKNOWN" },
    recommended_action_type: "FOLLOW_UP",
    supersession_condition: { kind: "CANONICAL_EVIDENCE_CHANGED" },
    ...overrides
  };
}

function seedStore() {
  writeCollection("opportunities", [{
    id: "opp-stalled",
    business_name: "Stalled Trade",
    stage: "PROPOSAL"
  }]);
  writeCollection("revenue_actions", [{
    id: "action-1",
    opportunity_id: "opp-stalled",
    basis_fingerprint: "a".repeat(64),
    status: "RECOMMENDED"
  }]);
  writeCollection("revenue_leak_cases", []);
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

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("local API reconciles, lists, and retrieves an immutable unknown-value case", async () => {
  seedStore();
  await withServer(app, async baseUrl => {
    const first = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection()
    );
    const replay = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection()
    );

    assert.equal(first.status, 201);
    assert.equal(first.data.created, true);
    assert.equal(first.data.data.leak_type, "STALLED_OPPORTUNITY");
    assert.equal(first.data.data.state, "OPEN");
    assert.deepEqual(first.data.data.commercial_value, {
      classification: "UNKNOWN",
      amount: null,
      currency: null
    });
    assert.equal(Object.hasOwn(first.data.data, "tenant_id"), false);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.duplicate, true);
    assert.equal(replay.data.data.id, first.data.data.id);

    const list = await request(
      baseUrl,
      "GET",
      "/api/revenue-leak-cases?opportunity_id=opp-stalled"
    );
    const get = await request(
      baseUrl,
      "GET",
      `/api/revenue-leak-cases/${first.data.data.id}`
    );
    assert.equal(list.status, 200);
    assert.equal(list.data.count, 1);
    assert.equal(get.status, 200);
    assert.deepEqual(get.data.data.evidence_snapshot, first.data.data.evidence_snapshot);
    assert.equal(readCollection("revenue_leak_cases").length, 1);
  });
});

test("API exposes only the narrow audited lifecycle and optional RevenueAction link", async () => {
  seedStore();
  await withServer(app, async baseUrl => {
    const created = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection()
    );
    const id = created.data.data.id;
    const snoozed = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${id}/snooze`,
      {
        reason: "Waiting for the scheduled meeting.",
        wake_at: "2099-09-05T00:00:00.000Z"
      }
    );
    assert.equal(snoozed.status, 200);
    assert.equal(snoozed.data.data.state, "SNOOZED");

    const resumed = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${id}/resume`,
      { reason: "Meeting finished; review again." }
    );
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.data.state, "OPEN");

    const linked = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${id}/link-revenue-action`,
      { revenue_action_id: "action-1" }
    );
    assert.equal(linked.status, 200);
    assert.equal(linked.data.data.revenue_action_id, "action-1");
    assert.equal(linked.data.data.revenue_action_fingerprint, "a".repeat(64));

    const dismissed = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${id}/dismiss`,
      { reason: "Customer declined further follow-up." }
    );
    assert.equal(dismissed.status, 200);
    assert.equal(dismissed.data.data.state, "DISMISSED");
    assert.equal(dismissed.data.data.audit.at(-1).transition, "DISMISSED");
  });
});

test("API rejects caller authority, malformed values, and non-oracular missing relationships", async () => {
  seedStore();
  await withServer(app, async baseUrl => {
    const authoredTenant = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      { ...detection(), tenant_id: "attacker-tenant" }
    );
    assert.equal(authoredTenant.status, 400);
    assert.equal(authoredTenant.data.error, "REVENUE_LEAK_CASE_INPUT_INVALID");

    const unknownZero = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection({
        commercial_value: { classification: "UNKNOWN", amount: 0 }
      })
    );
    assert.equal(unknownZero.status, 400);

    const missingSource = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection({
        source: { ...detection().source, entity_id: "missing-opportunity" }
      })
    );
    assert.equal(missingSource.status, 404);
    assert.equal(missingSource.data.error, "REVENUE_LEAK_SOURCE_UNAVAILABLE");

    for (const id of ["missing-case", "cross-tenant-case-placeholder"]) {
      const missing = await request(
        baseUrl,
        "GET",
        `/api/revenue-leak-cases/${id}`
      );
      assert.equal(missing.status, 404);
      assert.equal(missing.data.error, "REVENUE_LEAK_CASE_NOT_FOUND");
      assert.equal(missing.data.message, "Revenue leak case was not found.");
    }
  });
});

test("API requires lossless decimal strings for KNOWN commercial values", async () => {
  seedStore();
  await withServer(app, async baseUrl => {
    const impreciseNumber = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection({
        commercial_value: {
          classification: "KNOWN",
          amount: 99999999999999.99,
          currency: "AUD"
        }
      })
    );
    assert.equal(impreciseNumber.status, 400);
    assert.equal(impreciseNumber.data.error, "REVENUE_LEAK_CASE_INPUT_INVALID");
    assert.equal(impreciseNumber.data.details.field, "commercial_value.amount");

    const exactString = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection({
        commercial_value: {
          classification: "KNOWN",
          amount: "99999999999999.99",
          currency: "AUD"
        }
      })
    );
    assert.equal(exactString.status, 201);
    assert.deepEqual(exactString.data.data.commercial_value, {
      classification: "KNOWN",
      amount: "99999999999999.99",
      currency: "AUD"
    });
  });
});

test("malformed persisted service-envelope fields fail closed across the API", async () => {
  seedStore();
  await withServer(app, async baseUrl => {
    const created = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection()
    );
    const id = created.data.data.id;
    const malformed = {
      ...readCollection("revenue_leak_cases")[0],
      ok: false,
      statusCode: 200,
      data: { forged: true }
    };
    writeCollection("revenue_leak_cases", [malformed]);

    const read = await request(baseUrl, "GET", `/api/revenue-leak-cases/${id}`);
    const list = await request(baseUrl, "GET", "/api/revenue-leak-cases");
    const replay = await request(
      baseUrl,
      "POST",
      "/api/revenue-leak-cases/reconcile",
      detection()
    );
    const mutation = await request(
      baseUrl,
      "POST",
      `/api/revenue-leak-cases/${id}/dismiss`,
      { reason: "Caller-authored malformed truth must not be mutated." }
    );

    for (const response of [read, list]) {
      assert.equal(response.status, 500);
      assert.equal(
        response.data.error,
        "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE"
      );
    }
    for (const response of [replay, mutation]) {
      assert.equal(response.status, 409);
      assert.equal(response.data.error, "REVENUE_LEAK_CASE_INTEGRITY_CONFLICT");
    }
    assert.deepEqual(readCollection("revenue_leak_cases"), [malformed]);
  });
});

test("tenant-bound router rejects an absent or forged server context", async () => {
  const service = {
    forTenant() {
      return { async listRevenueLeakCases() { return []; } };
    }
  };
  assert.throws(
    () => createRevenueLeakCasesRouter({ service }),
    /server-injected TenantContext resolver/
  );

  const trusted = createTenantContext({
    tenantId: "30000000-0000-4000-8000-000000000003",
    subjectId: "auth0|member"
  });
  const express = require("express");
  const forgedApp = express();
  forgedApp.use(createRevenueLeakCasesRouter({
    service,
    resolveTenantContext: () => ({ ...trusted })
  }));
  await withServer(forgedApp, async baseUrl => {
    const response = await request(baseUrl, "GET", "/api/revenue-leak-cases");
    assert.equal(response.status, 500);
    assert.equal(response.data.error, "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE");
  });
});

test("API exposes a bounded per-opportunity detector seam and rejects caller-authored evidence", async () => {
  seedStore();
  writeCollection("opportunities", [{
    id: "opp-stalled",
    business_name: "Stalled Trade",
    stage: "PROPOSAL",
    next_action: "",
    value: "0.000000",
    currency: "AUD",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z"
  }]);
  writeCollection("activities", [{
    id: "activity-old",
    opportunity_id: "opp-stalled",
    type: "FOLLOW_UP_RECORDED",
    created_at: "2026-08-18T00:00:00.000Z",
    updated_at: "2026-08-18T00:00:00.000Z"
  }]);
  writeCollection("tasks", []);

  const service = createRevenueLeakCaseService({
    persistence: createPersistence({ adapter: "json" }),
    createId: () => "detected-case",
    clock: () => new Date("2026-09-01T00:00:00.000Z")
  });
  const localContext = createTenantContext({
    tenantId: LOCAL_REVENUE_LEAK_TENANT_ID,
    subjectId: "api-detector"
  });
  const express = require("express");
  const detectorApp = express();
  detectorApp.use(express.json());
  detectorApp.use(createRevenueLeakCasesRouter({
    service,
    resolveTenantContext: () => localContext
  }));

  await withServer(detectorApp, async baseUrl => {
    const detected = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-stalled/revenue-leak-cases/detect-stalled",
      {}
    );
    assert.equal(detected.status, 201);
    assert.equal(detected.data.outcome, "ELIGIBLE_LEAK_DETECTED");
    assert.equal(detected.data.reason_code, "STALE_WITHOUT_NEXT_ACTION");
    assert.equal(detected.data.case.id, "detected-case");
    assert.deepEqual(detected.data.case.commercial_value, {
      classification: "KNOWN",
      amount: "0",
      currency: "AUD"
    });

    const replay = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-stalled/revenue-leak-cases/detect-stalled",
      {}
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.data.reconciliation.duplicate, true);
    assert.equal(readCollection("revenue_leak_cases").length, 1);

    const override = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-stalled/revenue-leak-cases/detect-stalled",
      { evaluated_at: "2020-01-01T00:00:00.000Z", threshold_days: 1 }
    );
    assert.equal(override.status, 400);
    assert.equal(override.data.error, "REVENUE_LEAK_DETECTOR_REQUEST_INVALID");
    assert.equal(readCollection("revenue_leak_cases").length, 1);
  });
});
