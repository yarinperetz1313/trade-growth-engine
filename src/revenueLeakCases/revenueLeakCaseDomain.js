"use strict";

const { createHash } = require("node:crypto");

const {
  canonicalizeDecimalLiteral,
  isCanonicalNumericLiteralRepresentable,
  isNegativeNumberLiteral
} = require("../imports/numericEvidence");

const SUPPORTED_LEAK_TYPES = Object.freeze(["STALLED_OPPORTUNITY"]);
const VALUE_CLASSIFICATIONS = Object.freeze([
  "KNOWN",
  "UNKNOWN",
  "NOT_APPLICABLE"
]);
const EVIDENCE_CLASSIFICATIONS = Object.freeze([
  "OBSERVED",
  "DERIVED",
  "MIXED"
]);

class RevenueLeakCaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RevenueLeakCaseError";
    this.code = code;
    this.details = details;
  }
}

function invalid(message, field) {
  throw new RevenueLeakCaseError(
    "REVENUE_LEAK_CASE_INPUT_INVALID",
    message,
    field ? { field } : {}
  );
}

function nonEmptyString(value, field, { max = 512, pattern } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    invalid(`${field} must be a non-empty string.`, field);
  }
  const normalized = value.trim();
  if (Buffer.byteLength(normalized) > max || (pattern && !pattern.test(normalized))) {
    invalid(`${field} is invalid.`, field);
  }
  return normalized;
}

function normalizeTimestamp(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "string" && !(value instanceof Date)) {
    invalid(`${field} must be an ISO-8601 timestamp.`, field);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    invalid(`${field} must be an ISO-8601 timestamp.`, field);
  }
  return parsed.toISOString();
}

function canonicalJson(value, field = "value", ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(`${field} must contain finite JSON numbers.`, field);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || value instanceof Date) {
    invalid(`${field} must contain only JSON values.`, field);
  }
  if (ancestors.has(value)) invalid(`${field} must not contain cycles.`, field);
  ancestors.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item, index) =>
      canonicalJson(item, `${field}[${index}]`, ancestors)
    );
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid(`${field} must contain plain JSON objects.`, field);
    }
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        invalid(`${field}.${key} must not be undefined.`, `${field}.${key}`);
      }
      Object.defineProperty(normalized, key, {
        value: canonicalJson(value[key], `${field}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  }
  ancestors.delete(value);
  return normalized;
}

function requiredObject(value, field, { nonEmpty = false } = {}) {
  const normalized = canonicalJson(value, field);
  if (!normalized || Array.isArray(normalized)) {
    invalid(`${field} must be a JSON object.`, field);
  }
  if (nonEmpty && Object.keys(normalized).length === 0) {
    invalid(`${field} must not be empty.`, field);
  }
  return normalized;
}

function assertExactKeys(value, allowed, field) {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  if (unexpected.length > 0) {
    invalid(`${field} contains unsupported fields.`, `${field}.${unexpected[0]}`);
  }
}

function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson(value)))
    .digest("hex");
}

function normalizeCommercialValue(value) {
  const input = requiredObject(value, "commercial_value");
  assertExactKeys(input, ["classification", "amount", "currency"], "commercial_value");
  const classification = nonEmptyString(
    input.classification,
    "commercial_value.classification"
  ).toUpperCase();
  if (!VALUE_CLASSIFICATIONS.includes(classification)) {
    invalid("commercial_value.classification is unsupported.", "commercial_value.classification");
  }

  if (classification !== "KNOWN") {
    if (
      (Object.hasOwn(input, "amount") && input.amount !== null)
      || (Object.hasOwn(input, "currency") && input.currency !== null)
    ) {
      invalid(
        `${classification} commercial value cannot carry amount or currency.`,
        "commercial_value"
      );
    }
    return { classification, amount: null, currency: null };
  }

  if (!Object.hasOwn(input, "amount") || !Object.hasOwn(input, "currency")) {
    invalid("KNOWN commercial value requires amount and currency.", "commercial_value");
  }
  if (
    (typeof input.amount !== "string" && typeof input.amount !== "number")
    || (typeof input.amount === "number" && !Number.isFinite(input.amount))
  ) {
    invalid("KNOWN commercial value amount is invalid.", "commercial_value.amount");
  }
  const literal = String(input.amount);
  if (
    isNegativeNumberLiteral(literal)
    || !isCanonicalNumericLiteralRepresentable(literal)
  ) {
    invalid(
      "KNOWN commercial value must fit NUMERIC(20,6) and be non-negative.",
      "commercial_value.amount"
    );
  }
  const amount = canonicalizeDecimalLiteral(literal);
  const currency = nonEmptyString(
    input.currency,
    "commercial_value.currency",
    { max: 3, pattern: /^[A-Za-z]{3}$/ }
  ).toUpperCase();
  return { classification, amount, currency };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function buildRevenueLeakCaseDetection(input, {
  id,
  detectedAt,
  subjectId
} = {}) {
  const body = requiredObject(input, "detection");
  assertExactKeys(body, [
    "leak_type",
    "source",
    "detector",
    "reason_code",
    "evidence_classification",
    "evidence",
    "commercial_value",
    "recommended_action_type",
    "due_at",
    "supersession_condition"
  ], "detection");
  const caseId = nonEmptyString(id, "id", { max: 255 });
  const detected_at = normalizeTimestamp(detectedAt, "detected_at");
  const subject_id = nonEmptyString(subjectId, "subject_id", { max: 512 });
  const leak_type = nonEmptyString(body.leak_type, "leak_type").toUpperCase();
  if (!SUPPORTED_LEAK_TYPES.includes(leak_type)) {
    invalid("Only STALLED_OPPORTUNITY is supported by this foundation.", "leak_type");
  }

  const source = requiredObject(body.source, "source");
  assertExactKeys(source, [
    "system",
    "entity_type",
    "entity_id",
    "observed_at",
    "observed_version"
  ], "source");
  const source_system = nonEmptyString(source.system, "source.system", { max: 128 });
  const source_entity_type = nonEmptyString(
    source.entity_type,
    "source.entity_type",
    { max: 64 }
  ).toUpperCase();
  const source_entity_id = nonEmptyString(
    source.entity_id,
    "source.entity_id",
    { max: 512 }
  );
  if (source_system !== "TGE" || source_entity_type !== "OPPORTUNITY") {
    invalid(
      "STALLED_OPPORTUNITY requires a canonical TGE opportunity source.",
      "source"
    );
  }
  const source_observed_at = normalizeTimestamp(
    source.observed_at,
    "source.observed_at"
  );
  const source_observed_version = nonEmptyString(
    source.observed_version,
    "source.observed_version",
    { max: 255 }
  );
  if (Date.parse(source_observed_at) > Date.parse(detected_at)) {
    invalid("source.observed_at cannot be after detection.", "source.observed_at");
  }

  const detector = requiredObject(body.detector, "detector");
  assertExactKeys(detector, ["id", "version"], "detector");
  const detector_id = nonEmptyString(detector.id, "detector.id", { max: 128 });
  const detector_version = nonEmptyString(
    detector.version,
    "detector.version",
    { max: 128 }
  );
  const reason_code = nonEmptyString(body.reason_code, "reason_code", {
    max: 128,
    pattern: /^[A-Z][A-Z0-9_]*$/
  });
  const evidence_classification = nonEmptyString(
    body.evidence_classification,
    "evidence_classification"
  ).toUpperCase();
  if (!EVIDENCE_CLASSIFICATIONS.includes(evidence_classification)) {
    invalid("evidence_classification is unsupported.", "evidence_classification");
  }
  const evidence = requiredObject(body.evidence, "evidence", { nonEmpty: true });
  const commercial_value = normalizeCommercialValue(body.commercial_value);
  const recommended_action_type = nonEmptyString(
    body.recommended_action_type,
    "recommended_action_type",
    { max: 128 }
  );
  const due_at = normalizeTimestamp(body.due_at, "due_at", { nullable: true });
  const supersession_condition = requiredObject(
    body.supersession_condition,
    "supersession_condition",
    { nonEmpty: true }
  );

  const evidence_snapshot = {
    classification: evidence_classification,
    source_observation: {
      observed_at: source_observed_at,
      observed_version: source_observed_version
    },
    facts: evidence
  };
  const evidence_fingerprint = fingerprint(evidence_snapshot);
  const seriesBasis = {
    leak_type,
    source_system,
    source_entity_type,
    source_entity_id,
    detector_id
  };
  const series_key = fingerprint(seriesBasis);
  const semantic_key = fingerprint({
    ...seriesBasis,
    detector_version,
    reason_code,
    evidence_fingerprint,
    commercial_value,
    recommended_action_type,
    due_at,
    supersession_condition
  });

  return deepFreeze({
    id: caseId,
    leak_type,
    state: "OPEN",
    source_system,
    source_entity_type,
    source_entity_id,
    opportunity_id: source_entity_id,
    source_observed_at,
    source_observed_version,
    detector_id,
    detector_version,
    reason_code,
    evidence_classification,
    evidence_snapshot,
    evidence_fingerprint,
    series_key,
    semantic_key,
    commercial_value,
    recommended_action_type,
    due_at,
    supersession_condition,
    supersedes_case_id: null,
    superseded_by_case_id: null,
    revenue_action_id: null,
    revenue_action_fingerprint: null,
    revenue_action_status_at_link: null,
    revenue_action_linked_at: null,
    snoozed_at: null,
    snoozed_until: null,
    snooze_reason: null,
    dismissed_at: null,
    dismissal_reason: null,
    superseded_at: null,
    supersession_reason: null,
    detected_at,
    created_at: detected_at,
    updated_at: detected_at,
    audit: [{
      transition: "OPEN",
      at: detected_at,
      subject_id,
      detector_id,
      detector_version,
      reason_code
    }]
  });
}

module.exports = {
  EVIDENCE_CLASSIFICATIONS,
  RevenueLeakCaseError,
  SUPPORTED_LEAK_TYPES,
  VALUE_CLASSIFICATIONS,
  buildRevenueLeakCaseDetection,
  canonicalJson,
  deepFreeze,
  fingerprint,
  normalizeCommercialValue,
  normalizeTimestamp
};
