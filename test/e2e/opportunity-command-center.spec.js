import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

const require = createRequire(`${process.cwd()}/package.json`);
const {
  buildRevenueLeakCaseDetection
} = require("./src/revenueLeakCases/revenueLeakCaseDomain");

const opportunityId = "e2e-opp-command";
const businessName = "E2E Command Plumbing";
const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";

async function api(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  expect(response.ok).toBeTruthy();
  return response.json();
}

function watchUnexpectedBrowserErrors(page) {
  const errors = [];

  page.on("pageerror", error => {
    errors.push({
      source: "pageerror",
      message: error.message
    });
  });

  page.on("console", message => {
    if (message.type() === "error") {
      errors.push({
        source: "console",
        type: message.type(),
        message: message.text()
      });
    }
  });

  return errors;
}

function expectOnlyExpectedFailedResourceError(browserErrors, status) {
  expect(browserErrors).toEqual([
    {
      source: "console",
      type: "error",
      message: expect.stringMatching(
        new RegExp(String.raw`Failed to load resource:.*${status} \(.*\)`)
      )
    }
  ]);
}

test("opens exact seeded opportunity, closes the intelligence loop, and preserves hash navigation", async ({ page }) => {
  const browserErrors = watchUnexpectedBrowserErrors(page);

  await page.goto("/#all-opportunities");

  const row = page.getByTestId(`opportunity-row-${opportunityId}`);
  await expect(row).toContainText(businessName);
  await row.click();

  await expect(page).toHaveURL(new RegExp(`#opportunities/${opportunityId}\\?return=all-opportunities$`));
  await expect(page.getByTestId("opportunity-command-center")).toContainText(businessName);
  await expect(page.getByText("OPPORTUNITY COMMAND CENTER")).toBeVisible();

  await page.goto(`/#opportunities/${opportunityId}?return=all-opportunities`);
  await expect(page.getByRole("heading", { name: businessName })).toBeVisible();
  await expect(page.getByText("This is not a probability of closing.")).toBeVisible();
  await expect(page.getByTestId("opportunity-value")).toHaveText(
    "15,000 · Currency unknown"
  );

  const before = await api(`/api/opportunities/${opportunityId}/intelligence`);
  expect(before.data.intelligence.tasks.open).toBe(0);
  expect(before.data.intelligence.activity.count).toBe(1);
  expect(before.data.intelligence.evidence.unknown).toContain("Decision maker/contact identified");

  await page.getByTestId("prepare-revenue-action").click();
  await expect(page.getByTestId("internal-task-proposal")).toBeVisible();
  await page.getByTestId("approve-revenue-action").click();
  await expect(page.getByTestId("revenue-action-status")).toHaveText("APPROVED");
  await page.getByTestId("execute-revenue-action").click();

  await expect(page.getByTestId("revenue-action-success")).toContainText("Execution state updated.");
  await expect(page.getByTestId("open-task-count")).toHaveText(/1/);
  await expect(page.getByTestId("activity-count")).toHaveText(/2/);
  await expect(page.getByTestId("revenue-action-history")).toContainText("EXECUTED");

  const tasks = await api(`/api/tasks/opportunity/${opportunityId}`);
  expect(tasks.count).toBe(1);
  expect(tasks.data[0].metadata.action_type).toBe("RESEARCH");
  expect(tasks.data[0].metadata.revenue_action_id).toBeTruthy();

  const activities = await api(`/api/opportunities/${opportunityId}/activities`);
  expect(activities.count).toBe(2);
  expect(activities.data.map(item => item.type)).toContain("REVENUE_ACTION_TASK_EXECUTED");

  const after = await api(`/api/opportunities/${opportunityId}/intelligence`);
  expect(after.data.intelligence.tasks.open).toBe(1);
  expect(after.data.intelligence.activity.count).toBe(2);
  expect(after.data.intelligence.health.status).not.toBe("UNKNOWN");

  await page.getByRole("button", { name: "← Back to opportunities" }).click();
  await expect(page).toHaveURL(/#all-opportunities$/);
  await expect(page.getByTestId(`opportunity-row-${opportunityId}`)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#opportunities/${opportunityId}\\?return=all-opportunities$`));
  await expect(page.getByRole("heading", { name: businessName })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("in-place opportunity navigation clears an unsaved currency draft", async ({ page }) => {
  await page.goto("/#opportunities/e2e-opp-stalled");

  const currency = page.getByLabel("Opportunity currency code").first();
  await expect(currency).toBeVisible();
  await currency.fill("NZD");
  await expect(currency).toHaveValue("NZD");

  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-command";
  });
  await expect(page).toHaveURL(/#opportunities\/e2e-opp-command$/);
  await expect(page.getByRole("heading", { name: businessName })).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-stalled";
  });
  await expect(page).toHaveURL(/#opportunities\/e2e-opp-stalled$/);
  await expect(page.getByLabel("Opportunity currency code").first()).toHaveValue("");
});

test("shows a practical API failure state without crashing", async ({ page }) => {
  const browserErrors = watchUnexpectedBrowserErrors(page);

  await page.route(`${apiBaseUrl}/api/opportunities`, async route => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "E2E_FORCED_FAILURE"
      })
    });
  });

  await page.goto("/#all-opportunities");

  await expect(page.getByText("E2E_FORCED_FAILURE")).toBeVisible();
  await expect(
    page
      .getByTestId("app-main")
      .getByRole("button", { name: "↻ Refresh", exact: true })
  ).toBeVisible();

  // Chromium reports a native console diagnostic for the intentionally mocked
  // 500. The exact structured event contract still rejects page errors and
  // every additional console error.
  expectOnlyExpectedFailedResourceError(browserErrors, 500);
});

test("keeps opportunity data available when only revenue intelligence is unavailable", async ({ page }) => {
  const browserErrors = watchUnexpectedBrowserErrors(page);

  await page.route(`${apiBaseUrl}/api/intelligence/revenue`, async route => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "REVENUE_INTELLIGENCE_UNAVAILABLE"
      })
    });
  });

  await page.goto("/#all-opportunities");

  await expect(page.getByTestId(`opportunity-row-${opportunityId}`)).toContainText(businessName);

  // Chromium reports a native console diagnostic for the intentionally mocked
  // 503. The exact structured event contract still rejects page errors and
  // every additional console error.
  expectOnlyExpectedFailedResourceError(browserErrors, 503);
});

test("renders all-unknown revenue totals as unknown rather than zero", async ({ page }) => {
  const browserErrors = watchUnexpectedBrowserErrors(page);

  await page.route(`${apiBaseUrl}/api/intelligence/revenue`, async route => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          generated_at: "2026-08-28T00:00:00.000Z",
          value_semantics: {
            commercial_value_known_only_when_positive: true,
            zero_blank_or_non_numeric_value_is_unknown: true
          },
          active_pipeline: {
            count: 2,
            value: {
              known_total: 0,
              known_count: 0,
              unknown_count: 2
            },
            weighted_value: {
              known_total: 0,
              known_count: 0,
              unknown_count: 2
            }
          },
          classifications: {
            VALUE_UNKNOWN: {
              count: 2,
              value: {
                known_total: 0,
                known_count: 0,
                unknown_count: 2
              }
            }
          },
          revenue_requiring_attention: {
            opportunity_count: 2,
            value: {
              known_total: 0,
              known_count: 0,
              unknown_count: 2
            }
          },
          top_actions: []
        }
      })
    });
  });

  await page.goto("/#opportunities");

  await expect(page.getByTestId("revenue-active-pipeline-value")).toHaveText("Unknown");
  await expect(page.getByTestId("revenue-weighted-pipeline-value")).toHaveText("Unknown");
  await expect(
    page.getByTestId("revenue-classification-value_unknown")
  ).toHaveText("Value unknown: 2");

  expect(browserErrors).toEqual([]);
});

test("renders a ranked action with its exact authoritative currency and decimal", async ({ page }) => {
  await page.route(`${apiBaseUrl}/api/intelligence/revenue`, async route => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          active_pipeline: null,
          classifications: {},
          revenue_requiring_attention: null,
          top_actions: [{
            opportunity_id: opportunityId,
            business_name: businessName,
            action: {
              priority: "HIGH",
              type: "FOLLOW_UP",
              title: "Follow up on exact value"
            },
            value: {
              known: true,
              amount: "99999999999999.999999",
              currency: "NZD"
            }
          }]
        }
      })
    });
  });

  await page.goto("/#opportunities");

  await expect(page.getByTestId(`revenue-action-${opportunityId}`)).toContainText(
    "NZD 99,999,999,999,999.999999"
  );
});

test("opens a ranked portfolio action, applies a safe Command Center mutation, and refreshes the portfolio on return", async ({ page }) => {
  const browserErrors = watchUnexpectedBrowserErrors(page);

  await page.goto("/#opportunities");

  await page.getByText("Operator diagnostics · Legacy opportunity guidance").click();
  const action = page.getByTestId("revenue-action-e2e-opp-revenue");
  await expect(action).toContainText("Identify the decision maker");
  await action.click();

  await expect(page).toHaveURL(/#opportunities\/e2e-opp-revenue$/);
  await expect(page.getByTestId("opportunity-command-center")).toBeVisible();

  await page.getByTestId("contact-name-input").fill("E2E Decision Maker");
  await page.getByTestId("add-contact").click();
  await expect(page.getByTestId("action-success")).toContainText("Action completed successfully.");

  await page.getByRole("button", { name: "← Back to opportunities" }).click();
  await expect(page).toHaveURL(/#opportunities$/);
  await expect(page.getByTestId("revenue-command-center")).toBeVisible();
  await expect(action).toContainText("Begin qualified outreach");

  expect(browserErrors).toEqual([]);
});

test("prepares, approves, and manually confirms a ranked communication action with refreshed portfolio state", async ({ page }) => {
  const browserErrors = watchUnexpectedBrowserErrors(page);

  await page.goto("/#opportunities");

  await page.getByText("Operator diagnostics · Legacy opportunity guidance").click();
  const rankedAction = page.getByTestId("revenue-action-e2e-opp-execution");
  await expect(rankedAction).toContainText("FOLLOW_UP");
  await rankedAction.click();

  await expect(page).toHaveURL(/#opportunities\/e2e-opp-execution$/);
  await page.getByTestId("prepare-revenue-action").click();
  await expect(page.getByTestId("communication-draft")).toContainText("Email draft · not sent by TGE");
  await expect(page.getByTestId("communication-draft")).toContainText("Morgan Lee");
  const execution = page.getByTestId("revenue-action-execution");
  await expect(execution.getByRole("heading", {
    name: "Review → Approve → Mark completed manually"
  })).toBeVisible();
  await expect(execution.getByLabel("Human-controlled action steps"))
    .toContainText("Complete manually");
  await expect(execution.getByLabel("Human-controlled action steps"))
    .toContainText("TGE does not send.");

  await page.getByTestId("approve-revenue-action").click();
  await expect(page.getByTestId("revenue-action-status")).toHaveText("APPROVED");
  await page.getByTestId("execute-revenue-action").click();

  await expect(page.getByTestId("revenue-action-history")).toContainText("EXECUTED");
  await expect(page.getByTestId("revenue-action-history")).toContainText("CRM activity linked");
  await expect(page.getByTestId("manual-communication-completion"))
    .toContainText("Manual completion recorded");
  await expect(page.getByTestId("manual-communication-completion"))
    .toContainText("No message was sent by TGE");
  await expect(page.getByTestId("activity-count")).toHaveText(/2/);

  const activities = await api("/api/opportunities/e2e-opp-execution/activities");
  expect(activities.data.map(item => item.type)).toContain(
    "REVENUE_ACTION_MANUALLY_CONFIRMED"
  );

  await page.getByRole("button", { name: "← Back to opportunities" }).click();
  await expect(page).toHaveURL(/#opportunities$/);
  await expect(rankedAction).toContainText("ADVANCE");

  expect(browserErrors).toEqual([]);
});

test("binds task completion to the current workflow when an older task result exists", async ({ page }) => {
  const olderExecuted = {
    id: "older-executed-task",
    opportunity_id: opportunityId,
    action_type: "RESEARCH",
    execution_type: "INTERNAL_TASK",
    priority: "MEDIUM",
    title: "Older completed research task",
    reason: "Historical recommendation",
    status: "EXECUTED",
    proposed_execution: {
      type: "INTERNAL_TASK",
      title: "Historical task",
      description: "Already completed",
      priority: "MEDIUM"
    },
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T02:00:00.000Z",
    executed_at: "2026-08-01T02:00:00.000Z",
    resulting_task_id: "historical-task-id",
    resulting_activity_id: "historical-activity-id",
    execution_result: {
      mode: "INTERNAL_TASK",
      outcome: "TASK_CREATED"
    }
  };
  const currentPrepared = {
    id: "current-prepared-task",
    opportunity_id: opportunityId,
    action_type: "RESEARCH",
    execution_type: "INTERNAL_TASK",
    priority: "HIGH",
    title: "Current prepared research task",
    reason: "Current recommendation",
    status: "PREPARED",
    proposed_execution: {
      type: "INTERNAL_TASK",
      title: "Current task",
      description: "Awaiting approval",
      priority: "HIGH"
    },
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T01:00:00.000Z",
    prepared_at: "2026-09-01T01:00:00.000Z"
  };

  await page.route(`${apiBaseUrl}/api/revenue-actions?*`, route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [olderExecuted, currentPrepared],
        count: 2
      })
    })
  );

  await page.goto(`/#opportunities/${opportunityId}?focus=action`);

  const execution = page.getByTestId("revenue-action-execution");
  await expect(execution.getByTestId("revenue-action-status")).toHaveText("PREPARED");
  await expect(execution.getByTestId("internal-task-completion")).toHaveCount(0);
  await expect(execution.getByRole("button", {
    name: "Prepare another recommended action"
  })).toHaveCount(0);
  const history = execution.getByTestId("revenue-action-history");
  await expect(history).toContainText("Older completed research task");
  await expect(history).toContainText("2026-08-01T02:00:00.000Z");
  await expect(history).toContainText("Current prepared research task");
});

test("keeps originating case known zero separate from current opportunity intelligence", async ({ page }) => {
  const caseId = "known-zero-origin-case";
  const actionId = "known-zero-origin-action";
  const knownZeroCaseBase = buildRevenueLeakCaseDetection({
      leak_type: "STALLED_OPPORTUNITY",
      source: {
        system: "TGE",
        entity_type: "OPPORTUNITY",
        entity_id: "e2e-opp-stalled",
        observed_at: "2026-09-08T08:00:00.000Z",
        observed_version: "known-zero-source"
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
          entity_id: "known-zero-activity",
          at: "2026-08-15T08:00:00.000Z"
        },
        stalled_since: "2026-08-29T08:00:00.000Z",
        next_action: {
          present: false,
          source: "NONE",
          opportunity_value: null,
          active_task_ids: []
        },
        source_freshness: {
          observed_at: "2026-09-08T08:00:00.000Z",
          maximum_age_days: 90
        },
        commercial_value_basis: {
          classification: "KNOWN",
          amount_source: "opportunity.value",
          currency_source: "opportunity.currency"
        }
      },
      commercial_value: {
        classification: "KNOWN",
        amount: "0.000000",
        currency: "AUD"
      },
      recommended_action_type: "FOLLOW_UP",
      due_at: null,
      supersession_condition: {
        kind: "CANONICAL_EVIDENCE_CHANGED",
        detector_id: "stalled-opportunity",
        detector_version: "1"
      }
    }, {
      id: caseId,
      detectedAt: "2026-09-08T08:00:00.000Z",
      subjectId: "auth0|pilot-e2e"
    });
  const linkedAt = "2026-09-09T07:00:00.000Z";
  const fingerprint = "d".repeat(64);
  const knownZeroCase = {
    ...knownZeroCaseBase,
    revenue_action_id: actionId,
    revenue_action_fingerprint: fingerprint,
    revenue_action_status_at_link: "RECOMMENDED",
    revenue_action_linked_at: linkedAt,
    updated_at: linkedAt,
    audit: [...knownZeroCaseBase.audit, {
      transition: "REVENUE_ACTION_LINKED",
      at: linkedAt,
      subject_id: "auth0|pilot-e2e",
      revenue_action_id: actionId,
      revenue_action_fingerprint: fingerprint,
      revenue_action_status: "RECOMMENDED"
    }]
  };

  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases?opportunity_id=e2e-opp-stalled`,
    route => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [knownZeroCase], count: 1 })
    })
  );
  await page.route(`${apiBaseUrl}/api/revenue-actions?*`, route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [], count: 0 })
    })
  );

  await page.goto(
    `/#opportunities/e2e-opp-stalled?focus=action&case=${caseId}&action=${actionId}`
  );

  const originatingCase = page.getByTestId("revenue-action-execution")
    .getByLabel("Originating revenue leak case");
  await expect(originatingCase).toContainText("Known zero");
  await expect(originatingCase).toContainText("AUD 0");
  await expect(originatingCase).toContainText("Current opportunity intelligence");
  await expect(page.getByTestId("opportunity-value")).toHaveText("Unknown");
});

test("keeps a prepared draft visible when approval fails without crashing", async ({ page }) => {
  const browserErrors = watchUnexpectedBrowserErrors(page);

  await page.goto("/#opportunities/e2e-opp-execution-failure");
  await page.getByTestId("prepare-revenue-action").click();
  await expect(page.getByTestId("communication-draft")).toContainText("Taylor Reed");

  await page.route(
    `${apiBaseUrl}/api/revenue-actions/*/approve`,
    async route => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "E2E_REVENUE_ACTION_APPROVE_FAILED",
          message: "Approval is temporarily unavailable."
        })
      });
    }
  );

  await page.getByTestId("approve-revenue-action").click();
  await expect(page.getByTestId("revenue-action-error")).toContainText(
    "Approval is temporarily unavailable."
  );
  await expect(page.getByTestId("communication-draft")).toContainText("Taylor Reed");
  await expect(page.getByTestId("approve-revenue-action")).toBeVisible();
  expectOnlyExpectedFailedResourceError(browserErrors, 500);
});
