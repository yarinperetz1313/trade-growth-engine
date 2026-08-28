const {
  createLead,
  saveLead
} = require("../leads/leadEngine");

function isQualifiedProspect(
  prospect
) {
  if (
    !prospect ||
    !prospect.qualification
  ) {
    return false;
  }

  return (
    prospect.qualification.qualified ===
    true
  );
}

function buildLeadFromProspect(
  prospect
) {
  if (
    !isQualifiedProspect(
      prospect
    )
  ) {
    return null;
  }

  return {
    businessName:
      prospect.businessName,

    website:
      prospect.website || null,

    phone:
      prospect.phone || null,

    email:
      prospect.email || null,

    location:
      prospect.location || null,

    industry:
      prospect.industry || null,

    service:
      prospect.service || null,

    sourceUrl:
      prospect.sourceUrl || null,

    qualification: {
      qualified:
        prospect.qualification
          .qualified,

      qualification:
        prospect.qualification
          .qualification,

      qualificationScore:
        prospect.qualification
          .qualificationScore,

      reason:
        prospect.qualification
          .reason,

      scores:
        prospect.qualification
          .scores
    },

    evidence:
      prospect.evidence || [],

    notes:
      prospect.notes || null
  };
}

function convertQualifiedProspectsToLeads(
  prospects
) {
  if (
    !Array.isArray(
      prospects
    )
  ) {
    throw new Error(
      "prospects must be an array"
    );
  }

  const leads = [];
  const rejected = [];

  for (
    const prospect of prospects
  ) {
    const lead =
      buildLeadFromProspect(
        prospect
      );

    if (lead) {
      leads.push(
        lead
      );
    } else {
      rejected.push({
        businessName:
          prospect?.businessName ||
          "Unknown",

        reason:
          prospect?.qualification
            ?.reason ||
          "Prospect was not qualified."
      });
    }
  }

  return {
    leads,
    rejected,

    totalProspects:
      prospects.length,

    leadsCreated:
      leads.length,

    rejectedCount:
      rejected.length
  };
}

function saveQualifiedLeads(
  prospects
) {
  const result =
    convertQualifiedProspectsToLeads(
      prospects
    );

  const createdLeads = [];

  for (
    const leadData of result.leads
  ) {
    const lead =
      createLead(
        leadData
      );

    const filePath =
      saveLead(
        lead
      );

    createdLeads.push({
      ...lead,

      filePath
    });
  }

  return {
    ...result,

    createdLeads
  };
}

module.exports = {
  isQualifiedProspect,
  buildLeadFromProspect,
  convertQualifiedProspectsToLeads,
  saveQualifiedLeads
};

