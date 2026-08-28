const {
  generateAIPersonalisation
} = require("./aiPersonalizer");

const {
  buildOutreachDraft
} = require("./outreachPersonalizer");

async function personaliseLead(
  lead
) {
  const ai =
    await generateAIPersonalisation(
      lead
    );

  if (
    ai.success
  ) {
    return {
      success: true,

      mode: "AI",

      personalisation:
        ai.result,

      generatedAt:
        ai.generatedAt
    };
  }

  return {
    success: false,

    mode: "FALLBACK",

    reason:
      ai.reason,

    personalisation:
      buildOutreachDraft({
        lead
      })
  };
}

async function personaliseLeads(
  leads
) {
  const results = [];

  for (
    const lead of
    leads || []
  ) {
    results.push({
      leadId:
        lead.id || null,

      businessName:
        lead.businessName ||
        lead.companyName ||
        null,

      ...(await personaliseLead(
        lead
      ))
    });
  }

  return results;
}

module.exports = {
  personaliseLead,
  personaliseLeads
};
