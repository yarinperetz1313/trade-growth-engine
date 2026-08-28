/**
 * TRADE GROWTH ENGINE
 * Validation Planner
 *
 * Converts an opportunity/experiment into a
 * controlled real-world validation plan.
 *
 * IMPORTANT:
 * Thresholds are configurable modelling rules.
 * They are NOT claims about market benchmarks.
 */

function round(value, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function createValidationPlan(
  opportunity,
  options = {}
) {
  if (
    !opportunity ||
    !opportunity.name
  ) {
    throw new Error(
      "A valid opportunity is required."
    );
  }

  const {
    testBudget = 300,
    testDays = 14,
    prospectTarget = 50
  } = options;

  const finalScore =
    typeof opportunity.finalScore === "number"
      ? opportunity.finalScore
      : null;

  const marketScore =
    typeof opportunity.marketScore === "number"
      ? opportunity.marketScore
      : null;

  const confidenceScore =
    typeof opportunity.confidenceScore === "number"
      ? opportunity.confidenceScore
      : null;

  /*
    These are TEST DESIGN PARAMETERS.

    They are not market statistics.
  */

  const thresholds = {
    minimumQualifiedEnquiries: 3,
    minimumQuotes: 2,
    minimumJobsWon: 1,
    maximumTestBudget: testBudget,
    minimumContribution: 0
  };

  const hypothesis =
    `There are customers in the target market who have ` +
    `a genuine need for ${opportunity.name.toLowerCase()} ` +
    `and will take a measurable buying action when presented ` +
    `with a clear, credible offer.`;

  const targetCustomer = {
    status: "TO_BE_VALIDATED",

    description:
      "Identify the customer segment with the strongest combination of need, urgency, ability to pay and accessibility.",

    requiredEvidence: [
      "Customer has the relevant problem.",
      "Customer has authority or ability to purchase.",
      "Customer can be reached through a measurable channel.",
      "Customer demonstrates willingness to discuss or purchase the service."
    ]
  };

  const offerTest = {
    status: "TO_BE_DEFINED",

    objective:
      "Determine which service positioning produces the strongest genuine buying response.",

    requiredElements: [
      "Clear service",
      "Clear customer benefit",
      "Credible provider",
      "Transparent next step",
      "Simple enquiry mechanism"
    ],

    avoid: [
      "Unverified guarantees",
      "Fake scarcity",
      "Invented testimonials",
      "Unsupported claims",
      "Artificial pricing claims"
    ]
  };

  const acquisitionTest = {
    status: "PLANNED",

    channels: [
      "Direct outreach",
      "Search-driven acquisition",
      "Referral or partnership testing"
    ],

    selectedChannel:
      options.channel || "TO_BE_SELECTED",

    testBudget,

    testDays,

    prospectTarget
  };

  const tracking = {
    impressions: null,
    prospectsContacted: null,
    enquiries: null,
    qualifiedEnquiries: null,
    quotes: null,
    jobsWon: null,

    revenue: null,
    directCosts: null,
    marketingSpend: null,

    contribution: null,
    acquisitionCost: null,

    enquiryRate: null,
    qualificationRate: null,
    quoteRate: null,
    closeRate: null
  };

  const successCriteria = [
    `At least ${thresholds.minimumQualifiedEnquiries} qualified enquiries.`,
    `At least ${thresholds.minimumQuotes} genuine quote opportunities.`,
    `At least ${thresholds.minimumJobsWon} completed sale.`,
    "Positive contribution after direct costs.",
    "Acquisition economics are measurable.",
    "No major operational barrier prevents fulfilment."
  ];

  const failureCriteria = [
    "No meaningful customer response.",
    "Customers repeatedly reject the offer.",
    "No qualified buying signals.",
    "Contribution is negative.",
    "Acquisition cost cannot plausibly support the economics.",
    "Operational delivery is impractical."
  ];

  const requiredEvidence = [
    "Evidence of genuine customer demand.",
    "Evidence of customer willingness to engage.",
    "Evidence of quote demand.",
    "Evidence of willingness to purchase.",
    "Actual revenue.",
    "Actual direct costs.",
    "Actual marketing spend.",
    "Actual customer acquisition cost."
  ];

  const decisionRules = {
    scale:
      "Only consider scaling after repeatable positive contribution and measurable acquisition economics.",

    continue:
      "Continue testing when there are promising buying signals but insufficient evidence for a scale decision.",

    redesign:
      "Redesign the offer or acquisition method when demand exists but economics or conversion are inadequate.",

    stop:
      "Stop the experiment when evidence consistently indicates insufficient demand or structurally negative economics."
  };

  /*
    Readiness score is deliberately conservative.
  */

  let readiness = 0;

  if (finalScore !== null) {
    readiness += finalScore * 0.40;
  }

  if (marketScore !== null) {
    readiness += marketScore * 0.20;
  }

  if (confidenceScore !== null) {
    readiness += confidenceScore * 0.20;
  }

  /*
    Having a defined test budget and duration
    contributes to operational readiness.
  */

  readiness += 10 * 0.10;

  readiness = round(
    clamp(readiness)
  );

  let status;

  if (readiness >= 8) {
    status = "READY";
  } else if (readiness >= 6) {
    status = "NEAR_READY";
  } else if (readiness >= 4) {
    status = "NEEDS_PREPARATION";
  } else {
    status = "NOT_READY";
  }

  return {
    createdAt:
      new Date().toISOString(),

    service:
      opportunity.name,

    status,

    readinessScore:
      readiness,

    hypothesis,

    targetCustomer,

    offerTest,

    acquisitionTest,

    thresholds,

    tracking,

    successCriteria,

    failureCriteria,

    requiredEvidence,

    decisionRules,

    assumptions: [
      "The selected customer segment still requires validation.",
      "The acquisition channel has not yet been proven.",
      "The test budget is a planning parameter.",
      "The opportunity score is not proof of profitability.",
      "Real customer behaviour must determine the final decision."
    ]
  };
}

function calculateValidationMetrics(
  tracking
) {
  const metrics = {
    enquiryRate: null,
    qualificationRate: null,
    quoteRate: null,
    closeRate: null,
    contribution: null,
    acquisitionCost: null
  };

  if (
    Number.isFinite(tracking.impressions) &&
    tracking.impressions > 0 &&
    Number.isFinite(tracking.enquiries)
  ) {
    metrics.enquiryRate =
      round(
        tracking.enquiries /
          tracking.impressions,
        4
      );
  }

  if (
    Number.isFinite(tracking.enquiries) &&
    tracking.enquiries > 0 &&
    Number.isFinite(
      tracking.qualifiedEnquiries
    )
  ) {
    metrics.qualificationRate =
      round(
        tracking.qualifiedEnquiries /
          tracking.enquiries,
        4
      );
  }

  if (
    Number.isFinite(
      tracking.qualifiedEnquiries
    ) &&
    tracking.qualifiedEnquiries > 0 &&
    Number.isFinite(tracking.quotes)
  ) {
    metrics.quoteRate =
      round(
        tracking.quotes /
          tracking.qualifiedEnquiries,
        4
      );
  }

  if (
    Number.isFinite(tracking.quotes) &&
    tracking.quotes > 0 &&
    Number.isFinite(tracking.jobsWon)
  ) {
    metrics.closeRate =
      round(
        tracking.jobsWon /
          tracking.quotes,
        4
      );
  }

  if (
    Number.isFinite(tracking.revenue) &&
    Number.isFinite(tracking.directCosts)
  ) {
    metrics.contribution =
      round(
        tracking.revenue -
          tracking.directCosts
      );
  }

  if (
    Number.isFinite(tracking.marketingSpend) &&
    Number.isFinite(tracking.jobsWon) &&
    tracking.jobsWon > 0
  ) {
    metrics.acquisitionCost =
      round(
        tracking.marketingSpend /
          tracking.jobsWon
      );
  }

  return metrics;
}

module.exports = {
  createValidationPlan,
  calculateValidationMetrics
};
