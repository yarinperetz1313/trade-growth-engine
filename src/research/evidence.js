function createEvidence({
  source,
  title,
  url,
  claim,
  category,
}) {
  return {
    source,
    title,
    url,
    claim,
    category,
    collectedAt: new Date().toISOString(),
  };
}

module.exports = {
  createEvidence,
};
