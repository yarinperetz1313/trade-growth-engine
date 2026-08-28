/**
 * TRADE GROWTH ENGINE
 * Service Economic Assumptions
 *
 * IMPORTANT:
 * These are INITIAL MODEL ASSUMPTIONS.
 * They are NOT verified Melbourne market facts.
 *
 * They exist so the engine can compare services using
 * different operating characteristics.
 *
 * Every value should eventually be replaced or calibrated
 * using real market/customer/job data.
 */

const SERVICE_ECONOMIC_ASSUMPTIONS = {
  "Emergency electrical fault finding": {
    averageJobValue: 650,
    grossMargin: 0.40,
    leadToJobRate: 0.35,
    customerAcquisitionCost: 150,
    repeatPotential: 0.35,
    labourHoursPerJob: 2.5,
    materialCostRate: 0.20,
    overheadRate: 0.15,
  },

  "Switchboard upgrades": {
    averageJobValue: 2500,
    grossMargin: 0.35,
    leadToJobRate: 0.25,
    customerAcquisitionCost: 250,
    repeatPotential: 0.20,
    labourHoursPerJob: 8,
    materialCostRate: 0.40,
    overheadRate: 0.15,
  },

  "EV charger installation": {
    averageJobValue: 1800,
    grossMargin: 0.30,
    leadToJobRate: 0.25,
    customerAcquisitionCost: 200,
    repeatPotential: 0.20,
    labourHoursPerJob: 5,
    materialCostRate: 0.45,
    overheadRate: 0.15,
  },

  "Commercial electrical maintenance": {
    averageJobValue: 900,
    grossMargin: 0.35,
    leadToJobRate: 0.30,
    customerAcquisitionCost: 250,
    repeatPotential: 0.75,
    labourHoursPerJob: 3.5,
    materialCostRate: 0.25,
    overheadRate: 0.15,
  },

  "Residential lighting installation": {
    averageJobValue: 500,
    grossMargin: 0.35,
    leadToJobRate: 0.30,
    customerAcquisitionCost: 150,
    repeatPotential: 0.15,
    labourHoursPerJob: 2.5,
    materialCostRate: 0.30,
    overheadRate: 0.15,
  },
};

function getServiceEconomicAssumptions(serviceName) {
  return (
    SERVICE_ECONOMIC_ASSUMPTIONS[serviceName] || null
  );
}

module.exports = {
  SERVICE_ECONOMIC_ASSUMPTIONS,
  getServiceEconomicAssumptions,
};
