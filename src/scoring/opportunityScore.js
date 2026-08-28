function scoreOpportunity({
  urgency,
  customerValue,
  competition,
  repeatPotential,
  operationalFit,
}) {
  const score =
    urgency * 0.25 +
    customerValue * 0.25 +
    competition * 0.15 +
    repeatPotential * 0.20 +
    operationalFit * 0.15;

  return Math.round(score * 10) / 10;
}

module.exports = {
  scoreOpportunity,
};
