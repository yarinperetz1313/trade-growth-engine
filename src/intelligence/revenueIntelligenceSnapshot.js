const {
  readCollectionReadOnly
} = require("../services/localStore");
const {
  buildDealIntelligenceFromData
} = require("./dealIntelligence");
const {
  buildRevenueIntelligence
} = require("./revenueIntelligence");

function getRevenueIntelligenceSnapshot({
  generatedAt = new Date().toISOString()
} = {}) {
  const prospects = readCollectionReadOnly("prospects");
  const opportunities = readCollectionReadOnly("opportunities");
  const activities = readCollectionReadOnly("activities");
  const tasks = readCollectionReadOnly("tasks");
  const intelligences = opportunities.map(opportunity =>
    buildDealIntelligenceFromData(opportunity, {
      prospects,
      activities,
      tasks,
      generatedAt
    })
  );

  return buildRevenueIntelligence({
    opportunities,
    intelligences,
    generatedAt
  });
}

module.exports = {
  getRevenueIntelligenceSnapshot
};
