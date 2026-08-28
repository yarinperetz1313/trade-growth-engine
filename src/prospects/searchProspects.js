require("dotenv").config();

const OpenAI = require("openai");

const {
  adaptResearchResults
} = require("./researchAdapter");

const {
  saveResearchResults
} = require("./researchAdapter");

async function searchProspects({
  service,
  experimentId,
  location = "Melbourne, Victoria",
  targetCount = 50,
  offline = false
}) {
  if (!service) {
    throw new Error(
      "service is required"
    );
  }

  if (!experimentId) {
    throw new Error(
      "experimentId is required"
    );
  }

  /*
    Never fabricate prospects.

    Offline mode deliberately returns an empty
    result rather than pretending research exists.
  */

  if (offline) {
    return {
      success: true,

      offline: true,

      service,

      location,

      prospectCount: 0,

      prospects: [],

      message:
        "Offline mode: no live prospect research performed."
    };
  }

  if (
    !process.env.OPENAI_API_KEY
  ) {
    return {
      success: false,

      error:
        "OPENAI_API_KEY is not configured."
    };
  }

  const client =
    new OpenAI({
      apiKey:
        process.env.OPENAI_API_KEY
    });

  console.log(
    `\nSearching for real prospects for: ${service}`
  );

  console.log(
    `Location: ${location}`
  );

  console.log(
    `Target prospects: ${targetCount}`
  );

  /*
    Ask the web-enabled model to identify
    potential CUSTOMERS, not competitors.

    The model must provide evidence for every
    prospect and must not invent contact details.
  */

  let response;

  try {
    response =
      await client.responses.create({
      model: "gpt-5.6",

      tools: [
        {
          type: "web_search_preview"
        }
      ],

      input: `
You are a senior B2B prospect-research analyst.

Your task is to find REAL potential customers in:

${location}

for this service:

"${service}"

OBJECTIVE

Identify businesses or organisations that could
genuinely purchase this service.

This is PROSPECT research, not competitor research.

ACCURACY IS MORE IMPORTANT THAN QUANTITY.

STRICT RULES

1. NEVER invent a business.
2. NEVER invent a website.
3. NEVER invent a phone number.
4. NEVER invent an email address.
5. NEVER invent a location.
6. NEVER invent a business need.
7. NEVER claim a business is a prospect without
   evidence supporting the classification.
8. Do not infer a contact person's identity.
9. Do not fabricate evidence.
10. If information cannot be verified, use null.
11. Prefer official business websites and authoritative
    public sources.
12. Each prospect must have at least one source URL.
13. Do not include competitors simply because they operate
    in the same industry as the target service.
14. Do not include residential individuals.
15. Do not include businesses outside the requested location
    unless there is clear evidence that they operate there.
16. Deduplicate businesses.
17. Do not invent pricing, revenue, employee counts,
    customer counts or market share.

PROSPECT RELEVANCE

A business should only be included when public evidence
supports why it could reasonably need or purchase:

"${service}"

For each prospect, explain the evidence-based reason.

SEARCH STRATEGY

Search across multiple relevant categories where appropriate.

Examples may include:

- commercial property operators
- property management companies
- facilities management businesses
- commercial building operators
- industrial businesses
- retail operators
- hospitality operators
- warehouses
- manufacturing businesses
- body corporates / owners corporations
- construction or maintenance organisations

Only include categories that genuinely make sense for:

"${service}"

IMPORTANT

Do not assume every business in these categories is a prospect.

Look for evidence such as:

- commercial property portfolios
- facilities responsibilities
- multiple sites
- relevant operational infrastructure
- explicit maintenance responsibilities
- emergency service requirements
- relevant procurement or contractor information

OUTPUT

Return ONLY valid JSON.

Use exactly this structure:

{
  "prospects": [
    {
      "businessName": "string",
      "website": "string or null",
      "location": "string or null",
      "phone": "string or null",
      "email": "string or null",
      "industry": "string or null",
      "commercialRelevance": "Yes or No",
      "service": "${service}",
      "reason": "evidence-based explanation",
      "source": "web research",
      "sourceUrl": "string",
      "evidence": [
        "short evidence statement"
      ]
    }
  ]
}

TARGET

Find up to ${targetCount} strong prospects.

Quality is more important than reaching the target.

If fewer than ${targetCount} prospects can be verified,
return fewer.

Do NOT create placeholder businesses.
`
    });

  } catch (error) {
    if (
      error?.status === 429 ||
      error?.code === "credit_balance_exhausted" ||
      error?.code === "insufficient_quota" ||
      error?.error?.code === "credit_balance_exhausted" ||
      error?.error?.code === "insufficient_quota"
    ) {
      return {
        success: false,
        unavailable: true,
        reason: "RESEARCH_UNAVAILABLE",
        error:
          "OpenAI API credits are exhausted. No live prospect research was performed."
      };
    }

    return {
      success: false,
      unavailable: true,
      reason: "RESEARCH_ERROR",
      error:
        error?.message ||
        "Unknown research error."
    };
  }

  /*
    Extract the model's text output.
  */

  const outputText =
    response.output_text;

  if (!outputText) {
    return {
      success: false,

      error:
        "Research returned no text output."
    };
  }

  /*
    Parse JSON safely.

    We intentionally fail rather than attempting
    to repair malformed data with assumptions.
  */

  let parsed;

  try {
    parsed =
      JSON.parse(
        outputText
      );
  } catch (error) {
    return {
      success: false,

      error:
        "Research output was not valid JSON.",

      rawOutput:
        outputText
    };
  }

  if (
    !parsed ||
    !Array.isArray(
      parsed.prospects
    )
  ) {
    return {
      success: false,

      error:
        "Research output did not contain a valid prospects array."
    };
  }

  /*
    Convert research results into our internal
    prospect format.
  */

  const researchResults =
    parsed.prospects.map(
      prospect => ({
        businessName:
          prospect.businessName,

        website:
          prospect.website,

        location:
          prospect.location,

        phone:
          prospect.phone,

        email:
          prospect.email,

        industry:
          prospect.industry,

        commercialRelevance:
          prospect.commercialRelevance,

        service:
          prospect.service ||
          service,

        source:
          prospect.source ||
          "web research",

        sourceUrl:
          prospect.sourceUrl,

        notes:
          prospect.reason,

        evidence:
          Array.isArray(
            prospect.evidence
          )
            ? prospect.evidence
            : []
      })
    );

  /*
    Run our local validation,
    deduplication and scoring layer.
  */

  const batch =
    adaptResearchResults({
      experimentId,
      service,
      results:
        researchResults
    });

  /*
    Save the structured prospect dataset.
  */

  const filePath =
    saveResearchResults(
      batch
    );

  console.log(
    `✓ Prospect research saved: ${filePath}`
  );

  console.log(
    `✓ Verified prospects: ${batch.validProspectCount}`
  );

  return {
    success: true,

    offline: false,

    service,

    location,

    requestedCount:
      targetCount,

    rawResultCount:
      researchResults.length,

    prospectCount:
      batch.prospectCount,

    validProspectCount:
      batch.validProspectCount,

    prospects:
      batch.prospects,

    filePath
  };
}

module.exports = {
  searchProspects
};
