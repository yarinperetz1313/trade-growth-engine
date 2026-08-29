import { expect, test } from "@playwright/test";

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

  await page.goto("/#opportunities");

  const row = page.getByTestId(`opportunity-row-${opportunityId}`);
  await expect(row).toContainText(businessName);
  await row.click();

  await expect(page).toHaveURL(new RegExp(`#opportunities/${opportunityId}$`));
  await expect(page.getByTestId("opportunity-command-center")).toContainText(businessName);
  await expect(page.getByText("OPPORTUNITY COMMAND CENTER")).toBeVisible();

  await page.goto(`/#opportunities/${opportunityId}`);
  await expect(page.getByRole("heading", { name: businessName })).toBeVisible();
  await expect(page.getByText("This is not a probability of closing.")).toBeVisible();
  await expect(page.getByTestId("opportunity-value")).toContainText("$15,000");

  const before = await api(`/api/opportunities/${opportunityId}/intelligence`);
  expect(before.data.intelligence.tasks.open).toBe(0);
  expect(before.data.intelligence.activity.count).toBe(1);
  expect(before.data.intelligence.evidence.unknown).toContain("Decision maker/contact identified");

  await page.getByTestId("create-intelligence-task").click();

  await expect(page.getByTestId("action-success")).toContainText("Action completed successfully.");
  await expect(page.getByTestId("open-task-count")).toHaveText(/1/);
  await expect(page.getByTestId("activity-count")).toHaveText(/2/);

  const tasks = await api(`/api/tasks/opportunity/${opportunityId}`);
  expect(tasks.count).toBe(1);
  expect(tasks.data[0].metadata.action_type).toBe("RESEARCH");

  const activities = await api(`/api/opportunities/${opportunityId}/activities`);
  expect(activities.count).toBe(2);
  expect(activities.data.map(item => item.type)).toContain("INTELLIGENCE_TASK_CREATED");

  const after = await api(`/api/opportunities/${opportunityId}/intelligence`);
  expect(after.data.intelligence.tasks.open).toBe(1);
  expect(after.data.intelligence.activity.count).toBe(2);
  expect(after.data.intelligence.health.status).not.toBe("UNKNOWN");

  await page.getByRole("button", { name: "← Back to opportunities" }).click();
  await expect(page).toHaveURL(/#opportunities$/);
  await expect(page.getByTestId(`opportunity-row-${opportunityId}`)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#opportunities/${opportunityId}$`));
  await expect(page.getByRole("heading", { name: businessName })).toBeVisible();

  expect(browserErrors).toEqual([]);
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

  await page.goto("/#opportunities");

  await expect(page.getByText("E2E_FORCED_FAILURE")).toBeVisible();
  await expect(page.getByRole("button", { name: /Refresh/ })).toBeVisible();

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

  await page.goto("/#opportunities");

  await expect(page.getByText("Unable to load revenue intelligence.")).toBeVisible();
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

test("opens a ranked portfolio action, applies a safe Command Center mutation, and refreshes the portfolio on return", async ({ page }) => {
  const browserErrors = watchUnexpectedBrowserErrors(page);

  await page.goto("/#opportunities");

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
