"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FEEDBACK_CODES,
  PILOT_EVENT_TYPES,
  PilotEvidenceError,
  buildPilotEvidenceEvent
} = require("../src/pilotEvidence/pilotEvidenceDomain");
const {
  createJsonPilotEvidenceRepository
} = require("../src/pilotEvidence/jsonPilotEvidenceRepository");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");

const TENANT_A = "10000000-0000-4000-8000-000000000001";
const TENANT_B = "20000000-0000-4000-8000-000000000002";
const AT = "2026-09-09T01:02:03.000Z";

function context(tenantId = TENANT_A, subjectId = "auth0|operator-a") {
  return createTenantContext({ tenantId, subjectId });
}

function importFacts(overrides = {}) {
  return {
    import_batch_id: "batch-1",
    source_collection: "opportunities",
    total_count: 2,
    committed_count: 2,
    skipped_count: 0,
    quality_blocked_count: 0,
    quality_conflict_count: 0,
    source_identity_covered_count: 2,
    commercial_value_covered_count: 1,
    stage_covered_count: 2,
    created_at_covered_count: 1,
    created_at_invalid_count: 0,
    updated_at_covered_count: 0,
    updated_at_invalid_count: 0,
    contactable_count: null,
    ...overrides
  };
}

function build(eventType = "IMPORT_COMMITTED", facts = importFacts(), options = {}) {
  return buildPilotEvidenceEvent({ eventType, facts }, {
    tenantId: options.tenantId || TENANT_A,
    subjectId: options.subjectId || "auth0|operator-a",
    occurredAt: options.occurredAt || AT,
    id: options.id || "event-1"
  });
}

function memoryStore(seed = []) {
  let records = structuredClone(seed);
  return {
    readCollection(name) {
      assert.equal(name, "pilot_evidence_events");
      return structuredClone(records);
    },
    writeCollection(name, next) {
      assert.equal(name, "pilot_evidence_events");
      records = structuredClone(next);
      return next;
    },
    snapshot() {
      return structuredClone(records);
    }
  };
}

test("pilot evidence exposes only the approved closed event and feedback sets", () => {
  assert.deepEqual([...PILOT_EVENT_TYPES], [
    "IMPORT_COMMITTED",
    "PORTFOLIO_SCAN_COMPLETED",
    "FIRST_CREDIBLE_CASE_SURFACED",
    "CASE_INSPECTED",
    "REVENUE_ACTION_MATERIALIZED_LINKED",
    "ACTION_APPROVED",
    "ACTION_EXECUTED",
    "OPERATOR_FEEDBACK"
  ]);
  assert.deepEqual([...FEEDBACK_CODES], [
    "USEFUL",
    "WRONG",
    "ALREADY_HANDLED",
    "MISSING_CONTEXT",
    "NOT_WORTH_PURSUING"
  ]);
});

test("event builders accept only bounded non-content facts and server authority", () => {
  const event = build();
  assert.equal(event.tenant_id, TENANT_A);
  assert.equal(event.actor_subject_id, "auth0|operator-a");
  assert.equal(event.occurred_at, AT);
  assert.deepEqual(event.facts, importFacts());
  assert.match(event.semantic_key, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(event), true);

  for (const invalid of [
    { ...importFacts(), business_name: "Sensitive Plumbing" },
    { ...importFacts(), email: "person@example.test" },
    { ...importFacts(), raw_csv_cell: "secret" },
    { ...importFacts(), total_count: -1 },
    { ...importFacts(), committed_count: 3 },
    { ...importFacts(), source_collection: "revenue_actions" }
  ]) {
    assert.throws(
      () => build("IMPORT_COMMITTED", invalid),
      error => error instanceof PilotEvidenceError
        && error.code === "PILOT_EVIDENCE_INVALID"
    );
  }

  assert.throws(
    () => build("SOMETHING_GENERIC", {}),
    error => error.code === "PILOT_EVIDENCE_INVALID"
  );
});

test("known positive, known zero, unknown, and not applicable remain distinct", () => {
  const common = { case_id: "case-1", import_batch_id: "batch-1" };
  for (const [kind, currency] of [
    ["KNOWN_POSITIVE", "AUD"],
    ["KNOWN_ZERO", "AUD"],
    ["UNKNOWN", null],
    ["NOT_APPLICABLE", null]
  ]) {
    assert.equal(build("FIRST_CREDIBLE_CASE_SURFACED", {
      ...common,
      value_kind: kind,
      currency
    }).facts.value_kind, kind);
  }
  assert.throws(() => build("FIRST_CREDIBLE_CASE_SURFACED", {
    ...common,
    value_kind: "UNKNOWN",
    currency: "AUD"
  }), error => error.code === "PILOT_EVIDENCE_INVALID");
});

test("JSON evidence is tenant-scoped, append-only, semantically idempotent, and conflict-safe", async () => {
  const store = memoryStore();
  const repository = createJsonPilotEvidenceRepository({
    store,
    localTenantId: TENANT_A
  });
  const first = build();
  const created = await repository.append(context(), first);
  const replay = await repository.append(context(), build(
    "IMPORT_COMMITTED",
    importFacts(),
    { id: "event-retry", occurredAt: "2026-09-09T02:00:00.000Z" }
  ));

  assert.equal(created.created, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.record.id, first.id);
  assert.equal(store.snapshot().length, 1);
  assert.deepEqual(await repository.list(context()), [{
    ...first,
    tenant_id: undefined
  }].map(item => {
    const clone = { ...item };
    delete clone.tenant_id;
    return clone;
  }));
  assert.deepEqual(await repository.list(context(TENANT_B)), []);

  await assert.rejects(
    repository.append(context(), build(
      "IMPORT_COMMITTED",
      importFacts({ commercial_value_covered_count: 2 }),
      { id: "event-conflict" }
    )),
    error => error.code === "PILOT_EVIDENCE_CONFLICT"
  );
  assert.equal(store.snapshot().length, 1);
});

test("feedback is closed, content-free, and one immutable fact per imported case", async () => {
  const store = memoryStore();
  const repository = createJsonPilotEvidenceRepository({
    store,
    localTenantId: TENANT_A
  });
  const useful = build("OPERATOR_FEEDBACK", {
    case_id: "case-1",
    import_batch_id: "batch-1",
    feedback_code: "USEFUL"
  });
  await repository.append(context(), useful);
  assert.equal((await repository.append(context(), build(
    "OPERATOR_FEEDBACK",
    useful.facts,
    { id: "feedback-retry" }
  ))).duplicate, true);
  await assert.rejects(
    repository.append(context(), build("OPERATOR_FEEDBACK", {
      ...useful.facts,
      feedback_code: "WRONG"
    }, { id: "feedback-change" })),
    error => error.code === "PILOT_EVIDENCE_CONFLICT"
  );
  assert.throws(() => build("OPERATOR_FEEDBACK", {
    ...useful.facts,
    feedback_code: "OTHER",
    comment: "free form"
  }), error => error.code === "PILOT_EVIDENCE_INVALID");
});

test("first scan and first surfaced milestones retain their initial fact on later valid observations", async () => {
  const store = memoryStore();
  const repository = createJsonPilotEvidenceRepository({
    store,
    localTenantId: TENANT_A
  });
  const scanFacts = {
    evaluated_count: 1,
    eligible_leak_count: 1,
    eligible_no_leak_count: 0,
    insufficient_evidence_count: 0,
    stale_source_count: 0,
    data_health_suppressed_count: 0,
    excluded_count: 0
  };
  await repository.append(context(), build(
    "PORTFOLIO_SCAN_COMPLETED",
    scanFacts,
    { id: "first-scan" }
  ));
  const later = await repository.append(context(), build(
    "PORTFOLIO_SCAN_COMPLETED",
    {
      ...scanFacts,
      eligible_leak_count: 0,
      eligible_no_leak_count: 1
    },
    { id: "later-scan", occurredAt: "2026-09-10T01:00:00.000Z" }
  ));

  assert.equal(later.duplicate, true);
  assert.deepEqual(later.record.facts, scanFacts);
  assert.equal(store.snapshot().length, 1);
});

test("JSON evidence reads reject corrupted persisted facts without exposing customer content", async () => {
  const sentinel = "PRIVATE CUSTOMER CELL";
  const event = structuredClone(build());
  event.facts.customer_content = sentinel;
  const repository = createJsonPilotEvidenceRepository({
    store: memoryStore([event]),
    localTenantId: TENANT_A
  });

  await assert.rejects(
    repository.list(context()),
    error => error.code === "PILOT_EVIDENCE_PERSISTENCE_UNAVAILABLE"
      && !error.message.includes(sentinel)
  );
});
