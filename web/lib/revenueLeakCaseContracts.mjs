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
const REVENUE_ACTION_STATUSES = new Set([
  "RECOMMENDED", "PREPARED", "APPROVED", "EXECUTING", "EXECUTED",
  "REJECTED", "CANCELLED", "FAILED"
]);
const DAY_MS = 86400000;

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

export function formatPotentialRevenueAggregate(total) {
  const valid = isPlainObject(total)
    && hasExactKeys(total, ["currency", "amount", "case_count"])
    && /^[A-Z]{3}$/.test(total.currency || "")
    && Number.isSafeInteger(total.case_count)
    && total.case_count > 0
    && total.case_count <= 100
    && isCanonicalAggregateAmount(total.amount)
    && decimalUnits(total.amount) > 0n
    && decimalUnits(total.amount)
      <= BigInt(total.case_count) * decimalUnits("99999999999999.999999");
  if (!valid) {
    return {
      label: "Potential revenue at risk",
      value: "Unavailable",
      detail: "Aggregate commercial value evidence is unavailable"
    };
  }
  const [integer, fraction] = total.amount.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return {
    label: "Potential revenue at risk",
    value: `${total.currency} ${fraction === undefined ? grouped : `${grouped}.${fraction}`}`,
    detail: "Known aggregate value"
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

export function isAmbiguousRevenueLeakCaseMutationError(error) {
  if (String(error?.code || "").startsWith("BROWSER_AUTH")) return false;
  return !Number.isInteger(error?.status)
    || error.status === 408
    || error.status >= 500
    || error.code === "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN";
}

export function classifyRevenueLeakOperatingQueueError(error) {
  if (
    error?.status === 401
    || error?.status === 403
    || String(error?.code || "").startsWith("BROWSER_AUTH")
  ) return "UNAUTHORIZED";
  if (error?.code === "REVENUE_LEAK_QUEUE_LIMIT_EXCEEDED") return "LIMIT";
  if (
    error?.code === "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT"
    || error?.code === "REVENUE_LEAK_BROWSER_RESPONSE_INVALID"
  ) return "INTEGRITY";
  if (
    error?.status >= 500
    || error?.code === "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE"
    || error?.code === "TENANT_PERSISTENCE_UNAVAILABLE"
    || error?.code === "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN"
  ) return "PERSISTENCE";
  return "API";
}

export function filterRevenueLeakOperatingQueue(entries, filters = {}) {
  if (!Array.isArray(entries) || !isPlainObject(filters)) {
    throw new TypeError("Unsupported operating queue filter input.");
  }
  const supported = new Set(["lifecycle", "value", "source"]);
  if (Object.keys(filters).some(field => !supported.has(field))) {
    throw new TypeError("Unsupported operating queue filter.");
  }
  const lifecycle = filters.lifecycle || "ALL";
  const value = filters.value || "ALL";
  const source = filters.source || "ALL";
  if (
    !["ALL", "OPEN", "SNOOZED"].includes(lifecycle)
    || !["ALL", "KNOWN_POSITIVE", "KNOWN_ZERO", "UNKNOWN", "NOT_APPLICABLE"]
      .includes(value)
    || !["ALL", "TGE"].includes(source)
  ) {
    throw new TypeError("Unsupported operating queue filter.");
  }
  return entries.filter(entry =>
    (lifecycle === "ALL" || entry.case.lifecycle_state === lifecycle)
    && (value === "ALL" || entry.potential_value.kind === value)
    && (source === "ALL" || entry.case.source.system === source)
  );
}

export function unwrapRevenueLeakOperatingQueueResponse(
  response,
  receivedAt = new Date()
) {
  const receivedAtMs = referenceTime(receivedAt);
  const queue = response?.data;
  if (
    !isPlainObject(response)
    || !hasExactKeys(response, ["ok", "data"])
    || response.ok !== true
    || !isPlainObject(queue)
    || !hasExactKeys(queue, [
      "generated_at", "complete", "limit", "total_cases", "projected_count",
      "omitted_count", "scope", "value_semantics", "value_summary",
      "ordering", "entries"
    ])
    || queue.complete !== true
    || queue.limit !== 100
    || !Number.isSafeInteger(queue.total_cases)
    || queue.total_cases < 0
    || queue.total_cases > queue.limit
    || queue.projected_count !== queue.total_cases
    || queue.omitted_count !== 0
    || !isTimestampString(queue.generated_at)
    || Date.parse(queue.generated_at) > receivedAtMs
    || !Array.isArray(queue.entries)
    || queue.entries.length !== queue.projected_count
    || !sameJson(queue.scope, {
      leak_types: ["STALLED_OPPORTUNITY"],
      lifecycle_states: ["OPEN", "SNOOZED"]
    })
    || !sameJson(queue.value_semantics, {
      known_positive_and_zero_are_distinct: true,
      unknown_is_not_zero: true,
      not_applicable_is_not_zero: true,
      monetary_totals_grouped_by_currency: true,
      cross_currency_ranking: false
    })
    || !sameJson(queue.ordering, QUEUE_ORDERING)
  ) invalidResponse();

  const caseIds = new Set();
  for (const entry of queue.entries) {
    validateQueueEntry(entry, queue.generated_at);
    if (caseIds.has(entry.case.id)) invalidResponse();
    caseIds.add(entry.case.id);
  }
  for (let index = 1; index < queue.entries.length; index += 1) {
    if (compareQueueEntries(queue.entries[index - 1], queue.entries[index]) > 0) {
      invalidResponse();
    }
  }
  if (!sameJson(queue.value_summary, queueValueSummary(queue.entries))) {
    invalidResponse();
  }
  return queue;
}

export function unwrapRevenueLeakActionHandoffResponse(
  response,
  caseId,
  opportunityId,
  receivedAt = new Date()
) {
  const handoff = response?.handoff;
  const record = response?.data?.case;
  const action = response?.data?.revenue_action;
  if (
    !isPlainObject(response)
    || response.ok !== true
    || !isPlainObject(handoff)
    || !hasExactKeys(handoff, [
      "action_created", "action_reused", "link_created", "reconciled"
    ])
    || !Object.values(handoff).every(value => typeof value === "boolean")
    || handoff.action_created === handoff.action_reused
    || handoff.action_created && handoff.reconciled
    || !isPlainObject(action)
    || action.opportunity_id !== opportunityId
    || action.action_type !== "CREATE_TASK"
    || !REVENUE_ACTION_STATUSES.has(action.status)
    || !isBoundedText(action.id, 255)
    || !/^[0-9a-f]{64}$/.test(action.basis_fingerprint || "")
    || !isTimestampString(action.created_at)
    || Date.parse(action.created_at) > referenceTime(receivedAt)
  ) invalidResponse();
  validateCase(record, opportunityId, referenceTime(receivedAt));
  if (
    record.id !== caseId
    || record.revenue_action_id !== action.id
    || record.revenue_action_fingerprint !== action.basis_fingerprint
    || !isTimestampString(record.revenue_action_linked_at)
    || Date.parse(record.revenue_action_linked_at) < Date.parse(action.created_at)
  ) invalidResponse();
  return response;
}

export function unwrapStalledOpportunityScanResponse(
  response,
  receivedAt = new Date()
) {
  const receivedAtMs = referenceTime(receivedAt);
  const summary = response?.summary;
  if (
    !isPlainObject(response)
    || !hasExactKeys(response, [
      "ok", "evaluated_at", "detector", "scope", "summary", "results"
    ])
    || response.ok !== true
    || !hasExactKeys(response.detector, ["id", "version"])
    || response.detector?.id !== "stalled-opportunity"
    || response.detector?.version !== "1"
    || response.scope !== "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES"
    || !isTimestampString(response.evaluated_at)
    || Date.parse(response.evaluated_at) > receivedAtMs
    || !isPlainObject(summary)
    || !hasExactKeys(summary, [
      "complete", "limit", "total_opportunities", "evaluated_count",
      "unevaluated_count", "overflow_count", "invalid_record_count",
      "excluded_count", "reconciliation", "outcomes"
    ])
    || summary.complete !== true
    || summary.limit !== 100
    || !Array.isArray(response.results)
    || response.results.length !== summary.evaluated_count
    || summary.total_opportunities !== summary.evaluated_count
    || summary.unevaluated_count !== 0
    || summary.overflow_count !== 0
    || summary.invalid_record_count !== 0
    || summary.excluded_count !== 0
  ) invalidResponse();
  const outcomes = summary.outcomes;
  const reconciliation = summary.reconciliation;
  if (
    !isPlainObject(outcomes)
    || !sameJson(Object.keys(outcomes).sort(), Object.keys(OUTCOME_REASON_CODES).sort())
    || !hasExactKeys(reconciliation, [
      "detected_count", "created_count", "replayed_count", "superseded_count"
    ])
    || Object.values(reconciliation).some(count =>
      !Number.isSafeInteger(count) || count < 0)
  ) invalidResponse();
  let outcomeTotal = 0;
  for (const [outcome, allowedReasons] of Object.entries(OUTCOME_REASON_CODES)) {
    const item = outcomes[outcome];
    if (
      !hasExactKeys(item, ["count", "reasons"])
      || !Number.isSafeInteger(item.count)
      || item.count < 0
    ) {
      invalidResponse();
    }
    outcomeTotal += item.count;
    if (
      !isPlainObject(item.reasons)
      || Object.entries(item.reasons).some(([reason, count]) =>
        !allowedReasons.includes(reason)
        || !Number.isSafeInteger(count)
        || count < 1)
      || Object.values(item.reasons).reduce((total, count) => total + count, 0)
        !== item.count
    ) invalidResponse();
  }
  if (outcomeTotal !== summary.evaluated_count) invalidResponse();
  const dispositionCounts = {
    CREATED: 0,
    REPLAYED: 0,
    SUPERSEDED: 0
  };
  let priorOpportunityId = null;
  for (const result of response.results) {
    if (
      !hasExactKeys(result, [
        "opportunity_id", "outcome", "reason_code", "disposition",
        "case_id", "superseded_case_id"
      ])
      || !isNonEmptyString(result.opportunity_id)
      || priorOpportunityId !== null
        && priorOpportunityId >= result.opportunity_id
      || !OUTCOME_REASON_CODES[result.outcome]?.includes(result.reason_code)
      || !["READ_ONLY", "CREATED", "REPLAYED", "SUPERSEDED"]
        .includes(result.disposition)
      || (result.outcome === "ELIGIBLE_LEAK_DETECTED")
        !== (result.disposition !== "READ_ONLY")
    ) invalidResponse();
    priorOpportunityId = result.opportunity_id;
    if (result.disposition === "READ_ONLY") {
      if (result.case_id !== null || result.superseded_case_id !== null) {
        invalidResponse();
      }
      continue;
    }
    if (!isBoundedText(result.case_id, 255)) invalidResponse();
    if (result.disposition === "SUPERSEDED") {
      if (
        !isBoundedText(result.superseded_case_id, 255)
        || result.superseded_case_id === result.case_id
      ) invalidResponse();
    } else if (result.superseded_case_id !== null) invalidResponse();
    dispositionCounts[result.disposition] += 1;
  }
  if (
    reconciliation.detected_count
      !== outcomes.ELIGIBLE_LEAK_DETECTED.count
    || reconciliation.created_count !== dispositionCounts.CREATED
    || reconciliation.replayed_count !== dispositionCounts.REPLAYED
    || reconciliation.superseded_count !== dispositionCounts.SUPERSEDED
    || reconciliation.detected_count
      !== reconciliation.created_count
        + reconciliation.replayed_count
        + reconciliation.superseded_count
  ) invalidResponse();
  return response;
}

export function unwrapRevenueLeakCaseListResponse(
  response,
  opportunityId,
  receivedAt = new Date()
) {
  const receivedAtMs = referenceTime(receivedAt);
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
    validateCase(record, opportunityId, receivedAtMs);
  }
  return response.data;
}

export function unwrapRevenueLeakCaseMutationResponse(
  response,
  opportunityId,
  receivedAt = new Date()
) {
  if (!isPlainObject(response) || response.ok !== true) invalidResponse();
  validateCase(response.data, opportunityId, referenceTime(receivedAt));
  return response.data;
}

export function unwrapStalledOpportunityDetectionResponse(
  response,
  opportunityId,
  receivedAt = new Date()
) {
  const receivedAtMs = referenceTime(receivedAt);
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
      || Date.parse(response.source.observed_at) > receivedAtMs
      || receivedAtMs - Date.parse(response.source.observed_at) > 90 * DAY_MS
      || !isNonEmptyString(response.source.observed_version)
    ) {
      invalidResponse();
    }
    validateDetectorEvidence(
      response.evidence,
      response.source,
      response.commercial_value,
      response.reason_code,
      false,
      { evaluationAtMs: receivedAtMs }
    );
  } else if (response.source !== null || response.evidence !== null) {
    invalidResponse();
  }
  if (!evidenceExpected && response.commercial_value.classification !== "UNKNOWN") {
    invalidResponse();
  }

  if (response.outcome === "ELIGIBLE_LEAK_DETECTED") {
    validateCase(response.case, opportunityId, receivedAtMs);
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

function validateCase(record, opportunityId, receivedAtMs) {
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
    || Date.parse(record.detected_at) > receivedAtMs
    || Date.parse(record.source_observed_at) > Date.parse(record.detected_at)
    || Date.parse(record.detected_at) - Date.parse(record.source_observed_at)
      > 90 * DAY_MS
    || !Array.isArray(record.audit)
    || record.audit.length === 0
    || record.created_at !== undefined
      && (!isTimestampString(record.created_at) || record.created_at !== record.detected_at)
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
    true,
    {
      evaluationAtMs: Date.parse(record.detected_at),
      detectedAtMs: Date.parse(record.detected_at)
    }
  );
  validateAudit(record, receivedAtMs);
}

function validateDetectorEvidence(
  evidence,
  source,
  commercialValue,
  reasonCode,
  allowNotApplicable,
  { evaluationAtMs, detectedAtMs = null }
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
    || detectedAtMs !== null && Date.parse(evidence.stalled_since) > detectedAtMs
    || !isPlainObject(freshness)
    || !hasExactKeys(freshness, ["observed_at", "maximum_age_days"])
    || freshness.observed_at !== source.observed_at
    || !isTimestampString(freshness.observed_at)
    || Date.parse(freshness.observed_at) < Date.parse(baseline.at)
    || Date.parse(freshness.observed_at) > evaluationAtMs
    || evaluationAtMs - Date.parse(freshness.observed_at) > 90 * DAY_MS
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
  const stalledSinceMs = Date.parse(evidence.stalled_since);
  if (
    reasonCode === "OPPORTUNITY_CLOSED" && !CLOSED_OPPORTUNITY_STAGES.has(stage)
    || reasonCode !== "OPPORTUNITY_CLOSED" && !ACTIVE_OPPORTUNITY_STAGES.has(stage)
    || reasonCode === "RECENT_MEANINGFUL_ACTIVITY"
      && evaluationAtMs >= stalledSinceMs
    || reasonCode === "NEXT_ACTION_PRESENT" && nextAction.present !== true
    || reasonCode === "NEXT_ACTION_PRESENT" && evaluationAtMs < stalledSinceMs
    || reasonCode === "STALE_WITHOUT_NEXT_ACTION" && nextAction.present !== false
  ) {
    invalidResponse();
  }
}

function validateAudit(record, receivedAtMs) {
  const initial = record.audit[0];
  if (
    !isPlainObject(initial)
    || !hasExactKeys(initial, [
      "transition", "at", "subject_id", "detector_id", "detector_version",
      "reason_code"
    ])
    || initial.transition !== "OPEN"
    || initial.at !== record.detected_at
    || !isBoundedText(initial.subject_id, 512)
    || initial.detector_id !== record.detector_id
    || initial.detector_version !== record.detector_version
    || initial.reason_code !== record.reason_code
  ) {
    invalidResponse();
  }

  let state = "OPEN";
  let linkedAction = null;
  let previousAtMs = Date.parse(record.detected_at);
  for (const entry of record.audit.slice(1)) {
    if (!isPlainObject(entry) || !isTimestampString(entry.at)) invalidResponse();
    const atMs = Date.parse(entry.at);
    if (
      atMs < previousAtMs
      || atMs < Date.parse(record.detected_at)
      || atMs > receivedAtMs
      || !isBoundedText(entry.subject_id, 512)
    ) {
      invalidResponse();
    }

    if (entry.transition === "SNOOZED") {
      if (
        !hasExactKeys(entry, ["transition", "at", "subject_id", "reason", "wake_at"])
        || state !== "OPEN"
        || !isBoundedText(entry.reason, 1000)
        || !isTimestampString(entry.wake_at)
        || Date.parse(entry.wake_at) <= atMs
      ) invalidResponse();
      state = "SNOOZED";
    } else if (entry.transition === "REOPENED") {
      if (
        !hasExactKeys(entry, ["transition", "at", "subject_id", "reason"])
        || state !== "SNOOZED"
        || !isBoundedText(entry.reason, 1000)
      ) invalidResponse();
      state = "OPEN";
    } else if (entry.transition === "DISMISSED") {
      if (
        !hasExactKeys(entry, ["transition", "at", "subject_id", "reason"])
        || !["OPEN", "SNOOZED"].includes(state)
        || !isBoundedText(entry.reason, 1000)
      ) invalidResponse();
      state = "DISMISSED";
    } else if (entry.transition === "SUPERSEDED") {
      if (
        !hasExactKeys(entry, [
          "transition", "at", "subject_id", "reason_code",
          "superseded_by_case_id", "replacement_semantic_key"
        ])
        || !["OPEN", "SNOOZED"].includes(state)
        || entry.reason_code !== "CANONICAL_EVIDENCE_CHANGED"
        || !isBoundedText(entry.superseded_by_case_id, 255)
        || !/^[0-9a-f]{64}$/.test(entry.replacement_semantic_key || "")
      ) invalidResponse();
      state = "SUPERSEDED";
    } else if (entry.transition === "REVENUE_ACTION_LINKED") {
      if (
        !hasExactKeys(entry, [
          "transition", "at", "subject_id", "revenue_action_id",
          "revenue_action_fingerprint", "revenue_action_status"
        ])
        || !["OPEN", "SNOOZED"].includes(state)
        || linkedAction !== null
        || !isBoundedText(entry.revenue_action_id, 255)
        || !/^[0-9a-f]{64}$/.test(entry.revenue_action_fingerprint || "")
        || !REVENUE_ACTION_STATUSES.has(entry.revenue_action_status)
      ) invalidResponse();
      linkedAction = {
        id: entry.revenue_action_id,
        status: entry.revenue_action_status
      };
    } else {
      invalidResponse();
    }
    previousAtMs = atMs;
  }

  if (
    state !== record.state
    || record.updated_at !== undefined
      && (!isTimestampString(record.updated_at)
        || Date.parse(record.updated_at) !== previousAtMs)
    || linkedAction !== null
      && (record.revenue_action_id !== linkedAction.id
        || record.revenue_action_status_at_link !== linkedAction.status)
    || linkedAction === null && record.revenue_action_id
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

function isCanonicalAggregateAmount(value) {
  return typeof value === "string"
    && /^(?:0|[1-9]\d{0,15})(?:\.\d{0,5}[1-9])?$/.test(value);
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

function isBoundedText(value, maximumBytes) {
  return isNonEmptyString(value)
    && new TextEncoder().encode(value).length <= maximumBytes;
}

function referenceTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) invalidResponse();
  return parsed.valueOf();
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

const QUEUE_URGENCY = Object.freeze({
  OVERDUE: 0,
  SNOOZE_WAKE_DUE: 1,
  OPEN_NO_OVERDUE_DEADLINE: 2,
  SNOOZED_UNTIL_FUTURE: 3
});
const QUEUE_VALUE = Object.freeze({
  KNOWN_POSITIVE: 0,
  KNOWN_ZERO: 1,
  UNKNOWN: 2,
  NOT_APPLICABLE: 3
});
const QUEUE_ORDERING = Object.freeze({
  factors: [
    "urgency tier ASC",
    "potential-value evidence tier ASC",
    "currency code ASC for KNOWN positive currency grouping",
    "amount DESC only within the same currency",
    "leak age DESC",
    "case.id ASC"
  ],
  urgency_tiers: [
    "OVERDUE",
    "SNOOZE_WAKE_DUE",
    "OPEN_NO_OVERDUE_DEADLINE",
    "SNOOZED_UNTIL_FUTURE"
  ],
  value_tiers: [
    "KNOWN_POSITIVE",
    "KNOWN_ZERO",
    "UNKNOWN",
    "NOT_APPLICABLE"
  ],
  currency_rule: "Currency codes form alphabetical groups; amounts are never compared across currencies.",
  stable_final_tie_breaker: "case.id ASC"
});

function validateQueueEntry(entry, generatedAt) {
  const record = entry?.case;
  const potential = entry?.potential_value;
  const source = record?.source;
  const detectedAtMs = Date.parse(record?.detected_at);
  if (
    !isPlainObject(entry)
    || !hasExactKeys(entry, [
      "case", "historical_opportunity_id", "data_origin", "opportunity", "business",
      "potential_value", "leak_age", "urgency", "linked_revenue_action",
      "ordering_factors"
    ])
    || !["IMPORTED_CUSTOMER", "SAMPLE_DEMO", "EXISTING_CUSTOMER"].includes(
      entry.data_origin
    )
    || !isPlainObject(record)
    || !hasExactKeys(record, [
      "id", "leak_type", "lifecycle_state", "reason_code", "detector",
      "source", "evidence_classification", "evidence_snapshot",
      "recommended_action_type", "detected_at", "due_at"
    ])
    || !isBoundedText(record.id, 255)
    || record.leak_type !== "STALLED_OPPORTUNITY"
    || !["OPEN", "SNOOZED"].includes(record.lifecycle_state)
    || record.reason_code !== "STALE_WITHOUT_NEXT_ACTION"
    || !hasExactKeys(record.detector, ["id", "version"])
    || record.detector?.id !== "stalled-opportunity"
    || record.detector?.version !== "1"
    || !isPlainObject(source)
    || !hasExactKeys(source, [
      "system", "entity_type", "entity_id", "observed_at", "observed_version"
    ])
    || source.system !== "TGE"
    || source.entity_type !== "OPPORTUNITY"
    || source.entity_id !== entry.historical_opportunity_id
    || !isTimestampString(source.observed_at)
    || !isNonEmptyString(source.observed_version)
    || !isTimestampString(record.detected_at)
    || detectedAtMs > Date.parse(generatedAt)
    || Date.parse(source.observed_at) > detectedAtMs
    || detectedAtMs - Date.parse(source.observed_at) > 90 * DAY_MS
    || record.evidence_classification !== "MIXED"
    || record.recommended_action_type !== "FOLLOW_UP"
    || !isPlainObject(record.evidence_snapshot)
    || !hasExactKeys(record.evidence_snapshot, [
      "classification", "source_observation", "facts"
    ])
    || !hasExactKeys(record.evidence_snapshot.source_observation, [
      "observed_at", "observed_version"
    ])
    || record.evidence_snapshot.classification !== record.evidence_classification
    || record.evidence_snapshot.source_observation?.observed_at !== source.observed_at
    || record.evidence_snapshot.source_observation?.observed_version
      !== source.observed_version
    || !isBoundedText(entry.historical_opportunity_id, 512)
    || entry.opportunity !== null
      && (!isPlainObject(entry.opportunity)
        || !hasExactKeys(entry.opportunity, ["id", "prospect_id", "business_name"])
        || entry.opportunity.id !== entry.historical_opportunity_id
        || entry.opportunity.prospect_id !== null
          && !isNonEmptyString(entry.opportunity.prospect_id)
        || entry.opportunity.business_name !== null
          && !isNonEmptyString(entry.opportunity.business_name))
    || !isPlainObject(potential)
    || !hasExactKeys(potential, ["kind", "classification", "amount", "currency"])
    || !Object.hasOwn(QUEUE_VALUE, potential.kind)
  ) invalidResponse();
  if (
    record.due_at !== null
    && !isTimestampString(record.due_at)
  ) invalidResponse();
  validateCommercialValue(potential);
  const expectedKind = potential.classification === "KNOWN"
    ? potential.amount === "0" ? "KNOWN_ZERO" : "KNOWN_POSITIVE"
    : potential.classification;
  if (potential.kind !== expectedKind) invalidResponse();
  validateDetectorEvidence(
    record.evidence_snapshot.facts,
    source,
    potential,
    record.reason_code,
    true,
    { evaluationAtMs: detectedAtMs, detectedAtMs }
  );
  if (
    !isPlainObject(entry.leak_age)
    || !hasExactKeys(entry.leak_age, [
      "basis", "detected_at", "elapsed_seconds", "elapsed_days"
    ])
    || entry.leak_age.basis !== "DETECTED_AT"
    || entry.leak_age.detected_at !== record.detected_at
    || entry.leak_age.elapsed_seconds
      !== Math.floor((Date.parse(generatedAt) - detectedAtMs) / 1000)
    || entry.leak_age.elapsed_days
      !== Math.floor((Date.parse(generatedAt) - detectedAtMs) / DAY_MS)
    || !isPlainObject(entry.urgency)
    || !hasExactKeys(entry.urgency, ["classification", "basis_timestamp"])
    || !Object.hasOwn(QUEUE_URGENCY, entry.urgency.classification)
    || !isPlainObject(entry.ordering_factors)
    || !hasExactKeys(entry.ordering_factors, [
      "urgency_tier", "value_tier", "currency_group", "comparable_amount",
      "leak_age_seconds", "leak_age_milliseconds", "stable_case_id"
    ])
    || entry.ordering_factors?.urgency_tier !== entry.urgency.classification
    || entry.ordering_factors?.value_tier !== potential.kind
    || entry.ordering_factors?.currency_group
      !== (potential.kind === "KNOWN_POSITIVE" ? potential.currency : null)
    || entry.ordering_factors?.comparable_amount
      !== (potential.kind === "KNOWN_POSITIVE" ? potential.amount : null)
    || entry.ordering_factors?.leak_age_seconds !== entry.leak_age.elapsed_seconds
    || entry.ordering_factors?.leak_age_milliseconds
      !== Date.parse(generatedAt) - detectedAtMs
    || entry.ordering_factors?.stable_case_id !== record.id
  ) invalidResponse();
  validateQueueUrgency(entry, generatedAt);
  if (
    entry.business !== null
    && (entry.opportunity === null
      || !hasExactKeys(entry.business, ["id", "name"])
      || !isNonEmptyString(entry.business.id)
      || entry.opportunity.prospect_id !== entry.business.id
      || entry.business.name !== null && !isNonEmptyString(entry.business.name))
  ) invalidResponse();
  validateQueueAction(
    entry.linked_revenue_action,
    entry.historical_opportunity_id
  );
}

function validateQueueUrgency(entry, generatedAt) {
  const generatedAtMs = Date.parse(generatedAt);
  const dueAt = entry.case.due_at;
  const state = entry.case.lifecycle_state;
  const { classification, basis_timestamp: basis } = entry.urgency;
  if (dueAt !== null && Date.parse(dueAt) <= generatedAtMs) {
    if (classification !== "OVERDUE" || basis !== dueAt) invalidResponse();
    return;
  }
  if (state === "OPEN") {
    if (classification !== "OPEN_NO_OVERDUE_DEADLINE" || basis !== dueAt) {
      invalidResponse();
    }
    return;
  }
  if (!isTimestampString(basis)) invalidResponse();
  const expected = Date.parse(basis) <= generatedAtMs
    ? "SNOOZE_WAKE_DUE"
    : "SNOOZED_UNTIL_FUTURE";
  if (classification !== expected) invalidResponse();
}

function validateQueueAction(action, opportunityId) {
  if (action === null) return;
  if (
    !isPlainObject(action)
    || !hasExactKeys(action, ["id", "snapshot", "current"])
    || !isBoundedText(action.id, 255)
    || !hasExactKeys(action.snapshot, [
      "basis_fingerprint", "status", "linked_at"
    ])
    || !/^[0-9a-f]{64}$/.test(action.snapshot?.basis_fingerprint || "")
    || !REVENUE_ACTION_STATUSES.has(action.snapshot?.status)
    || !isTimestampString(action.snapshot?.linked_at)
    || !hasExactKeys(action.current, ["status"])
    || action.current?.status !== null
      && !REVENUE_ACTION_STATUSES.has(action.current?.status)
    || !isNonEmptyString(opportunityId)
  ) invalidResponse();
}

function compareQueueEntries(left, right) {
  const urgency = QUEUE_URGENCY[left.urgency.classification]
    - QUEUE_URGENCY[right.urgency.classification];
  if (urgency !== 0) return urgency;
  const value = QUEUE_VALUE[left.potential_value.kind]
    - QUEUE_VALUE[right.potential_value.kind];
  if (value !== 0) return value;
  if (left.potential_value.kind === "KNOWN_POSITIVE") {
    const currency = left.potential_value.currency.localeCompare(
      right.potential_value.currency
    );
    if (currency !== 0) return currency;
    const amount = decimalUnits(right.potential_value.amount)
      - decimalUnits(left.potential_value.amount);
    if (amount !== 0n) return amount < 0n ? -1 : 1;
  }
  const age = right.ordering_factors.leak_age_milliseconds
    - left.ordering_factors.leak_age_milliseconds;
  return age || left.case.id.localeCompare(right.case.id);
}

function queueValueSummary(entries) {
  const positive = new Map();
  const zero = new Map();
  let positiveCount = 0;
  let zeroCount = 0;
  let unknownCount = 0;
  let notApplicableCount = 0;
  for (const entry of entries) {
    const value = entry.potential_value;
    if (value.kind === "KNOWN_POSITIVE") {
      positiveCount += 1;
      const aggregate = positive.get(value.currency) || { units: 0n, count: 0 };
      aggregate.units += decimalUnits(value.amount);
      aggregate.count += 1;
      positive.set(value.currency, aggregate);
    } else if (value.kind === "KNOWN_ZERO") {
      zeroCount += 1;
      zero.set(value.currency, (zero.get(value.currency) || 0) + 1);
    } else if (value.kind === "UNKNOWN") {
      unknownCount += 1;
    } else {
      notApplicableCount += 1;
    }
  }
  return {
    known_positive: {
      case_count: positiveCount,
      totals_by_currency: [...positive.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, item]) => ({
          currency,
          amount: decimalFromUnits(item.units),
          case_count: item.count
        }))
    },
    known_zero: {
      case_count: zeroCount,
      counts_by_currency: [...zero.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, count]) => ({
          currency,
          case_count: count
        }))
    },
    unknown: { case_count: unknownCount },
    not_applicable: { case_count: notApplicableCount }
  };
}

function decimalUnits(value) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
}

function decimalFromUnits(value) {
  const whole = value / 1000000n;
  const fraction = String(value % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
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
