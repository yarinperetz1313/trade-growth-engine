const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "tge-revenue-actions-")
);

process.env.LOCAL_STORE_DIR = tempDir;

const { app } = require("../src/app/server");
const {
  readCollection,
  writeCollection
} = require("../src/services/localStore");

const staleAt = "2026-07-01T00:00:00.000Z";

function baseOpportunity(id, overrides = {}) {
  return {
    id,
    business_name: `Trade ${id}`,
    stage: "PROPOSAL",
    priority: "HIGH",
    qualification_score: 82,
    value: 42000,
    probability: 0.75,
    weighted_value: 31500,
    next_action: "Follow up on proposal",
    contact_name: "Ava Wilson",
    ...overrides
  };
}

function seedStore({
  opportunities = [baseOpportunity("opp-follow")],
  prospects = [],
  activities,
  tasks = []
} = {}) {
  const defaultActivities = opportunities.map(item => ({
    id: `activity-${item.id}`,
    opportunity_id: item.id,
    type: "OPPORTUNITY_CREATED",
    description: "Opportunity created",
    created_at: staleAt,
    updated_at: staleAt,
    metadata: { source: "test" }
  }));

  writeCollection("prospects", prospects);
  writeCollection("opportunities", opportunities);
  writeCollection(
    "activities",
    activities === undefined ? defaultActivities : activities
  );
  writeCollection("tasks", tasks);
  writeCollection("revenue_actions", []);
}

async function withServer(seed, fn) {
  seedStore(seed);
  const server = app.listen(0);

  try {
    await new Promise(resolve => server.once("listening", resolve));
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  return {
    status: response.status,
    data: await response.json()
  };
}

async function createAction(baseUrl, opportunityId = "opp-follow") {
  return request(
    baseUrl,
    "POST",
    `/api/opportunities/${opportunityId}/revenue-actions`,
    {}
  );
}

async function transition(baseUrl, actionId, name, body = {}) {
  return request(
    baseUrl,
    "POST",
    `/api/revenue-actions/${actionId}/${name}`,
    body
  );
}

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("materializes a durable semantic recommendation snapshot and reuses its active duplicate", async () => {
  await withServer({}, async baseUrl => {
    const first = await createAction(baseUrl);
    const second = await createAction(baseUrl);

    assert.equal(first.status, 201);
    assert.equal(first.data.ok, true);
    assert.equal(first.data.duplicate, false);
    assert.equal(first.data.data.action_type, "FOLLOW_UP");
    assert.equal(first.data.data.execution_type, "COMMUNICATION_DRAFT");
    assert.equal(first.data.data.approval_requirement, "HUMAN");
    assert.equal(first.data.data.status, "RECOMMENDED");
    assert.equal(first.data.data.source, "DEAL_INTELLIGENCE");
    assert.equal(first.data.data.evidence.factual.stage, "PROPOSAL");
    assert.equal(first.data.data.evidence.factual.commercial_value.amount, 42000);
    assert.equal(
      first.data.data.recommendation_snapshot.action_type,
      "FOLLOW_UP"
    );
    assert.ok(first.data.data.recommendation_snapshot.generated_at);
    assert.match(first.data.data.basis_fingerprint, /^[a-f0-9]{64}$/);

    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(second.data.data.id, first.data.data.id);
    assert.equal(readCollection("revenue_actions").length, 1);
  });
});

test("prepares a deterministic email draft without fabricating unknown CRM evidence", async () => {
  await withServer({
    opportunities: [
      baseOpportunity("opp-follow", {
        value: 0,
        weighted_value: 0,
        service: null,
        location: null
      })
    ]
  }, async baseUrl => {
    const created = await createAction(baseUrl);
    const prepared = await transition(
      baseUrl,
      created.data.data.id,
      "prepare"
    );

    assert.equal(prepared.status, 200);
    assert.equal(prepared.data.data.status, "PREPARED");
    assert.equal(
      prepared.data.data.proposed_execution.type,
      "COMMUNICATION_DRAFT"
    );
    assert.equal(prepared.data.data.proposed_execution.channel, "EMAIL");
    assert.match(prepared.data.data.proposed_execution.body, /Ava Wilson/);
    assert.doesNotMatch(
      prepared.data.data.proposed_execution.body,
      /\$0|42,000|undefined|null|commercial plumbing/i
    );
    assert.equal(
      prepared.data.data.evidence.factual.commercial_value.known,
      false
    );
    assert.equal(
      prepared.data.data.evidence.factual.commercial_value.amount,
      null
    );

    const replay = await transition(
      baseUrl,
      created.data.data.id,
      "prepare"
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.data.duplicate, true);
    assert.deepEqual(
      replay.data.data.proposed_execution,
      prepared.data.data.proposed_execution
    );
  });
});

test("enforces lifecycle transitions and preserves rejection history", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const actionId = created.data.data.id;

    const earlyExecute = await transition(
      baseUrl,
      actionId,
      "execute",
      { executionMode: "MANUAL_CONFIRMED" }
    );
    assert.equal(earlyExecute.status, 409);
    assert.equal(earlyExecute.data.error, "INVALID_REVENUE_ACTION_TRANSITION");
    assert.equal(readCollection("activities").length, 1);
    assert.equal(readCollection("revenue_actions")[0].status, "RECOMMENDED");

    await transition(baseUrl, actionId, "prepare");
    const rejected = await transition(
      baseUrl,
      actionId,
      "reject",
      { reason: "Timing is not appropriate." }
    );
    assert.equal(rejected.status, 200);
    assert.equal(rejected.data.data.status, "REJECTED");
    assert.equal(rejected.data.data.rejection_reason, "Timing is not appropriate.");
    assert.ok(rejected.data.data.rejected_at);
    assert.deepEqual(rejected.data.data.audit.at(-1), {
      transition: "REJECTED",
      at: rejected.data.data.rejected_at,
      reason: "Timing is not appropriate."
    });

    const approveRejected = await transition(
      baseUrl,
      actionId,
      "approve"
    );
    assert.equal(approveRejected.status, 409);
    assert.equal(approveRejected.data.error, "INVALID_REVENUE_ACTION_TRANSITION");
  });
});

test("requires approval and records manual-confirmed communication without claiming automated sending", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const actionId = created.data.data.id;
    await transition(baseUrl, actionId, "prepare");

    const unapproved = await transition(
      baseUrl,
      actionId,
      "execute",
      { executionMode: "MANUAL_CONFIRMED" }
    );
    assert.equal(unapproved.status, 409);

    const approved = await transition(baseUrl, actionId, "approve");
    assert.equal(approved.data.data.status, "APPROVED");
    assert.ok(approved.data.data.approved_at);
    assert.deepEqual(approved.data.data.audit.at(-1), {
      transition: "APPROVED",
      at: approved.data.data.approved_at,
      approval: "HUMAN"
    });

    const missingMode = await transition(baseUrl, actionId, "execute");
    assert.equal(missingMode.status, 400);
    assert.equal(missingMode.data.error, "MANUAL_CONFIRMATION_REQUIRED");

    const executed = await transition(
      baseUrl,
      actionId,
      "execute",
      { executionMode: "MANUAL_CONFIRMED" }
    );
    assert.equal(executed.status, 200);
    assert.equal(executed.data.data.status, "EXECUTED");
    assert.equal(executed.data.data.execution_result.mode, "MANUAL_CONFIRMED");
    assert.equal(executed.data.data.execution_result.external_send_performed, false);
    assert.ok(executed.data.data.resulting_activity_id);
    assert.equal(executed.data.data.resulting_task_id, null);
    assert.equal(executed.data.refreshed.opportunity_intelligence.opportunity_id, "opp-follow");
    assert.ok(executed.data.refreshed.pipeline_metrics);
    assert.ok(executed.data.refreshed.revenue_intelligence.generated_at);

    const activity = readCollection("activities").find(
      item => item.id === executed.data.data.resulting_activity_id
    );
    assert.equal(activity.type, "REVENUE_ACTION_MANUALLY_CONFIRMED");
    assert.equal(activity.metadata.revenue_action_id, actionId);
    assert.equal(activity.metadata.execution_mode, "MANUAL_CONFIRMED");
    assert.doesNotMatch(activity.description, /sent by TGE|automatically sent/i);

    const replay = await transition(
      baseUrl,
      actionId,
      "execute",
      { executionMode: "MANUAL_CONFIRMED" }
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.data.duplicate, true);
    assert.equal(readCollection("activities").length, 2);
  });
});

test("rejects stale approved execution before creating CRM side effects", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const actionId = created.data.data.id;
    await transition(baseUrl, actionId, "prepare");
    await transition(baseUrl, actionId, "approve");

    const opportunities = readCollection("opportunities");
    opportunities[0].stage = "MEETING";
    opportunities[0].probability = 0.6;
    opportunities[0].weighted_value = 25200;
    writeCollection("opportunities", opportunities);

    const result = await transition(
      baseUrl,
      actionId,
      "execute",
      { executionMode: "MANUAL_CONFIRMED" }
    );

    assert.equal(result.status, 409);
    assert.equal(result.data.error, "REVENUE_ACTION_STALE");
    assert.equal(readCollection("activities").length, 1);
    assert.equal(readCollection("tasks").length, 0);
    assert.equal(readCollection("revenue_actions")[0].status, "CANCELLED");
    assert.equal(
      readCollection("revenue_actions")[0].audit.at(-1).transition,
      "SUPERSEDED_AS_STALE"
    );
  });
});

test("prepares and executes one linked internal task with replay-safe activity", async () => {
  await withServer({
    opportunities: [
      baseOpportunity("opp-task", {
        stage: "NEW",
        value: 0,
        probability: 0.1,
        weighted_value: 0,
        next_action: "",
        contact_name: null
      })
    ],
    activities: []
  }, async baseUrl => {
    const created = await createAction(baseUrl, "opp-task");
    assert.equal(created.data.data.action_type, "CREATE_TASK");
    assert.equal(created.data.data.execution_type, "INTERNAL_TASK");

    const prepared = await transition(
      baseUrl,
      created.data.data.id,
      "prepare"
    );
    assert.equal(prepared.data.data.proposed_execution.type, "INTERNAL_TASK");
    assert.equal(prepared.data.data.proposed_execution.due_at, null);

    await transition(baseUrl, created.data.data.id, "approve");
    const executed = await transition(
      baseUrl,
      created.data.data.id,
      "execute"
    );

    assert.equal(executed.status, 200);
    assert.equal(executed.data.data.status, "EXECUTED");
    assert.ok(executed.data.data.resulting_task_id);
    assert.ok(executed.data.data.resulting_activity_id);
    assert.equal(readCollection("tasks").length, 1);
    assert.equal(readCollection("activities").length, 1);
    assert.equal(
      readCollection("tasks")[0].metadata.revenue_action_id,
      created.data.data.id
    );
    assert.equal(
      readCollection("activities")[0].metadata.revenue_action_id,
      created.data.data.id
    );
    assert.notEqual(
      executed.data.refreshed.opportunity_intelligence.next_best_action.type,
      "CREATE_TASK"
    );

    const replay = await transition(
      baseUrl,
      created.data.data.id,
      "execute"
    );
    assert.equal(replay.data.duplicate, true);
    assert.equal(readCollection("tasks").length, 1);
    assert.equal(readCollection("activities").length, 1);
  });
});

test("an executed historical action does not block a later legitimate recommendation", async () => {
  await withServer({
    opportunities: [
      baseOpportunity("opp-task", {
        stage: "NEW",
        value: 0,
        probability: 0.1,
        weighted_value: 0,
        next_action: ""
      })
    ],
    activities: []
  }, async baseUrl => {
    const first = await createAction(baseUrl, "opp-task");
    await transition(baseUrl, first.data.data.id, "prepare");
    await transition(baseUrl, first.data.data.id, "approve");
    await transition(baseUrl, first.data.data.id, "execute");

    const opportunities = readCollection("opportunities");
    opportunities[0].next_action = "";
    opportunities[0].updated_at = "2026-08-29T00:00:00.000Z";
    writeCollection("opportunities", opportunities);

    const tasks = readCollection("tasks");
    tasks[0].status = "COMPLETED";
    tasks[0].completed_at = "2026-08-29T00:00:00.000Z";
    writeCollection("tasks", tasks);

    const second = await createAction(baseUrl, "opp-task");
    assert.equal(second.status, 201);
    assert.equal(second.data.duplicate, false);
    assert.notEqual(second.data.data.id, first.data.data.id);
    assert.equal(readCollection("revenue_actions").length, 2);
  });
});

test("lists and retrieves opportunity action history with structured not-found and malformed errors", async () => {
  await withServer({}, async baseUrl => {
    const missingOpportunity = await createAction(baseUrl, "missing");
    assert.equal(missingOpportunity.status, 404);
    assert.equal(missingOpportunity.data.error, "OPPORTUNITY_NOT_FOUND");

    const created = await createAction(baseUrl);
    const list = await request(
      baseUrl,
      "GET",
      "/api/revenue-actions?opportunity_id=opp-follow"
    );
    assert.equal(list.status, 200);
    assert.equal(list.data.count, 1);

    const get = await request(
      baseUrl,
      "GET",
      `/api/revenue-actions/${created.data.data.id}`
    );
    assert.equal(get.status, 200);
    assert.equal(get.data.data.id, created.data.data.id);

    const missing = await request(
      baseUrl,
      "GET",
      "/api/revenue-actions/missing"
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, "REVENUE_ACTION_NOT_FOUND");

    const malformedReject = await transition(
      baseUrl,
      created.data.data.id,
      "reject",
      { reason: { invalid: true } }
    );
    assert.equal(malformedReject.status, 400);
    assert.equal(malformedReject.data.error, "INVALID_REQUEST_BODY");
  });
});


test("rejects stale preparation and closed opportunity materialization without creating active actions", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const opportunities = readCollection("opportunities");
    opportunities[0].stage = "MEETING";
    opportunities[0].probability = 0.6;
    opportunities[0].weighted_value = 25200;
    writeCollection("opportunities", opportunities);

    const stale = await transition(baseUrl, created.data.data.id, "prepare");
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error, "REVENUE_ACTION_STALE");
    assert.equal(readCollection("revenue_actions")[0].status, "CANCELLED");

    opportunities[0].stage = "WON";
    writeCollection("opportunities", opportunities);
    const closed = await createAction(baseUrl);
    assert.equal(closed.status, 409);
    assert.equal(closed.data.error, "REVENUE_ACTION_OPPORTUNITY_CLOSED");
    assert.equal(readCollection("revenue_actions").length, 1);
  });
});

test("rejects a FAILED retry when fresh CRM evidence supersedes its recommendation", async () => {
  await withServer({
    opportunities: [baseOpportunity("opp-task", {
      stage: "NEW", value: 0, probability: 0.1, weighted_value: 0,
      next_action: "", contact_name: null
    })],
    activities: []
  }, async baseUrl => {
    const created = await createAction(baseUrl, "opp-task");
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");
    await transition(baseUrl, id, "approve");
    const actions = readCollection("revenue_actions");
    actions[0].status = "FAILED";
    actions[0].execution_request = { mode: "SYSTEM_INTERNAL" };
    writeCollection("revenue_actions", actions);

    const proposal = actions[0].proposed_execution;
    writeCollection("tasks", [{
      id: "partial-own-task",
      opportunity_id: "opp-task",
      title: proposal.title,
      description: proposal.description,
      priority: proposal.priority,
      due_at: null,
      status: "OPEN",
      created_at: staleAt,
      updated_at: staleAt,
      metadata: {
        source: "revenue_action",
        revenue_action_id: id,
        action_type: actions[0].action_type,
        execution_effect_type: "INTERNAL_TASK",
        normalized_title: proposal.normalized_title,
        semantic_task_key: proposal.semantic_task_key
      }
    }]);

    const opportunities = readCollection("opportunities");
    opportunities[0].stage = "MEETING";
    opportunities[0].probability = 0.6;
    opportunities[0].weighted_value = 25200;
    writeCollection("opportunities", opportunities);

    const retried = await transition(baseUrl, id, "execute");
    assert.equal(retried.status, 409);
    assert.equal(retried.data.error, "REVENUE_ACTION_STALE");
    assert.equal(readCollection("activities").length, 0);
    assert.equal(readCollection("tasks").length, 1);
    assert.equal(readCollection("revenue_actions")[0].status, "CANCELLED");
  });
});

test("uses structured task identity and never relinks an arbitrary same-title task", async () => {
  await withServer({
    opportunities: [baseOpportunity("opp-task", {
      stage: "NEW", value: 0, probability: 0.1, weighted_value: 0,
      next_action: "", contact_name: null
    })],
    activities: []
  }, async baseUrl => {
    const created = await createAction(baseUrl, "opp-task");
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");
    const proposal = readCollection("revenue_actions")[0].proposed_execution;
    writeCollection("tasks", [{
      id: "legacy-open-task", opportunity_id: "opp-task", title: proposal.title,
      description: "legacy", priority: proposal.priority, due_at: null,
      status: "OPEN", created_at: staleAt, updated_at: staleAt, metadata: {}
    }]);
    await transition(baseUrl, id, "approve");
    const executed = await transition(baseUrl, id, "execute");
    assert.equal(executed.status, 200);
    assert.equal(executed.data.data.execution_result.outcome, "TASK_CREATED");
    assert.equal(readCollection("tasks").length, 2);
    assert.equal(readCollection("tasks")[0].metadata.revenue_action_id, undefined);
    assert.equal(readCollection("tasks")[1].metadata.revenue_action_id, id);
  });
});

test("reuses only an explicitly identified intelligence task and records truthful activity", async () => {
  await withServer({
    opportunities: [baseOpportunity("opp-task", {
      stage: "NEW", value: 0, probability: 0.1, weighted_value: 0,
      next_action: "", contact_name: null
    })],
    activities: []
  }, async baseUrl => {
    const created = await createAction(baseUrl, "opp-task");
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");
    const action = readCollection("revenue_actions")[0];
    const proposal = action.proposed_execution;
    writeCollection("tasks", [{
      id: "identified-intelligence-task",
      opportunity_id: "opp-task",
      title: "Display text may differ",
      description: "legacy",
      priority: proposal.priority,
      due_at: null,
      status: "OPEN",
      created_at: staleAt,
      updated_at: staleAt,
      metadata: {
        source: "deal_intelligence",
        action_type: action.action_type,
        normalized_title: proposal.title.trim().replace(/\s+/g, " ").toLowerCase()
      }
    }]);
    await transition(baseUrl, id, "approve");
    const executed = await transition(baseUrl, id, "execute");
    assert.equal(executed.status, 200);
    assert.equal(executed.data.data.execution_result.outcome, "TASK_REUSED");
    assert.equal(readCollection("tasks").length, 1);
    assert.equal(readCollection("tasks")[0].metadata.revenue_action_id, id);
    assert.match(readCollection("activities")[0].description, /reused internal task/i);
  });
});

test("reconciliation requires approval, execution mode, and exact linked effects", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");

    const actions = readCollection("revenue_actions");
    actions[0].status = "EXECUTING";
    actions[0].execution_request = { mode: "MANUAL_CONFIRMED" };
    writeCollection("revenue_actions", actions);
    writeCollection("activities", [{
      id: "unapproved-effect",
      opportunity_id: "opp-follow",
      type: "REVENUE_ACTION_MANUALLY_CONFIRMED",
      description: "Unapproved effect",
      created_at: staleAt,
      updated_at: staleAt,
      metadata: {
        source: "revenue_action",
        revenue_action_id: id,
        action_type: actions[0].action_type,
        execution_effect_type: "COMMUNICATION_MANUAL_CONFIRMATION",
        execution_mode: "MANUAL_CONFIRMED",
        channel: "EMAIL"
      }
    }]);

    const unapproved = await transition(baseUrl, id, "execute", {
      executionMode: "MANUAL_CONFIRMED"
    });
    assert.equal(unapproved.status, 409);
    assert.equal(unapproved.data.error, "INVALID_REVENUE_ACTION_TRANSITION");
    assert.equal(readCollection("revenue_actions")[0].status, "EXECUTING");

    const approved = readCollection("revenue_actions");
    approved[0].approved_at = staleAt;
    approved[0].execution_request = { mode: "SYSTEM_INTERNAL" };
    writeCollection("revenue_actions", approved);

    const wrongMode = await transition(baseUrl, id, "execute", {
      executionMode: "MANUAL_CONFIRMED"
    });
    assert.equal(wrongMode.status, 409);
    assert.equal(wrongMode.data.error, "INVALID_REVENUE_ACTION_TRANSITION");

    const correctMode = readCollection("revenue_actions");
    correctMode[0].execution_request = { mode: "MANUAL_CONFIRMED" };
    writeCollection("revenue_actions", correctMode);
    const activities = readCollection("activities");
    activities[0].opportunity_id = "another-opportunity";
    writeCollection("activities", activities);

    const unrelated = await transition(baseUrl, id, "execute", {
      executionMode: "MANUAL_CONFIRMED"
    });
    assert.equal(unrelated.status, 409);
    assert.equal(unrelated.data.error, "REVENUE_ACTION_EFFECT_CONFLICT");
    assert.equal(readCollection("revenue_actions")[0].status, "EXECUTING");
  });
});

test("reconciles exact FAILED effects before stale detection and recovers partial effects", async () => {
  await withServer({
    opportunities: [baseOpportunity("opp-task", {
      stage: "NEW", value: 0, probability: 0.1, weighted_value: 0,
      next_action: "", contact_name: null
    })],
    activities: []
  }, async baseUrl => {
    const created = await createAction(baseUrl, "opp-task");
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");
    await transition(baseUrl, id, "approve");
    const actions = readCollection("revenue_actions");
    actions[0].status = "FAILED";
    actions[0].execution_request = { mode: "SYSTEM_INTERNAL" };
    writeCollection("revenue_actions", actions);

    const action = actions[0];
    const task = {
      id: "exact-linked-task",
      opportunity_id: "opp-task",
      title: action.proposed_execution.title,
      description: action.proposed_execution.description,
      priority: action.proposed_execution.priority,
      due_at: null,
      status: "OPEN",
      created_at: staleAt,
      updated_at: staleAt,
      metadata: {
        source: "revenue_action",
        revenue_action_id: id,
        action_type: action.action_type,
        execution_effect_type: "INTERNAL_TASK",
        normalized_title: action.proposed_execution.normalized_title,
        semantic_task_key: action.proposed_execution.semantic_task_key
      }
    };
    writeCollection("tasks", [task]);

    const partialRecovery = await transition(baseUrl, id, "execute");
    assert.equal(partialRecovery.status, 200);
    assert.equal(partialRecovery.data.data.status, "EXECUTED");
    assert.equal(readCollection("tasks").length, 1);
    assert.equal(readCollection("activities").length, 1);
    assert.equal(readCollection("activities")[0].metadata.task_id, task.id);

    const persisted = readCollection("revenue_actions");
    persisted[0].status = "FAILED";
    persisted[0].executed_at = null;
    persisted[0].execution_result = {
      mode: "SYSTEM_INTERNAL",
      outcome: "FAILED",
      external_send_performed: false
    };
    writeCollection("revenue_actions", persisted);

    const exactRecovery = await transition(baseUrl, id, "execute");
    assert.equal(exactRecovery.status, 200);
    assert.equal(exactRecovery.data.data.status, "EXECUTED");
    assert.equal(exactRecovery.data.data.execution_result.outcome, "RECOVERED_LINKED_EFFECTS");
    assert.equal(readCollection("tasks").length, 1);
    assert.equal(readCollection("activities").length, 1);
  });
});

test("repairs the intended opportunity next action before finalizing CREATE_TASK recovery", async () => {
  await withServer({
    opportunities: [baseOpportunity("opp-task", {
      stage: "NEW", value: 0, probability: 0.1, weighted_value: 0,
      next_action: "", contact_name: null
    })],
    activities: []
  }, async baseUrl => {
    const created = await createAction(baseUrl, "opp-task");
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");
    await transition(baseUrl, id, "approve");

    const actions = readCollection("revenue_actions");
    const action = actions[0];
    action.status = "FAILED";
    action.execution_request = { mode: "SYSTEM_INTERNAL" };
    writeCollection("revenue_actions", actions);

    const proposal = action.proposed_execution;
    const normalizedTitle = proposal.title.trim().replace(/\s+/g, " ").toLowerCase();
    const semanticTaskKey = [action.opportunity_id, action.action_type, normalizedTitle].join(":");
    const task = {
      id: "recovery-task",
      opportunity_id: action.opportunity_id,
      title: proposal.title,
      description: proposal.description,
      priority: proposal.priority,
      due_at: proposal.due_at,
      status: "OPEN",
      created_at: staleAt,
      updated_at: staleAt,
      metadata: {
        source: "revenue_action",
        revenue_action_id: id,
        action_type: action.action_type,
        execution_effect_type: "INTERNAL_TASK",
        normalized_title: normalizedTitle,
        semantic_task_key: semanticTaskKey
      }
    };
    writeCollection("tasks", [task]);
    writeCollection("activities", [{
      id: "recovery-activity",
      opportunity_id: action.opportunity_id,
      type: "REVENUE_ACTION_TASK_EXECUTED",
      description: "Task execution recorded",
      created_at: staleAt,
      updated_at: staleAt,
      metadata: {
        source: "revenue_action",
        revenue_action_id: id,
        action_type: action.action_type,
        execution_effect_type: "INTERNAL_TASK",
        execution_mode: "SYSTEM_INTERNAL",
        task_id: task.id
      }
    }]);

    const recovered = await transition(baseUrl, id, "execute");

    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.data.status, "EXECUTED");
    assert.equal(readCollection("opportunities")[0].next_action, proposal.title);
    assert.notEqual(
      recovered.data.refreshed.opportunity_intelligence.next_best_action.type,
      "CREATE_TASK"
    );
    assert.equal(readCollection("tasks").length, 1);
    assert.equal(readCollection("activities").length, 1);
  });
});

test("rejects a linked task whose structured identity differs from the prepared task", async () => {
  await withServer({
    opportunities: [baseOpportunity("opp-task", {
      stage: "NEW", value: 0, probability: 0.1, weighted_value: 0,
      next_action: "", contact_name: null
    })],
    activities: []
  }, async baseUrl => {
    const created = await createAction(baseUrl, "opp-task");
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");
    await transition(baseUrl, id, "approve");
    const actions = readCollection("revenue_actions");
    const action = actions[0];
    action.status = "FAILED";
    action.execution_request = { mode: "SYSTEM_INTERNAL" };
    writeCollection("revenue_actions", actions);
    writeCollection("tasks", [{
      id: "wrong-semantic-task",
      opportunity_id: action.opportunity_id,
      title: "Unrelated task",
      description: action.proposed_execution.description,
      priority: action.proposed_execution.priority,
      due_at: action.proposed_execution.due_at,
      status: "OPEN",
      created_at: staleAt,
      updated_at: staleAt,
      metadata: {
        source: "revenue_action",
        revenue_action_id: id,
        action_type: action.action_type,
        execution_effect_type: "INTERNAL_TASK",
        normalized_title: "unrelated task",
        semantic_task_key: `${action.opportunity_id}:${action.action_type}:unrelated task`
      }
    }]);

    const result = await transition(baseUrl, id, "execute");

    assert.equal(result.status, 409);
    assert.equal(result.data.error, "REVENUE_ACTION_EFFECT_CONFLICT");
    assert.equal(result.data.details.reason, "INVALID_LINKED_INTERNAL_EFFECT");
    assert.equal(readCollection("revenue_actions")[0].status, "FAILED");
    assert.equal(readCollection("activities").length, 0);
  });
});

test("supersedes a prepared action when deterministic evidence changes before approval", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");
    const opportunities = readCollection("opportunities");
    opportunities[0].stage = "MEETING";
    opportunities[0].probability = 0.6;
    opportunities[0].weighted_value = 25200;
    writeCollection("opportunities", opportunities);

    const approved = await transition(baseUrl, id, "approve");

    assert.equal(approved.status, 409);
    assert.equal(approved.data.error, "REVENUE_ACTION_STALE");
    const persisted = readCollection("revenue_actions")[0];
    assert.equal(persisted.status, "CANCELLED");
    assert.equal(persisted.approved_at, null);
    assert.equal(persisted.audit.at(-1).transition, "SUPERSEDED_AS_STALE");
  });
});

test("validates a prepared replay against a now-closed opportunity", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");

    const opportunities = readCollection("opportunities");
    opportunities[0].stage = "WON";
    writeCollection("opportunities", opportunities);

    const replay = await transition(baseUrl, id, "prepare");

    assert.equal(replay.status, 409);
    assert.equal(replay.data.error, "REVENUE_ACTION_OPPORTUNITY_CLOSED");
    const persisted = readCollection("revenue_actions")[0];
    assert.equal(persisted.status, "CANCELLED");
    assert.equal(
      persisted.audit.at(-1).transition,
      "SUPERSEDED_OPPORTUNITY_CLOSED"
    );
    assert.equal(persisted.audit.at(-1).operation, "PREPARE");
  });
});

test("validates an approved replay against changed deterministic evidence", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const id = created.data.data.id;
    await transition(baseUrl, id, "prepare");
    await transition(baseUrl, id, "approve");

    const opportunities = readCollection("opportunities");
    opportunities[0].value = 43000;
    opportunities[0].weighted_value = 32250;
    writeCollection("opportunities", opportunities);

    const replay = await transition(baseUrl, id, "approve");

    assert.equal(replay.status, 409);
    assert.equal(replay.data.error, "REVENUE_ACTION_STALE");
    const persisted = readCollection("revenue_actions")[0];
    assert.equal(persisted.status, "CANCELLED");
    assert.equal(
      persisted.audit.at(-1).transition,
      "SUPERSEDED_AS_STALE"
    );
  });
});

test("supersedes active advice when elapsed recommendation priority semantics drift", async () => {
  const day = 24 * 60 * 60 * 1000;
  const RealDate = global.Date;
  const baselineNow = RealDate.now();
  const activityAt = new RealDate(baselineNow - (8 * day)).toISOString();
  let currentTime = baselineNow;

  class ControlledDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [currentTime] : args));
    }

    static now() {
      return currentTime;
    }
  }

  try {
    global.Date = ControlledDate;
    await withServer({
      activities: [{
        id: "activity-priority-drift",
        opportunity_id: "opp-follow",
        type: "OPPORTUNITY_CREATED",
        description: "Opportunity created",
        created_at: activityAt,
        updated_at: activityAt,
        metadata: { source: "test" }
      }]
    }, async baseUrl => {
      const first = await createAction(baseUrl);
      assert.equal(first.status, 201);
      assert.equal(first.data.data.action_type, "FOLLOW_UP");
      assert.equal(first.data.data.priority, "MEDIUM");

      currentTime = baselineNow + (7 * day);
      const current = await createAction(baseUrl);

      assert.equal(current.status, 201);
      assert.equal(current.data.duplicate, false);
      assert.equal(current.data.data.action_type, "FOLLOW_UP");
      assert.equal(current.data.data.priority, "HIGH");
      assert.notEqual(current.data.data.id, first.data.data.id);
      const actions = readCollection("revenue_actions");
      const previous = actions.find(action => action.id === first.data.data.id);
      assert.equal(previous.status, "CANCELLED");
      assert.equal(
        previous.audit.at(-1).transition,
        "SUPERSEDED_BY_CURRENT_RECOMMENDATION"
      );
    });
  } finally {
    global.Date = RealDate;
  }
});

test("materializing a compatible duplicate supersedes mixed incompatible active records", async () => {
  await withServer({}, async baseUrl => {
    const compatible = await createAction(baseUrl);
    const compatibleAction = compatible.data.data;
    const incompatible = {
      ...compatibleAction,
      id: "incompatible-prepared-action",
      action_type: "CREATE_TASK",
      execution_type: "INTERNAL_TASK",
      status: "PREPARED",
      basis_fingerprint: "incompatible-current-recommendation",
      created_at: "2026-08-01T00:00:01.000Z",
      updated_at: "2026-08-01T00:00:01.000Z",
      prepared_at: "2026-08-01T00:00:01.000Z",
      proposed_execution: {
        type: "INTERNAL_TASK",
        title: "Define next action",
        normalized_title: "define next action",
        semantic_task_key: "opp-follow:CREATE_TASK:define next action",
        priority: "HIGH",
        due_at: null
      }
    };
    writeCollection("revenue_actions", [compatibleAction, incompatible]);

    const replay = await createAction(baseUrl);

    assert.equal(replay.status, 200);
    assert.equal(replay.data.duplicate, true);
    assert.equal(replay.data.data.id, compatibleAction.id);

    const actions = readCollection("revenue_actions");
    const superseded = actions.find(action => action.id === incompatible.id);
    assert.equal(superseded.status, "CANCELLED");
    assert.equal(
      superseded.audit.at(-1).transition,
      "SUPERSEDED_BY_CURRENT_RECOMMENDATION"
    );

    const listed = await request(
      baseUrl,
      "GET",
      "/api/revenue-actions?opportunity_id=opp-follow"
    );
    assert.equal(listed.status, 200);
    const active = listed.data.data.filter(action =>
      ["RECOMMENDED", "PREPARED", "APPROVED", "EXECUTING", "FAILED"].includes(action.status)
    );
    assert.deepEqual(active.map(action => action.id), [compatibleAction.id]);
  });
});

test("materializing current advice supersedes incompatible active records", async () => {
  await withServer({}, async baseUrl => {
    const first = await createAction(baseUrl);
    const opportunities = readCollection("opportunities");
    opportunities[0].value = 43000;
    opportunities[0].weighted_value = 32250;
    writeCollection("opportunities", opportunities);

    const second = await createAction(baseUrl);

    assert.equal(second.status, 201);
    assert.notEqual(second.data.data.id, first.data.data.id);
    const actions = readCollection("revenue_actions");
    const previous = actions.find(action => action.id === first.data.data.id);
    const current = actions.find(action => action.id === second.data.data.id);
    assert.equal(previous.status, "CANCELLED");
    assert.equal(
      previous.audit.at(-1).transition,
      "SUPERSEDED_BY_CURRENT_RECOMMENDATION"
    );
    assert.equal(previous.audit.at(-1).replacement_action_type, current.action_type);
    assert.equal(previous.audit.at(-1).replacement_fingerprint, current.basis_fingerprint);
    assert.equal(
      actions.filter(action => ["RECOMMENDED", "PREPARED", "APPROVED", "EXECUTING", "FAILED"].includes(action.status)).length,
      1
    );
  });
});

test("closed opportunities terminally supersede materialized active actions", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const id = created.data.data.id;
    const opportunities = readCollection("opportunities");
    opportunities[0].stage = "WON";
    writeCollection("opportunities", opportunities);

    const prepared = await transition(baseUrl, id, "prepare");
    assert.equal(prepared.status, 409);
    assert.equal(prepared.data.error, "REVENUE_ACTION_OPPORTUNITY_CLOSED");
    const persisted = readCollection("revenue_actions")[0];
    assert.equal(persisted.status, "CANCELLED");
    assert.equal(persisted.audit.at(-1).transition, "SUPERSEDED_OPPORTUNITY_CLOSED");
    assert.equal(persisted.audit.at(-1).stage, "WON");

    const reopened = readCollection("opportunities");
    reopened[0].stage = "PROPOSAL";
    writeCollection("opportunities", reopened);
    const second = await createAction(baseUrl);
    await transition(baseUrl, second.data.data.id, "prepare");
    await transition(baseUrl, second.data.data.id, "approve");
    const closedAgain = readCollection("opportunities");
    closedAgain[0].stage = "LOST";
    writeCollection("opportunities", closedAgain);

    const executed = await transition(
      baseUrl,
      second.data.data.id,
      "execute",
      { executionMode: "MANUAL_CONFIRMED" }
    );
    assert.equal(executed.status, 409);
    assert.equal(executed.data.error, "REVENUE_ACTION_OPPORTUNITY_CLOSED");
    const secondPersisted = readCollection("revenue_actions").find(
      action => action.id === second.data.data.id
    );
    assert.equal(secondPersisted.status, "CANCELLED");
    assert.equal(secondPersisted.audit.at(-1).operation, "EXECUTE");
    assert.equal(readCollection("activities").length, 1);
  });
});

test("returns stable malformed and bodyless mutation errors", async () => {
  await withServer({}, async baseUrl => {
    const created = await createAction(baseUrl);
    const raw = await fetch(`${baseUrl}/api/revenue-actions/${created.data.data.id}/prepare`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{"
    });
    assert.equal(raw.status, 400);
    assert.equal((await raw.json()).error, "INVALID_JSON_BODY");

    const arrayBody = await request(baseUrl, "POST", `/api/revenue-actions/${created.data.data.id}/prepare`, []);
    assert.equal(arrayBody.status, 400);
    assert.equal(arrayBody.data.error, "INVALID_REQUEST_BODY");

    const bodyless = await fetch(`${baseUrl}/api/revenue-actions/${created.data.data.id}/prepare`, { method: "POST" });
    assert.equal(bodyless.status, 200);
  });
});
