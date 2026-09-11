export function isKnownCommercialValue(value) {
  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return false;
  }

  const numeric = Number(value);

  return value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(numeric) &&
    numeric > 0;
}

const DECIMAL_LITERAL = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i;
const NUMERIC_SCALE = 6n;
const NUMERIC_INTEGER_DIGITS = 14n;

function canonicalDecimalUnits(value) {
  if (!["number", "string"].includes(typeof value)) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;

  const literal = String(value).trim();
  if (literal.length === 0 || literal.length > 128 || !DECIMAL_LITERAL.test(literal)) {
    return null;
  }
  const negative = literal.startsWith("-");
  const unsigned = literal.replace(/^[+-]/, "");
  const [coefficient, exponentText = "0"] = unsigned.split(/e/i);
  const [integerPart = "", fractionPart = ""] = coefficient.split(".");
  let digits = `${integerPart}${fractionPart}`.replace(/^0+/, "");
  if (digits === "") return 0n;
  const trailingZeros = digits.match(/0+$/)?.[0].length || 0;
  if (trailingZeros > 0) digits = digits.slice(0, -trailingZeros);
  const power = BigInt(exponentText)
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

function comparableOpportunityValues(opportunities) {
  return opportunities.flatMap(opportunity => {
    const units = canonicalDecimalUnits(opportunity?.value);
    const currency = canonicalCurrency(opportunity?.currency);
    return units !== null && units > 0n && currency !== null
      ? [{ opportunity, units, currency }]
      : [];
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

export function formatCommercialValue(value, currency) {
  if (!isKnownCommercialValue(value)) {
    return "Unknown";
  }

  if (currency !== null && currency !== undefined && !/^[A-Z]{3}$/.test(currency)) {
    return "Unknown";
  }

  const exact = typeof value === "string"
    && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    ? value
    : null;
  const amount = exact === null
    ? new Intl.NumberFormat("en-AU", {
      maximumFractionDigits: 6
    }).format(Number(value))
    : (() => {
      const [integer, fraction] = exact.split(".");
      const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return fraction === undefined ? grouped : `${grouped}.${fraction}`;
    })();
  return currency === null || currency === undefined
    ? `${amount} · Currency unknown`
    : `${currency} ${amount}`;
}
