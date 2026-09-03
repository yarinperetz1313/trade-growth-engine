"use strict";

const {
  deepFreeze,
  fingerprint,
  normalizeCommercialValue
} = require("./revenueLeakCaseDomain");
const {
  isCanonicalNumericLiteralRepresentable,
  isDecimalNumberLiteral,
  isNegativeNumberLiteral
} = require("../imports/numericEvidence");

const DAY_MS = 86400000;
const STALE_AFTER_DAYS = 14;
const SOURCE_FRESHNESS_DAYS = 90;
const DETECTOR = Object.freeze({
  id: "stalled-opportunity",
  version: "1"
});
const OUTCOMES = Object.freeze({
  LEAK: "ELIGIBLE_LEAK_DETECTED",
  NO_LEAK: "ELIGIBLE_NO_LEAK",
  INSUFFICIENT: "INSUFFICIENT_EVIDENCE",
  STALE_SOURCE: "STALE_OR_UNTRUSTWORTHY_SOURCE",
  DATA_HEALTH: "DATA_HEALTH_SUPPRESSED"
});
const OUTCOME_REASON_CODES = deepFreeze({
  [OUTCOMES.LEAK]: [
    "STALE_WITHOUT_NEXT_ACTION"
  ],
  [OUTCOMES.NO_LEAK]: [
    "OPPORTUNITY_CLOSED",
    "RECENT_MEANINGFUL_ACTIVITY",
    "NEXT_ACTION_PRESENT"
  ],
  [OUTCOMES.INSUFFICIENT]: [
    "OPPORTUNITY_STAGE_MISSING",
    "MEANINGFUL_ACTIVITY_BASELINE_MISSING"
  ],
  [OUTCOMES.STALE_SOURCE]: [
    "CANONICAL_TIMESTAMP_IN_FUTURE",
    "CANONICAL_SOURCE_TOO_OLD"
  ],
  [OUTCOMES.DATA_HEALTH]: [
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
const ACTIVE_STAGES = new Set([
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "REPLIED",
  "MEETING",
  "PROPOSAL"
]);
const CLOSED_STAGES = new Set(["WON", "LOST"]);
const TASK_STATUSES = new Set([
  "OPEN",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED"
]);
const ACTIVE_TASK_STATUSES = new Set(["OPEN", "IN_PROGRESS"]);
const UNKNOWN_LITERALS = new Set(["unknown", "n/a", "na", "not known"]);

function evaluateStalledOpportunity({
  opportunity,
  activities = [],
  tasks = [],
  evaluatedAt
} = {}) {
  const evaluated_at = trustedEvaluationTime(evaluatedAt);
  if (!isPlainObject(opportunity) || !meaningfulText(opportunity.id)) {
    return outcome(OUTCOMES.DATA_HEALTH, "OPPORTUNITY_EVIDENCE_INVALID");
  }
  const opportunityId = opportunity.id.trim();
  const stage = normalizeStage(opportunity.stage);
  if (stage.missing) {
    return outcome(OUTCOMES.INSUFFICIENT, "OPPORTUNITY_STAGE_MISSING");
  }
  if (!ACTIVE_STAGES.has(stage.value) && !CLOSED_STAGES.has(stage.value)) {
    return outcome(OUTCOMES.DATA_HEALTH, "OPPORTUNITY_STAGE_UNRECOGNIZED");
  }
  if (!Array.isArray(activities)) {
    return outcome(OUTCOMES.DATA_HEALTH, "ACTIVITY_EVIDENCE_INVALID");
  }
  if (!Array.isArray(tasks)) {
    return outcome(OUTCOMES.DATA_HEALTH, "TASK_EVIDENCE_INVALID");
  }

  const relevantActivities = activities.filter(record =>
    record?.opportunity_id === opportunityId
  );
  const relevantTasks = tasks.filter(record =>
    record?.opportunity_id === opportunityId
  );
  const normalizedActivities = normalizeActivities(relevantActivities);
  if (normalizedActivities.error) {
    return outcome(OUTCOMES.DATA_HEALTH, normalizedActivities.error);
  }
  const normalizedTasks = normalizeTasks(relevantTasks);
  if (normalizedTasks.error) {
    return outcome(OUTCOMES.DATA_HEALTH, normalizedTasks.error);
  }
  const opportunityTimestamps = normalizeOpportunityTimestamps(opportunity);
  if (opportunityTimestamps.error) {
    return outcome(OUTCOMES.DATA_HEALTH, opportunityTimestamps.error);
  }
  const nextAction = normalizeNextAction(opportunity.next_action, normalizedTasks.records);
  if (nextAction.error) {
    return outcome(OUTCOMES.DATA_HEALTH, nextAction.error);
  }
  const commercial = canonicalCommercialValue(opportunity);
  if (commercial.error) {
    return outcome(OUTCOMES.DATA_HEALTH, commercial.error);
  }

  const sourceTimestamps = [
    ...opportunityTimestamps.source,
    ...normalizedActivities.records.flatMap(record => record.source_timestamps),
    ...normalizedTasks.records.flatMap(record => record.source_timestamps)
  ];
  const futureTimestamp = sourceTimestamps.find(timestamp =>
    Date.parse(timestamp) > Date.parse(evaluated_at)
  );
  if (futureTimestamp) {
    return outcome(OUTCOMES.STALE_SOURCE, "CANONICAL_TIMESTAMP_IN_FUTURE");
  }

  const baseline = latestActivityBaseline(
    normalizedActivities.records,
    opportunityTimestamps.created_at
  );
  if (!baseline) {
    return outcome(
      OUTCOMES.INSUFFICIENT,
      "MEANINGFUL_ACTIVITY_BASELINE_MISSING"
    );
  }
  const sourceObservedAt = latestTimestamp(sourceTimestamps);
  if (!sourceObservedAt) {
    return outcome(
      OUTCOMES.INSUFFICIENT,
      "MEANINGFUL_ACTIVITY_BASELINE_MISSING"
    );
  }
  if (
    Date.parse(evaluated_at) - Date.parse(sourceObservedAt)
    > SOURCE_FRESHNESS_DAYS * DAY_MS
  ) {
    return outcome(OUTCOMES.STALE_SOURCE, "CANONICAL_SOURCE_TOO_OLD");
  }

  const sourceBasis = {
    opportunity: {
      id: opportunityId,
      stage: stage.value,
      next_action: nextAction.opportunity_value,
      commercial_value: commercial.value,
      created_at: opportunityTimestamps.created_at,
      updated_at: opportunityTimestamps.updated_at
    },
    activities: normalizedActivities.records.map(record => ({
      id: record.id,
      type: record.type,
      created_at: record.created_at,
      updated_at: record.updated_at
    })),
    tasks: normalizedTasks.records.map(record => ({
      id: record.id,
      title: record.title,
      status: record.status,
      due_at: record.due_at,
      completed_at: record.completed_at,
      created_at: record.created_at,
      updated_at: record.updated_at
    }))
  };
  const source = deepFreeze({
    system: "TGE",
    entity_type: "OPPORTUNITY",
    entity_id: opportunityId,
    observed_at: sourceObservedAt,
    observed_version: `sha256:${fingerprint(sourceBasis)}`
  });
  const stalledSince = new Date(
    Date.parse(baseline.at) + STALE_AFTER_DAYS * DAY_MS
  ).toISOString();
  const isStale = Date.parse(evaluated_at) >= Date.parse(stalledSince);
  const evidence = deepFreeze({
    criteria: {
      stale_after_days: STALE_AFTER_DAYS,
      stale_boundary: "AT_OR_AFTER",
      source_freshness_days: SOURCE_FRESHNESS_DAYS,
      source_freshness_boundary: "AT_OR_BEFORE"
    },
    opportunity_stage: stage.value,
    activity_baseline: baseline,
    stalled_since: stalledSince,
    next_action: {
      present: nextAction.present,
      source: nextAction.source,
      opportunity_value: nextAction.opportunity_value,
      active_task_ids: nextAction.active_task_ids
    },
    source_freshness: {
      observed_at: sourceObservedAt,
      maximum_age_days: SOURCE_FRESHNESS_DAYS
    },
    commercial_value_basis: commercial.basis
  });
  const common = {
    detector: DETECTOR,
    source,
    evidence,
    commercial_value: commercial.value
  };

  if (CLOSED_STAGES.has(stage.value)) {
    return outcome(OUTCOMES.NO_LEAK, "OPPORTUNITY_CLOSED", common);
  }
  if (!isStale) {
    return outcome(OUTCOMES.NO_LEAK, "RECENT_MEANINGFUL_ACTIVITY", common);
  }
  if (nextAction.present) {
    return outcome(OUTCOMES.NO_LEAK, "NEXT_ACTION_PRESENT", common);
  }

  const reasonCode = "STALE_WITHOUT_NEXT_ACTION";
  const detection = deepFreeze({
    leak_type: "STALLED_OPPORTUNITY",
    source,
    detector: DETECTOR,
    reason_code: reasonCode,
    evidence_classification: "MIXED",
    evidence,
    commercial_value: commercial.value,
    recommended_action_type: "FOLLOW_UP",
    due_at: null,
    supersession_condition: {
      kind: "CANONICAL_EVIDENCE_CHANGED",
      detector_id: DETECTOR.id,
      detector_version: DETECTOR.version
    }
  });
  return outcome(OUTCOMES.LEAK, reasonCode, { ...common, detection });
}

function outcome(outcomeName, reasonCode, fields = {}) {
  if (!OUTCOME_REASON_CODES[outcomeName]?.includes(reasonCode)) {
    throw new TypeError("Detector outcome reason is outside the versioned contract.");
  }
  return deepFreeze({
    outcome: outcomeName,
    reason_code: reasonCode,
    detector: fields.detector || DETECTOR,
    source: fields.source || null,
    evidence: fields.evidence || null,
    commercial_value: fields.commercial_value || {
      classification: "UNKNOWN",
      amount: null,
      currency: null
    },
    detection: fields.detection || null
  });
}

function normalizeStage(value) {
  if (value === null || value === undefined) return { missing: true };
  if (typeof value !== "string") return { missing: false, value: "" };
  const normalized = value.trim().toUpperCase();
  if (!normalized || UNKNOWN_LITERALS.has(normalized.toLowerCase())) {
    return { missing: true };
  }
  return { missing: false, value: normalized };
}

function normalizeOpportunityTimestamps(opportunity) {
  const created = timestamp(opportunity.created_at);
  const updated = timestamp(opportunity.updated_at);
  if (
    created.invalid
    || updated.invalid
    || timestampsOutOfOrder(created.value, updated.value)
  ) {
    return { error: "CANONICAL_TIMESTAMP_INVALID" };
  }
  return {
    created_at: created.value,
    updated_at: updated.value,
    source: [created.value, updated.value].filter(Boolean)
  };
}

function normalizeActivities(records) {
  const normalized = [];
  const ids = new Set();
  for (const record of records) {
    if (
      !isPlainObject(record)
      || !meaningfulText(record.id)
      || !meaningfulText(record.type)
      || ids.has(record.id.trim())
    ) {
      return { error: "ACTIVITY_EVIDENCE_INVALID" };
    }
    ids.add(record.id.trim());
    const created = timestamp(record.created_at, { required: true });
    const updated = timestamp(record.updated_at);
    if (
      created.invalid
      || updated.invalid
      || timestampsOutOfOrder(created.value, updated.value)
    ) {
      return { error: "CANONICAL_TIMESTAMP_INVALID" };
    }
    normalized.push({
      id: record.id.trim(),
      type: record.type.trim(),
      created_at: created.value,
      updated_at: updated.value,
      source_timestamps: [created.value, updated.value].filter(Boolean)
    });
  }
  normalized.sort(compareEvidenceRecords);
  return { records: normalized };
}

function normalizeTasks(records) {
  const normalized = [];
  const ids = new Set();
  for (const record of records) {
    if (
      !isPlainObject(record)
      || !meaningfulText(record.id)
      || !meaningfulText(record.title)
      || ids.has(record.id.trim())
    ) {
      return { error: "TASK_EVIDENCE_INVALID" };
    }
    ids.add(record.id.trim());
    if (typeof record.status !== "string" || !TASK_STATUSES.has(record.status.trim().toUpperCase())) {
      return { error: "TASK_STATUS_UNRECOGNIZED" };
    }
    const created = timestamp(record.created_at, { required: true });
    const updated = timestamp(record.updated_at);
    const due = timestamp(record.due_at);
    const completed = timestamp(record.completed_at);
    if (
      created.invalid
      || updated.invalid
      || due.invalid
      || completed.invalid
      || timestampsOutOfOrder(created.value, updated.value)
      || timestampsOutOfOrder(created.value, completed.value)
    ) {
      return { error: "CANONICAL_TIMESTAMP_INVALID" };
    }
    const status = record.status.trim().toUpperCase();
    if (
      (status === "COMPLETED" && completed.value === null)
      || (status !== "COMPLETED" && completed.value !== null)
    ) {
      return { error: "TASK_EVIDENCE_INVALID" };
    }
    normalized.push({
      id: record.id.trim(),
      title: normalizeText(record.title),
      status,
      completed_at: completed.value,
      due_at: due.value,
      created_at: created.value,
      updated_at: updated.value,
      source_timestamps: [
        created.value,
        updated.value,
        completed.value
      ].filter(Boolean)
    });
  }
  normalized.sort(compareEvidenceRecords);
  return { records: normalized };
}

function normalizeNextAction(value, tasks) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    return { error: "NEXT_ACTION_EVIDENCE_INVALID" };
  }
  const normalized = typeof value === "string" ? normalizeText(value) : null;
  const opportunityValue = normalized && !UNKNOWN_LITERALS.has(normalized.toLowerCase())
    ? normalized
    : null;
  const activeTaskIds = tasks
    .filter(record => ACTIVE_TASK_STATUSES.has(record.status))
    .map(record => record.id)
    .sort();
  return {
    present: Boolean(opportunityValue || activeTaskIds.length > 0),
    source: opportunityValue
      ? "OPPORTUNITY"
      : activeTaskIds.length > 0 ? "TASK" : "NONE",
    opportunity_value: opportunityValue,
    active_task_ids: activeTaskIds
  };
}

function canonicalCommercialValue(opportunity) {
  const hasValue = Object.hasOwn(opportunity, "value");
  const rawValue = opportunity.value;
  const rawCurrency = opportunity.currency;
  const currencyMissing = rawCurrency === null
    || rawCurrency === undefined
    || (typeof rawCurrency === "string" && rawCurrency.trim() === "");
  if (!currencyMissing && (
    typeof rawCurrency !== "string"
    || !/^[A-Za-z]{3}$/.test(rawCurrency.trim())
  )) {
    return { error: "COMMERCIAL_CURRENCY_INVALID" };
  }
  const currency = currencyMissing ? null : rawCurrency.trim().toUpperCase();
  if (
    !hasValue
    || rawValue === null
    || rawValue === undefined
    || (
      typeof rawValue === "string"
      && (
        rawValue.trim() === ""
        || UNKNOWN_LITERALS.has(rawValue.trim().toLowerCase())
      )
    )
  ) {
    return unknownCommercialValue("VALUE_UNKNOWN", currency !== null);
  }

  let literal;
  if (typeof rawValue === "number") {
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      return { error: "COMMERCIAL_VALUE_INVALID" };
    }
    literal = String(rawValue);
  } else if (typeof rawValue === "string") {
    literal = rawValue;
  } else {
    return { error: "COMMERCIAL_VALUE_INVALID" };
  }
  if (
    !isDecimalNumberLiteral(literal)
    || isNegativeNumberLiteral(literal)
    || !isCanonicalNumericLiteralRepresentable(literal)
  ) {
    return { error: "COMMERCIAL_VALUE_INVALID" };
  }
  if (currency === null) {
    return unknownCommercialValue("CURRENCY_UNKNOWN", false);
  }
  try {
    const value = normalizeCommercialValue({
      classification: "KNOWN",
      amount: literal,
      currency
    });
    return {
      value,
      basis: {
        classification: "KNOWN",
        amount_source: "opportunity.value",
        currency_source: "opportunity.currency"
      }
    };
  } catch {
    return { error: "COMMERCIAL_VALUE_INVALID" };
  }
}

function unknownCommercialValue(reason, currencyPresent) {
  return {
    value: {
      classification: "UNKNOWN",
      amount: null,
      currency: null
    },
    basis: {
      classification: "UNKNOWN",
      reason,
      currency_present: currencyPresent
    }
  };
}

function latestActivityBaseline(activities, opportunityCreatedAt) {
  if (activities.length > 0) {
    const latest = [...activities].sort((left, right) =>
      right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id)
    )[0];
    return {
      kind: "ACTIVITY",
      entity_id: latest.id,
      activity_type: latest.type,
      at: latest.created_at
    };
  }
  return opportunityCreatedAt ? {
    kind: "OPPORTUNITY_CREATED",
    entity_id: null,
    activity_type: null,
    at: opportunityCreatedAt
  } : null;
}

function latestTimestamp(values) {
  return values.length === 0
    ? null
    : [...values].sort().at(-1);
}

function timestampsOutOfOrder(createdAt, laterAt) {
  return Boolean(
    createdAt
    && laterAt
    && Date.parse(laterAt) < Date.parse(createdAt)
  );
}

function timestamp(value, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    return required ? { invalid: true, value: null } : { invalid: false, value: null };
  }
  if (typeof value !== "string" && !(value instanceof Date)) {
    return { invalid: true, value: null };
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? { invalid: true, value: null }
    : { invalid: false, value: parsed.toISOString() };
}

function trustedEvaluationTime(value) {
  const normalized = timestamp(value, { required: true });
  if (normalized.invalid) {
    throw new TypeError("The detector requires a trusted evaluation timestamp.");
  }
  return normalized.value;
}

function compareEvidenceRecords(left, right) {
  return left.id.localeCompare(right.id)
    || left.created_at.localeCompare(right.created_at);
}

function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function meaningfulText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

module.exports = {
  DETECTOR,
  OUTCOMES,
  OUTCOME_REASON_CODES,
  SOURCE_FRESHNESS_DAYS,
  STALE_AFTER_DAYS,
  evaluateStalledOpportunity
};
