"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRevenueLeakCaseDetection
} = require("../src/revenueLeakCases/revenueLeakCaseDomain");
const {
  OPERATING_QUEUE_LIMIT,
  PORTFOLIO_SCAN_LIMIT,
  buildRevenueLeakOperatingQueue
} = require("../src/revenueLeakCases/revenueLeakOperatingQueue");
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

function opportunity(id, overrides = {}) {
  return {
    id,
    business_name: `Business ${id}`,
    stage: "PROPOSAL",
    next_action: "",
    value: "100",
    currency: "AUD",
    created_at: atOffset(60),
    updated_at: atOffset(1),
    ...overrides
  };
}

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
      return structuredClone(
        (state[name] || []).find(record => record.id === id) || null
      );
    }
  };
}

function tenantService(store, options = {}) {
  let nextId = 0;
  const service = createRevenueLeakCaseService({
    persistence: createPersistence({ adapter: "json", store }),
    createId: options.createId || (() => `portfolio-case-${++nextId}`),
    clock: () => new Date(EVALUATED_AT)
  });
  return service.forTenant(createTenantContext({
    tenantId: LOCAL_REVENUE_LEAK_TENANT_ID,
    subjectId: "portfolio-operator"
  }));
}

test("tenant-wide scan preserves all five outcomes and stable reconciliation summaries", async () => {
  const store = createMemoryStore({
    prospects: [],
    opportunities: [
      opportunity("detected"),
      opportunity("no-leak"),
      opportunity("insufficient", { stage: null, created_at: undefined }),
      opportunity("stale-source", {
        created_at: atOffset(91),
        updated_at: atOffset(91)
      }),
      opportunity("data-health", { value: "malformed" })
    ].reverse(),
    activities: [
      {
        id: "detected-activity",
        opportunity_id: "detected",
        type: "FOLLOW_UP_RECORDED",
        created_at: atOffset(14),
        updated_at: atOffset(14)
      },
      {
        id: "recent-activity",
        opportunity_id: "no-leak",
        type: "FOLLOW_UP_RECORDED",
        created_at: atOffset(2),
        updated_at: atOffset(2)
      }
    ],
    tasks: [],
    revenue_actions: [],
    revenue_leak_cases: []
  });
  const service = tenantService(store);

  const first = await service.scanStalledOpportunities();

  assert.equal(first.ok, true);
  assert.deepEqual(first.summary, {
    complete: true,
    limit: PORTFOLIO_SCAN_LIMIT,
    total_opportunities: 5,
    evaluated_count: 5,
    unevaluated_count: 0,
    overflow_count: 0,
    invalid_record_count: 0,
    excluded_count: 0,
    reconciliation: {
      detected_count: 1,
      created_count: 1,
      replayed_count: 0,
      superseded_count: 0
    },
    outcomes: {
      ELIGIBLE_LEAK_DETECTED: {
        count: 1,
        reasons: { STALE_WITHOUT_NEXT_ACTION: 1 }
      },
      ELIGIBLE_NO_LEAK: {
        count: 1,
        reasons: { RECENT_MEANINGFUL_ACTIVITY: 1 }
      },
      INSUFFICIENT_EVIDENCE: {
        count: 1,
        reasons: { OPPORTUNITY_STAGE_MISSING: 1 }
      },
      STALE_OR_UNTRUSTWORTHY_SOURCE: {
        count: 1,
        reasons: { CANONICAL_SOURCE_TOO_OLD: 1 }
      },
      DATA_HEALTH_SUPPRESSED: {
        count: 1,
        reasons: { COMMERCIAL_VALUE_INVALID: 1 }
      }
    }
  });
  assert.deepEqual(
    first.results.map(result => [
      result.opportunity_id,
      result.outcome,
      result.reason_code,
      result.disposition
    ]),
    [
      ["data-health", "DATA_HEALTH_SUPPRESSED", "COMMERCIAL_VALUE_INVALID", "READ_ONLY"],
      ["detected", "ELIGIBLE_LEAK_DETECTED", "STALE_WITHOUT_NEXT_ACTION", "CREATED"],
      ["insufficient", "INSUFFICIENT_EVIDENCE", "OPPORTUNITY_STAGE_MISSING", "READ_ONLY"],
      ["no-leak", "ELIGIBLE_NO_LEAK", "RECENT_MEANINGFUL_ACTIVITY", "READ_ONLY"],
      ["stale-source", "STALE_OR_UNTRUSTWORTHY_SOURCE", "CANONICAL_SOURCE_TOO_OLD", "READ_ONLY"]
    ]
  );
  assert.equal(store.state.revenue_leak_cases.length, 1);
  assert.deepEqual(store.state.pilot_evidence_events.map(event => ({
    event_type: event.event_type,
    facts: event.facts
  })), [{
    event_type: "PORTFOLIO_SCAN_COMPLETED",
    facts: {
      evaluated_count: 5,
      eligible_leak_count: 1,
      eligible_no_leak_count: 1,
      insufficient_evidence_count: 1,
      stale_source_count: 1,
      data_health_suppressed_count: 1,
      excluded_count: 0
    }
  }]);

  const replay = await service.scanStalledOpportunities();
  assert.deepEqual(replay.summary.reconciliation, {
    detected_count: 1,
    created_count: 0,
    replayed_count: 1,
    superseded_count: 0
  });
  assert.equal(
    replay.results.find(result => result.opportunity_id === "detected").disposition,
    "REPLAYED"
  );

  const detected = store.state.opportunities.find(item => item.id === "detected");
  detected.stage = "MEETING";
  const changed = await service.scanStalledOpportunities();
  assert.deepEqual(changed.summary.reconciliation, {
    detected_count: 1,
    created_count: 0,
    replayed_count: 0,
    superseded_count: 1
  });
  assert.equal(
    changed.results.find(result => result.opportunity_id === "detected").disposition,
    "SUPERSEDED"
  );
  assert.equal(store.state.revenue_leak_cases.length, 2);
  assert.equal(store.state.revenue_leak_cases[0].state, "SUPERSEDED");
  assert.equal(store.state.pilot_evidence_events.length, 1);
});

test("over-cap and invalid portfolio scans fail before any case mutation", async () => {
  const overflowStore = createMemoryStore({
    opportunities: Array.from(
      { length: PORTFOLIO_SCAN_LIMIT + 1 },
      (_, index) => opportunity(`opportunity-${String(index).padStart(3, "0")}`)
    ),
    activities: [],
    tasks: [],
    revenue_actions: [],
    revenue_leak_cases: []
  });
  const overflow = await tenantService(overflowStore).scanStalledOpportunities();
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error, "REVENUE_LEAK_SCAN_LIMIT_EXCEEDED");
  assert.deepEqual(overflow.details, {
    complete: false,
    limit: PORTFOLIO_SCAN_LIMIT,
    total_opportunities: PORTFOLIO_SCAN_LIMIT + 1,
    evaluated_count: 0,
    unevaluated_count: PORTFOLIO_SCAN_LIMIT + 1,
    overflow_count: 1,
    invalid_record_count: 0,
    excluded_count: 0
  });
  assert.deepEqual(overflowStore.state.revenue_leak_cases, []);

  const invalidStore = createMemoryStore({
    opportunities: [opportunity("duplicate"), opportunity("duplicate")],
    activities: [],
    tasks: [],
    revenue_actions: [],
    revenue_leak_cases: []
  });
  const invalid = await tenantService(invalidStore).scanStalledOpportunities();
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "REVENUE_LEAK_SCAN_SOURCE_INVALID");
  assert.equal(invalid.details.complete, false);
  assert.equal(invalid.details.invalid_record_count, 2);
  assert.equal(invalid.details.evaluated_count, 0);
  assert.equal(invalid.details.unevaluated_count, 2);
  assert.deepEqual(invalidStore.state.revenue_leak_cases, []);
});

for (const [label, invalidId] of [
  ["whitespace-padded", " padded-opportunity "],
  ["overlength", "o".repeat(513)]
]) {
  test(`JSON scan rejects ${label} canonical opportunity IDs before mutation`, async () => {
    const store = createMemoryStore({
      opportunities: [opportunity(invalidId)],
      activities: [],
      tasks: [],
      revenue_actions: [],
      revenue_leak_cases: []
    });

    const result = await tenantService(store).scanStalledOpportunities();

    assert.equal(result.ok, false);
    assert.equal(result.error, "REVENUE_LEAK_SCAN_SOURCE_INVALID");
    assert.equal(
      result.message,
      "Canonical opportunity identities are invalid or duplicated."
    );
    assert.deepEqual(result.details, {
      complete: false,
      limit: PORTFOLIO_SCAN_LIMIT,
      total_opportunities: 1,
      evaluated_count: 0,
      unevaluated_count: 1,
      overflow_count: 0,
      invalid_record_count: 1,
      excluded_count: 0
    });
    assert.deepEqual(store.state.revenue_leak_cases, []);
  });
}

test("JSON scan reconciliation failure never leaves a partial case batch", async () => {
  const store = createMemoryStore({
    opportunities: [opportunity("detected-a"), opportunity("detected-b")],
    activities: [],
    tasks: [],
    revenue_actions: [],
    revenue_leak_cases: []
  });
  const service = tenantService(store, {
    createId: () => "duplicate-generated-case-id"
  });

  const failure = await service.scanStalledOpportunities();
  assert.equal(failure.ok, false);
  assert.equal(failure.error, "REVENUE_LEAK_CASE_INTEGRITY_CONFLICT");
  assert.deepEqual(store.state.revenue_leak_cases, []);
});

function queueCase({
  id,
  opportunityId = id,
  detectedAt = "2026-08-01T00:00:00.000Z",
  dueAt = null,
  commercialValue = { classification: "UNKNOWN" }
}) {
  return buildRevenueLeakCaseDetection({
    leak_type: "STALLED_OPPORTUNITY",
    source: {
      system: "TGE",
      entity_type: "OPPORTUNITY",
      entity_id: opportunityId,
      observed_at: detectedAt,
      observed_version: `version-${id}`
    },
    detector: { id: "stalled-opportunity", version: "1" },
    reason_code: "STALE_WITHOUT_NEXT_ACTION",
    evidence_classification: "MIXED",
    evidence: {
      activity_baseline: {
        kind: "OPPORTUNITY_CREATED",
        entity_id: null,
        at: detectedAt
      }
    },
    commercial_value: commercialValue,
    recommended_action_type: "FOLLOW_UP",
    due_at: dueAt,
    supersession_condition: {
      kind: "CANONICAL_EVIDENCE_CHANGED",
      detector_id: "stalled-opportunity",
      detector_version: "1"
    }
  }, {
    id,
    detectedAt,
    subjectId: "queue-operator"
  });
}

test("operating queue preserves money truth, canonical context, linked action status, and stable ordering", () => {
  const cases = [
    queueCase({
      id: "case-aud-z",
      commercialValue: { classification: "KNOWN", amount: "100.250000", currency: "AUD" }
    }),
    queueCase({
      id: "case-aud-a",
      commercialValue: { classification: "KNOWN", amount: "100.25", currency: "AUD" }
    }),
    queueCase({
      id: "case-usd",
      commercialValue: { classification: "KNOWN", amount: "9000", currency: "USD" }
    }),
    queueCase({
      id: "case-zero",
      commercialValue: { classification: "KNOWN", amount: "0", currency: "AUD" }
    }),
    queueCase({ id: "case-unknown" }),
    queueCase({
      id: "case-na",
      commercialValue: { classification: "NOT_APPLICABLE" }
    })
  ];
  const contexts = cases.map(record => ({
    case: record,
    opportunity: {
      id: record.opportunity_id,
      prospect_id: `prospect-${record.id}`,
      business_name: `Opportunity ${record.id}`
    },
    business: {
      id: `prospect-${record.id}`,
      business_name: `Business ${record.id}`
    },
    revenue_action: null
  }));
  const linkedIndex = contexts.findIndex(item => item.case.id === "case-aud-a");
  contexts[linkedIndex] = {
    ...contexts[linkedIndex],
    case: {
      ...contexts[linkedIndex].case,
      revenue_action_id: "action-linked",
      revenue_action_fingerprint: "a".repeat(64),
      revenue_action_status_at_link: "RECOMMENDED",
      revenue_action_linked_at: "2026-08-02T00:00:00.000Z"
    },
    revenue_action: {
      id: "action-linked",
      opportunity_id: "case-aud-a",
      basis_fingerprint: "a".repeat(64),
      status: "EXECUTED"
    }
  };
  const original = structuredClone(contexts);

  const queue = buildRevenueLeakOperatingQueue({
    contexts: [...contexts].reverse(),
    totalCount: contexts.length,
    generatedAt: EVALUATED_AT
  });

  assert.equal(queue.complete, true);
  assert.equal(queue.limit, OPERATING_QUEUE_LIMIT);
  assert.equal(queue.total_cases, 6);
  assert.deepEqual(queue.value_summary, {
    known_positive: {
      case_count: 3,
      totals_by_currency: [
        { currency: "AUD", amount: "200.5", case_count: 2 },
        { currency: "USD", amount: "9000", case_count: 1 }
      ]
    },
    known_zero: {
      case_count: 1,
      counts_by_currency: [{ currency: "AUD", case_count: 1 }]
    },
    unknown: { case_count: 1 },
    not_applicable: { case_count: 1 }
  });
  assert.deepEqual(
    queue.entries.map(entry => entry.case.id),
    [
      "case-aud-a",
      "case-aud-z",
      "case-usd",
      "case-zero",
      "case-unknown",
      "case-na"
    ]
  );
  const linked = queue.entries[0];
  assert.deepEqual(linked.opportunity, {
    id: "case-aud-a",
    prospect_id: "prospect-case-aud-a",
    business_name: "Opportunity case-aud-a"
  });
  assert.equal(linked.data_origin, "EXISTING_CUSTOMER");
  assert.deepEqual(linked.business, {
    id: "prospect-case-aud-a",
    name: "Business case-aud-a"
  });
  assert.deepEqual(linked.linked_revenue_action, {
    id: "action-linked",
    snapshot: {
      basis_fingerprint: "a".repeat(64),
      status: "RECOMMENDED",
      linked_at: "2026-08-02T00:00:00.000Z"
    },
    current: { status: "EXECUTED" }
  });
  assert.equal(linked.leak_age.basis, "DETECTED_AT");
  assert.equal(linked.leak_age.elapsed_days, 31);
  assert.equal(Object.hasOwn(linked, "probability"), false);
  assert.equal(Object.hasOwn(queue, "recovered_revenue"), false);
  assert.equal(queue.ordering.stable_final_tie_breaker, "case.id ASC");
  assert.deepEqual(contexts, original);
});

test("operating queue labels imported and sample/demo cases without exposing provenance payloads", () => {
  const imported = queueCase({ id: "case-imported" });
  const sample = queueCase({ id: "case-sample" });
  const queue = buildRevenueLeakOperatingQueue({
    contexts: [
      {
        case: imported,
        opportunity: {
          id: imported.opportunity_id,
          metadata: { import: {
            batch_id: "batch-1",
            source_system: "private-crm",
            source_record_id: "private-source-id",
            raw_payload_sha256: "a".repeat(64)
          } }
        },
        business: null,
        revenue_action: null
      },
      {
        case: sample,
        opportunity: {
          id: sample.opportunity_id,
          metadata: { data_origin: "SAMPLE_DEMO" }
        },
        business: null,
        revenue_action: null
      }
    ],
    totalCount: 2,
    generatedAt: EVALUATED_AT
  });

  assert.deepEqual(queue.entries.map(entry => entry.data_origin).sort(), [
    "IMPORTED_CUSTOMER",
    "SAMPLE_DEMO"
  ]);
  assert.equal(JSON.stringify(queue).includes("private-crm"), false);
  assert.equal(JSON.stringify(queue).includes("private-source-id"), false);
  assert.equal(JSON.stringify(queue).includes("raw_payload_sha256"), false);
});

test("operating queue preserves historical source identity without fabricating current opportunity context", () => {
  const record = queueCase({
    id: "case-missing-current-opportunity",
    opportunityId: "historical-opportunity-id"
  });

  const queue = buildRevenueLeakOperatingQueue({
    contexts: [{
      case: record,
      opportunity: null,
      business: null,
      revenue_action: null
    }],
    totalCount: 1,
    generatedAt: EVALUATED_AT
  });

  assert.equal(queue.entries[0].opportunity, null);
  assert.equal(
    queue.entries[0].historical_opportunity_id,
    "historical-opportunity-id"
  );
  assert.equal(queue.entries[0].business, null);
});

test("operating queue refuses over-cap or incomplete repository projections", () => {
  assert.throws(
    () => buildRevenueLeakOperatingQueue({
      contexts: [],
      totalCount: OPERATING_QUEUE_LIMIT + 1,
      generatedAt: EVALUATED_AT
    }),
    error => {
      assert.equal(error.code, "REVENUE_LEAK_QUEUE_LIMIT_EXCEEDED");
      assert.deepEqual(error.details, {
        complete: false,
        limit: OPERATING_QUEUE_LIMIT,
        total_cases: OPERATING_QUEUE_LIMIT + 1,
        projected_count: 0,
        omitted_count: OPERATING_QUEUE_LIMIT + 1
      });
      return true;
    }
  );
  assert.throws(
    () => buildRevenueLeakOperatingQueue({
      contexts: [],
      totalCount: 1,
      generatedAt: EVALUATED_AT
    }),
    error => error.code === "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT"
  );
});

test("operating queue derives urgency in the published order and retains exact timestamp tie-breaking", () => {
  const context = record => ({
    case: record,
    opportunity: null,
    business: null,
    revenue_action: null
  });
  const overdue = queueCase({
    id: "case-z-overdue",
    dueAt: "2026-08-31T00:00:00.000Z"
  });
  const wakeDue = {
    ...queueCase({ id: "case-y-wake-due" }),
    state: "SNOOZED",
    snoozed_until: "2026-08-31T00:00:00.000Z"
  };
  const open = queueCase({
    id: "case-x-open",
    detectedAt: atOffset(30),
    dueAt: "2026-09-02T00:00:00.000Z"
  });
  const futureSnooze = {
    ...queueCase({ id: "case-w-future-snooze" }),
    state: "SNOOZED",
    snoozed_until: "2026-09-02T00:00:00.000Z"
  };
  const olderWithinSecond = queueCase({
    id: "case-z-older-within-second",
    detectedAt: atOffset(31, 100)
  });
  const youngerWithinSecond = queueCase({
    id: "case-a-younger-within-second",
    detectedAt: atOffset(31, 900)
  });

  const queue = buildRevenueLeakOperatingQueue({
    contexts: [
      context(futureSnooze),
      context(open),
      context(wakeDue),
      context(overdue),
      context(youngerWithinSecond),
      context(olderWithinSecond)
    ],
    totalCount: 6,
    generatedAt: EVALUATED_AT
  });

  assert.deepEqual(
    queue.entries.map(entry => [entry.case.id, entry.urgency.classification]),
    [
      ["case-z-overdue", "OVERDUE"],
      ["case-y-wake-due", "SNOOZE_WAKE_DUE"],
      ["case-z-older-within-second", "OPEN_NO_OVERDUE_DEADLINE"],
      ["case-a-younger-within-second", "OPEN_NO_OVERDUE_DEADLINE"],
      ["case-x-open", "OPEN_NO_OVERDUE_DEADLINE"],
      ["case-w-future-snooze", "SNOOZED_UNTIL_FUTURE"]
    ]
  );
});
