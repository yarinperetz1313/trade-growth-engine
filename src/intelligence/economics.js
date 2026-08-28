function calculateEconomics({
  averageJobValue,
  jobsPerMonth,
  grossMarginPercent,
  monthlyFixedCosts,
  customerAcquisitionCost,
  repeatJobsPerCustomer,
  customersPerMonth
}) {
  const inputs = {
    averageJobValue,
    jobsPerMonth,
    grossMarginPercent,
    monthlyFixedCosts,
    customerAcquisitionCost,
    repeatJobsPerCustomer,
    customersPerMonth
  };

  const missingInputs = Object.entries(inputs)
    .filter(([key, value]) =>
      value === undefined ||
      value === null ||
      value === ""
    )
    .map(([key]) => key);

  if (missingInputs.length > 0) {
    return {
      success: false,
      status: "INSUFFICIENT_DATA",
      missingInputs,
      message:
        "Real commercial inputs are required before profitability can be calculated."
    };
  }

  const monthlyRevenue =
    averageJobValue * jobsPerMonth;

  const grossProfit =
    monthlyRevenue * (grossMarginPercent / 100);

  const acquisitionCost =
    customerAcquisitionCost *
    customersPerMonth;

  const operatingProfit =
    grossProfit -
    monthlyFixedCosts -
    acquisitionCost;

  const revenuePerCustomer =
    averageJobValue * repeatJobsPerCustomer;

  return {
    success: true,

    monthlyRevenue:
      Math.round(monthlyRevenue * 100) / 100,

    grossProfit:
      Math.round(grossProfit * 100) / 100,

    customerAcquisitionCost:
      Math.round(acquisitionCost * 100) / 100,

    operatingProfit:
      Math.round(operatingProfit * 100) / 100,

    revenuePerCustomer:
      Math.round(revenuePerCustomer * 100) / 100,

    profitable:
      operatingProfit > 0
  };
}

module.exports = {
  calculateEconomics
};
