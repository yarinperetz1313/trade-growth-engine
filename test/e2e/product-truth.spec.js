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
  await expect(page.locator(".avatar")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Growth overview." })).toBeVisible();
  await expect(page.getByText("Qualified Opportunities", { exact: true })).toBeVisible();
  await expect(page.getByText("Highest-scoring opportunities, with estimated value as the tie-breaker.")).toBeVisible();
  await expect(page.getByText("Priority Review", { exact: true })).toBeVisible();
  await expect(page.getByText(/requires attention/i)).toHaveCount(0);
  await expect(page.getByText("Best ICP", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Good morning.", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.locator(".intelligence-grid").evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.split(" ").length
  )).toBe(3);

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
  const fallbackWeightedOpportunity = {
    ...unknownOpportunity,
    id: "e2e-fallback-weighted",
    business_name: "E2E Fallback Weighted Roofing",
    value: 12000,
    probability: 0.2,
    weighted_value: null
  };
  const opportunities = [
    unknownOpportunities.find(item => item.id === "e2e-nonnumeric-value"),
    knownOpportunity,
    fallbackWeightedOpportunity,
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
  for (const opportunity of [
    unknownOpportunity,
    unknownOpportunities.find(item => item.id === "e2e-boolean-value")
  ]) {
    await page.route(
      `${apiBaseUrl}/api/opportunities/${opportunity.id}/intelligence`,
      route => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            opportunity,
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
  }

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
  await expect(page.getByTestId(`opportunity-row-${knownOpportunity.id}`)).toContainText("20%");
  await expect(page.getByTestId(`opportunity-row-${knownOpportunity.id}`)).toContainText("$5,000");
  await expect(page.getByTestId(`opportunity-row-${fallbackWeightedOpportunity.id}`)).toContainText("20%");
  await expect(page.getByTestId(`opportunity-row-${fallbackWeightedOpportunity.id}`)).toContainText("$2,400");

  await page.getByRole("button", { name: "Pipeline" }).click();
  await expect(page.getByText("Weighted Pipeline", { exact: true }).locator("..")).toContainText("$7,400");
  await page.getByRole("button", { name: "Opportunities" }).click();

  await page.getByTestId("opportunity-row-e2e-boolean-value").click();
  await expect(page.getByRole("button", { name: "Set Value", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← Back to opportunities" }).click();

  const row = page.getByTestId(`opportunity-row-${unknownOpportunity.id}`);
  await row.click();
  await expect(page.getByTestId("opportunity-value")).toHaveText("Unknown");

  const setValue = page.getByRole("button", { name: "Set Value", exact: true });
  const secondaryValueInput = setValue.locator("xpath=preceding-sibling::input");
  await secondaryValueInput.fill("0");
  await expect(setValue).toBeDisabled();
  await secondaryValueInput.fill("-10");
  await expect(setValue).toBeDisabled();
});

test("keeps initial core request failures distinct from empty and known-zero states", async ({ page }) => {
  await page.route(`${apiBaseUrl}/api/prospects`, route =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Prospect data unavailable." })
    })
  );
  await page.route(`${apiBaseUrl}/api/opportunities`, route =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Opportunity data unavailable." })
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
          by_stage: {}
        }
      })
    })
  );

  await page.goto("/#prospects");
  await expect(page.getByText("Prospect data unavailable.")).toBeVisible();
  await expect(page.getByText("No prospects found yet.")).toHaveCount(0);

  await page.getByRole("button", { name: "Pipeline" }).click();
  await expect(page.getByText("Opportunity data unavailable.")).toBeVisible();
  await expect(page.getByText("No opportunities")).toHaveCount(0);
  await expect(page.getByText("Open Pipeline").locator("..").getByText("Unknown")).toBeVisible();
  await expect(page.getByText("Active Opportunities").locator("..").getByText("Unknown")).toBeVisible();

  await page.getByRole("button", { name: "Opportunities" }).click();
  await expect(page.getByText("Opportunity data unavailable.")).toBeVisible();
  await expect(page.getByText("No opportunities found.")).toHaveCount(0);
  await expect(page.getByText("Opportunity actions are unavailable until opportunity data can be loaded.")).toBeVisible();
  await expect(page.locator('[data-testid^="revenue-action-"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByText("Unable to load opportunities.")).toBeVisible();
  await expect(page.getByText("Growth intelligence unavailable.")).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);

  for (const metric of [
    "Pipeline Value",
    "Qualified Opportunities",
    "Opportunity Score",
    "Projected Revenue"
  ]) {
    const card = page.getByText(metric, { exact: true }).locator("..");
    await expect(card.getByText("Unknown", { exact: true })).toBeVisible();
    await expect(card.getByText("Unavailable", { exact: true })).toBeVisible();
  }
});

test("keeps loaded prospects visible when opportunity creation fails", async ({ page }) => {
  await page.route(
    `${apiBaseUrl}/api/opportunities/from-prospect/e2e-prospect-unconverted`,
    route => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Opportunity creation unavailable." })
    })
  );
  await page.goto("/#prospects");

  const prospectRow = page.getByText("E2E Unconverted Roofing", { exact: true }).locator("..");
  await prospectRow.getByRole("button", { name: "Create opportunity →" }).click();

  await expect(page.getByText("Opportunity creation unavailable.")).toBeVisible();
  await expect(page.getByText("E2E Command Plumbing", { exact: true })).toBeVisible();
  await expect(prospectRow.getByRole("button", { name: "Retry opportunity creation →" })).toBeVisible();
});

test("executes the remaining low-cost core CTA success paths", async ({ page }) => {
  await page.goto("/#prospects");

  const convertedRow = page.getByText("E2E Command Plumbing", { exact: true }).locator("..");
  await convertedRow.getByRole("button", { name: "Create opportunity →" }).click();
  await expect(convertedRow.getByText("Opportunity already exists", { exact: true })).toBeVisible();

  const prospectRow = page.getByText("E2E Unconverted Roofing", { exact: true }).locator("..");
  await prospectRow.getByRole("button", { name: "Create opportunity →" }).click();
  await expect(prospectRow.getByText("Opportunity created", { exact: true })).toBeVisible();

  const persisted = await page.request.get(`${apiBaseUrl}/api/opportunities`);
  expect(persisted.ok()).toBe(true);
  expect((await persisted.json()).data).toEqual(expect.arrayContaining([
    expect.objectContaining({ prospect_id: "e2e-prospect-unconverted" })
  ]));

  await page.getByRole("button", { name: "Pipeline" }).click();
  const pipelineCard = page.locator(".deal-card").filter({
    hasText: "E2E Command Plumbing"
  });
  const stage = pipelineCard.getByRole("combobox");

  await stage.selectOption("CONTACTED");
  await expect(stage).toHaveValue("CONTACTED");
  await stage.selectOption("QUALIFIED");
  await expect(stage).toHaveValue("QUALIFIED");
});
