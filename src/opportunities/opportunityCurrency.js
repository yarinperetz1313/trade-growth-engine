const CANONICAL_OPPORTUNITY_CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isCanonicalOpportunityCurrency(value) {
  return typeof value === "string"
    && CANONICAL_OPPORTUNITY_CURRENCY_PATTERN.test(value);
}

function assertOpportunityCurrency(value, { field = "currency" } = {}) {
  if (value === undefined || value === null) return value;
  if (isCanonicalOpportunityCurrency(value)) return value;

  const error = new TypeError(
    "Opportunity currency must be an exact three-letter uppercase code, null, or absent."
  );
  error.code = "OPPORTUNITY_CURRENCY_INVALID";
  error.field = field;
  throw error;
}

module.exports = {
  CANONICAL_OPPORTUNITY_CURRENCY_PATTERN,
  assertOpportunityCurrency,
  isCanonicalOpportunityCurrency
};
