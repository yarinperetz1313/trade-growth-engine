const {
  getSearchQueries
} = require("./targetProfiles");

const {
  searchProspects
} = require("./searchProspects");

async function runProspectDiscovery({
  service,
  experimentId,
  location = "Melbourne, Victoria",
  targetCount = 50,
  offline = false
}) {
  if (!service) {
    throw new Error("service is required");
  }

  if (!experimentId) {
    throw new Error("experimentId is required");
  }

  const queries =
    getSearchQueries({
      service
    });

  console.log(`
==========================================
       PROSPECT DISCOVERY
==========================================
`);

  console.log(
    `Service: ${service}`
  );

  console.log(
    `Location: ${location}`
  );

  console.log(
    `Target prospects: ${targetCount}`
  );

  console.log(
    `Targeted queries: ${queries.length}`
  );

  /*
    Offline mode must never pretend that
    live prospects were discovered.
  */

  if (offline) {
    return {
      success: true,

      offline: true,

      service,

      location,

      targetCount,

      queries,

      prospects: [],

      prospectCount: 0,

      validProspectCount: 0,

      message:
        "Offline mode: no live prospect discovery performed."
    };
  }

  /*
    At this stage we use the prospect researcher
    as the live research layer.

    We give it the complete target strategy rather
    than blindly running 24 separate paid searches.
  */

  const result =
    await searchProspects({
      service,
      experimentId,
      location,
      targetCount,
      offline
    });

  if (!result.success) {
    return {
      success: false,

      service,

      location,

      targetCount,

      queries,

      error:
        result.error ||
        "Prospect discovery failed.",

      reason:
        result.reason ||
        "PROSPECT_RESEARCH_FAILED",

      prospects: [],

      prospectCount: 0,

      validProspectCount: 0
    };
  }

  return {
    success: true,

    offline: false,

    service,

    location,

    targetCount,

    queries,

    prospects:
      result.prospects || [],

    prospectCount:
      result.prospectCount || 0,

    validProspectCount:
      result.validProspectCount || 0,

    filePath:
      result.filePath || null
  };
}

module.exports = {
  runProspectDiscovery
};
