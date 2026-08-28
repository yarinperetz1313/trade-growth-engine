const services = [
  {
    name: "Emergency electrical fault finding",
    category: "Emergency",
    urgency: 10,
    customerValue: 7,
    competition: 7,
    repeatPotential: 6,
    operationalFit: 9,
  },
  {
    name: "Switchboard upgrades",
    category: "Safety",
    urgency: 8,
    customerValue: 9,
    competition: 7,
    repeatPotential: 5,
    operationalFit: 8,
  },
  {
    name: "EV charger installation",
    category: "EV",
    urgency: 4,
    customerValue: 8,
    competition: 6,
    repeatPotential: 5,
    operationalFit: 7,
  },
  {
    name: "Commercial electrical maintenance",
    category: "Commercial",
    urgency: 7,
    customerValue: 9,
    competition: 6,
    repeatPotential: 10,
    operationalFit: 7,
  },
  {
    name: "Residential lighting installation",
    category: "Residential",
    urgency: 3,
    customerValue: 5,
    competition: 8,
    repeatPotential: 4,
    operationalFit: 9,
  },
];

function getMarketServices() {
  return services;
}

module.exports = {
  getMarketServices,
};
