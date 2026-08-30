const crypto = require("crypto");

const { readCollection, writeCollection } = require("../services/localStore");

const COLLECTION = "revenue_actions";

function now() {
  return new Date().toISOString();
}

function normalizeSemanticValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function listRevenueActions({ opportunityId } = {}) {
  return readCollection(COLLECTION)
    .filter(action => !opportunityId || action.opportunity_id === opportunityId)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function findRevenueAction(id) {
  return readCollection(COLLECTION).find(action => action.id === id) || null;
}

function insertRevenueAction(action) {
  const actions = readCollection(COLLECTION);
  actions.push(action);
  writeCollection(COLLECTION, actions);
  return action;
}

function replaceRevenueAction(action) {
  const actions = readCollection(COLLECTION);
  const index = actions.findIndex(item => item.id === action.id);
  if (index === -1) return null;
  actions[index] = action;
  writeCollection(COLLECTION, actions);
  return action;
}

function replaceRevenueActions(actionsToReplace) {
  const replacements = new Map(
    actionsToReplace.map(action => [action.id, action])
  );
  const actions = readCollection(COLLECTION).map(
    action => replacements.get(action.id) || action
  );
  writeCollection(COLLECTION, actions);
  return actionsToReplace;
}

function findTaskForRevenueAction(revenueActionId) {
  return readCollection("tasks").find(task => task.metadata?.revenue_action_id === revenueActionId) || null;
}

function listTasksForRevenueAction(revenueActionId) {
  return readCollection("tasks").filter(
    task => task.metadata?.revenue_action_id === revenueActionId
  );
}

function buildTaskIdentity(action) {
  const proposal = action.proposed_execution || {};
  const normalizedTitle =
    proposal.normalized_title || normalizeSemanticValue(proposal.title);
  const semanticTaskKey =
    proposal.semantic_task_key ||
    [action.opportunity_id, action.action_type, normalizedTitle].join(":");

  return {
    normalized_title: normalizedTitle,
    semantic_task_key: semanticTaskKey,
    priority: proposal.priority || null,
    due_at: proposal.due_at ?? null
  };
}

function taskMatchesRevenueAction(task, action) {
  const identity = buildTaskIdentity(action);
  return (
    task.opportunity_id === action.opportunity_id &&
    task.status === "OPEN" &&
    ["revenue_action", "deal_intelligence"].includes(task.metadata?.source) &&
    task.metadata?.revenue_action_id === action.id &&
    task.metadata?.action_type === action.action_type &&
    task.metadata?.execution_effect_type === "INTERNAL_TASK" &&
    task.metadata?.normalized_title === identity.normalized_title &&
    task.metadata?.semantic_task_key === identity.semantic_task_key &&
    (task.priority || null) === identity.priority &&
    (task.due_at ?? null) === identity.due_at
  );
}

function isEquivalentOpenTask(task, action) {
  if (task.opportunity_id !== action.opportunity_id || task.status !== "OPEN") return false;
  if (task.metadata?.revenue_action_id) return false;
  const identity = buildTaskIdentity(action);
  return (
    task.metadata?.source === "deal_intelligence" &&
    task.metadata?.action_type === action.action_type &&
    task.metadata?.normalized_title === identity.normalized_title &&
    (task.priority || null) === identity.priority &&
    (task.due_at ?? null) === identity.due_at
  );
}

function linkExistingTask(task, action) {
  const tasks = readCollection("tasks");
  const index = tasks.findIndex(item => item.id === task.id);
  if (index === -1) return null;
  const identity = buildTaskIdentity(action);
  const linked = {
    ...tasks[index],
    updated_at: now(),
    metadata: {
      ...(tasks[index].metadata || {}),
      revenue_action_id: action.id,
      action_type: action.action_type,
      execution_effect_type: "INTERNAL_TASK",
      normalized_title: identity.normalized_title,
      semantic_task_key: identity.semantic_task_key,
      revenue_action_linked_at: now()
    }
  };
  tasks[index] = linked;
  writeCollection("tasks", tasks);
  return linked;
}

function createTaskForRevenueAction(action) {
  const ownTask = findTaskForRevenueAction(action.id);
  if (ownTask) return { task: ownTask, created: false, reused: true };

  const equivalent = readCollection("tasks").find(task => isEquivalentOpenTask(task, action));
  if (equivalent) {
    return { task: linkExistingTask(equivalent, action), created: false, reused: true };
  }

  const tasks = readCollection("tasks");
  const timestamp = now();
  const proposal = action.proposed_execution;
  const identity = buildTaskIdentity(action);
  const task = {
    id: crypto.randomUUID(),
    created_at: timestamp,
    updated_at: timestamp,
    opportunity_id: action.opportunity_id,
    title: proposal.title,
    description: proposal.description || "",
    due_at: proposal.due_at ?? null,
    priority: proposal.priority,
    status: "OPEN",
    completed_at: null,
    metadata: {
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      execution_effect_type: "INTERNAL_TASK",
      normalized_title: identity.normalized_title,
      semantic_task_key: identity.semantic_task_key
    }
  };
  tasks.push(task);
  writeCollection("tasks", tasks);
  return { task, created: true, reused: false };
}

function findActivityForRevenueAction(revenueActionId) {
  return readCollection("activities").find(activity => activity.metadata?.revenue_action_id === revenueActionId) || null;
}

function listActivitiesForRevenueAction(revenueActionId) {
  return readCollection("activities").filter(
    activity => activity.metadata?.revenue_action_id === revenueActionId
  );
}

function createActivityForRevenueAction(action, record) {
  const existing = findActivityForRevenueAction(action.id);
  if (existing) return { activity: existing, created: false };

  const activities = readCollection("activities");
  const timestamp = now();
  const activity = {
    id: crypto.randomUUID(),
    created_at: timestamp,
    updated_at: timestamp,
    opportunity_id: action.opportunity_id,
    type: record.type,
    description: record.description,
    metadata: {
      ...record.metadata,
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      action_key: `revenue-action:${action.id}`
    }
  };
  activities.push(activity);
  writeCollection("activities", activities);
  return { activity, created: true };
}

function setOpportunityNextAction(opportunityId, nextAction) {
  const opportunities = readCollection("opportunities");
  const index = opportunities.findIndex(item => item.id === opportunityId);
  if (index === -1) return null;
  if (opportunities[index].next_action === nextAction) return opportunities[index];
  opportunities[index] = { ...opportunities[index], next_action: nextAction, updated_at: now() };
  writeCollection("opportunities", opportunities);
  return opportunities[index];
}

function findOpportunity(opportunityId) {
  return readCollection("opportunities").find(
    opportunity => opportunity.id === opportunityId
  ) || null;
}

module.exports = {
  listRevenueActions,
  findRevenueAction,
  insertRevenueAction,
  replaceRevenueAction,
  replaceRevenueActions,
  findTaskForRevenueAction,
  listTasksForRevenueAction,
  buildTaskIdentity,
  taskMatchesRevenueAction,
  findActivityForRevenueAction,
  listActivitiesForRevenueAction,
  createTaskForRevenueAction,
  createActivityForRevenueAction,
  setOpportunityNextAction,
  findOpportunity
};
