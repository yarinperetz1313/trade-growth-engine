const {
  buildOpportunityIntelligence
} = require("./opportunityIntelligence");

const {
  buildValidationPlan
} = require("./validationPlan");

const {
  calculateEconomics
} = require("../analytics/economicsEngine");

function round(value, decimals = 2) {
  const factor =
    Math.pow(10, decimals);

  return (
    Math.round(
      (Number(value) || 0) *
        factor
    ) / factor
  );
}

function clamp(
  value,
  min = 0,
  max = 10
) {
  return Math.max(
    min,
    Math.min(
      max,
      Number(value) || 0
    )
  );
}

function getPriority(
  score
) {
  if (score >= 8) {
    return "HIGH";
  }

  if (score >= 6) {
    return "MEDIUM";
  }

  return "LOW";
}

function buildEconomicSignal(
  economics
) {
  const summary =
    economics?.summary || {};

  const contribution =
    Number(
      summary.contribution
    ) || 0;

  const revenue =
    Number(
      summary.revenue
    ) || 0;

  const cac =
    Number(
      summary.customerAcquisitionCost
    ) || 0;

  const conversion =
    Number(
      summary.conversionRate
    ) || 0;

  let score = 5;

  if (
    contribution > 0
  ) {
    score += 2;
  }

  if (
    revenue > 0
  ) {
    score += 1;
  }

  if (
    cac > 0
  ) {
    score += 1;
  }

  if (
    conversion >= 10
  ) {
    score += 1;
  }

  return {
    score:
      clamp(score),

    contribution:
      round(contribution),

    revenue:
      round(revenue),

    cac:
      round(cac),

    conversionRate:
      round(conversion)
  };
}

function buildDecision({
  service,
  serviceData = {},
  leads = [],
  economics = null
}) {
  const intelligence =
    buildOpportunityIntelligence(
      serviceData
    );

  const validation =
    buildValidationPlan(
      serviceData,
      intelligence
    );

  const economicSignal =
    buildEconomicSignal(
      economics
    );

  const opportunityScore =
    Number(
      intelligence
        ?.scores
        ?.confidenceAdjustedScore
    ) || 0;

  const economicScore =
    economicSignal.score;

  const combinedScore =
    round(
      (
        opportunityScore +
        economicScore
      ) / 2
    );

  let decision =
    "INVESTIGATE";

  if (
    combinedScore >= 8 &&
    intelligence.decision ===
      "STRONG CANDIDATE"
  ) {
    decision =
      "PRIORITISE";
  } else if (
    combinedScore < 5
  ) {
    decision =
      "LOW PRIORITY";
  }

  const recommendations = [];

  if (
    decision ===
    "PRIORITISE"
  ) {
    recommendations.push(
      "Proceed with controlled customer acquisition testing."
    );
  }

  if (
    decision ===
    "INVESTIGATE"
  ) {
    recommendations.push(
      "Collect additional evidence before committing significant resources."
    );
  }

  if (
    decision ===
    "LOW PRIORITY"
  ) {
    recommendations.push(
      "Do not allocate significant acquisition resources until the underlying signals improve."
    );
  }

  if (
    economicSignal
      .conversionRate < 5
  ) {
    recommendations.push(
      "Improve or validate the sales conversion process before scaling acquisition."
    );
  }

  if (
    economicSignal.cac > 0 &&
    economicSignal.contribution > 0 &&
    economicSignal.cac >
      economicSignal.contribution
  ) {
    recommendations.push(
      "Acquisition cost is currently high relative to contribution; validate channel economics."
    );
  }

  return {
    generatedAt:
      new Date().toISOString(),

    service,

    decision,

    priority:
      getPriority(
        combinedScore
      ),

    scores: {
      opportunity:
        round(
          opportunityScore
        ),

      economics:
        round(
          economicScore
        ),

      combined:
        combinedScore
    },

    economics:
      economicSignal,

    opportunity:
      intelligence,

    validation,

    recommendations,

    evidencePolicy: {
      principle:
        "Actuals and verified evidence must be separated from assumptions and hypotheses.",

      warning:
        "A high score does not establish profitability. Real demand, pricing, acquisition and delivery economics must be validated."
    },

    leadCount:
      Array.isArray(leads)
        ? leads.length
        : 0
  };
}

function buildDecisionPortfolio({
  opportunities = [],
  leads = [],
  economics = null
}) {
  const decisions =
    opportunities.map(
      opportunity =>
        buildDecision({
          service:
            opportunity.service ||
            "Unknown",

          serviceData:
            opportunity,

          leads,

          economics
        })
    );

  const prioritised =
    decisions
      .filter(
        item =>
          item.decision ===
          "PRIORITISE"
      )
      .sort(
        (a, b) =>
          b.scores.combined -
          a.scores.combined
      );

  const investigate =
    decisions
      .filter(
        item =>
          item.decision ===
          "INVESTIGATE"
      )
      .sort(
        (a, b) =>
          b.scores.combined -
          a.scores.combined
      );

  const lowPriority =
    decisions
      .filter(
        item =>
          item.decision ===
          "LOW PRIORITY"
      )
      .sort(
        (a, b) =>
          b.scores.combined -
          a.scores.combined
      );

  return {
    generatedAt:
      new Date().toISOString(),

    total:
      decisions.length,

    prioritised,

    investigate,

    lowPriority,

    all:
      decisions
  };
}

module.exports = {
  round,
  clamp,
  getPriority,
  buildEconomicSignal,
  buildDecision,
  buildDecisionPortfolio
};
