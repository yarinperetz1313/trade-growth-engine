const CLOSED_STAGES = new Set([
  "WON",
  "LOST"
]);

const ACTION_PRIORITY = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2
};

const ACTION_TYPE_PRIORITY = {
  CREATE_TASK: 0,
  RESEARCH: 1,
  FOLLOW_UP: 2,
  QUALIFY: 3,
  ADVANCE: 4,
  REVIEW: 5
};

const CLASSIFICATION_PRIORITY = {
  NO_NEXT_ACTION: 0,
  STALE: 1,
  AT_RISK: 2,
  VALUE_UNKNOWN: 3,
  STRONG: 4
};

function isFiniteNumber(value) {
  const isNumericString =
    typeof value === "string" &&
    value.trim() !== "";

  return (
    (typeof value === "number" || isNumericString) &&
    Number.isFinite(Number(value))
  );
}

function isKnownCommercialValue(value) {
  return (
    isFiniteNumber(value) &&
    Number(value) > 0
  );
}

function comparableProbability(value) {
  return isFiniteNumber(value) ? Number(value) : 0;
}

function emptyValueSummary() {
  return {
    known_total: 0,
    known_count: 0,
    unknown_count: 0
  };
}

function addCommercialValue(summary, value) {
  if (!isKnownCommercialValue(value)) {
    summary.unknown_count += 1;
    return;
  }

  summary.known_count += 1;
  summary.known_total += Number(value);
}

function addWeightedValue(summary, opportunity) {
  if (
    !isKnownCommercialValue(opportunity?.value) ||
    !isFiniteNumber(opportunity?.weighted_value)
  ) {
    summary.unknown_count += 1;
    return;
  }

  summary.known_count += 1;
  summary.known_total += Number(
    opportunity.weighted_value
  );
}

function createClassification() {
  return {
    count: 0,
    value: emptyValueSummary()
  };
}

function hasNextAction(opportunity) {
  const value = opportunity?.next_action;

  return (
    value !== null &&
    value !== undefined &&
    String(value).trim() !== ""
  );
}

function classificationTypes(opportunity, intelligence) {
  const risks =
    intelligence?.health?.risks || [];
  const riskTypes = new Set(
    risks.map(risk => risk?.type)
  );
  const types = [];

  if (
    riskTypes.has("NO_NEXT_ACTION") ||
    !hasNextAction(opportunity)
  ) {
    types.push("NO_NEXT_ACTION");
  }

  if (
    riskTypes.has("STALE") ||
    Number(intelligence?.score?.stale_risk) >= 70
  ) {
    types.push("STALE");
  }

  if (
    intelligence?.health?.status === "AT_RISK"
  ) {
    types.push("AT_RISK");
  }

  if (!isKnownCommercialValue(opportunity?.value)) {
    types.push("VALUE_UNKNOWN");
  }

  if (
    intelligence?.health?.status === "STRONG"
  ) {
    types.push("STRONG");
  }

  return types.sort(
    (left, right) =>
      CLASSIFICATION_PRIORITY[left] -
      CLASSIFICATION_PRIORITY[right]
  );
}

function compareTopActions(left, right) {
  const leftPriority =
    ACTION_PRIORITY[left.action.priority] ?? 99;
  const rightPriority =
    ACTION_PRIORITY[right.action.priority] ?? 99;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftClassification =
    CLASSIFICATION_PRIORITY[left.classification_types[0]] ?? 99;
  const rightClassification =
    CLASSIFICATION_PRIORITY[right.classification_types[0]] ?? 99;

  if (leftClassification !== rightClassification) {
    return leftClassification - rightClassification;
  }

  const leftStaleRisk =
    Number(left.evidence.stale_risk) || 0;
  const rightStaleRisk =
    Number(right.evidence.stale_risk) || 0;

  if (leftStaleRisk !== rightStaleRisk) {
    return rightStaleRisk - leftStaleRisk;
  }

  const leftValue =
    left.value.known ? left.value.amount : -1;
  const rightValue =
    right.value.known ? right.value.amount : -1;

  if (leftValue !== rightValue) {
    return rightValue - leftValue;
  }

  const leftProbability = comparableProbability(
    left.probability
  );
  const rightProbability = comparableProbability(
    right.probability
  );

  if (leftProbability !== rightProbability) {
    return rightProbability - leftProbability;
  }

  const leftActionType =
    ACTION_TYPE_PRIORITY[left.action.type] ?? 99;
  const rightActionType =
    ACTION_TYPE_PRIORITY[right.action.type] ?? 99;

  if (leftActionType !== rightActionType) {
    return leftActionType - rightActionType;
  }

  return String(left.opportunity_id).localeCompare(
    String(right.opportunity_id)
  );
}

function buildRevenueIntelligence({
  opportunities = [],
  intelligences = [],
  generatedAt
} = {}) {
  const intelligenceByOpportunityId = new Map(
    intelligences.map(item => [
      item?.opportunity_id,
      item
    ])
  );
  const classifications = {
    STRONG: createClassification(),
    AT_RISK: createClassification(),
    STALE: createClassification(),
    NO_NEXT_ACTION: createClassification(),
    VALUE_UNKNOWN: createClassification()
  };
  const activePipeline = {
    count: 0,
    value: emptyValueSummary(),
    weighted_value: emptyValueSummary()
  };
  const attention = {
    opportunity_count: 0,
    value: emptyValueSummary()
  };
  const topActions = [];

  for (const opportunity of opportunities) {
    if (CLOSED_STAGES.has(opportunity?.stage)) {
      continue;
    }

    const intelligence =
      intelligenceByOpportunityId.get(opportunity.id) || {};
    const types = classificationTypes(
      opportunity,
      intelligence
    );

    activePipeline.count += 1;
    addCommercialValue(
      activePipeline.value,
      opportunity.value
    );
    addWeightedValue(
      activePipeline.weighted_value,
      opportunity
    );

    for (const type of types) {
      const classification = classifications[type];
      classification.count += 1;
      addCommercialValue(
        classification.value,
        opportunity.value
      );
    }

    const requiresAttention = types.some(
      type => type !== "STRONG"
    );

    if (requiresAttention) {
      attention.opportunity_count += 1;
      addCommercialValue(
        attention.value,
        opportunity.value
      );
    }

    const action =
      intelligence.next_best_action || {
        type: "REVIEW",
        priority: "LOW",
        title: "Review the opportunity",
        reason:
          "No deterministic next-best action is available.",
        taskTitle: null
      };
    const actionType = action.type || "REVIEW";

    topActions.push({
      action_id: `${opportunity.id}:${actionType}`,
      opportunity_id: opportunity.id,
      business_name:
        intelligence?.resolved?.business_name ||
        opportunity.business_name ||
        opportunity.name ||
        null,
      stage: opportunity.stage || null,
      probability: isFiniteNumber(opportunity.probability)
        ? Number(opportunity.probability)
        : null,
      value: {
        known: isKnownCommercialValue(opportunity.value),
        amount: isKnownCommercialValue(opportunity.value)
          ? Number(opportunity.value)
          : null
      },
      classification_types: types,
      action: {
        type: actionType,
        priority: action.priority || "LOW",
        title: action.title || "Review the opportunity",
        reason: action.reason || null,
        task_title: action.taskTitle || null
      },
      evidence: {
        health_status:
          intelligence?.health?.status || null,
        risk_types:
          (intelligence?.health?.risks || [])
            .map(risk => risk?.type)
            .filter(Boolean),
        stale_risk:
          intelligence?.score?.stale_risk ?? null,
        known:
          intelligence?.evidence?.known || [],
        unknown:
          intelligence?.evidence?.unknown || []
      }
    });
  }

  return {
    generated_at: generatedAt,
    value_semantics: {
      commercial_value_known_only_when_positive: true,
      zero_blank_or_non_numeric_value_is_unknown: true
    },
    active_pipeline: activePipeline,
    classifications,
    revenue_requiring_attention: attention,
    top_actions: topActions
      .sort(compareTopActions)
      .slice(0, 5)
  };
}

module.exports = {
  buildRevenueIntelligence,
  compareTopActions
};
