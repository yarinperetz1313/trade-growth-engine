/**
 * TRADE GROWTH ENGINE
 * Unified Decision Engine
 *
 * Converts:
 *
 * MARKET
 * + COMPETITION
 * + ECONOMICS
 * + EVIDENCE
 *
 * into:
 *
 * TEST / VALIDATE / HOLD / REJECT
 *
 * IMPORTANT:
 * A high score does NOT mean profitability is proven.
 */

function round(value, decimals = 1) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function calculateDecisionScore({
  initialScore,
  marketScore,
  economicScore,
  confidenceScore
}) {
  const components = [];

  if (typeof initialScore === "number") {
    components.push({
      value: initialScore,
      weight: 0.25
    });
  }

  if (typeof marketScore === "number") {
    components.push({
      value: marketScore,
      weight: 0.25
    });
  }

  if (typeof economicScore === "number") {
    components.push({
      value: economicScore,
      weight: 0.30
    });
  }

  if (typeof confidenceScore === "number") {
    components.push({
      value: confidenceScore,
      weight: 0.20
    });
  }

  if (components.length === 0) {
    return null;
  }

  const totalWeight =
    components.reduce(
      (sum, component) =>
        sum + component.weight,
      0
    );

  const weightedScore =
    components.reduce(
      (sum, component) =>
        sum +
        component.value *
          component.weight,
      0
    ) / totalWeight;

  return round(
    clamp(weightedScore)
  );
}

function determineEvidenceState({
  confidenceScore,
  economicValidated
}) {
  if (
    economicValidated === true &&
    typeof confidenceScore === "number" &&
    confidenceScore >= 8
  ) {
    return "STRONG_VALIDATION";
  }

  if (
    typeof confidenceScore === "number" &&
    confidenceScore >= 7
  ) {
    return "GOOD_EVIDENCE";
  }

  if (
    typeof confidenceScore === "number" &&
    confidenceScore >= 5
  ) {
    return "LIMITED_EVIDENCE";
  }

  return "WEAK_EVIDENCE";
}

function determineDecision({
  decisionScore,
  evidenceState,
  economicScore,
  marketScore
}) {
  /*
    Never call something "proven" simply because the
    mathematical score is high.
  */

  if (
    decisionScore === null
  ) {
    return {
      action: "HOLD",
      reason:
        "Insufficient data to make a reliable decision."
    };
  }

  if (
    evidenceState === "WEAK_EVIDENCE"
  ) {
    return {
      action: "VALIDATE",
      reason:
        "The opportunity may be attractive, but evidence quality is too weak for a meaningful business test."
    };
  }

  if (
    typeof economicScore === "number" &&
    economicScore < 5
  ) {
    return {
      action: "REJECT_OR_REDESIGN",
      reason:
        "The current economic model is too weak to justify testing without changing the assumptions or offer."
    };
  }

  if (
    typeof marketScore === "number" &&
    marketScore < 5
  ) {
    return {
      action: "HOLD",
      reason:
        "The current competitive-market signal is insufficient."
    };
  }

  if (
    decisionScore >= 7.5 &&
    evidenceState !== "WEAK_EVIDENCE"
  ) {
    return {
      action: "TEST",
      reason:
        "The opportunity has a sufficiently strong combined signal to justify a controlled real-world test."
    };
  }

  if (
    decisionScore >= 6
  ) {
    return {
      action: "VALIDATE",
      reason:
        "The opportunity is interesting, but additional evidence should be collected before committing significant resources."
    };
  }

  return {
    action: "HOLD",
    reason:
      "The current opportunity signal is not strong enough to prioritise."
  };
}

function buildDecision(opportunity, options = {}) {
  if (
    !opportunity ||
    !opportunity.name
  ) {
    return {
      success: false,
      error:
        "A valid opportunity is required."
    };
  }

  const economicScore =
    typeof opportunity.economicScore === "number"
      ? opportunity.economicScore
      : typeof opportunity.economicViability === "number"
      ? opportunity.economicViability
      : null;

  const confidenceScore =
    typeof opportunity.confidenceScore === "number"
      ? opportunity.confidenceScore
      : null;

  const marketScore =
    typeof opportunity.marketScore === "number"
      ? opportunity.marketScore
      : null;

  const initialScore =
    typeof opportunity.initialScore === "number"
      ? opportunity.initialScore
      : null;

  const economicValidated =
    options.economicValidated === true;

  const decisionScore =
    calculateDecisionScore({
      initialScore,
      marketScore,
      economicScore,
      confidenceScore
    });

  const evidenceState =
    determineEvidenceState({
      confidenceScore,
      economicValidated
    });

  const decision =
    determineDecision({
      decisionScore,
      evidenceState,
      economicScore,
      marketScore
    });

  const modelledInputs = [];

  if (economicScore !== null) {
    modelledInputs.push(
      "Economic score"
    );
  }

  if (
    opportunity.averageJobValue != null
  ) {
    modelledInputs.push(
      "Average job value"
    );
  }

  if (
    opportunity.customerAcquisitionCost != null
  ) {
    modelledInputs.push(
      "Customer acquisition cost"
    );
  }

  return {
    success: true,

    service:
      opportunity.name,

    decisionScore,

    action:
      decision.action,

    reason:
      decision.reason,

    evidenceState,

    validation: {
      economicValidated,
      modelledInputs,
      realCustomerDataAvailable:
        options.realCustomerDataAvailable === true
    },

    components: {
      initialOpportunity:
        initialScore,

      marketOpportunity:
        marketScore,

      economicViability:
        economicScore,

      evidenceConfidence:
        confidenceScore
    },

    nextSteps:
      getNextSteps(
        decision.action,
        evidenceState
      )
  };
}

function getNextSteps(
  action,
  evidenceState
) {
  if (
    action === "TEST"
  ) {
    return [
      "Define the target customer.",
      "Define the initial offer.",
      "Define the acquisition channel.",
      "Set a controlled test budget.",
      "Track enquiries, qualified leads, quotes and sales.",
      "Calculate actual acquisition cost.",
      "Calculate actual contribution.",
      "Feed real results back into the engine."
    ];
  }

  if (
    action === "VALIDATE"
  ) {
    return [
      "Improve evidence quality.",
      "Verify the target customer.",
      "Verify market demand.",
      "Improve economic assumptions.",
      "Collect stronger competitor evidence.",
      "Re-run the decision."
    ];
  }

  if (
    action === "REJECT_OR_REDESIGN"
  ) {
    return [
      "Identify the economic weakness.",
      "Test alternative pricing.",
      "Test alternative positioning.",
      "Recalculate contribution.",
      "Only retest if economics improve."
    ];
  }

  return [
    "Collect additional evidence.",
    "Review assumptions.",
    "Re-run the opportunity analysis."
  ];
}

module.exports = {
  calculateDecisionScore,
  determineEvidenceState,
  determineDecision,
  buildDecision
};
