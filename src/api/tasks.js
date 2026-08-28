const express = require("express");

const {
  readCollection,
  createRecord,
  updateRecord,
  findRecord
} = require("../services/localStore");

const {
  createRecord: createActivity
} = require("../services/localStore");

const router = express.Router();

const TASK_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED"
];

const TASK_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT"
];


function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isMeaningfulString(value) {
  return (
    typeof value === "string" &&
    normalizeText(value).length > 0
  );
}

function isOptionalScalarText(value) {
  return (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number"
  );
}

function isValidDueInput(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return true;
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return false;
  }

  return Number.isFinite(
    new Date(value).getTime()
  );
}

function badRequest(res, error) {
  return res.status(400).json({
    ok: false,
    error
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function findDuplicateOpenTask(
  opportunityId,
  title
) {
  const normalized =
    normalizeTitle(title);

  return (
    readCollection("tasks")
      .find(
        task =>
          task.opportunity_id ===
            opportunityId &&
          task.status !==
            "COMPLETED" &&
          normalizeTitle(task.title) ===
            normalized
      ) || null
  );
}

function getTasksForOpportunity(
  opportunityId
) {
  return readCollection("tasks")
    .filter(
      task =>
        task.opportunity_id ===
        opportunityId
    )
    .sort(
      (a, b) =>
        new Date(a.created_at) -
        new Date(b.created_at)
    );
}

router.get("/api/tasks", (req, res) => {
  const tasks =
    readCollection("tasks");

  res.json({
    ok: true,
    data: tasks,
    count: tasks.length
  });
});

router.get(
  "/api/tasks/opportunity/:opportunityId",
  (req, res) => {
    const tasks =
      getTasksForOpportunity(
        req.params.opportunityId
      );

    res.json({
      ok: true,
      data: tasks,
      count: tasks.length
    });
  }
);

router.post("/api/tasks", (req, res) => {
  const body = req.body || {};
  const {
    opportunity_id,
    title,
    description = "",
    priority = "MEDIUM"
  } = body;
  const due_at =
    body.due_at !== undefined
      ? body.due_at
      : body.dueDate ?? null;

  if (!isMeaningfulString(opportunity_id)) {
    return badRequest(
      res,
      "opportunity_id is required"
    );
  }

  if (!isMeaningfulString(title)) {
    return badRequest(
      res,
      "title is required"
    );
  }

  if (!isOptionalScalarText(description)) {
    return badRequest(
      res,
      "Invalid task description"
    );
  }

  if (!isValidDueInput(due_at)) {
    return badRequest(
      res,
      "Invalid task due date"
    );
  }

  if (
    typeof priority !== "string" ||
    !TASK_PRIORITIES.includes(
      priority
    )
  ) {
    return badRequest(
      res,
      "Invalid task priority"
    );
  }

  const normalizedTitle =
    normalizeText(title);

  const duplicate =
    findDuplicateOpenTask(
      opportunity_id,
      normalizedTitle
    );

  if (duplicate) {
    return res.status(200).json({
      ok: true,
      data: duplicate,
      duplicate: true
    });
  }

  const task =
    createRecord("tasks", {
      opportunity_id:
        normalizeText(opportunity_id),
      title: normalizedTitle,
      description:
        normalizeText(description),
      due_at,
      priority,
      status: "OPEN",
      completed_at: null
    });

  createActivity(
    "activities",
    {
      opportunity_id:
        normalizeText(opportunity_id),
      type: "TASK_CREATED",
      description:
        `Task created: ${task.title}`,
      metadata: {
        task_id: task.id,
        priority: task.priority,
        action_key:
          `manual-task:${normalizeText(opportunity_id)}:${normalizeTitle(task.title)}`
      }
    }
  );

  res.status(201).json({
    ok: true,
    data: task,
    duplicate: false
  });
});

router.patch(
  "/api/tasks/:id",
  (req, res) => {
    const existing =
      findRecord(
        "tasks",
        req.params.id
      );

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "Task not found"
      });
    }

    const updates = {};
    const body = req.body || {};

    if (
      body.title !==
      undefined
    ) {
      if (!isMeaningfulString(body.title)) {
        return badRequest(
          res,
          "title is required"
        );
      }

      updates.title =
        normalizeText(body.title);
    }

    if (
      body.description !==
      undefined
    ) {
      if (!isOptionalScalarText(body.description)) {
        return badRequest(
          res,
          "Invalid task description"
        );
      }

      updates.description =
        normalizeText(body.description);
    }

    const dueInput =
      body.due_at !== undefined
        ? body.due_at
        : body.dueDate;

    if (dueInput !== undefined) {
      if (!isValidDueInput(dueInput)) {
        return badRequest(
          res,
          "Invalid task due date"
        );
      }

      updates.due_at =
        dueInput === ""
          ? null
          : dueInput;
    }

    if (
      body.priority !==
      undefined
    ) {
      if (
        typeof body.priority !== "string" ||
        !TASK_PRIORITIES.includes(
          body.priority
        )
      ) {
        return badRequest(
          res,
          "Invalid task priority"
        );
      }

      updates.priority =
        body.priority;
    }

    if (
      body.status !==
      undefined
    ) {
      if (
        !TASK_STATUSES.includes(
          body.status
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Invalid task status"
        });
      }

      updates.status =
        body.status;

      if (
        body.status ===
        "COMPLETED"
      ) {
        updates.completed_at =
          new Date().toISOString();
      } else if (
        existing.status ===
        "COMPLETED"
      ) {
        updates.completed_at =
          null;
      }
    }

    const task =
      updateRecord(
        "tasks",
        existing.id,
        updates
      );

    if (
      updates.status &&
      updates.status !==
        existing.status
    ) {
      createActivity(
        "activities",
        {
          opportunity_id:
            existing.opportunity_id,
          type:
            updates.status ===
            "COMPLETED"
              ? "TASK_COMPLETED"
              : "TASK_STATUS_CHANGED",
          description:
            updates.status ===
            "COMPLETED"
              ? `Task completed: ${existing.title}`
              : `Task moved to ${updates.status}: ${existing.title}`,
          metadata: {
            task_id: existing.id,
            from:
              existing.status,
            to:
              updates.status
          }
        }
      );
    }

    res.json({
      ok: true,
      data: task
    });
  }
);

module.exports = router;
