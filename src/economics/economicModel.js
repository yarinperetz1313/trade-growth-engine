/*
==========================================
TRADE GROWTH ENGINE
ECONOMIC VIABILITY ENGINE
==========================================

Purpose:
Estimate whether a service can produce attractive
unit economics under conservative, base and upside
scenarios.

IMPORTANT:
These are MODEL ASSUMPTIONS, not claimed market facts.

They should eventually be replaced/validated by
real Melbourne/Victoria research.
==========================================
*/

const DEFAULT_ASSUMPTIONS = {
  "Emergency electrical fault finding": {
    averageJobValue: 450,
    directCostRate: 0.25,
    leadToQuoteRate: 0.70,
    quoteToJobRate: 0.65,
    repeatCustomerRate: 0.25,
    jobsPerRepeatCustomer: 1.5,
    acquisitionCostPerLead: 45
  },

  "Switchboard upgrades": {
    averageJobValue: 1800,
    directCostRate: 0.50,
    leadToQuoteRate: 0.65,
    quoteToJobRate: 0.55,
    repeatCustomerRate: 0.20,
    jobsPerRepeatCustomer: 1.2,
    acquisitionCostPerLead: 55
  },

  "Commercial electrical maintenance": {
    averageJobValue: 650,
    directCostRate: 0.35,
    leadToQuoteRate: 0.60,
    quoteToJobRate: 0.55,
    repeatCustomerRate: 0.70,
    jobsPerRepeatCustomer: 6,
    acquisitionCostPerLead: 65
  },

  "EV charger installation": {
    averageJobValue: 1200,
    directCostRate: 0.45,
    leadToQuoteRate: 0.65,
    quoteToJobRate: 0.55,
    repeatCustomerRate: 0.15,
    jobsPerRepeatCustomer: 1.1,
    acquisitionCostPerLead: 60
  },

  "Residential lighting installation": {
    averageJobValue: 550,
    directCostRate: 0.35,
    leadToQuoteRate: 0.65,
    quoteToJobRate: 0.60,
    repeatCustomerRate: 0.20,
    jobsPerRepeatCustomer: 1.3,
    acquisitionCostPerLead: 40
  }
};


/*
==========================================
SCENARIO MULTIPLIERS

Conservative:
- Lower revenue
- Higher costs
- Lower conversion

Base:
- Uses assumptions

Upside:
- Higher revenue
- Lower costs
- Better conversion
==========================================
*/

const SCENARIOS = {
  conservative: {
    revenueMultiplier: 0.80,
    directCostMultiplier: 1.15,
    leadToQuoteMultiplier: 0.85,
    quoteToJobMultiplier: 0.85,
    acquisitionCostMultiplier: 1.25
  },

  base: {
    revenueMultiplier: 1,
    directCostMultiplier: 1,
    leadToQuoteMultiplier: 1,
    quoteToJobMultiplier: 1,
    acquisitionCostMultiplier: 1
  },

  upside: {
    revenueMultiplier: 1.20,
    directCostMultiplier: 0.90,
    leadToQuoteMultiplier: 1.10,
    quoteToJobMultiplier: 1.10,
    acquisitionCostMultiplier: 0.80
  }
};


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function round(value, decimals = 2) {
  const multiplier = Math.pow(10, decimals);

  return Math.round(value * multiplier) / multiplier;
}


/*
==========================================
CALCULATE ONE SCENARIO
==========================================
*/

function calculateScenario(assumptions, scenarioName) {
  const scenario = SCENARIOS[scenarioName];

  if (!scenario) {
    throw new Error(
      `Unknown economic scenario: ${scenarioName}`
    );
  }

  const averageJobValue =
    assumptions.averageJobValue *
    scenario.revenueMultiplier;

  const directCostRate =
    clamp(
      assumptions.directCostRate *
      scenario.directCostMultiplier,
      0,
      0.95
    );

  const leadToQuoteRate =
    clamp(
      assumptions.leadToQuoteRate *
      scenario.leadToQuoteMultiplier,
      0,
      1
    );

  const quoteToJobRate =
    clamp(
      assumptions.quoteToJobRate *
      scenario.quoteToJobMultiplier,
      0,
      1
    );

  const acquisitionCostPerLead =
    assumptions.acquisitionCostPerLead *
    scenario.acquisitionCostMultiplier;


  // ----------------------------------------
  // UNIT ECONOMICS
  // ----------------------------------------

  const directCost =
    averageJobValue * directCostRate;

  const grossProfit =
    averageJobValue - directCost;

  const grossMargin =
    averageJobValue > 0
      ? grossProfit / averageJobValue
      : 0;


  // ----------------------------------------
  // FUNNEL ECONOMICS
  // ----------------------------------------

  const leadToJobRate =
    leadToQuoteRate * quoteToJobRate;

  const leadsRequiredForOneJob =
    leadToJobRate > 0
      ? 1 / leadToJobRate
      : Infinity;

  const acquisitionCostPerJob =
    acquisitionCostPerLead *
    leadsRequiredForOneJob;

  const contributionAfterAcquisition =
    grossProfit -
    acquisitionCostPerJob;


  // ----------------------------------------
  // CUSTOMER VALUE
  // ----------------------------------------

  const repeatRate =
    clamp(
      assumptions.repeatCustomerRate,
      0,
      1
    );

  const repeatJobs =
    Math.max(
      0,
      assumptions.jobsPerRepeatCustomer
    );

  const expectedRepeatJobs =
    repeatRate * repeatJobs;

  const estimatedLifetimeJobs =
    1 + expectedRepeatJobs;

  const estimatedLifetimeRevenue =
    averageJobValue *
    estimatedLifetimeJobs;

  const estimatedLifetimeGrossProfit =
    grossProfit *
    estimatedLifetimeJobs;

  const estimatedLifetimeContribution =
    estimatedLifetimeGrossProfit -
    acquisitionCostPerJob;


  // ----------------------------------------
  // BREAK-EVEN
  // ----------------------------------------

  const breakEvenJobs =
    grossProfit > 0
      ? acquisitionCostPerJob / grossProfit
      : Infinity;


  // ----------------------------------------
  // ECONOMIC SCORE
  // ----------------------------------------

  let score = 5;


  // Gross margin
  if (grossMargin >= 0.60) score += 2;
  else if (grossMargin >= 0.45) score += 1;
  else if (grossMargin < 0.30) score -= 2;


  // Acquisition economics
  if (contributionAfterAcquisition > 0) {
    score += 1;
  } else {
    score -= 2;
  }


  // Repeat economics
  if (repeatRate >= 0.60) {
    score += 1;
  } else if (repeatRate < 0.20) {
    score -= 1;
  }


  // Lifetime economics
  if (estimatedLifetimeContribution >= 3000) {
    score += 1;
  } else if (estimatedLifetimeContribution < 500) {
    score -= 1;
  }


  score = clamp(
    Math.round(score * 10) / 10,
    1,
    10
  );


  return {
    scenario: scenarioName,

    revenue: {
      averageJobValue: round(averageJobValue),
      estimatedLifetimeRevenue:
        round(estimatedLifetimeRevenue)
    },

    costs: {
      directCostRate:
        round(directCostRate * 100, 1),

      directCostPerJob:
        round(directCost),

      acquisitionCostPerLead:
        round(acquisitionCostPerLead),

      acquisitionCostPerJob:
        round(acquisitionCostPerJob)
    },

    profit: {
      grossProfitPerJob:
        round(grossProfit),

      grossMargin:
        round(grossMargin * 100, 1),

      contributionAfterAcquisition:
        round(contributionAfterAcquisition),

      estimatedLifetimeGrossProfit:
        round(estimatedLifetimeGrossProfit),

      estimatedLifetimeContribution:
        round(estimatedLifetimeContribution)
    },

    funnel: {
      leadToQuoteRate:
        round(leadToQuoteRate * 100, 1),

      quoteToJobRate:
        round(quoteToJobRate * 100, 1),

      leadToJobRate:
        round(leadToJobRate * 100, 1),

      leadsRequiredForOneJob:
        Number.isFinite(leadsRequiredForOneJob)
          ? round(leadsRequiredForOneJob, 2)
          : null
    },

    customer: {
      repeatCustomerRate:
        round(repeatRate * 100, 1),

      expectedRepeatJobs:
        round(expectedRepeatJobs, 2),

      estimatedLifetimeJobs:
        round(estimatedLifetimeJobs, 2)
    },

    breakEven: {
      acquisitionCostRecoveredAfterJobs:
        Number.isFinite(breakEvenJobs)
          ? round(breakEvenJobs, 2)
          : null
    },

    economicScore: score
  };
}


/*
==========================================
RISK ANALYSIS
==========================================
*/

function calculateRiskFlags(baseScenario) {
  const risks = [];

  if (baseScenario.profit.grossMargin < 30) {
    risks.push("Low gross-margin assumption");
  }

  if (
    baseScenario.profit.contributionAfterAcquisition <= 0
  ) {
    risks.push(
      "Customer acquisition economics are currently negative"
    );
  }

  if (baseScenario.funnel.leadToJobRate < 20) {
    risks.push(
      "Low assumed lead-to-job conversion"
    );
  }

  if (
    baseScenario.customer.repeatCustomerRate < 20
  ) {
    risks.push(
      "Limited repeat-purchase assumption"
    );
  }

  if (
    baseScenario.breakEven
      .acquisitionCostRecoveredAfterJobs !== null &&
    baseScenario.breakEven
      .acquisitionCostRecoveredAfterJobs > 1
  ) {
    risks.push(
      "Acquisition cost requires more than one job to recover"
    );
  }

  return risks;
}


/*
==========================================
MAIN ECONOMIC ANALYSIS
==========================================
*/

function analyzeEconomics(
  serviceName,
  customAssumptions = {}
) {
  const baseAssumptions =
    DEFAULT_ASSUMPTIONS[serviceName];

  if (!baseAssumptions) {
    return {
      success: false,
      error:
        `No economic assumptions configured for "${serviceName}".`
    };
  }

  const assumptions = {
    ...baseAssumptions,
    ...customAssumptions
  };

  const conservative =
    calculateScenario(
      assumptions,
      "conservative"
    );

  const base =
    calculateScenario(
      assumptions,
      "base"
    );

  const upside =
    calculateScenario(
      assumptions,
      "upside"
    );

  const risks =
    calculateRiskFlags(base);


  /*
    Weighted economic score.

    Conservative receives the highest weight because
    we want the engine to avoid being overly optimistic.
  */

  const economicScore =
    conservative.economicScore * 0.40 +
    base.economicScore * 0.40 +
    upside.economicScore * 0.20;

  const roundedEconomicScore =
    round(economicScore, 1);


  let classification;

  if (
    roundedEconomicScore >= 8 &&
    risks.length <= 1
  ) {
    classification = "STRONG ECONOMICS";
  } else if (
    roundedEconomicScore >= 7
  ) {
    classification = "PROMISING ECONOMICS";
  } else if (
    roundedEconomicScore >= 5.5
  ) {
    classification = "MIXED ECONOMICS";
  } else {
    classification = "WEAK ECONOMICS";
  }


  return {
    success: true,

    service: serviceName,

    assumptions: {
      ...assumptions,
      source:
        "Internal modeling assumptions; not yet market-validated"
    },

    scenarios: {
      conservative,
      base,
      upside
    },

    economicScore:
      roundedEconomicScore,

    classification,

    riskFlags:
      risks
  };
}


module.exports = {
  analyzeEconomics,
  DEFAULT_ASSUMPTIONS,
  SCENARIOS
};
