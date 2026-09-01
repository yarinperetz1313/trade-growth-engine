const crypto = require("node:crypto");

const {
  buildDealIntelligenceFromData
} = require("../../intelligence/dealIntelligence");
const {
  buildRevenueIntelligence
} = require("../../intelligence/revenueIntelligence");
const {
  DEFAULT_PROBABILITIES,
  STAGES,
  buildPipelineMetrics
} = require("../../opportunities/opportunityEngine");
const {
  qualifyProspect
} = require("../../intelligence/qualificationEngine");

const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const NEXT_ACTION_TYPES = [
  "CREATE_TASK",
  "RESEARCH",
  "FOLLOW_UP",
  "QUALIFY",
  "ADVANCE"
];

function createPostgresCoreService({
  persistence,
  createId = crypto.randomUUID,
  clock = () => new Date()
} = {}) {
  if (
    !persistence ||
    persistence.adapter !== "postgres" ||
    typeof persistence.forTenant !== "function"
  ) {
    throw new TypeError(
      "The PostgreSQL core service requires injected PostgreSQL persistence."
    );
  }
  return Object.freeze({
    forTenant(context) {
      return createTenantCoreService(persistence.forTenant(context), {
        createId,
        clock
      });
    }
  });
}

function createTenantCoreService(repositories, { createId, clock }) {
  const now = () => new Date(clock()).toISOString();

  async function loadState(scoped, opportunityId, generatedAt = now()) {
    const [prospects, opportunities, tasks, activities] = await Promise.all([
      scoped.prospects.list(),
      scoped.opportunities.list(),
      scoped.tasks.list(),
      scoped.activities.list()
    ]);
    const opportunity = opportunities.find(item => item.id === opportunityId);
    if (!opportunity) return null;
    const intelligence = buildDealIntelligenceFromData(opportunity, {
      prospects,
      tasks,
      activities,
      generatedAt
    });
    return {
      opportunity,
      intelligence,
      pipeline_metrics: buildPipelineMetrics(opportunities),
      all: { prospects, opportunities, tasks, activities },
      generatedAt
    };
  }

  async function mutationResponse(scoped, opportunityId, extras = {}) {
    const state = await loadState(scoped, opportunityId);
    return {
      ok: true,
      ...extras,
      opportunity: state.opportunity,
      intelligence: state.intelligence,
      state: {
        opportunity: state.opportunity,
        intelligence: state.intelligence
      },
      pipeline_metrics: state.pipeline_metrics
    };
  }

  async function createActivityOnce(scoped, input) {
    await scoped.opportunities.findById(input.opportunityId, { lock: true });
    const activities = await scoped.activities.list({
      opportunityId: input.opportunityId
    });
    const existing = findEquivalentActivity(activities, input);
    if (existing) return { created: false, activity: existing };
    const activity = await scoped.activities.insert({
      id: createId(),
      opportunity_id: input.opportunityId,
      type: input.type,
      description: input.description,
      metadata: {
        ...input.metadata,
        action_key: input.actionKey
      }
    });
    return { created: true, activity };
  }

  async function createTaskOnce(scoped, {
    opportunityId,
    title,
    description = "",
    dueAt = null,
    priority = "MEDIUM",
    actionType,
    metadata = {}
  }) {
    const normalizedTitle = normalizeText(title);
    const opportunity = await scoped.opportunities.findById(
      opportunityId,
      { lock: true }
    );
    if (!opportunity) return { error: "OPPORTUNITY_NOT_FOUND" };
    const tasks = await scoped.tasks.list({ opportunityId });
    const existing = tasks.find(task =>
      task.status !== "COMPLETED" &&
      (!task.metadata?.action_type || task.metadata.action_type === actionType) &&
      normalizeKey(task.title) === normalizeKey(normalizedTitle)
    );
    if (existing) return { created: false, task: existing };
    const task = await scoped.tasks.insert({
      id: createId(),
      opportunity_id: opportunityId,
      title: normalizedTitle,
      description: normalizeText(description),
      due_at: dueAt,
      priority,
      status: "OPEN",
      completed_at: null,
      metadata: {
        ...metadata,
        ...(actionType ? {
          source: "deal_intelligence",
          action_type: actionType,
          normalized_title: normalizeKey(normalizedTitle)
        } : {})
      }
    });
    return { created: true, task };
  }

  return Object.freeze({
    async listProspects({ limit = 100, offset = 0 } = {}) {
      const records = await repositories.prospects.list();
      return {
        data: records.slice(offset, offset + limit),
        count: records.length,
        persisted: true,
        storage: "postgres"
      };
    },

    async createProspect(input = {}) {
      const prospect = await repositories.prospects.insert({
        ...input,
        id: input.id ?? createId(),
        qualification_status: input.qualification_status || "DISCOVERED"
      });
      return {
        data: prospect,
        persisted: true,
        storage: "postgres"
      };
    },

    qualifyProspect(prospectId) {
      return repositories.transaction(async scoped => {
        const prospect = await scoped.prospects.findById(
          prospectId,
          { lock: true }
        );
        if (!prospect) return { error: "PROSPECT_NOT_FOUND" };
        const qualification = qualifyProspect(prospect);
        const updated = await scoped.prospects.update(prospect.id, {
          qualification_score: qualification.score,
          qualification_status: qualification.priority,
          qualification
        });
        return { data: updated };
      });
    },

    previewQualification(prospect) {
      return Promise.resolve(qualifyProspect(prospect));
    },

    listOpportunities() {
      return repositories.opportunities.list();
    },

    createOpportunityFromProspect(prospectId) {
      return repositories.transaction(async scoped => {
        const prospect = await scoped.prospects.findById(
          prospectId,
          { lock: true }
        );
        if (!prospect) return { error: "PROSPECT_NOT_FOUND" };
        const existing = (await scoped.opportunities.list({
          prospectId
        })).find(opportunity => opportunity.stage !== "LOST");
        if (existing) return { data: existing, created: false };
        const qualification = prospect.qualification || {};
        const score = Number(
          qualification.score ?? prospect.qualification_score ?? 0
        );
        const priority = qualification.priority ??
          prospect.qualification_status ?? "LOW";
        const stage = score >= 70 ? "QUALIFIED" : "NEW";
        const value = Number(
          prospect.value_estimate ?? prospect.estimated_value ??
          prospect.opportunity_value ?? 0
        );
        const probability = probabilityForStage(stage);
        const opportunity = await scoped.opportunities.insert({
          id: createId(),
          prospect_id: prospect.id,
          business_name: prospect.business_name,
          stage,
          priority,
          qualification_score: score,
          value,
          probability,
          weighted_value: calculateWeightedValue(value, probability),
          next_action: stage === "QUALIFIED"
            ? "Begin qualified outreach"
            : "Research and qualify prospect"
        });
        await scoped.activities.insert({
          id: createId(),
          prospect_id: prospect.id,
          opportunity_id: opportunity.id,
          type: "OPPORTUNITY_CREATED",
          description: "Opportunity created from prospect qualification",
          metadata: { score, priority, stage }
        });
        return { data: opportunity, created: true };
      });
    },

    updateOpportunityStage(opportunityId, stage) {
      if (!STAGES.includes(stage)) return Promise.resolve({
        error: "INVALID_OPPORTUNITY_STAGE"
      });
      return repositories.transaction(async scoped => {
        const opportunity = await scoped.opportunities.findById(
          opportunityId,
          { lock: true }
        );
        if (!opportunity) return { error: "OPPORTUNITY_NOT_FOUND" };
        const probability = probabilityForStage(stage);
        const updated = await scoped.opportunities.update(opportunityId, {
          stage,
          probability,
          weighted_value: calculateWeightedValue(opportunity.value, probability),
          next_action: nextActionForStage(stage)
        });
        await scoped.activities.insert({
          id: createId(),
          prospect_id: opportunity.prospect_id,
          opportunity_id: opportunity.id,
          type: "STAGE_CHANGED",
          description: `Opportunity moved to ${stage}`,
          metadata: { stage, probability }
        });
        return { data: updated };
      });
    },

    async getPipelineMetrics() {
      return buildPipelineMetrics(await repositories.opportunities.list());
    },

    getOpportunityIntelligence(opportunityId) {
      return repositories.transaction(async scoped => {
        const state = await loadState(scoped, opportunityId);
        return state
          ? { opportunity: state.opportunity, intelligence: state.intelligence }
          : { error: "OPPORTUNITY_NOT_FOUND" };
      });
    },

    listActivities(opportunityId) {
      return repositories.activities.list({ opportunityId });
    },

    listTasks(opportunityId) {
      return repositories.tasks.list(
        opportunityId ? { opportunityId } : undefined
      );
    },

    createTask(input) {
      const validation = validateTaskInput(input);
      if (validation) return Promise.resolve(validation);
      return repositories.transaction(async scoped => {
        const taskResult = await createTaskOnce(scoped, {
          opportunityId: normalizeText(input.opportunity_id),
          title: input.title,
          description: input.description ?? "",
          dueAt: input.due_at ?? input.dueDate ?? null,
          priority: input.priority ?? "MEDIUM"
        });
        if (taskResult.error) return opportunityNotFound(
          normalizeText(input.opportunity_id)
        );
        if (!taskResult.created) {
          return { ok: true, data: taskResult.task, duplicate: true };
        }
        await scoped.activities.insert({
          id: createId(),
          opportunity_id: taskResult.task.opportunity_id,
          type: "TASK_CREATED",
          description: `Task created: ${taskResult.task.title}`,
          metadata: {
            task_id: taskResult.task.id,
            priority: taskResult.task.priority,
            action_key: `manual-task:${taskResult.task.opportunity_id}:${normalizeKey(taskResult.task.title)}`
          }
        });
        return { ok: true, data: taskResult.task, duplicate: false };
      });
    },

    updateTask(id, body = {}) {
      const validation = validateTaskUpdates(body);
      if (validation) return Promise.resolve(validation);
      return repositories.transaction(async scoped => {
        const existing = await scoped.tasks.findById(id);
        if (!existing) return failure("Task not found", "Task was not found.");
        const updates = normalizeTaskUpdates(existing, body, now());
        const task = await scoped.tasks.update(id, updates);
        if (updates.status && updates.status !== existing.status) {
          await scoped.activities.insert({
            id: createId(),
            opportunity_id: existing.opportunity_id,
            type: updates.status === "COMPLETED"
              ? "TASK_COMPLETED"
              : "TASK_STATUS_CHANGED",
            description: updates.status === "COMPLETED"
              ? `Task completed: ${existing.title}`
              : `Task moved to ${updates.status}: ${existing.title}`,
            metadata: {
              task_id: existing.id,
              from: existing.status,
              to: updates.status
            }
          });
        }
        return { ok: true, data: task };
      });
    },

    addContact({ opportunityId, contactName }) {
      if (!isMeaningfulContact(contactName)) return Promise.resolve(failure(
        "CONTACT_NAME_INVALID",
        "Contact name must include at least first and last name.",
        { field: "contactName" }
      ));
      const name = normalizeText(contactName);
      return repositories.transaction(async scoped => {
        const opportunity = await scoped.opportunities.findById(
          opportunityId,
          { lock: true }
        );
        if (!opportunity) return opportunityNotFound(opportunityId);
        const changed = normalizeKey(opportunity.contact_name) !== normalizeKey(name);
        if (changed) {
          await scoped.opportunities.update(opportunityId, { contact_name: name });
        }
        const activity = await createActivityOnce(scoped, {
          opportunityId,
          type: "CONTACT_ADDED",
          description: `Decision maker added: ${name}`,
          actionKey: `contact:${opportunityId}:${normalizeKey(name)}`,
          actionType: "CONTACT",
          semanticTitle: name,
          metadata: { contact_name: name, action_type: "CONTACT" }
        });
        return mutationResponse(scoped, opportunityId, {
          changed,
          duplicate: !activity.created,
          activity: activity.activity
        });
      });
    },

    setValue({ opportunityId, value }) {
      const numeric = Number(value);
      if (typeof value === "boolean" || !Number.isFinite(numeric) || numeric <= 0) {
        return Promise.resolve(failure(
          "INVALID_VALUE",
          "Opportunity value must be a positive number.",
          { field: "value" }
        ));
      }
      const rounded = Math.round(numeric);
      return repositories.transaction(async scoped => {
        const opportunity = await scoped.opportunities.findById(
          opportunityId,
          { lock: true }
        );
        if (!opportunity) return opportunityNotFound(opportunityId);
        const changed = Number(opportunity.value || 0) !== rounded;
        if (changed) {
          await scoped.opportunities.update(opportunityId, {
            value: rounded,
            weighted_value: Math.round(rounded * Number(opportunity.probability || 0))
          });
        }
        const activity = await createActivityOnce(scoped, {
          opportunityId,
          type: "VALUE_UPDATED",
          description: `Opportunity value updated to ${rounded}`,
          actionKey: `value:${opportunityId}:${rounded}`,
          actionType: "VALUE",
          semanticValue: rounded,
          metadata: { value: rounded, action_type: "VALUE" }
        });
        return mutationResponse(scoped, opportunityId, {
          changed,
          duplicate: !activity.created,
          activity: activity.activity
        });
      });
    },

    createIntelligenceTask({
      opportunityId,
      title,
      priority,
      actionType,
      followUp = false
    }) {
      const resolvedPriority = followUp || priority !== undefined
        ? priority
        : "MEDIUM";
      if (!TASK_PRIORITIES.includes(resolvedPriority)) return Promise.resolve(failure(
        "INVALID_PRIORITY",
        "Task priority is invalid.",
        { field: "priority" }
      ));
      if (!followUp && !NEXT_ACTION_TYPES.includes(actionType)) {
        return Promise.resolve(failure(
          "INVALID_ACTION_TYPE",
          "A valid explicit next-best-action type is required.",
          { field: "actionType", allowed: NEXT_ACTION_TYPES }
        ));
      }
      if (title !== undefined && !isMeaningfulString(title)) {
        return Promise.resolve(failure(
          "TASK_TITLE_INVALID",
          "Task title must be a meaningful string when provided.",
          { field: "title" }
        ));
      }
      return repositories.transaction(async scoped => {
        const opportunity = await scoped.opportunities.findById(
          opportunityId,
          { lock: true }
        );
        if (!opportunity) return opportunityNotFound(opportunityId);
        const state = await loadState(scoped, opportunityId);
        const resolvedActionType = followUp ? "FOLLOW_UP" : actionType;
        const taskTitle = normalizeText(title) || (followUp
          ? `Follow up — ${state.opportunity.business_name || "opportunity"}`
          : normalizeText(state.intelligence.next_best_action?.taskTitle) ||
            normalizeText(state.opportunity.next_action) ||
            `Next action — ${state.opportunity.business_name || "opportunity"}`);
        const taskResult = await createTaskOnce(scoped, {
          opportunityId,
          title: taskTitle,
          description: followUp
            ? "Follow up on opportunity after stale-risk detection."
            : "Task created from Deal Intelligence.",
          priority: resolvedPriority,
          actionType: resolvedActionType
        });
        if (taskResult.error) return opportunityNotFound(opportunityId);
        if (
          resolvedActionType === "CREATE_TASK" &&
          normalizeKey(state.opportunity.next_action) !== normalizeKey(taskResult.task.title)
        ) {
          await scoped.opportunities.update(opportunityId, {
            next_action: taskResult.task.title
          });
        }
        const activity = await createActivityOnce(scoped, {
          opportunityId,
          type: followUp ? "FOLLOW_UP_CREATED" : "INTELLIGENCE_TASK_CREATED",
          description: followUp
            ? `Follow-up task created: ${taskResult.task.title}`
            : `Intelligence task created: ${taskResult.task.title}`,
          actionKey: `task:${resolvedActionType}:${opportunityId}:${normalizeKey(taskResult.task.title)}`,
          actionType: resolvedActionType,
          semanticTitle: taskResult.task.title,
          metadata: {
            task_id: taskResult.task.id,
            task_title: taskResult.task.title,
            priority: taskResult.task.priority,
            action_type: resolvedActionType
          }
        });
        return mutationResponse(scoped, opportunityId, {
          task: taskResult.task,
          duplicate: !taskResult.created,
          activity: activity.activity,
          task_created: taskResult.created,
          activity_created: activity.created
        });
      });
    },

    getRevenueIntelligence() {
      return repositories.transaction(async scoped => {
        const [prospects, opportunities, tasks, activities] = await Promise.all([
          scoped.prospects.list(),
          scoped.opportunities.list(),
          scoped.tasks.list(),
          scoped.activities.list()
        ]);
        const generatedAt = now();
        return buildRevenueIntelligence({
          opportunities,
          intelligences: opportunities.map(opportunity =>
            buildDealIntelligenceFromData(opportunity, {
              prospects,
              tasks,
              activities,
              generatedAt
            })
          ),
          generatedAt
        });
      });
    }
  });
}

function findEquivalentActivity(activities, {
  opportunityId,
  type,
  actionKey,
  actionType,
  semanticTitle,
  semanticValue
}) {
  const normalizedTitle = semanticTitle === undefined
    ? null
    : normalizeKey(semanticTitle);
  const normalizedValue = semanticValue === undefined || semanticValue === null
    ? null
    : normalizeKey(semanticValue);
  return activities.find(activity => {
    if (activity.metadata?.action_key === actionKey) return true;
    if (activity.opportunity_id !== opportunityId || activity.type !== type) {
      return false;
    }
    const metadataActionType = activity.metadata?.action_type;
    if (
      metadataActionType &&
      actionType &&
      metadataActionType !== actionType
    ) {
      return false;
    }
    const haystack = normalizeKey(
      `${activity.description || ""} ${activity.metadata?.task_title || ""} ` +
      `${activity.metadata?.contact_name || ""} ${activity.metadata?.value || ""}`
    );
    if (normalizedTitle && haystack.includes(normalizedTitle)) return true;
    if (normalizedValue && haystack.includes(normalizedValue)) return true;
    return !normalizedTitle && !normalizedValue &&
      Boolean(metadataActionType) && metadataActionType === actionType;
  }) || null;
}

function failure(error, message, details = {}) {
  return { ok: false, error, message, details };
}

function opportunityNotFound(opportunityId) {
  return failure(
    "OPPORTUNITY_NOT_FOUND",
    "Opportunity was not found.",
    { opportunityId }
  );
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function isMeaningfulString(value) {
  return typeof value === "string" && normalizeText(value).length > 0;
}

function isMeaningfulContact(value) {
  if (!isMeaningfulString(value)) return false;
  const normalized = normalizeText(value);
  return normalized !== "[object Object]" &&
    normalized.length >= 3 &&
    normalized.split(/\s+/).length >= 2;
}

function probabilityForStage(stage) {
  return DEFAULT_PROBABILITIES[stage] ?? DEFAULT_PROBABILITIES.NEW;
}

function calculateWeightedValue(value, probability) {
  return Math.round(Number(value || 0) * Number(probability || 0));
}

function nextActionForStage(stage) {
  return {
    NEW: "Research and qualify prospect",
    QUALIFIED: "Begin qualified outreach",
    CONTACTED: "Monitor for response",
    REPLIED: "Continue conversation",
    MEETING: "Prepare for meeting",
    PROPOSAL: "Follow up on proposal",
    WON: "Begin client onboarding",
    LOST: "Record loss reason"
  }[stage] || "Review opportunity";
}

function isValidDueInput(value) {
  if (value === undefined || value === null || value === "") return true;
  if (!["string", "number"].includes(typeof value)) return false;
  return Number.isFinite(new Date(value).getTime());
}

function validateTaskInput(input = {}) {
  if (!isMeaningfulString(input.opportunity_id)) {
    return failure("opportunity_id is required", "opportunity_id is required");
  }
  if (!isMeaningfulString(input.title)) {
    return failure("title is required", "title is required");
  }
  if (
    input.description !== undefined &&
    input.description !== null &&
    !["string", "number"].includes(typeof input.description)
  ) {
    return failure("Invalid task description", "Invalid task description");
  }
  if (!isValidDueInput(input.due_at ?? input.dueDate)) {
    return failure("Invalid task due date", "Invalid task due date");
  }
  if (!TASK_PRIORITIES.includes(input.priority ?? "MEDIUM")) {
    return failure("Invalid task priority", "Invalid task priority");
  }
  return null;
}

function validateTaskUpdates(body = {}) {
  if (body.title !== undefined && !isMeaningfulString(body.title)) {
    return failure("title is required", "title is required");
  }
  if (
    body.description !== undefined &&
    body.description !== null &&
    !["string", "number"].includes(typeof body.description)
  ) {
    return failure("Invalid task description", "Invalid task description");
  }
  if (!isValidDueInput(body.due_at ?? body.dueDate)) {
    return failure("Invalid task due date", "Invalid task due date");
  }
  if (body.priority !== undefined && !TASK_PRIORITIES.includes(body.priority)) {
    return failure("Invalid task priority", "Invalid task priority");
  }
  if (body.status !== undefined && !TASK_STATUSES.includes(body.status)) {
    return failure("Invalid task status", "Invalid task status");
  }
  return null;
}

function normalizeTaskUpdates(existing, body, at) {
  const updates = {};
  if (body.title !== undefined) updates.title = normalizeText(body.title);
  if (body.description !== undefined) {
    updates.description = normalizeText(body.description);
  }
  const due = body.due_at !== undefined ? body.due_at : body.dueDate;
  if (due !== undefined) updates.due_at = due === "" ? null : due;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.status !== undefined) {
    updates.status = body.status;
    updates.completed_at = body.status === "COMPLETED"
      ? at
      : existing.status === "COMPLETED" ? null : existing.completed_at;
  }
  return updates;
}

module.exports = {
  createPostgresCoreService
};
