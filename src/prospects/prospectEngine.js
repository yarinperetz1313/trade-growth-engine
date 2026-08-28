const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(
  process.cwd(),
  "data",
  "leads"
);

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

function clean(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text = String(value).trim();

  return text.length > 0
    ? text
    : null;
}

function normaliseWebsite(website) {
  const value = clean(website);

  if (!value) {
    return null;
  }

  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function normaliseBusinessName(name) {
  const value = clean(name);

  if (!value) {
    return null;
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createProspect(data = {}) {
  const businessName =
    clean(data.businessName);

  if (!businessName) {
    throw new Error(
      "businessName is required"
    );
  }

  return {
    id:
      data.id ||
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    createdAt:
      new Date().toISOString(),

    businessName,

    normalizedBusinessName:
      normaliseBusinessName(
        businessName
      ),

    website:
      clean(data.website),

    normalizedWebsite:
      normaliseWebsite(
        data.website
      ),

    location:
      clean(data.location),

    phone:
      clean(data.phone),

    email:
      clean(data.email),

    source:
      clean(data.source) ||
      "unknown",

    sourceUrl:
      clean(data.sourceUrl),

    service:
      clean(data.service),

    industry:
      clean(data.industry),

    commercialRelevance:
      data.commercialRelevance ??
      "Unclear",

    prospectScore:
      Number.isFinite(
        Number(data.prospectScore)
      )
        ? Number(data.prospectScore)
        : null,

    status:
      clean(data.status) ||
      "PROSPECT",

    notes:
      clean(data.notes),

    evidence:
      Array.isArray(data.evidence)
        ? data.evidence
        : []
  };
}

function deduplicateProspects(
  prospects
) {
  const unique = [];
  const seenNames =
    new Set();
  const seenWebsites =
    new Set();

  for (
    const prospect of prospects
  ) {
    if (!prospect) {
      continue;
    }

    const name =
      prospect.normalizedBusinessName ||
      normaliseBusinessName(
        prospect.businessName
      );

    const website =
      prospect.normalizedWebsite ||
      normaliseWebsite(
        prospect.website
      );

    if (
      website &&
      seenWebsites.has(website)
    ) {
      continue;
    }

    if (
      name &&
      seenNames.has(name)
    ) {
      continue;
    }

    if (website) {
      seenWebsites.add(
        website
      );
    }

    if (name) {
      seenNames.add(name);
    }

    unique.push(
      prospect
    );
  }

  return unique;
}

function scoreProspect(
  prospect
) {
  let score = 0;

  const reasons = [];

  if (
    prospect.businessName
  ) {
    score += 1;
    reasons.push(
      "Verified business name"
    );
  }

  if (
    prospect.website
  ) {
    score += 1;
    reasons.push(
      "Website identified"
    );
  }

  if (
    prospect.location
  ) {
    score += 2;
    reasons.push(
      "Location identified"
    );
  }

  if (
    prospect.phone
  ) {
    score += 2;
    reasons.push(
      "Phone number identified"
    );
  }

  if (
    prospect.email
  ) {
    score += 2;
    reasons.push(
      "Email identified"
    );
  }

  if (
    prospect.service
  ) {
    score += 1;
    reasons.push(
      "Relevant service identified"
    );
  }

  if (
    prospect.commercialRelevance ===
    "Yes"
  ) {
    score += 1;
    reasons.push(
      "Commercial relevance verified"
    );
  }

  return {
    score,
    maxScore: 10,
    percentage:
      score * 10,
    reasons
  };
}

function rankProspects(
  prospects
) {
  return prospects
    .map(prospect => {
      const scoring =
        scoreProspect(
          prospect
        );

      return {
        ...prospect,

        prospectScore:
          scoring.score,

        prospectScorePercentage:
          scoring.percentage,

        scoreReasons:
          scoring.reasons
      };
    })
    .sort(
      (a, b) =>
        b.prospectScore -
        a.prospectScore
    );
}

function validateProspect(
  prospect
) {
  const problems = [];

  if (
    !prospect.businessName
  ) {
    problems.push(
      "Missing business name"
    );
  }

  if (
    !prospect.location
  ) {
    problems.push(
      "Missing location"
    );
  }

  if (
    !prospect.service
  ) {
    problems.push(
      "Missing target service"
    );
  }

  if (
    !prospect.website &&
    !prospect.phone &&
    !prospect.email
  ) {
    problems.push(
      "No contact route identified"
    );
  }

  return {
    valid:
      problems.length === 0,

    problems
  };
}

function createProspectList({
  experimentId,
  service,
  prospects = []
}) {
  if (!experimentId) {
    throw new Error(
      "experimentId is required"
    );
  }

  if (!service) {
    throw new Error(
      "service is required"
    );
  }

  const prepared =
    prospects.map(
      prospect =>
        createProspect({
          ...prospect,
          service:
            prospect.service ||
            service
        })
    );

  const unique =
    deduplicateProspects(
      prepared
    );

  const ranked =
    rankProspects(
      unique
    );

  const validation =
    ranked.map(
      prospect => ({
        id: prospect.id,

        businessName:
          prospect.businessName,

        ...validateProspect(
          prospect
        )
      })
    );

  return {
    experimentId,

    service,

    createdAt:
      new Date().toISOString(),

    targetMarket:
      "Melbourne, Victoria",

    prospectCount:
      ranked.length,

    validProspectCount:
      validation.filter(
        item => item.valid
      ).length,

    prospects:
      ranked,

    validation
  };
}

function saveProspectList(
  prospectList
) {
  ensureDataDir();

  if (
    !prospectList ||
    !prospectList.experimentId
  ) {
    throw new Error(
      "Valid prospect list required"
    );
  }

  const safeService =
    String(
      prospectList.service
    )
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-|-$/g,
        ""
      );

  const filename =
    `${safeService}-${prospectList.experimentId}.json`;

  const filePath =
    path.join(
      DATA_DIR,
      filename
    );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      prospectList,
      null,
      2
    )
  );

  return filePath;
}

module.exports = {
  createProspect,
  deduplicateProspects,
  scoreProspect,
  rankProspects,
  validateProspect,
  createProspectList,
  saveProspectList
};
