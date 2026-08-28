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
    errors.push(error.message);
  });

  page.on("console", message => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  return errors;
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

  expect(browserErrors).toEqual([]);
});
