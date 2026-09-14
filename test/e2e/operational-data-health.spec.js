import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

const require = createRequire(`${process.cwd()}/package.json`);
const {
  buildRevenueLeakOperatingQueue
} = require("./src/revenueLeakCases/revenueLeakOperatingQueue");

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";

function record({
  id,
  classification,
  outcome,
  reason,
  nextStep,
  amount = null,
  currency = null,
  kind = amount === null
    ? "UNKNOWN"
    : /^0+(?:\.0+)?$/.test(amount)
      ? "KNOWN_ZERO"
      : "KNOWN_POSITIVE"
}) {
  return {
    opportunity_id: id,
    opportunity_name: `Opportunity ${id}`,
    classification,
    detector_outcome: outcome,
    reason_code: reason,
    commercial_value: { kind, amount, currency },
    next_step: nextStep
  };
}

function response(records, readiness) {
  const classifications = {
    ELIGIBLE: 0,
    MISSING_REQUIRED_EVIDENCE: 0,
    STALE_EVIDENCE: 0,
    SUPPRESSED_INVALID_EVIDENCE: 0,
    SCAN_BLOCKED: 0
  };
  const reasonCounts = {};
  const commercial = {
    known_positive_count: 0,
    known_zero_count: 0,
    unknown_count: 0,
    not_assessed_count: 0
  };
  for (const item of records) {
    classifications[item.classification] += 1;
    if (item.classification !== "ELIGIBLE") {
      reasonCounts[item.reason_code] = (reasonCounts[item.reason_code] || 0) + 1;
    }
    if (item.commercial_value.kind === "KNOWN_POSITIVE") commercial.known_positive_count += 1;
    if (item.commercial_value.kind === "KNOWN_ZERO") commercial.known_zero_count += 1;
    if (item.commercial_value.kind === "UNKNOWN") commercial.unknown_count += 1;
    if (item.commercial_value.kind === "NOT_ASSESSED") commercial.not_assessed_count += 1;
  }
  const eligible = classifications.ELIGIBLE;
  return {
    ok: true,
    evaluated_at: new Date(Date.now() - 1_000).toISOString(),
    detector: { id: "stalled-opportunity", version: "1" },
    scope: "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES",
    mode: "READ_ONLY",
    summary: {
      complete: true,
      limit: 100,
      readiness,
      global_reason_code: null,
      total_opportunities: records.length,
      detector_assessable_count: eligible,
      detector_unassessable_count: records.length - eligible,
      scan_evaluated_count: records.length,
      reason_counts: reasonCounts,
      classifications,
      commercial_value_coverage: commercial
    },
    records
  };
}

const eligibleZero = record({
  id: "a-eligible-zero",
  classification: "ELIGIBLE",
  outcome: "ELIGIBLE_NO_LEAK",
  reason: "NEXT_ACTION_PRESENT",
  nextStep: "RUN_EXPLICIT_SCAN",
  amount: "0",
  currency: "AUD"
});
const missingStage = record({
  id: "b-missing-stage",
  classification: "MISSING_REQUIRED_EVIDENCE",
  outcome: "INSUFFICIENT_EVIDENCE",
  reason: "OPPORTUNITY_STAGE_MISSING",
  nextStep: "CORRECT_OPPORTUNITY_STAGE"
});
const invalidMoney = record({
  id: "c-invalid-money",
  classification: "SUPPRESSED_INVALID_EVIDENCE",
  outcome: "DATA_HEALTH_SUPPRESSED",
  reason: "COMMERCIAL_VALUE_INVALID",
  nextStep: "CORRECT_COMMERCIAL_EVIDENCE",
  kind: "NOT_ASSESSED"
});

async function mockStableShell(page) {
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, route =>
    json(route, 200, {
      ok: true,
      data: buildRevenueLeakOperatingQueue({
        contexts: [],
        totalCount: 0,
        generatedAt: new Date().toISOString()
      })
    })
  );
  await page.route(`${apiBaseUrl}/api/pilot-evidence/status`, route =>
    json(route, 200, {
      ok: true,
      data: {
        milestones: {
          import_committed: false,
          portfolio_scan_completed: false,
          first_credible_case_surfaced: false,
          case_inspected: false,
          revenue_action_materialized_linked: false,
          action_approved: false,
          action_executed: false
        },
        latest_import: null,
        surfaced_case_id: null,
        inspected_case_ids: [],
        linked_action_ids: [],
        case_feedback: []
      }
    })
  );
}

test("shows partial authoritative readiness at 390px before an explicit scan", async ({ page }) => {
  let scanRequests = 0;
  await mockStableShell(page);
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/stalled-opportunity-eligibility`,
    route => json(route, 200, response([
      eligibleZero,
      missingStage,
      invalidMoney
    ], "PARTIAL"))
  );
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/scan-stalled-opportunities`,
    route => {
      scanRequests += 1;
      return route.abort("failed");
    }
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#opportunities");

  const readiness = page.getByTestId("stalled-opportunity-readiness");
  await expect(readiness).toContainText("1 of 3 opportunities are ready to assess");
  await expect(readiness.getByLabel("Stalled-opportunity assessment coverage"))
    .toContainText("Known zero1");
  await expect(readiness.getByLabel("Stalled-opportunity assessment coverage"))
    .toContainText("Value not assessed1");
  await expect(readiness.getByLabel("Reasons opportunities cannot be assessed"))
    .toContainText("OPPORTUNITY_STAGE_MISSING");
  await expect(readiness.getByLabel("Reasons opportunities cannot be assessed"))
    .toContainText("COMMERCIAL_VALUE_INVALID");
  await readiness.getByText("Inspect 2 records that cannot be assessed now").click();
  await expect(readiness).toContainText("Ask the assisted-pilot operator to correct malformed value or currency evidence");
  await expect(readiness).toContainText("Missing money may remain unknown without blocking");
  expect(scanRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const scan = page.getByRole("button", { name: "Scan stalled opportunities" });
  await expect(scan).toBeEnabled();
  await scan.click();
  await expect.poll(() => scanRequests).toBe(1);
});

test("keeps empty, no-eligible, all-eligible, and unavailable states truthful", async ({ page }) => {
  let readiness = response([], "EMPTY");
  let unavailable = false;
  await mockStableShell(page);
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/stalled-opportunity-eligibility`,
    route => unavailable
      ? json(route, 503, {
          ok: false,
          error: "POSTGRES_UNAVAILABLE",
          message: "PostgreSQL is unavailable."
        })
      : json(route, 200, readiness)
  );

  await page.goto("/#opportunities");
  const scan = page.getByRole("button", { name: "Scan stalled opportunities" });
  await expect(page.getByTestId("stalled-opportunity-readiness"))
    .toContainText("No opportunities are available to assess");
  await expect(scan).toBeDisabled();

  readiness = response([missingStage], "NOT_READY");
  await page.reload();
  await expect(page.getByTestId("stalled-opportunity-readiness"))
    .toContainText("0 of 1 opportunities are ready to assess");
  await expect(scan).toBeDisabled();

  readiness = response([{
    ...eligibleZero,
    commercial_value: {
      kind: "KNOWN_POSITIVE",
      amount: "9007199254740.123456",
      currency: "AUD"
    }
  }], "READY");
  await page.reload();
  await expect(page.getByTestId("stalled-opportunity-readiness"))
    .toContainText("1 of 1 opportunities are ready to assess");
  await expect(scan).toBeEnabled();

  unavailable = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("No scan-readiness conclusion was inferred");
  await expect(scan).toBeDisabled();
});

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
