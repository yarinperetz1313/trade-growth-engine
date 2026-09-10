import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

const require = createRequire(`${process.cwd()}/package.json`);
const {
  buildRevenueLeakCaseDetection
} = require("./src/revenueLeakCases/revenueLeakCaseDomain");
const {
  buildRevenueLeakOperatingQueue
} = require("./src/revenueLeakCases/revenueLeakOperatingQueue");

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";
const DAY_MS = 86400000;

function isoBefore(reference, days) {
  return new Date(reference - days * DAY_MS).toISOString();
}

function caseContext({
  id,
  opportunityId,
  businessName,
  amount = null,
  currency = null,
  classification = amount === null ? "UNKNOWN" : "KNOWN",
  state = "OPEN",
  linked = false,
  reference = Date.now()
}) {
  const observedAt = isoBefore(reference, 1);
  const baselineAt = isoBefore(reference, 21);
  const detectedAt = observedAt;
  const commercialValue = classification === "KNOWN"
    ? { classification, amount, currency }
    : { classification };
  let record = buildRevenueLeakCaseDetection({
    leak_type: "STALLED_OPPORTUNITY",
    source: {
      system: "TGE",
      entity_type: "OPPORTUNITY",
      entity_id: opportunityId,
      observed_at: observedAt,
      observed_version: `source-${id}`
    },
    detector: { id: "stalled-opportunity", version: "1" },
    reason_code: "STALE_WITHOUT_NEXT_ACTION",
    evidence_classification: "MIXED",
    evidence: {
      criteria: {
        stale_after_days: 14,
        stale_boundary: "AT_OR_AFTER",
        source_freshness_days: 90,
        source_freshness_boundary: "AT_OR_BEFORE"
      },
      opportunity_stage: "PROPOSAL",
      activity_baseline: {
        kind: "ACTIVITY",
        entity_id: `activity-${id}`,
        at: baselineAt
      },
      stalled_since: isoBefore(reference, 7),
      next_action: {
        present: false,
        source: "NONE",
        opportunity_value: null,
        active_task_ids: []
      },
      source_freshness: {
        observed_at: observedAt,
        maximum_age_days: 90
      },
      commercial_value_basis: classification === "KNOWN"
        ? {
            classification: "KNOWN",
            amount_source: "opportunity.value",
            currency_source: "opportunity.currency"
          }
        : classification === "NOT_APPLICABLE"
          ? { classification: "NOT_APPLICABLE" }
          : {
              classification: "UNKNOWN",
              reason: "VALUE_UNKNOWN",
              currency_present: false
            }
    },
    commercial_value: commercialValue,
    recommended_action_type: "FOLLOW_UP",
    due_at: null,
    supersession_condition: {
      kind: "CANONICAL_EVIDENCE_CHANGED",
      detector_id: "stalled-opportunity",
      detector_version: "1"
    }
  }, {
    id,
    detectedAt,
    subjectId: "auth0|e2e-operator"
  });
  if (state === "SNOOZED") {
    record = {
      ...record,
      state,
      snoozed_at: observedAt,
      snoozed_until: new Date(reference + 2 * DAY_MS).toISOString()
    };
  }
  let revenueAction = null;
  if (linked) {
    const fingerprint = "a".repeat(64);
    record = {
      ...record,
      revenue_action_id: `action-${id}`,
      revenue_action_fingerprint: fingerprint,
      revenue_action_status_at_link: "RECOMMENDED",
      revenue_action_linked_at: new Date(reference).toISOString()
    };
    revenueAction = {
      id: `action-${id}`,
      opportunity_id: opportunityId,
      basis_fingerprint: fingerprint,
      status: "RECOMMENDED"
    };
  }
  return {
    case: record,
    opportunity: businessName === null ? null : {
      id: opportunityId,
      prospect_id: null,
      business_name: businessName
    },
    business: null,
    revenue_action: revenueAction
  };
}

function queueResponse(contexts, reference = Date.now()) {
  return {
    ok: true,
    data: buildRevenueLeakOperatingQueue({
      contexts,
      totalCount: contexts.length,
      generatedAt: new Date(reference).toISOString()
    })
  };
}

function primaryContexts(reference = Date.now()) {
  return [
    caseContext({
      id: "case-aud",
      opportunityId: "e2e-opp-stalled",
      businessName: "E2E Stalled Roofing",
      amount: "1200.5",
      currency: "AUD",
      reference
    }),
    caseContext({
      id: "case-usd",
      opportunityId: "e2e-opp-command",
      businessName: "E2E Command Plumbing",
      amount: "9000",
      currency: "USD",
      reference
    }),
    caseContext({
      id: "case-zero",
      opportunityId: "e2e-opp-revenue",
      businessName: "E2E Revenue Electrical",
      amount: "0",
      currency: "AUD",
      reference
    }),
    caseContext({
      id: "case-unknown",
      opportunityId: "e2e-opp-execution",
      businessName: "E2E Execution Electrical",
      reference
    }),
    caseContext({
      id: "case-na",
      opportunityId: "e2e-opp-execution-failure",
      businessName: null,
      classification: "NOT_APPLICABLE",
      state: "SNOOZED",
      reference
    })
  ];
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

test("renders the server-ordered truthful operating queue with evidence and authoritative filters", async ({ page }) => {
  const reference = Date.now();
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, route =>
    json(route, 200, queueResponse(primaryContexts(reference), reference))
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#opportunities");

  const commandCenter = page.getByTestId("revenue-command-center");
  await expect(commandCenter.getByRole("heading", {
    name: "What revenue needs attention?"
  })).toBeVisible();
  await expect(commandCenter).toContainText("AUD 1,200.5");
  await expect(commandCenter).toContainText("USD 9,000");
  await expect(commandCenter.getByLabel("Known zero summary").locator("strong"))
    .toHaveText("1");
  await expect(commandCenter.getByLabel("Unknown value summary").locator("strong"))
    .toHaveText("1");
  await expect(commandCenter.getByLabel("Not applicable summary").locator("strong"))
    .toHaveText("1");
  await expect(commandCenter.locator("[data-case-id]").first()).toHaveAttribute(
    "data-case-id",
    "case-aud"
  );
  await expect(commandCenter.locator("[data-case-id]")).toHaveCount(5);

  const evidenceButton = commandCenter.getByRole("button", {
    name: /Why TGE surfaced this.*E2E Stalled Roofing/i
  });
  await evidenceButton.focus();
  await page.keyboard.press("Enter");
  await expect(commandCenter.getByRole("heading", {
    name: "Why TGE surfaced this"
  })).toBeVisible();
  await expect(commandCenter).toContainText("STALE_WITHOUT_NEXT_ACTION");
  await expect(commandCenter).toContainText("Meaningful activity baseline");
  await expect(commandCenter).toContainText("approval required");
  await expect(commandCenter.getByRole("button", {
    name: "Create recovery action"
  })).toBeEnabled();
  await expect(commandCenter.getByRole("button", {
    name: "Open opportunity"
  })).toBeEnabled();

  await commandCenter.getByLabel("Value", { exact: true }).selectOption("UNKNOWN");
  await expect(commandCenter.locator("[data-case-id]")).toHaveCount(1);
  await expect(commandCenter).toContainText("E2E Execution Electrical");
  await commandCenter.getByLabel("Value", { exact: true }).selectOption("ALL");
  await commandCenter.getByLabel("Lifecycle", { exact: true }).selectOption("SNOOZED");
  await expect(commandCenter.locator("[data-case-id]")).toHaveCount(1);
  await expect(commandCenter).toContainText("Business identity unavailable");
  await commandCenter.getByRole("button", {
    name: /Why TGE surfaced this.*Business identity unavailable/i
  }).click();
  await expect(commandCenter).toContainText(
    "Historical opportunity e2e-opp-execution-failure"
  );
  await expect(commandCenter).toContainText("Current opportunity context unavailable");
  await expect(commandCenter.getByRole("button", {
    name: "Create recovery action"
  })).toHaveCount(0);
  await expect(commandCenter.getByRole("button", {
    name: "Open opportunity"
  })).toHaveCount(0);
  await expect(commandCenter.getByRole("button", {
    name: "Continue in Opportunity Command Center"
  })).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth
  }))).toEqual({ body: 390, viewport: 390 });
});

test("renders exact same-currency aggregate totals beyond one case's numeric envelope", async ({ page }) => {
  const reference = Date.now();
  const contexts = ["aggregate-a", "aggregate-b"].map(id => caseContext({
    id,
    opportunityId: `e2e-opp-${id}`,
    businessName: `E2E ${id}`,
    amount: "99999999999999.999999",
    currency: "AUD",
    reference
  }));
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, route =>
    json(route, 200, queueResponse(contexts, reference))
  );

  await page.goto("/#opportunities");

  const summary = page.getByLabel("Known potential revenue at risk summary");
  await expect(summary).toContainText("AUD 199,999,999,999,999.999998");
  await expect(summary).toContainText("2 cases");
  await expect(summary).not.toContainText("Unavailable");
});

test("keeps loading, empty, partial context, and limit/integrity/persistence failures distinct", async ({ page }) => {
  const reference = Date.now();
  let releaseInitial;
  const initialGate = new Promise(resolve => { releaseInitial = resolve; });
  let mode = "LOADING";
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, async route => {
    if (mode === "LOADING") {
      await initialGate;
      return json(route, 200, queueResponse([], reference));
    }
    if (mode === "LIMIT") {
      return json(route, 409, {
        ok: false,
        error: "REVENUE_LEAK_QUEUE_LIMIT_EXCEEDED",
        message: "The active revenue leak queue exceeds the safe operating limit.",
        details: { complete: false, total_cases: 101, omitted_count: 101 }
      });
    }
    if (mode === "INTEGRITY") {
      return json(route, 409, {
        ok: false,
        error: "REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT",
        message: "Operating queue persistence did not return a complete active-case set."
      });
    }
    if (mode === "API") {
      return json(route, 400, {
        ok: false,
        error: "INVALID_REQUEST",
        message: "The operating queue request was rejected."
      });
    }
    if (mode === "UNAUTHORIZED") {
      return json(route, 403, {
        ok: false,
        error: "FORBIDDEN",
        message: "Forbidden"
      });
    }
    return json(route, 503, {
      ok: false,
      error: "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE",
      message: "Revenue leak case persistence is temporarily unavailable."
    });
  });
  await page.goto("/#opportunities");
  await expect(page.getByText("Loading revenue leak operating queue…")).toBeVisible();
  releaseInitial();
  await expect(page.getByText("No active revenue leak cases need attention.")).toBeVisible();

  mode = "LIMIT";
  await page.getByRole("button", { name: "Refresh queue" }).click();
  await expect(page.getByRole("alert")).toContainText("safe 100-case limit");
  mode = "INTEGRITY";
  await page.getByRole("button", { name: "Retry queue" }).click();
  await expect(page.getByRole("alert")).toContainText("integrity conflict");
  mode = "PERSISTENCE";
  await page.getByRole("button", { name: "Retry queue" }).click();
  await expect(page.getByRole("alert")).toContainText("persistence unavailable");
  mode = "API";
  await page.getByRole("button", { name: "Retry queue" }).click();
  await expect(page.getByRole("alert")).toContainText("operating queue request was rejected");
  mode = "UNAUTHORIZED";
  await page.getByRole("button", { name: "Retry queue" }).click();
  await expect(page.getByRole("alert")).toContainText("not authorized");
  await expect(page.getByRole("button", { name: "Retry queue" })).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "Scan stalled opportunities"
  })).toBeDisabled();
});

test("shows explicit scan suppression/exclusion truth and refreshes the queue", async ({ page }) => {
  const reference = Date.now();
  let queueReads = 0;
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, route => {
    queueReads += 1;
    return json(route, 200, queueResponse(primaryContexts(reference), reference));
  });
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/scan-stalled-opportunities`,
    route => json(route, 200, {
      ok: true,
      evaluated_at: new Date(reference).toISOString(),
      detector: { id: "stalled-opportunity", version: "1" },
      scope: "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES",
      summary: {
        complete: true,
        limit: 100,
        total_opportunities: 4,
        evaluated_count: 4,
        unevaluated_count: 0,
        overflow_count: 0,
        invalid_record_count: 0,
        excluded_count: 0,
        reconciliation: {
          detected_count: 2,
          created_count: 0,
          replayed_count: 2,
          superseded_count: 0
        },
        outcomes: {
          ELIGIBLE_LEAK_DETECTED: { count: 2, reasons: { STALE_WITHOUT_NEXT_ACTION: 2 } },
          ELIGIBLE_NO_LEAK: { count: 1, reasons: { NEXT_ACTION_PRESENT: 1 } },
          INSUFFICIENT_EVIDENCE: { count: 0, reasons: {} },
          STALE_OR_UNTRUSTWORTHY_SOURCE: { count: 0, reasons: {} },
          DATA_HEALTH_SUPPRESSED: { count: 1, reasons: { COMMERCIAL_VALUE_INVALID: 1 } }
        }
      },
      results: [
        {
          opportunity_id: "scan-1",
          outcome: "ELIGIBLE_LEAK_DETECTED",
          reason_code: "STALE_WITHOUT_NEXT_ACTION",
          disposition: "REPLAYED",
          case_id: "scan-case-1",
          superseded_case_id: null
        },
        {
          opportunity_id: "scan-2",
          outcome: "ELIGIBLE_LEAK_DETECTED",
          reason_code: "STALE_WITHOUT_NEXT_ACTION",
          disposition: "REPLAYED",
          case_id: "scan-case-2",
          superseded_case_id: null
        },
        {
          opportunity_id: "scan-3",
          outcome: "ELIGIBLE_NO_LEAK",
          reason_code: "NEXT_ACTION_PRESENT",
          disposition: "READ_ONLY",
          case_id: null,
          superseded_case_id: null
        },
        {
          opportunity_id: "scan-4",
          outcome: "DATA_HEALTH_SUPPRESSED",
          reason_code: "COMMERCIAL_VALUE_INVALID",
          disposition: "READ_ONLY",
          case_id: null,
          superseded_case_id: null
        }
      ]
    })
  );
  await page.goto("/#opportunities");
  await page.getByRole("button", { name: "Scan stalled opportunities" }).click();
  await expect(page.locator(".rcc2-scan-summary")).toContainText("Suppressed 1");
  await expect(page.locator(".rcc2-scan-summary")).toContainText("Excluded 0");
  await expect(page.locator(".rcc2-scan-summary")).toContainText("Potential revenue leak detected");
  await expect(page.locator(".rcc2-scan-summary")).toContainText("No eligible stalled-opportunity leak");
  await expect(page.locator(".rcc2-scan-summary")).toContainText("Evidence unavailable");
  await expect(page.locator(".rcc2-scan-summary")).toContainText("Evidence stale or untrustworthy");
  await expect(page.locator(".rcc2-scan-summary")).toContainText("Evidence suppressed by Data Health");
  await expect(page.locator(".rcc2-scan-summary")).toContainText("NEXT_ACTION_PRESENT");
  await expect(page.locator(".rcc2-scan-summary")).toContainText("COMMERCIAL_VALUE_INVALID");
  await expect.poll(() => queueReads).toBeGreaterThanOrEqual(2);
});

test("explains no-opportunity and no-leak scan states without inferring success", async ({ page }) => {
  const reference = Date.now();
  let mode = "EMPTY";
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, route =>
    json(route, 200, queueResponse([], reference))
  );
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/scan-stalled-opportunities`,
    route => json(route, 200, scanStateResponse(mode, reference))
  );

  await page.goto("/#opportunities");
  await page.getByRole("button", { name: "Scan stalled opportunities" }).click();
  await expect(page.getByText(/No canonical opportunities were available/)).toBeVisible();

  mode = "NO_LEAK";
  await page.getByRole("button", { name: "Scan stalled opportunities" }).click();
  await expect(page.getByText(/No eligible stalled-opportunity leak was detected/))
    .toBeVisible();
  await expect(page.getByLabel("Complete explicit scan outcomes"))
    .toContainText("NEXT_ACTION_PRESENT");
});

function scanStateResponse(mode, reference) {
  const noLeak = mode === "NO_LEAK";
  return {
    ok: true,
    evaluated_at: new Date(reference).toISOString(),
    detector: { id: "stalled-opportunity", version: "1" },
    scope: "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES",
    summary: {
      complete: true,
      limit: 100,
      total_opportunities: noLeak ? 1 : 0,
      evaluated_count: noLeak ? 1 : 0,
      unevaluated_count: 0,
      overflow_count: 0,
      invalid_record_count: 0,
      excluded_count: 0,
      reconciliation: {
        detected_count: 0,
        created_count: 0,
        replayed_count: 0,
        superseded_count: 0
      },
      outcomes: {
        ELIGIBLE_LEAK_DETECTED: { count: 0, reasons: {} },
        ELIGIBLE_NO_LEAK: noLeak
          ? { count: 1, reasons: { NEXT_ACTION_PRESENT: 1 } }
          : { count: 0, reasons: {} },
        INSUFFICIENT_EVIDENCE: { count: 0, reasons: {} },
        STALE_OR_UNTRUSTWORTHY_SOURCE: { count: 0, reasons: {} },
        DATA_HEALTH_SUPPRESSED: { count: 0, reasons: {} }
      }
    },
    results: noLeak ? [{
      opportunity_id: "no-leak-opportunity",
      outcome: "ELIGIBLE_NO_LEAK",
      reason_code: "NEXT_ACTION_PRESENT",
      disposition: "READ_ONLY",
      case_id: null,
      superseded_case_id: null
    }] : []
  };
}

test("reconciles an ambiguous handoff from durable queue truth without a duplicate POST", async ({ page }) => {
  const reference = Date.now();
  const unlinked = caseContext({
    id: "case-handoff",
    opportunityId: "e2e-opp-stalled",
    businessName: "E2E Stalled Roofing",
    amount: "42000.5",
    currency: "AUD",
    reference
  });
  const linked = caseContext({
    id: "case-handoff",
    opportunityId: "e2e-opp-stalled",
    businessName: "E2E Stalled Roofing",
    amount: "42000.5",
    currency: "AUD",
    linked: true,
    reference
  });
  let durableLinked = false;
  let posts = 0;
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, route =>
    json(
      route,
      200,
      queueResponse([durableLinked ? linked : unlinked], reference)
    )
  );
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/case-handoff/revenue-action`,
    route => {
      posts += 1;
      durableLinked = true;
      return route.abort("failed");
    }
  );
  await page.goto("/#opportunities");
  await page.getByRole("button", { name: /Why TGE surfaced this/i }).click();
  await page.getByRole("button", { name: "Create recovery action" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Durable server truth confirms the RevenueAction link"
  );
  await expect(page.getByText("RECOMMENDED · approval required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create recovery action" })).toHaveCount(0);
  expect(posts).toBe(1);
});

test("keeps handoff controls blocked until an ambiguous mutation is reconciled", async ({ page }) => {
  const reference = Date.now();
  const context = caseContext({
    id: "case-unconfirmed",
    opportunityId: "e2e-opp-stalled",
    businessName: "E2E Stalled Roofing",
    amount: "42000.5",
    currency: "AUD",
    reference
  });
  let queueReads = 0;
  let releaseReconciliation;
  const reconciliationGate = new Promise(resolve => {
    releaseReconciliation = resolve;
  });
  let posts = 0;
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, async route => {
    queueReads += 1;
    if (queueReads > 1) await reconciliationGate;
    return json(route, 200, queueResponse([context], reference));
  });
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/case-unconfirmed/revenue-action`,
    route => {
      posts += 1;
      return route.abort("failed");
    }
  );

  await page.goto("/#opportunities");
  await page.getByRole("button", { name: /Why TGE surfaced this/i }).click();
  await page.getByRole("button", { name: "Create recovery action" }).click();
  await expect(page.getByRole("button", {
    name: "Reconciling durable truth…"
  })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Refresh/ })).toBeDisabled();
  releaseReconciliation();
  await expect(page.getByRole("alert")).toContainText("handoff not confirmed");
  await expect(page.getByRole("button", { name: "Create recovery action" })).toBeEnabled();
  expect(posts).toBe(1);
});

test("ignores a late queue response after a hash-route change", async ({ page }) => {
  const reference = Date.now();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, async route => {
    await gate;
    await json(route, 200, queueResponse(primaryContexts(reference), reference));
  });
  await page.goto("/#opportunities");
  await expect(page.getByText("Loading revenue leak operating queue…")).toBeVisible();
  await page.getByRole("button", { name: "Pipeline" }).click();
  release();
  await expect(page).toHaveURL(/#pipeline$/);
  await expect(page.getByTestId("revenue-command-center")).toHaveCount(0);
  await expect(page.getByText("What revenue needs attention?")).toHaveCount(0);
});
