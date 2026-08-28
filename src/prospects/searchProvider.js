require("dotenv").config();

const OpenAI = require("openai");

const client =
  process.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      })
    : null;

async function searchBusinesses({
  query,
  location = "Melbourne, Victoria",
  limit = 20
}) {
  if (!query) {
    throw new Error(
      "query is required"
    );
  }

  if (!client) {
    return {
      success: false,

      configured: false,

      error:
        "OPENAI_API_KEY is not configured."
    };
  }

  try {
    const prompt = `
Find real businesses that may be potential customers for:

SERVICE:
${query}

LOCATION:
${location}

Return up to ${limit} relevant businesses.

Important rules:

1. Only return real businesses.
2. Do not invent businesses.
3. Do not invent phone numbers, emails,
   websites, addresses, or other facts.
4. Every business must have a source URL.
5. Prefer businesses that appear commercially
   relevant to the service.
6. Exclude obvious competitors where possible.
7. Evidence must explain why the business may
   need the service.
8. If information cannot be verified, leave the
   field null rather than guessing.

Return JSON only in this structure:

{
  "results": [
    {
      "businessName": "...",
      "website": null,
      "phone": null,
      "email": null,
      "location": "...",
      "industry": "...",
      "commercialRelevance": "high|medium|low|null",
      "evidence": [
        "..."
      ],
      "sourceUrl": "...",
      "notes": "..."
    }
  ]
}
`;

    const response =
      await client.responses.create({
        model: "gpt-5.6-luna",

        tools: [
          {
            type: "web_search"
          }
        ],

        input: prompt
      });

    const text =
      response.output_text || "";

    let parsed;

    try {
      parsed =
        JSON.parse(text);
    } catch (error) {
      return {
        success: false,

        configured: true,

        error:
          "The search model did not return valid JSON.",

        raw:
          text.slice(0, 10000)
      };
    }

    const results =
      Array.isArray(
        parsed.results
      )
        ? parsed.results
        : [];

    return {
      success: true,

      configured: true,

      query,

      location,

      results:
        results.slice(0, limit)
    };
  } catch (error) {
    return {
      success: false,

      configured: true,

      error:
        error.message
    };
  }
}

module.exports = {
  searchBusinesses
};
