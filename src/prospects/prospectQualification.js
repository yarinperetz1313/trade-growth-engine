function clamp(
  value,
  min = 0,
  max = 10
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function normalizeText(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .trim()
    .toLowerCase();
}

function buildEvidenceText(
  prospect
) {
  const evidenceText =
    Array.isArray(
      prospect.evidence
    )
      ? prospect.evidence.join(" ")
      : prospect.evidence || "";

  return [
    prospect.businessName,
    prospect.industry,
    prospect.location,
    prospect.service,
    prospect.commercialRelevance,
    prospect.notes,
    prospect.description,
    evidenceText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreEvidence(
  prospect
) {
  const evidence =
    Array.isArray(
      prospect.evidence
    )
      ? prospect.evidence.filter(Boolean)
      : [];

  let score = 0;

  if (evidence.length >= 1) {
    score += 4;
  }

  if (evidence.length >= 2) {
    score += 2;
  }

  if (evidence.length >= 3) {
    score += 2;
  }

  if (
    prospect.sourceUrl
  ) {
    score += 1;
  }

  if (
    prospect.website
  ) {
    score += 1;
  }

  return clamp(score);
}

function scoreContactability(
  prospect
) {
  let score = 0;

  if (
    prospect.email
  ) {
    score += 4;
  }

  if (
    prospect.phone
  ) {
    score += 3;
  }

  if (
    prospect.website
  ) {
    score += 2;
  }

  if (
    prospect.location
  ) {
    score += 1;
  }

  return clamp(score);
}

function scoreCommercialFit(
  prospect
) {
  const text =
    buildEvidenceText(
      prospect
    );

  const commercialTerms = [
    "commercial",
    "property",
    "properties",
    "facility",
    "facilities",
    "retail",
    "warehouse",
    "industrial",
    "office",
    "corporate",
    "hotel",
    "shopping centre",
    "shopping center",
    "strata",
    "body corporate",
    "property management",
    "facility management",
    "business",
    "multiple sites",
    "multiple properties"
  ];

  let score = 0;

  for (
    const term of commercialTerms
  ) {
    if (
      text.includes(term)
    ) {
      score += 1;
    }
  }

  const relevance =
    normalizeText(
      prospect.commercialRelevance
    );

  if (
    relevance === "high"
  ) {
    score += 3;
  }

  if (
    relevance === "medium"
  ) {
    score += 1.5;
  }

  return clamp(score);
}

function scoreMultiSitePotential(
  prospect
) {
  const text =
    buildEvidenceText(
      prospect
    );

  const strongSignals = [
    "multiple sites",
    "multiple properties",
    "portfolio",
    "national",
    "statewide",
    "multi-site",
    "multisite",
    "multiple locations",
    "branches",
    "stores",
    "properties"
  ];

  let score = 0;

  for (
    const signal of strongSignals
  ) {
    if (
      text.includes(signal)
    ) {
      score += 2;
    }
  }

  return clamp(score);
}

function scoreUrgencyPotential(
  prospect
) {
  const text =
    buildEvidenceText(
      prospect
    );

  const urgentTerms = [
    "emergency",
    "urgent",
    "24/7",
    "24 hour",
    "breakdown",
    "fault",
    "outage",
    "failure",
    "repair",
    "same day",
    "after hours",
    "critical",
    "shutdown",
    "downtime"
  ];

  let score = 0;

  for (
    const term of urgentTerms
  ) {
    if (
      text.includes(term)
    ) {
      score += 2;
    }
  }

  return clamp(score);
}

function detectPotentialCompetitor(
  prospect
) {
  /*
    IMPORTANT:

    Competitor detection only examines the
    business identity, industry and declared
    service.

    It does NOT examine general evidence.

    Therefore:
      "Requires maintenance contractors"

    will NOT incorrectly turn a property manager
    into an electrical contractor.
  */

  const identityText = [
    prospect.businessName,
    prospect.industry,
    prospect.service
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const competitorTerms = [
    "electrician",
    "electrical contractor",
    "electrical services",
    "electrical maintenance company",
    "electrical contractor company",
    "electrical company",
    "electrical contracting",
    "electrical business"
  ];

  return competitorTerms.some(
    term =>
      identityText.includes(term)
  );
}

function qualifyProspect(
  prospect
) {
  if (
    !prospect ||
    !prospect.businessName
  ) {
    return {
      qualified: false,

      qualification:
        "LOW",

      qualificationScore:
        0,

      reason:
        "Missing business name.",

      potentialCompetitor:
        false,

      scores: {
        evidence: 0,
        commercialFit: 0,
        contactability: 0,
        multiSite: 0,
        urgency: 0
      }
    };
  }

  const evidenceScore =
    scoreEvidence(
      prospect
    );

  const commercialFitScore =
    scoreCommercialFit(
      prospect
    );

  const contactabilityScore =
    scoreContactability(
      prospect
    );

  const multiSiteScore =
    scoreMultiSitePotential(
      prospect
    );

  const urgencyScore =
    scoreUrgencyPotential(
      prospect
    );

  const potentialCompetitor =
    detectPotentialCompetitor(
      prospect
    );

  /*
    Competitor exclusion is a hard rule.

    If the business itself appears to be an
    electrical provider, exclude it rather than
    allowing a high score to push it through.
  */

  if (
    potentialCompetitor
  ) {
    return {
      qualified: false,

      qualification:
        "EXCLUDED",

      qualificationScore:
        0,

      reason:
        "Potential competitor detected.",

      potentialCompetitor:
        true,

      scores: {
        evidence:
          evidenceScore,

        commercialFit:
          commercialFitScore,

        contactability:
          contactabilityScore,

        multiSite:
          multiSiteScore,

        urgency:
          urgencyScore
      }
    };
  }

  /*
    Weighted qualification score.

    Evidence and commercial fit receive the
    greatest weight.

    Contactability matters, but a phone number
    alone should not create a strong prospect.

    Urgency is useful but is not mandatory for
    commercial qualification.
  */

  const qualificationScore =
    (
      evidenceScore * 0.30 +
      commercialFitScore * 0.30 +
      contactabilityScore * 0.15 +
      multiSiteScore * 0.15 +
      urgencyScore * 0.10
    );

  const finalScore =
    Math.round(
      qualificationScore * 10
    ) / 10;

  let qualification =
    "LOW";

  if (
    finalScore >= 8
  ) {
    qualification =
      "HIGH";
  } else if (
    finalScore >= 6
  ) {
    qualification =
      "MEDIUM";
  }

  return {
    qualified:
      finalScore >= 6,

    qualification,

    qualificationScore:
      finalScore,

    reason:
      finalScore >= 8
        ? "Strong commercial prospect with sufficient supporting evidence."
        : finalScore >= 6
        ? "Potentially suitable prospect requiring further validation."
        : "Insufficient evidence or commercial fit.",

    potentialCompetitor:
      false,

    scores: {
      evidence:
        evidenceScore,

      commercialFit:
        commercialFitScore,

      contactability:
        contactabilityScore,

      multiSite:
        multiSiteScore,

      urgency:
        urgencyScore
    }
  };
}

function qualifyProspects(
  prospects
) {
  if (
    !Array.isArray(
      prospects
    )
  ) {
    throw new Error(
      "prospects must be an array"
    );
  }

  return prospects.map(
    prospect => ({
      ...prospect,

      qualification:
        qualifyProspect(
          prospect
        )
    })
  );
}

module.exports = {
  clamp,
  normalizeText,
  buildEvidenceText,
  scoreEvidence,
  scoreContactability,
  scoreCommercialFit,
  scoreMultiSitePotential,
  scoreUrgencyPotential,
  detectPotentialCompetitor,
  qualifyProspect,
  qualifyProspects
};
