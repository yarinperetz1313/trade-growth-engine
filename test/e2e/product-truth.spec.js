import path from "node:path";
import { expect, test } from "@playwright/test";

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";

test("exposes one revenue operating home and keeps the pipeline overview distinct", async ({ page }) => {
  await page.goto("/#dashboard");

  const navigation = page.getByRole("complementary");
  await expect(navigation.getByRole("button")).toHaveText([
    "Revenue attention",
    "All opportunities",
    "Pipeline overview",
    "Pipeline",
    "Prospects",
    "Imports"
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
  await expect(page).toHaveURL(/#all-opportunities$/);
  await expect(page.getByRole("heading", { name: "Complete opportunity portfolio", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Pipeline overview" }).click();
  await page.getByRole("button", { name: "Open CRM →" }).click();
  await expect(page).toHaveURL(/#pipeline$/);
});

test("defaults to revenue attention and renders a labelled mobile opportunity portfolio", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".topbar h1")).toHaveText("Revenue attention");
  await expect(page.getByTestId("revenue-command-center")).toBeVisible();
  await expect(page.getByPlaceholder("Search prospects...")).toHaveCount(0);

  await page.goto("/#not-a-shipped-route");
  await expect(page.locator(".topbar h1")).toHaveText("Revenue attention");
  await expect(page.getByTestId("revenue-command-center")).toBeVisible();

  await page.getByRole("button", { name: "All opportunities", exact: true }).click();
  const portfolio = page.getByLabel("All opportunities portfolio");
  await expect(portfolio).toBeVisible();
  await expect(portfolio.locator(".opportunity-portfolio-header")).toBeHidden();
  const card = page.getByTestId("opportunity-row-e2e-opp-command");
  await expect(card).toContainText("Commercial value");
  await expect(card).toContainText("Probability");
  await expect(card).toContainText("Weighted value");
  await expect(card).toContainText("Stage");
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth
  }))).toEqual({ body: 390, viewport: 390 });
  if (process.env.TGE_EVIDENCE_DIR) {
    await page.screenshot({
      fullPage: true,
      path: path.join(process.env.TGE_EVIDENCE_DIR, "04-mobile-all-opportunities.png")
    });
  }
});

test("searches the live prospects surface rather than fixtures", async ({ page }) => {
  await page.goto("/#prospects");

  await page.getByPlaceholder("Search prospects...").fill("E2E Command Plumbing");

  await expect(page).toHaveURL(/#prospects$/);
  await expect(page.getByText("E2E Command Plumbing", { exact: true })).toBeVisible();
  await expect(page.getByText("Apex Electrical", { exact: true })).toHaveCount(0);
});

test("fits the product shell inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#all-opportunities");

  const expectShellToFit = () =>
    expect.poll(async () =>
      page.evaluate(() => ({
        body: document.body.scrollWidth,
        viewport: document.documentElement.clientWidth
      }))
    ).toEqual({ body: 390, viewport: 390 });

  await expect(page.getByTestId("opportunity-row-e2e-opp-revenue")).toBeVisible();
  await expectShellToFit();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));

  const destinations = [
    ["Prospects", "Prospect Intelligence", 2],
    ["Revenue attention", "Find the first credible revenue problem", 3],
    ["All opportunities", "Complete opportunity portfolio", 2],
    ["Pipeline", "Pipeline", 2]
  ];

  for (const [destination, heading, level] of destinations) {
    await page.getByRole("button", { name: destination, exact: true }).click();
    await expect(page.getByRole("heading", {
      name: heading,
      exact: true,
      level
    })).toBeVisible();

    if (destination === "Prospects") {
      await expect(page.getByText("E2E Command Plumbing", { exact: true })).toBeVisible();
    } else if (destination === "All opportunities") {
      await expect(page.getByTestId("opportunity-row-e2e-opp-command")).toBeVisible();
    } else if (destination === "Pipeline") {
      await expect(page.getByText("E2E Command Plumbing", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByTestId("revenue-command-center")).toBeVisible();
    }

    await expectShellToFit();
  }

  await expect(page.getByRole("button", { name: "Revenue attention" })).toBeVisible();
});

test("renders unknown commercial values honestly and withholds an unsafe biggest-value comparison", async ({ page }) => {
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
    currency: "NZD",
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
  const pipelineValueSummary = {
    known_total: null,
    known_total_currency: null,
    known_total_withheld: true,
    known_count: 2,
    unknown_count: 6,
    withheld_count: 1,
    totals_by_currency: [{ currency: "NZD", amount: "25000", count: 1 }]
  };
  const weightedPipelineValueSummary = {
    known_total: "5000",
    known_total_currency: "NZD",
    known_total_withheld: false,
    known_count: 1,
    unknown_count: 7,
    withheld_count: 0,
    totals_by_currency: [{ currency: "NZD", amount: "5000", count: 1 }]
  };

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
          pipeline_value: null,
          pipeline_value_summary: pipelineValueSummary,
          weighted_pipeline_value: "5000",
          weighted_pipeline_value_summary: weightedPipelineValueSummary,
          by_stage: {
            QUALIFIED: {
              count: 8,
              value: null,
              value_summary: pipelineValueSummary
            }
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
  await expect(page.getByText("Pipeline Value").locator("..")).toContainText(
    "NZD 25,000 · 1 known value withheld (currency unavailable or invalid)"
  );
  await expect(page.getByText("Projected Revenue").locator("..")).toContainText("NZD 5,000");
  const biggestOpportunity = page.getByText("Biggest Opportunity").locator("..");
  await expect(biggestOpportunity).toContainText("Unknown");
  await expect(biggestOpportunity).toContainText(
    "A biggest opportunity cannot be inferred while a known value lacks authoritative currency."
  );
  await expect(biggestOpportunity).not.toContainText("E2E Known Value Roofing");
  await expect(
    page.locator(".opportunity").filter({ hasText: "E2E Known Value Roofing" })
  ).toContainText("NZD 25,000");

  await page.getByRole("button", { name: "All opportunities" }).click();
  for (const opportunity of unknownOpportunities) {
    const unknownRow = page.getByTestId(`opportunity-row-${opportunity.id}`);
    await expect(unknownRow).toContainText("Unknown");
    await expect(unknownRow).not.toContainText("$0");
  }

  await expect(page.getByTestId(`opportunity-row-${knownOpportunity.id}`)).toContainText("NZD 25,000");
  await expect(page.getByTestId(`opportunity-row-${knownOpportunity.id}`)).toContainText("20%");
  await expect(page.getByTestId(`opportunity-row-${knownOpportunity.id}`)).toContainText("NZD 5,000");
  await expect(page.getByTestId(`opportunity-row-${fallbackWeightedOpportunity.id}`)).toContainText("20%");
  await expect(page.getByTestId(`opportunity-row-${fallbackWeightedOpportunity.id}`)).toContainText("Unknown");
  await expect(page.getByTestId(`opportunity-row-${fallbackWeightedOpportunity.id}`)).not.toContainText("2,400");

  await page.getByRole("button", { name: "Pipeline", exact: true }).click();
  await expect(page.getByText("Open Pipeline", { exact: true }).locator("..")).toContainText(
    "NZD 25,000 · 1 known value withheld (currency unavailable or invalid)"
  );
  await expect(page.getByText("Weighted Pipeline", { exact: true }).locator("..")).toContainText("NZD 5,000");
  await expect(page.getByText("Weighted Pipeline", { exact: true }).locator("..")).not.toContainText("7,400");
  await expect(
    page.locator(".deal-card").filter({ hasText: "E2E Known Value Roofing" })
  ).toContainText("NZD 25,000");
  await page.getByRole("button", { name: "All opportunities" }).click();

  await page.getByTestId("opportunity-row-e2e-boolean-value").click();
  await expect(page.getByRole("button", { name: "Set Value", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← Back to opportunities" }).click();

  const row = page.getByTestId(`opportunity-row-${unknownOpportunity.id}`);
  await row.click();
  await expect(page.getByTestId("opportunity-value")).toHaveText("Unknown");

  const setValue = page.getByRole("button", { name: "Set Value", exact: true });
  const secondaryValueInput = setValue.locator("xpath=preceding-sibling::input[@type='number']");
  await secondaryValueInput.fill("0");
  await expect(setValue).toBeDisabled();
  await secondaryValueInput.fill("-10");
  await expect(setValue).toBeDisabled();
  await secondaryValueInput.fill("100");
  const currencyInput = setValue.locator(
    "xpath=preceding-sibling::input[@aria-label='Opportunity currency code']"
  );
  await currencyInput.fill("aud");
  await expect(setValue).toBeDisabled();
  await currencyInput.fill("AUD");
  await expect(setValue).toBeEnabled();
});

test("individual weighted displays agree with exact revenue truth and never infer missing evidence", async ({ page }) => {
  const fixtures = [
    ["9007199254740.123456", "9007199254740.123455", "AUD 9,007,199,254,740.123455"],
    ["9007199254740.123456", `9007199254740.123456${"0".repeat(110)}`, "AUD 9,007,199,254,740.123456"],
    ["9007199254740.123456", undefined, "Unknown"],
    [null, "100.000001", "Unknown"],
    ["0", "100.000001", "Unknown"],
    ["100", "0", "Unknown"]
  ];
  let current;
  let expected;
  const fulfill = (route, data) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  await page.route(`${apiBaseUrl}/api/opportunities`, route => fulfill(route, [current]));
  await page.route(`${apiBaseUrl}/api/opportunities/astra-weighted/intelligence`, route => fulfill(route, {
    opportunity: current,
    intelligence: { resolved: {}, score: {}, health: {}, evidence: { known: [], unknown: [] }, activity: { count: 0 }, tasks: { open: 0 }, next_best_action: {} }
  }));
  await page.route(`${apiBaseUrl}/api/opportunities/astra-weighted/revenue-actions`, route => fulfill(route, []));
  await page.route(`${apiBaseUrl}/api/intelligence/revenue`, route => {
    const summary = {
      known_total: 0, known_count: 0, unknown_count: 1, withheld_count: 0, totals_by_currency: []
    };
    if (expected !== "Unknown") {
      summary.known_count = 1;
      summary.unknown_count = 0;
      summary.totals_by_currency = [{ currency: "AUD", amount: expected.slice(4).replaceAll(",", ""), count: 1 }];
    }
    return fulfill(route, {
      active_pipeline: { value: summary, weighted_value: summary },
      revenue_requiring_attention: { opportunity_count: 0, value: summary }, classifications: {}, top_actions: []
    });
  });
  for (const [index, [value, weighted_value, display]] of fixtures.entries()) {
    current = { id: "astra-weighted", business_name: "Exact weighted trade", stage: "QUALIFIED", probability: 1, value, weighted_value, currency: "AUD" };
    expected = display;
    await page.goto(`/?weighted-case=${index}#opportunities`);
    await expect(page.getByTestId("revenue-weighted-pipeline-value")).toHaveText(expected);
    await page.getByRole("button", { name: "All opportunities" }).click();
    await expect(page.getByTestId("opportunity-row-astra-weighted")
      .getByText("Weighted value").locator("..")).toContainText(expected);
    await page.getByTestId("opportunity-row-astra-weighted").click();
    const snapshot = page.locator(".oc-snapshot > div").filter({ has: page.getByText("Weighted value", { exact: true }) });
    await expect(snapshot.locator("strong")).toHaveText(expected);
  }
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

  await page.getByRole("button", { name: "Pipeline", exact: true }).click();
  await expect(page.getByText("Opportunity data unavailable.")).toBeVisible();
  await expect(page.getByText("No opportunities")).toHaveCount(0);
  await expect(page.getByText("Open Pipeline").locator("..").getByText("Unknown")).toBeVisible();
  await expect(page.getByText("Active Opportunities").locator("..").getByText("Unknown")).toBeVisible();

  await page.getByRole("button", { name: "Revenue attention" }).click();
  await page.getByText("Operator diagnostics · Legacy opportunity guidance").click();
  await expect(page.getByText("Opportunity actions are unavailable until opportunity data can be loaded.")).toBeVisible();
  await expect(page.locator('[data-testid^="revenue-action-"]')).toHaveCount(0);

  await page.getByRole("button", { name: "All opportunities" }).click();
  await expect(page.getByText("Opportunity data unavailable.")).toBeVisible();
  await expect(page.getByText("No opportunities found.")).toHaveCount(0);

  await page.getByRole("button", { name: "Pipeline overview" }).click();
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

  await page.getByRole("button", { name: "Pipeline", exact: true }).click();
  const pipelineCard = page.locator(".deal-card").filter({
    hasText: "E2E Command Plumbing"
  });
  const stage = pipelineCard.getByRole("combobox");

  await stage.selectOption("CONTACTED");
  await expect(stage).toHaveValue("CONTACTED");
  await stage.selectOption("QUALIFIED");
  await expect(stage).toHaveValue("QUALIFIED");
});
