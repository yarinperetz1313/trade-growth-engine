const fs = require("fs");
const path = require("path");

const PROSPECTS_DIR =
  path.join(
    process.cwd(),
    "data",
    "prospects"
  );

const PROSPECTS_FILE =
  path.join(
    PROSPECTS_DIR,
    "prospects.json"
  );

function cleanString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUrl(value) {
  const url =
    cleanString(value);

  if (!url) {
    return "";
  }

  try {
    const parsed =
      new URL(
        url.startsWith("http")
          ? url
          : `https://${url}`
      );

    return (
      parsed.protocol +
      "//" +
      parsed.hostname.toLowerCase() +
      parsed.pathname.replace(
        /\/+$/,
        ""
      )
    );
  } catch {
    return url.toLowerCase();
  }
}

function normalizePhone(value) {
  return cleanString(
    value
  ).replace(
    /[^\d+]/g,
    ""
  );
}

function normalizeEmail(value) {
  return cleanString(
    value
  ).toLowerCase();
}

function buildDedupeKey(
  prospect
) {
  const website =
    normalizeUrl(
      prospect.website
    );

  if (website) {
    return `website:${website}`;
  }

  const email =
    normalizeEmail(
      prospect.email
    );

  if (email) {
    return `email:${email}`;
  }

  const phone =
    normalizePhone(
      prospect.phone
    );

  if (phone) {
    return `phone:${phone}`;
  }

  const name =
    cleanString(
      prospect.businessName ||
      prospect.name
    ).toLowerCase();

  const address =
    cleanString(
      prospect.address
    ).toLowerCase();

  return `identity:${name}|${address}`;
}

function normalizeProspect(
  raw = {},
  metadata = {}
) {
  const businessName =
    cleanString(
      raw.businessName ||
      raw.name ||
      raw.title
    );

  const website =
    normalizeUrl(
      raw.website ||
      raw.url ||
      raw.domain
    );

  const phone =
    normalizePhone(
      raw.phone ||
      raw.telephone
    );

  const email =
    normalizeEmail(
      raw.email
    );

  const address =
    cleanString(
      raw.address ||
      raw.formattedAddress
    );

  const category =
    cleanString(
      raw.category ||
      raw.industry
    );

  const service =
    cleanString(
      raw.service ||
      metadata.service
    );

  const profile =
    cleanString(
      raw.profile ||
      metadata.profile
    );

  const priority =
    cleanString(
      raw.priority ||
      metadata.priority
    ).toUpperCase();

  const normalized = {
    id:
      cleanString(
        raw.id
      ) ||
      `prospect_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    businessName,

    website,

    phone,

    email,

    address,

    category,

    industry:
      cleanString(
        raw.industry
      ),

    service,

    profile,

    priority,

    commercialRelevance:
      raw.commercialRelevance ||
      "",

    evidence:
      Array.isArray(
        raw.evidence
      )
        ? raw.evidence
        : [],

    qualification:
      raw.qualification ||
      null,

    source:
      cleanString(
        raw.source ||
        metadata.source
      ) || "unknown",

    sourceQuery:
      cleanString(
        raw.sourceQuery ||
        metadata.query
      ),

    sourceUrl:
      cleanString(
        raw.sourceUrl
      ),

    location:
      cleanString(
        raw.location ||
        metadata.location
      ),

    rawName:
      cleanString(
        raw.name
      ),

    rawTitle:
      cleanString(
        raw.title
      ),

    collectedAt:
      raw.collectedAt ||
      new Date().toISOString(),

    dedupeKey:
      ""
  };

  normalized.dedupeKey =
    buildDedupeKey(
      normalized
    );

  return normalized;
}

function validateProspect(
  prospect
) {
  const errors = [];

  if (
    !prospect.businessName
  ) {
    errors.push(
      "businessName is required"
    );
  }

  if (
    !prospect.website &&
    !prospect.phone &&
    !prospect.email &&
    !prospect.address
  ) {
    errors.push(
      "At least one identifying field is required"
    );
  }

  return {
    valid:
      errors.length === 0,

    errors
  };
}

function loadProspects() {
  if (
    !fs.existsSync(
      PROSPECTS_FILE
    )
  ) {
    return [];
  }

  try {
    const raw =
      fs.readFileSync(
        PROSPECTS_FILE,
        "utf8"
      );

    const parsed =
      JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch (error) {
    throw new Error(
      `Unable to load prospects: ${error.message}`
    );
  }
}

function saveProspects(
  prospects
) {
  fs.mkdirSync(
    PROSPECTS_DIR,
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    PROSPECTS_FILE,
    JSON.stringify(
      prospects,
      null,
      2
    )
  );

  return PROSPECTS_FILE;
}

function mergeProspects(
  existing,
  incoming
) {
  const merged = [
    ...existing
  ];

  const index =
    new Map();

  for (
    let i = 0;
    i < merged.length;
    i++
  ) {
    const key =
      merged[i].dedupeKey ||
      buildDedupeKey(
        merged[i]
      );

    if (key) {
      index.set(
        key,
        i
      );
    }
  }

  let added = 0;
  let updated = 0;
  let duplicates = 0;

  for (
    const prospect of incoming
  ) {
    const key =
      prospect.dedupeKey ||
      buildDedupeKey(
        prospect
      );

    if (
      index.has(key)
    ) {
      const existingIndex =
        index.get(key);

      merged[
        existingIndex
      ] = {
        ...merged[
          existingIndex
        ],
        ...prospect,

        id:
          merged[
            existingIndex
          ].id,

        dedupeKey:
          key
      };

      updated += 1;
      duplicates += 1;

      continue;
    }

    index.set(
      key,
      merged.length
    );

    merged.push(
      prospect
    );

    added += 1;
  }

  return {
    prospects:
      merged,

    stats: {
      added,
      updated,
      duplicates,
      total:
        merged.length
    }
  };
}

function ingestProspects(
  rawResults = [],
  metadata = {}
) {
  if (
    !Array.isArray(
      rawResults
    )
  ) {
    throw new Error(
      "rawResults must be an array"
    );
  }

  const normalized = [];
  const rejected = [];

  for (
    const raw of rawResults
  ) {
    const prospect =
      normalizeProspect(
        raw,
        metadata
      );

    const validation =
      validateProspect(
        prospect
      );

    if (
      !validation.valid
    ) {
      rejected.push({
        raw,
        errors:
          validation.errors
      });

      continue;
    }

    normalized.push(
      prospect
    );
  }

  const existing =
    loadProspects();

  const result =
    mergeProspects(
      existing,
      normalized
    );

  saveProspects(
    result.prospects
  );

  return {
    success: true,

    file:
      PROSPECTS_FILE,

    stats: {
      ...result.stats,

      normalized:
        normalized.length,

      rejected:
        rejected.length
    },

    rejected
  };
}

function getProspects() {
  return loadProspects();
}

module.exports = {
  cleanString,
  normalizeUrl,
  normalizePhone,
  normalizeEmail,
  buildDedupeKey,
  normalizeProspect,
  validateProspect,
  loadProspects,
  saveProspects,
  mergeProspects,
  ingestProspects,
  getProspects
};
