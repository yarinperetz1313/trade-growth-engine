"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRevenueLeakCaseDetection
} = require("../src/revenueLeakCases/revenueLeakCaseDomain");
const {
  createJsonRevenueLeakCaseRepository
} = require("../src/revenueLeakCases/jsonRevenueLeakCaseRepository");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");

const TENANT_A = "10000000-0000-4000-8000-000000000001";
const TENANT_B = "20000000-0000-4000-8000-000000000002";
const DETECTED_AT = "2026-09-02T01:00:00.000Z";

function context(tenantId = TENANT_A, subjectId = "auth0|member-a") {
  return createTenantContext({ tenantId, subjectId });
}

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
    detector: {
      id: "stalled-opportunity",
      version: "1"
    },
    reason_code: "NO_MEANINGFUL_ACTIVITY",
    evidence_classification: "OBSERVED",
    evidence: {
      threshold_days: 14,
      last_meaningful_activity_at: "2026-08-01T00:00:00.000Z"
    },
    commercial_value: {
      classification: "UNKNOWN"
    },
    recommended_action_type: "FOLLOW_UP",
    supersession_condition: {
      kind: "CANONICAL_EVIDENCE_CHANGED"
    },
    ...overrides
  };
}

function build(input = detection(), overrides = {}) {
  return buildRevenueLeakCaseDetection(input, {
    id: overrides.id || "case-1",
    detectedAt: overrides.detectedAt || DETECTED_AT,
    subjectId: overrides.subjectId || "auth0|member-a"
  });
}

function createMemoryStore(seed = {}) {
  const state = Object.fromEntries(
    Object.entries(seed).map(([name, records]) => [name, structuredClone(records)])
  );
  return {
    state,
    readCollection(name) {
      return structuredClone(state[name] || []);
    },
    writeCollection(name, records) {
      state[name] = structuredClone(records);
      return records;
    }
  };
}

function repository(seed = {}) {
  const store = createMemoryStore({
    opportunities: [{ id: "opp-stalled" }, { id: "opp-other" }],
    revenue_actions: [{
      id: "action-1",
      opportunity_id: "opp-stalled",
      basis_fingerprint: "a".repeat(64),
      status: "RECOMMENDED"
    }, {
      id: "action-other",
      opportunity_id: "opp-other",
      basis_fingerprint: "b".repeat(64),
      status: "PREPARED"
    }, {
      id: "action-malformed",
      opportunity_id: "opp-stalled",
      basis_fingerprint: "c".repeat(64),
      status: "UNRECOGNIZED"
    }],
    revenue_leak_cases: [],
    ...seed
  });
  return {
    store,
    repository: createJsonRevenueLeakCaseRepository({
      store,
      localTenantId: TENANT_A
    })
  };
}

test("canonical identity is stable across object key order and changes with evidence", () => {
  const first = build();
  const reordered = buildRevenueLeakCaseDetection({
    ...detection(),
    evidence: {
      last_meaningful_activity_at: "2026-08-01T00:00:00.000Z",
      threshold_days: 14
    }
  }, {
    id: "case-2",
    detectedAt: "2026-09-02T02:00:00.000Z",
    subjectId: "auth0|member-b"
  });
  const changed = build(detection({
    evidence: {
      threshold_days: 21,
      last_meaningful_activity_at: "2026-08-01T00:00:00.000Z"
    }
  }), { id: "case-3" });

  assert.equal(first.series_key, reordered.series_key);
  assert.equal(first.semantic_key, reordered.semantic_key);
  assert.equal(first.evidence_fingerprint, reordered.evidence_fingerprint);
  assert.notEqual(first.semantic_key, changed.semantic_key);
  assert.notEqual(first.evidence_fingerprint, changed.evidence_fingerprint);
});

test("detection evidence is cloned, deeply immutable, and excludes generated time from identity", () => {
  const input = detection();
  const first = build(input);
  input.evidence.threshold_days = 99;

  assert.equal(first.evidence_snapshot.facts.threshold_days, 14);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidence_snapshot), true);
  assert.equal(Object.isFrozen(first.evidence_snapshot.facts), true);
  assert.throws(() => {
    first.evidence_snapshot.facts.threshold_days = 30;
  }, TypeError);

  const later = buildRevenueLeakCaseDetection(detection(), {
    id: "later-case",
    detectedAt: "2026-09-10T00:00:00.000Z",
    subjectId: "auth0|other"
  });
  assert.equal(first.semantic_key, later.semantic_key);
});

test("commercial value keeps UNKNOWN and NOT_APPLICABLE distinct from known zero", () => {
  for (const classification of ["UNKNOWN", "NOT_APPLICABLE"]) {
    const record = build(detection({ commercial_value: { classification } }));
    assert.deepEqual(record.commercial_value, {
      classification,
      amount: null,
      currency: null
    });
  }

  assert.deepEqual(
    build(detection({
      commercial_value: {
        classification: "KNOWN",
        amount: "00042000.500000",
        currency: "aud"
      }
    })).commercial_value,
    { classification: "KNOWN", amount: "42000.5", currency: "AUD" }
  );
  assert.deepEqual(
    build(detection({
      commercial_value: { classification: "KNOWN", amount: 0, currency: "AUD" }
    })).commercial_value,
    { classification: "KNOWN", amount: "0", currency: "AUD" }
  );

  for (const commercial_value of [
    { classification: "UNKNOWN", amount: 0 },
    { classification: "NOT_APPLICABLE", currency: "AUD" },
    { classification: "KNOWN", amount: 10 },
    { classification: "KNOWN", amount: -1, currency: "AUD" },
    { classification: "KNOWN", amount: "0.0000001", currency: "AUD" },
    { classification: "KNOWN", amount: "100000000000000", currency: "AUD" }
  ]) {
    assert.throws(
      () => build(detection({ commercial_value })),
      error => error.code === "REVENUE_LEAK_CASE_INPUT_INVALID"
    );
  }
});

test("only the initial stalled-opportunity contract is accepted", () => {
  assert.throws(
    () => build(detection({ leak_type: "STALE_QUOTE" })),
    error => error.code === "REVENUE_LEAK_CASE_INPUT_INVALID"
  );
  assert.throws(
    () => build(detection({
      source: { ...detection().source, entity_type: "PROSPECT" }
    })),
    error => error.code === "REVENUE_LEAK_CASE_INPUT_INVALID"
  );
  assert.throws(
    () => buildRevenueLeakCaseDetection(detection({
      source: {
        ...detection().source,
        observed_at: "2026-09-03T00:00:00.000Z"
      }
    }), {
      id: "future-observation",
      detectedAt: DETECTED_AT,
      subjectId: "auth0|member-a"
    }),
    error => error.code === "REVENUE_LEAK_CASE_INPUT_INVALID"
  );

  const unexpectedPrototypeKey = detection();
  Object.defineProperty(unexpectedPrototypeKey, "__proto__", {
    value: { tenant_id: TENANT_B },
    enumerable: true,
    configurable: true,
    writable: true
  });
  assert.throws(
    () => build(unexpectedPrototypeKey),
    error => error.code === "REVENUE_LEAK_CASE_INPUT_INVALID"
  );
});

test("JSON reconciliation is idempotent and supersedes changed active evidence", async () => {
  const { repository: cases, store } = repository();
  const tenant = context();
  const original = build();
  const first = await cases.reconcile(tenant, original);
  const duplicate = await cases.reconcile(
    tenant,
    buildRevenueLeakCaseDetection(detection(), {
      id: "ignored-duplicate-id",
      detectedAt: "2026-09-03T00:00:00.000Z",
      subjectId: tenant.subjectId
    })
  );
  const changed = await cases.reconcile(
    tenant,
    build(detection({
      evidence: {
        threshold_days: 21,
        last_meaningful_activity_at: "2026-08-01T00:00:00.000Z"
      }
    }), { id: "case-2", detectedAt: "2026-09-04T00:00:00.000Z" })
  );

  assert.equal(first.created, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record.id, original.id);
  assert.equal(changed.created, true);
  assert.equal(changed.superseded_case_id, original.id);
  assert.equal(changed.record.supersedes_case_id, original.id);
  const stored = store.state.revenue_leak_cases;
  assert.equal(stored.length, 2);
  assert.equal(stored[0].state, "SUPERSEDED");
  assert.equal(stored[0].superseded_by_case_id, "case-2");
  assert.deepEqual(stored[0].evidence_snapshot, original.evidence_snapshot);
  assert.equal(stored[0].audit.at(-1).transition, "SUPERSEDED");
});

test("snooze, resume, and dismissal require auditable human reasons", async () => {
  const { repository: cases } = repository();
  const tenant = context();
  await cases.reconcile(tenant, build());

  await assert.rejects(
    cases.transition(tenant, "case-1", {
      to: "SNOOZED",
      reason: "",
      wake_at: "2026-09-05T00:00:00.000Z",
      at: "2026-09-02T02:00:00.000Z"
    }),
    error => error.code === "REVENUE_LEAK_CASE_TRANSITION_INVALID"
  );
  const snoozed = await cases.transition(tenant, "case-1", {
    to: "SNOOZED",
    reason: "Waiting for the customer meeting.",
    wake_at: "2026-09-05T00:00:00.000Z",
    at: "2026-09-02T02:00:00.000Z"
  });
  assert.equal(snoozed.record.state, "SNOOZED");
  assert.equal(snoozed.record.snooze_reason, "Waiting for the customer meeting.");
  assert.equal(snoozed.record.audit.at(-1).subject_id, tenant.subjectId);

  const resumed = await cases.transition(tenant, "case-1", {
    to: "OPEN",
    reason: "Meeting completed; resume review.",
    at: "2026-09-05T01:00:00.000Z"
  });
  assert.equal(resumed.record.state, "OPEN");
  assert.equal(resumed.record.audit.at(-1).transition, "REOPENED");

  const dismissed = await cases.transition(tenant, "case-1", {
    to: "DISMISSED",
    reason: "Customer explicitly declined further follow-up.",
    at: "2026-09-05T02:00:00.000Z"
  });
  assert.equal(dismissed.record.state, "DISMISSED");
  assert.equal(dismissed.record.dismissal_reason, "Customer explicitly declined further follow-up.");
  await assert.rejects(
    cases.transition(tenant, "case-1", {
      to: "OPEN",
      reason: "Silently reopen terminal history.",
      at: "2026-09-06T00:00:00.000Z"
    }),
    error => error.code === "REVENUE_LEAK_CASE_TRANSITION_INVALID"
  );
});

test("RevenueAction linkage is same-opportunity, immutable, and idempotent", async () => {
  const { repository: cases } = repository();
  const tenant = context();
  await cases.reconcile(tenant, build());

  const linked = await cases.linkRevenueAction(tenant, "case-1", {
    revenue_action_id: "action-1",
    at: "2026-09-02T03:00:00.000Z"
  });
  assert.equal(linked.record.revenue_action_id, "action-1");
  assert.equal(linked.record.revenue_action_fingerprint, "a".repeat(64));
  assert.equal(linked.record.audit.at(-1).transition, "REVENUE_ACTION_LINKED");

  const replay = await cases.linkRevenueAction(tenant, "case-1", {
    revenue_action_id: "action-1",
    at: "2026-09-02T04:00:00.000Z"
  });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.record.audit.length, linked.record.audit.length);

  await assert.rejects(
    cases.linkRevenueAction(tenant, "case-1", {
      revenue_action_id: "action-other",
      at: "2026-09-02T05:00:00.000Z"
    }),
    error => error.code === "REVENUE_LEAK_CASE_ACTION_LINK_CONFLICT"
  );

  await cases.reconcile(tenant, build(detection({
    evidence: {
      threshold_days: 21,
      last_meaningful_activity_at: "2026-08-01T00:00:00.000Z"
    }
  }), { id: "case-2", detectedAt: "2026-09-03T00:00:00.000Z" }));
  for (const revenue_action_id of [
    "action-other",
    "missing-action",
    "action-malformed"
  ]) {
    await assert.rejects(
      cases.linkRevenueAction(tenant, "case-2", {
        revenue_action_id,
        at: "2026-09-03T01:00:00.000Z"
      }),
      error => error.code === "REVENUE_ACTION_UNAVAILABLE"
    );
  }
});

test("the local adapter accepts only its trusted single tenant and fails closed", async () => {
  const { repository: cases } = repository();
  const tenantA = context();
  const tenantB = context(TENANT_B, "auth0|member-b");
  await cases.reconcile(tenantA, build());

  assert.equal(await cases.findById(tenantB, "case-1"), null);
  assert.deepEqual(await cases.list(tenantB), []);
  await assert.rejects(
    cases.reconcile(tenantB, build(detection(), { id: "tenant-b-case" })),
    error => error.code === "REVENUE_LEAK_SOURCE_UNAVAILABLE"
  );
  await assert.rejects(
    cases.findById({ ...tenantA }, "case-1"),
    error => error.code === "TENANT_CONTEXT_REQUIRED"
  );
});
