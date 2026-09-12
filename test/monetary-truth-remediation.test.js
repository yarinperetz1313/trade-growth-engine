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
const {
  calculateRevenueActionBasis
} = require("../src/revenueActions/revenueActionBasis");

function opportunity(id, value, currency, overrides = {}) {
  return {
    id,
    business_name: `Trade ${id}`,
    stage: "QUALIFIED",
    value,
    weighted_value: value,
    probability: 1,
    next_action: "Call the buyer",
    ...(currency === undefined ? {} : { currency }),
    ...overrides
  };
}

function intelligence(id) {
  return {
    opportunity_id: id,
    resolved: { business_name: `Trade ${id}` },
    health: { status: "AT_RISK", risks: [] },
    score: { stale_risk: 0 },
    evidence: { known: [], unknown: [] },
    activity: { latest: null },
    tasks: { count: 0, open: 0, latest: null },
    next_best_action: {
      type: "ADVANCE",
      priority: "MEDIUM",
      title: "Call the buyer",
      reason: "The opportunity is ready to advance.",
      taskTitle: "Call the buyer"
    }
  };
}

test("revenue portfolio groups currencies and accumulates same-currency NUMERIC(20,6) values exactly", () => {
  const mixed = [
    opportunity("aud", "100.000001", "AUD"),
    opportunity("usd", "200.000001", "USD")
  ];
  const mixedResult = buildRevenueIntelligence({
    opportunities: mixed,
    intelligences: mixed.map(item => intelligence(item.id))
  });

  assert.deepEqual(mixedResult.active_pipeline.value, {
    known_total: null,
    known_total_currency: null,
    known_total_withheld: true,
    known_count: 2,
    unknown_count: 0,
    withheld_count: 0,
    totals_by_currency: [
      { currency: "AUD", amount: "100.000001", count: 1 },
      { currency: "USD", amount: "200.000001", count: 1 }
    ]
  });

  const exact = [
    opportunity("exact-a", "9007199254740.123455", "AUD"),
    opportunity("exact-b", "9007199254740.123456", "AUD")
  ];
  const exactResult = buildRevenueIntelligence({
    opportunities: exact,
    intelligences: exact.map(item => intelligence(item.id))
  });
  assert.equal(
    exactResult.active_pipeline.value.known_total,
    "18014398509480.246911"
  );
  assert.equal(exactResult.active_pipeline.value.known_total_currency, "AUD");
  assert.equal(exactResult.active_pipeline.value.known_total_withheld, false);
  assert.deepEqual(exactResult.active_pipeline.value.totals_by_currency, [{
    currency: "AUD",
    amount: "18014398509480.246911",
    count: 2
  }]);

  const withheld = [
    opportunity("known-aud", "12.000001", "AUD"),
    opportunity("currency-missing", "99.000001"),
    opportunity("currency-invalid", "88.000001", "aud")
  ];
  const withheldResult = buildRevenueIntelligence({
    opportunities: withheld,
    intelligences: withheld.map(item => intelligence(item.id))
  });
  assert.equal(withheldResult.active_pipeline.value.known_total, null);
  assert.equal(withheldResult.active_pipeline.value.known_total_withheld, true);
  assert.equal(withheldResult.active_pipeline.value.withheld_count, 2);
  assert.deepEqual(withheldResult.active_pipeline.value.totals_by_currency, [{
    currency: "AUD",
    amount: "12.000001",
    count: 1
  }]);
});

test("opportunity pipeline metrics expose exact grouped and withheld monetary truth", () => {
  const exact = buildPipelineMetrics([
    opportunity("exact-a", "9007199254740.123455", "AUD"),
    opportunity("exact-b", "9007199254740.123456", "AUD")
  ]);
  assert.equal(exact.pipeline_value, "18014398509480.246911");
  assert.deepEqual(exact.pipeline_value_summary.totals_by_currency, [{
    currency: "AUD",
    amount: "18014398509480.246911",
    count: 2
  }]);
  assert.equal(exact.weighted_pipeline_value, "18014398509480.246911");

  const mixed = buildPipelineMetrics([
    opportunity("aud", "100.000001", "AUD"),
    opportunity("usd", "200.000001", "USD"),
    opportunity("missing", "300.000001")
  ]);
  assert.equal(mixed.pipeline_value, null);
  assert.equal(mixed.weighted_pipeline_value, null);
  assert.equal(mixed.pipeline_value_summary.known_total_withheld, true);
  assert.equal(mixed.pipeline_value_summary.withheld_count, 1);
  assert.deepEqual(mixed.pipeline_value_summary.totals_by_currency, [
    { currency: "AUD", amount: "100.000001", count: 1 },
    { currency: "USD", amount: "200.000001", count: 1 }
  ]);
  assert.equal(mixed.by_stage.QUALIFIED.value, null);
  assert.deepEqual(
    mixed.by_stage.QUALIFIED.value_summary,
    mixed.pipeline_value_summary
  );
});

test("RevenueAction evidence fingerprints malformed persisted currency without collapsing it to missing", () => {
  const basis = currency => calculateRevenueActionBasis({
    opportunity: opportunity("basis", "42.000001", currency),
    intelligence: intelligence("basis")
  });
  const absent = calculateRevenueActionBasis({
    opportunity: opportunity("basis", "42.000001"),
    intelligence: intelligence("basis")
  });
  const explicitNull = basis(null);
  const empty = basis("");
  const lowercase = basis("aud");
  const canonical = basis("AUD");

  assert.deepEqual(absent.evidence.factual.commercial_value, {
    known: true,
    amount: "42.000001"
  });
  assert.deepEqual(explicitNull.evidence.factual.commercial_value, {
    known: true,
    amount: "42.000001"
  });
  assert.deepEqual(empty.evidence.factual.commercial_value, {
    known: true,
    amount: "42.000001",
    currency: "",
    currency_valid: false
  });
  assert.deepEqual(lowercase.evidence.factual.commercial_value, {
    known: true,
    amount: "42.000001",
    currency: "aud",
    currency_valid: false
  });
  assert.deepEqual(canonical.evidence.factual.commercial_value, {
    known: true,
    amount: "42.000001",
    currency: "AUD"
  });
  assert.equal(absent.basisFingerprint, explicitNull.basisFingerprint);
  assert.notEqual(empty.basisFingerprint, absent.basisFingerprint);
  assert.notEqual(lowercase.basisFingerprint, absent.basisFingerprint);
  assert.notEqual(empty.basisFingerprint, lowercase.basisFingerprint);
  assert.notEqual(canonical.basisFingerprint, lowercase.basisFingerprint);
});

test("browser renders grouped server truth and contains no client-side monetary reducers", async () => {
  const { formatCommercialValueSummary } = await browserCommercialValue;
  assert.equal(
    formatCommercialValueSummary({
      known_count: 2,
      withheld_count: 0,
      totals_by_currency: [
        { currency: "AUD", amount: "100.000001", count: 1 },
        { currency: "USD", amount: "200.000001", count: 1 }
      ]
    }),
    "AUD 100.000001 · USD 200.000001"
  );
  assert.equal(
    formatCommercialValueSummary({
      known_count: 2,
      withheld_count: 1,
      totals_by_currency: [
        { currency: "AUD", amount: "100.000001", count: 1 }
      ]
    }),
    "AUD 100.000001 · 1 known value withheld (currency unavailable or invalid)"
  );

  const main = fs.readFileSync(path.join(process.cwd(), "web/main.jsx"), "utf8");
  assert.doesNotMatch(main, /function numericCommercialContribution/);
  assert.match(main, /metrics\?\.pipeline_value_summary/);
  assert.match(main, /metrics\?\.weighted_pipeline_value_summary/);

  const commandCenter = fs.readFileSync(
    path.join(process.cwd(), "web/components/RevenueCommandCenter.jsx"),
    "utf8"
  );
  assert.match(commandCenter, /formatCommercialValueSummary/);
  assert.doesNotMatch(commandCenter, /formatCommercialValue\(summary\.known_total\)/);
});
