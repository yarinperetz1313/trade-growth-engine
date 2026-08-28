const {
  calculateEconomics
} = require("../analytics/economicsEngine");

function round(value, decimals = 2) {
  const factor = Math.pow(10, decimals);

  return (
    Math.round(
      (Number(value) || 0) * factor
    ) / factor
  );
}

function clamp(
  value,
  min = 0,
  max = 1
) {
  return Math.max(
    min,
    Math.min(
      max,
      Number(value) || 0
    )
  );
}

function positiveNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) &&
    number > 0
    ? number
    : 0;
}

function validateInputs(inputs = {}) {
  const errors = [];

  const leadsPerPeriod =
    positiveNumber(
      inputs.leadsPerPeriod
    );

  const averageRevenue =
    positiveNumber(
      inputs.averageRevenue
    );

  const acquisitionCostPerLead =
    positiveNumber(
      inputs.acquisitionCostPerLead
    );

  if (leadsPerPeriod <= 0) {
    errors.push(
      "leadsPerPeriod must be greater than 0."
    );
  }

  if (averageRevenue <= 0) {
    errors.push(
      "averageRevenue must be greater than 0."
    );
  }

  if (
    acquisitionCostPerLead < 0
  ) {
    errors.push(
      "acquisitionCostPerLead cannot be negative."
    );
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function buildScenario(
  name,
  assumptions
) {
  const leads =
    positiveNumber(
      assumptions.leadsPerPeriod
    );

  const contactRate =
    clamp(
      assumptions.contactRate
    );

  const replyRate =
    clamp(
      assumptions.replyRate
    );

  const quoteRate =
    clamp(
      assumptions.quoteRate
    );

  const winRate =
    clamp(
      assumptions.winRate
    );

  const averageRevenue =
    positiveNumber(
      assumptions.averageRevenue
    );

  const acquisitionCostPerLead =
    positiveNumber(
      assumptions.acquisitionCostPerLead
    );

  const contacted =
    leads *
    contactRate;

  const replies =
    contacted *
    replyRate;

  const quotes =
    replies *
    quoteRate;

  const wins =
    quotes *
    winRate;

  const revenue =
    wins *
    averageRevenue;

  const acquisitionCost =
    leads *
    acquisitionCostPerLead;

  const contribution =
    revenue -
    acquisitionCost;

  const contributionPerLead =
    leads > 0
      ? contribution / leads
      : 0;

  const expectedCAC =
    wins > 0
      ? acquisitionCost / wins
      : 0;

  const breakEvenWins =
    averageRevenue > 0
      ? acquisitionCost /
        averageRevenue
      : 0;

  const breakEvenLeads =
    leads > 0 && wins > 0
      ? (
          breakEvenWins /
          (wins / leads)
        )
      : 0;

  const roi =
    acquisitionCost > 0
      ? contribution /
        acquisitionCost
      : 0;

  return {
    name,

    assumptions: {
      leadsPerPeriod:
        round(leads),

      contactRate:
        round(
          contactRate * 100
        ),

      replyRate:
        round(
          replyRate * 100
        ),

      quoteRate:
        round(
          quoteRate * 100
        ),

      winRate:
        round(
          winRate * 100
        ),

      averageRevenue:
        round(
          averageRevenue
        ),

      acquisitionCostPerLead:
        round(
          acquisitionCostPerLead
        )
    },

    forecast: {
      leads:
        round(leads),

      contacted:
        round(contacted),

      replies:
        round(replies),

      quotes:
        round(quotes),

      wins:
        round(wins),

      revenue:
        round(revenue),

      acquisitionCost:
        round(
          acquisitionCost
        ),

      contribution:
        round(
          contribution
        ),

      contributionPerLead:
        round(
          contributionPerLead
        ),

      expectedCAC:
        round(
          expectedCAC
        ),

      roi:
        round(
          roi * 100
        ),

      breakEvenWins:
        round(
          breakEvenWins
        ),

      breakEvenLeads:
        round(
          breakEvenLeads
        )
    }
  };
}

function buildScenarios(
  inputs = {}
) {
  const validation =
    validateInputs(
      inputs
    );

  if (!validation.valid) {
    return {
      status:
        "INSUFFICIENT_DATA",

      validation,

      scenarios: []
    };
  }

  const base = {
    leadsPerPeriod:
      inputs.leadsPerPeriod,

    contactRate:
      inputs.contactRate,

    replyRate:
      inputs.replyRate,

    quoteRate:
      inputs.quoteRate,

    winRate:
      inputs.winRate,

    averageRevenue:
      inputs.averageRevenue,

    acquisitionCostPerLead:
      inputs.acquisitionCostPerLead
  };

  const conservative =
    buildScenario(
      "CONSERVATIVE",
      {
        ...base,

        leadsPerPeriod:
          base.leadsPerPeriod *
          0.75,

        contactRate:
          base.contactRate *
          0.80,

        replyRate:
          base.replyRate *
          0.80,

        quoteRate:
          base.quoteRate *
          0.80,

        winRate:
          base.winRate *
          0.75,

        averageRevenue:
          base.averageRevenue *
          0.90,

        acquisitionCostPerLead:
          base.acquisitionCostPerLead *
          1.15
      }
    );

  const baseScenario =
    buildScenario(
      "BASE",
      base
    );

  const upside =
    buildScenario(
      "UPSIDE",
      {
        ...base,

        leadsPerPeriod:
          base.leadsPerPeriod *
          1.25,

        contactRate:
          Math.min(
            base.contactRate *
              1.10,
            1
          ),

        replyRate:
          Math.min(
            base.replyRate *
              1.10,
            1
          ),

        quoteRate:
          Math.min(
            base.quoteRate *
              1.10,
            1
          ),

        winRate:
          Math.min(
            base.winRate *
              1.15,
            1
          ),

        averageRevenue:
          base.averageRevenue *
          1.10,

        acquisitionCostPerLead:
          base.acquisitionCostPerLead *
          0.90
      }
    );

  return {
    status:
      "READY",

    validation,

    methodology: {
      description:
        "Scenario multipliers are planning assumptions, not market facts.",

      conservative:
        "Lower volume and conversion with higher acquisition cost.",

      base:
        "Uses supplied assumptions without scenario adjustments.",

      upside:
        "Higher volume and conversion with lower acquisition cost."
    },

    scenarios: [
      conservative,
      baseScenario,
      upside
    ]
  };
}

function buildForecastFromEconomics(
  leads,
  assumptions = {}
) {
  const economics =
    calculateEconomics(
      Array.isArray(leads)
        ? leads
        : []
    );

  const summary =
    economics.summary || {};

  const totalLeads =
    Number(
      summary.totalLeads
    ) || 0;

  const won =
    Number(
      summary.won
    ) || 0;

  const revenue =
    Number(
      summary.revenue
    ) || 0;

  const acquisitionCost =
    Number(
      summary.acquisitionCost
    ) || 0;

  if (
    totalLeads === 0
  ) {
    return {
      status:
        "INSUFFICIENT_DATA",

      reason:
        "No real CRM leads are available.",

      actuals: {
        totalLeads: 0,
        won: 0,
        revenue: 0,
        acquisitionCost: 0
      },

      scenarios:
        buildScenarios(
          assumptions
        )
    };
  }

  const empiricalAssumptions = {
    leadsPerPeriod:
      assumptions.leadsPerPeriod ||
      totalLeads,

    contactRate:
      assumptions.contactRate ??
      clamp(
        Number(
          summary.contactRate
        ) / 100
      ),

    replyRate:
      assumptions.replyRate ??
      clamp(
        Number(
          summary.replyRate
        ) / 100
      ),

    quoteRate:
      assumptions.quoteRate ??
      clamp(
        Number(
          summary.quoteRate
        ) / 100
      ),

    winRate:
      assumptions.winRate ??
      clamp(
        Number(
          summary.winRateFromQuotes
        ) / 100
      ),

    averageRevenue:
      assumptions.averageRevenue ||
      (
        won > 0
          ? revenue / won
          : 0
      ),

    acquisitionCostPerLead:
      assumptions.acquisitionCostPerLead ||
      (
        totalLeads > 0
          ? acquisitionCost /
            totalLeads
          : 0
      )
  };

  return {
    status:
      "READY",

    actuals: {
      totalLeads,

      won,

      revenue:
        round(revenue),

      acquisitionCost:
        round(
          acquisitionCost
        ),

      contribution:
        round(
          revenue -
            acquisitionCost
        )
    },

    scenarios:
      buildScenarios(
        empiricalAssumptions
      )
  };
}

module.exports = {
  round,

  clamp,

  validateInputs,

  buildScenario,

  buildScenarios,

  buildForecastFromEconomics
};

