import { expect, test } from "@playwright/test";

import {
  adversarialCsv,
  analysisFixture,
  committedFixture,
  conflictFixture,
  previewFixture
} from "./fixtures/import-contracts.mjs";

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";

test("uploads adversarial CSV evidence, changes deterministic mapping, confirms, and commits", async ({ page }) => {
  const requests = { preview: null, analyses: [], commit: null };

  await page.route(`${apiBaseUrl}/api/import-batches/preview`, async route => {
    requests.preview = route.request().postDataJSON();
    await new Promise(resolve => setTimeout(resolve, 250));
    await json(route, 201, { ok: true, data: previewFixture() });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, async route => {
    const body = route.request().postDataJSON();
    requests.analyses.push(body);
    const selectedValue = body.selections?.find(item => item.targetField === "value")?.sourceColumn;
    await json(route, 200, {
      ok: true,
      data: analysisFixture({ valueColumn: selectedValue || "amount" })
    });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, async route => {
    requests.commit = route.request().postDataJSON();
    await json(route, 200, { ok: true, data: committedFixture() });
  });

  await page.goto("/#imports");
  await expect(page.getByRole("heading", { name: "Import CRM data" })).toBeVisible();
  await expect(page.getByText("No CSV selected yet.")).toBeVisible();

  await page.getByLabel("Source collection").selectOption("opportunities");
  await page.getByLabel("CSV file").setInputFiles({
    name: "adversarial-opportunities.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(adversarialCsv, "utf8")
  });
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByText("Reading immutable CSV evidence…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Raw evidence preview" })).toBeVisible();

  expect(requests.preview).toEqual({
    sourceCollection: "opportunities",
    upload: {
      filename: "adversarial-opportunities.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from(adversarialCsv, "utf8").toString("base64")
    }
  });
  await expect(page.getByTestId("evidence-row-0")).toContainText("0KNOWN_ZERO");
  await expect(page.getByTestId("evidence-row-0")).toContainText("unknownUNKNOWN");
  await expect(page.getByTestId("evidence-row-0")).toContainText("nullNULL");
  await expect(page.getByTestId("evidence-row-0")).toContainText("Empty stringBLANK");
  await expect(page.getByTestId("evidence-row-1")).toContainText("Not suppliedMISSING");
  await expect(page.getByTestId("evidence-row-1")).toContainText("=2+2NONNUMERIC");

  await page.getByRole("button", { name: "Review deterministic mapping" }).click();
  await expect(page.getByText("Suggestions are deterministic, draft, and not accepted automatically.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data Health" })).toBeVisible();
  await expect(page.getByText("2 valid rows")).toBeVisible();
  await expect(page.getByText("4 unknown values preserved")).toBeVisible();

  await page.getByLabel("Map value").selectOption("quoted value");
  await page.getByRole("button", { name: "Recalculate Data Health" }).click();
  await expect(page.getByText("Mapping and Data Health refreshed.")).toBeVisible();
  expect(requests.analyses).toHaveLength(2);
  expect(requests.analyses[0]).toEqual({});
  expect(requests.analyses[1].sourceIdentitySelection).toEqual({ sourceColumn: "external_id" });
  expect(requests.analyses[1].selections.find(item => item.targetField === "value")).toEqual({
    targetField: "value",
    sourceColumn: "quoted value",
    selectedType: "NUMBER"
  });

  await page.getByRole("button", { name: "Continue to confirmation" }).click();
  await expect(page.getByRole("heading", { name: "Confirm canonical import" })).toBeVisible();
  const commit = page.getByRole("button", { name: "Commit 2 rows" });
  await expect(commit).toBeDisabled();
  await page.getByLabel("Source system").fill("pilot-crm");
  await page.getByLabel("I confirm this reviewed mapping and Data Health result.").check();
  await expect(commit).toBeEnabled();
  await commit.click();

  await expect(page.getByRole("heading", { name: "Import committed" })).toBeVisible();
  await expect(page.getByText("2 committed")).toBeVisible();
  expect(requests.commit.sourceSystem).toBe("pilot-crm");
  expect(requests.commit.sourceIdentitySelection).toEqual({ sourceColumn: "external_id" });
  expect(requests.commit.selections.find(item => item.targetField === "value").sourceColumn).toBe("quoted value");
  expect(requests.commit.idempotencyKey).toMatch(/^browser-/);
});

test("keeps empty, unauthorized, and retryable transport failures distinct", async ({ page }) => {
  let previewAttempts = 0;
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, async route => {
    previewAttempts += 1;
    if (previewAttempts === 1) {
      return json(route, 503, {
        ok: false,
        error: "IMPORT_PREVIEW_TEMPORARILY_UNAVAILABLE",
        message: "Preview is temporarily unavailable."
      });
    }
    return json(route, 201, { ok: true, data: previewFixture({ rowCount: 0 }) });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, route =>
    json(route, 200, { ok: true, data: analysisFixture({ rowCount: 0 }) })
  );

  await page.goto("/#imports");
  await selectCsv(page, "id,business_name");
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByText("Preview is temporarily unavailable.")).toBeVisible();
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.getByText("No data rows were found in this CSV.")).toBeVisible();
  await page.getByRole("button", { name: "Review deterministic mapping" }).click();
  await expect(page.getByText("0 valid rows")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to confirmation" })).toBeDisabled();

  await page.unrouteAll({ behavior: "wait" });
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route =>
    json(route, 403, {
      ok: false,
      error: "ACCESS_DENIED",
      message: "Access denied."
    })
  );
  await page.getByRole("button", { name: "Start another import" }).click();
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("heading", { name: "Import access unavailable" })).toBeVisible();
  await expect(page.getByText("Only an OWNER or ADMIN can run imports.")).toBeVisible();
});

test("reconciles an unknown preview outcome before retrying the upload", async ({ page }) => {
  const requests = [];
  let previewPosts = 0;
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, async route => {
    requests.push(route.request().method());
    previewPosts += 1;
    if (previewPosts === 1) {
      return json(route, 500, {
        ok: false,
        error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
        message: "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
        details: { attemptedId: "browser-batch-1" }
      });
    }
    return json(route, 201, { ok: true, data: previewFixture() });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/preview`, route => {
    requests.push(route.request().method());
    return json(route, 404, {
      ok: false,
      error: "IMPORT_BATCH_UNAVAILABLE",
      message: "The requested import batch is unavailable."
    });
  });

  await page.goto("/#imports");
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("heading", { name: "Preview outcome unknown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create preview" })).toBeDisabled();
  await page.getByRole("button", { name: "Reconcile preview" }).click();
  await expect(page.getByText("No staged preview was found. You may retry the same upload.")).toBeVisible();
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.getByRole("heading", { name: "Raw evidence preview" })).toBeVisible();
  expect(requests).toEqual(["POST", "GET", "POST"]);
});

test("shows canonical conflicts without reporting success", async ({ page }) => {
  await mockReadyToCommit(page);
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, route =>
    json(route, 409, {
      ok: false,
      error: "IMPORT_COMMIT_CONFLICT",
      message: "The canonical import commit conflicts with existing import or canonical identity.",
      details: conflictFixture()
    })
  );

  await reachConfirmation(page);
  await page.getByLabel("Source system").fill("pilot-crm");
  await page.getByLabel("I confirm this reviewed mapping and Data Health result.").check();
  await page.getByRole("button", { name: "Commit 2 rows" }).click();

  await expect(page.getByRole("heading", { name: "Import conflict" })).toBeVisible();
  await expect(page.getByText("2 conflicted")).toBeVisible();
  await expect(page.getByText("SOURCE_IDENTITY_PAYLOAD_CONFLICT")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import committed" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Return to mapping" })).toBeVisible();
});

test("reconciles an unknown commit outcome before offering another POST", async ({ page }) => {
  let commitPosts = 0;
  await mockReadyToCommit(page);
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, async route => {
    if (route.request().method() === "GET") {
      return json(route, 200, { ok: true, data: committedFixture({ reconciled: true }) });
    }
    commitPosts += 1;
    return json(route, 500, {
      ok: false,
      error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
      message: "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
      details: { attemptedId: "browser-batch-1" }
    });
  });

  await reachConfirmation(page);
  await page.getByLabel("Source system").fill("pilot-crm");
  await page.getByLabel("I confirm this reviewed mapping and Data Health result.").check();
  await page.getByRole("button", { name: "Commit 2 rows" }).click();
  await expect(page.getByRole("heading", { name: "Commit outcome unknown" })).toBeVisible();
  await page.getByRole("button", { name: "Reconcile commit" }).click();
  await expect(page.getByRole("heading", { name: "Import committed" })).toBeVisible();
  await expect(page.getByText("Reconciled after an unconfirmed transaction outcome.")).toBeVisible();
  expect(commitPosts).toBe(1);
});

async function mockReadyToCommit(page) {
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route =>
    json(route, 201, { ok: true, data: previewFixture() })
  );
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, route =>
    json(route, 200, { ok: true, data: analysisFixture() })
  );
}

async function reachConfirmation(page) {
  await page.goto("/#imports");
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await page.getByRole("button", { name: "Review deterministic mapping" }).click();
  await page.getByRole("button", { name: "Continue to confirmation" }).click();
}

async function selectCsv(page, csv) {
  await page.getByLabel("Source collection").selectOption("opportunities");
  await page.getByLabel("CSV file").setInputFiles({
    name: "adversarial-opportunities.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8")
  });
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
