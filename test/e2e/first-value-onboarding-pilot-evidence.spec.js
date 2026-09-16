import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";

const require = createRequire(`${process.cwd()}/package.json`);
const {
  buildRevenueLeakCaseDetection
} = require("./src/revenueLeakCases/revenueLeakCaseDomain");
const {
  buildRevenueLeakOperatingQueue
} = require("./src/revenueLeakCases/revenueLeakOperatingQueue");

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";
const reference = Date.parse("2026-09-09T08:00:00.000Z");

function caseContext({ id, amount, origin, businessName, linked = false }) {
  const opportunityId = origin === "IMPORTED_CUSTOMER"
    ? "e2e-opp-stalled"
    : `opportunity-${id}`;
  let record = buildRevenueLeakCaseDetection({
    leak_type: "STALLED_OPPORTUNITY",
    source: {
      system: "TGE",
      entity_type: "OPPORTUNITY",
      entity_id: opportunityId,
      observed_at: "2026-09-08T08:00:00.000Z",
      observed_version: `source-${id}`
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
        entity_id: `activity-${id}`,
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
      amount,
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
    id,
    detectedAt: "2026-09-08T08:00:00.000Z",
    subjectId: "auth0|pilot-e2e"
  });
  const opportunity = {
    id: opportunityId,
    prospect_id: null,
    business_name: businessName,
    metadata: origin === "IMPORTED_CUSTOMER" ? {
      import: {
        batch_id: "browser-batch-1",
        source_system: "pilot-crm",
        source_record_id: "never-projected-private-id",
        raw_payload_sha256: "a".repeat(64)
      }
    } : { data_origin: "SAMPLE_DEMO" }
  };
  let revenueAction = null;
  if (linked) {
    const fingerprint = "b".repeat(64);
    const linkedAt = "2026-09-09T07:00:00.000Z";
    record = {
      ...record,
      revenue_action_id: "pilot-action-1",
      revenue_action_fingerprint: fingerprint,
      revenue_action_status_at_link: "RECOMMENDED",
      revenue_action_linked_at: linkedAt,
      updated_at: linkedAt,
      audit: [...record.audit, {
        transition: "REVENUE_ACTION_LINKED",
        at: linkedAt,
        subject_id: "auth0|pilot-e2e",
        revenue_action_id: "pilot-action-1",
        revenue_action_fingerprint: fingerprint,
        revenue_action_status: "RECOMMENDED"
      }]
    };
    revenueAction = {
      id: "pilot-action-1",
      opportunity_id: opportunityId,
      basis_fingerprint: fingerprint,
      status: "RECOMMENDED"
    };
  }
  return { case: record, opportunity, business: null, revenue_action: revenueAction };
}

function queueResponse(linked = false) {
  const contexts = [
    caseContext({
      id: "case-sample",
      amount: "9000",
      origin: "SAMPLE_DEMO",
      businessName: "Visible Demo Account"
    }),
    caseContext({
      id: "case-imported",
      amount: "2500",
      origin: "IMPORTED_CUSTOMER",
      businessName: "Imported Pilot Account",
      linked
    })
  ];
  return {
    ok: true,
    data: buildRevenueLeakOperatingQueue({
      contexts,
      totalCount: contexts.length,
      generatedAt: new Date(reference).toISOString()
    })
  };
}

function statusResponse(state) {
  return {
    ok: true,
    data: {
      milestones: {
        import_committed: true,
        portfolio_scan_completed: state.scanned,
        first_credible_case_surfaced: state.surfaced,
        case_inspected: state.inspected,
        revenue_action_materialized_linked: state.linked,
        action_approved: Boolean(state.approved),
        action_executed: Boolean(state.executed)
      },
      latest_import: {
        import_batch_id: "browser-batch-1",
        source_collection: "opportunities",
        total_count: 2,
        committed_count: 2,
        skipped_count: 0,
        quality_blocked_count: 0,
        quality_conflict_count: 0,
        source_identity_covered_count: 2,
        commercial_value_covered_count: 1,
        stage_covered_count: 2,
        created_at_covered_count: 1,
        created_at_invalid_count: 0,
        updated_at_covered_count: 2,
        updated_at_invalid_count: 0,
        contactable_count: null
      },
      surfaced_case_id: state.surfaced ? "case-imported" : null,
      inspected_case_ids: state.inspected ? ["case-imported"] : [],
      linked_action_ids: state.linked ? ["pilot-action-1"] : [],
      case_feedback: state.feedback
        ? [{ case_id: "case-imported", feedback_code: "MISSING_CONTEXT" }]
        : []
    }
  };
}

function eventResponse(type, facts) {
  return {
    ok: true,
    duplicate: false,
    data: {
      id: `event-${type.toLowerCase()}`,
      event_type: type,
      actor_subject_id: "auth0|pilot-e2e",
      occurred_at: "2026-09-09T07:30:00.000Z",
      semantic_key: "c".repeat(64),
      facts
    }
  };
}

function scanResponse() {
  const outcomes = [
    ["ELIGIBLE_LEAK_DETECTED", "STALE_WITHOUT_NEXT_ACTION", "CREATED", "case-imported"],
    ["ELIGIBLE_NO_LEAK", "NEXT_ACTION_PRESENT", "READ_ONLY", null],
    ["INSUFFICIENT_EVIDENCE", "OPPORTUNITY_STAGE_MISSING", "READ_ONLY", null],
    ["STALE_OR_UNTRUSTWORTHY_SOURCE", "CANONICAL_SOURCE_TOO_OLD", "READ_ONLY", null],
    ["DATA_HEALTH_SUPPRESSED", "COMMERCIAL_VALUE_INVALID", "READ_ONLY", null]
  ];
  return {
    ok: true,
    evaluated_at: new Date(reference).toISOString(),
    detector: { id: "stalled-opportunity", version: "1" },
    scope: "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES",
    summary: {
      complete: true,
      limit: 100,
      total_opportunities: 5,
      evaluated_count: 5,
      unevaluated_count: 0,
      overflow_count: 0,
      invalid_record_count: 0,
      excluded_count: 0,
      reconciliation: {
        detected_count: 1,
        created_count: 1,
        replayed_count: 0,
        superseded_count: 0
      },
      outcomes: Object.fromEntries(outcomes.map(([outcome, reason]) => [
        outcome,
        { count: 1, reasons: { [reason]: 1 } }
      ]))
    },
    results: outcomes.map(([outcome, reason_code, disposition, case_id], index) => ({
      opportunity_id: `scan-opportunity-${index + 1}`,
      outcome,
      reason_code,
      disposition,
      case_id,
      superseded_case_id: null
    }))
  };
}

async function json(route, body) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

test("resumes committed Data Health and reconciles the exact first-value journey", async ({ page }) => {
  const state = {
    scanned: false,
    surfaced: false,
    inspected: false,
    feedback: false,
    linked: false,
    approved: false,
    executed: false
  };
  const writes = { surface: 0, inspect: 0, feedback: 0, handoff: 0 };
  let action = {
    id: "pilot-action-1",
    opportunity_id: "e2e-opp-stalled",
    action_type: "CREATE_TASK",
    execution_type: "INTERNAL_TASK",
    priority: "HIGH",
    title: "Create a recovery follow-up task",
    reason: "The current credible case has no meaningful next action.",
    status: "RECOMMENDED",
    proposed_execution: null,
    created_at: "2026-09-09T07:00:00.000Z",
    updated_at: "2026-09-09T07:00:00.000Z"
  };

  await page.route(`${apiBaseUrl}/api/pilot-evidence/status`, route =>
    json(route, statusResponse(state))
  );
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, route =>
    json(route, queueResponse(state.linked))
  );
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/scan-stalled-opportunities`, route => {
    state.scanned = true;
    return json(route, scanResponse());
  });
  await page.route(`${apiBaseUrl}/api/pilot-evidence/cases/case-imported/surfaced`, route => {
    writes.surface += 1;
    state.surfaced = true;
    return route.abort("failed");
  });
  await page.route(`${apiBaseUrl}/api/pilot-evidence/cases/case-imported/inspected`, route => {
    writes.inspect += 1;
    state.inspected = true;
    return route.abort("failed");
  });
  await page.route(`${apiBaseUrl}/api/pilot-evidence/cases/case-imported/feedback`, route => {
    expect(route.request().postDataJSON()).toEqual({ feedback_code: "MISSING_CONTEXT" });
    writes.feedback += 1;
    state.feedback = true;
    return route.abort("failed");
  });
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/case-imported/revenue-action`, route => {
    writes.handoff += 1;
    state.linked = true;
    return route.abort("failed");
  });
  await page.route(`${apiBaseUrl}/api/revenue-actions?*`, route =>
    json(route, { ok: true, data: state.linked ? [action] : [], count: state.linked ? 1 : 0 })
  );
  await page.route(
    `${apiBaseUrl}/api/revenue-leak-cases?opportunity_id=e2e-opp-stalled`,
    route => {
      const importedCase = caseContext({
        id: "case-imported",
        amount: "2500",
        origin: "IMPORTED_CUSTOMER",
        businessName: "Imported Pilot Account",
        linked: state.linked
      }).case;
      return json(route, {
        ok: true,
        data: state.linked ? [importedCase] : [],
        count: state.linked ? 1 : 0
      });
    }
  );
  await page.route(`${apiBaseUrl}/api/revenue-actions/pilot-action-1/prepare`, route => {
    action = {
      ...action,
      status: "PREPARED",
      proposed_execution: {
        type: "INTERNAL_TASK",
        title: "Follow up on the stalled opportunity",
        description: "Review the recorded case evidence and choose the next buyer follow-up.",
        priority: "HIGH"
      },
      prepared_at: "2026-09-09T07:40:00.000Z",
      updated_at: "2026-09-09T07:40:00.000Z"
    };
    return json(route, { ok: true, data: action });
  });
  await page.route(`${apiBaseUrl}/api/revenue-actions/pilot-action-1/approve`, route => {
    state.approved = true;
    action = {
      ...action,
      status: "APPROVED",
      approved_at: "2026-09-09T07:45:00.000Z",
      updated_at: "2026-09-09T07:45:00.000Z"
    };
    return json(route, { ok: true, data: action });
  });
  await page.route(`${apiBaseUrl}/api/revenue-actions/pilot-action-1/execute`, route => {
    expect(route.request().postDataJSON()).toEqual({});
    state.executed = true;
    action = {
      ...action,
      status: "EXECUTED",
      executed_at: "2026-09-09T07:50:00.000Z",
      updated_at: "2026-09-09T07:50:00.000Z",
      resulting_task_id: "pilot-task-1",
      resulting_activity_id: "pilot-activity-1",
      execution_result: {
        mode: "INTERNAL_TASK",
        outcome: "TASK_CREATED"
      }
    };
    return json(route, { ok: true, data: action });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#imports");
  const health = page.getByRole("region", { name: "Committed Data Health" });
  await expect(health).toContainText("Durable first-value continuation restored");
  await expect(health).toContainText("Committed2/2");
  await expect(health).toContainText(/Commercial value\s+1\/2/);
  await expect(health).toContainText("Quality blocked0");

  await health.getByRole("button", {
    name: "Continue to Revenue attention"
  }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#opportunities$/);

  const commandCenter = page.getByTestId("revenue-command-center");
  const safeActionPath = commandCenter.getByRole("region", {
    name: "How TGE gets to a safe action"
  });
  await expect(safeActionPath).toContainText("Check your data");
  await expect(safeActionPath).toContainText("Scan when ready");
  await expect(safeActionPath).toContainText("Review the strongest case");
  await expect(commandCenter.getByRole("region", {
    name: "Priority customer review"
  }).locator("[data-case-id]").first()).toHaveAttribute(
    "data-case-id",
    "case-imported"
  );
  const demoCases = commandCenter.getByRole("group", {
    name: "Demo and sample cases"
  });
  await expect(demoCases).not.toHaveAttribute("open", "");
  await expect(demoCases).toContainText(
    "Sample / demo — excluded from first-value evidence"
  );
  await expect(commandCenter).toContainText("First credible imported-customer case");
  if (process.env.TGE_EVIDENCE_DIR) {
    await page.screenshot({
      fullPage: true,
      path: path.join(process.env.TGE_EVIDENCE_DIR, "02-mobile-customer-case.png")
    });
  }
  expect(writes.surface).toBe(0);

  await commandCenter.getByRole("button", { name: "Scan stalled opportunities" }).click();
  await expect(commandCenter.getByLabel("Complete explicit scan outcomes"))
    .toContainText("Evidence stale or untrustworthy");
  await expect(commandCenter.getByText(
    "Durable status confirms the exact pilot evidence fact. No duplicate mutation was attempted."
  )).toBeVisible();
  expect(writes.surface).toBe(1);

  const importedCase = commandCenter.locator('[data-case-id="case-imported"]');
  await importedCase.getByRole("button", {
    name: /Why TGE surfaced this.*Imported Pilot Account/i
  }).focus();
  await page.keyboard.press("Enter");
  await expect(importedCase.getByLabel("First-value case feedback"))
    .toContainText("review of this imported-customer case is recorded");
  expect(writes.inspect).toBe(1);

  await importedCase.getByLabel("Bounded feedback").selectOption("MISSING_CONTEXT");
  await importedCase.getByRole("button", { name: "Record feedback" }).click();
  await expect(importedCase.getByLabel("First-value case feedback"))
    .toContainText("Feedback recorded: MISSING CONTEXT");
  expect(writes.feedback).toBe(1);

  await page.reload();
  await expect(commandCenter).toContainText("First credible imported-customer case");
  expect(writes.surface).toBe(1);
  expect(writes.inspect).toBe(1);
  expect(writes.feedback).toBe(1);

  const refreshedImported = commandCenter.locator('[data-case-id="case-imported"]');
  await refreshedImported.getByRole("button", {
    name: /Why TGE surfaced this.*Imported Pilot Account/i
  }).click();
  await expect(refreshedImported.getByLabel("First-value case feedback"))
    .toContainText("Feedback recorded: MISSING CONTEXT");
  await refreshedImported.getByRole("button", { name: "TAKE ACTION" }).click();
  await expect(refreshedImported).toContainText("RECOMMENDED · approval required");
  expect(writes.handoff).toBe(1);

  await refreshedImported.getByRole("button", {
    name: "CONTINUE ACTION"
  }).click();
  await expect(page).toHaveURL(
    /#opportunities\/e2e-opp-stalled\?focus=action&case=case-imported&action=pilot-action-1$/
  );
  await expect(page.getByTestId("opportunity-command-center")).toBeVisible();
  const execution = page.getByTestId("revenue-action-execution");
  const originatingCase = execution.getByLabel("Originating revenue leak case");
  await expect(originatingCase.getByRole("heading", { name: "E2E Stalled Roofing" })).toBeVisible();
  await expect(originatingCase).toContainText("AUD 2,500");
  await expect(originatingCase).toContainText(
    "The opportunity reached the stalled threshold without a meaningful next action."
  );
  await expect(originatingCase).toContainText("Current opportunity intelligence");
  const originatingDiagnostics = originatingCase.getByRole("group", {
    name: "Originating case diagnostics"
  });
  await expect(originatingDiagnostics).not.toHaveAttribute("open", "");
  await expect(originatingDiagnostics).toContainText("case-imported");
  await expect(originatingDiagnostics).toContainText("STALE_WITHOUT_NEXT_ACTION");
  await expect(execution).toContainText("Review → Approve → Create internal task");
  await expect(execution.getByTestId("revenue-action-status")).toHaveText("RECOMMENDED");
  await expect.poll(async () => {
    const topbar = await page.locator(".topbar").boundingBox();
    const heading = await execution.getByRole("heading", {
      name: "Review → Approve → Create internal task"
    }).boundingBox();
    const value = await originatingCase.locator(".oc-originating-case-value strong").boundingBox();
    const status = await execution.getByTestId("revenue-action-status").boundingBox();
    return {
      headingBelowChrome: heading.y >= topbar.y + topbar.height,
      headingVisible: heading.y + heading.height <= 844,
      valueVisible: value.y + value.height <= 844,
      statusVisible: status.y + status.height <= 844
    };
  }).toEqual({
    headingBelowChrome: true,
    headingVisible: true,
    valueVisible: true,
    statusVisible: true
  });
  await execution.getByRole("button", { name: "Prepare action" }).click();
  await expect(execution.getByTestId("internal-task-proposal"))
    .toContainText("No due date invented");
  await execution.getByTestId("approve-revenue-action").click();
  await expect(execution.getByTestId("revenue-action-status")).toHaveText("APPROVED");
  await execution.getByTestId("execute-revenue-action").click();
  await expect(execution.getByTestId("internal-task-completion"))
    .toContainText("Internal task created");
  await expect(execution.getByTestId("internal-task-completion"))
    .toContainText("No message was sent");
  await expect(execution.getByTestId("revenue-action-history")).toContainText("EXECUTED");
  await expect(execution.getByTestId("revenue-action-history")).toContainText("CRM task linked");
  await expect(execution.getByTestId("revenue-action-history")).toContainText("CRM activity linked");
  if (process.env.TGE_EVIDENCE_DIR) {
    await page.screenshot({
      fullPage: true,
      path: path.join(process.env.TGE_EVIDENCE_DIR, "03-mobile-task-created.png")
    });
  }
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth
  }))).toEqual({ body: 390, viewport: 390 });
});

test("leads with customer-case money and discloses the server all-case aggregate when samples exist", async ({ page }) => {
  const state = {
    scanned: false,
    surfaced: false,
    inspected: false,
    feedback: false,
    linked: false,
    approved: false,
    executed: false
  };

  await page.route(`${apiBaseUrl}/api/pilot-evidence/status`, route =>
    json(route, statusResponse(state))
  );
  await page.route(`${apiBaseUrl}/api/revenue-leak-cases/operating-queue`, route =>
    json(route, queueResponse(false))
  );

  await page.goto("/#opportunities");

  const commandCenter = page.getByTestId("revenue-command-center");
  const primary = commandCenter.getByLabel("Primary customer-case economic evidence");
  await expect(primary).toContainText("Imported Pilot Account");
  await expect(primary).toContainText("AUD 2,500");
  await expect(primary).not.toContainText("AUD 11,500");

  const allCases = commandCenter.getByRole("group", {
    name: "All active-case aggregate including sample and demo evidence"
  });
  await expect(allCases).not.toHaveAttribute("open", "");
  await expect(allCases).toContainText("Server all-case aggregate");
  await expect(allCases).toContainText("AUD 11,500");
  await expect(allCases).toContainText("2 cases");
});
