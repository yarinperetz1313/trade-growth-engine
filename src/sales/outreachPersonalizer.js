function clean(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function getBusinessName(lead) {
  return (
    clean(lead.businessName) ||
    clean(lead.companyName) ||
    "your business"
  );
}

function getService(lead) {
  return (
    clean(lead.service) ||
    clean(lead.targetService) ||
    "your services"
  );
}

function getEvidence(lead) {
  const evidence = [];

  if (lead.website) {
    evidence.push(
      `Website: ${clean(lead.website)}`
    );
  }

  if (lead.location) {
    evidence.push(
      `Location: ${clean(lead.location)}`
    );
  }

  if (lead.qualification?.reason) {
    evidence.push(
      `Qualification: ${clean(
        lead.qualification.reason
      )}`
    );
  }

  if (lead.intelligence?.reason) {
    evidence.push(
      `Intelligence: ${clean(
        lead.intelligence.reason
      )}`
    );
  }

  return evidence;
}

function buildPersonalisationContext(
  lead
) {
  return {
    businessName:
      getBusinessName(lead),

    service:
      getService(lead),

    location:
      clean(lead.location),

    website:
      clean(lead.website),

    evidence:
      getEvidence(lead)
  };
}

function buildOutreachDraft({
  lead,
  tone = "professional"
}) {
  const context =
    buildPersonalisationContext(
      lead
    );

  const opening =
    context.businessName ===
    "your business"
      ? "Hi there,"
      : `Hi ${context.businessName} team,`;

  const locationLine =
    context.location
      ? `I came across your business in ${context.location} and wanted to reach out.`
      : "I came across your business and wanted to reach out.";

  const serviceLine =
    context.service &&
    context.service !==
      "your services"
      ? `We help businesses with ${context.service}.`
      : "We help businesses improve their operations and generate more opportunities.";

  const body =
    [
      opening,
      "",
      locationLine,
      serviceLine,
      "",
      "If this is relevant, I'd be happy to have a quick conversation and see whether there's a fit.",
      "",
      "Would you be open to a quick chat?"
    ].join("\n");

  return {
    channel: "email",

    tone,

    subject:
      `Quick question for ${context.businessName}`,

    body,

    personalisation:
      context,

    generatedAt:
      new Date().toISOString()
  };
}

module.exports = {
  buildPersonalisationContext,
  buildOutreachDraft
};
