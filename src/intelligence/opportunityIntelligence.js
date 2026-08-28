function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function buildOpportunityIntelligence(service) {
  const initialScore = service.initialScore ?? 0;
  const marketScore = service.marketScore ?? 0;

  const competitionPressure =
    service.saturation ?? null;

  const differentiation =
    service.gapOpportunity ?? null;

  const responseGap =
    service.responseTimeGap ?? null;

  const pricingGap =
    service.pricingTransparencyGap ?? null;

  const evidenceConfidence =
    service.evidenceConfidence ?? null;

  const evidenceCoverage =
    service.evidenceCoverage ?? null;

  /*
    IMPORTANT:

    These are model outputs based on the available
    evidence. They are NOT claims about profitability.
  */

  const signals = {
    demandSignal: round(initialScore),

    competitivePressure:
      competitionPressure === null
        ? null
        : round(competitionPressure),

    differentiationPotential:
      differentiation === null
        ? null
        : round(differentiation),

    serviceLevelDifferentiation:
      responseGap === null
        ? null
        : round(responseGap),

    pricingDifferentiation:
      pricingGap === null
        ? null
        : round(pricingGap),

    evidenceConfidence:
      evidenceConfidence === null
        ? null
        : round(evidenceConfidence),

    evidenceCoverage:
      evidenceCoverage === null
        ? null
        : round(evidenceCoverage)
  };

  /*
    Opportunity strength

    This deliberately does NOT use fake revenue,
    customer counts or market-share assumptions.
  */

  const availableSignals = [
    initialScore,
    marketScore,
    differentiation,
    responseGap,
    pricingGap
  ].filter(value => typeof value === "number");

  const rawOpportunity =
    availableSignals.length > 0
      ? availableSignals.reduce((a, b) => a + b, 0) /
        availableSignals.length
      : 0;

  const opportunityScore = round(
    clamp(rawOpportunity)
  );

  /*
    Evidence adjustment.

    We do not want weak evidence to look equally
    convincing as strong evidence.
  */

  let evidenceAdjustment = 1;

  if (typeof evidenceConfidence === "number") {
    evidenceAdjustment *= 0.5 + evidenceConfidence / 20;
  }

  if (typeof evidenceCoverage === "number") {
    evidenceAdjustment *= 0.5 + evidenceCoverage / 20;
  }

  const confidenceAdjustedScore = round(
    clamp(opportunityScore * evidenceAdjustment)
  );

  let decision = "INVESTIGATE";

  if (
    confidenceAdjustedScore >= 7.5 &&
    (evidenceConfidence === null ||
      evidenceConfidence >= 7)
  ) {
    decision = "STRONG CANDIDATE";
  } else if (
    confidenceAdjustedScore < 5
  ) {
    decision = "LOW PRIORITY";
  }

  /*
    These are hypotheses for future validation,
    not claims that the market currently proves them.
  */

  const hypotheses = [];

  if (responseGap >= 7) {
    hypotheses.push(
      "A clearly communicated response-time promise may be worth testing."
    );
  }

  if (pricingGap >= 7) {
    hypotheses.push(
      "Transparent pricing or clearly explained pricing may be a potential differentiator."
    );
  }

  if (differentiation >= 7) {
    hypotheses.push(
      "There may be room to differentiate through positioning, service design or customer experience."
    );
  }

  if (service.repeatPotential >= 8) {
    hypotheses.push(
      "Repeat or recurring revenue potential appears attractive based on the current service model."
    );
  }

  const unknowns = [
    "Actual customer acquisition cost",
    "Actual conversion rate",
    "Actual average job value",
    "Actual gross margin",
    "Actual labour cost",
    "Actual lead volume",
    "Actual customer lifetime value",
    "Actual willingness to pay"
  ];

  return {
    service: service.name,

    scores: {
      opportunityScore,
      confidenceAdjustedScore,
      evidenceAdjustment: round(evidenceAdjustment)
    },

    signals,

    decision,

    hypotheses,

    criticalUnknowns: unknowns,

    warning:
      "This analysis identifies opportunity signals. It does not establish profitability without real commercial and operating data."
  };
}

module.exports = {
  buildOpportunityIntelligence
};
