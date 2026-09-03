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
      || response.source.system !== "TGE"
      || response.source.entity_type !== "OPPORTUNITY"
      || response.source.entity_id !== opportunityId
      || typeof response.source.observed_at !== "string"
      || typeof response.source.observed_version !== "string"
      || !isPlainObject(response.evidence)
    ) {
      invalidResponse();
    }
  } else if (response.source !== null || response.evidence !== null) {
    invalidResponse();
  }

  if (response.outcome === "ELIGIBLE_LEAK_DETECTED") {
    validateCase(response.case, opportunityId);
    if (!isPlainObject(response.reconciliation)) invalidResponse();
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
    || typeof record.source_observed_version !== "string"
    || record.source_observed_version.length === 0
    || !CASE_STATES.has(record.state)
    || record.reason_code !== "STALE_WITHOUT_NEXT_ACTION"
    || record.detector_id !== "stalled-opportunity"
    || record.detector_version !== "1"
    || !["OBSERVED", "DERIVED", "MIXED"].includes(record.evidence_classification)
    || !isPlainObject(record.evidence_snapshot)
    || record.evidence_snapshot.classification !== record.evidence_classification
    || record.evidence_snapshot.source_observation?.observed_at
      !== record.source_observed_at
    || record.evidence_snapshot.source_observation?.observed_version
      !== record.source_observed_version
    || !isPlainObject(record.evidence_snapshot.facts)
    || !isTimestampString(record.detected_at)
    || !Array.isArray(record.audit)
    || record.audit.length === 0
    || record.audit[0]?.transition !== "OPEN"
    || record.audit[0]?.reason_code !== record.reason_code
  ) {
    invalidResponse();
  }
  validateCommercialValue(record.commercial_value);
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
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
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
