const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tge-legacy-json-"));
const fixtureDir = path.join(__dirname, "fixtures", "legacy-json-compat");

process.env.LOCAL_STORE_DIR = tempDir;

const { app } = require("../src/app/server");
const {
  createRecord,
  readCollection,
  readCollectionReadOnly,
  updateRecord,
  writeCollection
} = require("../src/services/localStore");
const {
  buildDealIntelligenceFromData
} = require("../src/intelligence/dealIntelligence");
const {
  buildRevenueIntelligence
} = require("../src/intelligence/revenueIntelligence");
const {
  calculatePipelineEconomics
} = require("../src/analytics/economicsEngine");

function readFixture(collection) {
  return JSON.parse(
    fs.readFileSync(path.join(fixtureDir, `${collection}.json`), "utf8")
  );
}

function seedLegacyFixture() {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  for (const collection of [
    "prospects",
    "opportunities",
    "activities",
    "tasks",
    "revenue_actions"
  ]) {
    fs.copyFileSync(
      path.join(fixtureDir, `${collection}.json`),
      path.join(tempDir, `${collection}.json`)
    );
  }
}

async function withServer(fn, prepareStore = null) {
  seedLegacyFixture();
  prepareStore?.();
  const server = app.listen(0);

  try {
    await new Promise(resolve => server.once("listening", resolve));
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  return { status: response.status, data: await response.json() };
}

async function transition(baseUrl, actionId, transitionName, body = {}) {
  return request(
    baseUrl,
    "POST",
    `/api/revenue-actions/${actionId}/${transitionName}`,
    body
  );
}

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("preserves legacy JSON record overrides and replacement collection writes", () => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  assert.deepEqual(readCollectionReadOnly("missing_compatibility"), []);
  assert.equal(
    fs.existsSync(path.join(tempDir, "missing_compatibility.json")),
    false
  );

  const created = createRecord("compatibility", {
    id: "legacy-id",
    created_at: "2001-01-01T00:00:00.000Z",
    updated_at: "2001-01-01T00:00:00.000Z",
    name: "legacy"
  });
  assert.equal(created.id, "legacy-id");
  assert.equal(created.created_at, "2001-01-01T00:00:00.000Z");
  assert.equal(created.updated_at, "2001-01-01T00:00:00.000Z");

  const updated = updateRecord("compatibility", "legacy-id", {
    id: "legacy-id-mutated",
    created_at: "1999-01-01T00:00:00.000Z",
    updated_at: "1999-01-01T00:00:00.000Z"
  });
  assert.equal(updated.id, "legacy-id-mutated");
  assert.equal(updated.created_at, "1999-01-01T00:00:00.000Z");
  assert.equal(updated.name, "legacy");
  assert.notEqual(updated.updated_at, "1999-01-01T00:00:00.000Z");
  assert.ok(Number.isFinite(Date.parse(updated.updated_at)));
  assert.equal(readCollection("compatibility").length, 1);

  writeCollection("compatibility", [{ id: "replacement" }]);
  assert.deepEqual(readCollection("compatibility"), [{ id: "replacement" }]);
});

test("characterizes legacy unknown values, closed exclusions, relationships, and deterministic ordering", () => {
  seedLegacyFixture();
  const opportunities = readFixture("opportunities");
  const prospects = readFixture("prospects");
  const activities = readFixture("activities");
  const tasks = readFixture("tasks");
  const generatedAt = "2026-01-06T09:00:00.000Z";

  const intelligences = opportunities.map(opportunity =>
    buildDealIntelligenceFromData(opportunity, {
      prospects,
      activities,
      tasks,
      generatedAt
    })
  );
  const known = intelligences.find(item => item.opportunity_id === "opp-known");
  const unknownValueIds = [
    "opp-zero",
    "opp-unknown",
    "opp-missing-value",
    "opp-blank-value",
    "opp-unknown-string-value",
    "opp-non-numeric-value"
  ];

  assert.equal(known.resolved.service, "Commercial Plumbing");
  assert.equal(known.activity.latest.id, "activity-history-task");
  assert.equal(known.tasks.latest.id, "task-history-executed");
  assert.equal(known.tasks.open, 2);
  for (const opportunityId of unknownValueIds) {
    const opportunity = opportunities.find(item => item.id === opportunityId);
    const intelligence = intelligences.find(
      item => item.opportunity_id === opportunityId
    );
    const revenue = buildRevenueIntelligence({
      opportunities: [opportunity],
      intelligences: [intelligence],
      generatedAt
    });

    assert.equal(intelligence.score.commercial_potential, null);
    assert.deepEqual(revenue.active_pipeline.value, {
      known_total: 0,
      known_count: 0,
      unknown_count: 1
    });
    assert.equal(revenue.top_actions[0].value.known, false);
    assert.equal(revenue.top_actions[0].value.amount, null);
  }

  const portfolio = buildRevenueIntelligence({
    opportunities,
    intelligences,
    generatedAt
  });
  assert.equal(portfolio.active_pipeline.count, 7);
  assert.deepEqual(portfolio.active_pipeline.value, {
    known_total: 20000,
    known_count: 1,
    unknown_count: 6
  });
  assert.equal(
    portfolio.top_actions.find(item => item.opportunity_id === "opp-zero").value.known,
    false
  );
  assert.equal(
    portfolio.top_actions.some(item => ["opp-won", "opp-lost"].includes(item.opportunity_id)),
    false
  );

  const pipelineMetrics = calculatePipelineEconomics([
    { status: "QUALIFIED", sales: { quoteValue: 20000 } },
    ...[null, undefined, "   ", "unknown", "not-a-number", 0].map(
      quoteValue => ({ status: "QUALIFIED", sales: { quoteValue } })
    )
  ]);
  assert.deepEqual(pipelineMetrics, {
    quotedValue: 20000,
    openPipelineValue: 20000,
    wonRevenue: 0
  });

  const history = require("../src/revenueActions/revenueActionRepository").listRevenueActions();
  assert.deepEqual(
    history.map(action => action.id),
    ["action-history-task", "action-history-executed"]
  );
  assert.equal(history[0].resulting_task_id, "task-history-executed");
  assert.equal(history[0].resulting_activity_id, "activity-history-task");
});

test("breaks equivalent revenue top-action ties by opportunity_id", () => {
  const generatedAt = "2026-01-06T09:00:00.000Z";
  const opportunities = ["opp-tie-b", "opp-tie-a"].map(id => ({
    id,
    business_name: "Equivalent Trade",
    stage: "QUALIFIED",
    value: 10000,
    probability: 0.5,
    next_action: "Review the proposal"
  }));
  const intelligences = opportunities.map(opportunity => ({
    opportunity_id: opportunity.id,
    health: { status: "STRONG", risks: [] },
    score: { stale_risk: 20 },
    evidence: { known: [], unknown: [] },
    next_best_action: {
      type: "FOLLOW_UP",
      priority: "MEDIUM",
      title: "Review the proposal",
      reason: "Equivalent deterministic evidence.",
      taskTitle: null
    }
  }));

  const portfolio = buildRevenueIntelligence({
    opportunities,
    intelligences,
    generatedAt
  });

  assert.deepEqual(
    portfolio.top_actions.map(item => item.opportunity_id),
    ["opp-tie-a", "opp-tie-b"]
  );
});

test("characterizes RevenueAction lifecycle, semantic duplicate handling, and closed-loop effects", async () => {
  await withServer(async baseUrl => {
    const beforeActionCount = readCollection("revenue_actions").length;
    const first = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-zero/revenue-actions",
      {}
    );
    const second = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-zero/revenue-actions",
      {}
    );

    assert.equal(first.status, 201);
    assert.equal(first.data.data.status, "RECOMMENDED");
    assert.equal(first.data.data.action_type, "CREATE_TASK");
    assert.match(first.data.data.basis_fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(second.data.data.id, first.data.data.id);
    assert.equal(readCollection("revenue_actions").length, beforeActionCount + 1);

    const prepared = await transition(baseUrl, first.data.data.id, "prepare");
    const approved = await transition(baseUrl, first.data.data.id, "approve");
    const executed = await transition(baseUrl, first.data.data.id, "execute");

    assert.equal(prepared.data.data.status, "PREPARED");
    assert.equal(approved.data.data.status, "APPROVED");
    assert.equal(executed.data.data.status, "EXECUTED");
    assert.equal(executed.data.data.execution_result.outcome, "TASK_CREATED");

    const task = readCollection("tasks").find(
      item => item.id === executed.data.data.resulting_task_id
    );
    const activity = readCollection("activities").find(
      item => item.id === executed.data.data.resulting_activity_id
    );
    assert.equal(task.metadata.revenue_action_id, first.data.data.id);
    assert.equal(activity.metadata.revenue_action_id, first.data.data.id);
    assert.equal(activity.metadata.task_id, task.id);
    assert.equal(
      readCollection("opportunities").find(item => item.id === "opp-zero").next_action,
      task.title
    );
    assert.notEqual(
      executed.data.refreshed.opportunity_intelligence.next_best_action.type,
      "CREATE_TASK"
    );

    const replay = await transition(baseUrl, first.data.data.id, "execute");
    assert.equal(replay.data.duplicate, true);
    assert.equal(
      readCollection("tasks").filter(
        item => item.metadata?.revenue_action_id === first.data.data.id
      ).length,
      1
    );
    assert.equal(
      readCollection("activities").filter(
        item => item.metadata?.revenue_action_id === first.data.data.id
      ).length,
      1
    );

    for (const [opportunityId, stage] of [
      ["opp-won", "WON"],
      ["opp-lost", "LOST"]
    ]) {
      const closed = await request(
        baseUrl,
        "POST",
        `/api/opportunities/${opportunityId}/revenue-actions`,
        {}
      );
      assert.equal(closed.status, 409);
      assert.equal(closed.data.error, "REVENUE_ACTION_OPPORTUNITY_CLOSED");
      assert.equal(closed.data.details.stage, stage);
    }
  });
});

test("characterizes RevenueAction EXECUTING and FAILED reconciliation from matching fixture effects", async () => {
  await withServer(
    async baseUrl => {
      const executing = await transition(
        baseUrl,
        "action-history-task",
        "execute"
      );
      const failed = await transition(
        baseUrl,
        "action-history-executed",
        "execute",
        { executionMode: "MANUAL_CONFIRMED" }
      );

      assert.equal(executing.status, 200);
      assert.equal(executing.data.data.status, "EXECUTED");
      assert.equal(
        executing.data.data.execution_result.outcome,
        "RECOVERED_LINKED_EFFECTS"
      );
      assert.equal(failed.status, 200);
      assert.equal(failed.data.data.status, "EXECUTED");
      assert.equal(
        failed.data.data.execution_result.outcome,
        "RECOVERED_LINKED_EFFECTS"
      );
      assert.equal(
        readCollection("tasks").filter(
          item => item.metadata?.revenue_action_id === "action-history-task"
        ).length,
        1
      );
      assert.equal(
        readCollection("activities").filter(
          item => item.metadata?.revenue_action_id === "action-history-task"
        ).length,
        1
      );
      assert.equal(
        readCollection("activities").filter(
          item => item.metadata?.revenue_action_id === "action-history-executed"
        ).length,
        1
      );
    },
    () => {
      const actions = readCollection("revenue_actions").map(action => {
        if (action.id === "action-history-task") {
          return {
            ...action,
            status: "EXECUTING",
            execution_result: null,
            executed_at: null,
            failed_at: null,
            execution_request: {
              mode: "SYSTEM_INTERNAL",
              requested_at: "2026-01-05T09:05:00.000Z"
            },
            execution_attempts: 1
          };
        }

        if (action.id === "action-history-executed") {
          return {
            ...action,
            status: "FAILED",
            execution_result: {
              mode: "MANUAL_CONFIRMED",
              outcome: "FAILED",
              external_send_performed: false,
              error: "EXECUTION_EFFECT_FAILED"
            },
            executed_at: null,
            failed_at: "2026-01-05T08:30:00.000Z",
            execution_request: {
              mode: "MANUAL_CONFIRMED",
              requested_at: "2026-01-05T08:25:00.000Z"
            },
            execution_attempts: 1
          };
        }

        return action;
      });
      writeCollection("revenue_actions", actions);
    }
  );

  await withServer(async baseUrl => {
    const materialized = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-zero/revenue-actions",
      {}
    );
    const prepared = await transition(
      baseUrl,
      materialized.data.data.id,
      "prepare"
    );
    const approved = await transition(
      baseUrl,
      materialized.data.data.id,
      "approve"
    );
    const action = approved.data.data;
    const linkedTask = id => ({
      id,
      opportunity_id: action.opportunity_id,
      title: action.proposed_execution.title,
      due_at: action.proposed_execution.due_at,
      priority: action.proposed_execution.priority,
      status: "OPEN",
      metadata: {
        source: "revenue_action",
        revenue_action_id: action.id,
        action_type: action.action_type,
        execution_effect_type: "INTERNAL_TASK",
        normalized_title: action.proposed_execution.normalized_title,
        semantic_task_key: action.proposed_execution.semantic_task_key
      }
    });

    assert.equal(materialized.status, 201);
    assert.equal(prepared.status, 200);
    assert.equal(approved.status, 200);

    writeCollection("tasks", [...readCollection("tasks"), linkedTask("partial-task")]);
    const partial = await transition(baseUrl, action.id, "execute");

    assert.equal(partial.status, 409);
    assert.equal(partial.data.error, "REVENUE_ACTION_EFFECT_CONFLICT");
    assert.equal(
      partial.data.details.reason,
      "EFFECTS_EXIST_BEFORE_EXECUTION_STARTED"
    );
    assert.equal(
      readCollection("revenue_actions").find(item => item.id === action.id).status,
      "APPROVED"
    );
  });

  await withServer(async baseUrl => {
    const materialized = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-zero/revenue-actions",
      {}
    );
    await transition(baseUrl, materialized.data.data.id, "prepare");
    const approved = await transition(
      baseUrl,
      materialized.data.data.id,
      "approve"
    );
    const action = approved.data.data;
    const linkedTask = id => ({
      id,
      opportunity_id: action.opportunity_id,
      title: action.proposed_execution.title,
      due_at: action.proposed_execution.due_at,
      priority: action.proposed_execution.priority,
      status: "OPEN",
      metadata: {
        source: "revenue_action",
        revenue_action_id: action.id,
        action_type: action.action_type,
        execution_effect_type: "INTERNAL_TASK",
        normalized_title: action.proposed_execution.normalized_title,
        semantic_task_key: action.proposed_execution.semantic_task_key
      }
    });

    writeCollection("tasks", [
      ...readCollection("tasks"),
      linkedTask("conflicting-task-one"),
      linkedTask("conflicting-task-two")
    ]);
    const conflicting = await transition(baseUrl, action.id, "execute");

    assert.equal(conflicting.status, 409);
    assert.equal(conflicting.data.error, "REVENUE_ACTION_EFFECT_CONFLICT");
    assert.equal(conflicting.data.details.reason, "MULTIPLE_LINKED_EFFECTS");
  });
});
