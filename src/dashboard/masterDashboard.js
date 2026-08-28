const fs = require("fs");
const path = require("path");

const {
  listLeads
} = require("../leads/leadEngine");

const {
  calculateEconomics
} = require("../analytics/economicsEngine");

const {
  buildDecisionPortfolio
} = require("../intelligence/decisionEngine");

const {
  buildForecastFromEconomics
} = require("../forecast/forecastEngine");

const DASHBOARD_DIR =
  path.join(
    process.cwd(),
    "data",
    "dashboard"
  );

function round(
  value,
  decimals = 2
) {
  const factor =
    Math.pow(10, decimals);

  return (
    Math.round(
      (Number(value) || 0) *
        factor
    ) / factor
  );
}

function buildPipelineMetrics(
  leads
) {
  const safeLeads =
    Array.isArray(leads)
      ? leads
      : [];

  const statuses = {};

  for (
    const lead of safeLeads
  ) {
    const status =
      String(
        lead?.status || "UNKNOWN"
      ).toUpperCase();

    statuses[status] =
      (statuses[status] || 0) + 1;
  }

  return {
    total:
      safeLeads.length,

    statuses,

    open:
      safeLeads.filter(
        lead => {
          const status =
            String(
              lead?.status || ""
            ).toUpperCase();

          return (
            status !== "WON" &&
            status !== "LOST"
          );
        }
      ).length,

    won:
      statuses.WON || 0,

    lost:
      statuses.LOST || 0
  };
}

function buildStatusBreakdown(
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
      String(
        lead?.status || "UNKNOWN"
      ).toUpperCase();

    if (
      !breakdown[status]
    ) {
      breakdown[status] = {
        status,
        count: 0,
        revenue: 0,
        acquisitionCost: 0,
        contribution: 0
      };
    }

    const entry =
      breakdown[status];

    entry.count += 1;

    entry.revenue +=
      Number(
        lead?.economics
          ?.revenue
      ) || 0;

    entry.acquisitionCost +=
      Number(
        lead?.economics
          ?.acquisitionCost
      ) || 0;
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

function buildServiceBreakdown(
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
        contribution: 0
      };
    }

    const entry =
      breakdown[service];

    entry.leads += 1;

    const status =
      String(
        lead?.status || ""
      ).toUpperCase();

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
      Number(
        lead?.economics
          ?.revenue
      ) || 0;

    entry.acquisitionCost +=
      Number(
        lead?.economics
          ?.acquisitionCost
      ) || 0;
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
        entry.leads > 0
          ? round(
              (
                entry.won /
                entry.leads
              ) * 100
            )
          : 0
    })
  );
}

function buildFunnel(
  leads
) {
  const safeLeads =
    Array.isArray(leads)
      ? leads
      : [];

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

  const quoted =
    safeLeads.filter(
      lead =>
        Number(
          lead?.sales
            ?.quoteValue
        ) > 0
    ).length;

  const won =
    safeLeads.filter(
      lead =>
        String(
          lead?.status || ""
        ).toUpperCase() ===
        "WON"
    ).length;

  return {
    leads:
      safeLeads.length,

    contacted,

    replied,

    quoted,

    won,

    rates: {
      contactRate:
        safeLeads.length > 0
          ? round(
              (
                contacted /
                safeLeads.length
              ) * 100
            )
          : 0,

      replyRate:
        contacted > 0
          ? round(
              (
                replied /
                contacted
              ) * 100
            )
          : 0,

      quoteRate:
        contacted > 0
          ? round(
              (
                quoted /
                contacted
              ) * 100
            )
          : 0,

      winRate:
        safeLeads.length > 0
          ? round(
              (
                won /
                safeLeads.length
              ) * 100
            )
          : 0
    }
  };
}

function buildTopLeads(
  leads
) {
  return (
    Array.isArray(leads)
      ? leads
      : []
  )
    .filter(
      lead =>
        typeof
          lead?.qualificationScore ===
        "number"
    )
    .sort(
      (a, b) =>
        b.qualificationScore -
        a.qualificationScore
    )
    .slice(0, 10)
    .map(
      lead => ({
        id:
          lead.id,

        businessName:
          lead.businessName,

        service:
          lead.service,

        status:
          lead.status,

        qualificationScore:
          lead.qualificationScore,

        qualification:
          lead.qualification,

        website:
          lead.website,

        phone:
          lead.phone,

        email:
          lead.email
      })
    );
}

function buildDecisionInputs(
  leads
) {
  const services = {};

  for (
    const lead of
      Array.isArray(leads)
        ? leads
        : []
  ) {
    const service =
      lead?.service ||
      "Unknown";

    if (
      !services[service]
    ) {
      services[service] = {
        service,

        name:
          service,

        responseTimeGap: 0,

        pricingGap: 0,

        differentiation: 0,

        repeatPotential: 0,

        evidenceConfidence: 0,

        evidenceCoverage: 0
      };
    }

    const entry =
      services[service];

    if (
      typeof
        lead?.intelligence
          ?.responseTimeGap ===
      "number"
    ) {
      entry.responseTimeGap =
        Math.max(
          entry.responseTimeGap,
          lead.intelligence
            .responseTimeGap
        );
    }

    if (
      typeof
        lead?.intelligence
          ?.pricingGap ===
      "number"
    ) {
      entry.pricingGap =
        Math.max(
          entry.pricingGap,
          lead.intelligence
            .pricingGap
        );
    }

    if (
      typeof
        lead?.intelligence
          ?.differentiation ===
      "number"
    ) {
      entry.differentiation =
        Math.max(
          entry.differentiation,
          lead.intelligence
            .differentiation
        );
    }

    if (
      typeof
        lead?.intelligence
          ?.repeatPotential ===
      "number"
    ) {
      entry.repeatPotential =
        Math.max(
          entry.repeatPotential,
          lead.intelligence
            .repeatPotential
        );
    }

    if (
      typeof
        lead?.intelligence
          ?.evidenceConfidence ===
      "number"
    ) {
      entry.evidenceConfidence =
        Math.max(
          entry.evidenceConfidence,
          lead.intelligence
            .evidenceConfidence
        );
    }

    if (
      typeof
        lead?.intelligence
          ?.evidenceCoverage ===
      "number"
    ) {
      entry.evidenceCoverage =
        Math.max(
          entry.evidenceCoverage,
          lead.intelligence
            .evidenceCoverage
        );
    }
  }

  return Object.values(
    services
  );
}

function buildForecast(
  leads,
  economics
) {
  /*
    No invented business assumptions.

    When real CRM data exists,
    the forecast engine derives
    defaults from actual performance.

    When there are no real leads,
    the result remains explicitly
    INSUFFICIENT_DATA.
  */

  return buildForecastFromEconomics(
    leads,
    {}
  );
}

function buildDashboard() {
  const leads =
    listLeads();

  const economics =
    calculateEconomics(
      leads
    );

  const serviceBreakdown =
    buildServiceBreakdown(
      leads
    );

  const decisionInputs =
    buildDecisionInputs(
      leads
    );

  const decisions =
    buildDecisionPortfolio({
      opportunities:
        decisionInputs,

      leads,

      economics
    });

  const forecast =
    buildForecast(
      leads,
      economics
    );

  return {
    generatedAt:
      new Date().toISOString(),

    overview:
      economics.summary,

    funnel:
      buildFunnel(
        leads
      ),

    pipeline:
      buildPipelineMetrics(
        leads
      ),

    economics,

    forecast,

    statusBreakdown:
      buildStatusBreakdown(
        leads
      ),

    serviceBreakdown,

    decisionEngine: {
      prioritised:
        decisions.prioritised,

      investigate:
        decisions.investigate,

      lowPriority:
        decisions.lowPriority,

      total:
        decisions.total
    },

    topLeads:
      buildTopLeads(
        leads
      ),

    dataQuality: {
      totalLeads:
        leads.length,

      hasRealLeads:
        leads.length > 0,

      actualData:
        leads.length > 0
          ? "AVAILABLE"
          : "NONE",

      forecastStatus:
        forecast.status,

      warning:
        leads.length === 0
          ? "No real CRM leads are currently available. Forecasts requiring empirical CRM data are unavailable."
          : null
    }
  };
}

function saveDashboard(
  dashboard
) {
  fs.mkdirSync(
    DASHBOARD_DIR,
    {
      recursive: true
    }
  );

  const filePath =
    path.join(
      DASHBOARD_DIR,
      "master-dashboard.json"
    );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      dashboard,
      null,
      2
    )
  );

  return filePath;
}

function generateDashboard() {
  const dashboard =
    buildDashboard();

  const filePath =
    saveDashboard(
      dashboard
    );

  return {
    dashboard,
    filePath
  };
}

if (
  require.main === module
) {
  console.log(
    JSON.stringify(
      generateDashboard(),
      null,
      2
    )
  );
}

module.exports = {
  buildPipelineMetrics,
  buildStatusBreakdown,
  buildServiceBreakdown,
  buildFunnel,
  buildTopLeads,
  buildDecisionInputs,
  buildForecast,
  buildDashboard,
  saveDashboard,
  generateDashboard
};
