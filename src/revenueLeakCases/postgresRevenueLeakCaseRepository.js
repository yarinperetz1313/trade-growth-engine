"use strict";

const {
  RevenueLeakCaseError,
  canonicalJson,
  deepFreeze,
  normalizeTimestamp
} = require("./revenueLeakCaseDomain");
const {
  canonicalizeDecimalLiteral
} = require("../imports/numericEvidence");

const ACTIVE_STATES = new Set(["OPEN", "SNOOZED"]);

function fail(code, message, details = {}) {
  throw new RevenueLeakCaseError(code, message, details);
}

function cloneJson(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function json(value) {
  return JSON.stringify(canonicalJson(value));
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function revenueLeakCaseFromRow(row) {
  if (!row) return null;
  return deepFreeze({
    id: row.id,
    leak_type: row.leak_type,
    state: row.state,
    source_system: row.source_system,
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
    opportunity_id: row.opportunity_id,
    source_observed_at: toIso(row.source_observed_at),
    source_observed_version: row.source_observed_version,
    detector_id: row.detector_id,
    detector_version: row.detector_version,
    reason_code: row.reason_code,
    evidence_classification: row.evidence_classification,
    evidence_snapshot: cloneJson(row.evidence_snapshot),
    evidence_fingerprint: row.evidence_fingerprint,
    series_key: row.series_key,
    semantic_key: row.semantic_key,
    commercial_value: {
      classification: row.commercial_value_classification,
      amount: row.revenue_at_risk === null
        ? null
        : canonicalizeDecimalLiteral(String(row.revenue_at_risk)),
      currency: row.currency
    },
    recommended_action_type: row.recommended_action_type,
    due_at: toIso(row.due_at),
    supersession_condition: cloneJson(row.supersession_condition),
    supersedes_case_id: row.supersedes_case_id,
    superseded_by_case_id: row.superseded_by_case_id,
    revenue_action_id: row.revenue_action_id,
    revenue_action_fingerprint: row.revenue_action_fingerprint,
    revenue_action_status_at_link: row.revenue_action_status_at_link,
    revenue_action_linked_at: toIso(row.revenue_action_linked_at),
    snoozed_at: toIso(row.snoozed_at),
    snoozed_until: toIso(row.snoozed_until),
    snooze_reason: row.snooze_reason,
    dismissed_at: toIso(row.dismissed_at),
    dismissal_reason: row.dismissal_reason,
    superseded_at: toIso(row.superseded_at),
    supersession_reason: row.supersession_reason,
    detected_at: toIso(row.detected_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    audit: cloneJson(row.audit)
  });
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

function createPostgresRevenueLeakCaseRepository(client, tenantId, subjectId) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("A PostgreSQL client is required for RevenueLeakCase persistence.");
  }

  async function findById(id, { lock = false } = {}) {
    const result = await client.query(
      `select * from tge.revenue_leak_cases
       where tenant_id = $1 and id = $2${lock ? " for update" : ""}`,
      [tenantId, id]
    );
    return result.rows[0] ? revenueLeakCaseFromRow(result.rows[0]) : null;
  }

  async function insertDetection(detection, supersedesCaseId) {
    const firstAudit = {
      ...cloneJson(detection.audit[0]),
      subject_id: subjectId
    };
    const result = await client.query(
      `insert into tge.revenue_leak_cases (
         tenant_id, id, leak_type, state,
         source_system, source_entity_type, source_entity_id, opportunity_id,
         source_observed_at, source_observed_version,
         detector_id, detector_version, reason_code, evidence_classification,
         evidence_snapshot, evidence_fingerprint, series_key, semantic_key,
         commercial_value_classification, revenue_at_risk, currency,
         recommended_action_type, due_at, supersession_condition,
         supersedes_case_id, superseded_by_case_id,
         revenue_action_id, revenue_action_fingerprint,
         revenue_action_status_at_link, revenue_action_linked_at,
         snoozed_at, snoozed_until, snooze_reason,
         dismissed_at, dismissal_reason,
         superseded_at, supersession_reason,
         detected_at, updated_at, created_at, audit
       ) values (
         $1, $2, $3, 'OPEN',
         $4, $5, $6, $7,
         $8, $9,
         $10, $11, $12, $13,
         $14::jsonb, $15, $16, $17,
         $18, $19::numeric, $20,
         $21, $22, $23::jsonb,
         $24, null,
         null, null, null, null,
         null, null, null,
         null, null,
         null, null,
         $25, $25, $25, $26::jsonb
       )
       returning *`,
      [
        tenantId,
        detection.id,
        detection.leak_type,
        detection.source_system,
        detection.source_entity_type,
        detection.source_entity_id,
        detection.opportunity_id,
        detection.source_observed_at,
        detection.source_observed_version,
        detection.detector_id,
        detection.detector_version,
        detection.reason_code,
        detection.evidence_classification,
        json(detection.evidence_snapshot),
        detection.evidence_fingerprint,
        detection.series_key,
        detection.semantic_key,
        detection.commercial_value.classification,
        detection.commercial_value.amount,
        detection.commercial_value.currency,
        detection.recommended_action_type,
        detection.due_at,
        json(detection.supersession_condition),
        supersedesCaseId,
        detection.detected_at,
        json([firstAudit])
      ]
    );
    return revenueLeakCaseFromRow(result.rows[0]);
  }

  async function reconcile(detection) {
    const opportunity = await client.query(
      `select id from tge.opportunities
       where tenant_id = $1 and id = $2
       for update`,
      [tenantId, detection?.opportunity_id]
    );
    if (opportunity.rows.length !== 1) {
      fail(
        "REVENUE_LEAK_SOURCE_UNAVAILABLE",
        "The requested source is unavailable."
      );
    }
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      [`${tenantId}:${detection.series_key}`]
    );
    const existing = await client.query(
      `select * from tge.revenue_leak_cases
       where tenant_id = $1 and series_key = $2
       order by detected_at desc, id
       for update`,
      [tenantId, detection.series_key]
    );
    const series = existing.rows.map(revenueLeakCaseFromRow);
    const active = series.filter(record => ACTIVE_STATES.has(record.state));
    if (active.length > 1) {
      fail(
        "REVENUE_LEAK_CASE_INTEGRITY_CONFLICT",
        "Revenue leak case active identity is inconsistent."
      );
    }
    if (active[0]?.semantic_key === detection.semantic_key) {
      return {
        record: active[0],
        created: false,
        duplicate: true,
        superseded_case_id: null
      };
    }
    if (!active[0] && series[0]?.semantic_key === detection.semantic_key) {
      return {
        record: series[0],
        created: false,
        duplicate: true,
        terminal: true,
        superseded_case_id: null
      };
    }

    const predecessor = active[0] || series[0] || null;
    if (active[0]) {
      const at = detection.detected_at;
      const audit = [...active[0].audit, {
        transition: "SUPERSEDED",
        at,
        subject_id: subjectId,
        reason_code: "CANONICAL_EVIDENCE_CHANGED",
        superseded_by_case_id: detection.id,
        replacement_semantic_key: detection.semantic_key
      }];
      await client.query(
        `update tge.revenue_leak_cases
         set state = 'SUPERSEDED',
           superseded_by_case_id = $3,
           superseded_at = $4,
           supersession_reason = 'CANONICAL_EVIDENCE_CHANGED',
           updated_at = $4,
           audit = $5::jsonb
         where tenant_id = $1 and id = $2`,
        [tenantId, active[0].id, detection.id, at, json(audit)]
      );
    }
    const record = await insertDetection(detection, predecessor?.id || null);
    return {
      record,
      created: true,
      duplicate: false,
      superseded_case_id: active[0]?.id || null
    };
  }

  async function transition(id, request) {
    const current = await findById(id, { lock: true });
    if (!current) return null;
    const reason = requiredReason(request?.reason);
    const at = normalizeTimestamp(request?.at, "transition.at");
    let changes;
    let entry;

    if (current.state === "OPEN" && request?.to === "SNOOZED") {
      const wakeAt = normalizeTimestamp(request?.wake_at, "transition.wake_at");
      if (Date.parse(wakeAt) <= Date.parse(at)) {
        fail(
          "REVENUE_LEAK_CASE_TRANSITION_INVALID",
          "A snooze wake time must be after the transition time."
        );
      }
      changes = {
        state: "SNOOZED",
        snoozed_at: at,
        snoozed_until: wakeAt,
        snooze_reason: reason
      };
      entry = {
        transition: "SNOOZED",
        at,
        subject_id: subjectId,
        reason,
        wake_at: wakeAt
      };
    } else if (current.state === "SNOOZED" && request?.to === "OPEN") {
      changes = {
        state: "OPEN",
        snoozed_at: null,
        snoozed_until: null,
        snooze_reason: null
      };
      entry = {
        transition: "REOPENED",
        at,
        subject_id: subjectId,
        reason
      };
    } else if (ACTIVE_STATES.has(current.state) && request?.to === "DISMISSED") {
      changes = {
        state: "DISMISSED",
        dismissed_at: at,
        dismissal_reason: reason
      };
      entry = {
        transition: "DISMISSED",
        at,
        subject_id: subjectId,
        reason
      };
    } else {
      fail(
        "REVENUE_LEAK_CASE_TRANSITION_INVALID",
        "The requested revenue leak case transition is invalid.",
        { from: current.state, to: request?.to }
      );
    }

    const columns = Object.keys(changes);
    const values = [tenantId, id, ...Object.values(changes), at, json([
      ...current.audit,
      entry
    ])];
    const assignments = columns.map((column, index) =>
      `${column} = $${index + 3}`
    );
    const result = await client.query(
      `update tge.revenue_leak_cases
       set ${assignments.join(", ")},
         updated_at = $${columns.length + 3},
         audit = $${columns.length + 4}::jsonb
       where tenant_id = $1 and id = $2
       returning *`,
      values
    );
    return {
      record: revenueLeakCaseFromRow(result.rows[0]),
      duplicate: false
    };
  }

  async function linkRevenueAction(id, linkage) {
    const current = await findById(id, { lock: true });
    if (!current) return null;
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
        return { record: current, duplicate: true };
      }
      fail(
        "REVENUE_LEAK_CASE_ACTION_LINK_CONFLICT",
        "A revenue leak case cannot be relinked to a different RevenueAction."
      );
    }
    const actionResult = await client.query(
      `select id, opportunity_id, basis_fingerprint, status
       from tge.revenue_actions
       where tenant_id = $1 and id = $2 and opportunity_id = $3
       for update`,
      [tenantId, actionId, current.opportunity_id]
    );
    if (actionResult.rows.length !== 1) {
      fail(
        "REVENUE_ACTION_UNAVAILABLE",
        "The requested RevenueAction is unavailable."
      );
    }
    const action = actionResult.rows[0];
    const at = normalizeTimestamp(linkage?.at, "linkage.at");
    const audit = [...current.audit, {
      transition: "REVENUE_ACTION_LINKED",
      at,
      subject_id: subjectId,
      revenue_action_id: action.id,
      revenue_action_fingerprint: action.basis_fingerprint,
      revenue_action_status: action.status
    }];
    const updated = await client.query(
      `update tge.revenue_leak_cases
       set revenue_action_id = $3,
         revenue_action_fingerprint = $4,
         revenue_action_status_at_link = $5,
         revenue_action_linked_at = $6,
         updated_at = $6,
         audit = $7::jsonb
       where tenant_id = $1 and id = $2
       returning *`,
      [
        tenantId,
        id,
        action.id,
        action.basis_fingerprint,
        action.status,
        at,
        json(audit)
      ]
    );
    return {
      record: revenueLeakCaseFromRow(updated.rows[0]),
      duplicate: false
    };
  }

  return Object.freeze({
    async list({ opportunityId, state } = {}) {
      const values = [tenantId];
      const predicates = ["tenant_id = $1"];
      if (opportunityId !== undefined) {
        values.push(opportunityId);
        predicates.push(`opportunity_id = $${values.length}`);
      }
      if (state !== undefined) {
        values.push(state);
        predicates.push(`state = $${values.length}`);
      }
      const result = await client.query(
        `select * from tge.revenue_leak_cases
         where ${predicates.join(" and ")}
         order by detected_at desc, id`,
        values
      );
      return result.rows.map(revenueLeakCaseFromRow);
    },
    findById,
    reconcile,
    transition,
    linkRevenueAction
  });
}

module.exports = {
  createPostgresRevenueLeakCaseRepository,
  revenueLeakCaseFromRow
};
