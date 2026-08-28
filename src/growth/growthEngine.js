const {
  getProspects
} = require("../prospects/prospectIngestion");

const {
  qualifyProspect
} = require("../prospects/prospectQualification");

const {
  calculateEconomics
} = require("../economics/economicEngine");

const {
  buildDecision
} = require("../decision/decisionEngine");

const {
  buildDecisionPortfolio
} = require("../intelligence/decisionEngine");

const {
  buildOpportunityIntelligence
} = require("../intelligence/opportunityIntelligence");

const {
  buildValidationPlan
} = require("../intelligence/validationPlan");

const {
  buildForecastFromEconomics
} = require("../forecast/forecastEngine");

const {
  createExperiment,
  updateExperimentMetrics,
  evaluateExperiment
} = require("../experiments/experimentEngine");

const {
  createExperimentRecord,
  updateTargets,
  updateFinancials,
  updateResults,
  saveExperimentRecord
} = require("../tracking/experimentTracker");

const {
  createReport,
  saveReport
} = require("../reporting/opportunityReport");

const {
  buildDashboard
} = require("../dashboard/masterDashboard");

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function getIdentity(prospect) {
  return (
    prospect.dedupeKey ||
    prospect.website ||
    prospect.email ||
    prospect.phone ||
    prospect.businessName ||
    prospect.id
  );
}

function normaliseQualification(
  prospect
) {
  if (prospect.qualification) {
    return prospect.qualification;
  }

  try {
    return qualifyProspect(
      prospect
    );
  } catch {
    return {
      qualified: false,
      score: 0,
      reason:
        "Qualification unavailable"
    };
  }
}

function buildOpportunity(
  prospect
) {
  const qualification =
    normaliseQualification(
      prospect
    );

  let economics = null;

  try {
    economics =
      calculateEconomics(
        prospect
      );
  } catch {
    economics = null;
  }

  let decision = null;

  try {
    decision =
      buildDecision({
        prospect,
        qualification,
        economics
      });
  } catch {
    decision = null;
  }

  let intelligence = null;

  try {
    intelligence =
      buildOpportunityIntelligence({
        prospect,
        qualification,
        economics,
        decision
      });
  } catch {
    intelligence = null;
  }

  return {
    prospect,
    qualification,
    economics,
    decision,
    intelligence
  };
}

function buildPortfolio(
  opportunities
) {
  try {
    return buildDecisionPortfolio(
      opportunities
    );
  } catch {
    return [];
  }
}

function buildForecast(
  opportunities
) {
  const economics =
    opportunities
      .map(
        opportunity =>
          opportunity.economics
      )
      .filter(Boolean);

  if (
    economics.length === 0
  ) {
    return null;
  }

  try {
    return buildForecastFromEconomics(
      economics
    );
  } catch {
    return null;
  }
}

function buildValidation(
  opportunities
) {
  try {
    return opportunities.map(
      opportunity =>
        buildValidationPlan(
          opportunity
        )
    );
  } catch {
    return [];
  }
}

async function runGrowthEngine({
  experimentId,
  service,
  location
} = {}) {
  const startedAt =
    new Date().toISOString();

  /*
   * -----------------------------------------
   * 1. LOAD PROSPECTS
   * -----------------------------------------
   */

  let prospects =
    getProspects();

  prospects =
    safeArray(
      prospects
    );

  /*
   * Optional filtering.
   */

  if (service) {
    prospects =
      prospects.filter(
        prospect =>
          !prospect.service ||
          prospect.service
            .toLowerCase()
            .includes(
              service.toLowerCase()
            )
      );
  }

  if (location) {
    prospects =
      prospects.filter(
        prospect =>
          !prospect.location ||
          prospect.location
            .toLowerCase()
            .includes(
              location.toLowerCase()
            )
      );
  }

  /*
   * -----------------------------------------
   * 2. OPPORTUNITY INTELLIGENCE
   * -----------------------------------------
   */

  const opportunities =
    prospects.map(
      buildOpportunity
    );

  /*
   * -----------------------------------------
   * 3. DECISION PORTFOLIO
   * -----------------------------------------
   */

  const portfolio =
    buildPortfolio(
      opportunities
    );

  /*
   * -----------------------------------------
   * 4. FORECAST
   * -----------------------------------------
   */

  const forecast =
    buildForecast(
      opportunities
    );

  /*
   * -----------------------------------------
   * 5. VALIDATION PLANS
   * -----------------------------------------
   */

  const validationPlans =
    buildValidation(
      opportunities
    );

  /*
   * -----------------------------------------
   * 6. EXPERIMENT
   * -----------------------------------------
   */

  let experiment =
    null;

  if (experimentId) {
    try {
      experiment =
        createExperiment({
          experimentId,
          service,
          location
        });
    } catch {
      experiment = null;
    }
  }

  /*
   * -----------------------------------------
   * 7. TRACKING
   * -----------------------------------------
   */

  let experimentRecord =
    null;

  if (experimentId) {
    try {
      experimentRecord =
        createExperimentRecord({
          experimentId,
          service,
          location
        });

      updateTargets(
        experimentRecord,
        {
          prospects:
            prospects.length,
          qualified:
            opportunities.filter(
              opportunity =>
                opportunity
                  .qualification
                  ?.qualified
            ).length
        }
      );

      updateResults(
        experimentRecord,
        {
          opportunities:
            opportunities.length
        }
      );

      saveExperimentRecord(
        experimentRecord
      );
    } catch {
      experimentRecord = null;
    }
  }

  /*
   * -----------------------------------------
   * 8. REPORT
   * -----------------------------------------
   */

  const reportData = {
    experimentId:
      experimentId || null,

    service:
      service || null,

    location:
      location || null,

    generatedAt:
      new Date().toISOString(),

    summary: {
      prospects:
        prospects.length,

      qualified:
        opportunities.filter(
          opportunity =>
            opportunity
              .qualification
              ?.qualified
        ).length,

      opportunities:
        opportunities.length
    },

    opportunities,

    portfolio,

    forecast,

    validationPlans
  };

  let report =
    null;

  try {
    report =
      createReport(
        reportData
      );

    saveReport(
      report
    );
  } catch {
    report =
      reportData;
  }

  /*
   * -----------------------------------------
   * 9. DASHBOARD
   * -----------------------------------------
   */

  let dashboard =
    null;

  try {
    dashboard =
      buildDashboard();
  } catch {
    dashboard = null;
  }

  /*
   * -----------------------------------------
   * 10. FINAL RESULT
   * -----------------------------------------
   */

  return {
    success: true,

    startedAt,

    completedAt:
      new Date().toISOString(),

    experimentId:
      experimentId || null,

    filters: {
      service:
        service || null,

      location:
        location || null
    },

    counts: {
      prospects:
        prospects.length,

      qualified:
        opportunities.filter(
          opportunity =>
            opportunity
              .qualification
              ?.qualified
        ).length,

      opportunities:
        opportunities.length,

      validationPlans:
        validationPlans.length
    },

    opportunities,

    portfolio,

    forecast,

    validationPlans,

    experiment,

    experimentRecord,

    report,

    dashboard
  };
}

module.exports = {
  runGrowthEngine,
  buildOpportunity,
  buildPortfolio,
  buildForecast,
  buildValidation,
  getIdentity
};
