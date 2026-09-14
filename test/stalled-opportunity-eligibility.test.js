"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

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
  PORTFOLIO_SCAN_LIMIT
} = require("../src/revenueLeakCases/revenueLeakOperatingQueue");
const {
  createRevenueLeakCaseService
} = require("../src/revenueLeakCases/revenueLeakCaseService");

const EVALUATED_AT = "2026-09-01T00:00:00.000Z";
const DAY_MS = 86400000;

function daysBefore(days) {
  return new Date(Date.parse(EVALUATED_AT) - days * DAY_MS).toISOString();
}

function opportunity(id, overrides = {}) {
  return {
    id,
    business_name: `Business ${id}`,
    stage: "PROPOSAL",
    next_action: "",
    value: "100",
    currency: "AUD",
    created_at: daysBefore(60),
    updated_at: daysBefore(1),
    ...overrides
  };
}

function memoryStore(seed) {
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

function serviceFor(seed, context = {}) {
  const store = memoryStore({
    prospects: [],
    opportunities: [],
    activities: [],
    tasks: [],
    revenue_actions: [],
    revenue_leak_cases: [],
    ...seed
  });
  const service = createRevenueLeakCaseService({
    persistence: createPersistence({ adapter: "json", store }),
    createId: () => "eligibility-case",
    clock: () => new Date(EVALUATED_AT)
  }).forTenant(createTenantContext({
    tenantId: context.tenantId || LOCAL_REVENUE_LEAK_TENANT_ID,
    subjectId: "eligibility-operator"
  }));
  return { service, store };
}

test("server projection reuses detector outcomes and reconciles partial coverage", async () => {
  const { service, store } = serviceFor({
    opportunities: [
      opportunity("eligible-positive"),
      opportunity("eligible-zero", { value: "0", next_action: "Call buyer" }),
      opportunity("missing", { stage: null, value: null, currency: null }),
      opportunity("stale", {
        created_at: daysBefore(91),
        updated_at: daysBefore(91),
        value: null,
        currency: null
      }),
      opportunity("invalid", { value: "not-money" })
    ]
  });

  const readiness = await service.getStalledOpportunityEligibility();

  assert.equal(readiness.ok, true);
  assert.equal(readiness.mode, "READ_ONLY");
  assert.deepEqual(readiness.detector, { id: "stalled-opportunity", version: "1" });
  assert.deepEqual(readiness.summary, {
    complete: true,
    limit: PORTFOLIO_SCAN_LIMIT,
    readiness: "PARTIAL",
    global_reason_code: null,
    total_opportunities: 5,
    detector_assessable_count: 2,
    detector_unassessable_count: 3,
    scan_evaluated_count: 5,
    reason_counts: {
      CANONICAL_SOURCE_TOO_OLD: 1,
      COMMERCIAL_VALUE_INVALID: 1,
      OPPORTUNITY_STAGE_MISSING: 1
    },
    classifications: {
      ELIGIBLE: 2,
      MISSING_REQUIRED_EVIDENCE: 1,
      STALE_EVIDENCE: 1,
      SUPPRESSED_INVALID_EVIDENCE: 1,
      SCAN_BLOCKED: 0
    },
    commercial_value_coverage: {
      known_positive_count: 1,
      known_zero_count: 1,
      unknown_count: 3,
      not_assessed_count: 0
    }
  });
  assert.deepEqual(readiness.records.map(record => [
    record.opportunity_id,
    record.classification,
    record.detector_outcome,
    record.reason_code,
    record.commercial_value.kind,
    record.next_step
  ]), [
    ["eligible-positive", "ELIGIBLE", "ELIGIBLE_LEAK_DETECTED", "STALE_WITHOUT_NEXT_ACTION", "KNOWN_POSITIVE", "RUN_EXPLICIT_SCAN"],
    ["eligible-zero", "ELIGIBLE", "ELIGIBLE_NO_LEAK", "NEXT_ACTION_PRESENT", "KNOWN_ZERO", "RUN_EXPLICIT_SCAN"],
    ["invalid", "SUPPRESSED_INVALID_EVIDENCE", "DATA_HEALTH_SUPPRESSED", "COMMERCIAL_VALUE_INVALID", "UNKNOWN", "CORRECT_COMMERCIAL_EVIDENCE"],
    ["missing", "MISSING_REQUIRED_EVIDENCE", "INSUFFICIENT_EVIDENCE", "OPPORTUNITY_STAGE_MISSING", "UNKNOWN", "CORRECT_OPPORTUNITY_STAGE"],
    ["stale", "STALE_EVIDENCE", "STALE_OR_UNTRUSTWORTHY_SOURCE", "CANONICAL_SOURCE_TOO_OLD", "UNKNOWN", "IMPORT_NEWER_SOURCE_DATA"]
  ]);
  assert.deepEqual(store.state.revenue_leak_cases, []);
  assert.deepEqual(store.state.pilot_evidence_events || [], []);
});

test("empty, all-eligible, and no-eligible readiness remain distinct", async () => {
  const empty = await serviceFor({}).service.getStalledOpportunityEligibility();
  assert.equal(empty.summary.readiness, "EMPTY");
  assert.equal(empty.summary.total_opportunities, 0);

  const all = await serviceFor({
    opportunities: [opportunity("a"), opportunity("b", { value: "0" })]
  }).service.getStalledOpportunityEligibility();
  assert.equal(all.summary.readiness, "READY");
  assert.equal(all.summary.detector_assessable_count, 2);
  assert.equal(all.summary.detector_unassessable_count, 0);

  const none = await serviceFor({
    opportunities: [opportunity("missing", { stage: null })]
  }).service.getStalledOpportunityEligibility();
  assert.equal(none.summary.readiness, "NOT_READY");
  assert.equal(none.summary.detector_assessable_count, 0);
  assert.equal(none.summary.detector_unassessable_count, 1);
});

test("readiness and explicit scan use the same detector decision for the same truth", async () => {
  const { service, store } = serviceFor({
    opportunities: [
      opportunity("a"),
      opportunity("b", { stage: null }),
      opportunity("c", { next_action: "Follow up" })
    ]
  });
  const readiness = await service.getStalledOpportunityEligibility();
  const scan = await service.scanStalledOpportunities();

  assert.deepEqual(
    readiness.records.map(record => [
      record.opportunity_id,
      record.detector_outcome,
      record.reason_code
    ]),
    scan.results.map(record => [
      record.opportunity_id,
      record.outcome,
      record.reason_code
    ])
  );
  assert.equal(store.state.revenue_leak_cases.length, 1);
  assert.equal(store.state.pilot_evidence_events.length, 1);
});

test("readiness uses the exact cross-runtime opportunity ID order required by the browser", async () => {
  const { service } = serviceFor({
    opportunities: ["a", "A", "_", "-", "0"].map(id =>
      opportunity(id, { next_action: "Follow up" })
    )
  });
  const readiness = await service.getStalledOpportunityEligibility();
  assert.deepEqual(
    readiness.records.map(item => item.opportunity_id),
    ["-", "0", "A", "_", "a"]
  );
  const {
    unwrapStalledOpportunityEligibilityResponse
  } = await import("../web/lib/revenueLeakCaseContracts.mjs");
  assert.deepEqual(
    unwrapStalledOpportunityEligibilityResponse(readiness, new Date(EVALUATED_AT)),
    readiness
  );
});

test("over-limit portfolios are truthfully blocked before record assessment", async () => {
  const opportunities = Array.from(
    { length: PORTFOLIO_SCAN_LIMIT + 1 },
    (_, index) => opportunity(`opportunity-${String(index).padStart(3, "0")}`)
  );
  const { service } = serviceFor({ opportunities });

  const readiness = await service.getStalledOpportunityEligibility();

  assert.equal(readiness.ok, true);
  assert.equal(readiness.summary.complete, false);
  assert.equal(readiness.summary.readiness, "BLOCKED");
  assert.equal(readiness.summary.global_reason_code, "PORTFOLIO_LIMIT_EXCEEDED");
  assert.equal(readiness.summary.total_opportunities, PORTFOLIO_SCAN_LIMIT + 1);
  assert.equal(readiness.summary.scan_evaluated_count, 0);
  assert.equal(readiness.summary.classifications.SCAN_BLOCKED, PORTFOLIO_SCAN_LIMIT + 1);
  assert.deepEqual(readiness.summary.commercial_value_coverage, {
    known_positive_count: 0,
    known_zero_count: 0,
    unknown_count: 0,
    not_assessed_count: PORTFOLIO_SCAN_LIMIT + 1
  });
  assert.deepEqual(readiness.records, []);

  const {
    unwrapStalledOpportunityEligibilityResponse
  } = await import("../web/lib/revenueLeakCaseContracts.mjs");
  assert.deepEqual(
    unwrapStalledOpportunityEligibilityResponse(readiness, new Date(EVALUATED_AT)),
    readiness
  );
  const inferredUnknown = structuredClone(readiness);
  inferredUnknown.summary.commercial_value_coverage.unknown_count =
    PORTFOLIO_SCAN_LIMIT + 1;
  inferredUnknown.summary.commercial_value_coverage.not_assessed_count = 0;
  assert.throws(
    () => unwrapStalledOpportunityEligibilityResponse(
      inferredUnknown,
      new Date(EVALUATED_AT)
    ),
    error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
  );
});

test("JSON readiness rejects non-local tenant contexts before reading records", async () => {
  const { service } = serviceFor({
    opportunities: [opportunity("tenant-a-secret")]
  }, { tenantId: "00000000-0000-4000-8000-000000000099" });

  const readiness = await service.getStalledOpportunityEligibility();

  assert.equal(readiness.ok, false);
  assert.equal(readiness.error, "REVENUE_LEAK_SOURCE_UNAVAILABLE");
  assert.equal(JSON.stringify(readiness).includes("tenant-a-secret"), false);
});

test("browser validates authoritative readiness and fails closed on promoted records", async () => {
  const {
    unwrapStalledOpportunityEligibilityResponse
  } = await import("../web/lib/revenueLeakCaseContracts.mjs");
  const { service } = serviceFor({
    opportunities: [opportunity("a"), opportunity("b", { stage: null })]
  });
  const response = await service.getStalledOpportunityEligibility();

  assert.deepEqual(
    unwrapStalledOpportunityEligibilityResponse(response, new Date(EVALUATED_AT)),
    response
  );
  const promoted = structuredClone(response);
  promoted.records[1].classification = "ELIGIBLE";
  assert.throws(
    () => unwrapStalledOpportunityEligibilityResponse(
      promoted,
      new Date(EVALUATED_AT)
    ),
    error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
  );
  const falseReady = structuredClone(response);
  falseReady.summary.readiness = "READY";
  assert.throws(
    () => unwrapStalledOpportunityEligibilityResponse(
      falseReady,
      new Date(EVALUATED_AT)
    ),
    error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
  );

  const source = fs.readFileSync(
    path.join(process.cwd(), "web/components/RevenueCommandCenter.jsx"),
    "utf8"
  );
  assert.match(source, /Operational Data Health/);
  assert.match(source, /getStalledOpportunityEligibility/);
  assert.match(source, /summary\.detector_assessable_count/);
  assert.doesNotMatch(source, /evaluateStalledOpportunity/);
});
