const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function analyzeMarket({ services, research }) {
  const marketData = services
    .map(
      (service) => `
SERVICE: ${service.name}
CATEGORY: ${service.category}
URGENCY: ${service.urgency}/10
CUSTOMER VALUE: ${service.customerValue}/10
COMPETITION: ${service.competition}/10
REPEAT POTENTIAL: ${service.repeatPotential}/10
OPERATIONAL FIT: ${service.operationalFit}/10
OPPORTUNITY SCORE: ${service.opportunityScore}/10
`
    )
    .join("\n");

  const researchData = research
    .map(
      (item) => `
SOURCE: ${item.url}
SUCCESS: ${item.success}
CONTENT:
${item.text || item.error || "No content available"}
`
    )
    .join("\n");

  const response = await client.responses.create({
    model: "gpt-5.6",

    input: `
You are a market intelligence analyst.

We are researching the Melbourne electrical-services market
for a customer-acquisition business.

Below are:

1. Preliminary opportunity scores.
2. Publicly retrieved web evidence.

IMPORTANT RULES:

- Never invent statistics.
- Never invent search volume.
- Never invent CPC.
- Never invent conversion rates.
- Never invent revenue.
- Never invent market size.
- Never claim that a hypothesis is verified.
- Clearly distinguish FACTS from HYPOTHESES.
- If the supplied evidence does not answer something, say:
  "Insufficient evidence."
- Treat website content as evidence, not automatically as truth.
- Identify the source supporting important factual claims.

PRELIMINARY OPPORTUNITY DATA:

${marketData}

PUBLIC WEB RESEARCH:

${researchData}

Produce:

## 1. MARKET OBSERVATIONS

List factual observations supported by the supplied sources.

## 2. OPPORTUNITY ANALYSIS

Explain which services appear promising based on the supplied
scoring framework and evidence.

## 3. EVIDENCE GAPS

Explain what we still don't know.

## 4. COMPETITIVE SIGNALS

Identify any evidence of competition, positioning,
service offerings, or market structure.

## 5. NEXT DATA REQUIRED

Give the most important data we should obtain next.

## 6. PRELIMINARY RECOMMENDATION

Choose the strongest candidate ONLY if the evidence supports
doing so.

If evidence is insufficient, explicitly say that a decision
cannot yet be made.
`,
  });

  return response.output_text;
}

module.exports = {
  analyzeMarket,
};
