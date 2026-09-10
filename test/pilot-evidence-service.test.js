"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createPilotEvidenceService
} = require("../src/pilotEvidence/pilotEvidenceService");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");
const {
  buildRevenueLeakCaseDetection
} = require("../src/revenueLeakCases/revenueLeakCaseDomain");

const TENANT = "10000000-0000-4000-8000-000000000001";
const CONTEXT = createTenantContext({
  tenantId: TENANT,
  subjectId: "auth0|operator"
});

function caseRecord(id, opportunityId, amount = "2500") {
  return buildRevenueLeakCaseDetection({
    leak_type: "STALLED_OPPORTUNITY",
    source: {
      system: "TGE",
      entity_type: "OPPORTUNITY",
      entity_id: opportunityId,
      observed_at: "2026-09-01T00:00:00.000Z",
      observed_version: `version-${id}`
    },
    detector: { id: "stalled-opportunity", version: "1" },
    reason_code: "STALE_WITHOUT_NEXT_ACTION",
    evidence_classification: "MIXED",
    evidence: {
      activity_baseline: {
        kind: "OPPORTUNITY_CREATED",
        entity_id: null,
        at: "2026-09-01T00:00:00.000Z"
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
    detectedAt: "2026-09-01T00:00:00.000Z",
    subjectId: "auth0|operator"
  });
}

function fixture() {
  const records = [];
  const opportunities = new Map([
    ["imported-opp", {
      id: "imported-opp",
      prospect_id: null,
      business_name: "Imported business",
      metadata: { import: {
        batch_id: "batch-1",
        source_system: "pilot-crm",
        source_record_id: "private-source-id",
        raw_payload_sha256: "a".repeat(64)
      } }
    }],
    ["second-imported-opp", {
      id: "second-imported-opp",
      prospect_id: null,
      business_name: "Second imported business",
      metadata: { import: {
        batch_id: "batch-1",
        source_system: "pilot-crm",
        source_record_id: "another-private-source-id",
        raw_payload_sha256: "b".repeat(64)
      } }
    }],
    ["sample-opp", {
      id: "sample-opp",
      prospect_id: null,
      business_name: "Demo business",
      metadata: { data_origin: "SAMPLE_DEMO" }
    }]
  ]);
  const cases = new Map([
    ["imported-case", caseRecord("imported-case", "imported-opp")],
    ["second-imported-case", caseRecord(
      "second-imported-case",
      "second-imported-opp",
      "1000"
    )],
    ["sample-case", caseRecord("sample-case", "sample-opp", "9999")]
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
      listOperatingQueueContexts: async () => ({
        contexts: [...cases.values()].map(record => ({
          case: structuredClone(record),
          opportunity: structuredClone(opportunities.get(record.opportunity_id)),
          business: null,
          revenue_action: null
        })),
        totalCount: cases.size
      })
    },
    opportunities: {
      findById: async id => structuredClone(opportunities.get(id) || null)
    },
    imports: {
      findCommit: async id => id === "batch-1" ? {
        outcome: "COMMITTED",
        batch: { id, status: "COMMITTED" },
        rows: [{ targetId: "imported-opp" }, { targetId: "second-imported-opp" }],
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
  assert.equal(status.surfaced_case_id, null);
  assert.deepEqual(status.inspected_case_ids, ["imported-case"]);
  assert.deepEqual(status.linked_action_ids, []);
  assert.deepEqual(status.case_feedback, [{
    case_id: "imported-case",
    feedback_code: "USEFUL"
  }]);
  assert.equal(Object.hasOwn(status, "tenant_id"), false);
  assert.equal(JSON.stringify(status).includes("private-source-id"), false);
});

test("surfacing records only the first server-ranked imported case with exact value truth", async () => {
  const { records, service } = fixture();

  const sample = await service.recordCaseSurfaced("sample-case");
  const lowerRanked = await service.recordCaseSurfaced("second-imported-case");
  const surfaced = await service.recordCaseSurfaced("imported-case");
  const replay = await service.recordCaseSurfaced("imported-case");

  assert.equal(sample.ok, false);
  assert.equal(lowerRanked.ok, false);
  assert.equal(surfaced.ok, true);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(records.find(event =>
    event.event_type === "FIRST_CREDIBLE_CASE_SURFACED"
  ).facts, {
    case_id: "imported-case",
    import_batch_id: "batch-1",
    value_kind: "KNOWN_POSITIVE",
    currency: "AUD"
  });
  assert.equal((await service.getStatus()).surfaced_case_id, "imported-case");
});

test("status bounds exact recovery identifiers to the latest operating-queue limit", async () => {
  const { records, service } = fixture();
  for (let index = 0; index < 101; index += 1) {
    const caseId = `case-${String(index).padStart(3, "0")}`;
    records.push({
      id: `inspect-${index}`,
      event_type: "CASE_INSPECTED",
      actor_subject_id: "auth0|operator",
      occurred_at: new Date(Date.parse("2026-09-01T00:00:00.000Z") + index).toISOString(),
      semantic_key: String(index).padStart(64, "0"),
      facts: { case_id: caseId, import_batch_id: "batch-1" }
    });
    records.push({
      id: `feedback-${index}`,
      event_type: "OPERATOR_FEEDBACK",
      actor_subject_id: "auth0|operator",
      occurred_at: new Date(Date.parse("2026-09-02T00:00:00.000Z") + index).toISOString(),
      semantic_key: String(index + 101).padStart(64, "0"),
      facts: { case_id: caseId, import_batch_id: "batch-1", feedback_code: "USEFUL" }
    });
  }

  const status = await service.getStatus();
  assert.equal(status.inspected_case_ids.length, 100);
  assert.equal(status.case_feedback.length, 100);
  assert.equal(status.inspected_case_ids.includes("case-000"), false);
  assert.equal(status.inspected_case_ids.includes("case-100"), true);
  assert.equal(status.case_feedback.some(item => item.case_id === "case-000"), false);
  assert.equal(status.case_feedback.some(item => item.case_id === "case-100"), true);
});
