const DEFAULT_WEIGHTS = {
  icpFit: 30,
  serviceFit: 20,
  locationFit: 15,
  dataQuality: 15,
  commercialPotential: 20
};

function clamp(
  value,
  min = 0,
  max = 100
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function scoreIcpFit(
  prospect
) {
  const service =
    String(
      prospect.service || ""
    ).toLowerCase();

  const tradeKeywords = [
    "commercial",
    "electrical",
    "plumbing",
    "hvac",
    "mechanical",
    "construction",
    "roofing",
    "fire",
    "building",
    "maintenance"
  ];

  if (
    tradeKeywords.some(
      keyword =>
        service.includes(
          keyword
        )
    )
  ) {
    return 100;
  }

  return 55;
}

function scoreServiceFit(
  prospect
) {
  const service =
    String(
      prospect.service || ""
    ).trim();

  if (!service) {
    return 0;
  }

  if (
    service
      .toLowerCase()
      .includes("commercial")
  ) {
    return 100;
  }

  return 75;
}

function scoreLocationFit(
  prospect
) {
  const location =
    String(
      prospect.location || ""
    ).toLowerCase();

  if (!location) {
    return 0;
  }

  const preferredLocations = [
    "melbourne",
    "richmond",
    "south yarra",
    "oakleigh",
    "clayton",
    "brighton",
    "bentleigh"
  ];

  if (
    preferredLocations.some(
      item =>
        location.includes(item)
    )
  ) {
    return 100;
  }

  return 60;
}

function scoreDataQuality(
  prospect
) {
  let score = 0;

  if (
    prospect.business_name
  ) {
    score += 25;
  }

  if (
    prospect.website
  ) {
    score += 25;
  }

  if (
    prospect.email
  ) {
    score += 20;
  }

  if (
    prospect.phone
  ) {
    score += 15;
  }

  if (
    prospect.location
  ) {
    score += 15;
  }

  return clamp(score);
}

function scoreCommercialPotential(
  prospect
) {
  const value =
    Number(
      prospect.value_estimate ||
      prospect.estimated_value ||
      prospect.opportunity_value ||
      0
    );

  if (value >= 20000) {
    return 100;
  }

  if (value >= 10000) {
    return 85;
  }

  if (value >= 5000) {
    return 70;
  }

  if (value > 0) {
    return 55;
  }

  return 40;
}

function priorityFromScore(
  score
) {
  if (score >= 85) {
    return "HIGH";
  }

  if (score >= 70) {
    return "MEDIUM";
  }

  return "LOW";
}

function recommendationFromScore(
  score
) {
  if (score >= 85) {
    return "PRIORITISE";
  }

  if (score >= 70) {
    return "RESEARCH";
  }

  return "MONITOR";
}

function qualifyProspect(
  prospect,
  weights = DEFAULT_WEIGHTS
) {
  const components = {
    icpFit:
      scoreIcpFit(
        prospect
      ),

    serviceFit:
      scoreServiceFit(
        prospect
      ),

    locationFit:
      scoreLocationFit(
        prospect
      ),

    dataQuality:
      scoreDataQuality(
        prospect
      ),

    commercialPotential:
      scoreCommercialPotential(
        prospect
      )
  };

  const totalWeight =
    Object.values(
      weights
    ).reduce(
      (sum, value) =>
        sum + value,
      0
    );

  const weightedScore =
    Object.entries(
      components
    ).reduce(
      (sum, [key, value]) => {
        return (
          sum +
          value *
          (weights[key] /
            totalWeight)
        );
      },
      0
    );

  const score =
    Math.round(
      clamp(
        weightedScore
      )
    );

  const priority =
    priorityFromScore(
      score
    );

  const recommendation =
    recommendationFromScore(
      score
    );

  const reasons = [];

  if (
    components.icpFit >= 80
  ) {
    reasons.push(
      "Strong ICP/service-category fit"
    );
  }

  if (
    components.serviceFit >= 80
  ) {
    reasons.push(
      "Strong service fit"
    );
  }

  if (
    components.locationFit >= 80
  ) {
    reasons.push(
      "Preferred geographic market"
    );
  }

  if (
    components.dataQuality >= 80
  ) {
    reasons.push(
      "High-quality prospect data"
    );
  }

  if (
    components.commercialPotential >= 80
  ) {
    reasons.push(
      "Strong commercial potential"
    );
  }

  return {
    score,
    priority,
    recommendation,
    components,
    reasons,
    confidence:
      components.dataQuality
  };
}

module.exports = {
  DEFAULT_WEIGHTS,
  qualifyProspect
};
