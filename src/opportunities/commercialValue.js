const {
  canonicalDecimalUnits
} = require("../imports/numericEvidence");

function knownPositiveCommercialValue(value) {
  if (!["number", "string"].includes(typeof value)) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;

  const units = canonicalDecimalUnits(String(value));
  if (units === null || units <= 0n) return null;
  return {
    amount: value,
    units
  };
}

module.exports = {
  knownPositiveCommercialValue
};
