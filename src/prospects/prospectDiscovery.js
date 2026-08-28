const fs = require("fs");
const path = require("path");

const DISCOVERY_DIR = path.join(
  process.cwd(),
  "data",
  "prospects"
);

function ensureDirectory() {
  fs.mkdirSync(
    DISCOVERY_DIR,
    {
      recursive: true
    }
  );
}

function normalizeText(value) {
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

function buildSearchPlan({
  service,
  targetProfiles = [],
  locations = [],
  industries = []
}) {
  if (!service) {
    throw new Error(
      "service is required"
    );
  }

  const normalizedProfiles =
    Array.isArray(targetProfiles)
      ? targetProfiles
      : [];

  const normalizedLocations =
    Array.isArray(locations)
      ? locations
      : [];

  const normalizedIndustries =
    Array.isArray(industries)
      ? industries
      : [];

  const queries = [];

  for (
    const profile of normalizedProfiles
  ) {
    for (
      const location of normalizedLocations
    ) {
      queries.push(
        `${profile} ${service} ${location}`
      );
    }
  }

  for (
    const industry of normalizedIndustries
  ) {
    for (
      const location of normalizedLocations
    ) {
      queries.push(
        `${industry} ${service} ${location}`
      );
    }
  }

  return {
    service,

    targetProfiles:
      normalizedProfiles,

    locations:
      normalizedLocations,

    industries:
      normalizedIndustries,

    queries: [
      ...new Set(
        queries.map(
          query =>
            query.trim()
        )
      )
    ]
  };
}

function normalizeProspect(
  prospect,
  service
) {
  if (!prospect) {
    return null;
  }

  const businessName =
    prospect.businessName ||
    prospect.name ||
    null;

  if (!businessName) {
    return null;
  }

  return {
    businessName,

    website:
      prospect.website ||
      null,

    phone:
      prospect.phone ||
      null,

    email:
      prospect.email ||
      null,

    location:
      prospect.location ||
      null,

    industry:
      prospect.industry ||
      null,

    service:
      prospect.service ||
      service,

    commercialRelevance:
      prospect.commercialRelevance ||
      null,

    evidence:
      Array.isArray(
        prospect.evidence
      )
        ? prospect.evidence
        : [],

    sourceUrl:
      prospect.sourceUrl ||
      null,

    notes:
      prospect.notes ||
      null
  };
}

function deduplicateProspects(
  prospects
) {
  const seen = new Set();
  const result = [];

  for (
    const prospect of prospects
  ) {
    if (!prospect) {
      continue;
    }

    const key =
      normalizeText(
        prospect.website
      ) ||
      normalizeText(
        prospect.businessName
      );

    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(
      prospect
    );
  }

  return result;
}

function saveDiscoveryRun(
  result
) {
  ensureDirectory();

  const filename =
    `discovery-${Date.now()}.json`;

  const filePath =
    path.join(
      DISCOVERY_DIR,
      filename
    );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return filePath;
}

function createDiscoveryRun({
  service,
  targetProfiles = [],
  locations = [],
  industries = [],
  prospects = []
}) {
  const searchPlan =
    buildSearchPlan({
      service,
      targetProfiles,
      locations,
      industries
    });

  const normalizedProspects =
    prospects
      .map(
        prospect =>
          normalizeProspect(
            prospect,
            service
          )
      )
      .filter(Boolean);

  const uniqueProspects =
    deduplicateProspects(
      normalizedProspects
    );

  const result = {
    createdAt:
      new Date().toISOString(),

    service,

    searchPlan,

    prospectsFound:
      normalizedProspects.length,

    uniqueProspects:
      uniqueProspects.length,

    prospects:
      uniqueProspects
  };

  const filePath =
    saveDiscoveryRun(
      result
    );

  return {
    ...result,

    filePath
  };
}

module.exports = {
  normalizeText,
  buildSearchPlan,
  normalizeProspect,
  deduplicateProspects,
  saveDiscoveryRun,
  createDiscoveryRun
};
