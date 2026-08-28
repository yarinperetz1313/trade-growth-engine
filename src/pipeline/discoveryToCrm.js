const {
  runProspectDiscovery
} = require("../prospects/prospectOrchestrator");

const {
  ingestProspects,
  getProspects,
  saveProspects
} = require("../prospects/prospectIngestion");

const {
  qualifyProspect
} = require("../prospects/prospectQualification");

const {
  runProspectToCrm
} = require("./prospectToCrm");

function createExperimentId({
  service,
  location
}) {
  const safe = value =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  return [
    "discovery",
    safe(service),
    safe(location),
    new Date()
      .toISOString()
      .slice(0, 10)
  ].join("-");
}

function getProspectIdentity(
  prospect
) {
  return (
    prospect.dedupeKey ||
    prospect.website ||
    prospect.email ||
    prospect.phone ||
    `${prospect.businessName || ""}|${
      prospect.address || ""
    }`
  );
}

async function runDiscoveryToCrm({
  service,
  location,
  targetCount = 10,
  offline = true,
  experimentId
}) {
  if (!service) {
    throw new Error(
      "service is required"
    );
  }

  if (!location) {
    throw new Error(
      "location is required"
    );
  }

  const resolvedExperimentId =
    experimentId ||
    createExperimentId({
      service,
      location
    });

  console.log(
    "\n=========================================="
  );

  console.log(
    "       DISCOVERY → CRM PIPELINE"
  );

  console.log(
    "==========================================\n"
  );

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
    `Experiment: ${resolvedExperimentId}`
  );

  console.log(
    `Offline mode: ${offline}\n`
  );

  const discovery =
    await runProspectDiscovery({
      service,
      experimentId:
        resolvedExperimentId,
      location,
      targetCount,
      offline
    });

  if (
    !discovery ||
    discovery.success !== true
  ) {
    return {
      success: false,
      stage: "DISCOVERY",
      experimentId:
        resolvedExperimentId,
      error:
        discovery?.error ||
        "Discovery failed.",
      reason:
        discovery?.reason ||
        "DISCOVERY_FAILED"
    };
  }

  const discovered =
    Array.isArray(
      discovery.prospects
    )
      ? discovery.prospects
      : [];

  console.log(
    `Discovery results: ${discovered.length}`
  );

  if (
    discovery.offline ||
    discovered.length === 0
  ) {
    return {
      success: true,
      status:
        "NO_PROSPECTS_DISCOVERED",
      experimentId:
        resolvedExperimentId,
      offline:
        Boolean(
          discovery.offline
        ),
      discovery: {
        discovered:
          discovered.length,
        valid:
          discovery.validProspectCount ||
          0
      },
      ingestion: {
        normalized: 0,
        duplicates: 0
      },
      qualification: {
        qualified: 0
      },
      crm: {
        created: 0,
        duplicates: 0
      },
      message:
        discovery.offline
          ? "Offline mode: no live prospect discovery performed."
          : "Discovery returned no prospects."
    };
  }

  const ingestion =
    ingestProspects(
      discovered,
      {
        service,
        location,
        source:
          "prospect-discovery",
        query:
          resolvedExperimentId
      }
    );

  console.log(
    `Ingested: ${ingestion.stats.normalized}`
  );

  console.log(
    `Duplicates: ${ingestion.stats.duplicates}`
  );

  const discoveredIdentities =
    new Set(
      discovered.map(
        getProspectIdentity
      )
    );

  const currentProspects =
    getProspects();

  let qualifiedCount = 0;
  let evaluatedCount = 0;

  for (
    const prospect of currentProspects
  ) {
    const identity =
      getProspectIdentity(
        prospect
      );

    if (
      !discoveredIdentities.has(
        identity
      )
    ) {
      continue;
    }

    if (
      prospect.qualification
    ) {
      if (
        prospect.qualification
          .qualified
      ) {
        qualifiedCount += 1;
      }

      continue;
    }

    const qualification =
      qualifyProspect(
        prospect
      );

    prospect.qualification =
      qualification;

    evaluatedCount += 1;

    if (
      qualification?.qualified
    ) {
      qualifiedCount += 1;
    }
  }

  saveProspects(
    currentProspects
  );

  console.log(
    `Evaluated: ${evaluatedCount}`
  );

  console.log(
    `Qualified: ${qualifiedCount}`
  );

  const crm =
    runProspectToCrm();

  console.log(
    `CRM created: ${crm.created || 0}`
  );

  console.log(
    `CRM duplicates: ${crm.duplicates || 0}`
  );

  return {
    success: true,
    status:
      "PIPELINE_COMPLETE",
    experimentId:
      resolvedExperimentId,
    discovery: {
      discovered:
        discovered.length,
      valid:
        discovery.validProspectCount ||
        0
    },
    ingestion: {
      normalized:
        ingestion.stats.normalized,
      duplicates:
        ingestion.stats.duplicates,
      rejected:
        ingestion.stats.rejected
    },
    qualification: {
      evaluated:
        evaluatedCount,
      qualified:
        qualifiedCount
    },
    crm: {
      created:
        crm.created || 0,
      duplicates:
        crm.duplicates || 0,
      status:
        crm.status
    }
  };
}

if (
  require.main === module
) {
  const service =
    process.argv[2] ||
    "commercial electrical maintenance";

  const location =
    process.argv[3] ||
    "Melbourne, Victoria";

  const targetCount =
    Number(
      process.argv[4] || 10
    );

  runDiscoveryToCrm({
    service,
    location,
    targetCount,
    offline: true
  })
    .then(
      result => {
        console.log(
          "\n=========================================="
        );

        console.log(
          "              FINAL RESULT"
        );

        console.log(
          "==========================================\n"
        );

        console.log(
          JSON.stringify(
            result,
            null,
            2
          )
        );
      }
    )
    .catch(
      error => {
        console.error(
          "\nPIPELINE ERROR:"
        );

        console.error(
          error.stack ||
          error.message ||
          error
        );

        process.exit(1);
      }
    );
}

module.exports = {
  createExperimentId,
  getProspectIdentity,
  runDiscoveryToCrm
};
