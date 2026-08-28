function percentage(count, total) {
  if (!total) return 0;

  return Number(
    ((count / total) * 100).toFixed(1)
  );
}

function scoreCompetitorMarket(competitors) {
  if (
    !Array.isArray(competitors) ||
    competitors.length === 0
  ) {
    return {
      success: false,
      error: "No competitor data supplied."
    };
  }

  const total = competitors.length;

  const contractCount = competitors.filter(
    c => c.maintenanceContracts === "Yes"
  ).length;

  const emergencyCount = competitors.filter(
    c => c.emergencyService === "Yes"
  ).length;

  const commercialFocusedCount = competitors.filter(
    c => c.commercialFocus === "Yes"
  ).length;

  const pricingCount = competitors.filter(
    c => c.pricingPubliclyDisclosed === "Yes"
  ).length;

  const numericalResponseCount = competitors.filter(
    c =>
      typeof c.responseTime === "string" &&
      /\d/.test(c.responseTime)
  ).length;

  const contractRate = contractCount / total;
  const emergencyRate = emergencyCount / total;
  const commercialFocusRate =
    commercialFocusedCount / total;
  const pricingTransparencyRate =
    pricingCount / total;
  const responseTransparencyRate =
    numericalResponseCount / total;

  /*
    IMPORTANT:

    These are discovery signals, NOT market share.

    We deliberately avoid pretending that finding 10 businesses
    means there are only 10 competitors in Melbourne.
  */

  let competitivePressure = 5;

  if (total >= 10) competitivePressure += 1;
  if (total >= 15) competitivePressure += 1;

  if (commercialFocusRate >= 0.7) {
    competitivePressure += 1;
  }

  if (contractRate >= 0.7) {
    competitivePressure += 1;
  }

  if (emergencyRate >= 0.8) {
    competitivePressure += 1;
  }

  competitivePressure = Math.min(
    10,
    competitivePressure
  );

  /*
    DIFFERENTIATION

    Higher = more apparent room to differentiate
    based on what competitors publicly disclose.
  */

  let differentiation = 5;

  if (pricingTransparencyRate < 0.3) {
    differentiation += 1;
  }

  if (responseTransparencyRate < 0.3) {
    differentiation += 1;
  }

  if (contractRate < 0.7) {
    differentiation += 1;
  }

  if (commercialFocusRate < 0.7) {
    differentiation += 1;
  }

  differentiation = Math.min(
    10,
    differentiation
  );

  /*
    RESPONSE-TIME GAP

    This measures how uncommon an explicit numerical
    response-time statement is among the discovered
    competitors.
  */

  const responseTimeGap = Math.max(
    1,
    Math.min(
      10,
      10 - Math.round(
        responseTransparencyRate * 10
      )
    )
  );

  /*
    PRICING TRANSPARENCY GAP

    Higher means fewer competitors publicly disclose
    pricing.
  */

  const pricingTransparencyGap = Math.max(
    1,
    Math.min(
      10,
      10 - Math.round(
        pricingTransparencyRate * 10
      )
    )
  );

  /*
    MARKET OPPORTUNITY

    This is an internal prioritisation score.

    It is NOT:
    - market size
    - market share
    - probability of success
    - guaranteed profitability

    It combines observable competitive signals.
  */

  const marketOpportunity =
    differentiation * 0.35 +
    responseTimeGap * 0.20 +
    pricingTransparencyGap * 0.15 +
    (10 - competitivePressure) * 0.30;

  const roundedMarketOpportunity =
    Number(
      Math.min(
        10,
        Math.max(
          1,
          marketOpportunity
        )
      ).toFixed(1)
    );

  /*
    EVIDENCE COVERAGE

    This is important.

    A score based on 10 competitors with strong evidence
    should be treated differently from a score based on
    10 weakly verified businesses.
  */

  const evidenceFields = competitors.flatMap(
    competitor => [
      competitor.evidence?.service,
      competitor.evidence?.commercialFocus,
      competitor.evidence?.emergencyService,
      competitor.evidence?.maintenanceContracts,
      competitor.evidence?.responseTime,
      competitor.evidence?.pricing,
      competitor.evidence?.commercialCustomers,
      competitor.evidence?.certifications
    ]
  );

  const evidencePresent =
    evidenceFields.filter(
      field =>
        Array.isArray(field) &&
        field.length > 0
    ).length;

  const evidenceCoverage =
    evidenceFields.length === 0
      ? 0
      : Number(
          (
            evidencePresent /
            evidenceFields.length *
            100
          ).toFixed(1)
        );

  const highConfidenceCount =
    competitors.filter(
      c => c.confidence === "High"
    ).length;

  const mediumConfidenceCount =
    competitors.filter(
      c => c.confidence === "Medium"
    ).length;

  const lowConfidenceCount =
    competitors.filter(
      c => c.confidence === "Low"
    ).length;

  let confidenceScore = 5;

  if (highConfidenceCount >= total * 0.7) {
    confidenceScore += 3;
  } else if (
    highConfidenceCount >= total * 0.4
  ) {
    confidenceScore += 2;
  }

  if (lowConfidenceCount >= total * 0.5) {
    confidenceScore -= 2;
  }

  confidenceScore = Math.max(
    1,
    Math.min(10, confidenceScore)
  );

  return {
    success: true,

    market: {
      competitorsFound: total,

      contractAdvertisers: contractCount,

      emergencyAdvertisers: emergencyCount,

      commercialFocusedCompetitors:
        commercialFocusedCount,

      pricingDisclosedCompetitors:
        pricingCount,

      numericalResponseCompetitors:
        numericalResponseCount
    },

    rates: {
      contractRate:
        percentage(contractCount, total),

      emergencyRate:
        percentage(emergencyCount, total),

      commercialFocusRate:
        percentage(
          commercialFocusedCount,
          total
        ),

      pricingTransparencyRate:
        percentage(
          pricingCount,
          total
        ),

      responseTransparencyRate:
        percentage(
          numericalResponseCount,
          total
        )
    },

    scores: {
      competitivePressure,

      differentiation,

      responseTimeGap,

      pricingTransparencyGap,

      marketOpportunity:
        roundedMarketOpportunity,

      confidenceScore
    },

    evidence: {
      evidenceCoverage,
      highConfidenceCompetitors:
        highConfidenceCount,
      mediumConfidenceCompetitors:
        mediumConfidenceCount,
      lowConfidenceCompetitors:
        lowConfidenceCount
    },

    interpretation: {
      saturation:
        competitivePressure >= 8
          ? "High competitive pressure signal"
          : competitivePressure >= 6
          ? "Moderate competitive pressure signal"
          : "Lower competitive pressure signal",

      differentiation:
        differentiation >= 8
          ? "Strong observable differentiation gaps"
          : differentiation >= 6
          ? "Some observable differentiation gaps"
          : "Limited obvious differentiation gaps",

      evidence:
        confidenceScore >= 8
          ? "Strong evidence quality"
          : confidenceScore >= 6
          ? "Moderate evidence quality"
          : "Weak evidence quality",

      recommendation:
        roundedMarketOpportunity >= 7.5
          ? "Strong candidate for deeper validation"
          : roundedMarketOpportunity >= 6
          ? "Worth further investigation"
          : "Requires stronger evidence before prioritisation"
    }
  };
}

module.exports = {
  scoreCompetitorMarket
};
