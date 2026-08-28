require("dotenv").config();

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const CACHE_DIR = path.join(
  process.cwd(),
  "data",
  "competitor-cache"
);

function safeFilename(service) {
  return service
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getCachePath(service) {
  return path.join(
    CACHE_DIR,
    `${safeFilename(service)}.json`
  );
}

function loadCachedResearch(service) {
  const cachePath = getCachePath(service);

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(cachePath, "utf8")
    );
  } catch (error) {
    console.error(
      `⚠ Failed to read cache for ${service}`
    );

    return null;
  }
}

function saveCachedResearch(service, data) {
  fs.mkdirSync(CACHE_DIR, {
    recursive: true
  });

  fs.writeFileSync(
    getCachePath(service),
    JSON.stringify(data, null, 2)
  );
}

/*
==================================================
OFFLINE / CACHE-FIRST RESEARCH ENGINE
==================================================

Important:

Offline mode MUST NEVER initialise the OpenAI
client and MUST NEVER make an API request.

This allows us to develop the rest of the system
without spending API credits.
*/

async function searchCompetitors(
  service,
  options = {}
) {
  const {
    offline = false,
    forceRefresh = false
  } = options;

  /*
  ================================================
  1. CACHE LOOKUP
  ================================================
  */

  if (!forceRefresh) {
    const cached = loadCachedResearch(service);

    if (cached) {
      console.log(
        "✓ Using cached competitor research"
      );

      return cached;
    }
  }

  /*
  ================================================
  2. HARD OFFLINE PROTECTION
  ================================================
  */

  if (offline) {
    return {
      success: false,

      error:
        "Offline mode enabled and no cached research exists.",

      service,

      metadata: {
        cached: false,
        offline: true,
        generatedAt:
          new Date().toISOString()
      },

      competitors: []
    };
  }

  /*
  ================================================
  3. LIVE API CLIENT
  ================================================
  */

  if (!process.env.OPENAI_API_KEY) {
    return {
      success: false,

      error:
        "OPENAI_API_KEY is missing. Live research cannot run.",

      service,

      competitors: [],

      metadata: {
        cached: false,
        offline: false,
        generatedAt:
          new Date().toISOString()
      }
    };
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  /*
  ================================================
  4. LIVE COMPETITOR RESEARCH
  ================================================
  */

  const response =
    await client.responses.create({

      model: "gpt-5.6",

      tools: [
        {
          type: "web_search_preview"
        }
      ],

      input: `
You are a senior competitive intelligence researcher.

Research the Melbourne, Victoria market for:

"${service}"

OBJECTIVE

Identify REAL businesses that appear to compete for this
specific service.

This research will be used by a business opportunity engine.
Accuracy is more important than producing a large number
of competitors.

CORE RULES

1. NEVER invent a business.
2. NEVER invent prices.
3. NEVER invent customer numbers.
4. NEVER invent market share.
5. NEVER invent revenue.
6. NEVER estimate market share.
7. NEVER manufacture response times.
8. NEVER manufacture maintenance contracts.
9. NEVER manufacture commercial customer evidence.
10. Prefer primary sources.
11. Prefer official company websites.
12. Focus specifically on Melbourne/Victoria.
13. Do not count directories as competitors.
14. Do not count duplicate businesses.
15. Do not count franchises multiple times.
16. If evidence is insufficient use "Unclear" or "Not found".
17. Every important classification should have evidence.
18. Return ONLY valid JSON.
19. No Markdown.
20. No commentary outside JSON.

Find approximately 10 strong competitors if sufficient
evidence exists.

For each competitor determine:

- business name
- official website
- location
- relevant services
- commercial focus
- emergency service
- maintenance contracts
- service area
- response time
- public pricing
- commercial customer evidence
- certifications
- evidence
- sources
- confidence

Return exactly:

{
  "service": "${service}",
  "researchDate": "YYYY-MM-DD",

  "researchQuality": {
    "overallConfidence": "High | Medium | Low",
    "competitorDiscoveryLimitations": [],
    "importantCaveats": []
  },

  "competitors": [
    {
      "name": "Business name",
      "website": "Official website or Not found",
      "location": "Verified Melbourne/Victoria location or Not found",

      "services": [],

      "commercialFocus": "Yes | No | Unclear",
      "emergencyService": "Yes | No | Unclear",
      "maintenanceContracts": "Yes | No | Unclear",

      "serviceArea": "Verified service area or Not found",
      "responseTime": "Verified response time or Not found",

      "pricingPubliclyDisclosed": "Yes | No | Unclear",
      "publicPricing": "Verified pricing or Not found",

      "commercialCustomers": "Verified evidence or Not found",

      "certifications": [],

      "evidence": {
        "service": [],
        "commercialFocus": [],
        "emergencyService": [],
        "maintenanceContracts": [],
        "responseTime": [],
        "pricing": [],
        "commercialCustomers": [],
        "certifications": []
      },

      "sources": [],

      "confidence": "High | Medium | Low"
    }
  ],

  "summary": {
    "competitorCountFound": 0,
    "commercialFocusedCount": 0,
    "maintenanceContractCount": 0,
    "emergencyServiceCount": 0,
    "pricingDisclosedCount": 0,
    "numericalResponseTimeCount": 0
  },

  "positioningThemes": [],
  "potentialGaps": [],
  "unverifiedInformation": []
}

IMPORTANT:

The summary numbers must be calculated from the actual
competitor records.

Do not count Unclear as Yes.

Do not count Not found as Yes.

Only include businesses with evidence that they genuinely
operate in or serve Melbourne/Victoria and provide services
relevant to "${service}".

Potential gaps must describe observed market evidence,
not guaranteed opportunities.

Return JSON only.
`
    });

  /*
  ================================================
  5. PARSE RESPONSE
  ================================================
  */

  const raw = response.output_text;

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      "⚠ Failed to parse competitor research JSON."
    );

    console.error(raw);

    return {
      success: false,

      error:
        "Competitor research returned invalid JSON.",

      raw,

      service
    };
  }

  /*
  ================================================
  6. NORMALISE COMPETITOR DATA
  ================================================
  */

  const competitors =
    Array.isArray(parsed.competitors)
      ? parsed.competitors
      : [];

  /*
  Remove duplicate businesses/domains.
  */

  const seenNames = new Set();
  const seenWebsites = new Set();

  parsed.competitors = competitors.filter(
    competitor => {

      const name =
        String(
          competitor.name || ""
        )
          .trim()
          .toLowerCase();

      const website =
        String(
          competitor.website || ""
        )
          .trim()
          .toLowerCase();

      if (!name) {
        return false;
      }

      if (
        seenNames.has(name)
      ) {
        return false;
      }

      if (
        website &&
        website !== "not found" &&
        seenWebsites.has(website)
      ) {
        return false;
      }

      seenNames.add(name);

      if (
        website &&
        website !== "not found"
      ) {
        seenWebsites.add(website);
      }

      return true;
    }
  );

  /*
  ================================================
  7. RECALCULATE SUMMARY LOCALLY
  ================================================
  */

  const finalCompetitors =
    parsed.competitors;

  const summary = {

    competitorCountFound:
      finalCompetitors.length,

    commercialFocusedCount:
      finalCompetitors.filter(
        c =>
          c.commercialFocus === "Yes"
      ).length,

    maintenanceContractCount:
      finalCompetitors.filter(
        c =>
          c.maintenanceContracts === "Yes"
      ).length,

    emergencyServiceCount:
      finalCompetitors.filter(
        c =>
          c.emergencyService === "Yes"
      ).length,

    pricingDisclosedCount:
      finalCompetitors.filter(
        c =>
          c.pricingPubliclyDisclosed === "Yes"
      ).length,

    numericalResponseTimeCount:
      finalCompetitors.filter(
        c =>
          typeof c.responseTime === "string" &&
          /\d/.test(c.responseTime)
      ).length
  };

  parsed.summary = summary;

  /*
  ================================================
  8. METADATA
  ================================================
  */

  parsed.metadata = {
    cached: false,
    offline: false,
    generatedAt:
      new Date().toISOString()
  };

  /*
  ================================================
  9. SAVE CACHE
  ================================================
  */

  saveCachedResearch(
    service,
    parsed
  );

  console.log(
    "✓ Fresh competitor research cached"
  );

  return parsed;
}

module.exports = {
  searchCompetitors
};
