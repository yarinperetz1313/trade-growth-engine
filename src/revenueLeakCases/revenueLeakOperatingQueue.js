"use strict";

const {
  deepFreeze,
  normalizeCommercialValue,
  normalizeTimestamp
} = require("./revenueLeakCaseDomain");

const PORTFOLIO_SCAN_LIMIT = 100;
const OPERATING_QUEUE_LIMIT = 100;
const ACTIVE_CASE_STATES = new Set(["OPEN", "SNOOZED"]);
const ACTION_STATUSES = new Set([
  "RECOMMENDED",
  "PREPARED",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "REJECTED",
  "CANCELLED",
  "FAILED"
]);
const VALUE_TIER = Object.freeze({
  KNOWN_POSITIVE: 0,
  KNOWN_ZERO: 1,
  UNKNOWN: 2,
  NOT_APPLICABLE: 3
});
const URGENCY_TIER = Object.freeze({
  OVERDUE: 0,
  SNOOZE_WAKE_DUE: 1,
  OPEN_NO_OVERDUE_DEADLINE: 2,
  SNOOZED_UNTIL_FUTURE: 3
});

class RevenueLeakOperatingQueueError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RevenueLeakOperatingQueueError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new RevenueLeakOperatingQueueError(code, message, details);
}

function requireCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "Operating queue persistence returned an invalid count.",
      { field }
    );
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "Operating queue persistence returned malformed identity evidence.",
      { field }
    );
  }
  return value.trim();
}

function buildRevenueLeakOperatingQueue({
  contexts = [],
  totalCount,
  generatedAt
} = {}) {
  const generated_at = normalizeTimestamp(generatedAt, "generated_at");
  const total_cases = requireCount(totalCount, "totalCount");
  if (total_cases > OPERATING_QUEUE_LIMIT) {
    fail(
      "REVENUE_LEAK_QUEUE_LIMIT_EXCEEDED",
      "The active revenue leak queue exceeds the safe operating limit.",
      {
        complete: false,
        limit: OPERATING_QUEUE_LIMIT,
        total_cases,
        projected_count: 0,
        omitted_count: total_cases
      }
    );
  }
  if (!Array.isArray(contexts) || contexts.length !== total_cases) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "Operating queue persistence did not return a complete active-case set."
    );
  }

  const entries = contexts.map(context => buildEntry(context, generated_at));
  entries.sort(compareEntries);
  return deepFreeze({
    generated_at,
    complete: true,
    limit: OPERATING_QUEUE_LIMIT,
    total_cases,
    projected_count: entries.length,
    omitted_count: 0,
    scope: {
      leak_types: ["STALLED_OPPORTUNITY"],
      lifecycle_states: ["OPEN", "SNOOZED"]
    },
    value_semantics: {
      known_positive_and_zero_are_distinct: true,
      unknown_is_not_zero: true,
      not_applicable_is_not_zero: true,
      monetary_totals_grouped_by_currency: true,
      cross_currency_ranking: false
    },
    value_summary: summarizeValues(entries),
    ordering: {
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
    },
    entries
  });
}

function buildEntry(context, generatedAt) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "Operating queue persistence returned malformed context."
    );
  }
  const record = context.case;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "Operating queue persistence returned a malformed case."
    );
  }
  const id = requireText(record.id, "case.id");
  const state = requireText(record.state, "case.state");
  if (!ACTIVE_CASE_STATES.has(state)) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "Operating queue persistence returned a non-active case.",
      { case_id: id }
    );
  }
  const detectedAt = normalizeTimestamp(record.detected_at, "case.detected_at");
  if (Date.parse(detectedAt) > Date.parse(generatedAt)) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "A revenue leak case cannot be newer than its queue projection.",
      { case_id: id }
    );
  }
  const commercialValue = normalizeCommercialValue(record.commercial_value);
  const valueKind = commercialValue.classification === "KNOWN"
    ? commercialValue.amount === "0" ? "KNOWN_ZERO" : "KNOWN_POSITIVE"
    : commercialValue.classification;
  const opportunityId = requireText(record.opportunity_id, "case.opportunity_id");
  const opportunity = canonicalOpportunity(context.opportunity, opportunityId);
  const business = canonicalBusiness(context.business, opportunity);
  const urgency = deriveUrgency(record, generatedAt);
  const elapsedMilliseconds = Date.parse(generatedAt) - Date.parse(detectedAt);

  return {
    case: {
      id,
      leak_type: requireText(record.leak_type, "case.leak_type"),
      lifecycle_state: state,
      reason_code: requireText(record.reason_code, "case.reason_code"),
      detector: {
        id: requireText(record.detector_id, "case.detector_id"),
        version: requireText(record.detector_version, "case.detector_version")
      },
      source: {
        system: requireText(record.source_system, "case.source_system"),
        entity_type: requireText(record.source_entity_type, "case.source_entity_type"),
        entity_id: requireText(record.source_entity_id, "case.source_entity_id"),
        observed_at: normalizeTimestamp(
          record.source_observed_at,
          "case.source_observed_at"
        ),
        observed_version: requireText(
          record.source_observed_version,
          "case.source_observed_version"
        )
      },
      evidence_classification: requireText(
        record.evidence_classification,
        "case.evidence_classification"
      ),
      evidence_snapshot: structuredClone(record.evidence_snapshot),
      recommended_action_type: requireText(
        record.recommended_action_type,
        "case.recommended_action_type"
      ),
      detected_at: detectedAt,
      due_at: record.due_at === null
        ? null
        : normalizeTimestamp(record.due_at, "case.due_at")
    },
    historical_opportunity_id: opportunityId,
    opportunity: opportunity === null
      ? null
      : {
          id: opportunity.id,
          business_name: opportunity.business_name
        },
    business,
    potential_value: {
      kind: valueKind,
      classification: commercialValue.classification,
      amount: commercialValue.amount,
      currency: commercialValue.currency
    },
    leak_age: {
      basis: "DETECTED_AT",
      detected_at: detectedAt,
      elapsed_seconds: Math.floor(elapsedMilliseconds / 1000),
      elapsed_days: Math.floor(elapsedMilliseconds / 86400000)
    },
    urgency: {
      classification: urgency.classification,
      basis_timestamp: urgency.basisTimestamp
    },
    linked_revenue_action: linkedRevenueAction(
      record,
      context.revenue_action,
      opportunityId
    ),
    ordering_factors: {
      urgency_tier: urgency.classification,
      value_tier: valueKind,
      currency_group: valueKind === "KNOWN_POSITIVE"
        ? commercialValue.currency
        : null,
      comparable_amount: valueKind === "KNOWN_POSITIVE"
        ? commercialValue.amount
        : null,
      leak_age_seconds: Math.floor(elapsedMilliseconds / 1000),
      leak_age_milliseconds: elapsedMilliseconds,
      stable_case_id: id
    },
    _sort: {
      urgency: URGENCY_TIER[urgency.classification],
      value: VALUE_TIER[valueKind],
      leakAgeMilliseconds: elapsedMilliseconds
    }
  };
}

function canonicalOpportunity(value, expectedId) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value) || value.id !== expectedId) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "Operating queue opportunity context is inconsistent."
    );
  }
  return {
    id: expectedId,
    prospect_id: typeof value.prospect_id === "string" && value.prospect_id.trim()
      ? value.prospect_id.trim()
      : null,
    business_name: typeof value.business_name === "string" && value.business_name.trim()
      ? value.business_name.trim()
      : null
  };
}

function canonicalBusiness(value, opportunity) {
  if (value === null || value === undefined) return null;
  if (
    !opportunity?.prospect_id
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== opportunity.prospect_id
  ) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "Operating queue business context is inconsistent."
    );
  }
  return {
    id: opportunity.prospect_id,
    name: typeof value.business_name === "string" && value.business_name.trim()
      ? value.business_name.trim()
      : null
  };
}

function linkedRevenueAction(record, action, opportunityId) {
  if (record.revenue_action_id === null || record.revenue_action_id === undefined) {
    if (action !== null && action !== undefined) {
      fail(
        "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
        "Unlinked cases cannot carry RevenueAction context."
      );
    }
    return null;
  }
  const id = requireText(record.revenue_action_id, "case.revenue_action_id");
  const fingerprint = requireText(
    record.revenue_action_fingerprint,
    "case.revenue_action_fingerprint"
  );
  const statusAtLink = requireText(
    record.revenue_action_status_at_link,
    "case.revenue_action_status_at_link"
  );
  if (!ACTION_STATUSES.has(statusAtLink)) {
    fail(
      "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
      "RevenueAction snapshot status is invalid."
    );
  }
  let currentStatus = null;
  if (action !== null && action !== undefined) {
    if (
      typeof action !== "object"
      || Array.isArray(action)
      || action.id !== id
      || action.opportunity_id !== opportunityId
      || action.basis_fingerprint !== fingerprint
      || !ACTION_STATUSES.has(action.status)
    ) {
      fail(
        "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
        "Linked RevenueAction context is inconsistent."
      );
    }
    currentStatus = action.status;
  }
  return {
    id,
    snapshot: {
      basis_fingerprint: fingerprint,
      status: statusAtLink,
      linked_at: normalizeTimestamp(
        record.revenue_action_linked_at,
        "case.revenue_action_linked_at"
      )
    },
    current: { status: currentStatus }
  };
}

function deriveUrgency(record, generatedAt) {
  const generated = Date.parse(generatedAt);
  if (record.due_at !== null && record.due_at !== undefined) {
    const dueAt = normalizeTimestamp(record.due_at, "case.due_at");
    if (Date.parse(dueAt) <= generated) {
      return { classification: "OVERDUE", basisTimestamp: dueAt };
    }
  }
  if (record.state === "SNOOZED") {
    const wakeAt = normalizeTimestamp(record.snoozed_until, "case.snoozed_until");
    return Date.parse(wakeAt) <= generated
      ? { classification: "SNOOZE_WAKE_DUE", basisTimestamp: wakeAt }
      : { classification: "SNOOZED_UNTIL_FUTURE", basisTimestamp: wakeAt };
  }
  return {
    classification: "OPEN_NO_OVERDUE_DEADLINE",
    basisTimestamp: record.due_at === null || record.due_at === undefined
      ? null
      : normalizeTimestamp(record.due_at, "case.due_at")
  };
}

function compareEntries(left, right) {
  if (left._sort.urgency !== right._sort.urgency) {
    return left._sort.urgency - right._sort.urgency;
  }
  if (left._sort.value !== right._sort.value) {
    return left._sort.value - right._sort.value;
  }
  if (left.potential_value.kind === "KNOWN_POSITIVE") {
    const currency = left.potential_value.currency.localeCompare(
      right.potential_value.currency
    );
    if (currency !== 0) return currency;
    const amount = compareCanonicalDecimals(
      right.potential_value.amount,
      left.potential_value.amount
    );
    if (amount !== 0) return amount;
  }
  if (left._sort.leakAgeMilliseconds !== right._sort.leakAgeMilliseconds) {
    return right._sort.leakAgeMilliseconds - left._sort.leakAgeMilliseconds;
  }
  return left.case.id.localeCompare(right.case.id);
}

function summarizeValues(entries) {
  const positiveByCurrency = new Map();
  const zeroByCurrency = new Map();
  let positiveCount = 0;
  let zeroCount = 0;
  let unknownCount = 0;
  let notApplicableCount = 0;

  for (const entry of entries) {
    const { kind, amount, currency } = entry.potential_value;
    if (kind === "KNOWN_POSITIVE") {
      positiveCount += 1;
      const aggregate = positiveByCurrency.get(currency) || {
        units: 0n,
        caseCount: 0
      };
      aggregate.units += decimalUnits(amount);
      aggregate.caseCount += 1;
      positiveByCurrency.set(currency, aggregate);
    } else if (kind === "KNOWN_ZERO") {
      zeroCount += 1;
      zeroByCurrency.set(currency, (zeroByCurrency.get(currency) || 0) + 1);
    } else if (kind === "UNKNOWN") {
      unknownCount += 1;
    } else {
      notApplicableCount += 1;
    }
  }

  return {
    known_positive: {
      case_count: positiveCount,
      totals_by_currency: [...positiveByCurrency.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, aggregate]) => ({
          currency,
          amount: decimalFromUnits(aggregate.units),
          case_count: aggregate.caseCount
        }))
    },
    known_zero: {
      case_count: zeroCount,
      counts_by_currency: [...zeroByCurrency.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, caseCount]) => ({ currency, case_count: caseCount }))
    },
    unknown: { case_count: unknownCount },
    not_applicable: { case_count: notApplicableCount }
  };
}

function decimalUnits(value) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000000n
    + BigInt(fraction.padEnd(6, "0"));
}

function decimalFromUnits(value) {
  const whole = value / 1000000n;
  const fraction = String(value % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function compareCanonicalDecimals(left, right) {
  const leftUnits = decimalUnits(left);
  const rightUnits = decimalUnits(right);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

function publicQueue(queue) {
  const clone = structuredClone(queue);
  for (const entry of clone.entries) delete entry._sort;
  return deepFreeze(clone);
}

module.exports = {
  OPERATING_QUEUE_LIMIT,
  PORTFOLIO_SCAN_LIMIT,
  RevenueLeakOperatingQueueError,
  buildRevenueLeakOperatingQueue: input => publicQueue(
    buildRevenueLeakOperatingQueue(input)
  ),
  compareCanonicalDecimals
};
