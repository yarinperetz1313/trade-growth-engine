const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { buildRevenueIntelligence } = require("../src/intelligence/revenueIntelligence");
const mappers = require("../src/persistence/postgres/mappers");
const { canonicalDecimalUnits } = require("../src/imports/numericEvidence");
const browser = import("../web/lib/commercialValue.js");

const opportunity = (id, value, currency = "AUD", weighted_value) => ({
  id, business_name: id, stage: "QUALIFIED", probability: 1,
  value, currency, weighted_value
});

test("Astra P2: malformed JSON currency never becomes ranked or rendered authority", async () => {
  const { formatCommercialValue } = await browser;
  for (const currency of [["AUD"], {}, { code: "AUD" }, 123, true, false, null, undefined, "aud", " AUD", "AUD ", ""]) {
    const records = [opportunity("valid", "100"), opportunity("malformed", "100", currency)];
    // The fixture helper's default is overridden to exercise explicit undefined too.
    records[1].currency = currency;
    let result;
    assert.doesNotThrow(() => { result = buildRevenueIntelligence({ opportunities: records, intelligences: [] }); });
    assert.equal(result.top_actions.find(item => item.opportunity_id === "malformed").value.currency, null);
    assert.equal(result.active_pipeline.value.withheld_count, 1);
    assert.equal(formatCommercialValue("100", currency), currency == null ? "100 · Currency unknown" : "Unknown");
  }
  for (const currency of ["AUD", "NZD", "XYZ"]) {
    const result = buildRevenueIntelligence({ opportunities: [opportunity("valid", "100", currency)], intelligences: [] });
    assert.equal(result.top_actions[0].value.currency, currency);
    assert.equal(formatCommercialValue("100", currency), `${currency} 100`);
  }
});

test("Astra P2: equivalent persisted decimal spellings preserve exact browser ordering and display", async () => {
  const { formatCommercialValue, isKnownCommercialValue, selectBiggestOpportunity, compareOpportunityCommercialValues } = await browser;
  const exact = "9007199254740.123456";
  const variants = [exact, `${exact}${"0".repeat(110)}`, `+000${exact}000`, "9.007199254740123456000e12"];
  for (const value of variants) {
    assert.equal(canonicalDecimalUnits(value), canonicalDecimalUnits(exact));
    assert.equal(isKnownCommercialValue(value), true);
    assert.equal(formatCommercialValue(value, "AUD"), "AUD 9,007,199,254,740.123456");
    const records = [opportunity("lower", "9007199254740.123455"), opportunity("higher", value)];
    assert.equal(selectBiggestOpportunity(records).id, "higher");
    assert.ok(compareOpportunityCommercialValues(records[1], records[0]) < 0);
    assert.equal(selectBiggestOpportunity([opportunity("b", exact), opportunity("a", value)]).id, "a");
  }
  for (const value of ["0", `0.${"0".repeat(200)}`, "-0e20"]) {
    assert.equal(canonicalDecimalUnits(value), 0n);
    assert.equal(isKnownCommercialValue(value), false); // Portfolio's existing zero/unknown contract.
    assert.equal(formatCommercialValue(value, "AUD"), "Unknown");
  }
  assert.equal(formatCommercialValue(`0.000001${"0".repeat(200)}`, "AUD"), "AUD 0.000001");
  for (const value of ["1.0000001", "100000000000000", "1,000", "0x10", "Infinity", "1e", "--1", "1e2147483648", "0e2147483648"]) {
    assert.equal(canonicalDecimalUnits(value), null, value);
    assert.equal(isKnownCommercialValue(value), false, value);
    assert.equal(formatCommercialValue(value, "AUD"), "Unknown", value);
  }
});

test("Astra P2: only opportunity mapping strips modeled currency from compatibility payloads", () => {
  for (const [toRow, fromRow] of [
    [mappers.prospectToRow, mappers.prospectFromRow],
    [mappers.taskToRow, mappers.taskFromRow],
    [mappers.activityToRow, mappers.activityFromRow],
    [mappers.revenueActionToRow, mappers.revenueActionFromRow]
  ]) {
    for (const currency of ["NZD", ["legacy", "currency"], { custom: true }, null]) {
      const record = { id: "compatibility", business_name: "Trade", currency, other_extension: "preserve", evidence: [], recommendation_snapshot: {} };
      const row = toRow(record);
      assert.deepEqual(row.current_payload.currency, currency);
      assert.deepEqual(row.legacy_payload.currency, currency);
      const readback = fromRow(row);
      assert.deepEqual(readback.currency, currency);
      assert.deepEqual(toRow({ ...readback, business_name: "Updated" }).current_payload.currency, currency);
    }
  }
  const row = mappers.opportunityToRow(opportunity("modeled", "100", "AUD"));
  assert.equal(row.currency, "AUD");
  assert.equal(Object.hasOwn(row.current_payload, "currency"), false);
  assert.equal(Object.hasOwn(row.legacy_payload, "currency"), false);
});

test("Astra P2: individual weighted surfaces use recorded exact money only with a known base", async () => {
  const { isKnownCommercialValue, formatCommercialValue, weightedAmountWithKnownBase } = await browser;
  const main = fs.readFileSync("web/main.jsx", "utf8");
  const expression = main.match(/const weighted =\s*([\s\S]*?);\s*return \(/)[1];
  const tableAmount = new Function("opportunity", "isKnownCommercialValue", "weightedAmountWithKnownBase", "probability", `return (${expression});`);
  const fixtures = [
    [opportunity("missing-weight", "9007199254740.123456"), "Unknown"],
    [opportunity("precise", "9007199254740.123456", "AUD", "9007199254740.123455"), "AUD 9,007,199,254,740.123455"],
    [opportunity("close", "9007199254740.123456", "AUD", "9007199254740.123456"), "AUD 9,007,199,254,740.123456"],
    [opportunity("unknown-base", null, "AUD", "100.000001"), "Unknown"],
    [opportunity("zero-base", "0", "AUD", "100.000001"), "Unknown"],
    [opportunity("zero-weight", "100", "AUD", "0"), "Unknown"]
  ];
  for (const [record, expected] of fixtures) {
    assert.equal(formatCommercialValue(tableAmount(record, isKnownCommercialValue, weightedAmountWithKnownBase, 1), record.currency), expected);
    assert.equal(formatCommercialValue(weightedAmountWithKnownBase(record), record.currency), expected);
  }
  const commandCenter = fs.readFileSync("web/components/OpportunityCommandCenter.jsx", "utf8");
  assert.match(commandCenter, /formatCommercialValue\(\s*weightedAmountWithKnownBase\(currentOpportunity\),\s*currentOpportunity\.currency/);
});
