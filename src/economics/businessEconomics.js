/**
 * TRADE GROWTH ENGINE
 * Business Economics Engine
 *
 * IMPORTANT:
 * This module performs decision-support calculations.
 * It does NOT predict actual profit.
 *
 * Unless otherwise stated, inputs are assumptions and must
 * eventually be validated against real customer/job data.
 */

const DEFAULT_ASSUMPTIONS = {
  averageJobValue: 750,
  grossMargin: 0.35,
  leadToJobRate: 0.30,
  customerAcquisitionCost: 150,
  repeatPotential: 0.50,
  labourHoursPerJob: 3,
  materialCostRate: 0.35,
  overheadRate: 0.15,
};

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function calculateUnitEconomics(assumptions = {}) {
  const a = {
    ...DEFAULT_ASSUMPTIONS,
    ...assumptions,
  };

  const revenue = Number(a.averageJobValue);

  const materialCost =
    revenue * Number(a.materialCostRate);

  const grossProfit =
    revenue - materialCost;

  const overhead =
    revenue * Number(a.overheadRate);

  const contributionBeforeAcquisition =
    grossProfit - overhead;

  const acquisitionCost =
    Number(a.customerAcquisitionCost);

  const contributionAfterAcquisition =
    contributionBeforeAcquisition -
    acquisitionCost;

  const repeatValue =
    revenue *
    Number(a.repeatPotential) *
    Number(a.grossMargin);

  const estimatedCustomerValue =
    contributionAfterAcquisition +
    repeatValue;

  const acquisitionRatio =
    revenue > 0
      ? acquisitionCost / revenue
      : null;

  const contributionMargin =
    revenue > 0
      ? contributionAfterAcquisition / revenue
      : null;

  return {
    revenue: round(revenue),
    materialCost: round(materialCost),
    grossProfit: round(grossProfit),
    overhead: round(overhead),
    acquisitionCost: round(acquisitionCost),

    contributionBeforeAcquisition:
      round(contributionBeforeAcquisition),

    contributionAfterAcquisition:
      round(contributionAfterAcquisition),

    repeatValue:
      round(repeatValue),

    estimatedCustomerValue:
      round(estimatedCustomerValue),

    acquisitionRatio:
      acquisitionRatio == null
        ? null
        : round(acquisitionRatio),

    contributionMargin:
      contributionMargin == null
        ? null
        : round(contributionMargin),
  };
}

function calculateEconomicScore(
  assumptions = {}
) {
  const a = {
    ...DEFAULT_ASSUMPTIONS,
    ...assumptions,
  };

  const economics =
    calculateUnitEconomics(a);

  let score = 5;

  if (economics.contributionAfterAcquisition > 500) {
    score += 2;
  } else if (
    economics.contributionAfterAcquisition > 250
  ) {
    score += 1;
  } else if (
    economics.contributionAfterAcquisition < 0
  ) {
    score -= 3;
  } else if (
    economics.contributionAfterAcquisition < 100
  ) {
    score -= 1;
  }

  if (a.repeatPotential >= 0.70) {
    score += 1;
  } else if (a.repeatPotential >= 0.40) {
    score += 0.5;
  }

  if (a.leadToJobRate >= 0.50) {
    score += 1;
  } else if (a.leadToJobRate >= 0.30) {
    score += 0.5;
  } else if (a.leadToJobRate < 0.15) {
    score -= 1;
  }

  const acquisitionRatio =
    a.averageJobValue > 0
      ? a.customerAcquisitionCost /
        a.averageJobValue
      : 1;

  if (acquisitionRatio <= 0.15) {
    score += 1;
  } else if (acquisitionRatio <= 0.30) {
    score += 0.5;
  } else if (acquisitionRatio >= 0.50) {
    score -= 2;
  }

  if (a.labourHoursPerJob <= 2) {
    score += 0.5;
  } else if (a.labourHoursPerJob >= 6) {
    score -= 1;
  }

  return {
    score: round(clamp(score)),
    economics,
  };
}

function evaluateBusinessEconomics(
  assumptions = {},
  metadata = {}
) {
  const result =
    calculateEconomicScore(assumptions);

  return {
    success: true,

    score: result.score,

    economics: result.economics,

    assumptions: {
      ...assumptions,
    },

    metadata: {
      source:
        metadata.source ||
        "Model assumption",

      confidence:
        metadata.confidence ||
        "Low",

      validated:
        metadata.validated === true,

      note:
        metadata.note ||
        "Economic inputs are provisional assumptions and are not verified market facts."
    }
  };
}

module.exports = {
  DEFAULT_ASSUMPTIONS,
  calculateUnitEconomics,
  calculateEconomicScore,
  evaluateBusinessEconomics,
};
