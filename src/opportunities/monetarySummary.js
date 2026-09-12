const {
  decimalFromCanonicalUnits
} = require("../imports/numericEvidence");
const {
  knownPositiveCommercialValue
} = require("./commercialValue");
const {
  isCanonicalOpportunityCurrency
} = require("./opportunityCurrency");

function createMonetaryAccumulator() {
  return {
    knownCount: 0,
    unknownCount: 0,
    withheldCount: 0,
    totalsByCurrency: new Map()
  };
}

function addMonetaryAmount(accumulator, amount, currency) {
  const commercialValue = knownPositiveCommercialValue(amount);
  if (commercialValue === null) {
    accumulator.unknownCount += 1;
    return;
  }

  accumulator.knownCount += 1;
  if (!isCanonicalOpportunityCurrency(currency)) {
    accumulator.withheldCount += 1;
    return;
  }

  const aggregate = accumulator.totalsByCurrency.get(currency) || {
    units: 0n,
    count: 0
  };
  aggregate.units += commercialValue.units;
  aggregate.count += 1;
  accumulator.totalsByCurrency.set(currency, aggregate);
}

function finalizeMonetarySummary(accumulator) {
  const totalsByCurrency = [...accumulator.totalsByCurrency.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([currency, aggregate]) => ({
      currency,
      amount: decimalFromCanonicalUnits(aggregate.units),
      count: aggregate.count
    }));
  const hasOneCompleteCurrency = accumulator.knownCount > 0
    && accumulator.withheldCount === 0
    && totalsByCurrency.length === 1;

  return {
    known_total: accumulator.knownCount === 0
      ? 0
      : hasOneCompleteCurrency
        ? totalsByCurrency[0].amount
        : null,
    known_total_currency: hasOneCompleteCurrency
      ? totalsByCurrency[0].currency
      : null,
    known_total_withheld: accumulator.knownCount > 0
      && !hasOneCompleteCurrency,
    known_count: accumulator.knownCount,
    unknown_count: accumulator.unknownCount,
    withheld_count: accumulator.withheldCount,
    totals_by_currency: totalsByCurrency
  };
}

function summarizeOpportunityAmounts(opportunities, amountForOpportunity) {
  const accumulator = createMonetaryAccumulator();
  for (const opportunity of opportunities) {
    addMonetaryAmount(
      accumulator,
      amountForOpportunity(opportunity),
      opportunity?.currency
    );
  }
  return finalizeMonetarySummary(accumulator);
}

module.exports = {
  addMonetaryAmount,
  createMonetaryAccumulator,
  finalizeMonetarySummary,
  summarizeOpportunityAmounts
};
