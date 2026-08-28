const {
  qualifyProspects
} = require("../prospects/prospectQualification");

const {
  createLead,
  saveLead
} = require("./leadEngine");

function buildLeadPipeline(
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

  const qualified =
    qualifyProspects(
      prospects
    );

  const leads = [];

  for (
    const prospect of qualified
  ) {
    const qualification =
      prospect.qualification;

    /*
      Only create a sales lead when the
      qualification engine says the prospect
      is sufficiently supported.

      This prevents weak or competitor records
      from entering the sales pipeline.
    */

    if (
      !qualification ||
      !qualification.qualified
    ) {
      continue;
    }

    const lead =
      createLead(
        prospect
      );

    const filePath =
      saveLead(
        lead
      );

    leads.push({
      ...lead,

      filePath
    });
  }

  return {
    success: true,

    prospectsReceived:
      prospects.length,

    prospectsQualified:
      qualified.filter(
        prospect =>
          prospect.qualification &&
          prospect.qualification
            .qualified
      ).length,

    leadsCreated:
      leads.length,

    leads
  };
}

module.exports = {
  buildLeadPipeline
};
