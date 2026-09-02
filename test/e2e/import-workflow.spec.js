import { expect, test } from "@playwright/test";

import {
  adversarialCsv,
  analysisFixture,
  committedFixture,
  conflictFixture,
  previewFixture,
  validationFailureFixture
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
  await expect(page.getByRole("region", { name: "Source identity evidence" })).toContainText("source-1");
  await expect(page.getByRole("region", { name: "Source identity evidence" })).toContainText("Inferred typeTEXT");
  await expect(page.getByRole("region", { name: /^Mapping evidence for / })).toHaveCount(13);
  await expect(page.getByRole("region", { name: "Mapping evidence for value" })).toContainText("UNKNOWN_VALUE_PRESERVED");
  await expect(page.getByText("created_at: 0/2 covered · 0 invalid · 2 missing (0%)")).toBeVisible();
  await expect(page.getByText("updated_at: 0/2 covered · 0 invalid · 2 missing (0%)")).toBeVisible();

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
  await expect(page.getByRole("region", { name: "Source identity evidence" })).toContainText("external_id");
  await expect(page.getByRole("region", { name: /^Mapping evidence for / })).toHaveCount(13);
  await expect(page.getByRole("region", { name: "Mapping evidence for value" })).toContainText("quoted value");
  await expect(page.getByRole("region", { name: "Mapping evidence for value" })).toContainText("1250.50");
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

test("keeps empty, unauthorized, and definitive request failures distinct", async ({ page }) => {
  let previewAttempts = 0;
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, async route => {
    previewAttempts += 1;
    if (previewAttempts === 1) {
      return json(route, 400, {
        ok: false,
        error: "CSV_MALFORMED",
        message: "Preview input is malformed."
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
  await expect(page.getByText("Preview input is malformed.")).toBeVisible();
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

test("fails closed on semantically invalid preview and analysis responses", async ({ page }) => {
  const operations = [];
  let previewPosts = 0;
  let analysisPosts = 0;
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => {
    operations.push("POST");
    previewPosts += 1;
    if (previewPosts === 1) {
      const invalid = previewFixture();
      invalid.records[0].rawPayload.cells[0].valueKind = null;
      return json(route, 200, {
        ok: true,
        data: invalid
      });
    }
    return json(route, 201, { ok: true, data: previewFixture() });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/preview`, route => {
    operations.push("GET");
    return json(route, 404, {
      ok: false,
      error: "IMPORT_BATCH_UNAVAILABLE",
      message: "The requested import batch is unavailable."
    });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, route => {
    analysisPosts += 1;
    if (analysisPosts === 1) {
      const invalid = analysisFixture();
      invalid.dataHealth.validRows = 1;
      return json(route, 200, { ok: true, data: invalid });
    }
    return json(route, 200, { ok: true, data: analysisFixture() });
  });

  await page.goto("/#imports");
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("heading", { name: "Preview outcome unknown" })).toBeVisible();
  await expect(page.getByText("The import service returned an invalid successful response.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Raw evidence preview" })).toHaveCount(0);

  await page.getByRole("button", { name: "Reconcile preview" }).click();
  await expect(page.getByText("No staged preview was found. You may retry the same upload.")).toBeVisible();
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.getByRole("heading", { name: "Raw evidence preview" })).toBeVisible();
  await page.getByRole("button", { name: "Review deterministic mapping" }).click();
  await expect(page.getByText("The import service returned an invalid successful response.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toHaveCount(0);

  await page.getByRole("button", { name: "Review deterministic mapping" }).click();
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toBeVisible();
  expect(operations).toEqual(["POST", "GET", "POST"]);
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

test("reconciles an unsuccessful 2xx preview envelope before another POST", async ({ page }) => {
  const operations = [];
  let previewPosts = 0;
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => {
    operations.push("POST");
    previewPosts += 1;
    return previewPosts === 1
      ? json(route, 200, {
          ok: false,
          error: "IMPORT_PREVIEW_UNACKNOWLEDGED",
          message: "The preview result was not acknowledged.",
          details: { attemptedId: "browser-batch-1" }
        })
      : json(route, 201, { ok: true, data: previewFixture() });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/preview`, route => {
    operations.push("GET");
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
  await expect(page.getByText("The preview result was not acknowledged.")).toBeVisible();
  await page.getByRole("button", { name: "Reconcile preview" }).click();
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.getByRole("heading", { name: "Raw evidence preview" })).toBeVisible();
  expect(operations).toEqual(["POST", "GET", "POST"]);
});

test("blocks preview retry when a network or malformed 2xx outcome has no reconciliation ID", async ({ page }) => {
  let previewPosts = 0;
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => {
    previewPosts += 1;
    return previewPosts === 1
      ? route.abort("failed")
      : route.fulfill({ status: 200, body: "" });
  });

  await page.goto("/#imports");
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("heading", { name: "Preview outcome unknown" })).toBeVisible();
  await expect(page.getByText("The response omitted a safe batch identifier, so this upload cannot be retried automatically.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconcile preview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry preview" })).toHaveCount(0);
  expect(previewPosts).toBe(1);

  await page.reload();
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByRole("heading", { name: "Preview outcome unknown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconcile preview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry preview" })).toHaveCount(0);
  expect(previewPosts).toBe(2);
});

test("rejects an oversized file before issuing a preview request", async ({ page }) => {
  let previewPosts = 0;
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => {
    previewPosts += 1;
    return json(route, 201, { ok: true, data: previewFixture() });
  });

  await page.goto("/#imports");
  await page.getByLabel("Source collection").selectOption("opportunities");
  await page.getByLabel("CSV file").setInputFiles({
    name: "oversized.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc((256 * 1024) + 1, 65)
  });
  await page.getByRole("button", { name: "Create preview" }).click();
  await expect(page.getByText("The CSV upload exceeds the byte limit.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preview outcome unknown" })).toHaveCount(0);
  expect(previewPosts).toBe(0);
});

test("keeps preview outcome unknown after a non-404 reconciliation failure and coalesces GETs", async ({ page }) => {
  let previewPosts = 0;
  let reconciliationGets = 0;
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route => {
    previewPosts += 1;
    return json(route, 500, {
      ok: false,
      error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
      message: "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
      details: { attemptedId: "browser-batch-1" }
    });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/preview`, async route => {
    reconciliationGets += 1;
    await new Promise(resolve => setTimeout(resolve, 150));
    return json(route, 200, {
      ok: false,
      error: "IMPORT_BATCH_UNAVAILABLE",
      message: "Preview reconciliation is temporarily unavailable."
    });
  });

  await page.goto("/#imports");
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  const reconcile = page.getByRole("button", { name: "Reconcile preview" });
  await reconcile.evaluate(button => {
    button.click();
    button.click();
  });

  await expect(page.getByText("Preview reconciliation is temporarily unavailable.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preview outcome unknown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry preview" })).toHaveCount(0);
  expect(reconciliationGets).toBe(1);
  expect(previewPosts).toBe(1);
});

test("blocks confirmation when source identity does not cover every staged row", async ({ page }) => {
  const incomplete = analysisFixture();
  incomplete.dataHealth.sourceIdCoverage = {
    coveredRows: 1,
    totalRows: 2,
    percentage: 50
  };
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route =>
    json(route, 201, { ok: true, data: previewFixture() })
  );
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, route =>
    json(route, 200, { ok: true, data: incomplete })
  );

  await page.goto("/#imports");
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await page.getByRole("button", { name: "Review deterministic mapping" }).click();

  await expect(page.getByText("50% coverage")).toBeVisible();
  await expect(page.getByText("Source identity must cover every staged row before confirmation.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to confirmation" })).toBeDisabled();
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

test("keeps commit outcome unknown when a 2xx reconciliation envelope is unsuccessful", async ({ page }) => {
  let reconciliationGets = 0;
  await mockReadyToCommit(page);
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, async route => {
    if (route.request().method() === "GET") {
      reconciliationGets += 1;
      await new Promise(resolve => setTimeout(resolve, 150));
      return json(route, 200, {
        ok: false,
        error: "IMPORT_RECONCILIATION_UNAVAILABLE",
        message: "Commit reconciliation did not return a successful result."
      });
    }
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
  const reconcile = page.getByRole("button", { name: "Reconcile commit" });
  await reconcile.evaluate(button => {
    button.click();
    button.click();
  });

  await expect(page.getByText("Commit reconciliation did not return a successful result.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Commit outcome unknown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry same commit" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Import committed" })).toHaveCount(0);
  expect(reconciliationGets).toBe(1);
});

test("reconciles a semantically invalid 2xx commit before an identical retry", async ({ page }) => {
  const operations = [];
  const commitBodies = [];
  let commitPosts = 0;
  await mockReadyToCommit(page);
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, route => {
    const method = route.request().method();
    operations.push(method);
    if (method === "GET") {
      return json(route, 404, {
        ok: false,
        error: "IMPORT_BATCH_UNAVAILABLE",
        message: "The requested import batch is unavailable."
      });
    }
    commitPosts += 1;
    commitBodies.push(route.request().postDataJSON());
    if (commitPosts === 1) {
      const invalid = committedFixture();
      invalid.rows[0].disposition = "EXACT_DUPLICATE";
      return json(route, 200, { ok: true, data: invalid });
    }
    return json(route, 200, { ok: true, data: committedFixture() });
  });

  await reachConfirmation(page);
  await page.getByLabel("Source system").fill("pilot-crm");
  await page.getByLabel("I confirm this reviewed mapping and Data Health result.").check();
  await page.getByRole("button", { name: "Commit 2 rows" }).click();
  await expect(page.getByRole("heading", { name: "Commit outcome unknown" })).toBeVisible();
  await expect(page.getByText("The import service returned an invalid successful response.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import committed" })).toHaveCount(0);

  await page.getByRole("button", { name: "Reconcile commit" }).click();
  await page.getByRole("button", { name: "Retry same commit" }).click();
  await expect(page.getByRole("heading", { name: "Import committed" })).toBeVisible();
  expect(operations).toEqual(["POST", "GET", "POST"]);
  expect(commitBodies[1]).toEqual(commitBodies[0]);
  expect(commitBodies[1].idempotencyKey).toBe(commitBodies[0].idempotencyKey);
});

test("invalidates late async work on reset and disables editable request state", async ({ page }) => {
  await page.route(`${apiBaseUrl}/api/import-batches/preview`, route =>
    json(route, 201, { ok: true, data: previewFixture() })
  );
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/analysis`, async route => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return json(route, 200, { ok: true, data: analysisFixture() });
  });
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, async route => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return json(route, 200, { ok: true, data: committedFixture() });
  });

  await page.goto("/#imports");
  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await page.getByRole("button", { name: "Review deterministic mapping" }).click();
  await expect(page.getByRole("button", { name: "Start another import" })).toBeEnabled();
  await page.getByRole("button", { name: "Start another import" }).click();
  await expect(page.getByRole("heading", { name: "Upload CSV" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toHaveCount(0);

  await selectCsv(page, adversarialCsv);
  await page.getByRole("button", { name: "Create preview" }).click();
  await page.getByRole("button", { name: "Review deterministic mapping" }).click();
  await expect(page.getByRole("heading", { name: "Deterministic mapping review" })).toBeVisible();

  await page.getByLabel("Map value").selectOption("quoted value");
  await page.getByRole("button", { name: "Recalculate Data Health" }).click();
  await expect(page.getByRole("button", { name: "Start another import" })).toBeEnabled();
  await expect(page.getByLabel("Map value")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Continue to confirmation" })).toBeDisabled();
  await expect(page.getByText("Mapping and Data Health refreshed.")).toBeVisible();

  await page.getByRole("button", { name: "Continue to confirmation" }).click();
  await page.getByLabel("Source system").fill("pilot-crm");
  await page.getByLabel("I confirm this reviewed mapping and Data Health result.").check();
  await page.getByRole("button", { name: "Commit 2 rows" }).click();
  await expect(page.getByRole("button", { name: "Start another import" })).toBeEnabled();
  await expect(page.getByLabel("Source system")).toBeDisabled();
  await expect(page.getByLabel("I confirm this reviewed mapping and Data Health result.")).toBeDisabled();
  await page.getByRole("button", { name: "Start another import" }).click();
  await expect(page.getByRole("heading", { name: "Upload CSV" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "Import committed" })).toHaveCount(0);
});

test("preserves row-level validation evidence returned by a 422 commit", async ({ page }) => {
  await mockReadyToCommit(page);
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, route =>
    json(route, 422, {
      ok: false,
      error: "IMPORT_COMMIT_VALIDATION_FAILED",
      message: "The canonical import commit failed reviewed mapping validation.",
      details: validationFailureFixture()
    })
  );

  await reachConfirmation(page);
  await page.getByLabel("Source system").fill("pilot-crm");
  await page.getByLabel("I confirm this reviewed mapping and Data Health result.").check();
  await page.getByRole("button", { name: "Commit 2 rows" }).click();

  await expect(page.getByText("The canonical import commit failed reviewed mapping validation.")).toBeVisible();
  await expect(page.getByText("2 failed validation")).toBeVisible();
  await expect(page.getByText("Source ordinal 1 · CANONICAL_ROW_VALIDATION_FAILED")).toBeVisible();
  await expect(page.getByText("SOURCE_IDENTITY_UNKNOWN")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Import committed" })).toHaveCount(0);
});

test("retries a commit only after GET 404 with the identical confirmed request", async ({ page }) => {
  const operations = [];
  const commitBodies = [];
  let commitPosts = 0;
  await mockReadyToCommit(page);
  await page.route(`${apiBaseUrl}/api/import-batches/browser-batch-1/commit`, route => {
    const method = route.request().method();
    operations.push(method);
    if (method === "GET") {
      return json(route, 404, {
        ok: false,
        error: "IMPORT_BATCH_UNAVAILABLE",
        message: "The requested import batch is unavailable."
      });
    }
    commitPosts += 1;
    commitBodies.push(route.request().postDataJSON());
    return commitPosts === 1
      ? json(route, 500, {
          ok: false,
          error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
          message: "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
          details: { attemptedId: "browser-batch-1" }
        })
      : json(route, 200, { ok: true, data: committedFixture() });
  });

  await reachConfirmation(page);
  await page.getByLabel("Source system").fill("pilot-crm");
  await page.getByLabel("I confirm this reviewed mapping and Data Health result.").check();
  await page.getByRole("button", { name: "Commit 2 rows" }).click();
  await page.getByRole("button", { name: "Reconcile commit" }).click();
  await expect(page.getByText("No committed result was found. You may retry the same confirmed request.")).toBeVisible();
  await page.getByRole("button", { name: "Retry same commit" }).click();
  await expect(page.getByRole("heading", { name: "Import committed" })).toBeVisible();

  expect(operations).toEqual(["POST", "GET", "POST"]);
  expect(commitBodies).toHaveLength(2);
  expect(commitBodies[1]).toEqual(commitBodies[0]);
  expect(commitBodies[1].idempotencyKey).toBe(commitBodies[0].idempotencyKey);
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
