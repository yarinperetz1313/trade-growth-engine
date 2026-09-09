"use strict";

const crypto = require("node:crypto");

const {
  buildPilotEvidenceEvent,
  conflict
} = require("./pilotEvidenceDomain");
const { classifyOpportunityDataOrigin } = require("./dataOrigin");
const {
  validatePersistedPilotEvidenceEvent
} = require("./jsonPilotEvidenceRepository");
const {
  LOCAL_REVENUE_LEAK_TENANT_ID
} = require("../revenueLeakCases/jsonRevenueLeakCaseRepository");
const {
  readCollection,
  writeCollection
} = require("../services/localStore");

function observeLocalRevenueAction(eventType, action) {
  if (!action || !["ACTION_APPROVED", "ACTION_EXECUTED"].includes(eventType)) {
    return null;
  }
  const linkedCase = readCollection("revenue_leak_cases").find(record =>
    record?.revenue_action_id === action.id
    && record?.opportunity_id === action.opportunity_id
  );
  if (!linkedCase) return null;
  const opportunity = readCollection("opportunities").find(record =>
    record?.id === linkedCase.opportunity_id
  );
  const origin = classifyOpportunityDataOrigin(opportunity);
  if (origin.kind !== "IMPORTED_CUSTOMER") return null;
  const occurredAt = eventType === "ACTION_APPROVED"
    ? action.approved_at
    : action.executed_at;
  const facts = {
    case_id: linkedCase.id,
    import_batch_id: origin.importBatchId,
    revenue_action_id: action.id,
    action_status: eventType === "ACTION_APPROVED" ? "APPROVED" : "EXECUTED",
    ...(eventType === "ACTION_EXECUTED" ? {
      execution_effect_type: action.execution_type === "INTERNAL_TASK"
        ? "INTERNAL_TASK"
        : "COMMUNICATION_MANUAL_CONFIRMATION"
    } : {})
  };
  const event = buildPilotEvidenceEvent({ eventType, facts }, {
    tenantId: LOCAL_REVENUE_LEAK_TENANT_ID,
    subjectId: "local-runtime",
    occurredAt,
    id: eventId(eventType, linkedCase.id, action.id)
  });
  const records = readCollection("pilot_evidence_events")
    .map(validatePersistedPilotEvidenceEvent);
  const existing = records.find(record =>
    record.tenant_id === event.tenant_id
    && record.semantic_key === event.semantic_key
  );
  if (existing) {
    if (
      existing.event_type !== event.event_type
      || JSON.stringify(existing.facts) !== JSON.stringify(event.facts)
    ) throw conflict();
    return existing;
  }
  writeCollection("pilot_evidence_events", [...records, event]);
  return event;
}

function eventId(eventType, caseId, actionId) {
  const digest = crypto.createHash("sha256")
    .update(`${eventType}:${caseId}:${actionId}`)
    .digest("hex");
  return `pilot-action:${digest}`;
}

module.exports = { observeLocalRevenueAction };
