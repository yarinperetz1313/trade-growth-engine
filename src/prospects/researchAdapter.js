const {
  buildDiscoveryBatch,
  saveDiscoveryBatch
} = require("./prospectDiscovery");

/*
  Converts verified external research results into
  the prospect discovery format.

  This module deliberately does not search for or
  invent businesses itself.

  The input must contain real research results.
*/

function adaptResearchResults({
  experimentId,
  service,
  results = []
}) {
  if (!experimentId) {
    throw new Error(
      "experimentId is required"
    );
  }

  if (!service) {
    throw new Error(
      "service is required"
    );
  }

  if (!Array.isArray(results)) {
    throw new Error(
      "results must be an array"
    );
  }

  const adapted =
    results
      .filter(result =>
        result &&
        typeof result === "object"
      )
      .map(result => ({
        businessName:
          result.businessName ||
          result.name ||
          null,

        website:
          result.website ||
          result.url ||
          null,

        location:
          result.location ||
          null,

        phone:
          result.phone ||
          null,

        email:
          result.email ||
          null,

        source:
          result.source ||
          "research",

        sourceUrl:
          result.sourceUrl ||
          result.url ||
          null,

        service:
          result.service ||
          service,

        industry:
          result.industry ||
          null,

        commercialRelevance:
          result.commercialRelevance ??
          "Unclear",

        notes:
          result.notes ||
          null,

        evidence:
          Array.isArray(result.evidence)
            ? result.evidence
            : []
      }));

  return buildDiscoveryBatch({
    experimentId,
    service,
    discoveryResults:
      adapted
  });
}

function saveResearchResults(
  batch
) {
  return saveDiscoveryBatch(
    batch
  );
}

module.exports = {
  adaptResearchResults,
  saveResearchResults
};
