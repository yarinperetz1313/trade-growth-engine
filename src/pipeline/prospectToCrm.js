const {
  getProspects
} = require("../prospects/prospectIngestion");

const {
  saveQualifiedLeads
} = require("../prospects/prospectToLead");

const {
  listLeads
} = require("../leads/leadEngine");

function clean(value) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
}

function getLeadIdentity(item) {
  if (item?.website) {
    return `website:${clean(
      item.website
    )}`;
  }

  if (item?.email) {
    return `email:${clean(
      item.email
    )}`;
  }

  if (item?.phone) {
    return `phone:${clean(
      item.phone
    )}`;
  }

  return `business:${clean(
    item?.businessName
  )}|location:${clean(
    item?.location
  )}`;
}

function findExistingLead(
  leadData,
  existingLeads
) {
  const identity =
    getLeadIdentity(
      leadData
    );

  return (
    existingLeads.find(
      lead =>
        getLeadIdentity(
          lead
        ) === identity
    ) || null
  );
}

function buildQualifiedProspects(
  prospects
) {
  return (
    Array.isArray(prospects)
      ? prospects
      : []
  ).filter(
    prospect => {
      const qualification =
        prospect?.qualification
          ?.qualification;

      return (
        qualification === "HIGH" ||
        qualification === "MEDIUM"
      );
    }
  );
}

function runProspectToCrm() {
  const prospects =
    getProspects();

  const existingLeads =
    listLeads();

  const qualified =
    buildQualifiedProspects(
      prospects
    );

  const newProspects = [];
  const duplicates = [];

  for (
    const prospect of qualified
  ) {
    const existing =
      findExistingLead(
        prospect,
        existingLeads
      );

    if (existing) {
      duplicates.push({
        businessName:
          prospect.businessName,

        existingLeadId:
          existing.id,

        reason:
          "Matching CRM identity already exists."
      });

      continue;
    }

    newProspects.push(
      prospect
    );
  }

  if (
    newProspects.length === 0
  ) {
    return {
      success: true,

      status:
        "NO_NEW_LEADS",

      prospectsFound:
        prospects.length,

      qualified:
        qualified.length,

      newProspects: 0,

      duplicates:
        duplicates.length,

      created: 0,

      duplicateDetails:
        duplicates
    };
  }

  const result =
    saveQualifiedLeads(
      newProspects
    );

  return {
    success: true,

    status:
      "LEADS_CREATED",

    prospectsFound:
      prospects.length,

    qualified:
      qualified.length,

    newProspects:
      newProspects.length,

    duplicates:
      duplicates.length,

    created:
      result.createdLeads.length,

    createdLeads:
      result.createdLeads.map(
        lead => ({
          id:
            lead.id,

          businessName:
            lead.businessName,

          service:
            lead.service,

          qualificationScore:
            lead
              .qualification
              ?.qualificationScore
        })
      ),

    duplicateDetails:
      duplicates
  };
}

if (
  require.main === module
) {
  console.log(
    JSON.stringify(
      runProspectToCrm(),
      null,
      2
    )
  );
}

module.exports = {
  clean,
  getLeadIdentity,
  findExistingLead,
  buildQualifiedProspects,
  runProspectToCrm
};
