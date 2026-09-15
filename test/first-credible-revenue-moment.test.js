"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const journeyContracts = import("../web/lib/firstValueJourney.mjs");

function queueEntry(id, origin) {
  return {
    case: { id, lifecycle_state: "OPEN" },
    data_origin: origin
  };
}

function queue({ entries = [], known = [], unknown = 0, zero = 0 } = {}) {
  return {
    total_cases: entries.length,
    entries,
    value_summary: {
      known_positive: {
        case_count: known.reduce((total, item) => total + item.case_count, 0),
        totals_by_currency: known
      },
      known_zero: { case_count: zero },
      unknown: { case_count: unknown },
      not_applicable: { case_count: 0 }
    }
  };
}

function scan({ detected = 1, noLeak = 1, insufficient = 0, stale = 0, suppressed = 0 } = {}) {
  return {
    evaluated_count: detected + noLeak + insufficient + stale + suppressed,
    excluded_count: 0,
    unevaluated_count: 0,
    reconciliation: {
      detected_count: detected,
      created_count: detected,
      replayed_count: 0,
      superseded_count: 0
    },
    outcomes: {
      ELIGIBLE_LEAK_DETECTED: { count: detected, reasons: detected ? { STALE_WITHOUT_NEXT_ACTION: detected } : {} },
      ELIGIBLE_NO_LEAK: { count: noLeak, reasons: noLeak ? { NEXT_ACTION_PRESENT: noLeak } : {} },
      INSUFFICIENT_EVIDENCE: { count: insufficient, reasons: insufficient ? { OPPORTUNITY_STAGE_MISSING: insufficient } : {} },
      STALE_OR_UNTRUSTWORTHY_SOURCE: { count: stale, reasons: stale ? { CANONICAL_SOURCE_TOO_OLD: stale } : {} },
      DATA_HEALTH_SUPPRESSED: { count: suppressed, reasons: suppressed ? { COMMERCIAL_VALUE_INVALID: suppressed } : {} }
    }
  };
}

test("first-value result keeps credible, limited, unknown, and currency-grouped truth distinct", async () => {
  const { buildFirstValueScanResult } = await journeyContracts;
  const result = buildFirstValueScanResult(scan({
    detected: 2,
    noLeak: 1,
    insufficient: 1,
    stale: 1,
    suppressed: 1
  }), queue({
    entries: [
      queueEntry("demo", "SAMPLE_DEMO"),
      queueEntry("imported", "IMPORTED_CUSTOMER")
    ],
    known: [
      { currency: "AUD", amount: "1200.50", case_count: 1 },
      { currency: "USD", amount: "9000", case_count: 1 }
    ],
    unknown: 3,
    zero: 1
  }));

  assert.deepEqual(result, {
    state: "CREDIBLE_CASES",
    credible_case_count: 2,
    assessed_no_leak_count: 1,
    limitation_count: 3,
    queue_current: true,
    active_case_count: 2,
    known_totals_by_currency: [
      { currency: "AUD", amount: "1200.50", case_count: 1 },
      { currency: "USD", amount: "9000", case_count: 1 }
    ],
    known_zero_case_count: 1,
    unknown_value_case_count: 3,
    not_applicable_case_count: 0,
    created_case_count: 2,
    replayed_case_count: 0,
    superseded_case_count: 0
  });
});

test("first-value result gives a truthful no-case state without erasing limitations", async () => {
  const { buildFirstValueScanResult } = await journeyContracts;
  const result = buildFirstValueScanResult(
    scan({ detected: 0, noLeak: 2, insufficient: 1, stale: 1 }),
    queue()
  );

  assert.equal(result.state, "NO_CREDIBLE_CASE");
  assert.equal(result.credible_case_count, 0);
  assert.equal(result.assessed_no_leak_count, 2);
  assert.equal(result.limitation_count, 2);
  assert.deepEqual(result.known_totals_by_currency, []);
});

test("confirmed scan outcomes withhold current queue and money until durable refresh", async () => {
  const { buildFirstValueScanResult } = await journeyContracts;
  const result = buildFirstValueScanResult(
    scan({ detected: 1, noLeak: 0 }),
    null
  );

  assert.equal(result.state, "CREDIBLE_CASES");
  assert.equal(result.credible_case_count, 1);
  assert.equal(result.created_case_count, 1);
  assert.equal(result.queue_current, false);
  assert.equal(result.active_case_count, null);
  assert.equal(result.known_totals_by_currency, null);
  assert.equal(result.known_zero_case_count, null);
  assert.equal(result.unknown_value_case_count, null);
});

test("credible hero follows authoritative queue order while excluding sample proof", async () => {
  const { selectCredibleHero } = await journeyContracts;
  const entries = [
    queueEntry("sample-first", "SAMPLE_DEMO"),
    queueEntry("existing-next", "EXISTING_CUSTOMER"),
    queueEntry("imported-last", "IMPORTED_CUSTOMER")
  ];

  assert.equal(selectCredibleHero(entries), entries[1]);
  assert.equal(selectCredibleHero([entries[0]]), null);
  assert.equal(selectCredibleHero([]), null);
});

test("journey composition exposes explicit scan and continuous human case decisions", () => {
  const commandCenter = fs.readFileSync(
    path.join(repositoryRoot, "web/components/RevenueCommandCenter.jsx"),
    "utf8"
  );
  const importWorkspace = fs.readFileSync(
    path.join(repositoryRoot, "web/components/ImportWorkspace.jsx"),
    "utf8"
  );
  const main = fs.readFileSync(path.join(repositoryRoot, "web/main.jsx"), "utf8");

  assert.match(commandCenter, /DATA → TRUTH → MONEY → PROBLEM → WHY → ACTION/);
  assert.match(commandCenter, /TAKE ACTION/);
  assert.match(commandCenter, /SNOOZE/);
  assert.match(commandCenter, /DISMISS/);
  assert.match(commandCenter, /transitionRevenueLeakCase/);
  assert.match(commandCenter, /No cross-currency total is calculated/);
  assert.match(commandCenter, /not customer adoption|not commercial-outcome evidence/i);
  assert.match(importWorkspace, /Review Operational Data Health — no scan yet/);
  assert.match(main, /Revenue Leak Queue/);
  assert.doesNotMatch(commandCenter, /autonomous|automatically execute/i);
});
