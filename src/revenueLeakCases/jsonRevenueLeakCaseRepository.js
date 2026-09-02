"use strict";

const {
  RevenueLeakCaseError,
  buildRevenueLeakCaseDetection,
  canonicalJson,
  deepFreeze,
  normalizeTimestamp,
  requireCanonicalCommercialValue
} = require("./revenueLeakCaseDomain");
const {
  requireTenantContext
} = require("../persistence/tenantContext");

const REVENUE_ACTION_STATUSES = new Set([
  "RECOMMENDED",
  "PREPARED",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "REJECTED",
  "CANCELLED",
  "FAILED"
]);
const ACTIVE_STATES = new Set(["OPEN", "SNOOZED"]);
const PERSISTED_CASE_KEYS = Object.freeze([
  "tenant_id",
  "id",
  "leak_type",
  "state",
  "source_system",
  "source_entity_type",
  "source_entity_id",
  "opportunity_id",
  "source_observed_at",
  "source_observed_version",
  "detector_id",
  "detector_version",
  "reason_code",
  "evidence_classification",
  "evidence_snapshot",
  "evidence_fingerprint",
  "series_key",
  "semantic_key",
  "commercial_value",
  "recommended_action_type",
  "due_at",
  "supersession_condition",
  "supersedes_case_id",
  "superseded_by_case_id",
  "revenue_action_id",
  "revenue_action_fingerprint",
  "revenue_action_status_at_link",
  "revenue_action_linked_at",
  "snoozed_at",
  "snoozed_until",
  "snooze_reason",
  "dismissed_at",
  "dismissal_reason",
  "superseded_at",
  "supersession_reason",
  "detected_at",
  "created_at",
  "updated_at",
  "audit"
]);

function fail(code, message, details = {}) {
  throw new RevenueLeakCaseError(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length
    && actual.every((key, index) => key === required[index]);
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function isCanonicalTimestamp(value) {
  return typeof value === "string" && normalizeTimestamp(value, "persisted timestamp") === value;
}

function isCanonicalNullableTimestamp(value) {
  return value === null || isCanonicalTimestamp(value);
}

function isTrimmedText(value, max = 1000) {
  return typeof value === "string"
    && value === value.trim()
    && value !== ""
    && Buffer.byteLength(value) <= max;
}

function isNullableText(value) {
  return value === null || isTrimmedText(value);
}

function integrityFailure() {
  fail(
    "REVENUE_LEAK_CASE_INTEGRITY_CONFLICT",
    "Persisted revenue leak case truth is malformed."
  );
}

function assertIntegrity(condition) {
  if (!condition) integrityFailure();
}

function validateAuditAndLifecycle(record) {
  assertIntegrity(Array.isArray(record.audit) && record.audit.length >= 1);
  const initial = record.audit[0];
  assertIntegrity(hasExactKeys(initial, [
    "transition",
    "at",
    "subject_id",
    "detector_id",
    "detector_version",
    "reason_code"
  ]));
  assertIntegrity(
    initial.transition === "OPEN"
    && initial.at === record.detected_at
    && isTrimmedText(initial.subject_id, 512)
    && initial.detector_id === record.detector_id
    && initial.detector_version === record.detector_version
    && initial.reason_code === record.reason_code
  );

  const expected = {
    state: "OPEN",
    updated_at: record.detected_at,
    revenue_action_id: null,
    revenue_action_fingerprint: null,
    revenue_action_status_at_link: null,
    revenue_action_linked_at: null,
    snoozed_at: null,
    snoozed_until: null,
    snooze_reason: null,
    dismissed_at: null,
    dismissal_reason: null,
    superseded_by_case_id: null,
    superseded_at: null,
    supersession_reason: null
  };

  for (const entry of record.audit.slice(1)) {
    assertIntegrity(isPlainObject(entry) && isCanonicalTimestamp(entry.at));
    assertIntegrity(
      isTrimmedText(entry.subject_id, 512)
      && Date.parse(entry.at) >= Date.parse(record.detected_at)
    );
    if (entry.transition === "SNOOZED") {
      assertIntegrity(hasExactKeys(entry, [
        "transition", "at", "subject_id", "reason", "wake_at"
      ]));
      assertIntegrity(
        expected.state === "OPEN"
        && isTrimmedText(entry.reason)
        && isCanonicalTimestamp(entry.wake_at)
        && Date.parse(entry.wake_at) > Date.parse(entry.at)
      );
      Object.assign(expected, {
        state: "SNOOZED",
        snoozed_at: entry.at,
        snoozed_until: entry.wake_at,
        snooze_reason: entry.reason
      });
    } else if (entry.transition === "REOPENED") {
      assertIntegrity(hasExactKeys(entry, [
        "transition", "at", "subject_id", "reason"
      ]));
      assertIntegrity(expected.state === "SNOOZED" && isTrimmedText(entry.reason));
      Object.assign(expected, {
        state: "OPEN",
        snoozed_at: null,
        snoozed_until: null,
        snooze_reason: null
      });
    } else if (entry.transition === "DISMISSED") {
      assertIntegrity(hasExactKeys(entry, [
        "transition", "at", "subject_id", "reason"
      ]));
      assertIntegrity(ACTIVE_STATES.has(expected.state) && isTrimmedText(entry.reason));
      Object.assign(expected, {
        state: "DISMISSED",
        dismissed_at: entry.at,
        dismissal_reason: entry.reason
      });
    } else if (entry.transition === "SUPERSEDED") {
      assertIntegrity(hasExactKeys(entry, [
        "transition",
        "at",
        "subject_id",
        "reason_code",
        "superseded_by_case_id",
        "replacement_semantic_key"
      ]));
      assertIntegrity(
        ACTIVE_STATES.has(expected.state)
        && entry.reason_code === "CANONICAL_EVIDENCE_CHANGED"
        && isTrimmedText(entry.superseded_by_case_id, 255)
        && /^[0-9a-f]{64}$/.test(entry.replacement_semantic_key)
      );
      Object.assign(expected, {
        state: "SUPERSEDED",
        superseded_by_case_id: entry.superseded_by_case_id,
        superseded_at: entry.at,
        supersession_reason: entry.reason_code
      });
    } else if (entry.transition === "REVENUE_ACTION_LINKED") {
      assertIntegrity(hasExactKeys(entry, [
        "transition",
        "at",
        "subject_id",
        "revenue_action_id",
        "revenue_action_fingerprint",
        "revenue_action_status"
      ]));
      assertIntegrity(
        ACTIVE_STATES.has(expected.state)
        && expected.revenue_action_id === null
        && isTrimmedText(entry.revenue_action_id, 255)
        && /^[0-9a-f]{64}$/.test(entry.revenue_action_fingerprint)
        && REVENUE_ACTION_STATUSES.has(entry.revenue_action_status)
      );
      Object.assign(expected, {
        revenue_action_id: entry.revenue_action_id,
        revenue_action_fingerprint: entry.revenue_action_fingerprint,
        revenue_action_status_at_link: entry.revenue_action_status,
        revenue_action_linked_at: entry.at
      });
    } else {
      integrityFailure();
    }
    expected.updated_at = entry.at;
  }

  for (const [field, value] of Object.entries(expected)) {
    assertIntegrity(record[field] === value);
  }
}

function validatePersistedCase(record, tenantId) {
  try {
    assertIntegrity(hasExactKeys(record, PERSISTED_CASE_KEYS));
    assertIntegrity(record.tenant_id === tenantId);
    assertIntegrity(isPlainObject(record.evidence_snapshot));
    assertIntegrity(hasExactKeys(record.evidence_snapshot, [
      "classification", "source_observation", "facts"
    ]));
    assertIntegrity(isPlainObject(record.evidence_snapshot.source_observation));
    assertIntegrity(hasExactKeys(record.evidence_snapshot.source_observation, [
      "observed_at", "observed_version"
    ]));
    assertIntegrity(Array.isArray(record.audit) && record.audit.length >= 1);

    const rebuilt = buildRevenueLeakCaseDetection({
      leak_type: record.leak_type,
      source: {
        system: record.source_system,
        entity_type: record.source_entity_type,
        entity_id: record.source_entity_id,
        observed_at: record.source_observed_at,
        observed_version: record.source_observed_version
      },
      detector: {
        id: record.detector_id,
        version: record.detector_version
      },
      reason_code: record.reason_code,
      evidence_classification: record.evidence_classification,
      evidence: record.evidence_snapshot.facts,
      commercial_value: record.commercial_value,
      recommended_action_type: record.recommended_action_type,
      due_at: record.due_at,
      supersession_condition: record.supersession_condition
    }, {
      id: record.id,
      detectedAt: record.detected_at,
      subjectId: record.audit[0]?.subject_id
    });
    for (const field of [
      "id",
      "leak_type",
      "source_system",
      "source_entity_type",
      "source_entity_id",
      "opportunity_id",
      "source_observed_at",
      "source_observed_version",
      "detector_id",
      "detector_version",
      "reason_code",
      "evidence_classification",
      "evidence_snapshot",
      "evidence_fingerprint",
      "series_key",
      "semantic_key",
      "commercial_value",
      "recommended_action_type",
      "due_at",
      "supersession_condition",
      "detected_at",
      "created_at"
    ]) {
      assertIntegrity(sameJson(record[field], rebuilt[field]));
    }
    assertIntegrity(isCanonicalTimestamp(record.updated_at));
    assertIntegrity(isNullableText(record.supersedes_case_id));
    assertIntegrity(record.supersedes_case_id !== record.id);
    for (const field of [
      "revenue_action_linked_at",
      "snoozed_at",
      "snoozed_until",
      "dismissed_at",
      "superseded_at"
    ]) {
      assertIntegrity(isCanonicalNullableTimestamp(record[field]));
    }
    validateAuditAndLifecycle(record);
    return record;
  } catch (error) {
    if (error?.code === "REVENUE_LEAK_CASE_INTEGRITY_CONFLICT") throw error;
    integrityFailure();
  }
}

function findRevenueActionReference(revenueActions, record) {
  if (!Array.isArray(revenueActions)) return null;
  const matches = revenueActions.filter(action =>
    isPlainObject(action) && action.id === record.revenue_action_id
  );
  if (matches.length !== 1) return null;
  const [action] = matches;
  return (
    action.opportunity_id === record.opportunity_id
    && /^[0-9a-f]{64}$/.test(action.basis_fingerprint || "")
    && REVENUE_ACTION_STATUSES.has(action.status)
  ) ? action : null;
}

function validateCaseCollection(records, tenantId, revenueActions) {
  assertIntegrity(Array.isArray(records));
  const validated = records.map(record => validatePersistedCase(record, tenantId));
  const byId = new Map();
  const activeSeries = new Set();
  const activeSemantic = new Set();
  for (const record of validated) {
    assertIntegrity(!byId.has(record.id));
    byId.set(record.id, record);
    if (ACTIVE_STATES.has(record.state)) {
      assertIntegrity(!activeSeries.has(record.series_key));
      assertIntegrity(!activeSemantic.has(record.semantic_key));
      activeSeries.add(record.series_key);
      activeSemantic.add(record.semantic_key);
    }
  }
  for (const record of validated) {
    if (record.revenue_action_id !== null) {
      const action = findRevenueActionReference(revenueActions, record);
      assertIntegrity(
        action
        && action.basis_fingerprint === record.revenue_action_fingerprint
        && action.status === record.revenue_action_status_at_link
      );
    }
    if (record.supersedes_case_id !== null) {
      const predecessor = byId.get(record.supersedes_case_id);
      assertIntegrity(
        predecessor
        && predecessor.series_key === record.series_key
        && Date.parse(predecessor.detected_at) <= Date.parse(record.detected_at)
      );
      if (predecessor.state === "SUPERSEDED") {
        assertIntegrity(predecessor.superseded_by_case_id === record.id);
      }
    }
    if (record.superseded_by_case_id !== null) {
      const replacement = byId.get(record.superseded_by_case_id);
      assertIntegrity(
        replacement
        && replacement.series_key === record.series_key
        && replacement.supersedes_case_id === record.id
      );
    }
  }
  return validated;
}

function publicRecord(record) {
  if (!record) return null;
  const result = clone(record);
  delete result.tenant_id;
  return deepFreeze(result);
}

function requiredReason(value) {
  if (typeof value !== "string" || value.trim() === "" || Buffer.byteLength(value.trim()) > 1000) {
    fail(
      "REVENUE_LEAK_CASE_TRANSITION_INVALID",
      "A concise human reason is required for this transition."
    );
  }
  return value.trim();
}

const LOCAL_REVENUE_LEAK_TENANT_ID = "00000000-0000-4000-8000-000000000001";

function createJsonRevenueLeakCaseRepository({
  store,
  localTenantId = LOCAL_REVENUE_LEAK_TENANT_ID
} = {}) {
  if (
    !store
    || typeof store.readCollection !== "function"
  ) {
    throw new TypeError("The JSON RevenueLeakCase repository requires an injected store.");
  }
  if (typeof localTenantId !== "string" || localTenantId.trim() === "") {
    throw new TypeError("The JSON RevenueLeakCase repository requires its local tenant ID.");
  }
  const tenantId = localTenantId.trim().toLowerCase();
  const readCases = () => validateCaseCollection(
    store.readCollection("revenue_leak_cases"),
    tenantId,
    store.readCollection("revenue_actions")
  );
  const writeCases = records => {
    if (typeof store.writeCollection !== "function") {
      throw new TypeError("The JSON RevenueLeakCase store is read-only.");
    }
    return store.writeCollection(
      "revenue_leak_cases",
      validateCaseCollection(
        records,
        tenantId,
        store.readCollection("revenue_actions")
      )
    );
  };
  const trusted = context => requireTenantContext(context);
  const isLocal = context => trusted(context).tenantId === tenantId;

  function findIndex(records, context, id) {
    return records.findIndex(record =>
      record.tenant_id === context.tenantId && record.id === id
    );
  }

  return Object.freeze({
    async list(context, { opportunityId, state } = {}) {
      const request = trusted(context);
      if (request.tenantId !== tenantId) return [];
      return readCases()
        .filter(record =>
          record.tenant_id === request.tenantId
          && (opportunityId === undefined || record.opportunity_id === opportunityId)
          && (state === undefined || record.state === state)
        )
        .sort((left, right) =>
          String(right.detected_at).localeCompare(String(left.detected_at))
        )
        .map(publicRecord);
    },

    async findById(context, id) {
      const request = trusted(context);
      if (request.tenantId !== tenantId) return null;
      return publicRecord(readCases().find(record =>
        record.tenant_id === request.tenantId && record.id === id
      ));
    },

    async reconcile(context, detection) {
      const request = trusted(context);
      if (!isLocal(request)) {
        fail(
          "REVENUE_LEAK_SOURCE_UNAVAILABLE",
          "The requested source is unavailable."
        );
      }
      requireCanonicalCommercialValue(detection?.commercial_value);
      const records = readCases();
      const opportunity = store.readCollection("opportunities").find(record =>
        record.id === detection?.opportunity_id
      );
      if (!opportunity) {
        fail(
          "REVENUE_LEAK_SOURCE_UNAVAILABLE",
          "The requested source is unavailable."
        );
      }
      const series = records
        .filter(record =>
          record.tenant_id === request.tenantId
          && record.series_key === detection.series_key
        )
        .sort((left, right) =>
          String(right.detected_at).localeCompare(String(left.detected_at))
        );
      const active = series.filter(record => ACTIVE_STATES.has(record.state));
      if (active.length > 1) {
        fail(
          "REVENUE_LEAK_CASE_INTEGRITY_CONFLICT",
          "Revenue leak case active identity is inconsistent."
        );
      }
      if (active[0]?.semantic_key === detection.semantic_key) {
        return {
          record: publicRecord(active[0]),
          created: false,
          duplicate: true,
          superseded_case_id: null
        };
      }
      if (!active[0] && series[0]?.semantic_key === detection.semantic_key) {
        return {
          record: publicRecord(series[0]),
          created: false,
          duplicate: true,
          terminal: true,
          superseded_case_id: null
        };
      }

      const predecessor = active[0] || series[0] || null;
      const next = {
        ...clone(detection),
        tenant_id: request.tenantId,
        supersedes_case_id: predecessor?.id || null
      };
      let supersededCaseId = null;
      if (active[0]) {
        const index = records.indexOf(active[0]);
        const at = detection.detected_at;
        records[index] = {
          ...active[0],
          state: "SUPERSEDED",
          superseded_by_case_id: detection.id,
          superseded_at: at,
          supersession_reason: "CANONICAL_EVIDENCE_CHANGED",
          updated_at: at,
          audit: [...active[0].audit, {
            transition: "SUPERSEDED",
            at,
            subject_id: request.subjectId,
            reason_code: "CANONICAL_EVIDENCE_CHANGED",
            superseded_by_case_id: detection.id,
            replacement_semantic_key: detection.semantic_key
          }]
        };
        supersededCaseId = active[0].id;
      }
      records.push(next);
      writeCases(records);
      return {
        record: publicRecord(next),
        created: true,
        duplicate: false,
        superseded_case_id: supersededCaseId
      };
    },

    async transition(context, id, transition) {
      const request = trusted(context);
      if (request.tenantId !== tenantId) return null;
      const records = readCases();
      const index = findIndex(records, request, id);
      if (index < 0) return null;
      const current = records[index];
      const to = transition?.to;
      const reason = requiredReason(transition?.reason);
      const at = normalizeTimestamp(transition?.at, "transition.at");
      let updated;

      if (current.state === "OPEN" && to === "SNOOZED") {
        const wakeAt = normalizeTimestamp(transition?.wake_at, "transition.wake_at");
        if (Date.parse(wakeAt) <= Date.parse(at)) {
          fail(
            "REVENUE_LEAK_CASE_TRANSITION_INVALID",
            "A snooze wake time must be after the transition time."
          );
        }
        updated = {
          ...current,
          state: "SNOOZED",
          snoozed_at: at,
          snoozed_until: wakeAt,
          snooze_reason: reason,
          updated_at: at,
          audit: [...current.audit, {
            transition: "SNOOZED",
            at,
            subject_id: request.subjectId,
            reason,
            wake_at: wakeAt
          }]
        };
      } else if (current.state === "SNOOZED" && to === "OPEN") {
        updated = {
          ...current,
          state: "OPEN",
          snoozed_at: null,
          snoozed_until: null,
          snooze_reason: null,
          updated_at: at,
          audit: [...current.audit, {
            transition: "REOPENED",
            at,
            subject_id: request.subjectId,
            reason
          }]
        };
      } else if (["OPEN", "SNOOZED"].includes(current.state) && to === "DISMISSED") {
        updated = {
          ...current,
          state: "DISMISSED",
          dismissed_at: at,
          dismissal_reason: reason,
          updated_at: at,
          audit: [...current.audit, {
            transition: "DISMISSED",
            at,
            subject_id: request.subjectId,
            reason
          }]
        };
      } else {
        fail(
          "REVENUE_LEAK_CASE_TRANSITION_INVALID",
          "The requested revenue leak case transition is invalid.",
          { from: current.state, to }
        );
      }

      records[index] = updated;
      writeCases(records);
      return { record: publicRecord(updated), duplicate: false };
    },

    async linkRevenueAction(context, id, linkage) {
      const request = trusted(context);
      if (request.tenantId !== tenantId) return null;
      const records = readCases();
      const index = findIndex(records, request, id);
      if (index < 0) return null;
      const current = records[index];
      if (!ACTIVE_STATES.has(current.state)) {
        fail(
          "REVENUE_LEAK_CASE_TRANSITION_INVALID",
          "Terminal revenue leak cases cannot be linked to new actions."
        );
      }
      const actionId = typeof linkage?.revenue_action_id === "string"
        ? linkage.revenue_action_id.trim()
        : "";
      if (current.revenue_action_id) {
        if (current.revenue_action_id === actionId) {
          return { record: publicRecord(current), duplicate: true };
        }
        fail(
          "REVENUE_LEAK_CASE_ACTION_LINK_CONFLICT",
          "A revenue leak case cannot be relinked to a different RevenueAction."
        );
      }
      const action = findRevenueActionReference(
        store.readCollection("revenue_actions"),
        {
          revenue_action_id: actionId,
          opportunity_id: current.opportunity_id
        }
      );
      if (!action) {
        fail(
          "REVENUE_ACTION_UNAVAILABLE",
          "The requested RevenueAction is unavailable."
        );
      }
      const at = normalizeTimestamp(linkage?.at, "linkage.at");
      const updated = {
        ...current,
        revenue_action_id: action.id,
        revenue_action_fingerprint: action.basis_fingerprint,
        revenue_action_status_at_link: action.status,
        revenue_action_linked_at: at,
        updated_at: at,
        audit: [...current.audit, {
          transition: "REVENUE_ACTION_LINKED",
          at,
          subject_id: request.subjectId,
          revenue_action_id: action.id,
          revenue_action_fingerprint: action.basis_fingerprint,
          revenue_action_status: action.status
        }]
      };
      records[index] = updated;
      writeCases(records);
      return { record: publicRecord(updated), duplicate: false };
    }
  });
}

module.exports = {
  LOCAL_REVENUE_LEAK_TENANT_ID,
  createJsonRevenueLeakCaseRepository,
  publicRecord
};
