function createResearchRecord({
  market,
  service,
  location,
}) {
  return {
    market,
    service,
    location,

    demand: {
      searchVolume: null,
      trend: null,
      urgency: null,
      evidence: [],
    },

    competition: {
      competitorCount: null,
      advertisingIntensity: null,
      reviewStrength: null,
      evidence: [],
    },

    economics: {
      averageJobValue: null,
      estimatedGrossMargin: null,
      repeatPotential: null,
      evidence: [],
    },

    regulation: {
      licensingRequired: null,
      complexity: null,
      evidence: [],
    },

    confidence: "low",

    sources: [],
  };
}

module.exports = {
  createResearchRecord,
};
