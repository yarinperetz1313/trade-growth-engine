const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i;
const POSTGRES_NUMERIC_MAX_INPUT_EXPONENT = 2147483647n;
const POSTGRES_NUMERIC_MIN_INPUT_EXPONENT = -2147483648n;
const CANONICAL_NUMERIC_PRECISION = 20n;
const CANONICAL_NUMERIC_SCALE = 6n;

function isDecimalNumberLiteral(value) {
  return typeof value === "string" && DECIMAL_NUMBER_PATTERN.test(value.trim());
}

function isExactZeroLiteral(value) {
  if (!isDecimalNumberLiteral(value)) return false;
  const coefficient = value.trim().replace(/^[+-]/, "").split(/e/i, 1)[0];
  return !/[1-9]/.test(coefficient);
}

function isNegativeNumberLiteral(value) {
  return isDecimalNumberLiteral(value)
    && value.trim().startsWith("-")
    && !isExactZeroLiteral(value);
}

function isGreaterThanOneLiteral(value) {
  if (!isDecimalNumberLiteral(value) || isNegativeNumberLiteral(value)) return false;
  const normalized = value.trim().replace(/^\+/, "");
  const [coefficient, exponentText = "0"] = normalized.split(/e/i);
  const [integerPart, fractionPart = ""] = coefficient.split(".");
  const digits = `${integerPart || "0"}${fractionPart}`;
  const firstSignificant = digits.search(/[1-9]/);
  if (firstSignificant < 0) return false;
  const exponent = BigInt(exponentText);
  const leadingPower = exponent
    + BigInt((integerPart || "0").length - firstSignificant - 1);
  if (leadingPower > 0n) return true;
  if (leadingPower < 0n) return false;
  const significant = digits.slice(firstSignificant);
  return significant[0] !== "1" || /[1-9]/.test(significant.slice(1));
}

function isCanonicalNumericLiteralRepresentable(value) {
  const normalized = normalizeDecimalLiteral(value);
  if (
    !normalized
    || normalized.exponent < POSTGRES_NUMERIC_MIN_INPUT_EXPONENT
    || normalized.exponent > POSTGRES_NUMERIC_MAX_INPUT_EXPONENT
  ) return false;
  if (normalized.zero) return true;
  const integerDigits = BigInt(normalized.digits.length) + normalized.power;
  const fractionalDigits = normalized.power < 0n ? -normalized.power : 0n;
  return integerDigits <= CANONICAL_NUMERIC_PRECISION - CANONICAL_NUMERIC_SCALE
    && fractionalDigits <= CANONICAL_NUMERIC_SCALE;
}

function areDecimalLiteralsEquivalent(left, right) {
  const normalizedLeft = normalizeDecimalLiteral(left);
  const normalizedRight = normalizeDecimalLiteral(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.zero || normalizedRight.zero) {
    return normalizedLeft.zero && normalizedRight.zero;
  }
  return normalizedLeft.negative === normalizedRight.negative
    && normalizedLeft.digits === normalizedRight.digits
    && normalizedLeft.power === normalizedRight.power;
}

function canonicalizeDecimalLiteral(value) {
  const normalized = normalizeDecimalLiteral(value);
  if (!normalized || !isCanonicalNumericLiteralRepresentable(value)) return null;
  if (normalized.zero) return "0";

  const sign = normalized.negative ? "-" : "";
  if (normalized.power >= 0n) {
    return `${sign}${normalized.digits}${"0".repeat(Number(normalized.power))}`;
  }

  const decimalIndex = normalized.digits.length + Number(normalized.power);
  if (decimalIndex > 0) {
    return `${sign}${normalized.digits.slice(0, decimalIndex)}.${normalized.digits.slice(decimalIndex)}`;
  }
  return `${sign}0.${"0".repeat(-decimalIndex)}${normalized.digits}`;
}

function canonicalDecimalUnits(value) {
  const normalized = normalizeDecimalLiteral(value);
  if (
    !normalized
    || normalized.exponent < POSTGRES_NUMERIC_MIN_INPUT_EXPONENT
    || normalized.exponent > POSTGRES_NUMERIC_MAX_INPUT_EXPONENT
  ) return null;
  if (normalized.zero) return 0n;

  const integerDigits = BigInt(normalized.digits.length) + normalized.power;
  const fractionalDigits = normalized.power < 0n ? -normalized.power : 0n;
  if (
    integerDigits > CANONICAL_NUMERIC_PRECISION - CANONICAL_NUMERIC_SCALE
    || fractionalDigits > CANONICAL_NUMERIC_SCALE
  ) return null;

  const units = BigInt(normalized.digits)
    * (10n ** (normalized.power + CANONICAL_NUMERIC_SCALE));
  return normalized.negative ? -units : units;
}

function compareCanonicalDecimals(left, right) {
  const leftUnits = canonicalDecimalUnits(left);
  const rightUnits = canonicalDecimalUnits(right);
  if (leftUnits === null || rightUnits === null) {
    const error = new TypeError(
      "Decimal comparison requires NUMERIC(20,6)-representable literals."
    );
    error.code = "CANONICAL_DECIMAL_INVALID";
    throw error;
  }
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

function decimalFromCanonicalUnits(value) {
  if (typeof value !== "bigint") {
    throw new TypeError("Canonical decimal units must be a bigint.");
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / (10n ** CANONICAL_NUMERIC_SCALE);
  const fraction = String(absolute % (10n ** CANONICAL_NUMERIC_SCALE))
    .padStart(Number(CANONICAL_NUMERIC_SCALE), "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function normalizeDecimalLiteral(value) {
  if (!isDecimalNumberLiteral(value)) return null;
  const literal = value.trim();
  const negative = literal.startsWith("-");
  const unsigned = literal.replace(/^[+-]/, "");
  const [coefficient, exponentText = "0"] = unsigned.split(/e/i);
  const [integerPart = "", fractionPart = ""] = coefficient.split(".");
  let digits = `${integerPart}${fractionPart}`.replace(/^0+/, "");
  if (digits === "") {
    return {
      digits: "0",
      exponent: BigInt(exponentText),
      negative: false,
      power: 0n,
      zero: true
    };
  }
  const trailingZeros = digits.match(/0+$/)?.[0].length || 0;
  if (trailingZeros > 0) digits = digits.slice(0, -trailingZeros);
  return {
    digits,
    exponent: BigInt(exponentText),
    negative,
    power: BigInt(exponentText)
      - BigInt(fractionPart.length)
      + BigInt(trailingZeros),
    zero: false
  };
}

function jsonNumberLiteral(value) {
  const normalized = value.trim().replace(/^\+/, "");
  const [coefficient, exponent] = normalized.split(/e/i);
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [integerPart = "", fractionPart] = unsigned.split(".");
  const integer = (integerPart.replace(/^0+(?=\d)/, "") || "0");
  const fraction = fractionPart === undefined || fractionPart === ""
    ? ""
    : `.${fractionPart}`;
  const suffix = exponent === undefined ? "" : `e${exponent}`;
  return `${negative ? "-" : ""}${integer}${fraction}${suffix}`;
}

module.exports = {
  CANONICAL_NUMERIC_PRECISION,
  CANONICAL_NUMERIC_SCALE,
  DECIMAL_NUMBER_PATTERN,
  areDecimalLiteralsEquivalent,
  canonicalDecimalUnits,
  canonicalizeDecimalLiteral,
  compareCanonicalDecimals,
  decimalFromCanonicalUnits,
  isDecimalNumberLiteral,
  isCanonicalNumericLiteralRepresentable,
  isExactZeroLiteral,
  isGreaterThanOneLiteral,
  isNegativeNumberLiteral,
  jsonNumberLiteral
};
