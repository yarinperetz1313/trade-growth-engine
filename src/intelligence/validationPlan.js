function buildValidationPlan(service, intelligence) {
  const tests = [];

  tests.push({
    priority: "HIGH",
    question: "Is there enough real customer demand?",
    evidenceNeeded: [
      "Search demand",
      "Google Maps/business listings",
      "Customer enquiries",
      "Tender/procurement activity",
      "Existing trade business evidence"
    ]
  });

  tests.push({
    priority: "HIGH",
    question: "Will customers actually pay enough?",
    evidenceNeeded: [
      "Competitor pricing",
      "Real quotes",
      "Customer interviews",
      "Actual transaction data"
    ]
  });

  tests.push({
    priority: "HIGH",
    question: "Can customers be acquired profitably?",
    evidenceNeeded: [
      "Lead cost",
      "Conversion rate",
      "Sales cycle",
      "Channel performance"
    ]
  });

  tests.push({
    priority: "HIGH",
    question: "Can the service be delivered profitably?",
    evidenceNeeded: [
      "Labour requirements",
      "Materials",
      "Travel time",
      "Equipment",
      "Subcontractor costs"
    ]
  });

  if (intelligence?.signals?.responseTimeGap >= 7) {
    tests.push({
      priority: "MEDIUM",
      question:
        "Would customers value a stronger response-time proposition?",
      evidenceNeeded: [
        "Competitor response promises",
        "Customer interviews",
        "Lead conversion comparison"
      ]
    });
  }

  if (intelligence?.signals?.pricingDifferentiation >= 7) {
    tests.push({
      priority: "MEDIUM",
      question:
        "Would pricing transparency improve conversion?",
      evidenceNeeded: [
        "Competitor pricing research",
        "Customer feedback",
        "A/B testing"
      ]
    });
  }

  return {
    service: service.name,

    currentDecision:
      intelligence?.decision || "INVESTIGATE",

    tests,

    rule:
      "Do not declare the opportunity profitable until demand, pricing, acquisition economics and delivery economics are supported by evidence."
  };
}

module.exports = {
  buildValidationPlan
};
