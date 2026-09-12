const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const browserCommercialValue = import("../web/lib/commercialValue.js");
const {
  buildRevenueIntelligence
} = require("../src/intelligence/revenueIntelligence");
const {
  buildPipelineMetrics
} = require("../src/opportunities/opportunityEngine");

function opportunity(id, value, currency, weightedValue = value) {
  return {
    id,
    business_name: `Trade ${id}`,
    stage: "QUALIFIED",
    value,
    weighted_value: weightedValue,
    probability: 1,
    next_action: "Call the buyer",
    ...(currency === undefined ? {} : { currency })
  };
}

test("weighted pipeline requires known base value in every authoritative backend view", () => {
  const inconsistentEvidence = [
    opportunity("weighted-without-base", null, "AUD", "100.000001")
  ];
  const pipeline = buildPipelineMetrics(inconsistentEvidence);
  const revenue = buildRevenueIntelligence({
    opportunities: inconsistentEvidence,
    intelligences: []
  });

  assert.deepEqual(
    pipeline.weighted_pipeline_value_summary,
    revenue.active_pipeline.weighted_value
  );
  assert.deepEqual(pipeline.weighted_pipeline_value_summary, {
    known_total: 0,
    known_total_currency: null,
    known_total_withheld: false,
    known_count: 0,
    unknown_count: 1,
    withheld_count: 0,
    totals_by_currency: []
  });
  assert.deepEqual(
    pipeline.by_stage.QUALIFIED.weighted_value_summary,
    pipeline.weighted_pipeline_value_summary
  );
});

test("Biggest Opportunity withholds comparison when a known amount lacks canonical currency", async () => {
  const { selectBiggestOpportunity } = await browserCommercialValue;

  assert.equal(
    selectBiggestOpportunity([
      opportunity("aud-one", "1", "AUD"),
      opportunity("largest-withheld", "99999999999999.999999")
    ]),
    null
  );
  assert.equal(
    selectBiggestOpportunity([
      opportunity("aud-one", "1", "AUD"),
      opportunity("largest-invalid", "99999999999999.999999", "aud")
    ]),
    null
  );
});

test("browser monetary knownness and formatting are exact NUMERIC(20,6) operations", async () => {
  const {
    formatCommercialValue,
    isKnownCommercialValue
  } = await browserCommercialValue;

  for (const value of [
    "9.007199254740123456e12",
    "+9007199254740.123456"
  ]) {
    assert.equal(isKnownCommercialValue(value), true, value);
    assert.equal(
      formatCommercialValue(value, "AUD"),
      "AUD 9,007,199,254,740.123456",
      value
    );
  }

  for (const value of ["0.0000001", "100000000000000"]) {
    assert.equal(isKnownCommercialValue(value), false, value);
    assert.equal(formatCommercialValue(value, "AUD"), "Unknown", value);
  }
});

test("completion evidence records the exact client-side grouped and withheld reducer contract", async () => {
  const { buildCommercialValueSummary } = await browserCommercialValue;
  assert.deepEqual(
    buildCommercialValueSummary([
      opportunity("exact", "+9007199254740.123456", "AUD"),
      opportunity("withheld", "1.000001")
    ]),
    {
      known_total: null,
      known_total_currency: null,
      known_total_withheld: true,
      known_count: 2,
      unknown_count: 0,
      withheld_count: 1,
      totals_by_currency: [{
        currency: "AUD",
        amount: "9007199254740.123456",
        count: 1
      }]
    }
  );

  const main = fs.readFileSync(path.join(process.cwd(), "web/main.jsx"), "utf8");
  assert.match(main, /const totalValue = buildCommercialValueSummary\(active\)/);
  assert.match(
    main,
    /const weightedValue = buildCommercialValueSummary\([\s\S]*?isKnownCommercialValue\(item\.value\)[\s\S]*?item\.weighted_value[\s\S]*?: null[\s\S]*?\)/
  );

  const plan = fs.readFileSync(
    path.join(process.cwd(), "docs/execution-plans/active/pilot-readiness.md"),
    "utf8"
  );
  assert.match(
    plan,
    /client-side reduction exists and follows the\s+same exact grouped\/withheld contract/
  );
  assert.doesNotMatch(plan, /no client-side numeric monetary reducer/);
});
