const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const commercialValue = import("../web/lib/commercialValue.js");
const {
  buildRevenueIntelligence
} = require("../src/intelligence/revenueIntelligence");
const {
  calculateRevenueActionBasis
} = require("../src/revenueActions/revenueActionBasis");

function opportunity(id, value, currency) {
  return {
    id,
    business_name: `Trade ${id}`,
    stage: "QUALIFIED",
    value,
    ...(currency === undefined ? {} : { currency }),
    probability: 0.2,
    next_action: "Call the buyer"
  };
}

function intelligence(id) {
  return {
    opportunity_id: id,
    resolved: { business_name: `Trade ${id}` },
    health: { status: "AT_RISK", risks: [] },
    score: { stale_risk: 0 },
    evidence: { known: [], unknown: [] },
    next_best_action: {
      type: "ADVANCE",
      priority: "MEDIUM",
      title: "Call the buyer",
      reason: "The opportunity is ready to advance.",
      taskTitle: "Call the buyer"
    }
  };
}

function actionState(value, currency) {
  return {
    opportunity: opportunity("basis-opportunity", value, currency),
    intelligence: {
      ...intelligence("basis-opportunity"),
      activity: { latest: null },
      tasks: { count: 0, open: 0, latest: null }
    }
  };
}

test("dashboard Biggest Opportunity ranks exact NUMERIC(20,6) decimals without Number coercion", async () => {
  const {
    compareOpportunityCommercialValues,
    selectBiggestOpportunity
  } = await commercialValue;
  assert.equal(typeof selectBiggestOpportunity, "function");

  const precisionSensitive = [
    opportunity("a-lower", "9007199254740.123455", "AUD"),
    opportunity("z-higher", "9007199254740.123456", "AUD")
  ];
  assert.equal(selectBiggestOpportunity(precisionSensitive).id, "z-higher");
  assert.equal(
    selectBiggestOpportunity([...precisionSensitive].reverse()).id,
    "z-higher"
  );

  const subUnit = [
    opportunity("a-subunit-lower", "1.000000", "NZD"),
    opportunity("z-subunit-higher", "1.000001", "NZD")
  ];
  assert.equal(selectBiggestOpportunity(subUnit).id, "z-subunit-higher");

  const exactTie = [
    opportunity("z-tie", "12.340000", "GBP"),
    opportunity("a-tie", "12.34", "GBP")
  ];
  assert.equal(selectBiggestOpportunity(exactTie).id, "a-tie");
  assert.deepEqual(
    [...precisionSensitive]
      .sort(compareOpportunityCommercialValues)
      .map(item => item.id),
    ["z-higher", "a-lower"]
  );

  const main = fs.readFileSync(path.join(process.cwd(), "web/main.jsx"), "utf8");
  assert.match(
    main,
    /const biggestOpportunity\s*=\s*selectBiggestOpportunity\(activeOpportunities\)/
  );
  assert.doesNotMatch(main, /function commercialAmount/);
});

test("dashboard does not infer a biggest monetary opportunity across currencies or unknown currency", async () => {
  const {
    hasCrossCurrencyCommercialValues,
    selectBiggestOpportunity
  } = await commercialValue;
  const crossCurrency = [
    opportunity("aud", "99999999999999.999999", "AUD"),
    opportunity("nzd", "0.000001", "NZD")
  ];
  assert.equal(
    selectBiggestOpportunity(crossCurrency),
    null
  );
  assert.equal(hasCrossCurrencyCommercialValues(crossCurrency), true);
  assert.equal(
    selectBiggestOpportunity([
      opportunity("unknown", "99999999999999.999999"),
      opportunity("invalid", "99999999999999.999999", "aud")
    ]),
    null
  );
  assert.equal(
    hasCrossCurrencyCommercialValues([
      opportunity("unknown", "99999999999999.999999"),
      opportunity("invalid", "99999999999999.999999", "aud")
    ]),
    false
  );
  assert.equal(
    selectBiggestOpportunity([
      opportunity("zero", "0", "AUD"),
      opportunity("unknown", "unknown", "AUD"),
      opportunity("invalid", "not-a-decimal", "AUD")
    ]),
    null
  );
});

test("deal-intelligence action ranking compares exact amounts only inside authoritative currency groups", () => {
  const precisionSensitive = [
    opportunity("a-lower", "9007199254740.123455", "AUD"),
    opportunity("z-higher", "9007199254740.123456", "AUD")
  ];
  const ranked = input => buildRevenueIntelligence({
    opportunities: input,
    intelligences: input.map(item => intelligence(item.id))
  }).top_actions.map(item => item.opportunity_id);

  assert.deepEqual(ranked(precisionSensitive), ["z-higher", "a-lower"]);
  assert.deepEqual(
    ranked([...precisionSensitive].reverse()),
    ["z-higher", "a-lower"]
  );

  const currencyGroups = [
    opportunity("z-aud-small", "0.000001", "AUD"),
    opportunity("a-nzd-large", "99999999999999.999999", "NZD"),
    opportunity("b-unknown-largest", "99999999999999.999999")
  ];
  assert.deepEqual(ranked(currencyGroups), [
    "z-aud-small",
    "a-nzd-large",
    "b-unknown-largest"
  ]);
  assert.deepEqual(ranked([...currencyGroups].reverse()), [
    "z-aud-small",
    "a-nzd-large",
    "b-unknown-largest"
  ]);
});

test("RevenueAction basis retains exact decimal and authoritative currency evidence", () => {
  const exact = calculateRevenueActionBasis(
    actionState("9007199254740.123456", "AUD")
  );
  assert.deepEqual(exact.evidence.factual.commercial_value, {
    known: true,
    amount: "9007199254740.123456",
    currency: "AUD"
  });

  const changedDecimal = calculateRevenueActionBasis(
    actionState("9007199254740.123455", "AUD")
  );
  const changedCurrency = calculateRevenueActionBasis(
    actionState("9007199254740.123456", "NZD")
  );
  assert.notEqual(exact.basisFingerprint, changedDecimal.basisFingerprint);
  assert.notEqual(exact.basisFingerprint, changedCurrency.basisFingerprint);

  for (const value of [
    0,
    "0.000000",
    null,
    "unknown",
    "0.0000001",
    "100000000000000"
  ]) {
    assert.deepEqual(
      calculateRevenueActionBasis(actionState(value)).evidence.factual
        .commercial_value,
      { known: false, amount: null },
      String(value)
    );
  }

  const legacyNumber = calculateRevenueActionBasis(actionState(42000));
  assert.deepEqual(legacyNumber.evidence.factual.commercial_value, {
    known: true,
    amount: 42000
  });
  assert.equal(
    legacyNumber.basisFingerprint,
    "f3ff54eaf05dad144f9ba0537b702b8a612c432c490db4fd11860e0e34109f4d"
  );
});
