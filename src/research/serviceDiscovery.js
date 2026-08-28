const { analyzeMarket } = require("../ai/analyzeMarket");

async function discoverServices(market) {
  const promptMarket = `
Market: ${market}

Identify the major commercially relevant services in this market.

Return ONLY valid JSON:

{
  "services": [
    {
      "service": "",
      "customerTypes": [],
      "reasoning": ""
    }
  ]
}

Rules:
- Do not invent statistics.
- Do not provide search volume.
- Do not provide CPC.
- Do not provide revenue figures.
- Focus on real service categories.
- Return JSON only.
`;

  const OpenAI = require("openai");

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.responses.create({
    model: "gpt-5.6",
    input: promptMarket,
  });

  const text = response.output_text.trim();

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("Service discovery returned invalid JSON:");
    console.error(text);
    throw error;
  }
}

module.exports = {
  discoverServices,
};
