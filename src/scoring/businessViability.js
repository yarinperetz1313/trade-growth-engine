function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

/*
  Business viability model.

  IMPORTANT:
  These are MODELING ASSUMPTIONS, not market facts.

  The purpose is to estimate whether an opportunity
  deserves deeper commercial validation.
*/

function calculateBusinessViability(service) {
  const {
    customerValue = 0,
    repeatPotential = 0,
    operationalFit = 0,
    urgency = 0,
    competition = 0,

    marketScore = null,
    differentiation = null,
    competitivePressure = null,
    confidenceScore = null,
    evidenceCoverage = null
  } = service;

  /*
    1. CUSTOMER ECONOMICS POTENTIAL

    Higher customer value + repeat potential + urgency
    generally makes a service more commercially attractive.

    This is not actual revenue or margin.
  */

  const customerEconomics = round(
    customerValue * 0.45 +
    repeatPotential * 0.35 +
    urgency * 0.20
  );

  /*
    2. OPERATIONAL ATTRACTIVENESS

    Measures whether the underlying service profile
    appears operationally suitable according to our
    initial model.
  */

  const operationalAttractiveness = round(
    operationalFit * 0.60 +
    urgency * 0.20 +
    repeatPotential * 0.20
  );

  /*
    3. COMPETITIVE POSITION

    High differentiation is positive.
    High competitive pressure is negative.

    If market research hasn't supplied these values,
    fall back to the initial competition score.
  */

  const differentiationScore =
    typeof differentiation === "number"
      ? differentiation
      : competition;

  const pressureScore =
    typeof competitivePressure === "number"
      ? competitivePressure
      : 5;

  const competitivePosition = round(
    differentiationScore * 0.60 +
    (10 - pressureScore) * 0.40
  );

  /*
    4. EVIDENCE QUALITY

    We don't want the engine becoming overconfident
    because of weak research.
  */

  const evidenceScoreParts = [];

  if (typeof confidenceScore === "number") {
    evidenceScoreParts.push(confidenceScore);
  }

  if (typeof evidenceCoverage === "number") {
    evidenceScoreParts.push(
      evidenceCoverage / 10
    );
  }

  const evidenceQuality =
    evidenceScoreParts.length > 0
      ? round(
          evidenceScoreParts.reduce(
            (sum, value) => sum + value,
            0
          ) / evidenceScoreParts.length
        )
      : 5;

  /*
    5. MARKET VALIDATION

    If research exists, use it.
    Otherwise fall back to the initial opportunity score.
  */

  const marketValidation =
    typeof marketScore === "number"
      ? marketScore
      : round(
          urgency * 0.25 +
          customerValue * 0.25 +
          competition * 0.15 +
          repeatPotential * 0.20 +
          operationalFit * 0.15
        );

  /*
    6. COMMERCIAL VIABILITY

    This is deliberately conservative.

    Market + economics + competitive position
    matter more than raw opportunity.

    Evidence acts as a confidence modifier.
  */

  const rawViability =
    customerEconomics * 0.30 +
    operationalAttractiveness * 0.15 +
    competitivePosition * 0.20 +
    marketValidation * 0.25 +
    evidenceQuality * 0.10;

  const viabilityScore = round(
    clamp(rawViability)
  );

  /*
    7. RISK FLAGS

    These are useful later for deciding what the
    engine should investigate next.
  */

  const risks = [];

  if (pressureScore >= 8) {
    risks.push(
      "High competitive pressure"
    );
  }

  if (differentiationScore <= 5) {
    risks.push(
      "Weak visible differentiation"
    );
  }

  if (repeatPotential <= 5) {
    risks.push(
      "Limited repeat-purchase potential"
    );
  }

  if (customerValue <= 5) {
    risks.push(
      "Lower customer-value profile"
    );
  }

  if (evidenceQuality < 6) {
    risks.push(
      "Insufficient evidence quality"
    );
  }

  if (
    typeof marketScore === "number" &&
    marketScore < 6
  ) {
    risks.push(
      "Weak market-opportunity signal"
    );
  }

  /*
    8. OPPORTUNITY CLASSIFICATION
  */

  let classification;

  if (
    viabilityScore >= 8 &&
    evidenceQuality >= 7
  ) {
    classification = "HIGH PRIORITY";
  } else if (
    viabilityScore >= 7 &&
    evidenceQuality >= 6
  ) {
    classification = "PROMISING";
  } else if (
    viabilityScore >= 6
  ) {
    classification = "INVESTIGATE";
  } else {
    classification = "LOW PRIORITY";
  }

  return {
    viabilityScore,

    classification,

    components: {
      customerEconomics,
      operationalAttractiveness,
      competitivePosition,
      marketValidation,
      evidenceQuality
    },

    risks,

    modelingNote:
      "This score is a decision-support model, not a prediction of revenue, profit, market share, or business success."
  };
}

module.exports = {
  calculateBusinessViability
};
