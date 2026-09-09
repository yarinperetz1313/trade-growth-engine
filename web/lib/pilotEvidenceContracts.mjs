const INVALID_RESPONSE_MESSAGE =
  "Pilot evidence was returned in an invalid or inconsistent format.";

const FEEDBACK_CODES = new Set([
  "USEFUL",
  "WRONG",
  "ALREADY_HANDLED",
  "MISSING_CONTEXT",
  "NOT_WORTH_PURSUING"
]);
const VALUE_KINDS = new Set([
  "KNOWN_POSITIVE",
  "KNOWN_ZERO",
  "UNKNOWN",
  "NOT_APPLICABLE"
]);
const SOURCE_COLLECTIONS = new Set([
  "prospects",
  "opportunities",
  "tasks",
  "activities"
]);
const MILESTONE_KEYS = [
  "import_committed",
  "portfolio_scan_completed",
  "first_credible_case_surfaced",
  "case_inspected",
  "revenue_action_materialized_linked",
  "action_approved",
  "action_executed"
];
const IMPORT_FACT_KEYS = [
  "import_batch_id",
  "source_collection",
  "total_count",
  "committed_count",
  "skipped_count",
  "quality_blocked_count",
  "quality_conflict_count",
  "source_identity_covered_count",
  "commercial_value_covered_count",
  "stage_covered_count",
  "created_at_covered_count",
  "created_at_invalid_count",
  "updated_at_covered_count",
  "updated_at_invalid_count",
  "contactable_count"
];

export function unwrapPilotEvidenceStatusResponse(response) {
  const status = response?.data;
  if (
    !isObject(response)
    || !hasExactKeys(response, ["ok", "data"])
    || response.ok !== true
    || !isObject(status)
    || !hasExactKeys(status, [
      "milestones",
      "latest_import",
      "surfaced_case_id",
      "inspected_case_ids",
      "linked_action_ids",
      "case_feedback"
    ])
    || !isObject(status.milestones)
    || !hasExactKeys(status.milestones, MILESTONE_KEYS)
    || !MILESTONE_KEYS.every(key => typeof status.milestones[key] === "boolean")
    || status.milestones.import_committed !== (status.latest_import !== null)
    || status.surfaced_case_id !== null && !boundedText(status.surfaced_case_id, 255)
    || status.milestones.first_credible_case_surfaced
      !== (status.surfaced_case_id !== null)
    || !validIdentifierList(status.inspected_case_ids, 255)
    || status.milestones.case_inspected !== (status.inspected_case_ids.length > 0)
    || !validIdentifierList(status.linked_action_ids, 255)
    || status.milestones.revenue_action_materialized_linked
      !== (status.linked_action_ids.length > 0)
    || !Array.isArray(status.case_feedback)
    || status.case_feedback.length > 100
    || !status.case_feedback.every(validFeedback)
    || !unique(status.case_feedback.map(item => item.case_id))
    || status.latest_import !== null && !validImportFacts(status.latest_import)
  ) invalidResponse();
  return status;
}

export function unwrapPilotEvidenceMutationResponse(
  response,
  expectedEventType,
  expectedCaseId,
  expectedFeedbackCode = null
) {
  const event = response?.data;
  if (
    !isObject(response)
    || !hasExactKeys(response, ["ok", "duplicate", "data"])
    || response.ok !== true
    || typeof response.duplicate !== "boolean"
    || !isObject(event)
    || !hasExactKeys(event, [
      "id",
      "event_type",
      "actor_subject_id",
      "occurred_at",
      "semantic_key",
      "facts"
    ])
    || !boundedText(event.id, 255)
    || event.event_type !== expectedEventType
    || !boundedText(event.actor_subject_id, 512)
    || !timestamp(event.occurred_at)
    || !/^[0-9a-f]{64}$/.test(event.semantic_key || "")
    || !validMutationFacts(
      event.facts,
      expectedEventType,
      expectedCaseId,
      expectedFeedbackCode
    )
  ) invalidResponse();
  return response;
}

export function requiresPilotEvidenceReconciliation(error) {
  const status = error?.status;
  return error?.code === "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN"
    || error?.code === "PILOT_EVIDENCE_BROWSER_RESPONSE_INVALID"
    || !Number.isInteger(status)
    || (status >= 200 && status < 300)
    || status === 408
    || status >= 500;
}

export function createPilotEvidenceOperationGuard() {
  let generation = 0;
  let active = null;
  return Object.freeze({
    begin(kind) {
      if (active !== null || !boundedText(kind, 255)) return null;
      active = Object.freeze({ generation, kind });
      return active;
    },
    finish(token) {
      if (active !== token || token?.generation !== generation) return false;
      active = null;
      return true;
    },
    invalidate() {
      generation += 1;
      active = null;
    },
    isCurrent(token) {
      return active === token && token?.generation === generation;
    },
    isPending() {
      return active !== null;
    }
  });
}

function validMutationFacts(facts, eventType, caseId, feedbackCode) {
  if (!boundedText(caseId, 255) || !isObject(facts)) return false;
  if (eventType === "FIRST_CREDIBLE_CASE_SURFACED") {
    return hasExactKeys(facts, [
      "case_id", "import_batch_id", "value_kind", "currency"
    ])
      && facts.case_id === caseId
      && boundedText(facts.import_batch_id, 200)
      && VALUE_KINDS.has(facts.value_kind)
      && (["KNOWN_POSITIVE", "KNOWN_ZERO"].includes(facts.value_kind)
        ? /^[A-Z]{3}$/.test(facts.currency || "")
        : facts.currency === null);
  }
  if (eventType === "CASE_INSPECTED") {
    return hasExactKeys(facts, ["case_id", "import_batch_id"])
      && facts.case_id === caseId
      && boundedText(facts.import_batch_id, 200)
      && feedbackCode === null;
  }
  if (eventType === "OPERATOR_FEEDBACK") {
    return hasExactKeys(facts, [
      "case_id", "import_batch_id", "feedback_code"
    ])
      && facts.case_id === caseId
      && boundedText(facts.import_batch_id, 200)
      && FEEDBACK_CODES.has(feedbackCode)
      && facts.feedback_code === feedbackCode;
  }
  return false;
}

function validImportFacts(facts) {
  if (
    !isObject(facts)
    || !hasExactKeys(facts, IMPORT_FACT_KEYS)
    || !boundedText(facts.import_batch_id, 200)
    || !SOURCE_COLLECTIONS.has(facts.source_collection)
  ) return false;
  const requiredCounts = [
    "total_count",
    "committed_count",
    "skipped_count",
    "quality_blocked_count",
    "quality_conflict_count",
    "source_identity_covered_count"
  ];
  const nullableCounts = IMPORT_FACT_KEYS.filter(key => (
    !["import_batch_id", "source_collection", ...requiredCounts].includes(key)
  ));
  if (
    !requiredCounts.every(key => count(facts[key]))
    || !nullableCounts.every(key => facts[key] === null || count(facts[key]))
    || facts.committed_count + facts.skipped_count !== facts.total_count
    || facts.quality_blocked_count > facts.total_count
    || facts.quality_conflict_count > facts.total_count
    || facts.source_identity_covered_count > facts.total_count
  ) return false;
  return nullableCounts.every(key => (
    facts[key] === null || facts[key] <= facts.total_count
  ));
}

function validFeedback(value) {
  return isObject(value)
    && hasExactKeys(value, ["case_id", "feedback_code"])
    && boundedText(value.case_id, 255)
    && FEEDBACK_CODES.has(value.feedback_code);
}

function validIdentifierList(values, maximumBytes) {
  return Array.isArray(values)
    && values.length <= 100
    && values.every(value => boundedText(value, maximumBytes))
    && unique(values);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
}

function boundedText(value, maximumBytes) {
  return typeof value === "string"
    && value !== ""
    && value === value.trim()
    && new TextEncoder().encode(value).length <= maximumBytes
    && !/[\0-\x1f\x7f]/.test(value);
}

function timestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function invalidResponse() {
  const error = new Error(INVALID_RESPONSE_MESSAGE);
  error.name = "PilotEvidenceBrowserContractError";
  error.code = "PILOT_EVIDENCE_BROWSER_RESPONSE_INVALID";
  error.status = null;
  throw error;
}
