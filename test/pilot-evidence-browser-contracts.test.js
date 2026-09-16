"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const contracts = import("../web/lib/pilotEvidenceContracts.mjs");
const repositoryRoot = path.resolve(__dirname, "..");

function importFacts() {
  return {
    import_batch_id: "batch-1",
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
  };
}

function statusResponse() {
  return {
    ok: true,
    data: {
      milestones: {
        import_committed: true,
        portfolio_scan_completed: true,
        first_credible_case_surfaced: true,
        case_inspected: true,
        revenue_action_materialized_linked: true,
        action_approved: false,
        action_executed: false
      },
      latest_import: importFacts(),
      surfaced_case_id: "case-1",
      inspected_case_ids: ["case-1"],
      linked_action_ids: ["action-1"],
      case_feedback: [{ case_id: "case-1", feedback_code: "USEFUL" }]
    }
  };
}

function eventResponse(eventType, facts, duplicate = false) {
  return {
    ok: true,
    duplicate,
    data: {
      id: "event-1",
      event_type: eventType,
      actor_subject_id: "auth0|operator",
      occurred_at: "2026-09-09T01:00:00.000Z",
      semantic_key: "a".repeat(64),
      facts: structuredClone(facts)
    }
  };
}

test("pilot status accepts only the closed privacy-minimized resume projection", async () => {
  const { unwrapPilotEvidenceStatusResponse } = await contracts;
  assert.deepEqual(unwrapPilotEvidenceStatusResponse(statusResponse()), statusResponse().data);

  for (const mutate of [
    body => { body.data.customer_name = "Sensitive Plumbing"; },
    body => { body.data.latest_import.filename = "customers.csv"; },
    body => { body.data.latest_import.commercial_value_covered_count = -1; },
    body => { body.data.inspected_case_ids.push("case-1"); },
    body => { body.data.linked_action_ids = [" "]; },
    body => { body.data.case_feedback[0].feedback_code = "FREE_FORM"; },
    body => { body.data.case_feedback[0].comment = "customer content"; }
  ]) {
    const invalid = structuredClone(statusResponse());
    mutate(invalid);
    assert.throws(
      () => unwrapPilotEvidenceStatusResponse(invalid),
      error => error?.code === "PILOT_EVIDENCE_BROWSER_RESPONSE_INVALID"
    );
  }
});

test("pilot case mutations validate exact event identity and closed feedback", async () => {
  const { unwrapPilotEvidenceMutationResponse } = await contracts;
  const surfacedFacts = {
    case_id: "case-1",
    import_batch_id: "batch-1",
    value_kind: "KNOWN_ZERO",
    currency: "AUD"
  };
  const inspectedFacts = { case_id: "case-1", import_batch_id: "batch-1" };
  const feedbackFacts = {
    case_id: "case-1",
    import_batch_id: "batch-1",
    feedback_code: "MISSING_CONTEXT"
  };

  assert.equal(unwrapPilotEvidenceMutationResponse(
    eventResponse("FIRST_CREDIBLE_CASE_SURFACED", surfacedFacts),
    "FIRST_CREDIBLE_CASE_SURFACED",
    "case-1"
  ).data.facts.value_kind, "KNOWN_ZERO");
  assert.equal(unwrapPilotEvidenceMutationResponse(
    eventResponse("CASE_INSPECTED", inspectedFacts, true),
    "CASE_INSPECTED",
    "case-1"
  ).duplicate, true);
  assert.equal(unwrapPilotEvidenceMutationResponse(
    eventResponse("OPERATOR_FEEDBACK", feedbackFacts),
    "OPERATOR_FEEDBACK",
    "case-1",
    "MISSING_CONTEXT"
  ).data.facts.feedback_code, "MISSING_CONTEXT");

  for (const mutate of [
    body => { body.data.facts.case_id = "other-case"; },
    body => { body.data.facts.comment = "free text"; },
    body => { body.data.actor_subject_id = ""; },
    body => { body.data.occurred_at = "2026-09-09T01:00:00Z"; },
    body => { body.data.semantic_key = "not-a-hash"; },
    body => { body.tenant_id = "client-selected"; }
  ]) {
    const invalid = eventResponse("OPERATOR_FEEDBACK", feedbackFacts);
    mutate(invalid);
    assert.throws(
      () => unwrapPilotEvidenceMutationResponse(
        invalid,
        "OPERATOR_FEEDBACK",
        "case-1",
        "MISSING_CONTEXT"
      ),
      error => error?.code === "PILOT_EVIDENCE_BROWSER_RESPONSE_INVALID"
    );
  }
});

test("pilot evidence ambiguity requires read reconciliation and generations reject stale work", async () => {
  const {
    createPilotEvidenceOperationGuard,
    requiresPilotEvidenceReconciliation
  } = await contracts;

  assert.equal(requiresPilotEvidenceReconciliation(new TypeError("fetch failed")), true);
  assert.equal(requiresPilotEvidenceReconciliation({ status: 503 }), true);
  assert.equal(requiresPilotEvidenceReconciliation({
    code: "PILOT_EVIDENCE_BROWSER_RESPONSE_INVALID"
  }), true);
  assert.equal(requiresPilotEvidenceReconciliation({ status: 400 }), false);
  assert.equal(requiresPilotEvidenceReconciliation({ status: 403 }), false);
  assert.equal(requiresPilotEvidenceReconciliation({ status: 404 }), false);

  const guard = createPilotEvidenceOperationGuard();
  const first = guard.begin("case-1");
  assert.equal(guard.isCurrent(first), true);
  assert.equal(guard.begin("case-2"), null);
  guard.invalidate();
  assert.equal(guard.isCurrent(first), false);
  const second = guard.begin("case-2");
  assert.equal(guard.finish(first), false);
  assert.equal(guard.finish(second), true);
});

test("browser sources keep first-value continuation bounded and outside browser storage", () => {
  const importWorkspace = fs.readFileSync(
    path.join(repositoryRoot, "web/components/ImportWorkspace.jsx"),
    "utf8"
  );
  const commandCenter = fs.readFileSync(
    path.join(repositoryRoot, "web/components/RevenueCommandCenter.jsx"),
    "utf8"
  );
  const api = fs.readFileSync(path.join(repositoryRoot, "web/lib/api.js"), "utf8");
  const revenueContracts = fs.readFileSync(
    path.join(repositoryRoot, "web/lib/revenueLeakCaseContracts.mjs"),
    "utf8"
  );
  const combined = `${importWorkspace}\n${commandCenter}\n${api}\n${revenueContracts}`;

  assert.match(importWorkspace, /Committed Data Health/);
  assert.match(importWorkspace, /Continue to Revenue attention/);
  assert.match(commandCenter, /First credible imported-customer case/);
  assert.match(commandCenter, /Sample \/ demo — excluded from first-value evidence/);
  assert.match(combined, /No eligible stalled-opportunity leak/);
  assert.match(combined, /Evidence stale or untrustworthy/);
  assert.match(combined, /Evidence suppressed by Data Health/);
  assert.match(api, /export async function getPilotEvidenceStatus\b/);
  assert.match(api, /export async function recordPilotCaseInspected\b/);
  assert.match(api, /export async function recordPilotCaseFeedback\b/);
  assert.doesNotMatch(combined, /localStorage|sessionStorage/);
  assert.doesNotMatch(commandCenter, /free.form|textarea/i);
});
