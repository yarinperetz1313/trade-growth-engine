function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

/*
  ECONOMIC ENGINE

  Purpose:
  Estimate whether an opportunity could make economic sense.

  IMPORTANT:
  Unless the inputs are supplied from real business/job data,
  these numbers are PROVISIONAL ASSUMPTIONS.

  This engine must never present assumptions as verified facts.
*/

function calculateEconomics(service = {}) {
  const {
    averageJobValue = null,
    materialCost = null,
    labourCost = null,
    acquisitionCost = null,
    repeatRevenue = null,
    jobsPerCustomer = null,

    /*
      Optional validation flags.

      These should eventually come from real collected data,
      not from the AI guessing.
    */
    inputsValidated = false
  } = service;

  const hasCoreInputs =
    Number.isFinite(averageJobValue) &&
    Number.isFinite(materialCost) &&
    Number.isFinite(labourCost) &&
    Number.isFinite(acquisitionCost);

  /*
    If we do not have enough real inputs, return a structured
    "provisional" result rather than pretending the economics
    are known.
  */

  if (!hasCoreInputs) {
    return {
      success: true,

      economicInputsValidated: false,

      status: "PROVISIONAL",

      inputs: {
        averageJobValue,
        materialCost,
        labourCost,
        acquisitionCost,
        repeatRevenue,
        jobsPerCustomer
      },

      contribution: null,
      customerValue: null,
      contributionMargin: null,
      acquisitionMultiple: null,

      economicScore: null,

      assumptionsRequired: [
        "Average job value",
        "Material cost",
        "Labour cost",
        "Customer acquisition cost"
      ],

      warning:
        "Insufficient validated economic inputs. No profitability conclusion should be drawn."
    };
  }

  const directCost =
    materialCost + labourCost;

  const contribution =
    averageJobValue -
    directCost -
    acquisitionCost;

  const contributionMargin =
    averageJobValue > 0
      ? contribution / averageJobValue
      : 0;

  /*
    Customer value.

    If repeat revenue is available, include it.
    Otherwise use the single-job contribution only.
  */

  let customerValue =
    contribution;

  if (
    Number.isFinite(repeatRevenue) &&
    Number.isFinite(jobsPerCustomer) &&
    jobsPerCustomer > 1
  ) {
    customerValue =
      contribution * jobsPerCustomer +
      repeatRevenue;
  }

  /*
    Acquisition multiple.

    This is useful because a business may have a profitable
    job but still have poor economics if acquiring customers
    is too expensive.
  */

  const acquisitionMultiple =
    acquisitionCost > 0
      ? contribution / acquisitionCost
      : null;

  /*
    Economic scoring model.

    This is a MODEL, not an industry benchmark.

    Margin:
      Higher contribution margin = better.

    Contribution:
      Higher absolute contribution = better.

    Acquisition:
      Higher contribution relative to acquisition cost = better.
  */

  let marginScore;

  if (contributionMargin >= 0.50) {
    marginScore = 10;
  } else if (contributionMargin >= 0.40) {
    marginScore = 9;
  } else if (contributionMargin >= 0.30) {
    marginScore = 8;
  } else if (contributionMargin >= 0.20) {
    marginScore = 6;
  } else if (contributionMargin >= 0.10) {
    marginScore = 4;
  } else if (contributionMargin >= 0) {
    marginScore = 2;
  } else {
    marginScore = 0;
  }

  let contributionScore;

  if (contribution >= 1000) {
    contributionScore = 10;
  } else if (contribution >= 750) {
    contributionScore = 9;
  } else if (contribution >= 500) {
    contributionScore = 8;
  } else if (contribution >= 300) {
    contributionScore = 7;
  } else if (contribution >= 200) {
    contributionScore = 6;
  } else if (contribution >= 100) {
    contributionScore = 4;
  } else if (contribution > 0) {
    contributionScore = 2;
  } else {
    contributionScore = 0;
  }

  let acquisitionScore;

  if (acquisitionMultiple === null) {
    acquisitionScore = 5;
  } else if (acquisitionMultiple >= 5) {
    acquisitionScore = 10;
  } else if (acquisitionMultiple >= 4) {
    acquisitionScore = 9;
  } else if (acquisitionMultiple >= 3) {
    acquisitionScore = 8;
  } else if (acquisitionMultiple >= 2) {
    acquisitionScore = 6;
  } else if (acquisitionMultiple >= 1) {
    acquisitionScore = 4;
  } else if (acquisitionMultiple > 0) {
    acquisitionScore = 2;
  } else {
    acquisitionScore = 0;
  }

  const economicScore = round(
    clamp(
      marginScore * 0.40 +
      contributionScore * 0.35 +
      acquisitionScore * 0.25
    )
  );

  return {
    success: true,

    economicInputsValidated:
      Boolean(inputsValidated),

    status:
      inputsValidated
        ? "VALIDATED"
        : "PROVISIONAL",

    inputs: {
      averageJobValue,
      materialCost,
      labourCost,
      acquisitionCost,
      repeatRevenue,
      jobsPerCustomer
    },

    contribution: round(contribution),

    customerValue: round(customerValue),

    contributionMargin:
      round(contributionMargin * 100, 1),

    acquisitionMultiple:
      acquisitionMultiple === null
        ? null
        : round(acquisitionMultiple),

    componentScores: {
      marginScore,
      contributionScore,
      acquisitionScore
    },

    economicScore,

    assumptionsRequired:
      inputsValidated
        ? []
        : [
            "Economic inputs have not yet been independently validated."
          ],

    warning:
      inputsValidated
        ? null
        : "Economic result is provisional and must not be treated as verified profitability."
  };
}

module.exports = {
  calculateEconomics
};
