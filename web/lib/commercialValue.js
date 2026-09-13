export function isKnownCommercialValue(value) {
  const units = canonicalDecimalUnits(value);
  return units !== null && units > 0n;
}

export function weightedAmountWithKnownBase(opportunity) {
  return isKnownCommercialValue(opportunity?.value)
    ? opportunity?.weighted_value
    : null;
}

const DECIMAL_LITERAL = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i;
const NUMERIC_SCALE = 6n;
const NUMERIC_INTEGER_DIGITS = 14n;

function canonicalDecimalUnits(value) {
  if (!["number", "string"].includes(typeof value)) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;

  const literal = String(value).trim();
  if (literal.length === 0 || !DECIMAL_LITERAL.test(literal)) {
    return null;
  }
  const negative = literal.startsWith("-");
  const unsigned = literal.replace(/^[+-]/, "");
  const [coefficient, exponentText = "0"] = unsigned.split(/e/i);
  const exponent = BigInt(exponentText);
  if (exponent < -2147483648n || exponent > 2147483647n) return null;
  const [integerPart = "", fractionPart = ""] = coefficient.split(".");
  let digits = `${integerPart}${fractionPart}`.replace(/^0+/, "");
  if (digits === "") return 0n;
  const trailingZeros = digits.match(/0+$/)?.[0].length || 0;
  if (trailingZeros > 0) digits = digits.slice(0, -trailingZeros);
  const power = exponent
    - BigInt(fractionPart.length)
    + BigInt(trailingZeros);
  const integerDigits = BigInt(digits.length) + power;
  const fractionalDigits = power < 0n ? -power : 0n;
  if (integerDigits > NUMERIC_INTEGER_DIGITS || fractionalDigits > NUMERIC_SCALE) {
    return null;
  }
  const units = BigInt(digits) * (10n ** (power + NUMERIC_SCALE));
  return negative ? -units : units;
}

function canonicalCurrency(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value)
    ? value
    : null;
}

function decimalFromUnits(value) {
  const whole = value / 1000000n;
  const fraction = String(value % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function groupCanonicalDecimal(value) {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function formatAggregateAmount(value, currency) {
  if (
    typeof value !== "string"
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)
    || /^0(?:\.0+)?$/.test(value)
  ) return null;
  return `${currency} ${groupCanonicalDecimal(value)}`;
}

export function buildCommercialValueSummary(
  opportunities = [],
  amountForOpportunity = opportunity => opportunity?.value
) {
  const totals = new Map();
  let knownCount = 0;
  let unknownCount = 0;
  let withheldCount = 0;

  for (const opportunity of opportunities) {
    const amount = amountForOpportunity(opportunity);
    const units = canonicalDecimalUnits(amount);
    if (units === null || units <= 0n) {
      unknownCount += 1;
      continue;
    }
    knownCount += 1;
    const currency = canonicalCurrency(opportunity?.currency);
    if (currency === null) {
      withheldCount += 1;
      continue;
    }
    const aggregate = totals.get(currency) || { units: 0n, count: 0 };
    aggregate.units += units;
    aggregate.count += 1;
    totals.set(currency, aggregate);
  }

  const totalsByCurrency = [...totals.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([currency, aggregate]) => ({
      currency,
      amount: decimalFromUnits(aggregate.units),
      count: aggregate.count
    }));
  const hasOneCompleteCurrency = knownCount > 0
    && withheldCount === 0
    && totalsByCurrency.length === 1;
  return {
    known_total: knownCount === 0
      ? 0
      : hasOneCompleteCurrency
        ? totalsByCurrency[0].amount
        : null,
    known_total_currency: hasOneCompleteCurrency
      ? totalsByCurrency[0].currency
      : null,
    known_total_withheld: knownCount > 0 && !hasOneCompleteCurrency,
    known_count: knownCount,
    unknown_count: unknownCount,
    withheld_count: withheldCount,
    totals_by_currency: totalsByCurrency
  };
}

export function formatCommercialValueSummary(summary) {
  if (!summary || !Array.isArray(summary.totals_by_currency)) return "Unknown";
  if (!Number.isSafeInteger(summary.withheld_count) || summary.withheld_count < 0) {
    return "Unknown";
  }
  const totals = summary.totals_by_currency.map(total => {
    if (!total || canonicalCurrency(total.currency) === null) return null;
    return formatAggregateAmount(total.amount, total.currency);
  });
  if (totals.some(total => total === null)) return "Unknown";

  if (summary.withheld_count > 0) {
    const noun = summary.withheld_count === 1 ? "value" : "values";
    totals.push(
      `${summary.withheld_count} known ${noun} withheld (currency unavailable or invalid)`
    );
  }
  return totals.length > 0 ? totals.join(" · ") : "Unknown";
}

function comparableOpportunityValues(opportunities) {
  return opportunities.flatMap(opportunity => {
    const units = canonicalDecimalUnits(opportunity?.value);
    const currency = canonicalCurrency(opportunity?.currency);
    return units !== null && units > 0n && currency !== null
      ? [{ opportunity, units, currency }]
      : [];
  });
}

function hasWithheldCommercialValue(opportunities) {
  return opportunities.some(opportunity => {
    const units = canonicalDecimalUnits(opportunity?.value);
    return units !== null
      && units > 0n
      && canonicalCurrency(opportunity?.currency) === null;
  });
}

export function compareOpportunityCommercialValues(left, right) {
  const [leftValue] = comparableOpportunityValues([left]);
  const [rightValue] = comparableOpportunityValues([right]);
  if (!leftValue || !rightValue) {
    if (leftValue) return -1;
    if (rightValue) return 1;
    return String(left?.id).localeCompare(String(right?.id));
  }
  if (leftValue.currency !== rightValue.currency) {
    return leftValue.currency.localeCompare(rightValue.currency);
  }
  if (leftValue.units !== rightValue.units) {
    return leftValue.units > rightValue.units ? -1 : 1;
  }
  return String(left?.id).localeCompare(String(right?.id));
}

export function selectBiggestOpportunity(opportunities = []) {
  if (hasWithheldCommercialValue(opportunities)) return null;
  const candidates = comparableOpportunityValues(opportunities);
  const currencies = new Set(candidates.map(candidate => candidate.currency));
  if (currencies.size !== 1) return null;

  candidates.sort((left, right) => {
    if (left.units !== right.units) return left.units > right.units ? -1 : 1;
    return String(left.opportunity.id).localeCompare(String(right.opportunity.id));
  });
  return candidates[0]?.opportunity || null;
}

export function hasCrossCurrencyCommercialValues(opportunities = []) {
  return new Set(
    comparableOpportunityValues(opportunities).map(candidate => candidate.currency)
  ).size > 1;
}

export function hasWithheldCommercialValues(opportunities = []) {
  return hasWithheldCommercialValue(opportunities);
}

export function formatCommercialValue(value, currency) {
  const units = canonicalDecimalUnits(value);
  if (units === null || units <= 0n) {
    return "Unknown";
  }

  if (currency !== null && currency !== undefined && canonicalCurrency(currency) === null) {
    return "Unknown";
  }

  const exact = decimalFromUnits(units);
  const amount = groupCanonicalDecimal(exact);
  return currency === null || currency === undefined
    ? `${amount} · Currency unknown`
    : `${currency} ${amount}`;
}
