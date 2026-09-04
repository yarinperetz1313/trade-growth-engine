import { expect, test } from "@playwright/test";

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";
const evidence = {
  criteria: {
    stale_after_days: 14,
    stale_boundary: "AT_OR_AFTER",
    source_freshness_days: 90,
    source_freshness_boundary: "AT_OR_BEFORE"
  },
  opportunity_stage: "PROPOSAL",
  activity_baseline: {
    kind: "ACTIVITY",
    entity_id: "activity-evidence",
    at: "2026-08-01T00:00:00.000Z"
  },
  stalled_since: "2026-08-15T00:00:00.000Z",
  next_action: {
    present: false,
    source: "NONE",
    opportunity_value: null,
    active_task_ids: []
  },
  source_freshness: {
    observed_at: "2026-09-01T00:00:00.000Z",
    maximum_age_days: 90
  },
  commercial_value_basis: {
    classification: "KNOWN",
    amount_source: "opportunity.value",
    currency_source: "opportunity.currency"
  }
};

const source = {
  system: "TGE",
  entity_type: "OPPORTUNITY",
  entity_id: "e2e-opp-command",
  observed_at: "2026-09-01T00:00:00.000Z",
  observed_version: `sha256:${"a".repeat(64)}`
};

function leakCase({
  id,
  state,
  commercialValue,
  detectedAt = "2026-09-01T00:00:00.000Z",
  supersededBy = null
}) {
  const audit = [{
    transition: "OPEN",
    at: detectedAt,
    subject_id: "auth0|fixture-user",
    detector_id: "stalled-opportunity",
    detector_version: "1",
    reason_code: "STALE_WITHOUT_NEXT_ACTION"
  }];
  if (state !== "OPEN") {
    if (state === "SUPERSEDED") {
      audit.push({
        transition: "SUPERSEDED",
        at: "2026-09-02T00:00:00.000Z",
        subject_id: "auth0|fixture-user",
        reason_code: "CANONICAL_EVIDENCE_CHANGED",
        superseded_by_case_id: supersededBy,
        replacement_semantic_key: "b".repeat(64)
      });
    } else {
      audit.push({
        transition: state,
        at: "2026-09-02T00:00:00.000Z",
        subject_id: "auth0|fixture-user",
        reason: `${state.toLowerCase()} fixture reason`,
        ...(state === "SNOOZED"
          ? { wake_at: "2026-09-10T00:00:00.000Z" }
          : {})
      });
    }
  }
  const commercialValueBasis = commercialValue.classification === "KNOWN"
    ? {
        classification: "KNOWN",
        amount_source: "opportunity.value",
        currency_source: "opportunity.currency"
      }
    : commercialValue.classification === "UNKNOWN"
      ? {
          classification: "UNKNOWN",
          reason: "VALUE_UNKNOWN",
          currency_present: false
        }
      : { classification: "NOT_APPLICABLE" };
  return {
    id,
    leak_type: "STALLED_OPPORTUNITY",
    state,
    opportunity_id: "e2e-opp-command",
    source_system: source.system,
    source_entity_type: source.entity_type,
    source_entity_id: source.entity_id,
    source_observed_at: source.observed_at,
    source_observed_version: source.observed_version,
    detector_id: "stalled-opportunity",
    detector_version: "1",
    reason_code: "STALE_WITHOUT_NEXT_ACTION",
    evidence_classification: "MIXED",
    evidence_snapshot: {
      classification: "MIXED",
      source_observation: {
        observed_at: source.observed_at,
        observed_version: source.observed_version
      },
      facts: {
        ...evidence,
        commercial_value_basis: commercialValueBasis
      }
    },
    commercial_value: commercialValue,
    recommended_action_type: "FOLLOW_UP",
    detected_at: detectedAt,
    created_at: detectedAt,
    updated_at: audit.at(-1).at,
    supersedes_case_id: null,
    superseded_by_case_id: supersededBy,
    revenue_action_id: null,
    revenue_action_status_at_link: null,
    audit
  };
}

async function openCommandOpportunity(page) {
  await page.goto("/#opportunities/e2e-opp-command");
  await expect(page.getByRole("heading", { name: "E2E Command Plumbing" })).toBeVisible();
  await expect(page.getByTestId("revenue-leak-case-panel")).toBeVisible();
}

test("revenue leak detection, RevenueAction link, and audited lifecycle persist across reload", async ({ page }) => {
  await page.goto("/#opportunities/e2e-opp-stalled");
  await expect(page.getByRole("heading", { name: "E2E Stalled Roofing" })).toBeVisible();
  await expect(page.getByTestId("revenue-leak-empty-history")).toBeVisible();

  await page.getByTestId("detect-stalled-opportunity").click();
  const outcome = page.getByTestId("revenue-leak-detector-outcome");
  await expect(outcome).toContainText("Potential revenue leak detected");
  await expect(outcome).toContainText("STALE_WITHOUT_NEXT_ACTION");
  await expect(outcome.getByTestId("potential-revenue-at-risk")).toContainText("AUD 0");
  await expect(outcome.getByTestId("potential-revenue-at-risk")).toContainText("Known zero");
  await expect(outcome).toContainText("Source version");
  await expect(outcome).toContainText("sha256:");
  await expect(page.getByTestId("revenue-leak-history")).toContainText("OPEN");

  await page.getByRole("button", { name: "Go to RevenueAction workflow" }).click();
  await expect(page.getByTestId("revenue-action-execution")).toBeFocused();
  await page.getByTestId("prepare-revenue-action").click();
  await expect(page.getByTestId("link-revenue-action-to-case")).toBeVisible();
  await page.getByTestId("link-revenue-action-to-case").click();
  await expect(page.getByTestId("linked-revenue-action")).toContainText("status at link PREPARED");
  await expect(page.getByTestId("revenue-leak-success")).toContainText(
    "without changing its lifecycle"
  );

  await page.getByLabel("Reason to snooze").fill("Waiting for the scheduled buyer review.");
  await page.getByLabel("Future wake time").selectOption("3");
  await page.getByRole("button", { name: "Snooze case" }).click();
  await expect(page.getByTestId("revenue-leak-history")).toContainText("SNOOZED");

  await page.reload();
  await expect(page.getByTestId("revenue-leak-case-detail")).toContainText("SNOOZED");
  await expect(page.getByTestId("revenue-leak-audit")).toContainText(
    "Waiting for the scheduled buyer review."
  );
  await expect(page.getByTestId("linked-revenue-action")).toContainText("PREPARED");

  await page.getByLabel("Reason to resume").fill("Buyer review finished; assess the case again.");
  await page.getByRole("button", { name: "Resume case" }).click();
  await expect(page.getByTestId("revenue-leak-case-detail")).toContainText("OPEN");

  await page.getByLabel("Reason to dismiss").fill("Buyer confirmed there is no follow-up required.");
  await page.getByRole("button", { name: "Dismiss case" }).click();
  await expect(page.getByTestId("revenue-leak-case-detail")).toContainText("DISMISSED");
  await expect(page.getByTestId("revenue-leak-lifecycle-controls")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("revenue-leak-case-detail")).toContainText("DISMISSED");
  await expect(page.getByTestId("revenue-leak-audit")).toContainText(
    "Buyer confirmed there is no follow-up required."
  );

  const persisted = await page.request.get(
    `${apiBaseUrl}/api/revenue-leak-cases?opportunity_id=e2e-opp-stalled`
  );
  expect(persisted.ok()).toBe(true);
  const persistedBody = await persisted.json();
  expect(persistedBody.count).toBe(1);
  expect(persistedBody.data[0]).toMatchObject({
    state: "DISMISSED",
    revenue_action_status_at_link: "PREPARED"
  });
});

test("revenue leak detector presents all five outcomes without treating suppression as no leak", async ({ page }) => {
  let history = [];
  const responses = [
    {
      outcome: "ELIGIBLE_LEAK_DETECTED",
      reason_code: "STALE_WITHOUT_NEXT_ACTION",
      commercial_value: { classification: "KNOWN", amount: "42000.5", currency: "AUD" },
      source,
      evidence,
      case: leakCase({
        id: "case-detected",
        state: "OPEN",
        commercialValue: { classification: "KNOWN", amount: "42000.5", currency: "AUD" }
      }),
      reconciliation: { created: true, duplicate: false, superseded_case_id: null }
    },
    {
      outcome: "ELIGIBLE_NO_LEAK",
      reason_code: "NEXT_ACTION_PRESENT",
      commercial_value: { classification: "KNOWN", amount: "0", currency: "AUD" },
      source,
      evidence: {
        ...evidence,
        next_action: {
          present: true,
          source: "OPPORTUNITY",
          opportunity_value: "Call buyer",
          active_task_ids: []
        }
      },
      case: null,
      reconciliation: null
    },
    {
      outcome: "INSUFFICIENT_EVIDENCE",
      reason_code: "MEANINGFUL_ACTIVITY_BASELINE_MISSING",
      commercial_value: { classification: "UNKNOWN", amount: null, currency: null },
      source: null,
      evidence: null,
      case: null,
      reconciliation: null
    },
    {
      outcome: "STALE_OR_UNTRUSTWORTHY_SOURCE",
      reason_code: "CANONICAL_SOURCE_TOO_OLD",
      commercial_value: { classification: "UNKNOWN", amount: null, currency: null },
      source: null,
      evidence: null,
      case: null,
      reconciliation: null
    },
    {
      outcome: "DATA_HEALTH_SUPPRESSED",
      reason_code: "COMMERCIAL_VALUE_INVALID",
      commercial_value: { classification: "UNKNOWN", amount: null, currency: null },
      source: null,
      evidence: null,
      case: null,
      reconciliation: null
    }
  ].map(response => ({
    detector: { id: "stalled-opportunity", version: "1" },
    ...response
  }));

  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases?opportunity_id=e2e-opp-command`,
    route => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: history, count: history.length })
    })
  );
  await page.route(
    `${apiBaseUrl}/api/opportunities/e2e-opp-command/revenue-leak-cases/detect-stalled`,
    route => {
      const response = responses.shift();
      if (!response) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE",
            message: "Revenue leak case persistence is temporarily unavailable."
          })
        });
      }
      if (response.case) history = [response.case];
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ...response })
      });
    }
  );

  await openCommandOpportunity(page);
  const button = page.getByTestId("detect-stalled-opportunity");
  const outcome = page.getByTestId("revenue-leak-detector-outcome");

  for (const [title, evidenceCopy] of [
    ["Potential revenue leak detected", "AUD 42,000.5"],
    ["No eligible stalled-opportunity leak", "NEXT_ACTION_PRESENT"],
    ["Evidence unavailable", "Evidence unavailable —"],
    ["Evidence stale or untrustworthy", "Evidence unavailable / stale"],
    ["Evidence suppressed by Data Health", "Evidence unavailable / suppressed"]
  ]) {
    await button.click();
    await expect(outcome).toContainText(title);
    await expect(outcome).toContainText(evidenceCopy);
  }
  await expect(outcome).toContainText("COMMERCIAL_VALUE_INVALID");
  await expect(outcome).not.toContainText("No eligible stalled-opportunity leak");

  await button.click();
  await expect(page.getByText("Revenue leak case persistence unavailable")).toBeVisible();
  await expect(page.getByTestId("revenue-leak-detector-outcome")).toHaveCount(0);
  await expect(page.getByTestId("revenue-leak-empty-history")).toHaveCount(0);
});

test("revenue leak history distinguishes every lifecycle and commercial-value state", async ({ page }) => {
  const cases = [
    leakCase({
      id: "case-open-known",
      state: "OPEN",
      commercialValue: { classification: "KNOWN", amount: "42000.5", currency: "AUD" },
      detectedAt: "2026-09-03T00:00:00.000Z"
    }),
    leakCase({
      id: "case-snoozed-zero",
      state: "SNOOZED",
      commercialValue: { classification: "KNOWN", amount: "0", currency: "AUD" },
      detectedAt: "2026-09-01T00:00:00.000Z"
    }),
    leakCase({
      id: "case-dismissed-unknown",
      state: "DISMISSED",
      commercialValue: { classification: "UNKNOWN", amount: null, currency: null },
      detectedAt: "2026-09-02T00:00:00.000Z"
    }),
    leakCase({
      id: "case-superseded-na",
      state: "SUPERSEDED",
      commercialValue: { classification: "NOT_APPLICABLE", amount: null, currency: null },
      detectedAt: "2026-09-01T00:00:00.000Z",
      supersededBy: "case-open-known"
    })
  ];
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases?opportunity_id=e2e-opp-command`,
    route => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: cases, count: cases.length })
    })
  );

  await openCommandOpportunity(page);
  const history = page.getByTestId("revenue-leak-history");
  await expect(history).toContainText("AUD 42,000.5 · Known value");
  await expect(history).toContainText("AUD 0 · Known zero");
  await expect(history).toContainText("Unknown · Unknown value — no amount is claimed");
  await expect(history).toContainText("Not applicable · Not applicable under the recorded case contract");

  await history.getByRole("button").filter({ hasText: "Case case-snoozed-zero" }).click();
  await expect(page.getByRole("button", { name: "Resume case" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Snooze case" })).toHaveCount(0);

  await history.getByRole("button").filter({ hasText: "Unknown · Unknown value" }).click();
  await expect(page.getByTestId("revenue-leak-lifecycle-controls")).toHaveCount(0);

  await history.getByRole("button").filter({ hasText: "Not applicable" }).click();
  await expect(page.getByTestId("revenue-leak-case-detail")).toContainText("SUPERSEDED");
  await expect(history).toContainText("Superseded by: case-open-known");
});

test("revenue leak history keeps unauthorized and persistence failures distinct from empty", async ({ page }) => {
  let status = 403;
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases?opportunity_id=e2e-opp-command`,
    route => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 403
        ? { ok: false, error: "FORBIDDEN", message: "Forbidden" }
        : {
            ok: false,
            error: "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE",
            message: "Persistence unavailable"
          })
    })
  );

  await openCommandOpportunity(page);
  await expect(page.getByText("Revenue leak review unauthorized")).toBeVisible();
  await expect(page.getByTestId("detect-stalled-opportunity")).toBeDisabled();
  await expect(page.getByTestId("revenue-leak-empty-history")).toHaveCount(0);

  status = 503;
  await page.reload();
  await expect(page.getByText("Revenue leak case persistence unavailable")).toBeVisible();
  await expect(page.getByText(/No empty or no-leak conclusion was inferred/)).toBeVisible();
  await expect(page.getByTestId("revenue-leak-empty-history")).toHaveCount(0);
});

test("revenue leak panel ignores valid stale history responses and fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases?*`, async route => {
    const opportunityId = new URL(route.request().url()).searchParams.get("opportunity_id");
    if (opportunityId === "e2e-opp-command") {
      await new Promise(resolve => setTimeout(resolve, 500));
      const staleCase = leakCase({
        id: "stale-response-must-not-render",
        state: "OPEN",
        commercialValue: { classification: "KNOWN", amount: "1", currency: "AUD" }
      });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: [staleCase], count: 1 })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [], count: 0 })
    });
  });

  await page.goto("/#opportunities/e2e-opp-command");
  await expect(page.getByRole("heading", { name: "E2E Command Plumbing" })).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-revenue";
  });
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  await expect(page.getByTestId("revenue-leak-empty-history")).toBeVisible();
  await page.waitForTimeout(550);
  await expect(page.getByText("Case stale-response-must-not-render")).toHaveCount(0);
  const overflowingElements = await page.locator("body *").evaluateAll(elements =>
    elements
      .filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .map(element => ({
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        tagName: element.tagName,
        text: element.textContent?.trim().slice(0, 80)
      }))
  );
  expect(overflowingElements).toEqual([]);
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth
  }))).toEqual({ body: 390, viewport: 390 });
  await expect(page).toHaveURL(/#opportunities\/e2e-opp-revenue$/);
});

test("late opportunity intelligence and detector responses cannot rebind route B to route A", async ({ page }) => {
  let intelligenceRequests = 0;
  let releaseIntelligence;
  const intelligenceGate = new Promise(resolve => {
    releaseIntelligence = resolve;
  });
  await page.route(
    `${apiBaseUrl}/api/opportunities/e2e-opp-command/intelligence`,
    async route => {
      intelligenceRequests += 1;
      await intelligenceGate;
      await route.continue();
    }
  );

  await page.goto("/#opportunities/e2e-opp-command");
  await expect.poll(() => intelligenceRequests).toBe(1);
  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-revenue";
  });
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  await page.evaluate(() => {
    window.__staleOpportunityRendered = false;
    window.__staleOpportunityObserver = new MutationObserver(() => {
      if (document.body.textContent?.includes("E2E Command Plumbing")) {
        window.__staleOpportunityRendered = true;
      }
    });
    window.__staleOpportunityObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
  releaseIntelligence();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__staleOpportunityRendered)).toBe(false);
  await expect(page.getByRole("heading", { name: "E2E Command Plumbing" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  await expect(page).toHaveURL(/#opportunities\/e2e-opp-revenue$/);

  await page.unroute(`${apiBaseUrl}/api/opportunities/e2e-opp-command/intelligence`);

  let detectorRequests = 0;
  let releaseDetector;
  const detectorGate = new Promise(resolve => {
    releaseDetector = resolve;
  });
  const staleDetection = {
    ok: true,
    outcome: "ELIGIBLE_LEAK_DETECTED",
    reason_code: "STALE_WITHOUT_NEXT_ACTION",
    detector: { id: "stalled-opportunity", version: "1" },
    source,
    evidence,
    commercial_value: { classification: "KNOWN", amount: "1", currency: "AUD" },
    case: leakCase({
      id: "late-detector-case-a",
      state: "OPEN",
      commercialValue: { classification: "KNOWN", amount: "1", currency: "AUD" }
    }),
    reconciliation: { created: true, duplicate: false, superseded_case_id: null }
  };
  await page.route(
    `${apiBaseUrl}/api/opportunities/e2e-opp-command/revenue-leak-cases/detect-stalled`,
    async route => {
      detectorRequests += 1;
      await detectorGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(staleDetection)
      });
    }
  );

  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-command";
  });
  await expect(page.getByRole("heading", { name: "E2E Command Plumbing" })).toBeVisible();
  await page.getByTestId("detect-stalled-opportunity").click();
  await expect.poll(() => detectorRequests).toBe(1);
  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-revenue";
  });
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  releaseDetector();
  await page.waitForTimeout(150);
  await expect(page.getByText("Case late-detector-case-a")).toHaveCount(0);
  await expect(page.getByTestId("revenue-leak-detector-outcome")).toHaveCount(0);
  await expect(page.getByTestId("revenue-leak-lifecycle-controls")).toHaveCount(0);
  await expect(page).toHaveURL(/#opportunities\/e2e-opp-revenue$/);
});

test("ambiguous lifecycle and link writes reload durable history before controls re-enable", async ({ page }) => {
  let durableCase = leakCase({
    id: "case-ambiguous-recovery",
    state: "OPEN",
    commercialValue: { classification: "KNOWN", amount: "42000", currency: "AUD" }
  });
  let mutationPosts = 0;
  const postCounts = {
    snooze: 0,
    resume: 0,
    link: 0,
    dismiss: 0
  };

  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases?opportunity_id=e2e-opp-command`,
    async route => {
      if (mutationPosts > 0) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: [durableCase], count: 1 })
      });
    }
  );
  await page.route(`${apiBaseUrl}/api/revenue-actions?*`, route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      data: [{
        id: "action-ambiguous-recovery",
        opportunity_id: "e2e-opp-command",
        status: "PREPARED",
        title: "Prepared recovery action",
        action_type: "FOLLOW_UP",
        priority: "HIGH",
        reason: "Existing human-controlled RevenueAction",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z"
      }],
      count: 1
    })
  }));

  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/case-ambiguous-recovery/snooze`,
    async route => {
      postCounts.snooze += 1;
      mutationPosts += 1;
      durableCase = {
        ...durableCase,
        state: "SNOOZED",
        updated_at: "2026-09-02T01:00:00.000Z",
        audit: [...durableCase.audit, {
          transition: "SNOOZED",
          at: "2026-09-02T01:00:00.000Z",
          subject_id: "auth0|fixture-user",
          reason: "Committed snooze with lost response",
          wake_at: "2026-09-10T00:00:00.000Z"
        }]
      };
      await route.fulfill({
        status: 408,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "REQUEST_TIMEOUT",
          message: "The lifecycle response timed out after the write began."
        })
      });
    }
  );
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/case-ambiguous-recovery/resume`,
    async route => {
      postCounts.resume += 1;
      mutationPosts += 1;
      durableCase = {
        ...durableCase,
        state: "OPEN",
        updated_at: "2026-09-02T02:00:00.000Z",
        audit: [...durableCase.audit, {
          transition: "REOPENED",
          at: "2026-09-02T02:00:00.000Z",
          subject_id: "auth0|fixture-user",
          reason: "Committed resume with malformed response"
        }]
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: null })
      });
    }
  );
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/case-ambiguous-recovery/link-revenue-action`,
    async route => {
      postCounts.link += 1;
      mutationPosts += 1;
      durableCase = {
        ...durableCase,
        revenue_action_id: "action-ambiguous-recovery",
        revenue_action_status_at_link: "PREPARED",
        updated_at: "2026-09-02T03:00:00.000Z",
        audit: [...durableCase.audit, {
          transition: "REVENUE_ACTION_LINKED",
          at: "2026-09-02T03:00:00.000Z",
          subject_id: "auth0|fixture-user",
          revenue_action_id: "action-ambiguous-recovery",
          revenue_action_fingerprint: "a".repeat(64),
          revenue_action_status: "PREPARED"
        }]
      };
      await route.fulfill({
        status: 408,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "REQUEST_TIMEOUT",
          message: "The link response timed out after the write began."
        })
      });
    }
  );
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases/case-ambiguous-recovery/dismiss`,
    async route => {
      postCounts.dismiss += 1;
      mutationPosts += 1;
      durableCase = {
        ...durableCase,
        state: "DISMISSED",
        updated_at: "2026-09-02T04:00:00.000Z",
        audit: [...durableCase.audit, {
          transition: "DISMISSED",
          at: "2026-09-02T04:00:00.000Z",
          subject_id: "auth0|fixture-user",
          reason: "Committed dismissal with malformed response"
        }]
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { id: "uninterpretable" } })
      });
    }
  );

  await openCommandOpportunity(page);

  await page.getByLabel("Reason to snooze").fill("Committed snooze with lost response");
  await page.getByRole("button", { name: "Snooze case" }).click();
  await expect(page.getByRole("button", { name: "Snoozing…" })).toBeDisabled();
  await expect(page.getByTestId("revenue-leak-case-detail")).toContainText("SNOOZED");
  await expect(page.getByTestId("revenue-leak-success")).toContainText("authoritative durable case history");

  await page.getByLabel("Reason to resume").fill("Committed resume with malformed response");
  await page.getByRole("button", { name: "Resume case" }).click();
  await expect(page.getByTestId("revenue-leak-case-detail")).toContainText("OPEN");

  await page.getByTestId("link-revenue-action-to-case").click();
  await expect(page.getByRole("button", { name: "Linking…" })).toBeDisabled();
  await expect(page.getByTestId("linked-revenue-action")).toContainText(
    "action-ambiguous-recovery · status at link PREPARED"
  );

  await page.getByLabel("Reason to dismiss").fill("Committed dismissal with malformed response");
  await page.getByRole("button", { name: "Dismiss case" }).click();
  await expect(page.getByTestId("revenue-leak-case-detail")).toContainText("DISMISSED");
  await expect(page.getByTestId("revenue-leak-lifecycle-controls")).toHaveCount(0);
  expect(postCounts).toEqual({ snooze: 1, resume: 1, link: 1, dismiss: 1 });
});

test("late intelligence mutation cannot reselect route A after navigation to route B", async ({ page }) => {
  let intelligenceLoads = 0;
  let intelligenceMutationRequests = 0;
  let releaseIntelligenceMutation;
  const intelligenceMutationGate = new Promise(resolve => {
    releaseIntelligenceMutation = resolve;
  });
  const routeAOpportunity = {
    id: "e2e-opp-command",
    business_name: "E2E Command Plumbing",
    service: "Commercial Plumbing",
    location: "Melbourne",
    stage: "QUALIFIED",
    value: 15000,
    next_action: "Identify the decision maker"
  };
  const routeAIntelligence = {
    resolved: {
      business_name: routeAOpportunity.business_name,
      service: routeAOpportunity.service,
      location: routeAOpportunity.location,
      contact_name: "Unknown"
    },
    score: {},
    health: { status: "UNKNOWN", risks: [] },
    evidence: {},
    activity: {},
    tasks: {},
    next_best_action: {
      type: "RESEARCH",
      title: "Identify the decision maker",
      reason: "No decision maker is recorded."
    }
  };

  await page.route(
    `${apiBaseUrl}/api/opportunities/e2e-opp-command/intelligence`,
    route => {
      intelligenceLoads += 1;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            opportunity: routeAOpportunity,
            intelligence: routeAIntelligence
          }
        })
      });
    }
  );
  await page.route(
    `${apiBaseUrl}/api/opportunities/e2e-opp-command/intelligence/contact`,
    async route => {
      intelligenceMutationRequests += 1;
      await intelligenceMutationGate;
      const updatedOpportunity = {
        ...routeAOpportunity,
        business_name: "LATE INTELLIGENCE MUTATION MUST NOT RENDER",
        contact_name: "Late route A contact"
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          opportunity: updatedOpportunity,
          intelligence: routeAIntelligence,
          state: {
            opportunity: updatedOpportunity,
            intelligence: routeAIntelligence
          },
          pipeline_metrics: {}
        })
      });
    }
  );

  await page.goto("/#opportunities/e2e-opp-command");
  await page.getByTestId("contact-name-input").fill("Route A contact");
  await page.getByTestId("add-contact").click();
  await expect.poll(() => intelligenceMutationRequests).toBe(1);
  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-revenue";
  });
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  await page.evaluate(() => {
    window.__lateIntelligenceMutationRendered = false;
    window.__lateIntelligenceMutationObserver = new MutationObserver(() => {
      if (document.body.textContent?.includes("LATE INTELLIGENCE MUTATION MUST NOT RENDER")) {
        window.__lateIntelligenceMutationRendered = true;
      }
    });
    window.__lateIntelligenceMutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
  await page.route(`${apiBaseUrl}/api/opportunities`, async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  releaseIntelligenceMutation();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__lateIntelligenceMutationRendered)).toBe(false);
  await expect(page.getByTestId("action-success")).toHaveCount(0);
  expect(intelligenceLoads).toBe(1);
  await expect(page.getByText("LATE INTELLIGENCE MUTATION MUST NOT RENDER")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  await expect(page).toHaveURL(/#opportunities\/e2e-opp-revenue$/);
});

test("late RevenueAction mutation cannot reselect route A after navigation to route B", async ({ page }) => {
  let revenueActionMutationRequests = 0;
  let releaseRevenueActionMutation;
  const revenueActionMutationGate = new Promise(resolve => {
    releaseRevenueActionMutation = resolve;
  });
  const routeAAction = {
    id: "route-a-revenue-action",
    opportunity_id: "e2e-opp-command",
    status: "PREPARED",
    title: "Route A prepared action",
    action_type: "RESEARCH",
    priority: "HIGH",
    reason: "A human-controlled route A action",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-02T00:00:00.000Z"
  };

  await page.route(`${apiBaseUrl}/api/revenue-actions?*`, route => {
    const opportunityId = new URL(route.request().url()).searchParams.get("opportunity_id");
    const data = opportunityId === "e2e-opp-command" ? [routeAAction] : [];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data, count: data.length })
    });
  });
  await page.route(
    `${apiBaseUrl}/api/revenue-actions/route-a-revenue-action/approve`,
    async route => {
      revenueActionMutationRequests += 1;
      await revenueActionMutationGate;
      const staleOpportunity = {
        id: "e2e-opp-command",
        business_name: "LATE REVENUE ACTION MUTATION MUST NOT RENDER",
        stage: "QUALIFIED",
        value: 15000
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { ...routeAAction, status: "APPROVED" },
          duplicate: false,
          refreshed: {
            opportunity: staleOpportunity,
            opportunity_intelligence: {}
          }
        })
      });
    }
  );

  await page.goto("/#opportunities/e2e-opp-command");
  await expect(page.getByTestId("approve-revenue-action")).toBeVisible();
  await page.getByTestId("approve-revenue-action").click();
  await expect.poll(() => revenueActionMutationRequests).toBe(1);
  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-revenue";
  });
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  await page.evaluate(() => {
    window.__lateRevenueActionMutationRendered = false;
    window.__lateRevenueActionMutationObserver = new MutationObserver(() => {
      if (document.body.textContent?.includes("LATE REVENUE ACTION MUTATION MUST NOT RENDER")) {
        window.__lateRevenueActionMutationRendered = true;
      }
    });
    window.__lateRevenueActionMutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
  await page.route(`${apiBaseUrl}/api/opportunities`, async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  releaseRevenueActionMutation();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__lateRevenueActionMutationRendered)).toBe(false);
  await expect(page.getByText("LATE REVENUE ACTION MUTATION MUST NOT RENDER")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  await expect(page).toHaveURL(/#opportunities\/e2e-opp-revenue$/);
});

test("delayed RevenueAction history cannot cross an opportunity route change", async ({ page }) => {
  await page.route(`${apiBaseUrl}/api/revenue-actions?*`, async route => {
    const opportunityId = new URL(route.request().url()).searchParams.get("opportunity_id");
    if (opportunityId === "e2e-opp-command") {
      await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: [{
            id: "stale-action-must-not-render",
            opportunity_id: "e2e-opp-command",
            status: "PREPARED",
            title: "STALE ACTION MUST NOT RENDER",
            action_type: "FOLLOW_UP",
            priority: "HIGH",
            reason: "Delayed response from the previous opportunity",
            created_at: "2026-09-01T00:00:00.000Z",
            updated_at: "2026-09-01T00:00:00.000Z"
          }],
          count: 1
        })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [], count: 0 })
    });
  });

  await page.goto("/#opportunities/e2e-opp-command");
  await expect(page.getByRole("heading", { name: "E2E Command Plumbing" })).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "opportunities/e2e-opp-revenue";
  });
  await expect(page.getByRole("heading", { name: "E2E Revenue Electrical" })).toBeVisible();
  await expect(page.getByTestId("revenue-action-history")).toContainText(
    "No durable revenue actions recorded."
  );
  await page.waitForTimeout(550);
  await expect(page.getByText("STALE ACTION MUST NOT RENDER")).toHaveCount(0);
  await expect(page.getByTestId("link-revenue-action-to-case")).toHaveCount(0);
  await expect(page).toHaveURL(/#opportunities\/e2e-opp-revenue$/);
});
