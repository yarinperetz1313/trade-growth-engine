const OUTCOME_TITLES = Object.freeze({
  ELIGIBLE_LEAK_DETECTED: "Potential revenue leak detected",
  ELIGIBLE_NO_LEAK: "No eligible stalled-opportunity leak",
  INSUFFICIENT_EVIDENCE: "Evidence unavailable",
  STALE_OR_UNTRUSTWORTHY_SOURCE: "Evidence stale or untrustworthy",
  DATA_HEALTH_SUPPRESSED: "Evidence suppressed by Data Health"
});

const OUTCOME_EVIDENCE_STATES = Object.freeze({
  ELIGIBLE_LEAK_DETECTED: "AVAILABLE",
  ELIGIBLE_NO_LEAK: "AVAILABLE",
  INSUFFICIENT_EVIDENCE: "UNAVAILABLE",
  STALE_OR_UNTRUSTWORTHY_SOURCE: "STALE",
  DATA_HEALTH_SUPPRESSED: "SUPPRESSED"
});

const OUTCOME_REASON_CODES = Object.freeze({
  ELIGIBLE_LEAK_DETECTED: ["STALE_WITHOUT_NEXT_ACTION"],
  ELIGIBLE_NO_LEAK: [
    "OPPORTUNITY_CLOSED",
    "RECENT_MEANINGFUL_ACTIVITY",
    "NEXT_ACTION_PRESENT"
  ],
  INSUFFICIENT_EVIDENCE: [
    "OPPORTUNITY_STAGE_MISSING",
    "MEANINGFUL_ACTIVITY_BASELINE_MISSING"
  ],
  STALE_OR_UNTRUSTWORTHY_SOURCE: [
    "CANONICAL_TIMESTAMP_IN_FUTURE",
    "CANONICAL_SOURCE_TOO_OLD"
  ],
  DATA_HEALTH_SUPPRESSED: [
    "OPPORTUNITY_EVIDENCE_INVALID",
    "OPPORTUNITY_STAGE_UNRECOGNIZED",
    "CANONICAL_TIMESTAMP_INVALID",
    "NEXT_ACTION_EVIDENCE_INVALID",
    "TASK_STATUS_UNRECOGNIZED",
    "TASK_EVIDENCE_INVALID",
    "ACTIVITY_EVIDENCE_INVALID",
    "COMMERCIAL_VALUE_INVALID",
    "COMMERCIAL_CURRENCY_INVALID"
  ]
});

const CASE_STATES = new Set(["OPEN", "SNOOZED", "DISMISSED", "SUPERSEDED"]);
const ACTIVE_OPPORTUNITY_STAGES = new Set([
  "NEW", "QUALIFIED", "CONTACTED", "REPLIED", "MEETING", "PROPOSAL"
]);
const CLOSED_OPPORTUNITY_STAGES = new Set(["WON", "LOST"]);

const REASON_EXPLANATIONS = Object.freeze({
  STALE_WITHOUT_NEXT_ACTION:
    "The opportunity reached the stalled threshold without a meaningful next action.",
  OPPORTUNITY_CLOSED:
    "The opportunity is recorded as won or lost, so it is not an eligible active leak.",
  RECENT_MEANINGFUL_ACTIVITY:
    "Recorded meaningful activity is still inside the detector's stalled threshold.",
  NEXT_ACTION_PRESENT:
    "A meaningful next action or active opportunity task is already recorded.",
  OPPORTUNITY_STAGE_MISSING:
    "A canonical opportunity stage is required before this detector can decide.",
  MEANINGFUL_ACTIVITY_BASELINE_MISSING:
    "No canonical activity or opportunity-creation baseline is available.",
  CANONICAL_TIMESTAMP_IN_FUTURE:
    "At least one canonical source timestamp is in the future and cannot be trusted yet.",
  CANONICAL_SOURCE_TOO_OLD:
    "The newest canonical source observation is outside the detector's freshness window.",
  OPPORTUNITY_EVIDENCE_INVALID:
    "The canonical opportunity identity or record shape is invalid.",
  OPPORTUNITY_STAGE_UNRECOGNIZED:
    "The recorded opportunity stage is outside the detector's recognized stage contract.",
  CANONICAL_TIMESTAMP_INVALID:
    "Canonical source timestamps are invalid or recorded in an incoherent order.",
  NEXT_ACTION_EVIDENCE_INVALID:
    "The recorded next-action evidence is malformed and cannot authorize detection.",
  TASK_STATUS_UNRECOGNIZED:
    "A recorded task status is outside the detector's recognized status contract.",
  TASK_EVIDENCE_INVALID:
    "Canonical task evidence is malformed, duplicated, or internally inconsistent.",
  ACTIVITY_EVIDENCE_INVALID:
    "Canonical activity evidence is malformed or contains duplicate identities.",
  COMMERCIAL_VALUE_INVALID:
    "The recorded commercial amount is malformed or outside the lossless value contract.",
  COMMERCIAL_CURRENCY_INVALID:
    "The recorded commercial currency is not a valid three-letter currency code."
});

export function detectorReasonExplanation(reasonCode) {
  return REASON_EXPLANATIONS[reasonCode]
    || "The detector returned a reason outside this browser's known versioned explanation set.";
}

export function detectorOutcomePresentation(outcome, reasonCode) {
  return {
    outcome,
    title: OUTCOME_TITLES[outcome] || "Detector result unavailable",
    explanation: detectorReasonExplanation(reasonCode),
    evidenceState: OUTCOME_EVIDENCE_STATES[outcome] || "UNAVAILABLE"
  };
}

export function formatPotentialRevenueAtRisk(commercialValue) {
  const classification = commercialValue?.classification;
  if (
    classification === "KNOWN"
    && isCanonicalCommercialAmount(commercialValue.amount)
    && /^[A-Z]{3}$/.test(commercialValue.currency || "")
  ) {
    const [integer, fraction] = commercialValue.amount.split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const amount = fraction === undefined ? grouped : `${grouped}.${fraction}`;
    const knownZero = /^0+(?:\.0+)?$/.test(commercialValue.amount);
    return {
      label: "Potential revenue at risk",
      value: `${commercialValue.currency} ${amount}`,
      detail: knownZero ? "Known zero" : "Known value"
    };
  }
  if (classification === "NOT_APPLICABLE") {
    return {
      label: "Potential revenue at risk",
      value: "Not applicable",
      detail: "Not applicable under the recorded case contract"
    };
  }
  if (classification === "UNKNOWN") {
    return {
      label: "Potential revenue at risk",
      value: "Unknown",
      detail: "Unknown value — no amount is claimed"
    };
  }
  return {
    label: "Potential revenue at risk",
    value: "Unavailable",
    detail: "Commercial value evidence is unavailable"
  };
}

export function allowedRevenueLeakCaseActions(state) {
  if (state === "OPEN") {
    return ["SNOOZE", "DISMISS", "LINK_REVENUE_ACTION"];
  }
  if (state === "SNOOZED") {
    return ["RESUME", "DISMISS", "LINK_REVENUE_ACTION"];
  }
  return [];
}

export function classifyRevenueLeakCaseError(error) {
  if (
    error?.status === 401
    || error?.status === 403
    || String(error?.code || "").startsWith("BROWSER_AUTH")
  ) {
    return "UNAUTHORIZED";
  }
  if (
    error?.status >= 500
    || error?.code === "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE"
    || error?.code === "TENANT_PERSISTENCE_UNAVAILABLE"
    || error?.code === "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN"
  ) {
    return "PERSISTENCE";
  }
  return "API";
}

export function unwrapRevenueLeakCaseListResponse(response, opportunityId) {
  if (
    !isPlainObject(response)
    || response.ok !== true
    || !Array.isArray(response.data)
    || !Number.isSafeInteger(response.count)
    || response.count !== response.data.length
  ) {
    invalidResponse();
  }
  for (const record of response.data) {
    validateCase(record, opportunityId);
  }
  return response.data;
}

export function unwrapRevenueLeakCaseMutationResponse(response, opportunityId) {
  if (!isPlainObject(response) || response.ok !== true) invalidResponse();
  validateCase(response.data, opportunityId);
  return response.data;
}

export function unwrapStalledOpportunityDetectionResponse(response, opportunityId) {
  if (
    !isPlainObject(response)
    || response.ok !== true
    || !OUTCOME_REASON_CODES[response.outcome]?.includes(response.reason_code)
    || response.detector?.id !== "stalled-opportunity"
    || response.detector?.version !== "1"
  ) {
    invalidResponse();
  }
  validateCommercialValue(response.commercial_value);

  const evidenceExpected = [
    "ELIGIBLE_LEAK_DETECTED",
    "ELIGIBLE_NO_LEAK"
  ].includes(response.outcome);
  if (evidenceExpected) {
    if (
      !isPlainObject(response.source)
      || !hasExactKeys(response.source, [
        "system", "entity_type", "entity_id", "observed_at", "observed_version"
      ])
      || response.source.system !== "TGE"
      || response.source.entity_type !== "OPPORTUNITY"
      || response.source.entity_id !== opportunityId
      || !isTimestampString(response.source.observed_at)
      || !isNonEmptyString(response.source.observed_version)
    ) {
      invalidResponse();
    }
    validateDetectorEvidence(
      response.evidence,
      response.source,
      response.commercial_value,
      response.reason_code,
      false
    );
  } else if (response.source !== null || response.evidence !== null) {
    invalidResponse();
  }
  if (!evidenceExpected && response.commercial_value.classification !== "UNKNOWN") {
    invalidResponse();
  }

  if (response.outcome === "ELIGIBLE_LEAK_DETECTED") {
    validateCase(response.case, opportunityId);
    if (
      response.case.evidence_classification !== "MIXED"
      || response.case.source_observed_at !== response.source.observed_at
      || response.case.source_observed_version !== response.source.observed_version
      || !sameJson(response.case.evidence_snapshot.facts, response.evidence)
      || !sameJson(response.case.commercial_value, response.commercial_value)
      || !isPlainObject(response.reconciliation)
      || !hasOnlyKeys(response.reconciliation, [
        "created", "duplicate", "terminal", "superseded_case_id"
      ])
      || typeof response.reconciliation.created !== "boolean"
      || typeof response.reconciliation.duplicate !== "boolean"
      || response.reconciliation.terminal !== undefined
        && response.reconciliation.terminal !== true
      || response.reconciliation.superseded_case_id !== null
        && !isNonEmptyString(response.reconciliation.superseded_case_id)
    ) {
      invalidResponse();
    }
  } else if (response.case !== null || response.reconciliation !== null) {
    invalidResponse();
  }
  return response;
}

function validateCase(record, opportunityId) {
  if (
    !isPlainObject(record)
    || typeof record.id !== "string"
    || record.id.length === 0
    || record.leak_type !== "STALLED_OPPORTUNITY"
    || typeof record.opportunity_id !== "string"
    || record.opportunity_id.length === 0
    || (opportunityId !== undefined && record.opportunity_id !== opportunityId)
    || record.source_system !== "TGE"
    || record.source_entity_type !== "OPPORTUNITY"
    || record.source_entity_id !== record.opportunity_id
    || !isTimestampString(record.source_observed_at)
    || !isNonEmptyString(record.source_observed_version)
    || !CASE_STATES.has(record.state)
    || record.reason_code !== "STALE_WITHOUT_NEXT_ACTION"
    || record.detector_id !== "stalled-opportunity"
    || record.detector_version !== "1"
    || !["OBSERVED", "DERIVED", "MIXED"].includes(record.evidence_classification)
    || !isPlainObject(record.evidence_snapshot)
    || !hasExactKeys(record.evidence_snapshot, [
      "classification", "source_observation", "facts"
    ])
    || record.evidence_snapshot.classification !== record.evidence_classification
    || !isPlainObject(record.evidence_snapshot.source_observation)
    || !hasExactKeys(record.evidence_snapshot.source_observation, [
      "observed_at", "observed_version"
    ])
    || record.evidence_snapshot.source_observation?.observed_at
      !== record.source_observed_at
    || record.evidence_snapshot.source_observation?.observed_version
      !== record.source_observed_version
    || !isPlainObject(record.evidence_snapshot.facts)
    || !isTimestampString(record.detected_at)
    || Date.parse(record.source_observed_at) > Date.parse(record.detected_at)
    || !Array.isArray(record.audit)
    || record.audit.length === 0
    || record.audit[0]?.transition !== "OPEN"
    || record.audit[0]?.reason_code !== record.reason_code
  ) {
    invalidResponse();
  }
  validateCommercialValue(record.commercial_value);
  validateDetectorEvidence(
    record.evidence_snapshot.facts,
    {
      observed_at: record.source_observed_at,
      observed_version: record.source_observed_version
    },
    record.commercial_value,
    record.reason_code,
    true
  );
}

function validateDetectorEvidence(
  evidence,
  source,
  commercialValue,
  reasonCode,
  allowNotApplicable
) {
  if (
    !isPlainObject(evidence)
    || !hasExactKeys(evidence, [
      "criteria",
      "opportunity_stage",
      "activity_baseline",
      "stalled_since",
      "next_action",
      "source_freshness",
      "commercial_value_basis"
    ])
  ) {
    invalidResponse();
  }

  const { criteria, activity_baseline: baseline, next_action: nextAction } = evidence;
  const freshness = evidence.source_freshness;
  const commercialBasis = evidence.commercial_value_basis;
  const stage = evidence.opportunity_stage;
  if (
    !isPlainObject(criteria)
    || !hasExactKeys(criteria, [
      "stale_after_days",
      "stale_boundary",
      "source_freshness_days",
      "source_freshness_boundary"
    ])
    || criteria.stale_after_days !== 14
    || criteria.stale_boundary !== "AT_OR_AFTER"
    || criteria.source_freshness_days !== 90
    || criteria.source_freshness_boundary !== "AT_OR_BEFORE"
    || !ACTIVE_OPPORTUNITY_STAGES.has(stage) && !CLOSED_OPPORTUNITY_STAGES.has(stage)
    || !isPlainObject(baseline)
    || !hasExactKeys(baseline, ["kind", "entity_id", "at"])
    || !isTimestampString(baseline.at)
    || !isTimestampString(evidence.stalled_since)
    || Date.parse(evidence.stalled_since) !== Date.parse(baseline.at) + 14 * 86400000
    || !isPlainObject(freshness)
    || !hasExactKeys(freshness, ["observed_at", "maximum_age_days"])
    || freshness.observed_at !== source.observed_at
    || !isTimestampString(freshness.observed_at)
    || Date.parse(freshness.observed_at) < Date.parse(baseline.at)
    || freshness.maximum_age_days !== 90
  ) {
    invalidResponse();
  }
  if (
    (baseline.kind === "ACTIVITY" && !isNonEmptyString(baseline.entity_id))
    || (baseline.kind === "OPPORTUNITY_CREATED" && baseline.entity_id !== null)
    || !["ACTIVITY", "OPPORTUNITY_CREATED"].includes(baseline.kind)
  ) {
    invalidResponse();
  }

  if (
    !isPlainObject(nextAction)
    || !hasExactKeys(nextAction, [
      "present", "source", "opportunity_value", "active_task_ids"
    ])
    || typeof nextAction.present !== "boolean"
    || !["OPPORTUNITY", "TASK", "NONE"].includes(nextAction.source)
    || !Array.isArray(nextAction.active_task_ids)
    || !nextAction.active_task_ids.every(isNonEmptyString)
    || !isStrictlySorted(nextAction.active_task_ids)
  ) {
    invalidResponse();
  }
  const hasOpportunityValue = isNonEmptyString(nextAction.opportunity_value);
  const hasActiveTasks = nextAction.active_task_ids.length > 0;
  if (
    nextAction.opportunity_value !== null && !hasOpportunityValue
    || nextAction.present !== (hasOpportunityValue || hasActiveTasks)
    || nextAction.source === "OPPORTUNITY" && !hasOpportunityValue
    || nextAction.source === "TASK" && (hasOpportunityValue || !hasActiveTasks)
    || nextAction.source === "NONE" && (hasOpportunityValue || hasActiveTasks)
  ) {
    invalidResponse();
  }

  validateCommercialValueBasis(commercialBasis, commercialValue, allowNotApplicable);
  if (
    reasonCode === "OPPORTUNITY_CLOSED" && !CLOSED_OPPORTUNITY_STAGES.has(stage)
    || reasonCode !== "OPPORTUNITY_CLOSED" && !ACTIVE_OPPORTUNITY_STAGES.has(stage)
    || reasonCode === "NEXT_ACTION_PRESENT" && nextAction.present !== true
    || reasonCode === "STALE_WITHOUT_NEXT_ACTION" && nextAction.present !== false
  ) {
    invalidResponse();
  }
}

function validateCommercialValueBasis(basis, commercialValue, allowNotApplicable) {
  if (!isPlainObject(basis) || basis.classification !== commercialValue.classification) {
    invalidResponse();
  }
  if (basis.classification === "KNOWN") {
    if (
      !hasExactKeys(basis, ["classification", "amount_source", "currency_source"])
      || basis.amount_source !== "opportunity.value"
      || basis.currency_source !== "opportunity.currency"
    ) {
      invalidResponse();
    }
    return;
  }
  if (basis.classification === "NOT_APPLICABLE") {
    if (!allowNotApplicable || !hasExactKeys(basis, ["classification"])) {
      invalidResponse();
    }
    return;
  }
  if (
    basis.classification !== "UNKNOWN"
    || !hasExactKeys(basis, ["classification", "reason", "currency_present"])
    || !["VALUE_UNKNOWN", "CURRENCY_UNKNOWN"].includes(basis.reason)
    || typeof basis.currency_present !== "boolean"
    || basis.reason === "CURRENCY_UNKNOWN" && basis.currency_present !== false
  ) {
    invalidResponse();
  }
}

function validateCommercialValue(value) {
  if (!isPlainObject(value)) invalidResponse();
  if (value.classification === "KNOWN") {
    if (
      !isCanonicalCommercialAmount(value.amount)
      || !/^[A-Z]{3}$/.test(value.currency || "")
    ) {
      invalidResponse();
    }
    return;
  }
  if (
    !["UNKNOWN", "NOT_APPLICABLE"].includes(value.classification)
    || value.amount !== null
    || value.currency !== null
  ) {
    invalidResponse();
  }
}

function isCanonicalCommercialAmount(value) {
  return typeof value === "string"
    && /^(?:0|[1-9]\d{0,13})(?:\.\d{0,5}[1-9])?$/.test(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimestampString(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function hasOnlyKeys(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every(key => allowed.includes(key));
}

function sameJson(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && sameJson(left[key], right[key])
    );
}

function isStrictlySorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function invalidResponse() {
  const error = new Error(
    "Revenue leak case data was returned in an invalid or inconsistent format."
  );
  error.name = "RevenueLeakBrowserContractError";
  error.code = "REVENUE_LEAK_BROWSER_RESPONSE_INVALID";
  error.status = null;
  throw error;
}
