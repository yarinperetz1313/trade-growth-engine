"use strict";

const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const PILOT_EVENT_TYPES = Object.freeze([
  "IMPORT_COMMITTED",
  "PORTFOLIO_SCAN_COMPLETED",
  "FIRST_CREDIBLE_CASE_SURFACED",
  "CASE_INSPECTED",
  "REVENUE_ACTION_MATERIALIZED_LINKED",
  "ACTION_APPROVED",
  "ACTION_EXECUTED",
  "OPERATOR_FEEDBACK"
]);
const FEEDBACK_CODES = Object.freeze([
  "USEFUL",
  "WRONG",
  "ALREADY_HANDLED",
  "MISSING_CONTEXT",
  "NOT_WORTH_PURSUING"
]);
const SOURCE_COLLECTIONS = new Set([
  "prospects", "opportunities", "tasks", "activities"
]);
const VALUE_KINDS = new Set([
  "KNOWN_POSITIVE", "KNOWN_ZERO", "UNKNOWN", "NOT_APPLICABLE"
]);
const EXECUTION_EFFECT_TYPES = new Set([
  "INTERNAL_TASK", "COMMUNICATION_MANUAL_CONFIRMATION"
]);
const EVENT_TYPE_SET = new Set(PILOT_EVENT_TYPES);
const FEEDBACK_CODE_SET = new Set(FEEDBACK_CODES);
const SINGLETON_MILESTONE_TYPES = new Set([
  "PORTFOLIO_SCAN_COMPLETED",
  "FIRST_CREDIBLE_CASE_SURFACED"
]);

const FACT_KEYS = Object.freeze({
  IMPORT_COMMITTED: [
    "import_batch_id", "source_collection", "total_count", "committed_count",
    "skipped_count", "quality_blocked_count", "quality_conflict_count",
    "source_identity_covered_count", "commercial_value_covered_count",
    "stage_covered_count", "created_at_covered_count",
    "created_at_invalid_count", "updated_at_covered_count",
    "updated_at_invalid_count", "contactable_count"
  ],
  PORTFOLIO_SCAN_COMPLETED: [
    "evaluated_count", "eligible_leak_count", "eligible_no_leak_count",
    "insufficient_evidence_count", "stale_source_count",
    "data_health_suppressed_count", "excluded_count"
  ],
  FIRST_CREDIBLE_CASE_SURFACED: [
    "case_id", "import_batch_id", "value_kind", "currency"
  ],
  CASE_INSPECTED: ["case_id", "import_batch_id"],
  REVENUE_ACTION_MATERIALIZED_LINKED: [
    "case_id", "import_batch_id", "revenue_action_id", "action_status"
  ],
  ACTION_APPROVED: [
    "case_id", "import_batch_id", "revenue_action_id", "action_status"
  ],
  ACTION_EXECUTED: [
    "case_id", "import_batch_id", "revenue_action_id", "action_status",
    "execution_effect_type"
  ],
  OPERATOR_FEEDBACK: ["case_id", "import_batch_id", "feedback_code"]
});

class PilotEvidenceError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = "PilotEvidenceError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function invalid(field = "facts") {
  throw new PilotEvidenceError(
    "PILOT_EVIDENCE_INVALID",
    "Pilot evidence is outside the closed privacy-minimized contract.",
    400,
    { field }
  );
}

function conflict() {
  return new PilotEvidenceError(
    "PILOT_EVIDENCE_CONFLICT",
    "An immutable pilot evidence fact already exists with different bounded evidence.",
    409
  );
}

function buildPilotEvidenceEvent(input, authority = {}) {
  if (!exactObject(input, ["eventType", "facts"])) invalid("event");
  if (!EVENT_TYPE_SET.has(input.eventType)) invalid("eventType");
  validateFacts(input.eventType, input.facts);
  const tenantId = boundedText(authority.tenantId, 64, "tenantId");
  const actorSubjectId = boundedText(authority.subjectId, 512, "subjectId");
  const id = boundedText(authority.id, 255, "id");
  const occurredAt = timestamp(authority.occurredAt, "occurredAt");
  const facts = structuredClone(input.facts);
  const semanticKey = sha256(stableJson({
    event_type: input.eventType,
    identity: semanticIdentity(input.eventType, facts)
  }));
  return deepFreeze({
    tenant_id: tenantId,
    id,
    event_type: input.eventType,
    actor_subject_id: actorSubjectId,
    occurred_at: occurredAt,
    semantic_key: semanticKey,
    facts
  });
}

function validateFacts(eventType, facts) {
  const keys = FACT_KEYS[eventType];
  if (!exactObject(facts, keys)) invalid("facts");
  if (eventType === "IMPORT_COMMITTED") return validateImportFacts(facts);
  if (eventType === "PORTFOLIO_SCAN_COMPLETED") return validateScanFacts(facts);
  if (eventType === "FIRST_CREDIBLE_CASE_SURFACED") {
    caseIdentity(facts);
    if (!VALUE_KINDS.has(facts.value_kind)) invalid("value_kind");
    const known = ["KNOWN_POSITIVE", "KNOWN_ZERO"].includes(facts.value_kind);
    if (known !== (typeof facts.currency === "string" && /^[A-Z]{3}$/.test(facts.currency))) {
      invalid("currency");
    }
    if (!known && facts.currency !== null) invalid("currency");
    return;
  }
  if (eventType === "CASE_INSPECTED") return caseIdentity(facts);
  if (eventType === "OPERATOR_FEEDBACK") {
    caseIdentity(facts);
    if (!FEEDBACK_CODE_SET.has(facts.feedback_code)) invalid("feedback_code");
    return;
  }
  caseIdentity(facts);
  boundedText(facts.revenue_action_id, 255, "revenue_action_id");
  const expectedStatus = eventType === "REVENUE_ACTION_MATERIALIZED_LINKED"
    ? "RECOMMENDED"
    : eventType === "ACTION_APPROVED" ? "APPROVED" : "EXECUTED";
  if (facts.action_status !== expectedStatus) invalid("action_status");
  if (
    eventType === "ACTION_EXECUTED"
    && !EXECUTION_EFFECT_TYPES.has(facts.execution_effect_type)
  ) invalid("execution_effect_type");
}

function validateImportFacts(facts) {
  boundedText(facts.import_batch_id, 200, "import_batch_id");
  if (!SOURCE_COLLECTIONS.has(facts.source_collection)) invalid("source_collection");
  const countFields = [
    "total_count", "committed_count", "skipped_count", "quality_blocked_count",
    "quality_conflict_count", "source_identity_covered_count"
  ];
  for (const field of countFields) count(facts[field], field);
  for (const field of [
    "commercial_value_covered_count", "stage_covered_count",
    "created_at_covered_count", "created_at_invalid_count",
    "updated_at_covered_count", "updated_at_invalid_count", "contactable_count"
  ]) nullableCount(facts[field], field);
  if (
    facts.committed_count + facts.skipped_count !== facts.total_count
    || facts.quality_blocked_count > facts.total_count
    || facts.quality_conflict_count > facts.total_count
    || facts.source_identity_covered_count > facts.total_count
  ) invalid("counts");
  for (const field of [
    "commercial_value_covered_count", "stage_covered_count",
    "created_at_covered_count", "created_at_invalid_count",
    "updated_at_covered_count", "updated_at_invalid_count", "contactable_count"
  ]) if (facts[field] !== null && facts[field] > facts.total_count) invalid(field);
}

function pilotEvidenceFactsEqual(left, right) {
  return isDeepStrictEqual(left, right);
}

function validateScanFacts(facts) {
  for (const key of FACT_KEYS.PORTFOLIO_SCAN_COMPLETED) count(facts[key], key);
  if (
    facts.eligible_leak_count
      + facts.eligible_no_leak_count
      + facts.insufficient_evidence_count
      + facts.stale_source_count
      + facts.data_health_suppressed_count
      !== facts.evaluated_count
  ) invalid("counts");
}

function caseIdentity(facts) {
  boundedText(facts.case_id, 255, "case_id");
  boundedText(facts.import_batch_id, 200, "import_batch_id");
}

function semanticIdentity(eventType, facts) {
  if (["PORTFOLIO_SCAN_COMPLETED", "FIRST_CREDIBLE_CASE_SURFACED"].includes(eventType)) {
    return "FIRST_PER_TENANT";
  }
  if (eventType === "IMPORT_COMMITTED") return facts.import_batch_id;
  if (["CASE_INSPECTED", "OPERATOR_FEEDBACK"].includes(eventType)) {
    return facts.case_id;
  }
  return `${facts.case_id}:${facts.revenue_action_id}`;
}

function publicPilotEvidenceEvent(event) {
  if (!event || typeof event !== "object") invalid("event");
  const clone = structuredClone(event);
  delete clone.tenant_id;
  return deepFreeze(clone);
}

function isSingletonMilestone(eventType) {
  return SINGLETON_MILESTONE_TYPES.has(eventType);
}

function exactObject(value, keys) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
  );
}

function boundedText(value, maximumBytes, field) {
  if (
    typeof value !== "string"
    || value === ""
    || value !== value.trim()
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || /[\0-\x1f\x7f]/.test(value)
  ) invalid(field);
  return value;
}

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) invalid(field);
  return value;
}

function nullableCount(value, field) {
  if (value === null) return null;
  return count(value, field);
}

function timestamp(value, field) {
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.valueOf())) invalid(field);
  return date.toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

module.exports = {
  EXECUTION_EFFECT_TYPES,
  FACT_KEYS,
  FEEDBACK_CODES,
  PILOT_EVENT_TYPES,
  PilotEvidenceError,
  buildPilotEvidenceEvent,
  conflict,
  isSingletonMilestone,
  pilotEvidenceFactsEqual,
  publicPilotEvidenceEvent
};
