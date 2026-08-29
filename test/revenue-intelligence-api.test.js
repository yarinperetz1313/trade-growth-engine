const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "tge-revenue-")
);

process.env.LOCAL_STORE_DIR = tempDir;

const { app } = require("../src/app/server");
const {
  readCollection,
  writeCollection
} = require("../src/services/localStore");
const {
  buildRevenueIntelligence
} = require("../src/intelligence/revenueIntelligence");

function seedStore({
  opportunities = [],
  activities = [],
  tasks = [],
  prospects = []
} = {}) {
  writeCollection("prospects", prospects);
  writeCollection("opportunities", opportunities);
  writeCollection("activities", activities);
  writeCollection("tasks", tasks);
}

async function withServer(seed, fn) {
  seedStore(seed);
  const server = app.listen(0);

  try {
    await new Promise(resolve =>
      server.once("listening", resolve)
    );

    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve =>
      server.close(resolve)
    );
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

function opportunity(id, overrides = {}) {
  return {
    id,
    business_name: `Trade ${id}`,
    stage: "QUALIFIED",
    value: 10000,
    probability: 0.2,
    weighted_value: 2000,
    next_action: "Call the buyer",
    contact_name: "Ava Wilson",
    service: "Plumbing",
    location: "Melbourne",
    ...overrides
  };
}

function intelligence(id, overrides = {}) {
  return {
    opportunity_id: id,
    resolved: {
      business_name: `Trade ${id}`
    },
    health: {
      status: "STRONG",
      risks: []
    },
    score: {
      stale_risk: 0
    },
    evidence: {
      known: ["Commercial value known"],
      unknown: []
    },
    next_best_action: {
      type: "ADVANCE",
      priority: "MEDIUM",
      title: "Call the buyer",
      reason: "The opportunity is ready to advance.",
      taskTitle: "Call the buyer"
    },
    ...overrides
  };
}

test.after(() => {
  fs.rmSync(tempDir, {
    recursive: true,
    force: true
  });
});

test("builds an empty revenue portfolio without invented values", () => {
  const result = buildRevenueIntelligence({
    opportunities: [],
    intelligences: [],
    generatedAt: "2026-08-28T00:00:00.000Z"
  });

  assert.equal(result.generated_at, "2026-08-28T00:00:00.000Z");
  assert.equal(result.active_pipeline.count, 0);
  assert.equal(result.active_pipeline.value.known_total, 0);
  assert.equal(result.active_pipeline.value.unknown_count, 0);
  assert.equal(result.revenue_requiring_attention.opportunity_count, 0);
  assert.deepEqual(result.top_actions, []);
});

test("keeps positive commercial value distinct from zero and unknown values and excludes closed outcomes", () => {
  const result = buildRevenueIntelligence({
    opportunities: [
      opportunity("known", { value: 5000, weighted_value: 1000 }),
      opportunity("zero", { value: 0, weighted_value: 0 }),
      opportunity("unknown", { value: null, weighted_value: null }),
      opportunity("won", { stage: "WON", value: 9000, weighted_value: 9000 }),
      opportunity("lost", { stage: "LOST", value: 8000, weighted_value: 8000 })
    ],
    intelligences: [
      intelligence("known"),
      intelligence("zero"),
      intelligence("unknown"),
      intelligence("won"),
      intelligence("lost")
    ],
    generatedAt: "2026-08-28T00:00:00.000Z"
  });

  assert.equal(result.active_pipeline.count, 3);
  assert.equal(result.classifications.STRONG.count, 3);
  assert.equal(result.active_pipeline.value.known_count, 1);
  assert.equal(result.active_pipeline.value.unknown_count, 2);
  assert.equal(result.active_pipeline.value.known_total, 5000);
  assert.equal(result.active_pipeline.weighted_value.known_count, 1);
  assert.equal(result.active_pipeline.weighted_value.unknown_count, 2);
  assert.equal(result.active_pipeline.weighted_value.known_total, 1000);
  assert.deepEqual(result.value_semantics, {
    commercial_value_known_only_when_positive: true,
    zero_blank_or_non_numeric_value_is_unknown: true
  });
  assert.equal(
    result.top_actions.find(item => item.opportunity_id === "zero").value.known,
    false
  );
  assert.equal(
    result.top_actions.find(item => item.opportunity_id === "unknown").value.known,
    false
  );
  assert.equal(result.top_actions.some(item => item.opportunity_id === "won"), false);
  assert.equal(result.top_actions.some(item => item.opportunity_id === "lost"), false);
});

test("treats zero, blank, and non-numeric persisted values as unknown commercial value", () => {
  const result = buildRevenueIntelligence({
    opportunities: [
      opportunity("zero", { value: 0, weighted_value: 0 }),
      opportunity("blank", { value: "   ", weighted_value: "" }),
      opportunity("text", { value: "not recorded", weighted_value: "n/a" }),
      opportunity("boolean", { value: false, weighted_value: false })
    ],
    intelligences: [
      intelligence("zero"),
      intelligence("blank"),
      intelligence("text"),
      intelligence("boolean")
    ]
  });

  assert.equal(result.active_pipeline.value.known_count, 0);
  assert.equal(result.active_pipeline.value.unknown_count, 4);
  assert.equal(result.active_pipeline.value.known_total, 0);
  assert.equal(result.active_pipeline.weighted_value.known_count, 0);
  assert.equal(result.active_pipeline.weighted_value.unknown_count, 4);
  assert.equal(result.active_pipeline.weighted_value.known_total, 0);
});

test("classifies stale and missing-next-action work once per opportunity without attention double counting", () => {
  const result = buildRevenueIntelligence({
    opportunities: [opportunity("attention", { value: 7000 })],
    intelligences: [
      intelligence("attention", {
        health: {
          status: "AT_RISK",
          risks: [
            { type: "STALE", severity: "HIGH" },
            { type: "NO_NEXT_ACTION", severity: "HIGH" }
          ]
        },
        score: { stale_risk: 85 },
        next_best_action: {
          type: "CREATE_TASK",
          priority: "HIGH",
          title: "Define the next action",
          reason: "No next action is recorded.",
          taskTitle: "Define next action"
        }
      })
    ],
    generatedAt: "2026-08-28T00:00:00.000Z"
  });

  assert.equal(result.classifications.AT_RISK.count, 1);
  assert.equal(result.classifications.STALE.count, 1);
  assert.equal(result.classifications.NO_NEXT_ACTION.count, 1);
  assert.equal(result.revenue_requiring_attention.opportunity_count, 1);
  assert.equal(result.revenue_requiring_attention.value.known_total, 7000);
  assert.deepEqual(
    result.top_actions[0].classification_types,
    ["NO_NEXT_ACTION", "STALE", "AT_RISK"]
  );
});

test("counts a strong unknown-value qualification opportunity once in attention", () => {
  const result = buildRevenueIntelligence({
    opportunities: [opportunity("qualify-unknown", {
      value: null,
      weighted_value: null
    })],
    intelligences: [intelligence("qualify-unknown", {
      next_best_action: {
        type: "QUALIFY",
        priority: "MEDIUM",
        title: "Confirm commercial value",
        reason: "Commercial value is unknown.",
        taskTitle: "Confirm commercial value"
      }
    })]
  });

  assert.equal(result.classifications.STRONG.count, 1);
  assert.equal(result.classifications.VALUE_UNKNOWN.count, 1);
  assert.equal(result.revenue_requiring_attention.opportunity_count, 1);
  assert.equal(result.revenue_requiring_attention.value.known_count, 0);
  assert.equal(result.revenue_requiring_attention.value.unknown_count, 1);
  assert.equal(result.revenue_requiring_attention.value.known_total, 0);
  assert.deepEqual(
    result.top_actions[0].classification_types,
    ["VALUE_UNKNOWN", "STRONG"]
  );
  assert.equal(result.top_actions[0].action.type, "QUALIFY");
  assert.equal(result.top_actions[0].value.known, false);
  assert.equal(result.top_actions[0].value.amount, null);
});

test("orders semantically equivalent actions with an explicit opportunity ID tie breaker", () => {
  const result = buildRevenueIntelligence({
    opportunities: [
      opportunity("opp-z", { value: 2000 }),
      opportunity("opp-a", { value: 2000 })
    ],
    intelligences: [
      intelligence("opp-z", {
        health: { status: "AT_RISK", risks: [] }
      }),
      intelligence("opp-a", {
        health: { status: "AT_RISK", risks: [] }
      })
    ],
    generatedAt: "2026-08-28T00:00:00.000Z"
  });

  assert.deepEqual(
    result.top_actions.map(item => item.opportunity_id),
    ["opp-a", "opp-z"]
  );
});

test("preserves unknown probability while ordering equivalent actions deterministically", () => {
  const portfolio = input => buildRevenueIntelligence({
    opportunities: input,
    intelligences: input.map(item => intelligence(item.id, {
      health: { status: "AT_RISK", risks: [] }
    })),
    generatedAt: "2026-08-28T00:00:00.000Z"
  });
  const input = [
    opportunity("opp-z", { probability: "not recorded" }),
    opportunity("opp-a", { probability: null })
  ];

  const first = portfolio(input);
  const second = portfolio([...input].reverse());

  assert.deepEqual(
    first.top_actions.map(item => item.probability),
    [null, null]
  );
  assert.deepEqual(
    first.top_actions.map(item => item.opportunity_id),
    ["opp-a", "opp-z"]
  );
  assert.deepEqual(
    second.top_actions.map(item => item.opportunity_id),
    ["opp-a", "opp-z"]
  );
});

test("GET revenue intelligence returns an empty read-only portfolio", async () => {
  await withServer({}, async baseUrl => {
    const result = await request(
      baseUrl,
      "GET",
      "/api/intelligence/revenue"
    );

    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.data.active_pipeline.count, 0);
    assert.deepEqual(result.data.data.top_actions, []);
  });
});

test("GET revenue intelligence is read-only, structured, and recalculates after the closed-loop mutation", async () => {
  const oldActivity = "2026-07-01T00:00:00.000Z";

  await withServer({
    opportunities: [
      opportunity("opp-revenue", {
        value: null,
        weighted_value: null,
        contact_name: null,
        next_action: "Follow up"
      }),
      opportunity("opp-no-next", {
        value: 0,
        weighted_value: 0,
        next_action: ""
      })
    ],
    activities: [
      {
        id: "old-activity",
        opportunity_id: "opp-revenue",
        type: "NOTE",
        created_at: oldActivity
      }
    ]
  }, async baseUrl => {
    const beforeFiles = ["opportunities", "activities", "tasks"]
      .map(collection => fs.readFileSync(
        path.join(tempDir, `${collection}.json`),
        "utf8"
      ));

    const first = await request(
      baseUrl,
      "GET",
      "/api/intelligence/revenue"
    );

    assert.equal(first.status, 200);
    assert.equal(first.data.ok, true);
    assert.match(first.data.data.generated_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(first.data.data.value_semantics, {
      commercial_value_known_only_when_positive: true,
      zero_blank_or_non_numeric_value_is_unknown: true
    });
    assert.equal(first.data.data.classifications.STALE.count, 2);
    assert.equal(first.data.data.classifications.NO_NEXT_ACTION.count, 1);
    assert.equal(first.data.data.active_pipeline.value.unknown_count, 2);
    assert.equal(
      first.data.data.top_actions.find(
        item => item.opportunity_id === "opp-no-next"
      ).value.known,
      false
    );
    assert.deepEqual(
      ["opportunities", "activities", "tasks"].map(collection =>
        fs.readFileSync(path.join(tempDir, `${collection}.json`), "utf8")
      ),
      beforeFiles
    );

    const mutation = await request(
      baseUrl,
      "POST",
      "/api/opportunities/opp-revenue/intelligence/value",
      { value: 12000 }
    );

    assert.equal(mutation.status, 200);

    const after = await request(
      baseUrl,
      "GET",
      "/api/intelligence/revenue"
    );

    assert.equal(after.status, 200);
    assert.equal(after.data.data.active_pipeline.value.known_total, 12000);
    assert.equal(after.data.data.active_pipeline.value.unknown_count, 1);
    assert.equal(after.data.data.active_pipeline.weighted_value.known_total, 2400);

    const missing = await request(
      baseUrl,
      "POST",
      "/api/intelligence/revenue"
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.data.ok, false);
  });
});
