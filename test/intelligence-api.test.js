const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "tge-intelligence-"
  )
);

process.env.LOCAL_STORE_DIR = tempDir;

const { app } = require("../src/app/server");
const {
  writeCollection,
  readCollection
} = require("../src/services/localStore");

function seedStore() {
  writeCollection("prospects", [
    {
      id: "prospect-1",
      business_name: "Brightline Plumbing",
      service: "Commercial Plumbing",
      location: "Melbourne",
      website: "https://example.test"
    }
  ]);

  writeCollection("opportunities", [
    {
      id: "opp-1",
      prospect_id: "prospect-1",
      business_name: "Brightline Plumbing",
      stage: "QUALIFIED",
      qualification_score: 82,
      value: 0,
      probability: 0.2,
      weighted_value: 0,
      next_action: "Begin qualified outreach"
    },
    {
      id: "opp-no-action",
      business_name: "No Action Trade",
      stage: "NEW",
      qualification_score: 55,
      value: 0,
      probability: 0.1,
      weighted_value: 0,
      next_action: ""
    },
    {
      id: "opp-contact-j",
      business_name: "Historic Bad Contact",
      stage: "QUALIFIED",
      qualification_score: 60,
      value: 0,
      probability: 0.2,
      weighted_value: 0,
      contact_name: "j",
      next_action: "Call buyer"
    }
  ]);

  writeCollection("activities", []);
  writeCollection("tasks", []);
}

async function withServer(fn) {
  seedStore();

  const server = app.listen(0);

  try {
    await new Promise(resolve =>
      server.once("listening", resolve)
    );

    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    await fn(baseUrl);
  } finally {
    await new Promise(resolve =>
      server.close(resolve)
    );
  }
}

async function request(
  baseUrl,
  method,
  pathname,
  body
) {
  const response = await fetch(
    `${baseUrl}${pathname}`,
    {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body)
    }
  );

  const data = await response.json();

  return {
    status: response.status,
    data
  };
}

test.after(() => {
  fs.rmSync(tempDir, {
    recursive: true,
    force: true
  });
});

test("retrieves deterministic intelligence with unknown value semantics", async () => {
  await withServer(async baseUrl => {
    const result = await request(
      baseUrl,
      "GET",
      "/api/opportunities/opp-1/intelligence"
    );

    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(
      result.data.data.opportunity.id,
      "opp-1"
    );
    assert.equal(
      result.data.data.intelligence.score.commercial_potential,
      null
    );
    assert.match(
      result.data.data.intelligence.evidence.unknown.join("|"),
      /Commercial value known/
    );
    assert.equal(
      result.data.data.intelligence.next_best_action.type,
      "RESEARCH"
    );
  });
});

test("sets value from numeric primitives or strings, recalculates intelligence, weighted value, pipeline, and avoids duplicate value activity", async () => {
  await withServer(async baseUrl => {
    const first = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/value",
      { value: "12000" }
    );

    assert.equal(first.status, 200);
    assert.equal(first.data.ok, true);
    assert.equal(first.data.duplicate, false);
    assert.equal(first.data.opportunity.value, 12000);
    assert.equal(first.data.opportunity.weighted_value, 2400);
    assert.equal(
      first.data.intelligence.score.commercial_potential > 0,
      true
    );
    assert.equal(
      first.data.pipeline_metrics.weighted_pipeline_value,
      2400
    );

    const second = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/value",
      { value: 12000 }
    );

    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(
      readCollection("activities")
        .filter(item => item.type === "VALUE_UPDATED")
        .length,
      1
    );
  });
});

test("adds contact once and refreshes next-best action without duplicate activities", async () => {
  await withServer(async baseUrl => {
    const first = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/contact",
      { contactName: "Ava Wilson" }
    );

    assert.equal(first.status, 200);
    assert.equal(first.data.ok, true);
    assert.equal(first.data.opportunity.contact_name, "Ava Wilson");
    assert.equal(first.data.intelligence.resolved.contact_name, "Ava Wilson");
    assert.notEqual(first.data.intelligence.next_best_action.type, "RESEARCH");

    const second = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/contact",
      { contactName: " Ava   Wilson " }
    );

    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(
      readCollection("activities")
        .filter(item => item.type === "CONTACT_ADDED")
        .length,
      1
    );
  });
});

test("creates recommended task with explicit action semantics and protects duplicate tasks and activities", async () => {
  await withServer(async baseUrl => {
    const first = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-no-action/intelligence/task",
      {
        title: "Define next action — No Action Trade",
        priority: "HIGH",
        actionType: "CREATE_TASK"
      }
    );

    assert.equal(first.status, 200);
    assert.equal(first.data.ok, true);
    assert.equal(first.data.task_created, true);
    assert.equal(first.data.task.metadata.action_type, "CREATE_TASK");
    assert.equal(
      first.data.opportunity.next_action,
      "Define next action — No Action Trade"
    );
    assert.equal(
      first.data.opportunity.stage,
      "NEW"
    );
    assert.equal(
      first.data.intelligence.health.risks
        .some(item => item.type === "NO_NEXT_ACTION"),
      false
    );
    assert.notEqual(
      first.data.intelligence.next_best_action.type,
      "CREATE_TASK"
    );

    const second = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-no-action/intelligence/task",
      {
        title: " define next action — no action trade ",
        priority: "HIGH",
        actionType: "CREATE_TASK"
      }
    );

    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(second.data.task.id, first.data.task.id);
    assert.equal(
      readCollection("tasks")
        .filter(item => item.opportunity_id === "opp-no-action")
        .length,
      1
    );
    assert.equal(
      readCollection("activities")
        .filter(item => item.type === "INTELLIGENCE_TASK_CREATED")
        .length,
      1
    );
  });
});

test("creates follow-up once and returns refreshed activities, tasks, and next-best action", async () => {
  await withServer(async baseUrl => {
    const first = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/follow-up",
      {
        title: "Follow up — Brightline Plumbing",
        priority: "HIGH"
      }
    );

    assert.equal(first.status, 200);
    assert.equal(first.data.ok, true);
    assert.equal(first.data.task_created, true);
    assert.equal(first.data.intelligence.tasks.count, 1);
    assert.equal(first.data.intelligence.activity.count, 1);

    const second = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/follow-up",
      {
        title: "Follow up — Brightline Plumbing",
        priority: "HIGH"
      }
    );

    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(second.data.intelligence.tasks.count, 1);
    assert.equal(second.data.intelligence.activity.count, 1);
  });
});

test("rejects typed JSON payloads at intelligence mutation boundaries", async () => {
  await withServer(async baseUrl => {
    const objectContact = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/contact",
      { contactName: { first: "Ava", last: "Wilson" } }
    );

    assert.equal(objectContact.status, 400);
    assert.equal(objectContact.data.error, "CONTACT_NAME_INVALID");

    const booleanValue = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/value",
      { value: true }
    );

    assert.equal(booleanValue.status, 400);
    assert.equal(booleanValue.data.error, "INVALID_VALUE");

    const objectValue = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/value",
      { value: { amount: 12000 } }
    );

    assert.equal(objectValue.status, 400);
    assert.equal(objectValue.data.error, "INVALID_VALUE");

    const arrayValue = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/value",
      { value: [12000] }
    );

    assert.equal(arrayValue.status, 400);
    assert.equal(arrayValue.data.error, "INVALID_VALUE");

    const blankFollowUpTitle = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/follow-up",
      {
        title: "   ",
        priority: "HIGH"
      }
    );

    assert.equal(blankFollowUpTitle.status, 400);
    assert.equal(blankFollowUpTitle.data.error, "TASK_TITLE_INVALID");

    const nullTaskTitle = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/task",
      {
        title: null,
        priority: "MEDIUM",
        actionType: "ADVANCE"
      }
    );

    assert.equal(nullTaskTitle.status, 400);
    assert.equal(nullTaskTitle.data.error, "TASK_TITLE_INVALID");

    const objectTaskTitle = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/task",
      {
        title: { text: "Advance" },
        priority: "MEDIUM",
        actionType: "ADVANCE"
      }
    );

    assert.equal(objectTaskTitle.status, 400);
    assert.equal(objectTaskTitle.data.error, "TASK_TITLE_INVALID");

    const booleanPriority = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/follow-up",
      {
        title: "Follow up — Brightline Plumbing",
        priority: true
      }
    );

    assert.equal(booleanPriority.status, 400);
    assert.equal(booleanPriority.data.error, "INVALID_PRIORITY");
    assert.deepEqual(readCollection("tasks"), []);
    assert.deepEqual(readCollection("activities"), []);
  });
});

test("handles bodyless intelligence mutation requests through action validation", async () => {
  await withServer(async baseUrl => {
    const contact = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/contact"
    );

    assert.equal(contact.status, 400);
    assert.equal(contact.data.ok, false);
    assert.equal(contact.data.error, "CONTACT_NAME_INVALID");

    const value = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/value"
    );

    assert.equal(value.status, 400);
    assert.equal(value.data.ok, false);
    assert.equal(value.data.error, "INVALID_VALUE");

    const followUp = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/follow-up"
    );

    assert.equal(followUp.status, 400);
    assert.equal(followUp.data.ok, false);
    assert.equal(followUp.data.error, "INVALID_PRIORITY");

    const task = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/task"
    );

    assert.equal(task.status, 400);
    assert.equal(task.data.ok, false);
    assert.equal(task.data.error, "INVALID_ACTION_TYPE");
  });
});

test("Command Center delegates intelligence mutations through configured API helper and preserves inline action errors", () => {
  const component = fs.readFileSync(
    path.join(
      process.cwd(),
      "web/components/OpportunityCommandCenter.jsx"
    ),
    "utf8"
  );

  const api = fs.readFileSync(
    path.join(
      process.cwd(),
      "web/lib/api.js"
    ),
    "utf8"
  );

  assert.match(
    api,
    /import\.meta\.env\.VITE_API_URL/
  );
  assert.match(
    component,
    /runOpportunityIntelligenceAction\(/
  );
  assert.doesNotMatch(
    component,
    /fetch\(/
  );
  assert.doesNotMatch(
    component,
    /localhost:3000/
  );
  assert.doesNotMatch(
    component,
    /\.split\("\/intelligence\/"\)/
  );
  assert.match(
    component,
    /setActionError\(err\.message\)/
  );
  assert.match(
    component,
    /<strong>Action failed<\/strong>/
  );
});

test("rejects typed JSON payloads at task mutation boundaries", async () => {
  await withServer(async baseUrl => {
    const objectOpportunityId = await request(
      baseUrl,
      "POST",
      "/api/tasks",
      {
        opportunity_id: { id: "opp-1" },
        title: "Call buyer",
        priority: "MEDIUM"
      }
    );

    assert.equal(objectOpportunityId.status, 400);
    assert.equal(objectOpportunityId.data.error, "opportunity_id is required");

    const objectTitle = await request(
      baseUrl,
      "POST",
      "/api/tasks",
      {
        opportunity_id: "opp-1",
        title: { text: "Call buyer" },
        priority: "MEDIUM"
      }
    );

    assert.equal(objectTitle.status, 400);
    assert.equal(objectTitle.data.error, "title is required");

    const booleanTitle = await request(
      baseUrl,
      "POST",
      "/api/tasks",
      {
        opportunity_id: "opp-1",
        title: true,
        priority: "MEDIUM"
      }
    );

    assert.equal(booleanTitle.status, 400);
    assert.equal(booleanTitle.data.error, "title is required");

    const objectDueDate = await request(
      baseUrl,
      "POST",
      "/api/tasks",
      {
        opportunity_id: "opp-1",
        title: "Call buyer",
        dueDate: { date: "2026-09-01" },
        priority: "MEDIUM"
      }
    );

    assert.equal(objectDueDate.status, 400);
    assert.equal(objectDueDate.data.error, "Invalid task due date");

    const objectPriority = await request(
      baseUrl,
      "POST",
      "/api/tasks",
      {
        opportunity_id: "opp-1",
        title: "Call buyer",
        priority: { level: "HIGH" }
      }
    );

    assert.equal(objectPriority.status, 400);
    assert.equal(objectPriority.data.error, "Invalid task priority");
    assert.deepEqual(readCollection("tasks"), []);

    const created = await request(
      baseUrl,
      "POST",
      "/api/tasks",
      {
        opportunity_id: "opp-1",
        title: "Call buyer",
        priority: "MEDIUM"
      }
    );

    assert.equal(created.status, 201);

    const patchObjectTitle = await request(
      baseUrl,
      "PATCH",
      `/api/tasks/${created.data.data.id}`,
      { title: { text: "Renamed" } }
    );

    assert.equal(patchObjectTitle.status, 400);
    assert.equal(patchObjectTitle.data.error, "title is required");

    const patchObjectDueDate = await request(
      baseUrl,
      "PATCH",
      `/api/tasks/${created.data.data.id}`,
      { due_at: ["2026-09-01"] }
    );

    assert.equal(patchObjectDueDate.status, 400);
    assert.equal(patchObjectDueDate.data.error, "Invalid task due date");
    assert.equal(
      readCollection("tasks")[0].title,
      "Call buyer"
    );
  });
});

test("recognizes equivalent legacy task and activity records without metadata", async () => {
  await withServer(async baseUrl => {
    writeCollection("tasks", [
      {
        id: "legacy-task-1",
        opportunity_id: "opp-no-action",
        title: "Define next action — No Action Trade",
        description: "Legacy manually created task",
        due_at: null,
        priority: "HIGH",
        status: "OPEN",
        completed_at: null
      }
    ]);

    writeCollection("activities", [
      {
        id: "legacy-activity-1",
        opportunity_id: "opp-no-action",
        type: "INTELLIGENCE_TASK_CREATED",
        description: "Intelligence task created: Define next action — No Action Trade",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]);

    const first = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-no-action/intelligence/task",
      {
        title: " define next action — no action trade ",
        priority: "HIGH",
        actionType: "CREATE_TASK"
      }
    );

    assert.equal(first.status, 200);
    assert.equal(first.data.duplicate, true);
    assert.equal(first.data.task.id, "legacy-task-1");
    assert.equal(first.data.activity.id, "legacy-activity-1");

    const second = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-no-action/intelligence/task",
      {
        title: "Define next action — No Action Trade",
        priority: "HIGH",
        actionType: "CREATE_TASK"
      }
    );

    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(
      readCollection("tasks")
        .filter(item => item.opportunity_id === "opp-no-action")
        .length,
      1
    );
    assert.equal(
      readCollection("activities")
        .filter(item => item.opportunity_id === "opp-no-action")
        .length,
      1
    );
  });
});

test("treats historic single-letter contact j as unknown evidence without mutating data", async () => {
  await withServer(async baseUrl => {
    const result = await request(
      baseUrl,
      "GET",
      "/api/opportunities/opp-contact-j/intelligence"
    );

    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.data.intelligence.resolved.contact_name, null);
    assert.match(
      result.data.data.intelligence.evidence.unknown.join("|"),
      /Decision maker\/contact identified/
    );
    assert.equal(
      readCollection("opportunities")
        .find(item => item.id === "opp-contact-j")
        .contact_name,
      "j"
    );
  });
});

test("returns structured errors for unknown opportunity and invalid inputs", async () => {
  await withServer(async baseUrl => {
    const unknown = await request(
      baseUrl,
      "POST",
      "/api/opportunities/missing/intelligence/value",
      { value: 1000 }
    );

    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.ok, false);
    assert.equal(unknown.data.error, "OPPORTUNITY_NOT_FOUND");
    assert.equal(unknown.data.details.opportunityId, "missing");

    const invalidValue = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/value",
      { value: 0 }
    );

    assert.equal(invalidValue.status, 400);
    assert.equal(invalidValue.data.error, "INVALID_VALUE");

    const invalidContact = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/contact",
      { contactName: "Ava" }
    );

    assert.equal(invalidContact.status, 400);
    assert.equal(invalidContact.data.error, "CONTACT_NAME_INVALID");

    const missingAction = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/task",
      {
        title: "Whatever"
      }
    );

    assert.equal(missingAction.status, 400);
    assert.equal(missingAction.data.error, "INVALID_ACTION_TYPE");

    const invalidAction = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/task",
      {
        title: "Whatever",
        actionType: "made-up-action"
      }
    );

    assert.equal(invalidAction.status, 400);
    assert.equal(invalidAction.data.error, "INVALID_ACTION_TYPE");
  });
});

test("completes an end-to-end intelligence closed loop", async () => {
  await withServer(async baseUrl => {
    const before = await request(
      baseUrl,
      "GET",
      "/api/opportunities/opp-1/intelligence"
    );

    assert.equal(
      before.data.data.intelligence.health.status,
      "AT_RISK"
    );

    await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/value",
      { value: 18000 }
    );

    await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/contact",
      { contactName: "Chris Morgan" }
    );

    const task = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-1/intelligence/task",
      {
        title: "Advance qualified outreach",
        priority: "MEDIUM",
        actionType: "ADVANCE"
      }
    );

    assert.equal(task.data.ok, true);

    const after = await request(
      baseUrl,
      "GET",
      "/api/opportunities/opp-1/intelligence"
    );

    assert.equal(after.status, 200);
    assert.equal(after.data.data.opportunity.value, 18000);
    assert.equal(
      after.data.data.intelligence.resolved.contact_name,
      "Chris Morgan"
    );
    assert.equal(after.data.data.intelligence.tasks.open, 1);
    assert.equal(after.data.data.intelligence.activity.count, 3);
    assert.deepEqual(
      readCollection("tasks").map(item => item.title),
      ["Advance qualified outreach"]
    );
  });
});
