import { expect, test } from "@playwright/test";

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";

test("exposes only shipped navigation and wires Dashboard CTAs", async ({ page }) => {
  await page.goto("/#dashboard");

  const navigation = page.getByRole("complementary");
  await expect(navigation.getByRole("button")).toHaveText([
    "Dashboard",
    "Prospects",
    "Opportunities",
    "Pipeline"
  ]);
  await expect(page.getByRole("button", { name: "+ New Campaign" })).toHaveCount(0);

  await page.getByRole("button", { name: "View all →" }).click();
  await expect(page).toHaveURL(/#opportunities$/);

  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "Open CRM →" }).click();
  await expect(page).toHaveURL(/#pipeline$/);
});

test("searches the live prospects surface rather than fixtures", async ({ page }) => {
  await page.goto("/#dashboard");

  await page.getByPlaceholder("Search prospects...").fill("E2E Command Plumbing");

  await expect(page).toHaveURL(/#prospects$/);
  await expect(page.getByText("E2E Command Plumbing", { exact: true })).toBeVisible();
  await expect(page.getByText("Apex Electrical", { exact: true })).toHaveCount(0);
});

test("fits the product shell inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#dashboard");

  const expectShellToFit = () =>
    expect.poll(async () =>
      page.evaluate(() => ({
        body: document.body.scrollWidth,
        viewport: document.documentElement.clientWidth
      }))
    ).toEqual({ body: 390, viewport: 390 });

  await expect(page.getByText("E2E Revenue Electrical", { exact: true })).toBeVisible();
  await expectShellToFit();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
    const search = document.querySelector(".search").getBoundingClientRect();

    return search.top >= sidebar.bottom;
  })).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));

  const destinations = [
    ["Prospects", "Prospect Intelligence"],
    ["Opportunities", "Opportunity Intelligence"],
    ["Pipeline", "Pipeline"]
  ];

  for (const [destination, heading] of destinations) {
    await page.getByRole("button", { name: destination }).click();
    await expect(page.getByRole("heading", {
      name: heading,
      exact: true,
      level: 2
    })).toBeVisible();

    if (destination === "Prospects") {
      await expect(page.getByText("E2E Command Plumbing", { exact: true })).toBeVisible();
    } else if (destination === "Opportunities") {
      await expect(page.getByTestId("opportunity-row-e2e-opp-command")).toBeVisible();
    } else {
      await expect(page.getByText("E2E Command Plumbing", { exact: true })).toBeVisible();
    }

    await expectShellToFit();
  }

  await expect(page.getByRole("button", { name: "Opportunities" })).toBeVisible();
});

test("renders unknown commercial values honestly and selects the largest known value", async ({ page }) => {
  const unknownOpportunity = {
    id: "e2e-unknown-value",
    business_name: "E2E Unknown Value Roofing",
    service: "Commercial Roofing",
    location: "Melbourne",
    stage: "QUALIFIED",
    qualification_score: 80,
    value: 0,
    probability: 0.2,
    weighted_value: 0
  };
  const unknownOpportunities = [
    unknownOpportunity,
    {
      ...unknownOpportunity,
      id: "e2e-null-value",
      business_name: "E2E Null Value Roofing",
      value: null,
      weighted_value: null
    },
    {
      ...unknownOpportunity,
      id: "e2e-blank-value",
      business_name: "E2E Blank Value Roofing",
      value: "",
      weighted_value: ""
    },
    {
      ...unknownOpportunity,
      id: "e2e-nonnumeric-value",
      business_name: "E2E Nonnumeric Value Roofing",
      value: "not-recorded",
      weighted_value: "not-recorded"
    },
    {
      id: "e2e-missing-value",
      business_name: "E2E Missing Value Roofing",
      service: "Commercial Roofing",
      location: "Melbourne",
      stage: "QUALIFIED",
      qualification_score: 80,
      probability: 0.2
    },
    {
      ...unknownOpportunity,
      id: "e2e-boolean-value",
      business_name: "E2E Boolean Value Roofing",
      value: true,
      weighted_value: true
    }
  ];
  const knownOpportunity = {
    ...unknownOpportunity,
    id: "e2e-known-value",
    business_name: "E2E Known Value Roofing",
    value: 25000,
    weighted_value: 5000
  };
  const opportunities = [
    unknownOpportunities.find(item => item.id === "e2e-nonnumeric-value"),
    knownOpportunity,
    ...unknownOpportunities.filter(item => item.id !== "e2e-nonnumeric-value")
  ];

  await page.route(`${apiBaseUrl}/api/opportunities`, route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: opportunities })
    })
  );
  await page.route(`${apiBaseUrl}/api/pipeline/metrics`, route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          pipeline_value: 0,
          weighted_pipeline_value: 0,
          by_stage: {
            QUALIFIED: { count: 1, value: 0 }
          }
        }
      })
    })
  );
  await page.route(`${apiBaseUrl}/api/intelligence/revenue`, route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          active_pipeline: {
            value: { known_total: 0, known_count: 0, unknown_count: 1 },
            weighted_value: { known_total: 0, known_count: 0, unknown_count: 1 }
          },
          revenue_requiring_attention: {
            opportunity_count: 1,
            value: { known_total: 0, known_count: 0, unknown_count: 1 }
          },
          classifications: {},
          top_actions: []
        }
      })
    })
  );
  await page.route(
    `${apiBaseUrl}/api/opportunities/${unknownOpportunity.id}/intelligence`,
    route => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          opportunity: unknownOpportunity,
          intelligence: {
            resolved: {},
            score: {},
            health: {},
            evidence: { known: [], unknown: [] },
            activity: { count: 0 },
            tasks: { open: 0 },
            next_best_action: {}
          }
        }
      })
    })
  );

  await page.goto("/#dashboard");
  await expect(page.getByText("Pipeline Value").locator("..").getByText("Unknown")).toBeVisible();
  await expect(page.getByText("Projected Revenue").locator("..").getByText("Unknown")).toBeVisible();
  const biggestOpportunity = page.getByText("Biggest Opportunity").locator("..");
  await expect(biggestOpportunity.getByText("$25,000")).toBeVisible();
  await expect(biggestOpportunity).toContainText("E2E Known Value Roofing");

  await page.getByRole("button", { name: "Opportunities" }).click();
  for (const opportunity of unknownOpportunities) {
    const unknownRow = page.getByTestId(`opportunity-row-${opportunity.id}`);
    await expect(unknownRow).toContainText("Unknown");
    await expect(unknownRow).not.toContainText("$0");
  }

  await expect(page.getByTestId(`opportunity-row-${knownOpportunity.id}`)).toContainText("$25,000");

  const row = page.getByTestId(`opportunity-row-${unknownOpportunity.id}`);
  await row.click();
  await expect(page.getByTestId("opportunity-value")).toHaveText("Unknown");
});
