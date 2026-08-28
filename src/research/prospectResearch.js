const {
  createDiscoveryRun
} = require("../prospects/prospectDiscovery");

const {
  runProspectPipeline
} = require("../prospects/prospectPipeline");

const {
  saveQualifiedLeads
} = require("../prospects/prospectToLead");

function validateResearchResult(
  result
) {
  if (!result) {
    return false;
  }

  if (
    !result.businessName
  ) {
    return false;
  }

  if (
    !result.sourceUrl
  ) {
    return false;
  }

  return true;
}

function normalizeResearchResult(
  result,
  service
) {
  if (
    !validateResearchResult(
      result
    )
  ) {
    return null;
  }

  return {
    businessName:
      result.businessName,

    website:
      result.website || null,

    phone:
      result.phone || null,

    email:
      result.email || null,

    location:
      result.location || null,

    industry:
      result.industry || null,

    service:
      result.service ||
      service,

    commercialRelevance:
      result.commercialRelevance ||
      null,

    evidence:
      Array.isArray(
        result.evidence
      )
        ? result.evidence
        : [],

    sourceUrl:
      result.sourceUrl,

    notes:
      result.notes || null
  };
}

function normalizeResearchResults(
  results,
  service
) {
  if (
    !Array.isArray(
      results
    )
  ) {
    throw new Error(
      "Research results must be an array."
    );
  }

  return results
    .map(
      result =>
        normalizeResearchResult(
          result,
          service
        )
    )
    .filter(Boolean);
}

function processResearchResults({
  service,
  targetProfiles = [],
  locations = [],
  industries = [],
  results = []
}) {
  const normalizedResults =
    normalizeResearchResults(
      results,
      service
    );

  const discovery =
    createDiscoveryRun({
      service,
      targetProfiles,
      locations,
      industries,
      prospects:
        normalizedResults
    });

  const pipeline =
    runProspectPipeline(
      discovery.prospects
    );

  const crm =
    saveQualifiedLeads(
      pipeline.prospects
    );

  return {
    service,

    discovery: {
      prospectsFound:
        discovery.prospectsFound,

      uniqueProspects:
        discovery.uniqueProspects
    },

    qualification: {
      total:
        pipeline.totalProspects,

      high:
        pipeline.highPriority,

      medium:
        pipeline.mediumPriority,

      low:
        pipeline.lowPriority,

      excluded:
        pipeline.excluded
    },

    crm: {
      leadsCreated:
        crm.leadsCreated,

      rejected:
        crm.rejectedCount,

      createdLeads:
        crm.createdLeads
    }
  };
}

module.exports = {
  validateResearchResult,
  normalizeResearchResult,
  normalizeResearchResults,
  processResearchResults
};
