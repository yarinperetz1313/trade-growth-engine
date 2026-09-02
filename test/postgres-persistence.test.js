const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TenantContextError,
  createTenantContext,
  requireTenantContext
} = require("../src/persistence/tenantContext");
const {
  createPersistence
} = require("../src/persistence/createPersistence");
const {
  classifyCommercialValue,
  opportunityFromRow,
  opportunityToRow,
  activityToRow,
  prospectFromRow,
  prospectToRow,
  revenueActionToRow,
  taskToRow
} = require("../src/persistence/postgres/mappers");
const {
  PersistenceConflictError,
  createPostgresRepositories,
  validateStoredRevenueActionIntegrity
} = require("../src/persistence/postgres/repositories");
const {
  PostgresTransactionOutcomeUnknownError,
  withTenantTransaction
} = require("../src/persistence/postgres/transaction");
const {
  createPostgresRevenueActionService
} = require("../src/revenueActions/postgresRevenueActionService");
const {
  createPostgresCoreService
} = require("../src/persistence/postgres/coreService");
const {
  buildProposedExecution,
  fingerprint,
  recommendationBasis
} = require("../src/revenueActions/revenueActionBasis");
const {
  createApp
} = require("../src/app/server");

test("trusted TenantContext is branded, normalized, immutable, and fails closed", () => {
  const context = createTenantContext({
    tenantId: "A0E8A2A0-9C44-4D84-9263-7D417AC00B8E",
    subjectId: "  auth0|member  "
  });

  assert.deepEqual(
    { tenantId: context.tenantId, subjectId: context.subjectId },
    {
      tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
      subjectId: "auth0|member"
    }
  );
  assert.equal(Object.isFrozen(context), true);
  assert.equal(requireTenantContext(context), context);

  const spreadForgery = {
    ...context,
    tenantId: "b0e8a2a0-9c44-4d84-9263-7d417ac00b8e"
  };
  assert.throws(
    () => requireTenantContext(spreadForgery),
    error => error instanceof TenantContextError && error.code === "TENANT_CONTEXT_REQUIRED"
  );

  for (const invalid of [
    undefined,
    null,
    {},
    {
      tenantId: context.tenantId,
      subjectId: context.subjectId
    }
  ]) {
    assert.throws(
      () => requireTenantContext(invalid),
      error => error instanceof TenantContextError && error.code === "TENANT_CONTEXT_REQUIRED"
    );
  }

  for (const invalid of [
    { tenantId: "not-a-uuid", subjectId: "auth0|member" },
    { tenantId: context.tenantId, subjectId: "   " },
    { tenantId: context.tenantId, subjectId: null }
  ]) {
    assert.throws(
      () => createTenantContext(invalid),
      error => error instanceof TenantContextError && error.code === "TENANT_CONTEXT_INVALID"
    );
  }
});

test("tenant transactions use one checked-out client and roll back operation failures", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });

  const events = [];
  const expected = new Error("operation failed");
  const client = {
    async query(sql, params) {
      events.push([sql, params]);
      return { rows: [] };
    },
    release() {
      events.push(["RELEASE"]);
    }
  };
  const pool = {
    async connect() {
      events.push(["CONNECT"]);
      return client;
    },
    query() {
      assert.fail("pool.query must never be used");
    }
  };

  await assert.rejects(
    withTenantTransaction(pool, context, async ({ client: checkedOut }) => {
      assert.equal(checkedOut, client);
      await checkedOut.query("SELECT 1");
      throw expected;
    }),
    expected
  );

  assert.deepEqual(events, [
    ["CONNECT"],
    ["BEGIN", undefined],
    ["SELECT tge.set_request_context($1::uuid, $2::text)", [
      context.tenantId,
      context.subjectId
    ]],
    ["SELECT 1", undefined],
    ["ROLLBACK", undefined],
    ["RELEASE"]
  ]);
});

test("tenant transactions surface rejected COMMIT as an unknown outcome with the attempted result", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const commitError = new Error("commit acknowledgement lost");
  const attempted = { record: { id: "attempted-id" }, created: true };
  const events = [];
  const client = {
    async query(sql) {
      events.push(sql);
      if (sql === "COMMIT") throw commitError;
      return { rows: [] };
    },
    release(error) {
      events.push(["RELEASE", error]);
    }
  };

  await assert.rejects(
    withTenantTransaction(
      { connect: async () => client },
      context,
      async () => attempted
    ),
    error =>
      error instanceof PostgresTransactionOutcomeUnknownError &&
      error.code === "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN" &&
      error.outcomeUnknown === true &&
      error.attemptedResult === attempted &&
      error.details.attemptedId === "attempted-id" &&
      error.cause === commitError
  );
  assert.deepEqual(events, [
    "BEGIN",
    "SELECT tge.set_request_context($1::uuid, $2::text)",
    "COMMIT",
    ["RELEASE", commitError]
  ]);
});

test("tenant transaction ambiguity captures a service success envelope action ID", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const attempted = {
    ok: true,
    data: { id: "service-envelope-action" },
    refreshed: {}
  };
  const client = {
    async query(sql) {
      if (sql === "COMMIT") throw new Error("commit acknowledgement lost");
      return { rows: [] };
    },
    release() {}
  };

  await assert.rejects(
    withTenantTransaction(
      { connect: async () => client },
      context,
      async () => attempted
    ),
    error =>
      error instanceof PostgresTransactionOutcomeUnknownError &&
      error.attemptedId === "service-envelope-action" &&
      error.details.attemptedId === "service-envelope-action"
  );
});

test("tenant transaction ambiguity captures an import preview batch ID", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const attempted = { batch: { id: "attempted-import-batch" }, records: [] };
  const client = {
    async query(sql) {
      if (sql === "COMMIT") throw new Error("commit acknowledgement lost");
      return { rows: [] };
    },
    release() {}
  };

  await assert.rejects(
    withTenantTransaction(
      { connect: async () => client },
      context,
      async () => attempted
    ),
    error =>
      error instanceof PostgresTransactionOutcomeUnknownError &&
      error.attemptedId === "attempted-import-batch" &&
      error.details.attemptedId === "attempted-import-batch"
  );
});

test("tenant transactions discard a client when rollback fails", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const operationError = new Error("operation failed");
  const rollbackError = new Error("rollback failed");
  let releasedWith;
  const client = {
    async query(sql) {
      if (sql === "ROLLBACK") throw rollbackError;
      return { rows: [] };
    },
    release(error) {
      releasedWith = error;
    }
  };

  await assert.rejects(
    withTenantTransaction({ connect: async () => client }, context, async () => {
      throw operationError;
    }),
    error => error === operationError && error.rollbackError === rollbackError
  );
  assert.equal(releasedWith, rollbackError);
});

test("tenant transactions preserve the primary error when release also fails", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const operationError = new Error("operation failed");
  const releaseError = new Error("release failed");
  const client = {
    async query() {
      return { rows: [] };
    },
    release() {
      throw releaseError;
    }
  };

  await assert.rejects(
    withTenantTransaction({ connect: async () => client }, context, async () => {
      throw operationError;
    }),
    error => error === operationError && error.releaseError === releaseError
  );
});

test("tenant transactions preserve confirmed COMMIT success when release fails", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const releaseError = new Error("release failed after commit");
  const events = [];
  const cleanupErrors = [];
  const client = {
    async query(sql) {
      events.push(sql);
      return { rows: [] };
    },
    release() {
      throw releaseError;
    }
  };

  assert.equal(
    await withTenantTransaction(
      { connect: async () => client },
      context,
      async () => "committed",
      { onCleanupError: error => cleanupErrors.push(error) }
    ),
    "committed"
  );
  assert.deepEqual(cleanupErrors, [releaseError]);
  assert.deepEqual(events, [
    "BEGIN",
    "SELECT tge.set_request_context($1::uuid, $2::text)",
    "COMMIT"
  ]);
});

test("mutable current payload preserves explicit JSON shape without rewriting legacy evidence", () => {
  const inserted = {
    id: "shape-prospect",
    business_name: "Shape Prospect",
    evidence: null,
    metadata: null,
    unknown_field: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  };
  const mapped = prospectToRow(inserted);
  assert.deepEqual(mapped.legacy_payload, inserted);
  assert.deepEqual(mapped.current_payload, inserted);
  assert.equal(mapped.source_ordinal, null);
  assert.equal(mapped.source_created_at, inserted.created_at);
  assert.equal(mapped.source_updated_at, inserted.updated_at);

  const hydrated = prospectFromRow({
    ...mapped,
    evidence: [],
    metadata: {},
    current_payload: {
      ...mapped.current_payload,
      evidence: [],
      metadata: {},
      unknown_field: "updated"
    }
  });
  assert.deepEqual(hydrated.evidence, []);
  assert.deepEqual(hydrated.metadata, {});
  assert.equal(hydrated.unknown_field, "updated");
  assert.deepEqual(mapped.legacy_payload, inserted);
});

test("commercial value mapping round-trips all seven states without inventing zero", () => {
  const cases = [
    [{ value: 1200 }, [1200, "KNOWN", 1200]],
    [{ value: 0 }, [0, "ZERO", 0]],
    [{ value: null }, [null, "NULL", null]],
    [{}, [null, "MISSING", undefined]],
    [{ value: "   " }, [null, "BLANK", "   "]],
    [{ value: "unknown" }, [null, "UNKNOWN_LITERAL", "unknown"]],
    [{ value: "not-a-number" }, [null, "NON_NUMERIC", "not-a-number"]]
  ];

  for (const [record, expected] of cases) {
    const classified = classifyCommercialValue(record);
    assert.deepEqual(
      [classified.numeric, classified.state, classified.raw],
      expected
    );

    const hydrated = opportunityFromRow({
      tenant_id: "ignored",
      id: `opp-${classified.state}`,
      business_name: "Value Test",
      stage: "QUALIFIED",
      commercial_value: classified.numeric === null
        ? null
        : String(classified.numeric),
      commercial_value_state: classified.state,
      commercial_value_raw: classified.raw,
      probability: null,
      weighted_value: null,
      metadata: {},
      legacy_payload: {},
      source_created_at: new Date("2026-01-01T00:00:00.000Z"),
      source_updated_at: new Date("2026-01-01T00:00:00.000Z"),
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z")
    });

    if (classified.state === "MISSING") {
      assert.equal(Object.hasOwn(hydrated, "value"), false);
    } else {
      assert.equal(Object.hasOwn(hydrated, "value"), true);
      assert.equal(hydrated.value, classified.raw);
    }
  }
});

test("ordinary opportunity updates preserve exact imported numeric evidence", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const exactValue = "1.234567890123456789";
  const exactProbability = "0.1234567890123456789";
  const exactWeightedValue = "1e-4000";
  const metadata = {
    import: {
      numeric_evidence: {
        value: { valueKind: "NUMERIC", raw: exactValue },
        probability: { valueKind: "NUMERIC", raw: exactProbability },
        weighted_value: { valueKind: "NUMERIC", raw: exactWeightedValue }
      }
    }
  };
  const stored = {
    tenant_id: context.tenantId,
    id: "imported-exact-update",
    business_name: "Exact Import",
    stage: "QUALIFIED",
    commercial_value: exactValue,
    commercial_value_state: "KNOWN",
    commercial_value_raw: Number(exactValue),
    probability: exactProbability,
    weighted_value: exactWeightedValue,
    next_action: "Initial action",
    metadata,
    current_payload: {
      id: "imported-exact-update",
      business_name: "Exact Import",
      stage: "QUALIFIED",
      value: exactValue,
      probability: exactProbability,
      weighted_value: exactWeightedValue,
      next_action: "Initial action",
      metadata
    },
    legacy_payload: {},
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    updated_at: new Date("2026-09-01T00:00:00.000Z")
  };
  const assignments = [];
  const client = {
    async query(sql, values) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.startsWith("select * from tge.opportunities")) {
        return { rows: [stored] };
      }
      if (normalized.startsWith("update tge.opportunities")) {
        assignments.push(Object.fromEntries(
          [...normalized.matchAll(/([a-z_]+) = \$(\d+)/g)].map(match => [
            match[1],
            values[Number(match[2]) - 1]
          ])
        ));
        return { rows: [{ ...stored, next_action: "Unrelated update" }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client },
    clock: () => new Date("2026-09-02T00:00:00.000Z")
  });

  const updated = await repositories.opportunities.update(
    context,
    stored.id,
    {
      next_action: "Unrelated update",
      metadata: { operator_note: "Reviewed" }
    }
  );

  const assigned = assignments[0];
  assert.equal(updated.value, exactValue);
  assert.equal(updated.probability, exactProbability);
  assert.equal(updated.weighted_value, exactWeightedValue);
  assert.equal(assigned.commercial_value, exactValue);
  assert.equal(assigned.commercial_value_state, "KNOWN");
  assert.equal(assigned.commercial_value_raw, exactValue);
  assert.equal(assigned.probability, exactProbability);
  assert.equal(assigned.weighted_value, exactWeightedValue);
  assert.deepEqual(JSON.parse(assigned.metadata), {
    operator_note: "Reviewed",
    import: metadata.import
  });

  await repositories.opportunities.update(context, stored.id, { value: 2 });
  const changedValue = assignments[1];
  assert.equal(changedValue.commercial_value, 2);
  assert.equal(changedValue.commercial_value_state, "KNOWN");
  assert.equal(changedValue.commercial_value_raw, "2");
  assert.equal(
    Object.hasOwn(
      JSON.parse(changedValue.metadata).import.numeric_evidence,
      "value"
    ),
    false
  );
});

test("persistence selection is explicit and PostgreSQL never falls back to JSON", () => {
  const json = createPersistence({ adapter: "json" });
  assert.equal(json.adapter, "json");
  assert.throws(
    () => json.forTenant(),
    /only for the PostgreSQL adapter/
  );

  const postgres = createPersistence({
    adapter: "postgres",
    pool: { connect() {} }
  });
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const tenantRepositories = postgres.forTenant(context);
  assert.equal(typeof tenantRepositories.prospects.list, "function");
  assert.equal(typeof tenantRepositories.revenueActions.executeAtomic, "function");
  assert.equal(tenantRepositories.revenueActions.insert, undefined);
  assert.equal(typeof tenantRepositories.transaction, "function");
  assert.throws(
    () => postgres.forTenant({
      tenantId: context.tenantId,
      subjectId: context.subjectId
    }),
    error => error.code === "TENANT_CONTEXT_REQUIRED"
  );

  assert.throws(
    () => createPersistence({ pool: { connect() {} } }),
    /Persistence adapter selection is required/
  );
  assert.throws(
    () => createPersistence({ adapter: "postgres" }),
    /PostgreSQL persistence requires an injected pool/
  );
  assert.throws(
    () => createPersistence({ adapter: "unknown" }),
    /Unsupported persistence adapter/
  );
});

test("live repository inserts ignore caller-authored import source order", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  let sourceOrdinal;
  const client = {
    async query(sql, values) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.startsWith("insert into tge.prospects")) {
        const columns = normalized.match(/\(([^)]+)\) values/)[1]
          .split(",")
          .map(column => column.trim());
        sourceOrdinal = values[columns.indexOf("source_ordinal")];
        return {
          rows: [{
            ...prospectToRow({
              id: "live-no-import-order",
              business_name: "Live record",
              created_at: "2026-08-30T00:00:00.000Z",
              updated_at: "2026-08-30T00:00:00.000Z"
            }),
            live_ordinal: 1
          }]
        };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });

  await repositories.prospects.insert(
    context,
    { id: "live-no-import-order", business_name: "Live record" },
    { sourceOrdinal: 42 }
  );
  assert.equal(sourceOrdinal, null);
});

test("ordinary activity idempotency keys are not reserved RevenueAction evidence", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const activity = {
    id: "ordinary-action-key",
    opportunity_id: "ordinary-opportunity",
    type: "TASK_CREATED",
    description: "Created an ordinary CRM task.",
    metadata: { action_key: "task:CREATE_TASK:ordinary-opportunity" },
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z"
  };
  const client = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.startsWith("insert into tge.activities")) {
        return { rows: [activityToRow(activity)] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });

  const inserted = await repositories.activities.insert(context, activity);
  assert.equal(inserted.metadata.action_key, activity.metadata.action_key);

  await assert.rejects(
    repositories.activities.insert(context, {
      ...activity,
      id: "reserved-revenue-action-evidence",
      metadata: { revenue_action_id: "action-1" }
    }),
    error => error.code === "REVENUE_ACTION_EFFECT_EVIDENCE_FORBIDDEN"
  );
});

test("stored RevenueAction validation rejects incoherent lifecycle and execution truth", () => {
  const recommended = buildStoredRevenueAction();
  assert.equal(validateStoredRevenueActionIntegrity(recommended).valid, true);
  assert.equal(
    validateStoredRevenueActionIntegrity({ ...recommended, audit: [] }).valid,
    false
  );

  const cancelledRecommended = {
    ...structuredClone(recommended),
    status: "CANCELLED",
    cancelled_at: "2026-08-30T00:00:30.000Z",
    updated_at: "2026-08-30T00:00:30.000Z",
    audit: [
      ...recommended.audit,
      {
        transition: "CANCELLED",
        at: "2026-08-30T00:00:30.000Z"
      }
    ]
  };
  assert.equal(
    validateStoredRevenueActionIntegrity(cancelledRecommended).valid,
    true
  );
  for (const [field, value] of [
    ["execution_attempts", 1],
    ["execution_request", {
      mode: "SYSTEM_INTERNAL",
      requested_at: "2026-08-30T00:00:20.000Z"
    }],
    ["execution_result", {
      mode: "SYSTEM_INTERNAL",
      outcome: "FAILED",
      external_send_performed: false,
      error: "SMUGGLED_FAILURE"
    }],
    ["failed_at", "2026-08-30T00:00:20.000Z"],
    ["resulting_task_id", "smuggled-task"],
    ["resulting_activity_id", "smuggled-activity"]
  ]) {
    assert.equal(
      validateStoredRevenueActionIntegrity({
        ...cancelledRecommended,
        [field]: value
      }).valid,
      false,
      `CANCELLED cannot smuggle ${field} over its pre-cancellation state`
    );
  }

  const executed = buildStoredRevenueAction({ status: "EXECUTED" });
  assert.equal(validateStoredRevenueActionIntegrity(executed).valid, true);
  const executing = structuredClone(executed);
  executing.status = "EXECUTING";
  executing.executed_at = null;
  executing.execution_result = null;
  executing.resulting_task_id = null;
  executing.resulting_activity_id = null;
  executing.updated_at = executing.execution_request.requested_at;
  executing.audit.pop();
  assert.equal(
    validateStoredRevenueActionIntegrity(executing).valid,
    true,
    "an EXECUTING attempt with no effects remains resumable"
  );
  const partialExecuting = {
    ...executing,
    resulting_task_id: "stored-integrity-task"
  };
  assert.equal(
    validateStoredRevenueActionIntegrity(partialExecuting).valid,
    true,
    "an EXECUTING internal attempt may retain its exact partial task effect"
  );
  assert.equal(
    validateStoredRevenueActionIntegrity({
      ...partialExecuting,
      audit: [
        ...partialExecuting.audit,
        {
          transition: "EXECUTION_STARTED",
          at: "2026-08-30T00:03:30.000Z",
          attempt: 2
        }
      ],
      execution_attempts: 2,
      execution_request: {
        mode: "SYSTEM_INTERNAL",
        requested_at: "2026-08-30T00:03:30.000Z"
      }
    }).valid,
    false,
    "an incomplete EXECUTING attempt cannot invent a second start transition"
  );
  const recovered = structuredClone(executed);
  recovered.execution_attempts = 2;
  recovered.execution_request = {
    mode: "SYSTEM_INTERNAL",
    requested_at: "2026-08-30T00:03:30.000Z"
  };
  recovered.execution_result.outcome = "RECOVERED_LINKED_EFFECTS";
  recovered.audit.splice(
    3,
    1,
    {
      transition: "EXECUTION_STARTED",
      at: "2026-08-30T00:03:00.000Z",
      attempt: 1
    },
    {
      transition: "FAILED",
      at: "2026-08-30T00:03:15.000Z",
      error: "EXECUTION_EFFECT_FAILED"
    },
    {
      transition: "EXECUTION_STARTED",
      at: "2026-08-30T00:03:30.000Z",
      attempt: 2
    }
  );
  assert.equal(validateStoredRevenueActionIntegrity(recovered).valid, true);
  const cancelledRetry = structuredClone(recovered);
  cancelledRetry.status = "CANCELLED";
  cancelledRetry.executed_at = null;
  cancelledRetry.execution_result = null;
  cancelledRetry.cancelled_at = "2026-08-30T00:03:45.000Z";
  cancelledRetry.updated_at = cancelledRetry.cancelled_at;
  cancelledRetry.audit.pop();
  cancelledRetry.audit.push({
    transition: "CANCELLED",
    at: cancelledRetry.cancelled_at
  });
  assert.equal(
    validateStoredRevenueActionIntegrity(cancelledRetry).valid,
    true,
    "CANCELLED preserves a retried EXECUTING attempt without restoring an old failure"
  );
  assert.equal(
    validateStoredRevenueActionIntegrity({
      ...executed,
      execution_result: {
        ...executed.execution_result,
        outcome: "USER_CONFIRMED_COMPLETION"
      }
    }).valid,
    false,
    "internal actions cannot claim a communication outcome"
  );
  const communication = structuredClone(executed);
  communication.action_type = "FOLLOW_UP";
  communication.execution_type = "COMMUNICATION_DRAFT";
  communication.risk_class = "EXTERNAL_CONSEQUENTIAL";
  communication.recommendation_snapshot.action_type = "FOLLOW_UP";
  communication.recommendation_snapshot.task_title = null;
  communication.basis_fingerprint = fingerprint(recommendationBasis(
    { opportunity: { id: communication.opportunity_id } },
    {
      type: communication.action_type,
      priority: communication.priority,
      title: communication.title,
      reason: communication.reason,
      taskTitle: null
    },
    communication.evidence
  ));
  communication.proposed_execution = buildProposedExecution(communication);
  communication.execution_request.mode = "MANUAL_CONFIRMED";
  communication.execution_result = {
    mode: "MANUAL_CONFIRMED",
    outcome: "USER_CONFIRMED_COMPLETION",
    external_send_performed: false
  };
  communication.resulting_task_id = null;
  communication.audit.at(-1).execution_mode = "MANUAL_CONFIRMED";
  communication.audit.at(-1).resulting_task_id = null;
  assert.equal(validateStoredRevenueActionIntegrity(communication).valid, true);
  assert.equal(
    validateStoredRevenueActionIntegrity({
      ...communication,
      execution_result: {
        ...communication.execution_result,
        outcome: "TASK_CREATED"
      }
    }).valid,
    false,
    "communication actions cannot claim an internal-task outcome"
  );

  const failed = structuredClone(executed);
  failed.status = "FAILED";
  failed.executed_at = null;
  failed.failed_at = "2026-08-30T00:04:00.000Z";
  failed.resulting_task_id = null;
  failed.resulting_activity_id = null;
  failed.execution_result = {
    mode: "SYSTEM_INTERNAL",
    outcome: "FAILED",
    external_send_performed: false,
    error: "EXECUTION_EFFECT_FAILED"
  };
  failed.updated_at = failed.failed_at;
  failed.audit.splice(-1, 1, {
    transition: "FAILED",
    at: failed.failed_at,
    error: "EXECUTION_EFFECT_FAILED"
  });
  assert.equal(validateStoredRevenueActionIntegrity(failed).valid, true);
  for (const failureEvidence of [
    { ...failed.execution_result, error: "" },
    { ...failed.execution_result, error: "DIFFERENT_FAILURE" }
  ]) {
    assert.equal(
      validateStoredRevenueActionIntegrity({
        ...failed,
        execution_result: failureEvidence
      }).valid,
      false,
      "FAILED result errors must be nonempty and match the FAILED audit"
    );
  }
  const cancelledFailure = structuredClone(failed);
  cancelledFailure.status = "CANCELLED";
  cancelledFailure.cancelled_at = "2026-08-30T00:05:00.000Z";
  cancelledFailure.updated_at = cancelledFailure.cancelled_at;
  cancelledFailure.audit.push({
    transition: "CANCELLED",
    at: cancelledFailure.cancelled_at
  });
  assert.equal(
    validateStoredRevenueActionIntegrity(cancelledFailure).valid,
    true,
    "CANCELLED preserves coherent failed-attempt evidence"
  );
  for (const [field, value] of [
    ["execution_request", null],
    ["execution_result", null],
    ["prepared_at", null],
    ["approved_at", null],
    ["executed_at", null],
    ["execution_attempts", 0],
    ["resulting_task_id", null],
    ["resulting_activity_id", null]
  ]) {
    assert.equal(
      validateStoredRevenueActionIntegrity({ ...executed, [field]: value }).valid,
      false,
      `expected malformed EXECUTED ${field} to be rejected`
    );
  }
});

test("EXECUTED replay requires reciprocal stored effects before duplicate success", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
    subjectId: "auth0|member"
  });
  const action = buildStoredRevenueAction({ status: "EXECUTED" });
  const opportunity = {
    id: action.opportunity_id,
    business_name: "Integrity Opportunity",
    stage: "QUALIFIED",
    value: 0,
    next_action: action.proposed_execution.title,
    created_at: action.created_at,
    updated_at: action.updated_at
  };
  const actionRow = revenueActionToRow(action);
  const opportunityRow = opportunityToRow(opportunity);
  const client = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.startsWith("select opportunity_id from tge.revenue_actions")) {
        return { rows: [{ opportunity_id: action.opportunity_id }] };
      }
      if (normalized.startsWith("select * from tge.opportunities")) {
        return { rows: [opportunityRow] };
      }
      if (normalized.startsWith("select * from tge.revenue_actions")) {
        return { rows: [actionRow] };
      }
      if (
        normalized.startsWith("select * from tge.tasks") ||
        normalized.startsWith("select * from tge.activities")
      ) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });

  await assert.rejects(
    repositories.revenueActions.executeAtomic(context, action.id, {}),
    error =>
      error instanceof PersistenceConflictError &&
      error.code === "REVENUE_ACTION_EFFECT_CONFLICT" &&
      error.details.reason === "INVALID_LINKED_TASK"
  );
});

test("EXECUTED replay accepts a legitimately completed linked task", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00B8E",
    subjectId: "auth0|member"
  });
  const action = buildStoredRevenueAction({ status: "EXECUTED" });
  const opportunity = {
    id: action.opportunity_id,
    business_name: "Integrity Opportunity",
    stage: "QUALIFIED",
    value: 0,
    next_action: action.proposed_execution.title,
    created_at: action.created_at,
    updated_at: action.updated_at
  };
  const task = {
    id: action.resulting_task_id,
    opportunity_id: action.opportunity_id,
    title: action.proposed_execution.title,
    description: action.proposed_execution.description,
    due_at: action.proposed_execution.due_at,
    priority: action.proposed_execution.priority,
    status: "COMPLETED",
    completed_at: "2026-08-30T00:05:00.000Z",
    metadata: {
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      execution_effect_type: "INTERNAL_TASK",
      normalized_title: action.proposed_execution.normalized_title,
      semantic_task_key: action.proposed_execution.semantic_task_key
    },
    created_at: action.executed_at,
    updated_at: "2026-08-30T00:05:00.000Z"
  };
  const activity = {
    id: action.resulting_activity_id,
    opportunity_id: action.opportunity_id,
    type: "REVENUE_ACTION_TASK_EXECUTED",
    description: `RevenueAction executed: ${action.title}`,
    metadata: {
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      execution_effect_type: "INTERNAL_TASK",
      execution_mode: "SYSTEM_INTERNAL",
      task_id: task.id
    },
    created_at: action.executed_at,
    updated_at: action.executed_at
  };
  const client = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.startsWith("select opportunity_id from tge.revenue_actions")) {
        return { rows: [{ opportunity_id: action.opportunity_id }] };
      }
      if (normalized.startsWith("select * from tge.opportunities")) {
        return { rows: [opportunityToRow(opportunity)] };
      }
      if (normalized.startsWith("select * from tge.revenue_actions")) {
        return { rows: [revenueActionToRow(action)] };
      }
      if (normalized.startsWith("select * from tge.tasks")) {
        return { rows: [taskToRow(task)] };
      }
      if (normalized.startsWith("select * from tge.activities")) {
        return { rows: [activityToRow(activity)] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });

  const result = await repositories.revenueActions.executeAtomic(
    context,
    action.id,
    {}
  );

  assert.equal(result.duplicate, true);
  assert.equal(result.record.id, action.id);

  action.execution_result.outcome = "TASK_REUSED";
  await assert.rejects(
    repositories.revenueActions.executeAtomic(context, action.id, {}),
    error =>
      error instanceof PersistenceConflictError &&
      error.code === "REVENUE_ACTION_EFFECT_CONFLICT" &&
      error.details.reason === "EXECUTION_RESULT_EFFECT_MISMATCH"
  );
});

test("JSON RevenueAction ordering keeps stable source order for equal timestamps", async () => {
  const records = [
    { id: "source-a", created_at: "2026-01-01T00:00:00.000Z" },
    { id: "source-z", created_at: "2026-01-01T00:00:00.000Z" }
  ];
  const persistence = createPersistence({
    adapter: "json",
    store: {
      readCollection(name) {
        assert.equal(name, "revenue_actions");
        return structuredClone(records);
      }
    }
  });

  assert.deepEqual(
    (await persistence.repositories.revenueActions.list()).map(item => item.id),
    records.map(item => item.id)
  );
  assert.equal(persistence.repositories.revenueActions.insert, undefined);
});

test("tenant-bound API composition requires and verifies a server-injected context resolver", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7D417AC00B8E",
    subjectId: "auth0|member"
  });
  let boundContext;
  const service = {
    forTenant(received) {
      boundContext = received;
      return {
        async listRevenueActions() {
          return [];
        }
      };
    }
  };
  assert.throws(
    () => createApp({ revenueActionService: service }),
    /server-injected TenantContext resolver/
  );

  const forgedApp = createApp({
    revenueActionService: service,
    resolveTenantContext: () => ({ ...context })
  });
  const forgedResponse = await requestApp(forgedApp, "/api/revenue-actions");
  assert.equal(forgedResponse.status, 500);
  assert.equal(forgedResponse.data.error, "REVENUE_ACTION_PERSISTENCE_UNAVAILABLE");
  assert.equal(boundContext, undefined);

  const trustedApp = createApp({
    revenueActionService: service,
    resolveTenantContext: () => context
  });
  const trustedResponse = await requestApp(trustedApp, "/api/revenue-actions");
  assert.equal(trustedResponse.status, 200);
  assert.deepEqual(trustedResponse.data, { ok: true, data: [], count: 0 });
  assert.equal(boundContext, context);
});

test("injected PostgreSQL composition keeps RevenueAction effects and core routes on one tenant adapter", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00B8E",
    subjectId: "auth0|member"
  });
  const state = {
    opportunities: [{
      id: "postgres-composition-opportunity",
      business_name: "PostgreSQL Composition",
      stage: "QUALIFIED",
      priority: "HIGH",
      qualification_score: 80,
      value: 5000,
      probability: 0.5,
      weighted_value: 2500,
      next_action: "Create the durable next-step task",
      created_at: "2026-08-30T00:00:00.000Z",
      updated_at: "2026-08-30T00:00:00.000Z"
    }],
    prospects: [{
      id: "postgres-composition-prospect",
      business_name: "PostgreSQL Prospect",
      qualification: { score: 82, priority: "HIGH" },
      value_estimate: 3200
    }],
    tasks: [],
    activities: [],
    revenueActions: []
  };
  let boundCalls = 0;
  const find = (collection, id) =>
    state[collection].find(record => record.id === id) || null;
  const collectionRepository = name => ({
    async list(filters = {}) {
      return state[name].filter(record =>
        (!filters.opportunityId || record.opportunity_id === filters.opportunityId) &&
        (!filters.prospectId || record.prospect_id === filters.prospectId) &&
        (!filters.stage || record.stage === filters.stage)
      ).map(record => structuredClone(record));
    },
    async findById(id) {
      const record = find(name, id);
      return record ? structuredClone(record) : null;
    },
    async insert(record) {
      const created = {
        ...structuredClone(record),
        created_at: record.created_at || "2026-08-30T00:01:00.000Z",
        updated_at: record.updated_at || "2026-08-30T00:01:00.000Z"
      };
      state[name].push(created);
      return structuredClone(created);
    },
    async update(id, changes) {
      const record = find(name, id);
      if (!record) return null;
      Object.assign(record, structuredClone(changes));
      return structuredClone(record);
    }
  });
  const scoped = {
    prospects: collectionRepository("prospects"),
    opportunities: collectionRepository("opportunities"),
    tasks: collectionRepository("tasks"),
    activities: collectionRepository("activities"),
    revenueActions: {
      async list(filters = {}) {
        return state.revenueActions.filter(action =>
          !filters.opportunityId || action.opportunity_id === filters.opportunityId
        );
      },
      async findById(id) {
        return find("revenueActions", id);
      },
      async materialize({ id, opportunity_id }) {
        const opportunity = find("opportunities", opportunity_id);
        if (!opportunity) return null;
        const action = {
          id,
          opportunity_id,
          action_type: "CREATE_TASK",
          execution_type: "INTERNAL_TASK",
          status: "RECOMMENDED",
          title: opportunity.next_action,
          priority: "HIGH"
        };
        state.revenueActions.push(action);
        return { record: action, created: true, duplicate: false };
      },
      async transition(id, { to }) {
        const action = find("revenueActions", id);
        if (!action) return null;
        action.status = to;
        return { record: action, duplicate: false };
      },
      async executeAtomic(id) {
        const action = find("revenueActions", id);
        if (!action) return null;
        if (action.status === "EXECUTED") {
          return { record: action, duplicate: true, recovered: false };
        }
        const task = await scoped.tasks.insert({
          id: `${id}-task`,
          opportunity_id: action.opportunity_id,
          title: action.title,
          description: "Created by PostgreSQL RevenueAction",
          due_at: null,
          priority: action.priority,
          status: "OPEN",
          completed_at: null,
          metadata: { source: "revenue_action", revenue_action_id: id }
        });
        const activity = await scoped.activities.insert({
          id: `${id}-activity`,
          opportunity_id: action.opportunity_id,
          type: "REVENUE_ACTION_TASK_EXECUTED",
          description: `RevenueAction executed: ${action.title}`,
          metadata: {
            source: "revenue_action",
            revenue_action_id: id,
            task_id: task.id
          }
        });
        action.status = "EXECUTED";
        action.resulting_task_id = task.id;
        action.resulting_activity_id = activity.id;
        return { record: action, duplicate: false, recovered: false };
      }
    },
    async transaction(operation) {
      return operation(scoped);
    }
  };
  const persistence = {
    adapter: "postgres",
    forTenant(received) {
      assert.equal(received, context);
      boundCalls += 1;
      return scoped;
    }
  };
  const app = createApp({
    persistence,
    resolveTenantContext: () => context
  });

  const listedProspects = await requestApp(app, "/api/prospects");
  assert.equal(listedProspects.status, 200);
  assert.equal(listedProspects.data.storage, "postgres");
  assert.deepEqual(
    listedProspects.data.data.map(prospect => prospect.id),
    ["postgres-composition-prospect"]
  );

  const createdProspect = await requestApp(app, "/api/prospects", {
    method: "POST",
    body: {
      business_name: "PostgreSQL Created Prospect",
      service: "Commercial plumbing",
      location: "Melbourne"
    }
  });
  assert.equal(createdProspect.status, 201);
  assert.equal(createdProspect.data.storage, "postgres");
  assert.equal(createdProspect.data.data.qualification_status, "DISCOVERED");
  assert.equal(state.prospects.length, 2);

  const qualified = await requestApp(
    app,
    `/api/prospects/${createdProspect.data.data.id}/qualify`,
    { method: "POST", body: {} }
  );
  assert.equal(qualified.status, 200);
  assert.equal(qualified.data.data.id, createdProspect.data.data.id);
  assert.equal(typeof qualified.data.data.qualification_score, "number");
  assert.equal(
    qualified.data.data.qualification_status,
    qualified.data.data.qualification.priority
  );

  const preview = await requestApp(app, "/api/qualification/preview", {
    method: "POST",
    body: { business_name: "Preview", service: "Commercial electrical" }
  });
  assert.equal(preview.status, 200);
  assert.equal(typeof preview.data.data.score, "number");

  for (const method of ["GET", "POST"]) {
    const unsupportedLead = await requestApp(app, "/api/leads", {
      method,
      ...(method === "POST" ? { body: { business_name: "No JSON write" } } : {})
    });
    assert.equal(unsupportedLead.status, 501);
    assert.equal(
      unsupportedLead.data.error,
      "POSTGRES_LEAD_PERSISTENCE_UNSUPPORTED"
    );
  }

  const createdOpportunity = await requestApp(
    app,
    "/api/opportunities/from-prospect/postgres-composition-prospect",
    { method: "POST", body: {} }
  );
  assert.equal(createdOpportunity.status, 201);
  assert.equal(createdOpportunity.data.data.prospect_id, "postgres-composition-prospect");
  assert.equal(state.opportunities.length, 2);
  const opportunities = await requestApp(app, "/api/opportunities");
  assert.equal(opportunities.status, 200);
  assert.equal(opportunities.data.count, 2);

  const bodylessFollowUp = await requestApp(
    app,
    `/api/opportunities/${state.opportunities[0].id}/intelligence/follow-up`,
    { method: "POST" }
  );
  assert.equal(bodylessFollowUp.status, 400);
  assert.equal(bodylessFollowUp.data.ok, false);
  assert.equal(bodylessFollowUp.data.error, "INVALID_PRIORITY");

  const nullPriorityTask = await requestApp(
    app,
    `/api/opportunities/${state.opportunities[0].id}/intelligence/task`,
    {
      method: "POST",
      body: { priority: null, actionType: "RESEARCH" }
    }
  );
  assert.equal(nullPriorityTask.status, 400);
  assert.equal(nullPriorityTask.data.ok, false);
  assert.equal(nullPriorityTask.data.error, "INVALID_PRIORITY");

  const materialized = await requestApp(
    app,
    `/api/opportunities/${state.opportunities[0].id}/revenue-actions`,
    { method: "POST", body: {} }
  );
  assert.equal(materialized.status, 201);
  const actionId = materialized.data.data.id;
  await requestApp(app, `/api/revenue-actions/${actionId}/prepare`, {
    method: "POST", body: {}
  });
  await requestApp(app, `/api/revenue-actions/${actionId}/approve`, {
    method: "POST", body: {}
  });
  const executed = await requestApp(app, `/api/revenue-actions/${actionId}/execute`, {
    method: "POST", body: {}
  });
  assert.equal(executed.status, 200);
  assert.equal(executed.data.refreshed.opportunity.id, state.opportunities[0].id);

  const tasks = await requestApp(
    app,
    `/api/tasks/opportunity/${state.opportunities[0].id}`
  );
  assert.equal(tasks.status, 200);
  assert.equal(tasks.data.count, 1);
  assert.equal(tasks.data.data[0].id, executed.data.data.resulting_task_id);
  assert.equal(state.tasks.length, 1);

  const completed = await requestApp(app, `/api/tasks/${state.tasks[0].id}`, {
    method: "PATCH",
    body: { status: "COMPLETED" }
  });
  assert.equal(completed.status, 200);
  assert.equal(state.tasks[0].status, "COMPLETED");

  const refreshed = await requestApp(
    app,
    `/api/opportunities/${state.opportunities[0].id}/intelligence`
  );
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.data.opportunity.id, state.opportunities[0].id);
  const activities = await requestApp(
    app,
    `/api/opportunities/${state.opportunities[0].id}/activities`
  );
  assert.equal(activities.status, 200);
  assert.equal(activities.data.count, 2);

  const replay = await requestApp(app, `/api/revenue-actions/${actionId}/execute`, {
    method: "POST", body: {}
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.duplicate, true);
  assert.equal(state.tasks.length, 1);
  assert.ok(boundCalls >= 11);
});

test("PostgreSQL core locks parent rows before duplicate rechecks and reuses legacy semantic activities", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00B8E",
    subjectId: "auth0|member"
  });
  const events = [];
  const state = {
    prospects: [{
      id: "lock-prospect",
      business_name: "Lock Prospect",
      qualification_score: 75,
      qualification_status: "MEDIUM"
    }],
    opportunities: [{
      id: "lock-opportunity",
      business_name: "Lock Opportunity",
      stage: "QUALIFIED",
      probability: 0.2,
      next_action: "Define next action"
    }],
    tasks: [{
      id: "legacy-task",
      opportunity_id: "lock-opportunity",
      title: "Define next action",
      status: "OPEN"
    }],
    activities: [{
      id: "legacy-task-activity",
      opportunity_id: "lock-opportunity",
      type: "INTELLIGENCE_TASK_CREATED",
      description: "Intelligence task created: Define next action"
    }]
  };
  const repository = name => ({
    async list(filters = {}) {
      events.push(`${name}.list`);
      return state[name].filter(record =>
        (!filters.opportunityId || record.opportunity_id === filters.opportunityId) &&
        (!filters.prospectId || record.prospect_id === filters.prospectId)
      ).map(record => structuredClone(record));
    },
    async findById(id, options = {}) {
      events.push(`${name}.findById:${options.lock === true ? "lock" : "read"}`);
      const record = state[name].find(item => item.id === id);
      return record ? structuredClone(record) : null;
    },
    async insert(record) {
      events.push(`${name}.insert`);
      const created = {
        ...structuredClone(record),
        created_at: "2026-08-30T00:00:00.000Z",
        updated_at: "2026-08-30T00:00:00.000Z"
      };
      state[name].push(created);
      return structuredClone(created);
    },
    async update(id, patch) {
      events.push(`${name}.update`);
      const record = state[name].find(item => item.id === id);
      Object.assign(record, structuredClone(patch));
      return structuredClone(record);
    }
  });
  const scoped = {
    prospects: repository("prospects"),
    opportunities: repository("opportunities"),
    tasks: repository("tasks"),
    activities: repository("activities")
  };
  const service = createPostgresCoreService({
    persistence: {
      adapter: "postgres",
      forTenant(received) {
        assert.equal(received, context);
        return {
          ...scoped,
          transaction: operation => operation(scoped)
        };
      }
    },
    createId: (() => {
      let id = 0;
      return () => `generated-${++id}`;
    })(),
    clock: () => "2026-08-30T00:00:00.000Z"
  }).forTenant(context);

  events.length = 0;
  await service.createOpportunityFromProspect("lock-prospect");
  assert.ok(
    events.indexOf("prospects.findById:lock") <
      events.indexOf("opportunities.list")
  );

  events.length = 0;
  const taskResult = await service.createIntelligenceTask({
    opportunityId: "lock-opportunity",
    title: " define next action ",
    priority: "HIGH",
    actionType: "CREATE_TASK"
  });
  assert.equal(taskResult.duplicate, true);
  assert.equal(taskResult.task.id, "legacy-task");
  assert.equal(taskResult.activity.id, "legacy-task-activity");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.activities.length, 2);
  assert.ok(
    events.indexOf("opportunities.findById:lock") <
      events.indexOf("tasks.list")
  );

  const ordinaryDefault = await service.createIntelligenceTask({
    opportunityId: "lock-opportunity",
    title: "Research the decision process",
    actionType: "RESEARCH"
  });
  assert.equal(ordinaryDefault.task.priority, "MEDIUM");

  const bodylessFollowUp = await service.createIntelligenceTask({
    opportunityId: "lock-opportunity",
    followUp: true
  });
  assert.equal(bodylessFollowUp.ok, false);
  assert.equal(bodylessFollowUp.error, "INVALID_PRIORITY");
});

test("tenant-bound API routes await rejected persistence operations", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7D417AC00B8E",
    subjectId: "auth0|member"
  });
  const app = createApp({
    revenueActionService: {
      forTenant() {
        return {
          async listRevenueActions() {
            await Promise.resolve();
            throw new Error("async persistence failure");
          }
        };
      }
    },
    resolveTenantContext: () => context
  });
  const response = await requestApp(app, "/api/revenue-actions");
  assert.equal(response.status, 500);
  assert.equal(response.data.error, "REVENUE_ACTION_PERSISTENCE_UNAVAILABLE");
});

test("PostgreSQL service never reports an unknown transaction outcome as safe execution replay", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417AC00B8E",
    subjectId: "auth0|member"
  });
  const opportunity = {
    id: "committed-opportunity",
    business_name: "Committed Opportunity",
    stage: "QUALIFIED",
    value: 0,
    next_action: ""
  };
  const approved = {
    id: "committed-action",
    opportunity_id: opportunity.id,
    execution_type: "INTERNAL_TASK",
    status: "APPROVED"
  };
  const executed = {
    ...approved,
    status: "EXECUTED",
    resulting_task_id: "committed-task",
    resulting_activity_id: "committed-activity"
  };
  const ambiguous = new Error("commit response was lost");
  ambiguous.code = "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN";
  ambiguous.outcomeUnknown = true;
  ambiguous.details = { attemptedId: executed.id };
  ambiguous.failedAction = executed;
  const repositories = {
    revenueActions: {},
    async transaction(operation) {
      return operation({
        revenueActions: {
          async findById() {
            return approved;
          },
          async executeAtomic() {
            throw ambiguous;
          }
        },
        prospects: { list: async () => [] },
        opportunities: { list: async () => [opportunity] },
        tasks: { list: async () => [] },
        activities: { list: async () => [] }
      });
    }
  };
  const service = createPostgresRevenueActionService({
    persistence: {
      adapter: "postgres",
      forTenant(received) {
        assert.equal(received, context);
        return repositories;
      }
    }
  }).forTenant(context);

  const result = await service.executeRevenueAction(executed.id, {});

  assert.deepEqual(result, {
    ok: false,
    error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
    message: "commit response was lost",
    statusCode: 500,
    details: { attemptedId: executed.id }
  });
});

test("PostgreSQL service performs mutation, preread, and required refresh in one scoped transaction", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00B8E",
    subjectId: "auth0|member"
  });
  const opportunity = {
    id: "single-checkout-opportunity",
    business_name: "Single Checkout",
    stage: "QUALIFIED"
  };
  const action = {
    id: "generated-before-checkout",
    opportunity_id: opportunity.id,
    execution_type: "INTERNAL_TASK",
    status: "RECOMMENDED"
  };
  let transactionCount = 0;
  let receivedMaterializeInput;
  const scoped = {
    prospects: { list: async () => [] },
    opportunities: { list: async () => [opportunity] },
    tasks: { list: async () => [] },
    activities: { list: async () => [] },
    revenueActions: {
      async materialize(input) {
        receivedMaterializeInput = input;
        return { record: action, created: true, duplicate: false };
      }
    }
  };
  const repositories = {
    revenueActions: {
      materialize() {
        assert.fail("service must not open a public repository transaction");
      }
    },
    async transaction(operation) {
      transactionCount += 1;
      return operation(scoped);
    }
  };
  const service = createPostgresRevenueActionService({
    persistence: {
      adapter: "postgres",
      forTenant(received) {
        assert.equal(received, context);
        return repositories;
      }
    },
    createId: () => action.id,
    clock: () => "2026-08-30T04:00:00.000Z"
  }).forTenant(context);

  const result = await service.materializeRevenueAction(opportunity.id);

  assert.equal(transactionCount, 1);
  assert.deepEqual(receivedMaterializeInput, {
    id: action.id,
    opportunity_id: opportunity.id
  });
  assert.equal(result.ok, true);
  assert.equal(result.refreshed.opportunity.id, opportunity.id);
});

test("required PostgreSQL refresh failure rejects and rolls the request mutation back", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00B8E",
    subjectId: "auth0|member"
  });
  let durable = false;
  let transactionCount = 0;
  const refreshError = new Error("refresh failed");
  const repositories = {
    revenueActions: {},
    async transaction(operation) {
      transactionCount += 1;
      const before = durable;
      try {
        return await operation({
          revenueActions: {
            async transition() {
              durable = true;
              return {
                record: {
                  id: "refresh-rollback-action",
                  opportunity_id: "refresh-rollback-opportunity",
                  status: "PREPARED"
                },
                duplicate: false
              };
            }
          },
          prospects: { list: async () => { throw refreshError; } },
          opportunities: { list: async () => [] },
          tasks: { list: async () => [] },
          activities: { list: async () => [] }
        });
      } catch (error) {
        durable = before;
        throw error;
      }
    }
  };
  const service = createPostgresRevenueActionService({
    persistence: {
      adapter: "postgres",
      forTenant: () => repositories
    }
  }).forTenant(context);

  await assert.rejects(
    service.prepareRevenueAction("refresh-rollback-action"),
    refreshError
  );
  assert.equal(transactionCount, 1);
  assert.equal(durable, false);
});

test("tenant-bound HTTP normalizes an empty opportunity filter and preserves manual error details", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00B8E",
    subjectId: "auth0|member"
  });
  let receivedFilters;
  const service = {
    forTenant() {
      return {
        async listRevenueActions(filters) {
          receivedFilters = filters;
          return [];
        },
        async executeRevenueAction(id) {
          return {
            ok: false,
            error: "MANUAL_CONFIRMATION_REQUIRED",
            message: "Communication execution requires explicit manual confirmation.",
            statusCode: 400,
            details: { field: "executionMode", required: "MANUAL_CONFIRMED" }
          };
        }
      };
    }
  };
  const app = createApp({
    revenueActionService: service,
    resolveTenantContext: () => context
  });

  const listResponse = await requestApp(app, "/api/revenue-actions?opportunity_id=");
  assert.equal(listResponse.status, 200);
  assert.deepEqual(receivedFilters, { opportunityId: undefined });

  const executeResponse = await requestApp(
    app,
    "/api/revenue-actions/manual-action/execute",
    { method: "POST", body: {} }
  );
  assert.equal(executeResponse.status, 400);
  assert.deepEqual(executeResponse.data, {
    ok: false,
    error: "MANUAL_CONFIRMATION_REQUIRED",
    message: "Communication execution requires explicit manual confirmation.",
    details: { field: "executionMode", required: "MANUAL_CONFIRMED" }
  });
});

test("PostgreSQL HTTP preserves exact JSON recovery, manual, and effect conflict envelopes", async () => {
  const context = createTenantContext({
    tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00B8E",
    subjectId: "auth0|member"
  });
  const errors = {
    recovery: new PersistenceConflictError(
      "REVENUE_ACTION_RECOVERY_REQUIRED",
      "An interrupted revenue action has linked CRM effects and must be recovered before current advice can be materialized.",
      { id: "recovery-action", opportunityId: "recovery-opportunity" }
    ),
    manual: new PersistenceConflictError(
      "MANUAL_CONFIRMATION_REQUIRED",
      "Communication execution requires explicit manual confirmation.",
      { field: "executionMode", required: "MANUAL_CONFIRMED" }
    ),
    effect: new PersistenceConflictError(
      "REVENUE_ACTION_EFFECT_CONFLICT",
      "Linked CRM effects do not match this revenue action and cannot be reconciled.",
      { id: "effect-action", reason: "INVALID_LINKED_ACTIVITY" }
    )
  };
  const repositories = {
    revenueActions: {},
    async transaction(operation) {
      return operation({
        revenueActions: {
          async materialize() {
            throw errors.recovery;
          },
          async findById(id) {
            return {
              id,
              opportunity_id: "parity-opportunity",
              execution_type: id === "manual-action"
                ? "COMMUNICATION_DRAFT"
                : "INTERNAL_TASK"
            };
          },
          async executeAtomic(id) {
            throw id === "manual-action" ? errors.manual : errors.effect;
          }
        }
      });
    }
  };
  const service = createPostgresRevenueActionService({
    persistence: {
      adapter: "postgres",
      forTenant: () => repositories
    }
  });
  const app = createApp({
    revenueActionService: service,
    resolveTenantContext: () => context
  });

  const recovery = await requestApp(
    app,
    "/api/opportunities/recovery-opportunity/revenue-actions",
    { method: "POST", body: {} }
  );
  assert.equal(recovery.status, 409);
  assert.deepEqual(recovery.data, {
    ok: false,
    error: "REVENUE_ACTION_RECOVERY_REQUIRED",
    message: "An interrupted revenue action has linked CRM effects and must be recovered before current advice can be materialized.",
    details: { id: "recovery-action", opportunityId: "recovery-opportunity" }
  });

  const manual = await requestApp(
    app,
    "/api/revenue-actions/manual-action/execute",
    { method: "POST", body: {} }
  );
  assert.equal(manual.status, 400);
  assert.deepEqual(manual.data, {
    ok: false,
    error: "MANUAL_CONFIRMATION_REQUIRED",
    message: "Communication execution requires explicit manual confirmation.",
    details: { field: "executionMode", required: "MANUAL_CONFIRMED" }
  });

  const effect = await requestApp(
    app,
    "/api/revenue-actions/effect-action/execute",
    { method: "POST", body: {} }
  );
  assert.equal(effect.status, 409);
  assert.deepEqual(effect.data, {
    ok: false,
    error: "REVENUE_ACTION_EFFECT_CONFLICT",
    message: "Linked CRM effects do not match this revenue action and cannot be reconciled.",
    details: { id: "effect-action", reason: "INVALID_LINKED_ACTIVITY" }
  });
});

function buildStoredRevenueAction({ status = "RECOMMENDED" } = {}) {
  const createdAt = "2026-08-30T00:00:00.000Z";
  const preparedAt = "2026-08-30T00:01:00.000Z";
  const approvedAt = "2026-08-30T00:02:00.000Z";
  const requestedAt = "2026-08-30T00:03:00.000Z";
  const executedAt = "2026-08-30T00:04:00.000Z";
  const recommendation = {
    type: "CREATE_TASK",
    priority: "HIGH",
    title: "Create the next-step task",
    reason: "The opportunity needs a durable next step.",
    taskTitle: "Create the next-step task"
  };
  const evidence = { factual: {}, derived: {} };
  const action = {
    id: "stored-integrity-action",
    opportunity_id: "stored-integrity-opportunity",
    action_type: recommendation.type,
    execution_type: "INTERNAL_TASK",
    approval_requirement: "HUMAN",
    risk_class: "INTERNAL",
    status: "RECOMMENDED",
    priority: recommendation.priority,
    title: recommendation.title,
    reason: recommendation.reason,
    evidence,
    recommendation_snapshot: {
      action_type: recommendation.type,
      priority: recommendation.priority,
      title: recommendation.title,
      reason: recommendation.reason,
      task_title: recommendation.taskTitle,
      evidence: structuredClone(evidence),
      generated_at: createdAt
    },
    basis_fingerprint: fingerprint(recommendationBasis(
      { opportunity: { id: "stored-integrity-opportunity" } },
      recommendation,
      evidence
    )),
    proposed_execution: null,
    execution_request: null,
    execution_result: null,
    source: "DEAL_INTELLIGENCE",
    audit: [{
      transition: "CREATED_AS_RECOMMENDED",
      at: createdAt,
      source: "DEAL_INTELLIGENCE"
    }],
    execution_attempts: 0,
    prepared_at: null,
    approved_at: null,
    executed_at: null,
    rejected_at: null,
    cancelled_at: null,
    failed_at: null,
    rejection_reason: null,
    resulting_task_id: null,
    resulting_activity_id: null,
    created_at: createdAt,
    updated_at: createdAt
  };

  if (status !== "EXECUTED") return action;
  action.status = "EXECUTED";
  action.proposed_execution = buildProposedExecution(action);
  action.execution_request = {
    mode: "SYSTEM_INTERNAL",
    requested_at: requestedAt
  };
  action.execution_result = {
    mode: "SYSTEM_INTERNAL",
    outcome: "TASK_CREATED",
    external_send_performed: false
  };
  action.execution_attempts = 1;
  action.prepared_at = preparedAt;
  action.approved_at = approvedAt;
  action.executed_at = executedAt;
  action.resulting_task_id = "stored-integrity-task";
  action.resulting_activity_id = "stored-integrity-activity";
  action.updated_at = executedAt;
  action.audit.push(
    { transition: "PREPARED", at: preparedAt },
    { transition: "APPROVED", at: approvedAt, approval: "HUMAN" },
    { transition: "EXECUTION_STARTED", at: requestedAt, attempt: 1 },
    {
      transition: "EXECUTED",
      at: executedAt,
      execution_mode: "SYSTEM_INTERNAL",
      resulting_task_id: action.resulting_task_id,
      resulting_activity_id: action.resulting_activity_id
    }
  );
  return action;
}

async function requestApp(app, pathname, { method = "GET", body } = {}) {
  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${pathname}`,
      {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      }
    );
    return { status: response.status, data: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
