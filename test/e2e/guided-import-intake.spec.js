import { expect, test } from "@playwright/test";

import {
  adversarialCsv,
  analysisFixture,
  committedFixture,
  previewFixture
} from "./fixtures/import-contracts.mjs";

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";

test("guides a desktop CSV intake with truthful capabilities and inert templates", async ({ page }) => {
  let previewPosts = 0;
  let resumeReads = 0;
  await mockEmptyPilotStatus(page);
  page.on("request", request => {
    if (request.method() === "GET" && request.url().includes("/api/import-batches/")) {
      resumeReads += 1;
    }
  });
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => {
    previewPosts += 1;
    return json(route, 201, { ok: true, data: previewFixture() });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, route => (
    json(route, 200, { ok: true, data: analysisFixture() })
  ));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#imports");

  const context = page.getByRole("region", { name: "Business and source context" });
  await expect(context).toContainText("TGE import workspace");
  await expect(context).not.toContainText("Authenticated TGE workspace");
  await expect(context).toContainText("membership and tenant authority are resolved by the server");
  await context.getByLabel("Source system label").fill("Quarterly CRM export");

  const capability = page.getByRole("region", { name: "Selected collection capability" });
  await expect(capability).toContainText("Prospects");
  await expect(capability).toContainText("Canonical commit supported");
  const prospectTemplate = capability.getByRole("link", { name: "Download blank CSV template" });
  await expect(prospectTemplate).toHaveAttribute("download", "tge-prospects-blank-template.csv");
  const prospectHref = await prospectTemplate.getAttribute("href");
  expect(decodeURIComponent(prospectHref.split(",")[1]).trim()).toBe(
    "id,business_name,website,email,phone,service,location,source,source_url,dedupe_key,qualification_score,qualification_status,created_at,updated_at"
  );

  await page.getByLabel("Source collection").selectOption("opportunities");
  await expect(capability).toContainText("Opportunities");
  await capability.getByText("Open field guide").click();
  await expect(capability).toContainText("headers only—no sample or customer records");
  await expect(capability).toContainText("currency · TEXT");
  await expect(capability).toContainText("Missing remains unknown and is never inferred from locale");

  await page.getByLabel("CSV file").setInputFiles({
    name: "pipeline-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(adversarialCsv, "utf8")
  });
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("heading", { name: "Raw evidence preview" })).toBeVisible();
  await page.getByRole("button", { name: "Review deterministic mapping" }).click();
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toBeVisible();
  expect(previewPosts).toBe(1);
  expect(resumeReads).toBe(0);

  await page.getByRole("button", { name: "Start another import" }).click();

  await page.getByLabel("Source collection").selectOption("revenue_actions");
  await expect(capability).toContainText("Preview only");
  await expect(capability).toContainText("cannot continue to canonical commit");
  await expect(capability.getByRole("link", { name: "Download blank CSV template" })).toHaveCount(0);
  await expect(page.getByLabel("CSV file")).toBeEnabled();
});

test("restores a staged import from server truth across 390px reload and navigation", async ({ page }) => {
  let commitReads = 0;
  let previewReads = 0;
  let analysisReads = 0;
  let previewWrites = 0;
  let committed = false;
  await mockEmptyPilotStatus(page);
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => {
    previewWrites += 1;
    return route.abort("failed");
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, route => {
    commitReads += 1;
    return committed
      ? json(route, 200, { ok: true, data: committedFixture({ reconciled: true }) })
      : json(route, 404, {
          ok: false,
          error: "IMPORT_BATCH_UNAVAILABLE",
          message: "The requested import batch is unavailable."
        });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/preview`, route => {
    previewReads += 1;
    return json(route, 200, { ok: true, data: previewFixture() });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, route => {
    analysisReads += 1;
    expect(route.request().postDataJSON()).toEqual({});
    return json(route, 200, { ok: true, data: analysisFixture() });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#imports?batch=browser-batch-1");
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toBeVisible();
  await expect(page.getByText(/Durable preview restored/)).toBeVisible();
  await expect(page.getByText(/unconfirmed browser edits were not persisted/)).toBeVisible();
  expect(previewWrites).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toBeVisible();
  await page.getByRole("button", { name: "Prospects" }).click();
  await page.getByRole("button", { name: "Imports" }).click();
  await expect(page).toHaveURL(/#imports\?batch=browser-batch-1$/);
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toBeVisible();
  expect(commitReads).toBe(3);
  expect(previewReads).toBe(3);
  expect(analysisReads).toBe(3);
  expect(previewWrites).toBe(0);

  committed = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Import committed" })).toBeVisible();
  await expect(page.getByText(/Reconciled after an unconfirmed transaction outcome/)).toBeVisible();
  expect(commitReads).toBe(4);
  expect(previewReads).toBe(3);
  expect(analysisReads).toBe(3);
});

test("keeps an acknowledged batch pointer through interrupted preview recovery", async ({ page }) => {
  let previewPosts = 0;
  await mockEmptyPilotStatus(page);
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => {
    previewPosts += 1;
    return json(route, 500, {
      ok: false,
      error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
      message: "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
      details: { attemptedId: "browser-batch-1" }
    });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, route => (
    json(route, 404, {
      ok: false,
      error: "IMPORT_BATCH_UNAVAILABLE",
      message: "The requested import batch is unavailable."
    })
  ));
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/preview`, route => (
    json(route, 200, { ok: true, data: previewFixture() })
  ));
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, route => (
    json(route, 200, { ok: true, data: analysisFixture() })
  ));

  await page.goto("/#imports");
  await page.getByLabel("Source collection").selectOption("opportunities");
  await page.getByLabel("CSV file").setInputFiles({
    name: "pipeline-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(adversarialCsv, "utf8")
  });
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("button", { name: "Reconcile preview" })).toBeVisible();
  await expect(page).toHaveURL(/#imports\?batch=browser-batch-1$/);
  expect(previewPosts).toBe(1);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toBeVisible();
  await expect(page.getByText(/Durable preview restored/)).toBeVisible();
  expect(previewPosts).toBe(1);
});

test("fails an unknown or malformed resume pointer visibly before a new upload", async ({ page }) => {
  let batchReads = 0;
  await mockEmptyPilotStatus(page);
  await page.route(`${apiBaseUrl}/api/import-batches/**`, route => {
    batchReads += 1;
    return route.abort("failed");
  });

  await page.goto("/#imports?batch=batch-1&tenant_id=client-selected");
  await expect(page.getByRole("heading", { name: "Setup could not be resumed" })).toBeVisible();
  await expect(page.getByText(/does not contain one valid import batch reference/)).toBeVisible();
  await expect(page.getByLabel("CSV file")).toHaveCount(0);
  expect(batchReads).toBe(0);

  await page.getByRole("button", { name: "Start a new import" }).click();
  await expect(page).toHaveURL(/#imports$/);
  await expect(page.getByLabel("CSV file")).toBeEnabled();

  await page.unroute(`${apiBaseUrl}/api/import-batches/**`);
  await page.route(`${apiBaseUrl}/api/import-batches/**`, route => {
    batchReads += 1;
    return json(route, 404, {
      ok: false,
      error: "IMPORT_BATCH_UNAVAILABLE",
      message: "The requested import batch is unavailable."
    });
  });
  await page.goto("/#imports?batch=missing-batch");
  await expect(page.getByRole("heading", { name: "Setup could not be resumed" })).toBeVisible();
  await expect(page.getByText(/unknown, expired, or already cleaned/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a new import" })).toBeVisible();
  expect(batchReads).toBe(2);
});

test("uses retained lifecycle truth for expired and cleaned resume links", async ({ page }) => {
  await mockEmptyPilotStatus(page);
  for (const [batchId, cleanup, message] of [
    ["expired-batch", {
      state: "PENDING",
      due: true,
      attempts: 0,
      retryable: false
    }, /raw import evidence has expired/i],
    ["cleaned-batch", {
      state: "SUCCEEDED",
      due: true,
      attempts: 1,
      retryable: false,
      startedAt: "2026-09-14T00:00:00.000Z",
      completedAt: "2026-09-14T00:00:01.000Z"
    }, /raw import evidence was cleaned/i]
  ]) {
    await page.route(`${apiBaseUrl}/api/import-batches/${batchId}/commit`, route => (
      json(route, 404, {
        ok: false,
        error: "IMPORT_BATCH_UNAVAILABLE",
        message: "The requested import batch is unavailable."
      })
    ));
    await page.route(`${apiBaseUrl}/api/import-batches/${batchId}/preview`, route => {
      const preview = previewFixture();
      preview.batch.id = batchId;
      preview.batch.rawExpiresAt = "2026-09-14T00:00:00.000Z";
      preview.batch.rawCleanup = cleanup;
      preview.records = [];
      return json(route, 200, { ok: true, data: preview });
    });

    await page.goto(`/#imports?batch=${batchId}`);
    await expect(page.getByRole("heading", { name: "Setup could not be resumed" })).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start a new import" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry this batch" })).toHaveCount(0);
  }
});

test("does not claim workspace authentication when import access is unavailable", async ({ page }) => {
  await page.route(`${apiBaseUrl}/api/pilot-evidence/status`, route => json(route, 403, {
    ok: false,
    error: "FORBIDDEN",
    message: "Access denied."
  }));
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => json(route, 403, {
    ok: false,
    error: "FORBIDDEN",
    message: "Access denied."
  }));

  await page.goto("/#imports");
  const context = page.getByRole("region", { name: "Business and source context" });
  await expect(context).toContainText("TGE import workspace");
  await expect(context).not.toContainText("Authenticated TGE workspace");
  await page.getByLabel("CSV file").setInputFiles({
    name: "pipeline-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(adversarialCsv, "utf8")
  });
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("heading", { name: "Import access unavailable" })).toBeVisible();
  await expect(context).not.toContainText("Authenticated TGE workspace");
});

async function mockEmptyPilotStatus(page) {
  await page.route(`${apiBaseUrl}/api/pilot-evidence/status`, route => json(route, 200, {
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
  }));
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
