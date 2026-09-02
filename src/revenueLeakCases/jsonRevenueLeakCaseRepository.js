"use strict";

const {
  RevenueLeakCaseError,
  deepFreeze,
  normalizeTimestamp
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

function fail(code, message, details = {}) {
  throw new RevenueLeakCaseError(code, message, details);
}

function clone(value) {
  return structuredClone(value);
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
  const readCases = () => store.readCollection("revenue_leak_cases");
  const writeCases = records => {
    if (typeof store.writeCollection !== "function") {
      throw new TypeError("The JSON RevenueLeakCase store is read-only.");
    }
    return store.writeCollection("revenue_leak_cases", records);
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
      const opportunity = store.readCollection("opportunities").find(record =>
        record.id === detection?.opportunity_id
      );
      if (!opportunity) {
        fail(
          "REVENUE_LEAK_SOURCE_UNAVAILABLE",
          "The requested source is unavailable."
        );
      }

      const records = readCases();
      const series = records
        .filter(record =>
          record.tenant_id === request.tenantId
          && record.series_key === detection.series_key
        )
        .sort((left, right) =>
          String(right.detected_at).localeCompare(String(left.detected_at))
        );
      const active = series.filter(record => ["OPEN", "SNOOZED"].includes(record.state));
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
      if (!["OPEN", "SNOOZED"].includes(current.state)) {
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
      const action = store.readCollection("revenue_actions").find(record =>
        record.id === actionId && record.opportunity_id === current.opportunity_id
      );
      if (
        !action
        || !/^[0-9a-f]{64}$/.test(action.basis_fingerprint || "")
        || !REVENUE_ACTION_STATUSES.has(action.status)
      ) {
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
