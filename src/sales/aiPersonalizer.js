const {
  buildPersonalisationContext
} = require("./outreachPersonalizer");

function getOpenAI() {
  if (
    !process.env.OPENAI_API_KEY
  ) {
    return null;
  }

  try {
    const OpenAI =
      require("openai");

    return new OpenAI({
      apiKey:
        process.env.OPENAI_API_KEY
    });
  } catch {
    return null;
  }
}

function buildPrompt(
  lead
) {
  const context =
    buildPersonalisationContext(
      lead
    );

  return `
You are a B2B sales personalisation
assistant.

Create a concise, factual outreach
draft for this business.

IMPORTANT:
- Never invent facts.
- Only use information contained
  in the supplied lead data.
- Do not claim that the business has
  a problem unless the evidence says so.
- Do not fabricate employees,
  revenue, customers, projects,
  locations, or technology.
- Do not pretend you visited a website
  unless website evidence is provided.
- Keep the message professional and
  non-spammy.
- The objective is to start a
  conversation, not force a sale.

BUSINESS DATA:

Business:
${context.businessName}

Service:
${context.service}

Location:
${context.location}

Website:
${context.website}

Evidence:
${context.evidence.join("\n")}

Return JSON with exactly:

{
  "subject": "...",
  "opening": "...",
  "body": "...",
  "personalisationReason": "...",
  "evidenceUsed": ["..."]
}
`;
}

function parseJSON(
  text
) {
  const cleaned =
    String(text || "")
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();

  return JSON.parse(
    cleaned
  );
}

async function generateAIPersonalisation(
  lead
) {
  const client =
    getOpenAI();

  if (!client) {
    return {
      success: false,

      reason:
        "OPENAI_API_KEY or OpenAI SDK unavailable.",

      fallback:
        true
    };
  }

  const prompt =
    buildPrompt(
      lead
    );

  try {
    const response =
      await client.responses.create({
        model:
          process.env.OPENAI_MODEL ||
          "gpt-5-mini",

        input: prompt
      });

    const text =
      response.output_text ||
      "";

    const result =
      parseJSON(
        text
      );

    return {
      success: true,

      fallback: false,

      result,

      generatedAt:
        new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,

      fallback: true,

      reason:
        error.message ||
        "AI personalisation failed."
    };
  }
}

module.exports = {
  buildPrompt,
  generateAIPersonalisation
};
