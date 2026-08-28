const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function analyzeCompetitors(service, location = "Melbourne, Victoria, Australia") {
  const response = await client.responses.create({
    model: "gpt-5.6",
    input: `
You are a competitive-market research analyst.

Research target:
Service: ${service}
Location: ${location}

Your job is to identify what competitor evidence would be required
to evaluate this service commercially.

IMPORTANT RULES:
- Do not invent competitor names.
- Do not invent prices.
- Do not invent review counts.
- Do not invent market share.
- Do not invent search volume.
- Clearly separate verified information from hypotheses.
- If information cannot be verified, say "Insufficient evidence."

Return:

1. Competitor types we should investigate
2. Search queries we should use
3. Information we should collect from each competitor
4. Competitive factors to compare
5. What evidence would indicate a strong opportunity
6. What evidence would indicate a saturated market

Keep the analysis specific to Melbourne.
`,
  });

  return response.output_text;
}

module.exports = {
  analyzeCompetitors,
};
