const assert = require("node:assert/strict");
const test = require("node:test");

const formatter = import("../web/lib/commercialValue.js");

test("browser formats only explicit canonical opportunity currency", async () => {
  const { formatCommercialValue } = await formatter;
  assert.equal(formatCommercialValue("1250.5", "AUD"), "AUD 1,250.5");
  assert.equal(
    formatCommercialValue("1250.5", null),
    "1,250.5 · Currency unknown"
  );
  assert.equal(
    formatCommercialValue("1250.5", undefined),
    "1,250.5 · Currency unknown"
  );
  assert.equal(formatCommercialValue("1250.5", "aud"), "Unknown");
  assert.equal(formatCommercialValue("1250.5", " AUD "), "Unknown");
  assert.equal(
    formatCommercialValue("99999999999999.999999", "NZD"),
    "NZD 99,999,999,999,999.999999"
  );
});

test("unknown commercial amounts stay unknown regardless of currency", async () => {
  const { formatCommercialValue } = await formatter;
  for (const value of [undefined, null, "", "unknown", 0]) {
    assert.equal(formatCommercialValue(value, "AUD"), "Unknown");
  }
});
