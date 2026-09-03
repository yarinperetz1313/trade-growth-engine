"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DETECTOR,
  OUTCOMES,
  OUTCOME_REASON_CODES,
  SOURCE_FRESHNESS_DAYS,
  STALE_AFTER_DAYS,
  evaluateStalledOpportunity
} = require("../src/revenueLeakCases/stalledOpportunityDetector");
const {
  createPersistence
} = require("../src/persistence/createPersistence");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");
const {
  LOCAL_REVENUE_LEAK_TENANT_ID
} = require("../src/revenueLeakCases/jsonRevenueLeakCaseRepository");
const {
  createRevenueLeakCaseService
} = require("../src/revenueLeakCases/revenueLeakCaseService");

const DAY = 86400000;
const EVALUATED_AT = "2026-09-01T00:00:00.000Z";

function atOffset(days, milliseconds = 0) {
  return new Date(Date.parse(EVALUATED_AT) - days * DAY + milliseconds)
    .toISOString();
}

function canonicalEvidence(overrides = {}) {
  const opportunity = {
    id: "opp-stalled",
    business_name: "Stalled Trade",
    stage: "PROPOSAL",
    next_action: "",
    value: "42000.500000",
    currency: "AUD",
    created_at: atOffset(60),
    updated_at: atOffset(1),
    ...(overrides.opportunity || {})
  };
  const activities = overrides.activities || [{
    id: "activity-last",
    opportunity_id: opportunity.id,
    type: "FOLLOW_UP_RECORDED",
    created_at: atOffset(STALE_AFTER_DAYS),
    updated_at: atOffset(STALE_AFTER_DAYS)
  }];
  const tasks = overrides.tasks || [];
  return {
    opportunity,
    activities,
    tasks,
    evaluatedAt: overrides.evaluatedAt || EVALUATED_AT
  };
}

function evaluate(overrides) {
  return evaluateStalledOpportunity(canonicalEvidence(overrides));
}

test("detector contract exposes exactly five outcomes and a closed reason-code set", () => {
  assert.deepEqual(Object.values(OUTCOMES).sort(), [
    "DATA_HEALTH_SUPPRESSED",
    "ELIGIBLE_LEAK_DETECTED",
    "ELIGIBLE_NO_LEAK",
    "INSUFFICIENT_EVIDENCE",
    "STALE_OR_UNTRUSTWORTHY_SOURCE"
  ]);
  assert.deepEqual(Object.keys(OUTCOME_REASON_CODES).sort(), Object.values(OUTCOMES).sort());
  assert.deepEqual(OUTCOME_REASON_CODES.ELIGIBLE_LEAK_DETECTED, [
    "STALE_WITHOUT_NEXT_ACTION"
  ]);
  assert.deepEqual(DETECTOR, { id: "stalled-opportunity", version: "1" });
  assert.equal(STALE_AFTER_DAYS, 14);
  assert.equal(SOURCE_FRESHNESS_DAYS, 90);
});

test("all five outcome classes remain distinct with exact bounded reasons", () => {
  const cases = [
    [
      evaluate(),
      "ELIGIBLE_LEAK_DETECTED",
      "STALE_WITHOUT_NEXT_ACTION"
    ],
    [
      evaluate({
        activities: [{
          id: "recent",
          opportunity_id: "opp-stalled",
          type: "FOLLOW_UP_RECORDED",
          created_at: atOffset(STALE_AFTER_DAYS, 1),
          updated_at: atOffset(STALE_AFTER_DAYS, 1)
        }]
      }),
      "ELIGIBLE_NO_LEAK",
      "RECENT_MEANINGFUL_ACTIVITY"
    ],
    [
      evaluate({
        opportunity: { created_at: undefined },
        activities: []
      }),
      "INSUFFICIENT_EVIDENCE",
      "MEANINGFUL_ACTIVITY_BASELINE_MISSING"
    ],
    [
      evaluate({
        opportunity: {
          created_at: atOffset(SOURCE_FRESHNESS_DAYS, -1),
          updated_at: atOffset(SOURCE_FRESHNESS_DAYS, -1)
        },
        activities: []
      }),
      "STALE_OR_UNTRUSTWORTHY_SOURCE",
      "CANONICAL_SOURCE_TOO_OLD"
    ],
    [
      evaluate({ opportunity: { stage: "PIPELINE-ish" } }),
      "DATA_HEALTH_SUPPRESSED",
      "OPPORTUNITY_STAGE_UNRECOGNIZED"
    ]
  ];

  for (const [result, outcome, reason] of cases) {
    assert.equal(result.outcome, outcome);
    assert.equal(result.reason_code, reason);
    assert.ok(OUTCOME_REASON_CODES[outcome].includes(reason));
    assert.equal(result.detection === null, outcome !== "ELIGIBLE_LEAK_DETECTED");
  }
});

test("staleness and source-freshness boundaries use exact elapsed time", () => {
  const exactlyStale = evaluate();
  const oneMillisecondRecent = evaluate({
    activities: [{
      id: "activity-recent-boundary",
      opportunity_id: "opp-stalled",
      type: "FOLLOW_UP_RECORDED",
      created_at: atOffset(STALE_AFTER_DAYS, 1),
      updated_at: atOffset(STALE_AFTER_DAYS, 1)
    }]
  });
  assert.equal(exactlyStale.outcome, "ELIGIBLE_LEAK_DETECTED");
  assert.equal(oneMillisecondRecent.reason_code, "RECENT_MEANINGFUL_ACTIVITY");

  const exactlyFreshEnough = evaluate({
    opportunity: {
      created_at: atOffset(SOURCE_FRESHNESS_DAYS),
      updated_at: atOffset(SOURCE_FRESHNESS_DAYS)
    },
    activities: []
  });
  const oneMillisecondTooOld = evaluate({
    opportunity: {
      created_at: atOffset(SOURCE_FRESHNESS_DAYS, -1),
      updated_at: atOffset(SOURCE_FRESHNESS_DAYS, -1)
    },
    activities: []
  });
  assert.equal(exactlyFreshEnough.outcome, "ELIGIBLE_LEAK_DETECTED");
  assert.equal(oneMillisecondTooOld.reason_code, "CANONICAL_SOURCE_TOO_OLD");
});

test("future and malformed timestamps are not confused with business staleness", () => {
  assert.equal(evaluate({
    opportunity: { updated_at: new Date(Date.parse(EVALUATED_AT) + 1).toISOString() }
  }).reason_code, "CANONICAL_TIMESTAMP_IN_FUTURE");
  assert.equal(evaluate({
    activities: [{
      id: "bad-time",
      opportunity_id: "opp-stalled",
      type: "FOLLOW_UP_RECORDED",
      created_at: "not-a-time",
      updated_at: "not-a-time"
    }]
  }).reason_code, "CANONICAL_TIMESTAMP_INVALID");
});

test("a canonical next action or active task prevents a leak at the stale boundary", () => {
  const recorded = evaluate({ opportunity: { next_action: " Call buyer " } });
  const activeTask = evaluate({ tasks: [{
    id: "task-open",
    opportunity_id: "opp-stalled",
    title: "Call buyer",
    status: "OPEN",
    created_at: atOffset(20),
    updated_at: atOffset(1)
  }] });
  const placeholderAndCancelledTask = evaluate({
    opportunity: { next_action: " N/A " },
    tasks: [{
      id: "task-cancelled",
      opportunity_id: "opp-stalled",
      title: "Old call",
      status: "CANCELLED",
      created_at: atOffset(20),
      updated_at: atOffset(1)
    }]
  });

  assert.equal(recorded.reason_code, "NEXT_ACTION_PRESENT");
  assert.equal(recorded.evidence.next_action.source, "OPPORTUNITY");
  assert.equal(activeTask.reason_code, "NEXT_ACTION_PRESENT");
  assert.deepEqual(activeTask.evidence.next_action.active_task_ids, ["task-open"]);
  assert.equal(placeholderAndCancelledTask.outcome, "ELIGIBLE_LEAK_DETECTED");
});

test("closed opportunities are evaluable no-leaks and malformed action evidence suppresses", () => {
  assert.equal(
    evaluate({ opportunity: { stage: "WON" } }).reason_code,
    "OPPORTUNITY_CLOSED"
  );
  assert.equal(
    evaluate({ opportunity: { next_action: { unsafe: true } } }).reason_code,
    "NEXT_ACTION_EVIDENCE_INVALID"
  );
  assert.equal(evaluate({ tasks: [{
    id: "task-bad-status",
    opportunity_id: "opp-stalled",
    title: "Call buyer",
    status: "WAITING",
    created_at: atOffset(20),
    updated_at: atOffset(1)
  }] }).reason_code, "TASK_STATUS_UNRECOGNIZED");
  assert.equal(evaluate({ tasks: [{
    id: "task-open-with-completion",
    opportunity_id: "opp-stalled",
    title: "Call buyer",
    status: "OPEN",
    completed_at: atOffset(2),
    created_at: atOffset(20),
    updated_at: atOffset(1)
  }] }).reason_code, "TASK_EVIDENCE_INVALID");
  assert.equal(evaluate({
    activities: [{
      id: "duplicate",
      opportunity_id: "opp-stalled",
      type: "CALL",
      created_at: atOffset(20),
      updated_at: atOffset(20)
    }, {
      id: "duplicate",
      opportunity_id: "opp-stalled",
      type: "MEETING",
      created_at: atOffset(14),
      updated_at: atOffset(14)
    }]
  }).reason_code, "ACTIVITY_EVIDENCE_INVALID");
  assert.equal(evaluate({
    opportunity: {
      created_at: atOffset(1),
      updated_at: atOffset(2)
    }
  }).reason_code, "CANONICAL_TIMESTAMP_INVALID");
});

test("commercial value keeps exact decimals, known zero, and unknown distinct", () => {
  const exact = evaluate();
  const zero = evaluate({ opportunity: { value: 0, currency: "aud" } });
  const unknown = evaluate({ opportunity: { value: "unknown", currency: undefined } });
  const amountWithoutCurrency = evaluate({ opportunity: { value: "75.250000", currency: undefined } });

  assert.deepEqual(exact.commercial_value, {
    classification: "KNOWN",
    amount: "42000.5",
    currency: "AUD"
  });
  assert.deepEqual(zero.commercial_value, {
    classification: "KNOWN",
    amount: "0",
    currency: "AUD"
  });
  assert.deepEqual(unknown.commercial_value, {
    classification: "UNKNOWN",
    amount: null,
    currency: null
  });
  assert.deepEqual(amountWithoutCurrency.commercial_value, unknown.commercial_value);
  assert.equal(Object.hasOwn(exact, "recovered_revenue"), false);
  assert.equal(Object.hasOwn(exact.detection, "probability"), false);

  assert.equal(evaluate({
    opportunity: { value: "not-a-number", currency: "AUD" }
  }).reason_code, "COMMERCIAL_VALUE_INVALID");
  assert.equal(evaluate({
    opportunity: { value: "10", currency: "A$" }
  }).reason_code, "COMMERCIAL_CURRENCY_INVALID");
});

test("identical canonical evidence has a stable version independent of collection order and run time", () => {
  const activities = [{
    id: "activity-old",
    opportunity_id: "opp-stalled",
    type: "MEETING",
    created_at: atOffset(30),
    updated_at: atOffset(30)
  }, {
    id: "activity-last",
    opportunity_id: "opp-stalled",
    type: "FOLLOW_UP_RECORDED",
    created_at: atOffset(14),
    updated_at: atOffset(14)
  }];
  const tasks = [{
    id: "task-cancelled",
    opportunity_id: "opp-stalled",
    title: "Old action",
    status: "CANCELLED",
    created_at: atOffset(40),
    updated_at: atOffset(20)
  }];
  const first = evaluate({ activities, tasks });
  const reorderedLater = evaluate({
    activities: [...activities].reverse(),
    tasks: [...tasks].reverse(),
    evaluatedAt: new Date(Date.parse(EVALUATED_AT) + DAY).toISOString()
  });

  assert.equal(first.outcome, "ELIGIBLE_LEAK_DETECTED");
  assert.equal(reorderedLater.outcome, "ELIGIBLE_LEAK_DETECTED");
  assert.equal(first.source.observed_version, reorderedLater.source.observed_version);
  assert.deepEqual(first.detection, reorderedLater.detection);
});

function createMemoryStore(seed) {
  const state = structuredClone(seed);
  return {
    state,
    readCollection(name) {
      return structuredClone(state[name] || []);
    },
    writeCollection(name, records) {
      state[name] = structuredClone(records);
      return records;
    },
    findRecord(name, id) {
      return structuredClone((state[name] || []).find(record => record.id === id) || null);
    }
  };
}

test("JSON detector service reconciles stable, snoozed, terminal, and changed evidence without tenant bleed", async () => {
  const evidence = canonicalEvidence();
  const store = createMemoryStore({
    opportunities: [evidence.opportunity],
    activities: evidence.activities,
    tasks: evidence.tasks,
    revenue_actions: [],
    revenue_leak_cases: []
  });
  let nextId = 0;
  let clock = EVALUATED_AT;
  const service = createRevenueLeakCaseService({
    persistence: createPersistence({ adapter: "json", store }),
    createId: () => `case-${++nextId}`,
    clock: () => new Date(clock)
  });
  const local = createTenantContext({
    tenantId: LOCAL_REVENUE_LEAK_TENANT_ID,
    subjectId: "local-member"
  });
  const requestBound = service.forTenant(local);

  const first = await requestBound.detectStalledOpportunity("opp-stalled");
  clock = new Date(Date.parse(EVALUATED_AT) + DAY).toISOString();
  const replay = await requestBound.detectStalledOpportunity("opp-stalled");
  assert.equal(first.outcome, "ELIGIBLE_LEAK_DETECTED");
  assert.equal(first.reconciliation.created, true);
  assert.equal(replay.reconciliation.duplicate, true);
  assert.equal(replay.case.id, first.case.id);

  await requestBound.snoozeRevenueLeakCase(first.case.id, {
    reason: "Waiting for the buyer.",
    wake_at: "2026-09-10T00:00:00.000Z"
  });
  const snoozedReplay = await requestBound.detectStalledOpportunity("opp-stalled");
  assert.equal(snoozedReplay.case.state, "SNOOZED");
  assert.equal(snoozedReplay.reconciliation.duplicate, true);

  await requestBound.dismissRevenueLeakCase(first.case.id, {
    reason: "Buyer asked us to stop."
  });
  const terminalReplay = await requestBound.detectStalledOpportunity("opp-stalled");
  assert.equal(terminalReplay.case.state, "DISMISSED");
  assert.equal(terminalReplay.reconciliation.terminal, true);

  store.state.opportunities[0].stage = "MEETING";
  store.state.opportunities[0].updated_at = clock;
  const changed = await requestBound.detectStalledOpportunity("opp-stalled");
  assert.equal(changed.reconciliation.created, true);
  assert.equal(changed.case.supersedes_case_id, first.case.id);
  assert.equal(store.state.revenue_leak_cases[0].state, "DISMISSED");
  assert.deepEqual(
    store.state.revenue_leak_cases[0].evidence_snapshot,
    first.case.evidence_snapshot
  );

  const otherTenant = service.forTenant(createTenantContext({
    tenantId: "20000000-0000-4000-8000-000000000002",
    subjectId: "other-member"
  }));
  const hidden = await otherTenant.detectStalledOpportunity("opp-stalled");
  assert.equal(hidden.ok, false);
  assert.equal(hidden.error, "REVENUE_LEAK_SOURCE_UNAVAILABLE");
  assert.equal(store.state.revenue_leak_cases.length, 2);
});
