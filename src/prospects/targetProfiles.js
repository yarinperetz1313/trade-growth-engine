const DEFAULT_TARGET_PROFILES = [
  {
    name: "Commercial Property Managers",

    priority: "HIGH",

    rationale:
      "Manage commercial properties where electrical faults can disrupt tenants and operations.",

    searchTerms: [
      "commercial property management Melbourne",
      "commercial property managers Melbourne",
      "industrial property management Melbourne"
    ]
  },

  {
    name: "Facilities Management",

    priority: "HIGH",

    rationale:
      "Facilities managers may coordinate maintenance and emergency contractors across multiple sites.",

    searchTerms: [
      "facilities management Melbourne",
      "commercial facilities management Melbourne",
      "facility management company Melbourne"
    ]
  },

  {
    name: "Multi-Site Retail",

    priority: "HIGH",

    rationale:
      "Multiple retail locations can create recurring electrical maintenance and emergency-response requirements.",

    searchTerms: [
      "retail group Melbourne multiple locations",
      "multi site retailer Melbourne",
      "retail property operator Melbourne"
    ]
  },

  {
    name: "Industrial Operators",

    priority: "HIGH",

    rationale:
      "Industrial sites can have operational downtime risks associated with electrical faults.",

    searchTerms: [
      "industrial company Melbourne",
      "manufacturing company Melbourne",
      "industrial facility Melbourne"
    ]
  },

  {
    name: "Warehouse Operators",

    priority: "HIGH",

    rationale:
      "Warehouses depend on electrical infrastructure for lighting, equipment and ongoing operations.",

    searchTerms: [
      "warehouse operator Melbourne",
      "logistics warehouse Melbourne",
      "distribution centre Melbourne"
    ]
  },

  {
    name: "Shopping Centre Operators",

    priority: "HIGH",

    rationale:
      "Large shopping centres have substantial electrical infrastructure and many commercial tenants.",

    searchTerms: [
      "shopping centre management Melbourne",
      "shopping centre operator Melbourne",
      "retail property owner Melbourne"
    ]
  },

  {
    name: "Hospitality Groups",

    priority: "MEDIUM",

    rationale:
      "Restaurants, hotels and hospitality groups can experience operational disruption from electrical faults.",

    searchTerms: [
      "hotel group Melbourne",
      "restaurant group Melbourne",
      "hospitality group Melbourne"
    ]
  },

  {
    name: "Strata / Owners Corporation Management",

    priority: "MEDIUM",

    rationale:
      "Strata managers may coordinate contractors for common-property electrical maintenance.",

    searchTerms: [
      "owners corporation management Melbourne",
      "strata management Melbourne",
      "body corporate management Melbourne"
    ]
  }
];

function getTargetProfiles({
  service
} = {}) {
  if (!service) {
    throw new Error(
      "service is required"
    );
  }

  return DEFAULT_TARGET_PROFILES.map(
    profile => ({
      ...profile,

      service
    })
  );
}

function getSearchQueries({
  service
} = {}) {
  const profiles =
    getTargetProfiles({
      service
    });

  return profiles.flatMap(
    profile =>
      profile.searchTerms.map(
        query => ({
          query,
          profile:
            profile.name,
          priority:
            profile.priority,
          service
        })
      )
  );
}

module.exports = {
  DEFAULT_TARGET_PROFILES,
  getTargetProfiles,
  getSearchQueries
};
