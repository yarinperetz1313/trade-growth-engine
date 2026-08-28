const fs = require("fs");
const path = require("path");

const {
  listLeads
} = require("../leads/leadEngine");

const ANALYTICS_DIR =
  path.join(
    process.cwd(),
    "data",
    "analytics"
  );

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

function safeDivide(
  numerator,
  denominator
) {
  const n =
    Number(numerator) || 0;

  const d =
    Number(denominator) || 0;

  if (d === 0) {
    return 0;
  }

  return n / d;
}

function percentage(
  numerator,
  denominator
) {
  return round(
    safeDivide(
      numerator,
      denominator
    ) * 100
  );
}

function numberOrZero(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function getLeadRevenue(lead) {
  return numberOrZero(
    lead?.economics?.revenue
  );
}

function getLeadAcquisitionCost(
  lead
) {
  return numberOrZero(
    lead?.economics
      ?.acquisitionCost
  );
}

function getLeadStatus(lead) {
  return String(
    lead?.status || ""
  ).toUpperCase();
}

function calculateBasicEconomics(
  leads
) {
  const safeLeads =
    Array.isArray(leads)
      ? leads
      : [];

  const totalLeads =
    safeLeads.length;

  const contacted =
    safeLeads.filter(
      lead =>
        Boolean(
          lead?.outreach
            ?.lastAttemptAt
        )
    ).length;

  const replied =
    safeLeads.filter(
      lead =>
        Boolean(
          lead?.outreach
            ?.repliedAt
        )
    ).length;

  const interested =
    safeLeads.filter(
      lead =>
        String(
          lead?.status || ""
        ).toUpperCase() ===
        "INTERESTED"
    ).length;

  const quotes =
    safeLeads.filter(
      lead =>
        Boolean(
          lead?.sales
            ?.quotedAt
        ) ||
        numberOrZero(
          lead?.sales
            ?.quoteValue
        ) > 0
    ).length;

  const won =
    safeLeads.filter(
      lead =>
        getLeadStatus(
          lead
        ) === "WON"
    ).length;

  const lost =
    safeLeads.filter(
      lead =>
        getLeadStatus(
          lead
        ) === "LOST"
    ).length;

  const revenue =
    safeLeads.reduce(
      (total, lead) =>
        total +
        getLeadRevenue(
          lead
        ),
      0
    );

  const acquisitionCost =
    safeLeads.reduce(
      (total, lead) =>
        total +
        getLeadAcquisitionCost(
          lead
        ),
      0
    );

  const contribution =
    revenue -
    acquisitionCost;

  const conversionRate =
    percentage(
      won,
      totalLeads
    );

  const contactRate =
    percentage(
      contacted,
      totalLeads
    );

  const replyRate =
    percentage(
      replied,
      contacted
    );

  const quoteRate =
    percentage(
      quotes,
      contacted
    );

  const winRateFromQuotes =
    percentage(
      won,
      quotes
    );

  const customerAcquisitionCost =
    safeDivide(
      acquisitionCost,
      won
    );

  const averageRevenuePerWonCustomer =
    safeDivide(
      revenue,
      won
    );

  const returnOnAcquisition =
    acquisitionCost > 0
      ? round(
          (
            contribution /
            acquisitionCost
          ) * 100
        )
      : 0;

  return {
    totalLeads,

    contacted,

    replied,

    interested,

    quotes,

    won,

    lost,

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

    conversionRate,

    contactRate,

    replyRate,

    quoteRate,

    winRateFromQuotes,

    customerAcquisitionCost:
      round(
        customerAcquisitionCost
      ),

    averageRevenuePerWonCustomer:
      round(
        averageRevenuePerWonCustomer
      ),

    returnOnAcquisition
  };
}

function calculatePipelineEconomics(
  leads
) {
  const safeLeads =
    Array.isArray(leads)
      ? leads
      : [];

  const pipelineValue =
    safeLeads.reduce(
      (total, lead) => {
        const status =
          getLeadStatus(
            lead
          );

        if (
          status === "WON" ||
          status === "LOST"
        ) {
          return total;
        }

        return (
          total +
          numberOrZero(
            lead?.sales
              ?.quoteValue
          )
        );
      },
      0
    );

  const quotedValue =
    safeLeads.reduce(
      (total, lead) =>
        total +
        numberOrZero(
          lead?.sales
            ?.quoteValue
        ),
      0
    );

  const wonRevenue =
    safeLeads.reduce(
      (total, lead) =>
        getLeadStatus(
          lead
        ) === "WON"
          ? total +
            getLeadRevenue(
              lead
            )
          : total,
      0
    );

  return {
    quotedValue:
      round(
        quotedValue
      ),

    openPipelineValue:
      round(
        pipelineValue
      ),

    wonRevenue:
      round(
        wonRevenue
      )
  };
}

function calculateServiceBreakdown(
  leads
) {
  const breakdown = {};

  const safeLeads =
    Array.isArray(leads)
      ? leads
      : [];

  for (
    const lead of safeLeads
  ) {
    const service =
      lead?.service ||
      "Unknown";

    if (
      !breakdown[service]
    ) {
      breakdown[service] = {
        service,

        leads: 0,

        won: 0,

        lost: 0,

        revenue: 0,

        acquisitionCost: 0,

        contribution: 0,

        conversionRate: 0
      };
    }

    const entry =
      breakdown[service];

    entry.leads += 1;

    const status =
      getLeadStatus(
        lead
      );

    if (
      status === "WON"
    ) {
      entry.won += 1;
    }

    if (
      status === "LOST"
    ) {
      entry.lost += 1;
    }

    entry.revenue +=
      getLeadRevenue(
        lead
      );

    entry.acquisitionCost +=
      getLeadAcquisitionCost(
        lead
      );
  }

  return Object.values(
    breakdown
  ).map(
    entry => ({
      ...entry,

      revenue:
        round(
          entry.revenue
        ),

      acquisitionCost:
        round(
          entry.acquisitionCost
        ),

      contribution:
        round(
          entry.revenue -
            entry.acquisitionCost
        ),

      conversionRate:
        percentage(
          entry.won,
          entry.leads
        )
    })
  );
}

function calculateStatusBreakdown(
  leads
) {
  const breakdown = {};

  const safeLeads =
    Array.isArray(leads)
      ? leads
      : [];

  for (
    const lead of safeLeads
  ) {
    const status =
      getLeadStatus(
        lead
      ) || "UNKNOWN";

    if (
      !breakdown[status]
    ) {
      breakdown[status] = {
        status,

        count: 0,

        revenue: 0,

        acquisitionCost: 0
      };
    }

    breakdown[status]
      .count += 1;

    breakdown[status]
      .revenue +=
        getLeadRevenue(
          lead
        );

    breakdown[status]
      .acquisitionCost +=
        getLeadAcquisitionCost(
          lead
        );
  }

  return Object.values(
    breakdown
  ).map(
    entry => ({
      ...entry,

      revenue:
        round(
          entry.revenue
        ),

      acquisitionCost:
        round(
          entry.acquisitionCost
        ),

      contribution:
        round(
          entry.revenue -
            entry.acquisitionCost
        )
    })
  );
}

function calculateEconomics(
  leads
) {
  const safeLeads =
    Array.isArray(leads)
      ? leads
      : [];

  const basic =
    calculateBasicEconomics(
      safeLeads
    );

  const pipeline =
    calculatePipelineEconomics(
      safeLeads
    );

  return {
    generatedAt:
      new Date().toISOString(),

    summary: {
      ...basic
    },

    pipeline,

    byService:
      calculateServiceBreakdown(
        safeLeads
      ),

    byStatus:
      calculateStatusBreakdown(
        safeLeads
      )
  };
}

function saveAnalytics(
  analytics
) {
  fs.mkdirSync(
    ANALYTICS_DIR,
    {
      recursive: true
    }
  );

  const timestamp =
    Date.now();

  const filePath =
    path.join(
      ANALYTICS_DIR,
      `economics-${timestamp}.json`
    );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      analytics,
      null,
      2
    )
  );

  return filePath;
}

function generateEconomicsReport() {
  const leads =
    listLeads();

  const analytics =
    calculateEconomics(
      leads
    );

  const filePath =
    saveAnalytics(
      analytics
    );

  return {
    ...analytics,

    filePath
  };
}

module.exports = {
  round,

  safeDivide,

  percentage,

  calculateBasicEconomics,

  calculatePipelineEconomics,

  calculateServiceBreakdown,

  calculateStatusBreakdown,

  calculateEconomics,

  saveAnalytics,

  generateEconomicsReport
};
