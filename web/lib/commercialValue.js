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

export function formatCommercialValue(value) {
  if (!isKnownCommercialValue(value)) {
    return "Unknown";
  }

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(Number(value));
}
