const crypto = require("crypto");

const {
  readCollection,
  writeCollection
} = require("../services/localStore");

const {
  getOpportunityIntelligence
} = require("../intelligence/dealIntelligence");

const {
  getPipelineMetrics
} = require("../opportunities/opportunityEngine");

const TASK_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT"
];

const NEXT_ACTION_TYPES = [
  "CREATE_TASK",
  "RESEARCH",
  "FOLLOW_UP",
  "QUALIFY",
  "ADVANCE"
];

function now() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase();
}


function isPlainScalar(value) {
  return (
    value === null ||
    ["string", "number"].includes(
      typeof value
    )
  );
}

function isMeaningfulString(value) {
  return (
    typeof value === "string" &&
    normalizeText(value).length > 0
  );
}

function isValidNumberInput(value) {
  if (typeof value === "boolean") {
    return false;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();

  if (!normalized) {
    return false;
  }

  return Number.isFinite(
    Number(normalized)
  );
}

function isValidPriorityInput(priority) {
  return (
    typeof priority === "string" &&
    TASK_PRIORITIES.includes(priority)
  );
}

function isValidOptionalTitleInput(title) {
  if (title === undefined) {
    return true;
  }

  return isMeaningfulString(title);
}

function containsObjectString(value) {
  return normalizeText(value) === "[object Object]";
}

function makeError(
  error,
  message,
  details = {}
) {
  return {
    ok: false,
    error,
    message,
    details
  };
}

function findOpportunity(id) {
  return readCollection("opportunities")
    .find(item => item.id === id);
}

function saveOpportunity(updated) {
  const opportunities =
    readCollection("opportunities");

  const index =
    opportunities.findIndex(
      item => item.id === updated.id
    );

  if (index === -1) {
    return null;
  }

  opportunities[index] = {
    ...opportunities[index],
    ...updated,
    updated_at: now()
  };

  writeCollection(
    "opportunities",
    opportunities
  );

  return opportunities[index];
}

function responseFor(
  opportunityId,
  extras = {}
) {
  const refreshed =
    getOpportunityIntelligence(
      opportunityId
    );

  return {
    ok: true,
    ...extras,
    opportunity:
      refreshed.opportunity,
    intelligence:
      refreshed.intelligence,
    state: refreshed,
    pipeline_metrics:
      getPipelineMetrics()
  };
}

function findEquivalentActivity({
  opportunityId,
  type,
  actionKey,
  actionType,
  semanticTitle,
  semanticValue
}) {
  const normalizedTitle =
    semanticTitle === undefined
      ? null
      : normalizeKey(semanticTitle);

  const normalizedValue =
    semanticValue === undefined ||
    semanticValue === null
      ? null
      : normalizeKey(semanticValue);

  return (
    readCollection("activities")
      .find(activity => {
        if (
          activity.metadata?.action_key ===
          actionKey
        ) {
          return true;
        }

        if (
          activity.opportunity_id !==
            opportunityId ||
          activity.type !== type
        ) {
          return false;
        }

        const metadataActionType =
          activity.metadata?.action_type;

        if (
          metadataActionType &&
          actionType &&
          metadataActionType !== actionType
        ) {
          return false;
        }

        const haystack = normalizeKey(
          `${activity.description || ""} ${
            activity.metadata?.task_title || ""
          } ${
            activity.metadata?.contact_name || ""
          } ${
            activity.metadata?.value || ""
          }`
        );

        if (
          normalizedTitle &&
          haystack.includes(
            normalizedTitle
          )
        ) {
          return true;
        }

        if (
          normalizedValue &&
          haystack.includes(
            normalizedValue
          )
        ) {
          return true;
        }

        return (
          !normalizedTitle &&
          !normalizedValue &&
          Boolean(metadataActionType) &&
          metadataActionType === actionType
        );
      }) || null
  );
}

function createActivityOnce({
  opportunityId,
  type,
  description,
  actionKey,
  actionType,
  semanticTitle,
  semanticValue,
  metadata = {}
}) {
  const existing =
    findEquivalentActivity({
      opportunityId,
      type,
      actionKey,
      actionType,
      semanticTitle,
      semanticValue
    });

  if (existing) {
    return {
      created: false,
      activity: existing
    };
  }

  const activities =
    readCollection("activities");

  const activity = {
    id: crypto.randomUUID(),
    created_at: now(),
    updated_at: now(),
    opportunity_id: opportunityId,
    type,
    description,
    metadata: {
      ...metadata,
      action_key: actionKey
    }
  };

  activities.push(activity);

  writeCollection(
    "activities",
    activities
  );

  return {
    created: true,
    activity
  };
}

function taskActionMatches(
  task,
  actionType
) {
  const metadataActionType =
    task.metadata?.action_type;

  if (metadataActionType) {
    return metadataActionType === actionType;
  }

  return true;
}

function findEquivalentOpenTask({
  opportunityId,
  actionType,
  title
}) {
  const normalizedTitle =
    normalizeKey(title);

  return (
    readCollection("tasks")
      .find(
        task =>
          task.opportunity_id ===
            opportunityId &&
          task.status !==
            "COMPLETED" &&
          taskActionMatches(
            task,
            actionType
          ) &&
          normalizeKey(task.title) ===
            normalizedTitle
      ) || null
  );
}

function createTaskOnce({
  opportunityId,
  title,
  description = "",
  priority = "MEDIUM",
  actionType
}) {
  const normalizedTitle =
    normalizeText(title);

  const existing =
    findEquivalentOpenTask({
      opportunityId,
      actionType,
      title: normalizedTitle
    });

  if (existing) {
    return {
      created: false,
      task: existing
    };
  }

  const tasks =
    readCollection("tasks");

  const task = {
    id: crypto.randomUUID(),
    created_at: now(),
    updated_at: now(),
    opportunity_id: opportunityId,
    title: normalizedTitle,
    description,
    due_at: null,
    priority,
    status: "OPEN",
    completed_at: null,
    metadata: {
      source: "deal_intelligence",
      action_type: actionType,
      normalized_title:
        normalizeKey(normalizedTitle)
    }
  };

  tasks.push(task);

  writeCollection(
    "tasks",
    tasks
  );

  return {
    created: true,
    task
  };
}

function validatePriority(priority) {
  return isValidPriorityInput(priority);
}

function addContact({
  opportunityId,
  contactName
}) {
  const opportunity =
    findOpportunity(opportunityId);

  if (!opportunity) {
    return makeError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity was not found.",
      { opportunityId }
    );
  }

  if (!isMeaningfulString(contactName)) {
    return makeError(
      "CONTACT_NAME_INVALID",
      "Contact name must be a meaningful string.",
      { field: "contactName" }
    );
  }

  const name =
    normalizeText(contactName);

  if (containsObjectString(name)) {
    return makeError(
      "CONTACT_NAME_INVALID",
      "Contact name must be a meaningful string.",
      { field: "contactName" }
    );
  }

  const nameParts =
    name.split(/\s+/).filter(Boolean);

  if (
    name.length < 3 ||
    nameParts.length < 2
  ) {
    return makeError(
      "CONTACT_NAME_INVALID",
      "Contact name must include at least first and last name.",
      { field: "contactName" }
    );
  }

  const actionKey =
    `contact:${opportunityId}:${normalizeKey(name)}`;

  const changed =
    normalizeKey(opportunity.contact_name) !==
    normalizeKey(name);

  if (changed) {
    saveOpportunity({
      ...opportunity,
      contact_name: name
    });
  }

  const activityResult =
    createActivityOnce({
      opportunityId,
      type: "CONTACT_ADDED",
      description:
        `Decision maker added: ${name}`,
      actionKey,
      actionType: "CONTACT",
      semanticTitle: name,
      metadata: {
        contact_name: name,
        action_type: "CONTACT"
      }
    });

  return responseFor(
    opportunityId,
    {
      changed,
      duplicate:
        !activityResult.created,
      activity:
        activityResult.activity
    }
  );
}

function setValue({
  opportunityId,
  value
}) {
  const opportunity =
    findOpportunity(opportunityId);

  if (!opportunity) {
    return makeError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity was not found.",
      { opportunityId }
    );
  }

  if (!isValidNumberInput(value)) {
    return makeError(
      "INVALID_VALUE",
      "Opportunity value must be a positive number.",
      { field: "value" }
    );
  }

  const numericValue =
    Number(value);

  if (numericValue <= 0) {
    return makeError(
      "INVALID_VALUE",
      "Opportunity value must be a positive number.",
      { field: "value" }
    );
  }

  const roundedValue =
    Math.round(numericValue);

  const probability =
    Number(
      opportunity.probability || 0
    );

  const actionKey =
    `value:${opportunityId}:${roundedValue}`;

  const changed =
    Number(opportunity.value || 0) !==
    roundedValue;

  if (changed) {
    saveOpportunity({
      ...opportunity,
      value: roundedValue,
      weighted_value:
        Math.round(
          roundedValue * probability
        )
    });
  }

  const activityResult =
    createActivityOnce({
      opportunityId,
      type: "VALUE_UPDATED",
      description:
        `Opportunity value updated to ${roundedValue}`,
      actionKey,
      actionType: "VALUE",
      semanticValue: roundedValue,
      metadata: {
        value: roundedValue,
        action_type: "VALUE"
      }
    });

  return responseFor(
    opportunityId,
    {
      changed,
      duplicate:
        !activityResult.created,
      activity:
        activityResult.activity
    }
  );
}

function createFollowUp({
  opportunityId,
  title,
  priority
}) {
  const opportunity =
    findOpportunity(opportunityId);

  if (!opportunity) {
    return makeError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity was not found.",
      { opportunityId }
    );
  }

  if (!isValidOptionalTitleInput(title)) {
    return makeError(
      "TASK_TITLE_INVALID",
      "Task title must be a meaningful string when provided.",
      { field: "title" }
    );
  }

  if (!validatePriority(priority)) {
    return makeError(
      "INVALID_PRIORITY",
      "Task priority is invalid.",
      { field: "priority" }
    );
  }

  const taskTitle =
    normalizeText(title) ||
    `Follow up — ${
      opportunity.business_name ||
      "opportunity"
    }`;

  if (containsObjectString(taskTitle)) {
    return makeError(
      "TASK_TITLE_INVALID",
      "Task title must be a meaningful string.",
      { field: "title" }
    );
  }

  const taskResult =
    createTaskOnce({
      opportunityId,
      title: taskTitle,
      description:
        "Follow up on opportunity after stale-risk detection.",
      priority,
      actionType: "FOLLOW_UP"
    });

  const activityResult =
    createActivityOnce({
      opportunityId,
      type: "FOLLOW_UP_CREATED",
      description:
        `Follow-up task created: ${taskResult.task.title}`,
      actionKey:
        `task:FOLLOW_UP:${opportunityId}:${normalizeKey(taskResult.task.title)}`,
      actionType: "FOLLOW_UP",
      semanticTitle:
        taskResult.task.title,
      metadata: {
        task_id: taskResult.task.id,
        task_title:
          taskResult.task.title,
        priority:
          taskResult.task.priority,
        action_type: "FOLLOW_UP"
      }
    });

  return responseFor(
    opportunityId,
    {
      task: taskResult.task,
      duplicate:
        !taskResult.created,
      activity:
        activityResult.activity,
      task_created:
        taskResult.created,
      activity_created:
        activityResult.created
    }
  );
}

function createNextActionTask({
  opportunityId,
  title,
  priority = "MEDIUM",
  actionType
}) {
  const opportunity =
    findOpportunity(opportunityId);

  if (!opportunity) {
    return makeError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity was not found.",
      { opportunityId }
    );
  }

  const intelligenceResult =
    getOpportunityIntelligence(
      opportunityId
    );

  const nextBestAction =
    intelligenceResult.intelligence
      ?.next_best_action;

  const resolvedActionType =
    actionType;

  if (
    !NEXT_ACTION_TYPES.includes(
      resolvedActionType
    )
  ) {
    return makeError(
      "INVALID_ACTION_TYPE",
      "A valid explicit next-best-action type is required.",
      {
        field: "actionType",
        allowed: NEXT_ACTION_TYPES
      }
    );
  }

  if (!isValidOptionalTitleInput(title)) {
    return makeError(
      "TASK_TITLE_INVALID",
      "Task title must be a meaningful string when provided.",
      { field: "title" }
    );
  }

  if (!validatePriority(priority)) {
    return makeError(
      "INVALID_PRIORITY",
      "Task priority is invalid.",
      { field: "priority" }
    );
  }

  const taskTitle =
    normalizeText(title) ||
    normalizeText(
      nextBestAction?.taskTitle
    ) ||
    normalizeText(
      opportunity.next_action
    ) ||
    `Next action — ${
      opportunity.business_name ||
      "opportunity"
    }`;

  if (containsObjectString(taskTitle)) {
    return makeError(
      "TASK_TITLE_INVALID",
      "Task title must be a meaningful string.",
      { field: "title" }
    );
  }

  if (!taskTitle) {
    return makeError(
      "TASK_TITLE_REQUIRED",
      "Task title is required.",
      { field: "title" }
    );
  }

  const taskResult =
    createTaskOnce({
      opportunityId,
      title: taskTitle,
      description:
        "Task created from Deal Intelligence.",
      priority,
      actionType: resolvedActionType
    });

  if (
    resolvedActionType ===
      "CREATE_TASK" &&
    normalizeKey(
      opportunity.next_action
    ) !==
      normalizeKey(taskResult.task.title)
  ) {
    saveOpportunity({
      ...opportunity,
      next_action:
        taskResult.task.title
    });
  }

  const activityResult =
    createActivityOnce({
      opportunityId,
      type: "INTELLIGENCE_TASK_CREATED",
      description:
        `Intelligence task created: ${taskResult.task.title}`,
      actionKey:
        `task:${resolvedActionType}:${opportunityId}:${normalizeKey(taskResult.task.title)}`,
      actionType:
        resolvedActionType,
      semanticTitle:
        taskResult.task.title,
      metadata: {
        task_id: taskResult.task.id,
        task_title:
          taskResult.task.title,
        priority:
          taskResult.task.priority,
        action_type:
          resolvedActionType
      }
    });

  return responseFor(
    opportunityId,
    {
      task: taskResult.task,
      action_type:
        resolvedActionType,
      duplicate:
        !taskResult.created,
      activity:
        activityResult.activity,
      task_created:
        taskResult.created,
      activity_created:
        activityResult.created
    }
  );
}

module.exports = {
  addContact,
  setValue,
  createFollowUp,
  createNextActionTask
};
