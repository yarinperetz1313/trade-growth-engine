const fs = require("fs");
const path = require("path");

const EXPERIMENT_DIR = path.join(
  process.cwd(),
  "data",
  "experiments"
);

function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

/*
  Creates a structured experiment from a validated
  opportunity.

  IMPORTANT:
  This does not claim the opportunity is profitable.

  It converts the current evidence into a testable
  hypothesis that can later be validated with real
  customer behaviour.
*/

function createExperiment(opportunity) {
  if (!opportunity || !opportunity.name) {
    throw new Error(
      "A valid opportunity is required."
    );
  }

  const finalScore =
    typeof opportunity.finalScore === "number"
      ? opportunity.finalScore
      : null;

  const economicScore =
    typeof opportunity.economicViability === "number"
      ? opportunity.economicViability
      : null;

  const evidenceScore =
    typeof opportunity.confidenceScore === "number"
      ? opportunity.confidenceScore
      : null;

  const marketScore =
    typeof opportunity.marketScore === "number"
      ? opportunity.marketScore
      : null;

  /*
    TEST READINESS

    This is deliberately conservative.

    A high opportunity score alone is not enough.
  */

  let readinessScore = 0;

  if (finalScore !== null) {
    readinessScore += finalScore * 0.35;
  }

  if (marketScore !== null) {
    readinessScore += marketScore * 0.20;
  }

  if (economicScore !== null) {
    readinessScore += economicScore * 0.25;
  }

  if (evidenceScore !== null) {
    readinessScore += evidenceScore * 0.20;
  }

  readinessScore = round(
    clamp(readinessScore)
  );

  let readiness;

  if (readinessScore >= 8) {
    readiness = "READY FOR CONTROLLED TEST";
  } else if (readinessScore >= 6.5) {
    readiness = "WORTH TESTING";
  } else if (readinessScore >= 5) {
    readiness = "NEEDS MORE VALIDATION";
  } else {
    readiness = "DO NOT TEST YET";
  }

  /*
    HYPOTHESIS

    We deliberately keep this generic until the
    customer/offer research modules are built.
  */

  const hypothesis =
    `Customers who need ${opportunity.name.toLowerCase()} ` +
    `will respond positively to a clearly positioned ` +
    `offer if the perceived value exceeds the total ` +
    `cost and inconvenience of choosing an alternative.`;

  /*
    KEY ASSUMPTIONS

    These become things we eventually need to prove.
  */

  const assumptions = [
    "There is sufficient real customer demand.",
    "The target customer can be reached economically.",
    "Customers will trust a new provider.",
    "The service can be delivered at the assumed economics.",
    "The proposed differentiation matters to customers.",
    "The acquisition channel can generate qualified enquiries.",
    "The provider can fulfil demand reliably."
  ];

  /*
    CORE METRICS

    These are intentionally behaviour-based.
  */

  const metrics = {
    impressions: null,
    enquiries: null,
    qualifiedEnquiries: null,
    quotes: null,
    jobsWon: null,
    revenue: null,
    directCosts: null,
    contribution: null,
    marketingSpend: null,
    acquisitionCost: null,
    conversionRate: null,
    quoteToSaleRate: null,
    contributionPerCustomer: null
  };

  /*
    PASS / FAIL FRAMEWORK

    These are placeholders rather than fabricated
    market benchmarks.

    We will later make them configurable.
  */

  const successCriteria = [
    "At least one genuinely qualified customer enquiry.",
    "At least one customer reaches the quoting stage.",
    "The observed economics remain positive.",
    "Acquisition cost is measurable.",
    "Customers demonstrate willingness to buy.",
    "No critical operational constraint prevents fulfilment."
  ];

  const failureCriteria = [
    "No qualified demand after a reasonable test.",
    "Customers consistently reject the offer.",
    "Acquisition cost is economically unattractive.",
    "Observed contribution is negative.",
    "Operational requirements make delivery impractical.",
    "The differentiation provides no observable advantage."
  ];

  const experiment = {
    id:
      `${Date.now()}-${opportunity.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`,

    createdAt:
      new Date().toISOString(),

    service:
      opportunity.name,

    category:
      opportunity.category || null,

    readinessScore,

    readiness,

    scores: {
      initialOpportunity:
        opportunity.initialScore ?? null,

      marketOpportunity:
        marketScore,

      economicViability:
        economicScore,

      evidenceConfidence:
        evidenceScore,

      finalOpportunity:
        finalScore
    },

    hypothesis,

    assumptions,

    metrics,

    successCriteria,

    failureCriteria,

    status: "PLANNED",

    decision: "PENDING",

    notes: []
  };

  return experiment;
}

function saveExperiment(experiment) {
  fs.mkdirSync(
    EXPERIMENT_DIR,
    {
      recursive: true
    }
  );

  const filename =
    `${experiment.id}.json`;

  const filepath =
    path.join(
      EXPERIMENT_DIR,
      filename
    );

  fs.writeFileSync(
    filepath,
    JSON.stringify(
      experiment,
      null,
      2
    )
  );

  return filepath;
}

/*
  Updates measured experiment results.

  This is the bridge between our AI research and
  actual business performance.
*/

function updateExperimentMetrics(
  experiment,
  updates = {}
) {
  if (!experiment) {
    throw new Error(
      "Experiment is required."
    );
  }

  experiment.metrics = {
    ...experiment.metrics,
    ...updates
  };

  const {
    enquiries,
    qualifiedEnquiries,
    quotes,
    jobsWon,
    revenue,
    directCosts,
    marketingSpend
  } = experiment.metrics;

  if (
    typeof enquiries === "number" &&
    enquiries > 0
  ) {
    experiment.metrics.conversionRate =
      qualifiedEnquiries != null
        ? round(
            qualifiedEnquiries /
              enquiries,
            4
          )
        : null;
  }

  if (
    typeof quotes === "number" &&
    quotes > 0 &&
    typeof jobsWon === "number"
  ) {
    experiment.metrics.quoteToSaleRate =
      round(
        jobsWon / quotes,
        4
      );
  }

  if (
    typeof revenue === "number" &&
    typeof directCosts === "number"
  ) {
    experiment.metrics.contribution =
      round(
        revenue - directCosts
      );
  }

  if (
    typeof marketingSpend === "number" &&
    typeof jobsWon === "number" &&
    jobsWon > 0
  ) {
    experiment.metrics.acquisitionCost =
      round(
        marketingSpend / jobsWon
      );
  }

  if (
    typeof jobsWon === "number" &&
    jobsWon > 0 &&
    typeof experiment.metrics.contribution ===
      "number"
  ) {
    experiment.metrics.contributionPerCustomer =
      round(
        experiment.metrics.contribution /
          jobsWon
      );
  }

  return experiment;
}

/*
  Makes a decision from observed data.

  We deliberately require actual evidence.
*/

function evaluateExperiment(experiment) {
  if (!experiment) {
    throw new Error(
      "Experiment is required."
    );
  }

  const m = experiment.metrics;

  const reasons = [];

  /*
    No real customer evidence yet.
  */

  if (
    !Number.isFinite(m.enquiries) ||
    m.enquiries <= 0
  ) {
    return {
      decision: "CONTINUE TESTING",
      confidence: "LOW",
      reasons: [
        "No measurable customer enquiry data exists yet."
      ]
    };
  }

  if (
    Number.isFinite(m.contribution) &&
    m.contribution < 0
  ) {
    return {
      decision: "STOP OR REDESIGN",
      confidence: "HIGH",
      reasons: [
        "Observed contribution is negative."
      ]
    };
  }

  if (
    Number.isFinite(m.jobsWon) &&
    m.jobsWon > 0 &&
    Number.isFinite(m.contribution) &&
    m.contribution > 0
  ) {
    reasons.push(
      "Real customers have purchased."
    );

    reasons.push(
      "Observed contribution is positive."
    );

    if (
      Number.isFinite(m.acquisitionCost)
    ) {
      reasons.push(
        "Customer acquisition cost has been measured."
      );
    }

    return {
      decision: "PROMISING — CONTINUE VALIDATION",
      confidence: "MEDIUM",
      reasons
    };
  }

  return {
    decision: "CONTINUE TESTING",
    confidence: "LOW",
    reasons: [
      "Insufficient real-world evidence for a scale decision."
    ]
  };
}

module.exports = {
  createExperiment,
  saveExperiment,
  updateExperimentMetrics,
  evaluateExperiment
};
