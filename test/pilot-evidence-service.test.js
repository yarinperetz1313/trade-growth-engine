"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createPilotEvidenceService
} = require("../src/pilotEvidence/pilotEvidenceService");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");

const TENANT = "10000000-0000-4000-8000-000000000001";
const CONTEXT = createTenantContext({
  tenantId: TENANT,
  subjectId: "auth0|operator"
});

function caseRecord(id, opportunityId) {
  return {
    id,
    opportunity_id: opportunityId,
    state: "OPEN",
    commercial_value: {
      classification: "KNOWN",
      amount: "2500",
      currency: "AUD"
    }
  };
}

function fixture() {
  const records = [];
  const opportunities = new Map([
    ["imported-opp", {
      id: "imported-opp",
      metadata: { import: {
        batch_id: "batch-1",
        source_system: "pilot-crm",
        source_record_id: "private-source-id",
        raw_payload_sha256: "a".repeat(64)
      } }
    }],
    ["sample-opp", {
      id: "sample-opp",
      metadata: { data_origin: "SAMPLE_DEMO" }
    }]
  ]);
  const cases = new Map([
    ["imported-case", caseRecord("imported-case", "imported-opp")],
    ["sample-case", caseRecord("sample-case", "sample-opp")]
  ]);
  const repository = {
    async append(event) {
      const existing = records.find(item => item.semantic_key === event.semantic_key);
      if (existing) return { record: existing, duplicate: true, created: false };
      const publicEvent = structuredClone(event);
      delete publicEvent.tenant_id;
      records.push(publicEvent);
      return { record: publicEvent, duplicate: false, created: true };
    },
    async list() {
      return structuredClone(records);
    }
  };
  const scoped = {
    pilotEvidence: repository,
    revenueLeakCases: {
      findById: async id => structuredClone(cases.get(id) || null),
      listOperatingQueueContexts: async () => ({ contexts: [], totalCount: 0 })
    },
    opportunities: {
      findById: async id => structuredClone(opportunities.get(id) || null)
    },
    imports: {
      findCommit: async id => id === "batch-1" ? {
        outcome: "COMMITTED",
        batch: { id, status: "COMMITTED" },
        rows: [{ targetId: "imported-opp" }],
        summary: { total: 1, committed: 1, skipped: 0, conflicted: 0, failed: 0 }
      } : null
    }
  };
  return {
    records,
    service: createPilotEvidenceService({
      persistence: {
        adapter: "postgres",
        repositories: {
          pilotEvidence: repository,
          transaction: async (context, operation) => {
            assert.equal(context, CONTEXT);
            return operation(scoped);
          }
        },
        forTenant() {
          return { pilotEvidence: repository };
        }
      },
      clock: () => new Date("2026-09-09T01:00:00.000Z"),
      idFactory: type => `event-${type.toLowerCase()}`
    }).forTenant(CONTEXT)
  };
}

test("case inspection and feedback require committed imported-customer provenance", async () => {
  const { records, service } = fixture();
  const inspected = await service.recordCaseInspected("imported-case");
  const replay = await service.recordCaseInspected("imported-case");
  const feedback = await service.recordFeedback("imported-case", "MISSING_CONTEXT");
  const sample = await service.recordCaseInspected("sample-case");

  assert.equal(inspected.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(feedback.ok, true);
  assert.equal(sample.ok, false);
  assert.equal(sample.error, "PILOT_EVIDENCE_CASE_UNAVAILABLE");
  assert.equal(records.length, 2);
  assert.equal(JSON.stringify(records).includes("private-source-id"), false);
  assert.equal(JSON.stringify(records).includes("raw_payload"), false);
});

test("status is bounded, tenant-derived, and resumable without customer content", async () => {
  const { service } = fixture();
  await service.recordCaseInspected("imported-case");
  await service.recordFeedback("imported-case", "USEFUL");
  const status = await service.getStatus();
  assert.deepEqual(status.milestones, {
    import_committed: false,
    portfolio_scan_completed: false,
    first_credible_case_surfaced: false,
    case_inspected: true,
    revenue_action_materialized_linked: false,
    action_approved: false,
    action_executed: false
  });
  assert.equal(status.latest_import, null);
  assert.deepEqual(status.case_feedback, [{
    case_id: "imported-case",
    feedback_code: "USEFUL"
  }]);
  assert.equal(Object.hasOwn(status, "tenant_id"), false);
  assert.equal(JSON.stringify(status).includes("private-source-id"), false);
});
