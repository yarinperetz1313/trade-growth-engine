"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildRevenueLeakCaseDetection
} = require("../src/revenueLeakCases/revenueLeakCaseDomain");
const {
  buildRevenueLeakOperatingQueue
} = require("../src/revenueLeakCases/revenueLeakOperatingQueue");

const browserContracts = import(
  "../web/lib/revenueLeakCaseContracts.mjs"
);
const repositoryRoot = path.resolve(__dirname, "..");
const GENERATED_AT = "2026-09-08T00:00:00.000Z";

function caseRecord({
  id,
  opportunityId = id,
  amount = null,
  currency = null,
  classification = amount === null ? "UNKNOWN" : "KNOWN",
  state = "OPEN",
  detectedAt = "2026-09-07T00:00:00.000Z"
}) {
  const commercialValue = classification === "KNOWN"
    ? { classification, amount, currency }
    : { classification };
  const record = buildRevenueLeakCaseDetection({
    leak_type: "STALLED_OPPORTUNITY",
    source: {
      system: "TGE",
      entity_type: "OPPORTUNITY",
      entity_id: opportunityId,
      observed_at: "2026-09-07T00:00:00.000Z",
      observed_version: `source-${id}`
    },
    detector: { id: "stalled-opportunity", version: "1" },
    reason_code: "STALE_WITHOUT_NEXT_ACTION",
    evidence_classification: "MIXED",
    evidence: {
      criteria: {
        stale_after_days: 14,
        stale_boundary: "AT_OR_AFTER",
        source_freshness_days: 90,
        source_freshness_boundary: "AT_OR_BEFORE"
      },
      opportunity_stage: "PROPOSAL",
      activity_baseline: {
        kind: "ACTIVITY",
        entity_id: `activity-${id}`,
        at: "2026-08-18T00:00:00.000Z"
      },
      stalled_since: "2026-09-01T00:00:00.000Z",
      next_action: {
        present: false,
        source: "NONE",
        opportunity_value: null,
        active_task_ids: []
      },
      source_freshness: {
        observed_at: "2026-09-07T00:00:00.000Z",
        maximum_age_days: 90
      },
      commercial_value_basis: classification === "KNOWN"
        ? {
            classification: "KNOWN",
            amount_source: "opportunity.value",
            currency_source: "opportunity.currency"
          }
        : classification === "NOT_APPLICABLE"
          ? { classification: "NOT_APPLICABLE" }
          : {
              classification: "UNKNOWN",
              reason: "VALUE_UNKNOWN",
              currency_present: false
            }
    },
    commercial_value: commercialValue,
    recommended_action_type: "FOLLOW_UP",
    due_at: null,
    supersession_condition: {
      kind: "CANONICAL_EVIDENCE_CHANGED",
      detector_id: "stalled-opportunity",
      detector_version: "1"
    }
  }, {
    id,
    detectedAt,
    subjectId: "auth0|browser-contract"
  });
  return state === "SNOOZED"
    ? {
        ...record,
        state,
        snoozed_at: "2026-09-02T00:00:00.000Z",
        snoozed_until: "2026-09-10T00:00:00.000Z"
      }
    : record;
}

function queueResponse() {
  const records = [
    caseRecord({ id: "case-aud", amount: "1200.5", currency: "AUD" }),
    caseRecord({ id: "case-usd", amount: "9000", currency: "USD" }),
    caseRecord({ id: "case-zero", amount: "0", currency: "AUD" }),
    caseRecord({ id: "case-unknown" }),
    caseRecord({ id: "case-na", classification: "NOT_APPLICABLE" })
  ];
  const contexts = records.map(record => ({
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
  return {
    ok: true,
    data: buildRevenueLeakOperatingQueue({
      contexts,
      totalCount: contexts.length,
      generatedAt: GENERATED_AT
    })
  };
}

function scanResponse() {
  return {
    ok: true,
    evaluated_at: GENERATED_AT,
    detector: { id: "stalled-opportunity", version: "1" },
    scope: "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES",
    summary: {
      complete: true,
      limit: 100,
      total_opportunities: 2,
      evaluated_count: 2,
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
          reasons: { NEXT_ACTION_PRESENT: 1 }
        },
        INSUFFICIENT_EVIDENCE: { count: 0, reasons: {} },
        STALE_OR_UNTRUSTWORTHY_SOURCE: { count: 0, reasons: {} },
        DATA_HEALTH_SUPPRESSED: { count: 0, reasons: {} }
      }
    },
    results: [
      {
        opportunity_id: "opp-a",
        outcome: "ELIGIBLE_LEAK_DETECTED",
        reason_code: "STALE_WITHOUT_NEXT_ACTION",
        disposition: "CREATED",
        case_id: "case-a",
        superseded_case_id: null
      },
      {
        opportunity_id: "opp-b",
        outcome: "ELIGIBLE_NO_LEAK",
        reason_code: "NEXT_ACTION_PRESENT",
        disposition: "READ_ONLY",
        case_id: null,
        superseded_case_id: null
      }
    ]
  };
}

test("browser accepts the complete queue without changing authoritative server order", async () => {
  const { unwrapRevenueLeakOperatingQueueResponse } = await browserContracts;
  const response = structuredClone(queueResponse());
  const entries = unwrapRevenueLeakOperatingQueueResponse(
    response,
    new Date(GENERATED_AT)
  );

  assert.equal(entries, response.data);
  assert.deepEqual(entries.entries.map(entry => entry.case.id), [
    "case-aud",
    "case-usd",
    "case-zero",
    "case-unknown",
    "case-na"
  ]);
  assert.deepEqual(entries.value_summary.known_positive.totals_by_currency, [
    { currency: "AUD", amount: "1200.5", case_count: 1 },
    { currency: "USD", amount: "9000", case_count: 1 }
  ]);
  assert.equal(entries.value_summary.known_zero.case_count, 1);
  assert.equal(entries.value_summary.unknown.case_count, 1);
  assert.equal(entries.value_summary.not_applicable.case_count, 1);
});

test("browser rejects partial, malformed, re-ranked, or cross-currency-coerced queue truth", async () => {
  const { unwrapRevenueLeakOperatingQueueResponse } = await browserContracts;
  const assertInvalid = mutate => {
    const response = structuredClone(queueResponse());
    mutate(response.data);
    assert.throws(
      () => unwrapRevenueLeakOperatingQueueResponse(
        response,
        new Date(GENERATED_AT)
      ),
      error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
    );
  };

  assertInvalid(queue => { queue.complete = false; });
  assertInvalid(queue => { queue.projected_count -= 1; });
  assertInvalid(queue => { queue.entries.reverse(); });
  assertInvalid(queue => {
    queue.value_summary.known_positive.totals_by_currency = [{
      currency: "AUD",
      amount: "10200.5",
      case_count: 2
    }];
  });
  assertInvalid(queue => {
    queue.entries[0].case.evidence_snapshot.facts.next_action.present = true;
  });
  assertInvalid(queue => {
    queue.entries[1].case.id = queue.entries[0].case.id;
    queue.entries[1].ordering_factors.stable_case_id = queue.entries[0].case.id;
  });
  assertInvalid(queue => { queue.entries[0].invented_owner = "owner-1"; });
  assertInvalid(queue => { queue.entries[0].business.name = 42; });
  assertInvalid(queue => {
    queue.entries[0].ordering_factors.leak_age_milliseconds = "86400000";
  });
});

test("browser accepts alphabetical currency summaries when urgency places USD first", async () => {
  const { unwrapRevenueLeakOperatingQueueResponse } = await browserContracts;
  const response = structuredClone(queueResponse());
  const usdIndex = response.data.entries.findIndex(entry =>
    entry.potential_value.currency === "USD"
  );
  const usd = response.data.entries.splice(usdIndex, 1)[0];
  usd.case.due_at = "2026-09-07T12:00:00.000Z";
  usd.urgency = {
    classification: "OVERDUE",
    basis_timestamp: usd.case.due_at
  };
  usd.ordering_factors.urgency_tier = "OVERDUE";
  response.data.entries.unshift(usd);

  assert.equal(
    unwrapRevenueLeakOperatingQueueResponse(
      response,
      new Date(GENERATED_AT)
    ),
    response.data
  );
});

test("authoritative filters preserve server order and do not invent owner data", async () => {
  const {
    filterRevenueLeakOperatingQueue,
    unwrapRevenueLeakOperatingQueueResponse
  } = await browserContracts;
  const queue = unwrapRevenueLeakOperatingQueueResponse(
    queueResponse(),
    new Date(GENERATED_AT)
  );

  assert.deepEqual(
    filterRevenueLeakOperatingQueue(queue.entries, { value: "KNOWN_POSITIVE" })
      .map(entry => entry.case.id),
    ["case-aud", "case-usd"]
  );
  assert.deepEqual(
    filterRevenueLeakOperatingQueue(queue.entries, { source: "TGE" })
      .map(entry => entry.case.id),
    queue.entries.map(entry => entry.case.id)
  );
  assert.deepEqual(
    filterRevenueLeakOperatingQueue(queue.entries, { lifecycle: "SNOOZED" }),
    []
  );
  assert.throws(
    () => filterRevenueLeakOperatingQueue(queue.entries, { owner: "invented" }),
    /unsupported operating queue filter/i
  );
});

test("browser validates exact handoff identity and classifies queue failures", async () => {
  const {
    classifyRevenueLeakOperatingQueueError,
    unwrapRevenueLeakActionHandoffResponse
  } = await browserContracts;
  const queue = queueResponse().data;
  const sourceCase = caseRecord({
    id: "case-handoff",
    opportunityId: "opp-handoff",
    amount: "42000.5",
    currency: "AUD"
  });
  const action = {
    id: "action-handoff",
    opportunity_id: "opp-handoff",
    action_type: "CREATE_TASK",
    status: "RECOMMENDED",
    basis_fingerprint: "a".repeat(64)
  };
  const linkedCase = {
    ...sourceCase,
    revenue_action_id: action.id,
    revenue_action_fingerprint: action.basis_fingerprint,
    revenue_action_status_at_link: action.status,
    revenue_action_linked_at: GENERATED_AT,
    updated_at: GENERATED_AT,
    audit: [...sourceCase.audit, {
      transition: "REVENUE_ACTION_LINKED",
      at: GENERATED_AT,
      subject_id: "auth0|browser-contract",
      revenue_action_id: action.id,
      revenue_action_fingerprint: action.basis_fingerprint,
      revenue_action_status: action.status
    }]
  };
  const response = {
    ok: true,
    data: { case: linkedCase, revenue_action: action },
    handoff: {
      action_created: true,
      action_reused: false,
      link_created: true,
      reconciled: false
    }
  };
  assert.equal(
    unwrapRevenueLeakActionHandoffResponse(
      response,
      "case-handoff",
      "opp-handoff",
      new Date(GENERATED_AT)
    ),
    response
  );
  const wrongOpportunity = structuredClone(response);
  wrongOpportunity.data.revenue_action.opportunity_id = "other-opportunity";
  assert.throws(
    () => unwrapRevenueLeakActionHandoffResponse(
      wrongOpportunity,
      "case-handoff",
      "opp-handoff",
      new Date(GENERATED_AT)
    ),
    error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
  );

  assert.equal(classifyRevenueLeakOperatingQueueError({ status: 401 }), "UNAUTHORIZED");
  assert.equal(classifyRevenueLeakOperatingQueueError({
    code: "REVENUE_LEAK_QUEUE_LIMIT_EXCEEDED"
  }), "LIMIT");
  assert.equal(classifyRevenueLeakOperatingQueueError({
    code: "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT"
  }), "INTEGRITY");
  assert.equal(classifyRevenueLeakOperatingQueueError({ status: 503 }), "PERSISTENCE");
  assert.equal(classifyRevenueLeakOperatingQueueError({ status: 400 }), "API");
  assert.equal(queue.complete, true);
});

test("browser scan summary is complete, ordered, and reconciles durable dispositions", async () => {
  const { unwrapStalledOpportunityScanResponse } = await browserContracts;
  assert.equal(
    unwrapStalledOpportunityScanResponse(
      scanResponse(),
      new Date(GENERATED_AT)
    ).summary.reconciliation.created_count,
    1
  );
  const assertInvalid = mutate => {
    const response = structuredClone(scanResponse());
    mutate(response);
    assert.throws(
      () => unwrapStalledOpportunityScanResponse(
        response,
        new Date(GENERATED_AT)
      ),
      error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
    );
  };
  assertInvalid(response => { response.summary.reconciliation.detected_count = 2; });
  assertInvalid(response => { response.results[0].case_id = null; });
  assertInvalid(response => { response.results[1].case_id = "invented-case"; });
  assertInvalid(response => { response.results[1].opportunity_id = "opp-a"; });
  assertInvalid(response => { response.results.reverse(); });
  assertInvalid(response => { response.summary.invented_complete = true; });
});

test("Command Center source keeps action lifecycle controls in Opportunity Command Center", () => {
  const commandCenter = fs.readFileSync(
    path.join(repositoryRoot, "web/components/RevenueCommandCenter.jsx"),
    "utf8"
  );
  const api = fs.readFileSync(path.join(repositoryRoot, "web/lib/api.js"), "utf8");

  assert.match(commandCenter, /why TGE surfaced this/i);
  assert.match(commandCenter, /potential revenue at risk/i);
  assert.match(commandCenter, /approval required/i);
  assert.doesNotMatch(commandCenter, /transitionRevenueAction/);
  assert.doesNotMatch(commandCenter, /\.sort\s*\(/);
  assert.doesNotMatch(commandCenter, /recovered revenue|expected revenue|AI certainty/i);
  assert.match(api, /export async function getRevenueLeakOperatingQueue\b/);
  assert.match(api, /export async function createRevenueActionForLeakCase\b/);
  assert.doesNotMatch(api, /tenant[_-]?id.*operating-queue/i);
});
