"use strict";

const {
  isExactZeroLiteral
} = require("../imports/numericEvidence");
const {
  DETECTOR,
  OUTCOMES,
  canonicalCommercialValue
} = require("./stalledOpportunityDetector");
const {
  PORTFOLIO_SCAN_LIMIT
} = require("./revenueLeakOperatingQueue");

const CLASSIFICATIONS = Object.freeze({
  ELIGIBLE: "ELIGIBLE",
  MISSING: "MISSING_REQUIRED_EVIDENCE",
  STALE: "STALE_EVIDENCE",
  SUPPRESSED: "SUPPRESSED_INVALID_EVIDENCE",
  BLOCKED: "SCAN_BLOCKED"
});

const OUTCOME_CLASSIFICATION = Object.freeze({
  [OUTCOMES.LEAK]: CLASSIFICATIONS.ELIGIBLE,
  [OUTCOMES.NO_LEAK]: CLASSIFICATIONS.ELIGIBLE,
  [OUTCOMES.INSUFFICIENT]: CLASSIFICATIONS.MISSING,
  [OUTCOMES.STALE_SOURCE]: CLASSIFICATIONS.STALE,
  [OUTCOMES.DATA_HEALTH]: CLASSIFICATIONS.SUPPRESSED
});

const NEXT_STEP_BY_REASON = Object.freeze({
  STALE_WITHOUT_NEXT_ACTION: "RUN_EXPLICIT_SCAN",
  OPPORTUNITY_CLOSED: "RUN_EXPLICIT_SCAN",
  RECENT_MEANINGFUL_ACTIVITY: "RUN_EXPLICIT_SCAN",
  NEXT_ACTION_PRESENT: "RUN_EXPLICIT_SCAN",
  OPPORTUNITY_STAGE_MISSING: "CORRECT_OPPORTUNITY_STAGE",
  MEANINGFUL_ACTIVITY_BASELINE_MISSING: "IMPORT_ACTIVITY_OR_CREATED_AT",
  CANONICAL_TIMESTAMP_IN_FUTURE: "CORRECT_TIMESTAMP_EVIDENCE",
  CANONICAL_SOURCE_TOO_OLD: "IMPORT_NEWER_SOURCE_DATA",
  OPPORTUNITY_EVIDENCE_INVALID: "CORRECT_OPPORTUNITY_EVIDENCE",
  OPPORTUNITY_STAGE_UNRECOGNIZED: "CORRECT_OPPORTUNITY_STAGE",
  CANONICAL_TIMESTAMP_INVALID: "CORRECT_TIMESTAMP_EVIDENCE",
  NEXT_ACTION_EVIDENCE_INVALID: "CORRECT_NEXT_ACTION_EVIDENCE",
  TASK_STATUS_UNRECOGNIZED: "CORRECT_TASK_STATUS",
  TASK_EVIDENCE_INVALID: "CORRECT_TASK_EVIDENCE",
  ACTIVITY_EVIDENCE_INVALID: "CORRECT_ACTIVITY_EVIDENCE",
  COMMERCIAL_VALUE_INVALID: "CORRECT_COMMERCIAL_EVIDENCE",
  COMMERCIAL_CURRENCY_INVALID: "CORRECT_COMMERCIAL_EVIDENCE"
});

function commercialValueCoverage(opportunity) {
  const commercial = canonicalCommercialValue(opportunity);
  if (commercial.error) {
    return {
      kind: "NOT_ASSESSED",
      amount: null,
      currency: null
    };
  }
  if (commercial.value.classification !== "KNOWN") {
    return {
      kind: "UNKNOWN",
      amount: null,
      currency: null
    };
  }
  return {
    kind: isExactZeroLiteral(commercial.value.amount)
      ? "KNOWN_ZERO"
      : "KNOWN_POSITIVE",
    amount: commercial.value.amount,
    currency: commercial.value.currency
  };
}

function opportunityName(opportunity) {
  if (
    typeof opportunity?.business_name !== "string"
    || opportunity.business_name.trim() === ""
    || opportunity.business_name !== opportunity.business_name.trim()
    || Buffer.byteLength(opportunity.business_name, "utf8") > 255
  ) return null;
  return opportunity.business_name;
}

function readinessState(total, assessable) {
  if (total === 0) return "EMPTY";
  if (assessable === total) return "READY";
  if (assessable === 0) return "NOT_READY";
  return "PARTIAL";
}

function emptyClassifications() {
  return {
    ELIGIBLE: 0,
    MISSING_REQUIRED_EVIDENCE: 0,
    STALE_EVIDENCE: 0,
    SUPPRESSED_INVALID_EVIDENCE: 0,
    SCAN_BLOCKED: 0
  };
}

function buildStalledOpportunityEligibility({
  evaluatedAt,
  evaluations,
  totalCount
}) {
  if (!Array.isArray(evaluations) || evaluations.length !== totalCount) {
    throw new TypeError("Complete stalled-opportunity evaluations are required.");
  }
  const classifications = emptyClassifications();
  const reasonCounts = {};
  const money = {
    known_positive_count: 0,
    known_zero_count: 0,
    unknown_count: 0,
    not_assessed_count: 0
  };
  const records = evaluations.map(({ opportunity, evaluation }) => {
    const classification = OUTCOME_CLASSIFICATION[evaluation.outcome];
    const nextStep = NEXT_STEP_BY_REASON[evaluation.reason_code];
    if (!classification || !nextStep) {
      throw new TypeError("Eligibility requires a closed detector outcome contract.");
    }
    classifications[classification] += 1;
    if (classification !== CLASSIFICATIONS.ELIGIBLE) {
      reasonCounts[evaluation.reason_code] =
        (reasonCounts[evaluation.reason_code] || 0) + 1;
    }
    const commercialValue = commercialValueCoverage(opportunity);
    if (commercialValue.kind === "KNOWN_POSITIVE") money.known_positive_count += 1;
    if (commercialValue.kind === "KNOWN_ZERO") money.known_zero_count += 1;
    if (commercialValue.kind === "UNKNOWN") money.unknown_count += 1;
    if (commercialValue.kind === "NOT_ASSESSED") money.not_assessed_count += 1;
    return {
      opportunity_id: opportunity.id,
      opportunity_name: opportunityName(opportunity),
      classification,
      detector_outcome: evaluation.outcome,
      reason_code: evaluation.reason_code,
      commercial_value: commercialValue,
      next_step: nextStep
    };
  });
  const orderedReasonCounts = Object.fromEntries(
    Object.entries(reasonCounts).sort(([left], [right]) => left.localeCompare(right))
  );
  const assessable = classifications.ELIGIBLE;
  return {
    ok: true,
    evaluated_at: evaluatedAt,
    detector: DETECTOR,
    scope: "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES",
    mode: "READ_ONLY",
    summary: {
      complete: true,
      limit: PORTFOLIO_SCAN_LIMIT,
      readiness: readinessState(totalCount, assessable),
      global_reason_code: null,
      total_opportunities: totalCount,
      detector_assessable_count: assessable,
      detector_unassessable_count: totalCount - assessable,
      scan_evaluated_count: totalCount,
      reason_counts: orderedReasonCounts,
      classifications,
      commercial_value_coverage: money
    },
    records
  };
}

function buildBlockedStalledOpportunityEligibility({
  evaluatedAt,
  totalCount,
  reasonCode
}) {
  if (reasonCode !== "PORTFOLIO_LIMIT_EXCEEDED") {
    throw new TypeError("Eligibility requires a closed global blocker contract.");
  }
  const classifications = emptyClassifications();
  classifications.SCAN_BLOCKED = totalCount;
  return {
    ok: true,
    evaluated_at: evaluatedAt,
    detector: DETECTOR,
    scope: "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES",
    mode: "READ_ONLY",
    summary: {
      complete: false,
      limit: PORTFOLIO_SCAN_LIMIT,
      readiness: "BLOCKED",
      global_reason_code: reasonCode,
      total_opportunities: totalCount,
      detector_assessable_count: 0,
      detector_unassessable_count: totalCount,
      scan_evaluated_count: 0,
      reason_counts: { [reasonCode]: totalCount },
      classifications,
      commercial_value_coverage: {
        known_positive_count: 0,
        known_zero_count: 0,
        unknown_count: 0,
        not_assessed_count: totalCount
      }
    },
    records: []
  };
}

module.exports = {
  CLASSIFICATIONS,
  NEXT_STEP_BY_REASON,
  OUTCOME_CLASSIFICATION,
  buildBlockedStalledOpportunityEligibility,
  buildStalledOpportunityEligibility
};
