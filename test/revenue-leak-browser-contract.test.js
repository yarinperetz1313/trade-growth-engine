"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const browserContracts = import(
  "../web/lib/revenueLeakCaseContracts.mjs"
);

const OUTCOME_EXPECTATIONS = [
  [
    "ELIGIBLE_LEAK_DETECTED",
    "STALE_WITHOUT_NEXT_ACTION",
    "Potential revenue leak detected",
    "The opportunity reached the stalled threshold without a meaningful next action."
  ],
  [
    "ELIGIBLE_NO_LEAK",
    "RECENT_MEANINGFUL_ACTIVITY",
    "No eligible stalled-opportunity leak",
    "Recorded meaningful activity is still inside the detector's stalled threshold."
  ],
  [
    "INSUFFICIENT_EVIDENCE",
    "MEANINGFUL_ACTIVITY_BASELINE_MISSING",
    "Evidence unavailable",
    "No canonical activity or opportunity-creation baseline is available."
  ],
  [
    "STALE_OR_UNTRUSTWORTHY_SOURCE",
    "CANONICAL_SOURCE_TOO_OLD",
    "Evidence stale or untrustworthy",
    "The newest canonical source observation is outside the detector's freshness window."
  ],
  [
    "DATA_HEALTH_SUPPRESSED",
    "OPPORTUNITY_STAGE_UNRECOGNIZED",
    "Evidence suppressed by Data Health",
    "The recorded opportunity stage is outside the detector's recognized stage contract."
  ]
];

const ALL_REASON_CODES = [
  "STALE_WITHOUT_NEXT_ACTION",
  "OPPORTUNITY_CLOSED",
  "RECENT_MEANINGFUL_ACTIVITY",
  "NEXT_ACTION_PRESENT",
  "OPPORTUNITY_STAGE_MISSING",
  "MEANINGFUL_ACTIVITY_BASELINE_MISSING",
  "CANONICAL_TIMESTAMP_IN_FUTURE",
  "CANONICAL_SOURCE_TOO_OLD",
  "OPPORTUNITY_EVIDENCE_INVALID",
  "OPPORTUNITY_STAGE_UNRECOGNIZED",
  "CANONICAL_TIMESTAMP_INVALID",
  "NEXT_ACTION_EVIDENCE_INVALID",
  "TASK_STATUS_UNRECOGNIZED",
  "TASK_EVIDENCE_INVALID",
  "ACTIVITY_EVIDENCE_INVALID",
  "COMMERCIAL_VALUE_INVALID",
  "COMMERCIAL_CURRENCY_INVALID"
];

test("browser contract keeps all five detector outcomes and closed reasons distinct", async () => {
  const {
    detectorOutcomePresentation,
    detectorReasonExplanation
  } = await browserContracts;

  for (const [outcome, reason, title, explanation] of OUTCOME_EXPECTATIONS) {
    assert.deepEqual(
      detectorOutcomePresentation(outcome, reason),
      {
        outcome,
        title,
        explanation,
        evidenceState: outcome === "ELIGIBLE_LEAK_DETECTED"
          || outcome === "ELIGIBLE_NO_LEAK"
          ? "AVAILABLE"
          : outcome === "INSUFFICIENT_EVIDENCE"
            ? "UNAVAILABLE"
            : outcome === "STALE_OR_UNTRUSTWORTHY_SOURCE"
              ? "STALE"
              : "SUPPRESSED"
      }
    );
  }

  for (const reason of ALL_REASON_CODES) {
    const explanation = detectorReasonExplanation(reason);
    assert.equal(typeof explanation, "string");
    assert.ok(explanation.length > 24, `${reason} needs a useful explanation`);
  }

  assert.notEqual(
    detectorOutcomePresentation(
      "DATA_HEALTH_SUPPRESSED",
      "COMMERCIAL_VALUE_INVALID"
    ).title,
    detectorOutcomePresentation(
      "ELIGIBLE_NO_LEAK",
      "NEXT_ACTION_PRESENT"
    ).title
  );
});

test("potential revenue at risk preserves known positive, known zero, unknown, and not applicable", async () => {
  const { formatPotentialRevenueAtRisk } = await browserContracts;

  assert.deepEqual(formatPotentialRevenueAtRisk({
    classification: "KNOWN",
    amount: "42000.5",
    currency: "AUD"
  }), {
    label: "Potential revenue at risk",
    value: "AUD 42,000.5",
    detail: "Known value"
  });
  assert.deepEqual(formatPotentialRevenueAtRisk({
    classification: "KNOWN",
    amount: "0",
    currency: "AUD"
  }), {
    label: "Potential revenue at risk",
    value: "AUD 0",
    detail: "Known zero"
  });
  assert.deepEqual(formatPotentialRevenueAtRisk({
    classification: "KNOWN",
    amount: "99999999999999.999999",
    currency: "AUD"
  }).value, "AUD 99,999,999,999,999.999999");
  assert.deepEqual(formatPotentialRevenueAtRisk({
    classification: "UNKNOWN",
    amount: null,
    currency: null
  }), {
    label: "Potential revenue at risk",
    value: "Unknown",
    detail: "Unknown value — no amount is claimed"
  });
  assert.deepEqual(formatPotentialRevenueAtRisk({
    classification: "NOT_APPLICABLE",
    amount: null,
    currency: null
  }), {
    label: "Potential revenue at risk",
    value: "Not applicable",
    detail: "Not applicable under the recorded case contract"
  });
});

test("browser lifecycle controls exactly mirror server-permitted case states", async () => {
  const { allowedRevenueLeakCaseActions } = await browserContracts;

  assert.deepEqual(
    allowedRevenueLeakCaseActions("OPEN"),
    ["SNOOZE", "DISMISS", "LINK_REVENUE_ACTION"]
  );
  assert.deepEqual(
    allowedRevenueLeakCaseActions("SNOOZED"),
    ["RESUME", "DISMISS", "LINK_REVENUE_ACTION"]
  );
  assert.deepEqual(allowedRevenueLeakCaseActions("DISMISSED"), []);
  assert.deepEqual(allowedRevenueLeakCaseActions("SUPERSEDED"), []);
  assert.deepEqual(allowedRevenueLeakCaseActions("unexpected"), []);
});

test("browser errors keep unauthorized, persistence, and other API failures distinct", async () => {
  const { classifyRevenueLeakCaseError } = await browserContracts;

  assert.equal(classifyRevenueLeakCaseError({ status: 401 }), "UNAUTHORIZED");
  assert.equal(classifyRevenueLeakCaseError({ status: 403 }), "UNAUTHORIZED");
  assert.equal(classifyRevenueLeakCaseError({
    code: "BROWSER_AUTH_UNAVAILABLE"
  }), "UNAUTHORIZED");
  assert.equal(classifyRevenueLeakCaseError({
    status: 500,
    code: "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE"
  }), "PERSISTENCE");
  assert.equal(classifyRevenueLeakCaseError({
    status: 503,
    code: "TENANT_PERSISTENCE_UNAVAILABLE"
  }), "PERSISTENCE");
  assert.equal(classifyRevenueLeakCaseError({ status: 404 }), "API");
});

test("browser response contracts fail closed instead of turning malformed success into empty or no leak", async () => {
  const {
    unwrapRevenueLeakCaseListResponse,
    unwrapRevenueLeakCaseMutationResponse,
    unwrapStalledOpportunityDetectionResponse
  } = await browserContracts;
  const validCase = {
    id: "case-1",
    leak_type: "STALLED_OPPORTUNITY",
    opportunity_id: "opp-1",
    source_system: "TGE",
    source_entity_type: "OPPORTUNITY",
    source_entity_id: "opp-1",
    source_observed_at: "2026-09-01T00:00:00.000Z",
    source_observed_version: "sha256:evidence",
    state: "OPEN",
    reason_code: "STALE_WITHOUT_NEXT_ACTION",
    detector_id: "stalled-opportunity",
    detector_version: "1",
    evidence_classification: "MIXED",
    evidence_snapshot: {
      classification: "MIXED",
      source_observation: {
        observed_at: "2026-09-01T00:00:00.000Z",
        observed_version: "sha256:evidence"
      },
      facts: { opportunity_stage: "PROPOSAL" }
    },
    commercial_value: {
      classification: "KNOWN",
      amount: "0",
      currency: "AUD"
    },
    detected_at: "2026-09-01T00:00:00.000Z",
    audit: [{
      transition: "OPEN",
      at: "2026-09-01T00:00:00.000Z",
      reason_code: "STALE_WITHOUT_NEXT_ACTION"
    }]
  };

  assert.deepEqual(
    unwrapRevenueLeakCaseListResponse({
      ok: true,
      data: [validCase],
      count: 1
    }, "opp-1"),
    [validCase]
  );
  for (const malformed of [
    { ok: true, data: {}, count: 0 },
    { ok: true, data: [validCase], count: 0 },
    { ok: true, data: [{ ...validCase, opportunity_id: "other" }], count: 1 },
    {
      ok: true,
      data: [{
        ...validCase,
        commercial_value: {
          classification: "KNOWN",
          amount: "0.000000",
          currency: "AUD"
        }
      }],
      count: 1
    }
  ]) {
    assert.throws(
      () => unwrapRevenueLeakCaseListResponse(malformed, "opp-1"),
      error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
    );
  }

  assert.equal(
    unwrapRevenueLeakCaseMutationResponse({ ok: true, data: validCase }, "opp-1"),
    validCase
  );
  assert.throws(
    () => unwrapRevenueLeakCaseMutationResponse({ ok: true, data: null }, "opp-1"),
    error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
  );

  const detectorBase = {
    ok: true,
    outcome: "ELIGIBLE_NO_LEAK",
    reason_code: "NEXT_ACTION_PRESENT",
    detector: { id: "stalled-opportunity", version: "1" },
    source: {
      system: "TGE",
      entity_type: "OPPORTUNITY",
      entity_id: "opp-1",
      observed_at: "2026-09-01T00:00:00.000Z",
      observed_version: "sha256:evidence"
    },
    evidence: { opportunity_stage: "PROPOSAL" },
    commercial_value: {
      classification: "UNKNOWN",
      amount: null,
      currency: null
    },
    case: null,
    reconciliation: null
  };
  assert.equal(
    unwrapStalledOpportunityDetectionResponse(detectorBase, "opp-1"),
    detectorBase
  );
  for (const malformed of [
    { ...detectorBase, reason_code: "COMMERCIAL_VALUE_INVALID" },
    { ...detectorBase, outcome: "ELIGIBLE_LEAK_DETECTED" },
    { ...detectorBase, detector: { id: "caller-detector", version: "1" } },
    { ...detectorBase, source: { ...detectorBase.source, entity_id: "other" } }
  ]) {
    assert.throws(
      () => unwrapStalledOpportunityDetectionResponse(malformed, "opp-1"),
      error => error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
    );
  }
});

test("browser API client and Opportunity Command Center expose only the bounded leak-case integration", () => {
  const apiSource = fs.readFileSync(
    path.join(repositoryRoot, "web/lib/api.js"),
    "utf8"
  );
  const commandCenterSource = fs.readFileSync(
    path.join(repositoryRoot, "web/components/OpportunityCommandCenter.jsx"),
    "utf8"
  );
  const panelSource = fs.readFileSync(
    path.join(repositoryRoot, "web/components/RevenueLeakCasePanel.jsx"),
    "utf8"
  );

  for (const name of [
    "getOpportunityRevenueLeakCases",
    "detectStalledOpportunity",
    "transitionRevenueLeakCase",
    "linkRevenueLeakCaseToAction"
  ]) {
    assert.match(apiSource, new RegExp(`export (?:async )?function ${name}\\b`));
  }
  assert.match(
    apiSource,
    /\/api\/opportunities\/\$\{encodeURIComponent\(opportunityId\)\}\/revenue-leak-cases\/detect-stalled/
  );
  assert.match(
    apiSource,
    /\/api\/revenue-leak-cases\/\$\{encodeURIComponent\(caseId\)\}\/link-revenue-action/
  );
  assert.doesNotMatch(apiSource, /tenant[_-]?id.*revenue-leak/i);

  assert.match(commandCenterSource, /<RevenueLeakCasePanel/);
  assert.match(commandCenterSource, /id="revenue-action-workflow"/);
  assert.match(panelSource, /why TGE surfaced this/i);
  assert.match(panelSource, /formatPotentialRevenueAtRisk/);
  assert.match(panelSource, /Nothing is sent by TGE/i);
  assert.doesNotMatch(panelSource, /recovered revenue|recovery total|customer impact/i);
  assert.doesNotMatch(panelSource, /transitionRevenueAction|createRevenueAction/);
});
