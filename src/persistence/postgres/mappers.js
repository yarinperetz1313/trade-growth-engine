const JSON_COLUMNS = new Set([
  "evidence",
  "metadata",
  "legacy_payload",
  "current_payload",
  "commercial_value_raw",
  "recommendation_snapshot",
  "proposed_execution",
  "execution_request",
  "execution_result",
  "audit"
]);

const SYSTEM_FIELDS = new Set([
  "tenant_id",
  "tenantId",
  "legacy_payload",
  "current_payload",
  "source_ordinal",
  "source_created_at",
  "source_updated_at",
  "commercial_value",
  "commercial_value_state",
  "commercial_value_raw",
  "revenue_action_id"
]);
const JSON_NULL = Symbol("postgres-json-null");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function rejectCallerTenant(record) {
  if (
    record &&
    (Object.hasOwn(record, "tenant_id") || Object.hasOwn(record, "tenantId"))
  ) {
    const error = new Error("Tenant fields are forbidden on persistence records.");
    error.code = "TENANT_FIELD_FORBIDDEN";
    throw error;
  }
}

function classifyCommercialValue(opportunity) {
  if (!Object.hasOwn(opportunity, "value")) {
    return { numeric: null, state: "MISSING", raw: undefined };
  }

  const raw = opportunity.value;
  if (raw === null) return { numeric: null, state: "NULL", raw: null };

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) {
      const error = new TypeError("Commercial value must be a finite non-negative number.");
      error.code = "COMMERCIAL_VALUE_INVALID";
      throw error;
    }
    return {
      numeric: raw,
      state: raw === 0 ? "ZERO" : "KNOWN",
      raw
    };
  }

  if (typeof raw !== "string") {
    const error = new TypeError("Commercial value must be a number, string, null, or absent.");
    error.code = "COMMERCIAL_VALUE_INVALID";
    throw error;
  }

  if (raw.trim() === "") return { numeric: null, state: "BLANK", raw };
  if (raw.trim().toLowerCase() === "unknown") {
    return { numeric: null, state: "UNKNOWN_LITERAL", raw };
  }
  return { numeric: null, state: "NON_NUMERIC", raw };
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) ? String(value) : timestamp.toISOString();
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactLegacyPayload(record) {
  const payload = clone(record) || {};
  for (const field of SYSTEM_FIELDS) delete payload[field];
  return payload;
}

function commonInsertFields(record, { sourceOrdinal } = {}) {
  const payload = compactLegacyPayload(record);
  return {
    legacy_payload: clone(payload),
    current_payload: clone(payload),
    source_ordinal: sourceOrdinal ?? null,
    source_created_at: record.created_at ?? null,
    source_updated_at: record.updated_at ?? null,
    created_at: record.created_at,
    updated_at: record.updated_at
  };
}

function prospectToRow(record, options) {
  rejectCallerTenant(record);
  return cleanUndefined({
    id: record.id,
    business_name: record.business_name,
    website: record.website ?? null,
    email: record.email ?? null,
    phone: record.phone ?? null,
    service: record.service ?? null,
    location: record.location ?? null,
    source: record.source ?? null,
    source_url: record.source_url ?? null,
    dedupe_key: record.dedupe_key ?? null,
    qualification_score: record.qualification_score ?? null,
    qualification_status: record.qualification_status ?? null,
    evidence: record.evidence ?? [],
    metadata: record.metadata ?? {},
    ...commonInsertFields(record, options)
  });
}

function opportunityToRow(record, options) {
  rejectCallerTenant(record);
  const value = classifyCommercialValue(record);
  return cleanUndefined({
    id: record.id,
    prospect_id: record.prospect_id ?? null,
    business_name: record.business_name,
    stage: record.stage,
    priority: record.priority ?? null,
    qualification_score: record.qualification_score ?? null,
    commercial_value: value.numeric,
    commercial_value_state: value.state,
    commercial_value_raw: value.state === "MISSING"
      ? null
      : value.state === "NULL"
        ? JSON_NULL
        : value.raw,
    probability: record.probability ?? null,
    weighted_value: record.weighted_value ?? null,
    next_action: record.next_action ?? null,
    contact_name: record.contact_name ?? null,
    metadata: record.metadata ?? {},
    ...commonInsertFields(record, options)
  });
}

function taskToRow(record, options) {
  rejectCallerTenant(record);
  return cleanUndefined({
    id: record.id,
    opportunity_id: record.opportunity_id,
    revenue_action_id: record.metadata?.revenue_action_id ?? null,
    title: record.title,
    description: record.description ?? null,
    due_at: record.due_at ?? null,
    priority: record.priority ?? null,
    status: record.status,
    completed_at: record.completed_at ?? null,
    metadata: record.metadata ?? {},
    ...commonInsertFields(record, options)
  });
}

function activityToRow(record, options) {
  rejectCallerTenant(record);
  return cleanUndefined({
    id: record.id,
    opportunity_id: record.opportunity_id,
    prospect_id: record.prospect_id ?? null,
    revenue_action_id: record.metadata?.revenue_action_id ?? null,
    type: record.type,
    description: record.description ?? null,
    metadata: record.metadata ?? {},
    ...commonInsertFields(record, options)
  });
}

function revenueActionToRow(record, options) {
  rejectCallerTenant(record);
  return cleanUndefined({
    id: record.id,
    opportunity_id: record.opportunity_id,
    action_type: record.action_type,
    execution_type: record.execution_type,
    approval_requirement: record.approval_requirement,
    risk_class: record.risk_class,
    status: record.status,
    priority: record.priority ?? null,
    title: record.title,
    reason: record.reason,
    evidence: record.evidence,
    recommendation_snapshot: record.recommendation_snapshot,
    basis_fingerprint: record.basis_fingerprint,
    proposed_execution: record.proposed_execution ?? null,
    execution_request: record.execution_request ?? null,
    execution_result: record.execution_result ?? null,
    source: record.source,
    audit: record.audit ?? [],
    execution_attempts: record.execution_attempts ?? 0,
    prepared_at: record.prepared_at ?? null,
    approved_at: record.approved_at ?? null,
    executed_at: record.executed_at ?? null,
    rejected_at: record.rejected_at ?? null,
    cancelled_at: record.cancelled_at ?? null,
    failed_at: record.failed_at ?? null,
    rejection_reason: record.rejection_reason ?? null,
    resulting_task_id: record.resulting_task_id ?? null,
    resulting_activity_id: record.resulting_activity_id ?? null,
    ...commonInsertFields(record, options)
  });
}

function baseRecord(row) {
  const payload = row.current_payload ?? row.legacy_payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? clone(payload)
    : {};
}

function required(target, key, value) {
  target[key] = value;
}

function optional(target, key, value) {
  if (value !== null && value !== undefined) {
    target[key] = value;
  } else if (Object.hasOwn(target, key)) {
    target[key] = null;
  }
}

function optionalJson(target, key, value, emptyValue) {
  if (Object.hasOwn(target, key) && target[key] === null) {
    return;
  }
  const hasContent = Array.isArray(value)
    ? value.length > 0
    : Boolean(value && Object.keys(value).length > 0);
  if (Object.hasOwn(target, key) || hasContent) {
    target[key] = clone(value ?? emptyValue);
  }
}

function applyTimestamps(target, row) {
  target.created_at = toIso(row.created_at ?? row.source_created_at);
  target.updated_at = toIso(row.updated_at ?? row.source_updated_at);
}

function prospectFromRow(row) {
  const record = baseRecord(row);
  required(record, "id", row.id);
  required(record, "business_name", row.business_name);
  for (const key of [
    "website",
    "email",
    "phone",
    "service",
    "location",
    "source",
    "source_url",
    "dedupe_key",
    "qualification_status"
  ]) optional(record, key, row[key]);
  optional(record, "qualification_score", toNumber(row.qualification_score));
  optionalJson(record, "evidence", row.evidence, []);
  optionalJson(record, "metadata", row.metadata, {});
  applyTimestamps(record, row);
  return record;
}

function opportunityFromRow(row) {
  const record = baseRecord(row);
  required(record, "id", row.id);
  required(record, "business_name", row.business_name);
  required(record, "stage", row.stage);
  optional(record, "prospect_id", row.prospect_id);
  optional(record, "priority", row.priority);
  optional(record, "qualification_score", toNumber(row.qualification_score));
  optional(record, "probability", toNumber(row.probability));
  optional(record, "weighted_value", toNumber(row.weighted_value));
  optional(record, "next_action", row.next_action);
  optional(record, "contact_name", row.contact_name);
  optionalJson(record, "metadata", row.metadata, {});

  if (row.commercial_value_state === "MISSING") {
    delete record.value;
  } else if (["KNOWN", "ZERO"].includes(row.commercial_value_state)) {
    record.value = toNumber(row.commercial_value);
  } else {
    record.value = clone(row.commercial_value_raw);
  }

  applyTimestamps(record, row);
  return record;
}

function taskFromRow(row) {
  const record = baseRecord(row);
  required(record, "id", row.id);
  required(record, "opportunity_id", row.opportunity_id);
  required(record, "title", row.title);
  required(record, "status", row.status);
  optional(record, "description", row.description);
  optional(record, "due_at", toIso(row.due_at));
  optional(record, "priority", row.priority);
  optional(record, "completed_at", toIso(row.completed_at));
  optionalJson(record, "metadata", row.metadata, {});
  if (row.revenue_action_id) {
    record.metadata = {
      ...(record.metadata || {}),
      revenue_action_id: row.revenue_action_id
    };
  }
  applyTimestamps(record, row);
  return record;
}

function activityFromRow(row) {
  const record = baseRecord(row);
  required(record, "id", row.id);
  required(record, "opportunity_id", row.opportunity_id);
  required(record, "type", row.type);
  optional(record, "prospect_id", row.prospect_id);
  optional(record, "description", row.description);
  optionalJson(record, "metadata", row.metadata, {});
  if (row.revenue_action_id) {
    record.metadata = {
      ...(record.metadata || {}),
      revenue_action_id: row.revenue_action_id
    };
  }
  applyTimestamps(record, row);
  return record;
}

function revenueActionFromRow(row) {
  const record = baseRecord(row);
  for (const key of [
    "id",
    "opportunity_id",
    "action_type",
    "execution_type",
    "approval_requirement",
    "risk_class",
    "status",
    "title",
    "reason",
    "basis_fingerprint",
    "source"
  ]) required(record, key, row[key]);
  optional(record, "priority", row.priority);
  record.evidence = clone(row.evidence);
  record.recommendation_snapshot = clone(row.recommendation_snapshot);
  for (const key of [
    "proposed_execution",
    "execution_request",
    "execution_result"
  ]) optional(record, key, clone(row[key]));
  record.audit = clone(row.audit || []);
  if (Object.hasOwn(record, "execution_attempts") || row.execution_attempts > 0) {
    record.execution_attempts = row.execution_attempts;
  }
  for (const key of [
    "prepared_at",
    "approved_at",
    "executed_at",
    "rejected_at",
    "cancelled_at",
    "failed_at"
  ]) optional(record, key, toIso(row[key]));
  optional(record, "rejection_reason", row.rejection_reason);
  optional(record, "resulting_task_id", row.resulting_task_id);
  optional(record, "resulting_activity_id", row.resulting_activity_id);
  applyTimestamps(record, row);
  return record;
}

function cleanUndefined(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

function encodeColumnValue(column, value) {
  if (value === JSON_NULL) return "null";
  if (!JSON_COLUMNS.has(column) || value === null) return value;
  return JSON.stringify(value);
}

module.exports = {
  JSON_COLUMNS,
  activityFromRow,
  activityToRow,
  classifyCommercialValue,
  encodeColumnValue,
  opportunityFromRow,
  opportunityToRow,
  prospectFromRow,
  prospectToRow,
  rejectCallerTenant,
  revenueActionFromRow,
  revenueActionToRow,
  taskFromRow,
  taskToRow
};
