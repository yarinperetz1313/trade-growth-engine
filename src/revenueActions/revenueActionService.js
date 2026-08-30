const crypto = require("crypto");

const {
  buildDealIntelligenceFromData,
  getOpportunityIntelligence
} = require("../intelligence/dealIntelligence");
const {
  getRevenueIntelligenceSnapshot
} = require("../intelligence/revenueIntelligenceSnapshot");
const {
  getPipelineMetrics
} = require("../opportunities/opportunityEngine");
const {
  readCollectionReadOnly
} = require("../services/localStore");
const repository = require("./revenueActionRepository");

const ACTIVE_STATUSES = new Set([
  "RECOMMENDED",
  "PREPARED",
  "APPROVED",
  "EXECUTING",
  "FAILED"
]);

const EXECUTION_TYPES = {
  FOLLOW_UP: "COMMUNICATION_DRAFT",
  CREATE_TASK: "INTERNAL_TASK",
  RESEARCH: "INTERNAL_TASK",
  QUALIFY: "INTERNAL_TASK",
  ADVANCE: "INTERNAL_TASK"
};

function now() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }

  return value;
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function failure(error, message, statusCode, details = {}) {
  return {
    ok: false,
    error,
    message,
    statusCode,
    details
  };
}

function appendAudit(action, transition, at, metadata = {}) {
  return [
    ...(action.audit || []),
    {
      transition,
      at,
      ...metadata
    }
  ];
}

function factualEvidence(state) {
  const opportunity = state.opportunity;
  const intelligence = state.intelligence;
  const resolved = intelligence.resolved || {};
  const value = Number(opportunity.value);
  const valueKnown = Number.isFinite(value) && value > 0;

  return {
    factual: {
      stage: opportunity.stage || null,
      recorded_next_action: normalizeText(opportunity.next_action) || null,
      commercial_value: {
        known: valueKnown,
        amount: valueKnown ? value : null
      },
      business_name: resolved.business_name || null,
      contact_name: resolved.contact_name || null,
      service: resolved.service || null,
      location: resolved.location || null,
      latest_activity: intelligence.activity?.latest
        ? {
            id: intelligence.activity.latest.id || null,
            type: intelligence.activity.latest.type || null,
            created_at: intelligence.activity.latest.created_at || null
          }
        : null,
      tasks: {
        count: intelligence.tasks?.count || 0,
        open_count: intelligence.tasks?.open || 0,
        latest: intelligence.tasks?.latest
          ? {
              id: intelligence.tasks.latest.id || null,
              title: intelligence.tasks.latest.title || null,
              status: intelligence.tasks.latest.status || null,
              created_at: intelligence.tasks.latest.created_at || null
            }
          : null
      }
    },
    derived: {
      health_status: intelligence.health?.status || null,
      risk_types: (intelligence.health?.risks || [])
        .map(risk => risk.type)
        .filter(Boolean),
      stale_risk: intelligence.score?.stale_risk ?? null,
      days_since_latest_activity:
        intelligence.activity?.days_since_latest ?? null,
      known: clone(intelligence.evidence?.known || []),
      unknown: clone(intelligence.evidence?.unknown || [])
    }
  };
}

function recommendationBasis(state, recommendation, evidence) {
  return {
    opportunity_id: state.opportunity.id,
    action_type: recommendation?.type || null,
    priority: recommendation?.priority || null,
    title: recommendation?.title || null,
    reason: recommendation?.reason || null,
    task_title: recommendation?.taskTitle || null,
    stage: evidence.factual.stage,
    recorded_next_action: evidence.factual.recorded_next_action,
    commercial_value: evidence.factual.commercial_value,
    business_name: evidence.factual.business_name,
    contact_name: evidence.factual.contact_name,
    service: evidence.factual.service,
    location: evidence.factual.location,
    latest_activity: evidence.factual.latest_activity
  };
}

function buildRefresh(opportunityId) {
  const state = getOpportunityIntelligence(opportunityId);

  return {
    opportunity: state.opportunity,
    opportunity_intelligence: state.intelligence,
    pipeline_metrics: getPipelineMetrics(),
    revenue_intelligence: getRevenueIntelligenceSnapshot()
  };
}

function success(action, extras = {}) {
  return {
    ok: true,
    data: action,
    refreshed: buildRefresh(action.opportunity_id),
    ...extras
  };
}

function getOpportunityStateWithoutRevenueActionEffects(
  opportunityId,
  revenueActionId
) {
  const opportunities = readCollectionReadOnly("opportunities");
  const opportunity = opportunities.find(item => item.id === opportunityId);
  if (!opportunity) return { error: "OPPORTUNITY_NOT_FOUND" };

  const activities = readCollectionReadOnly("activities").filter(
    activity => activity.metadata?.revenue_action_id !== revenueActionId
  );
  const tasks = readCollectionReadOnly("tasks").filter(
    task => task.metadata?.revenue_action_id !== revenueActionId
  );

  return {
    opportunity,
    intelligence: buildDealIntelligenceFromData(opportunity, {
      prospects: readCollectionReadOnly("prospects"),
      activities,
      tasks
    })
  };
}

function currentRecommendationFingerprint(
  opportunityId,
  { excludeRevenueActionId = null } = {}
) {
  const state = excludeRevenueActionId
    ? getOpportunityStateWithoutRevenueActionEffects(
        opportunityId,
        excludeRevenueActionId
      )
    : getOpportunityIntelligence(opportunityId);
  if (state.error) return { state, fingerprint: null };
  const evidence = factualEvidence(state);
  return {
    state,
    fingerprint: fingerprint(recommendationBasis(
      state,
      state.intelligence.next_best_action,
      evidence
    ))
  };
}

function supersedeForClosedOpportunity(action, stage, operation, at = now()) {
  const updated = {
    ...action,
    status: "CANCELLED",
    cancelled_at: at,
    updated_at: at,
    audit: appendAudit(action, "SUPERSEDED_OPPORTUNITY_CLOSED", at, {
      stage,
      operation
    })
  };
  repository.replaceRevenueAction(updated);
  return failure(
    "REVENUE_ACTION_OPPORTUNITY_CLOSED",
    "The opportunity is closed; this revenue action was superseded.",
    409,
    { opportunityId: action.opportunity_id, stage, id: action.id }
  );
}

function supersedeAsStale(action, currentFingerprint, at = now()) {
  const updated = {
    ...action,
    status: "CANCELLED",
    cancelled_at: at,
    updated_at: at,
    audit: appendAudit(action, "SUPERSEDED_AS_STALE", at, {
      expected_fingerprint: action.basis_fingerprint,
      current_fingerprint: currentFingerprint
    })
  };
  repository.replaceRevenueAction(updated);
  return failure(
    "REVENUE_ACTION_STALE",
    "The opportunity evidence changed; this action was superseded. Create a fresh action.",
    409,
    { id: action.id, expectedFingerprint: action.basis_fingerprint, currentFingerprint }
  );
}

function supersedeIncompatibleActiveActions(
  opportunityId,
  actionType,
  basisFingerprint
) {
  const incompatible = repository.listRevenueActions({ opportunityId }).filter(
    action =>
      ACTIVE_STATUSES.has(action.status) &&
      !(
        action.action_type === actionType &&
        action.basis_fingerprint === basisFingerprint
      )
  );

  const recoveryRequired = incompatible.find(
    action =>
      ["EXECUTING", "FAILED"].includes(action.status) &&
      (
        repository.listTasksForRevenueAction(action.id).length > 0 ||
        repository.listActivitiesForRevenueAction(action.id).length > 0
      )
  );

  if (recoveryRequired) {
    return failure(
      "REVENUE_ACTION_RECOVERY_REQUIRED",
      "An interrupted revenue action has linked CRM effects and must be recovered before current advice can be materialized.",
      409,
      { id: recoveryRequired.id, opportunityId }
    );
  }

  if (incompatible.length === 0) return null;

  const timestamp = now();
  repository.replaceRevenueActions(
    incompatible.map(action => ({
      ...action,
      status: "CANCELLED",
      cancelled_at: timestamp,
      updated_at: timestamp,
      audit: appendAudit(
        action,
        "SUPERSEDED_BY_CURRENT_RECOMMENDATION",
        timestamp,
        {
          replacement_action_type: actionType,
          replacement_fingerprint: basisFingerprint
        }
      )
    }))
  );

  return null;
}

function materializeRevenueAction(opportunityId) {
  const state = getOpportunityIntelligence(opportunityId);

  if (state.error) {
    return failure(
      state.error,
      "Opportunity was not found.",
      404,
      { opportunityId }
    );
  }

  if (["WON", "LOST"].includes(state.opportunity.stage)) {
    return failure(
      "REVENUE_ACTION_OPPORTUNITY_CLOSED",
      "Closed opportunities cannot enter an active execution lifecycle.",
      409,
      { opportunityId, stage: state.opportunity.stage }
    );
  }

  const recommendation = state.intelligence.next_best_action;
  const actionType = recommendation?.type;
  const executionType = EXECUTION_TYPES[actionType];

  if (!executionType) {
    return failure(
      "RECOMMENDATION_NOT_EXECUTABLE",
      "The current recommendation does not have a Phase 2 execution adapter.",
      422,
      { actionType: actionType || null }
    );
  }

  const evidence = factualEvidence(state);
  const basisFingerprint = fingerprint(
    recommendationBasis(state, recommendation, evidence)
  );
  const supersedeFailure = supersedeIncompatibleActiveActions(
    opportunityId,
    actionType,
    basisFingerprint
  );
  if (supersedeFailure) return supersedeFailure;

  const duplicate = repository.listRevenueActions({ opportunityId }).find(
    action =>
      action.action_type === actionType &&
      action.basis_fingerprint === basisFingerprint &&
      ACTIVE_STATUSES.has(action.status)
  );

  if (duplicate) {
    return success(duplicate, { duplicate: true, created: false });
  }

  const timestamp = now();
  const snapshot = {
    action_type: actionType,
    title: recommendation.title,
    reason: recommendation.reason,
    priority: recommendation.priority,
    task_title: recommendation.taskTitle || null,
    evidence: clone(evidence),
    generated_at: state.intelligence.generated_at
  };
  const action = {
    id: crypto.randomUUID(),
    opportunity_id: opportunityId,
    action_type: actionType,
    execution_type: executionType,
    approval_requirement: "HUMAN",
    risk_class:
      executionType === "COMMUNICATION_DRAFT"
        ? "EXTERNAL_CONSEQUENTIAL"
        : "INTERNAL",
    status: "RECOMMENDED",
    priority: recommendation.priority,
    title: recommendation.title,
    reason: recommendation.reason,
    evidence,
    recommendation_snapshot: snapshot,
    basis_fingerprint: basisFingerprint,
    proposed_execution: null,
    execution_result: null,
    source: "DEAL_INTELLIGENCE",
    created_at: timestamp,
    updated_at: timestamp,
    prepared_at: null,
    approved_at: null,
    rejected_at: null,
    cancelled_at: null,
    executed_at: null,
    failed_at: null,
    rejection_reason: null,
    resulting_task_id: null,
    resulting_activity_id: null,
    audit: [
      {
        transition: "CREATED_AS_RECOMMENDED",
        at: timestamp,
        source: "DEAL_INTELLIGENCE"
      }
    ]
  };

  repository.insertRevenueAction(action);
  return success(action, { duplicate: false, created: true });
}

function getRevenueAction(id) {
  const action = repository.findRevenueAction(id);
  return action || failure(
    "REVENUE_ACTION_NOT_FOUND",
    "Revenue action was not found.",
    404,
    { id }
  );
}

function prepareCommunication(action) {
  const facts = action.evidence.factual;
  const business = facts.business_name;
  const contact = facts.contact_name;
  const service = facts.service;
  const stage = facts.stage;
  const subject = stage === "PROPOSAL"
    ? `Following up${business ? ` on the ${business} proposal` : " on the proposal"}`
    : `Following up${business ? ` on ${business}` : " on the opportunity"}`;
  const greeting = contact ? `Hi ${contact},` : "Hello,";
  const context = service
    ? `the ${service} opportunity${business ? ` for ${business}` : ""}`
    : `the opportunity${business ? ` for ${business}` : ""}`;

  return {
    type: "COMMUNICATION_DRAFT",
    channel: "EMAIL",
    subject,
    body: [
      greeting,
      "",
      `I’m following up regarding ${context}.`,
      "Please let me know if you have any questions or if anything is needed to progress the next step.",
      "",
      "Kind regards"
    ].join("\n"),
    external_send_performed: false
  };
}

function prepareInternalTask(action) {
  const title =
    action.recommendation_snapshot.task_title ||
    action.recommendation_snapshot.title;
  const normalizedTitle = normalizeText(title).toLowerCase();
  return {
    type: "INTERNAL_TASK",
    title,
    normalized_title: normalizedTitle,
    semantic_task_key: [
      action.opportunity_id,
      action.action_type,
      normalizedTitle
    ].join(":"),
    description: action.recommendation_snapshot.reason || "",
    priority: action.priority || "MEDIUM",
    due_at: null
  };
}

function validateCurrentRevenueAction(action, operation) {
  const current = currentRecommendationFingerprint(action.opportunity_id);
  if (current.state.error) {
    return failure(
      "OPPORTUNITY_NOT_FOUND",
      `The opportunity no longer exists; ${operation.toLowerCase()} was not attempted.`,
      404,
      { opportunityId: action.opportunity_id }
    );
  }
  if (["WON", "LOST"].includes(current.state.opportunity.stage)) {
    return supersedeForClosedOpportunity(
      action,
      current.state.opportunity.stage,
      operation
    );
  }
  if (current.fingerprint !== action.basis_fingerprint) {
    return supersedeAsStale(action, current.fingerprint);
  }
  return null;
}

function prepareRevenueAction(id) {
  const action = repository.findRevenueAction(id);
  if (!action) return failure("REVENUE_ACTION_NOT_FOUND", "Revenue action was not found.", 404, { id });

  if (action.status === "PREPARED") {
    const validationFailure = validateCurrentRevenueAction(action, "PREPARE");
    if (validationFailure) return validationFailure;
    return success(action, { duplicate: true });
  }
  if (action.status !== "RECOMMENDED") {
    return failure("INVALID_REVENUE_ACTION_TRANSITION", `Cannot prepare a revenue action from ${action.status}.`, 409, { from: action.status, to: "PREPARED" });
  }

  const validationFailure = validateCurrentRevenueAction(action, "PREPARE");
  if (validationFailure) return validationFailure;

  const timestamp = now();
  const updated = {
    ...action,
    status: "PREPARED",
    proposed_execution: action.execution_type === "COMMUNICATION_DRAFT" ? prepareCommunication(action) : prepareInternalTask(action),
    prepared_at: timestamp,
    updated_at: timestamp,
    audit: appendAudit(action, "PREPARED", timestamp)
  };
  repository.replaceRevenueAction(updated);
  return success(updated, { duplicate: false });
}

function approveRevenueAction(id) {
  const action = repository.findRevenueAction(id);

  if (!action) {
    return failure("REVENUE_ACTION_NOT_FOUND", "Revenue action was not found.", 404, { id });
  }

  if (action.status === "APPROVED") {
    const validationFailure = validateCurrentRevenueAction(action, "APPROVE");
    if (validationFailure) return validationFailure;
    return success(action, { duplicate: true });
  }

  if (action.status !== "PREPARED") {
    return failure(
      "INVALID_REVENUE_ACTION_TRANSITION",
      `Cannot approve a revenue action from ${action.status}.`,
      409,
      { from: action.status, to: "APPROVED" }
    );
  }

  const validationFailure = validateCurrentRevenueAction(action, "APPROVE");
  if (validationFailure) return validationFailure;

  const timestamp = now();
  const updated = {
    ...action,
    status: "APPROVED",
    approved_at: timestamp,
    updated_at: timestamp,
    audit: appendAudit(action, "APPROVED", timestamp, { approval: "HUMAN" })
  };
  repository.replaceRevenueAction(updated);
  return success(updated, { duplicate: false });
}

function rejectRevenueAction(id, reason) {
  const action = repository.findRevenueAction(id);

  if (!action) {
    return failure("REVENUE_ACTION_NOT_FOUND", "Revenue action was not found.", 404, { id });
  }

  if (action.status === "REJECTED") {
    return success(action, { duplicate: true });
  }

  if (action.status !== "PREPARED") {
    return failure(
      "INVALID_REVENUE_ACTION_TRANSITION",
      `Cannot reject a revenue action from ${action.status}.`,
      409,
      { from: action.status, to: "REJECTED" }
    );
  }

  const timestamp = now();
  const updated = {
    ...action,
    status: "REJECTED",
    rejection_reason: normalizeText(reason) || null,
    rejected_at: timestamp,
    updated_at: timestamp,
    audit: appendAudit(action, "REJECTED", timestamp, {
      reason: normalizeText(reason) || null
    })
  };
  repository.replaceRevenueAction(updated);
  return success(updated, { duplicate: false });
}

function cancelRevenueAction(id) {
  const action = repository.findRevenueAction(id);

  if (!action) {
    return failure("REVENUE_ACTION_NOT_FOUND", "Revenue action was not found.", 404, { id });
  }

  if (action.status === "CANCELLED") {
    return success(action, { duplicate: true });
  }

  if (!["RECOMMENDED", "PREPARED"].includes(action.status)) {
    return failure(
      "INVALID_REVENUE_ACTION_TRANSITION",
      `Cannot cancel a revenue action from ${action.status}.`,
      409,
      { from: action.status, to: "CANCELLED" }
    );
  }

  const timestamp = now();
  const updated = {
    ...action,
    status: "CANCELLED",
    cancelled_at: timestamp,
    updated_at: timestamp,
    audit: appendAudit(action, "CANCELLED", timestamp)
  };
  repository.replaceRevenueAction(updated);
  return success(updated, { duplicate: false });
}

function executeCommunication(action) {
  const activityResult = repository.createActivityForRevenueAction(action, {
    type: "REVENUE_ACTION_MANUALLY_CONFIRMED",
    description: "User confirmed the recommended follow-up was completed manually.",
    metadata: {
      execution_mode: "MANUAL_CONFIRMED",
      execution_effect_type: "COMMUNICATION_MANUAL_CONFIRMATION",
      channel: action.proposed_execution.channel
    }
  });

  return {
    task: null,
    activity: activityResult.activity,
    result: {
      mode: "MANUAL_CONFIRMED",
      outcome: "USER_CONFIRMED_COMPLETION",
      external_send_performed: false
    }
  };
}

function executeInternalTask(action) {
  const taskResult = repository.createTaskForRevenueAction(action);
  const activityResult = repository.createActivityForRevenueAction(action, {
    type: "REVENUE_ACTION_TASK_EXECUTED",
    description: taskResult.created
      ? `Revenue action created internal task: ${taskResult.task.title}`
      : `Revenue action reused internal task: ${taskResult.task.title}`,
    metadata: {
      execution_mode: "SYSTEM_INTERNAL",
      execution_effect_type: "INTERNAL_TASK",
      task_id: taskResult.task.id
    }
  });

  if (action.action_type === "CREATE_TASK") {
    repository.setOpportunityNextAction(
      action.opportunity_id,
      taskResult.task.title
    );
  }

  return {
    task: taskResult.task,
    activity: activityResult.activity,
    result: {
      mode: "SYSTEM_INTERNAL",
      outcome: taskResult.created ? "TASK_CREATED" : "TASK_REUSED",
      external_send_performed: false
    }
  };
}

function finalizeExecution(action, effects, at = now()) {
  const updated = {
    ...action,
    status: "EXECUTED",
    execution_result: effects.result,
    resulting_task_id: effects.task?.id || null,
    resulting_activity_id: effects.activity?.id || null,
    executed_at: at,
    failed_at: null,
    updated_at: at,
    audit: appendAudit(action, "EXECUTED", at, {
      execution_mode: effects.result.mode,
      resulting_task_id: effects.task?.id || null,
      resulting_activity_id: effects.activity?.id || null
    })
  };
  repository.replaceRevenueAction(updated);
  return success(updated, { duplicate: false });
}

function expectedExecutionMode(action) {
  return action.execution_type === "COMMUNICATION_DRAFT"
    ? "MANUAL_CONFIRMED"
    : "SYSTEM_INTERNAL";
}

function inspectExecutionEffects(action) {
  const tasks = repository.listTasksForRevenueAction(action.id);
  const activities = repository.listActivitiesForRevenueAction(action.id);
  const mode = expectedExecutionMode(action);
  const task = tasks[0] || null;
  const activity = activities[0] || null;

  if (tasks.length > 1 || activities.length > 1) {
    return { conflict: true, reason: "MULTIPLE_LINKED_EFFECTS" };
  }

  if (action.execution_type === "COMMUNICATION_DRAFT") {
    if (task) return { conflict: true, reason: "UNEXPECTED_LINKED_TASK" };
    if (!activity) return { conflict: false, complete: false, partial: false };

    const validActivity =
      activity.opportunity_id === action.opportunity_id &&
      activity.type === "REVENUE_ACTION_MANUALLY_CONFIRMED" &&
      activity.metadata?.source === "revenue_action" &&
      activity.metadata?.revenue_action_id === action.id &&
      activity.metadata?.action_type === action.action_type &&
      activity.metadata?.execution_effect_type ===
        "COMMUNICATION_MANUAL_CONFIRMATION" &&
      activity.metadata?.execution_mode === mode &&
      activity.metadata?.channel === action.proposed_execution?.channel;

    return validActivity
      ? { conflict: false, complete: true, partial: false, task: null, activity }
      : { conflict: true, reason: "INVALID_LINKED_ACTIVITY" };
  }

  const validTask = !task || repository.taskMatchesRevenueAction(task, action);
  const validActivity = !activity || (
    activity.opportunity_id === action.opportunity_id &&
    activity.type === "REVENUE_ACTION_TASK_EXECUTED" &&
    activity.metadata?.source === "revenue_action" &&
    activity.metadata?.revenue_action_id === action.id &&
    activity.metadata?.action_type === action.action_type &&
    activity.metadata?.execution_effect_type === "INTERNAL_TASK" &&
    activity.metadata?.execution_mode === mode &&
    Boolean(task) &&
    activity.metadata?.task_id === task.id
  );

  if (!validTask || !validActivity || (activity && !task)) {
    return { conflict: true, reason: "INVALID_LINKED_INTERNAL_EFFECT" };
  }

  const requiresOpportunityNextAction = action.action_type === "CREATE_TASK";
  const opportunity = requiresOpportunityNextAction
    ? repository.findOpportunity(action.opportunity_id)
    : null;
  const opportunityMutationComplete =
    !requiresOpportunityNextAction ||
    opportunity?.next_action === action.proposed_execution?.title;
  const crmEffectsComplete = Boolean(
    task && activity && opportunityMutationComplete
  );
  const hasEffects = Boolean(task || activity);

  return {
    conflict: false,
    complete: crmEffectsComplete,
    partial: Boolean(hasEffects && !crmEffectsComplete),
    hasEffects,
    opportunityMutationComplete,
    task,
    activity
  };
}

function reconcileExecution(action, effects) {
  if (!effects.complete) return null;
  return finalizeExecution(action, {
    task: effects.task || null,
    activity: effects.activity,
    result: {
      mode: expectedExecutionMode(action),
      outcome: "RECOVERED_LINKED_EFFECTS",
      external_send_performed: false
    }
  });
}

function effectConflict(action, reason) {
  return failure(
    "REVENUE_ACTION_EFFECT_CONFLICT",
    "Linked CRM effects do not match this revenue action and cannot be reconciled.",
    409,
    { id: action.id, reason }
  );
}

function executeRevenueAction(id, body = {}) {
  let action = repository.findRevenueAction(id);
  if (!action) return failure("REVENUE_ACTION_NOT_FOUND", "Revenue action was not found.", 404, { id });
  if (action.status === "EXECUTED") return success(action, { duplicate: true });

  if (!["APPROVED", "FAILED", "EXECUTING"].includes(action.status) || !action.approved_at) {
    return failure("INVALID_REVENUE_ACTION_TRANSITION", `Cannot execute a revenue action from ${action.status}.`, 409, { from: action.status, to: "EXECUTED" });
  }
  if (action.execution_type === "COMMUNICATION_DRAFT" && body.executionMode !== "MANUAL_CONFIRMED") {
    return failure("MANUAL_CONFIRMATION_REQUIRED", "Communication execution requires explicit manual confirmation.", 400, { field: "executionMode", required: "MANUAL_CONFIRMED" });
  }

  const mode = expectedExecutionMode(action);
  const recoveryStatus = ["FAILED", "EXECUTING"].includes(action.status);
  if (recoveryStatus && action.execution_request?.mode !== mode) {
    return failure(
      "INVALID_REVENUE_ACTION_TRANSITION",
      "Execution recovery requires a valid persisted execution request.",
      409,
      { from: action.status, to: "EXECUTED", requiredMode: mode }
    );
  }

  const effects = inspectExecutionEffects(action);
  if (effects.conflict) return effectConflict(action, effects.reason);
  if (!recoveryStatus && (effects.complete || effects.partial || effects.hasEffects)) {
    return effectConflict(action, "EFFECTS_EXIST_BEFORE_EXECUTION_STARTED");
  }
  const reconciled = reconcileExecution(action, effects);
  if (reconciled) return reconciled;

  const current = currentRecommendationFingerprint(
    action.opportunity_id,
    effects.hasEffects ? { excludeRevenueActionId: action.id } : undefined
  );
  if (current.state.error) return failure("OPPORTUNITY_NOT_FOUND", "The opportunity no longer exists; execution was not attempted.", 404, { opportunityId: action.opportunity_id });
  if (["WON", "LOST"].includes(current.state.opportunity.stage)) {
    return supersedeForClosedOpportunity(
      action,
      current.state.opportunity.stage,
      "EXECUTE"
    );
  }
  if (current.fingerprint !== action.basis_fingerprint) return supersedeAsStale(action, current.fingerprint);

  const timestamp = now();
  action = {
    ...action,
    status: "EXECUTING",
    updated_at: timestamp,
    execution_request: {
      mode,
      requested_at: timestamp
    },
    execution_attempts: (action.execution_attempts || 0) + 1,
    audit: appendAudit(action, "EXECUTION_STARTED", timestamp, { attempt: (action.execution_attempts || 0) + 1 })
  };
  repository.replaceRevenueAction(action);

  try {
    const effects = action.execution_type === "COMMUNICATION_DRAFT" ? executeCommunication(action) : executeInternalTask(action);
    return finalizeExecution(action, effects);
  } catch (error) {
    const failedAt = now();
    const failed = {
      ...action,
      status: "FAILED",
      failed_at: failedAt,
      updated_at: failedAt,
      execution_result: {
        mode: action.execution_type === "COMMUNICATION_DRAFT" ? "MANUAL_CONFIRMED" : "SYSTEM_INTERNAL",
        outcome: "FAILED",
        external_send_performed: false,
        error: "EXECUTION_EFFECT_FAILED"
      },
      audit: appendAudit(action, "FAILED", failedAt, { error: "EXECUTION_EFFECT_FAILED" })
    };
    repository.replaceRevenueAction(failed);
    return failure("REVENUE_ACTION_EXECUTION_FAILED", "Revenue action execution failed and can be safely retried.", 500, { id });
  }
}

module.exports = {
  isPlainObject,
  listRevenueActions: repository.listRevenueActions,
  getRevenueAction,
  materializeRevenueAction,
  prepareRevenueAction,
  approveRevenueAction,
  rejectRevenueAction,
  cancelRevenueAction,
  executeRevenueAction
};
