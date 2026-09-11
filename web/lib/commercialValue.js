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
