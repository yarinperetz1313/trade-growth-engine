const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const {
  createPersistence
} = require("../../src/persistence/createPersistence");
const {
  createApp
} = require("../../src/app/server");
const {
  createTenantContext
} = require("../../src/persistence/tenantContext");
const {
  createPostgresRepositories
} = require("../../src/persistence/postgres/repositories");
const {
  createPostgresCoreService
} = require("../../src/persistence/postgres/coreService");
const {
  hashImportEvidence,
  parseCsvUpload
} = require("../../src/imports/csvParser");
const {
  buildCanonicalCommitPlan
} = require("../../src/imports/importCommit");
const {
  activityToRow,
  encodeColumnValue,
  opportunityToRow,
  prospectToRow,
  revenueActionToRow,
  taskToRow
} = require("../../src/persistence/postgres/mappers");
const {
  buildDealIntelligenceFromData
} = require("../../src/intelligence/dealIntelligence");
const {
  buildRevenueIntelligence
} = require("../../src/intelligence/revenueIntelligence");
const {
  calculateRevenueActionBasis
} = require("../../src/revenueActions/revenueActionBasis");

function registerPostgresRepositoryContractTests({
  test,
  Pool,
  runtimeUrl,
  getAdminClient,
  readFixtures
}) {
  const pools = new Set();

  function createPool(options = {}) {
    const pool = new Pool({
      connectionString: runtimeUrl,
      max: options.max ?? 4
    });
    pools.add(pool);
    return pool;
  }

  async function createTenant(label) {
    const tenantId = randomUUID();
    const subjectId = `auth0|${label}-${randomUUID()}`;
    await getAdminClient().query(
      `insert into tge.tenants (id, slug, name) values ($1, $2, $3)`,
      [tenantId, `${label}-${tenantId}`, `Repository ${label}`]
    );
    await getAdminClient().query(
      `
        insert into tge.tenant_memberships (tenant_id, subject_id, role)
        values ($1, $2, 'OWNER')
      `,
      [tenantId, subjectId]
    );
    return {
      tenantId,
      context: createTenantContext({ tenantId, subjectId })
    };
  }

  async function withApp(app, operation) {
    const server = app.listen(0);
    try {
      await new Promise(resolve => server.once("listening", resolve));
      await operation(`http://127.0.0.1:${server.address().port}`);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  async function request(baseUrl, method, pathname, body, headers = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }

  async function seedRevenueActionFixture(tenantId, record, sourceOrdinal) {
    await insertMappedFixture(
      getAdminClient(),
      tenantId,
      "revenue_actions",
      revenueActionToRow(record, { sourceOrdinal })
    );
  }

  async function insertMappedFixture(client, tenantId, table, mapped) {
    const entries = Object.entries(mapped);
    const columns = ["tenant_id", ...entries.map(([column]) => column)];
    const values = [
      tenantId,
      ...entries.map(([column, value]) => encodeColumnValue(column, value))
    ];
    const placeholders = values.map((_, index) => `$${index + 1}`);
    await client.query(
      `insert into tge.${table} (${columns.join(", ")})
       values (${placeholders.join(", ")})`,
      values
    );
  }

  function timestampAfterLastAudit(action, milliseconds = 1000) {
    const lastAuditAt = action.audit.at(-1)?.at;
    return new Date(Date.parse(lastAuditAt) + milliseconds).toISOString();
  }

  async function seedFixtureSnapshot(tenantId, fixtures) {
    const client = getAdminClient();
    const collections = [
      ["prospects", prospectToRow],
      ["opportunities", opportunityToRow],
      ["tasks", taskToRow],
      ["activities", activityToRow],
      ["revenue_actions", revenueActionToRow]
    ];
    await client.query("begin");
    try {
      for (const [collection, mapper] of collections) {
        for (const [sourceOrdinal, record] of fixtures[collection].entries()) {
          await insertMappedFixture(
            client,
            tenantId,
            collection,
            mapper(record, { sourceOrdinal })
          );
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  async function seedCommittedExecutionEffects({
    tenantId,
    action,
    malformed = false,
    taskOnly = false,
    omitOpportunityMutation = false
  }) {
    const client = getAdminClient();
    const startedAt = timestampAfterLastAudit(action);
    const failedAt = timestampAfterLastAudit(action, 2000);
    const taskId = `${action.id}-task`;
    const activityId = `${action.id}-activity`;
    const proposal = action.proposed_execution;
    const taskMetadata = {
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      execution_effect_type: "INTERNAL_TASK",
      normalized_title: malformed ? "malformed task" : proposal.normalized_title,
      semantic_task_key: malformed
        ? `${action.opportunity_id}:${action.action_type}:malformed-task`
        : proposal.semantic_task_key
    };
    const activityMetadata = {
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      action_key: `revenue-action:${action.id}`,
      execution_mode: "SYSTEM_INTERNAL",
      execution_effect_type: "INTERNAL_TASK",
      task_id: taskId
    };

    await client.query("begin");
    try {
      await client.query(
        `insert into tge.tasks (
           tenant_id, id, opportunity_id, revenue_action_id, title,
           description, due_at, priority, status, metadata, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9::jsonb, $10, $10)`,
        [
          tenantId,
          taskId,
          action.opportunity_id,
          action.id,
          malformed ? "Malicious task" : proposal.title,
          proposal.description,
          proposal.due_at,
          proposal.priority,
          JSON.stringify(taskMetadata),
          startedAt
        ]
      );
      if (!taskOnly) {
        await client.query(
          `insert into tge.activities (
             tenant_id, id, opportunity_id, revenue_action_id, type,
             description, metadata, created_at, updated_at
           ) values ($1, $2, $3, $4, 'REVENUE_ACTION_TASK_EXECUTED',
             $5, $6::jsonb, $7, $7)`,
          [
            tenantId,
            activityId,
            action.opportunity_id,
            action.id,
            `Revenue action created internal task: ${proposal.title}`,
            JSON.stringify(activityMetadata),
            startedAt
          ]
        );
      }
      if (
        action.action_type === "CREATE_TASK" &&
        !taskOnly &&
        !omitOpportunityMutation
      ) {
        await client.query(
          `update tge.opportunities set next_action = $3, updated_at = $4
           where tenant_id = $1 and id = $2`,
          [tenantId, action.opportunity_id, malformed ? "Malicious task" : proposal.title, startedAt]
        );
      }
      await client.query(
        `update tge.revenue_actions
         set status = 'FAILED', failed_at = $3,
           execution_request = $4::jsonb,
           execution_result = $5::jsonb,
           audit = $6::jsonb,
           execution_attempts = 1,
           resulting_task_id = $7, resulting_activity_id = $8,
           updated_at = $3
         where tenant_id = $1 and id = $2`,
        [
          tenantId,
          action.id,
          failedAt,
          JSON.stringify({ mode: "SYSTEM_INTERNAL", requested_at: startedAt }),
          JSON.stringify({
            mode: "SYSTEM_INTERNAL",
            outcome: "FAILED",
            external_send_performed: false,
            error: "EXECUTION_EFFECT_FAILED"
          }),
          JSON.stringify([
            ...action.audit,
            { transition: "EXECUTION_STARTED", at: startedAt, attempt: 1 },
            { transition: "FAILED", at: failedAt, error: "EXECUTION_EFFECT_FAILED" }
          ]),
          taskId,
          taskOnly ? null : activityId
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  async function seedCommittedCommunicationEffect({ tenantId, action }) {
    const client = getAdminClient();
    const startedAt = timestampAfterLastAudit(action);
    const failedAt = timestampAfterLastAudit(action, 2000);
    const activityId = `${action.id}-manual-activity`;
    await client.query("begin");
    try {
      await client.query(
        `insert into tge.activities (
           tenant_id, id, opportunity_id, revenue_action_id, type,
           description, metadata, created_at, updated_at
         ) values ($1, $2, $3, $4, 'REVENUE_ACTION_MANUALLY_CONFIRMED',
           $5, $6::jsonb, $7, $7)`,
        [
          tenantId,
          activityId,
          action.opportunity_id,
          action.id,
          "User confirmed the recommended follow-up was completed manually.",
          JSON.stringify({
            source: "revenue_action",
            revenue_action_id: action.id,
            action_type: action.action_type,
            action_key: `revenue-action:${action.id}`,
            execution_mode: "MANUAL_CONFIRMED",
            execution_effect_type: "COMMUNICATION_MANUAL_CONFIRMATION",
            channel: action.proposed_execution.channel
          }),
          startedAt
        ]
      );
      await client.query(
        `update tge.revenue_actions
         set status = 'FAILED', failed_at = $3,
           execution_request = $4::jsonb,
           execution_result = $5::jsonb,
           audit = $6::jsonb,
           execution_attempts = 1,
           resulting_activity_id = $7, updated_at = $3
         where tenant_id = $1 and id = $2`,
        [
          tenantId,
          action.id,
          failedAt,
          JSON.stringify({ mode: "MANUAL_CONFIRMED", requested_at: startedAt }),
          JSON.stringify({
            mode: "MANUAL_CONFIRMED",
            outcome: "FAILED",
            external_send_performed: false,
            error: "EXECUTION_EFFECT_FAILED"
          }),
          JSON.stringify([
            ...action.audit,
            { transition: "EXECUTION_STARTED", at: startedAt, attempt: 1 },
            { transition: "FAILED", at: failedAt, error: "EXECUTION_EFFECT_FAILED" }
          ]),
          activityId
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  async function seedExecutingAttempt({ tenantId, action, taskOnly = false }) {
    const client = getAdminClient();
    const requestedAt = timestampAfterLastAudit(action);
    const taskId = taskOnly ? `${action.id}-resumed-task` : null;
    await client.query("begin");
    try {
      if (taskId) {
        const proposal = action.proposed_execution;
        await client.query(
          `insert into tge.tasks (
             tenant_id, id, opportunity_id, revenue_action_id, title,
             description, due_at, priority, status, metadata, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9::jsonb, $10, $10)`,
          [
            tenantId,
            taskId,
            action.opportunity_id,
            action.id,
            proposal.title,
            proposal.description,
            proposal.due_at,
            proposal.priority,
            JSON.stringify({
              source: "revenue_action",
              revenue_action_id: action.id,
              action_type: action.action_type,
              execution_effect_type: "INTERNAL_TASK",
              normalized_title: proposal.normalized_title,
              semantic_task_key: proposal.semantic_task_key
            }),
            requestedAt
          ]
        );
      }
      await client.query(
        `update tge.revenue_actions
         set status = 'EXECUTING', execution_request = $3::jsonb,
           execution_result = null, execution_attempts = 1,
           resulting_task_id = $4, resulting_activity_id = null,
           failed_at = null, audit = $5::jsonb, updated_at = $6
         where tenant_id = $1 and id = $2`,
        [
          tenantId,
          action.id,
          JSON.stringify({ mode: "SYSTEM_INTERNAL", requested_at: requestedAt }),
          taskId,
          JSON.stringify([
            ...action.audit,
            { transition: "EXECUTION_STARTED", at: requestedAt, attempt: 1 }
          ]),
          requestedAt
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    return { requestedAt, taskId };
  }

  test("PostgreSQL repositories provide tenant-scoped CRUD and immutable RevenueAction lifecycle updates", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context, tenantId } = await createTenant("crud");

    const prospect = await repositories.prospects.insert(context, {
      id: "repo-prospect",
      business_name: "Repository Prospect",
      website: "https://example.test",
      metadata: { preserved: true },
      unknown_field: "keep-me",
      created_at: "2026-01-01T01:00:00.000Z",
      updated_at: "2026-01-02T02:00:00.000Z"
    });
    const opportunity = await repositories.opportunities.insert(context, {
      id: "repo-opportunity",
      prospect_id: prospect.id,
      business_name: prospect.business_name,
      stage: "QUALIFIED",
      value: 12000,
      probability: 0.5,
      weighted_value: 6000,
      next_action: "Initial action"
    });
    const task = await repositories.tasks.insert(context, {
      id: "repo-task",
      opportunity_id: opportunity.id,
      title: "Work repository task",
      status: "IN_PROGRESS"
    });
    const activity = await repositories.activities.insert(context, {
      id: "repo-activity",
      opportunity_id: opportunity.id,
      prospect_id: prospect.id,
      type: "REPOSITORY_TEST",
      description: "Created through PostgreSQL repository"
    });
    const action = (await repositories.revenueActions.materialize(context, {
      id: "repo-action",
      opportunity_id: opportunity.id
    })).record;

    assert.equal(prospect.unknown_field, "keep-me");
    assert.equal(opportunity.value, 12000);
    assert.equal(task.status, "IN_PROGRESS");
    assert.equal(activity.prospect_id, prospect.id);
    assert.equal(action.status, "RECOMMENDED");

    const prepared = await repositories.revenueActions.transition(
      context,
      action.id,
      {
        to: "PREPARED",
        proposedExecution: buildTaskProposal(action)
      }
    );
    await assert.rejects(
      repositories.revenueActions.transition(context, action.id, {
        to: "APPROVED",
        at: "1999-01-01T00:00:00.000Z",
        auditTransition: "CALLER_AUTHORED"
      }),
      error => error.code === "REVENUE_ACTION_AUDIT_OVERRIDE_FORBIDDEN"
    );
    const approved = await repositories.revenueActions.transition(
      context,
      action.id,
      { to: "APPROVED", metadata: { request_id: "crud-approval" } }
    );
    const legacyBeforeUpdate = await getAdminClient().query(
      `select legacy_payload from tge.prospects
       where tenant_id = $1 and id = $2`,
      [tenantId, prospect.id]
    );
    const updatedProspect = await repositories.prospects.update(
      context,
      prospect.id,
      { business_name: "Updated Repository Prospect" }
    );
    const updatedOpportunity = await repositories.opportunities.update(
      context,
      opportunity.id,
      { next_action: "Updated action" }
    );
    const updatedTask = await repositories.tasks.update(context, task.id, {
      status: "OPEN"
    });
    const updatedActivity = await repositories.activities.update(
      context,
      activity.id,
      { description: "Updated through repository" }
    );
    assert.equal(updatedProspect.business_name, "Updated Repository Prospect");
    assert.equal(updatedProspect.unknown_field, "keep-me");
    const sourceTimestamps = await getAdminClient().query(
      `select source_created_at, source_updated_at, updated_at, legacy_payload
       from tge.prospects where tenant_id = $1 and id = $2`,
      [tenantId, prospect.id]
    );
    assert.equal(
      sourceTimestamps.rows[0].source_created_at.toISOString(),
      "2026-01-01T01:00:00.000Z"
    );
    assert.equal(
      sourceTimestamps.rows[0].source_updated_at.toISOString(),
      "2026-01-02T02:00:00.000Z"
    );
    assert.notEqual(
      sourceTimestamps.rows[0].updated_at.toISOString(),
      sourceTimestamps.rows[0].source_updated_at.toISOString()
    );
    assert.deepEqual(
      sourceTimestamps.rows[0].legacy_payload,
      legacyBeforeUpdate.rows[0].legacy_payload
    );
    assert.equal(updatedOpportunity.next_action, "Updated action");
    assert.equal(updatedTask.status, "OPEN");
    assert.equal(updatedActivity.description, "Updated through repository");
    assert.equal(prepared.record.status, "PREPARED");
    assert.equal(approved.record.status, "APPROVED");
    assert.deepEqual(approved.record.audit.at(-1), {
      transition: "APPROVED",
      at: approved.record.approved_at,
      request_id: "crud-approval",
      approval: "HUMAN",
      subject_id: context.subjectId
    });
    assert.equal(
      approved.record.recommendation_snapshot.title,
      action.recommendation_snapshot.title
    );
    assert.equal(repositories.revenueActions.update, undefined);
    assert.equal(repositories.revenueActions.delete, undefined);
    assert.equal(repositories.revenueActions.insert, undefined);

    assert.deepEqual(
      (await repositories.tasks.list(context, {
        opportunityId: opportunity.id
      })).map(record => record.id),
      [task.id]
    );

    const deleteActivity = await repositories.activities.insert(context, {
      id: "delete-activity",
      opportunity_id: opportunity.id,
      type: "DELETE_TEST"
    });
    const deleteTask = await repositories.tasks.insert(context, {
      id: "delete-task",
      opportunity_id: opportunity.id,
      title: "Delete test",
      status: "OPEN"
    });
    const deleteOpportunity = await repositories.opportunities.insert(context, {
      id: "delete-opportunity",
      business_name: "Delete Opportunity",
      stage: "NEW"
    });
    const deleteProspect = await repositories.prospects.insert(context, {
      id: "delete-prospect",
      business_name: "Delete Prospect"
    });
    assert.equal(
      await repositories.activities.delete(context, deleteActivity.id),
      true
    );
    assert.equal(await repositories.tasks.delete(context, deleteTask.id), true);
    assert.equal(
      await repositories.opportunities.delete(context, deleteOpportunity.id),
      true
    );
    assert.equal(
      await repositories.prospects.delete(context, deleteProspect.id),
      true
    );
  });

  test("PostgreSQL CRUD distinguishes absent defaults from malformed evidence and preserves compatible ID/timestamp mutation", async () => {
    const pool = createPool();
    const serverNow = "2026-08-30T03:00:00.000Z";
    const repositories = createPostgresRepositories({
      pool,
      clock: () => serverNow
    });
    const { context, tenantId } = await createTenant("mutation-compat");
    const defaulted = await repositories.prospects.insert(context, {
      business_name: "Server defaults"
    });
    assert.ok(defaulted.id);
    assert.equal(defaulted.created_at, serverNow);
    assert.equal(defaulted.updated_at, serverNow);
    const historical = await repositories.prospects.insert(context, {
      id: "historical-created-at",
      business_name: "Historical created at",
      created_at: "2025-01-01T00:00:00.000Z"
    });
    assert.equal(historical.created_at, "2025-01-01T00:00:00.000Z");
    assert.equal(historical.updated_at, serverNow);
    const inserted = await repositories.prospects.insert(context, {
      id: "mutable-source-id",
      business_name: "Mutable source",
      unknown_field: "immutable import evidence",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z"
    });
    const rawBefore = await getAdminClient().query(
      `select legacy_payload, current_payload, source_created_at, source_updated_at
       from tge.prospects where tenant_id = $1 and id = $2`,
      [tenantId, inserted.id]
    );

    const updated = await repositories.prospects.update(context, inserted.id, {
      id: "mutated-source-id",
      created_at: "2025-12-31T23:00:00.000Z",
      business_name: "Mutated source"
    });
    assert.equal(updated.id, "mutated-source-id");
    assert.equal(updated.created_at, "2025-12-31T23:00:00.000Z");
    assert.notEqual(updated.updated_at, inserted.updated_at);
    assert.equal(
      await repositories.prospects.findById(context, inserted.id),
      null
    );
    const rawAfter = await getAdminClient().query(
      `select legacy_payload, current_payload, source_created_at, source_updated_at
       from tge.prospects where tenant_id = $1 and id = $2`,
      [tenantId, updated.id]
    );
    assert.deepEqual(rawAfter.rows[0].legacy_payload, rawBefore.rows[0].legacy_payload);
    assert.deepEqual(
      {
        source_created_at: rawAfter.rows[0].source_created_at,
        source_updated_at: rawAfter.rows[0].source_updated_at
      },
      {
        source_created_at: rawBefore.rows[0].source_created_at,
        source_updated_at: rawBefore.rows[0].source_updated_at
      }
    );
    assert.equal(rawAfter.rows[0].current_payload.business_name, "Mutated source");
    assert.equal(
      rawAfter.rows[0].current_payload.unknown_field,
      "immutable import evidence"
    );

    const referenced = await repositories.prospects.insert(context, {
      id: "referenced-source-id",
      business_name: "Referenced source"
    });
    await repositories.opportunities.insert(context, {
      id: "referencing-opportunity",
      prospect_id: referenced.id,
      business_name: "Referencing opportunity",
      stage: "NEW"
    });
    await assert.rejects(
      repositories.prospects.update(context, referenced.id, {
        id: "forbidden-linked-id"
      }),
      error => error.code === "23503"
    );
    assert.equal(
      (await repositories.prospects.findById(context, referenced.id)).id,
      referenced.id
    );

    for (const [field, value, code] of [
      ["id", "", "RECORD_ID_INVALID"],
      ["id", null, "RECORD_ID_INVALID"],
      ["created_at", "", "RECORD_TIMESTAMP_INVALID"],
      ["created_at", "not-a-time", "RECORD_TIMESTAMP_INVALID"],
      ["updated_at", null, "RECORD_TIMESTAMP_INVALID"]
    ]) {
      await assert.rejects(
        async () => repositories.prospects.insert(context, {
          id: `invalid-${field}-${String(value)}`,
          business_name: "Invalid evidence",
          [field]: value
        }),
        error => error.code === code,
        `${field}:${String(value)}`
      );
    }
    const unknownUpdated = await repositories.prospects.update(
      context,
      updated.id,
      { unknown_field: "caller mutation" }
    );
    assert.equal(unknownUpdated.unknown_field, "caller mutation");
    const rawUnknownUpdated = await getAdminClient().query(
      `select legacy_payload, current_payload from tge.prospects
       where tenant_id = $1 and id = $2`,
      [tenantId, updated.id]
    );
    assert.deepEqual(
      rawUnknownUpdated.rows[0].legacy_payload,
      rawBefore.rows[0].legacy_payload
    );
    assert.equal(
      rawUnknownUpdated.rows[0].current_payload.unknown_field,
      "caller mutation"
    );

    const shaped = await repositories.prospects.insert(context, {
      id: "mutable-json-shape",
      business_name: "Mutable JSON shape",
      evidence: null,
      metadata: null,
      unknown_shape: null
    });
    assert.equal(shaped.evidence, null);
    assert.equal(shaped.metadata, null);
    assert.equal(shaped.unknown_shape, null);
    const reshaped = await repositories.prospects.update(context, shaped.id, {
      evidence: [],
      metadata: {},
      unknown_shape: ""
    });
    assert.deepEqual(reshaped.evidence, []);
    assert.deepEqual(reshaped.metadata, {});
    assert.equal(reshaped.unknown_shape, "");
    const rawShape = await getAdminClient().query(
      `select legacy_payload, current_payload from tge.prospects
       where tenant_id = $1 and id = $2`,
      [tenantId, shaped.id]
    );
    assert.deepEqual(rawShape.rows[0].legacy_payload, {
      id: "mutable-json-shape",
      business_name: "Mutable JSON shape",
      evidence: null,
      metadata: null,
      unknown_shape: null,
      created_at: serverNow,
      updated_at: serverNow
    });
    assert.deepEqual(rawShape.rows[0].current_payload.evidence, []);
    assert.deepEqual(rawShape.rows[0].current_payload.metadata, {});
    assert.equal(rawShape.rows[0].current_payload.unknown_shape, "");

    await repositories.opportunities.insert(context, {
      id: "effect-evidence-opportunity",
      business_name: "Effect evidence",
      stage: "QUALIFIED"
    });
    await assert.rejects(
      repositories.activities.insert(context, {
        id: "caller-authored-effect",
        opportunity_id: "effect-evidence-opportunity",
        type: "CALLER_AUTHORED",
        metadata: {
          source: "revenue_action",
          revenue_action_id: "invented-action"
        }
      }),
      error => error.code === "REVENUE_ACTION_EFFECT_EVIDENCE_FORBIDDEN"
    );
  });

  test("PostgreSQL lifecycle audits derive protected fields and normalize rejection evidence", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("audit-derivation");
    await repositories.opportunities.insert(context, {
      id: "audit-opportunity",
      business_name: "Audit opportunity",
      stage: "QUALIFIED",
      value: 0,
      next_action: ""
    });
    const action = (await repositories.revenueActions.materialize(context, {
      id: "audit-action",
      opportunity_id: "audit-opportunity"
    })).record;
    await repositories.revenueActions.transition(context, action.id, {
      to: "PREPARED"
    });
    await assert.rejects(
      repositories.revenueActions.transition(context, action.id, {
        to: "REJECTED",
        metadata: { approval: "SYSTEM" }
      }),
      error => error.code === "REVENUE_ACTION_AUDIT_METADATA_FORBIDDEN"
    );
    const rejected = await repositories.revenueActions.transition(
      context,
      action.id,
      {
        to: "REJECTED",
        rejectionReason: "  Not   appropriate   now.  ",
        metadata: { note: "operator supplied context" }
      }
    );
    assert.equal(rejected.record.rejection_reason, "Not appropriate now.");
    assert.deepEqual(rejected.record.audit.at(-1), {
      transition: "REJECTED",
      at: rejected.record.rejected_at,
      note: "operator supplied context",
      reason: "Not appropriate now.",
      subject_id: context.subjectId
    });

    await repositories.opportunities.insert(context, {
      id: "cancel-opportunity",
      business_name: "Cancel opportunity",
      stage: "QUALIFIED",
      next_action: ""
    });
    const cancellable = (await repositories.revenueActions.materialize(
      context,
      { id: "cancel-action", opportunity_id: "cancel-opportunity" }
    )).record;
    const cancelled = await repositories.revenueActions.transition(
      context,
      cancellable.id,
      { to: "CANCELLED" }
    );
    const replay = await repositories.revenueActions.transition(
      context,
      cancellable.id,
      { to: "CANCELLED" }
    );
    assert.equal(cancelled.duplicate, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.record.audit.length, cancelled.record.audit.length);
    assert.deepEqual(cancelled.record.audit.at(-1), {
      transition: "CANCELLED",
      at: cancelled.record.cancelled_at,
      subject_id: context.subjectId
    });
  });

  test("PostgreSQL repositories reject missing context and make cross-tenant IDs indistinguishable", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const tenantA = await createTenant("isolation-a");
    const tenantB = await createTenant("isolation-b");

    for (const name of [
      "prospects",
      "opportunities",
      "tasks",
      "activities",
      "revenueActions"
    ]) {
      await assert.rejects(
        repositories[name].list(),
        error => error.code === "TENANT_CONTEXT_REQUIRED",
        name
      );
    }
    await assert.rejects(
      repositories.prospects.list({
        tenantId: tenantA.tenantId,
        subjectId: "auth0|forged"
      }),
      error => error.code === "TENANT_CONTEXT_REQUIRED"
    );

    await repositories.prospects.insert(tenantA.context, {
      id: "same-id",
      business_name: "Tenant A"
    });
    await repositories.prospects.insert(tenantB.context, {
      id: "same-id",
      business_name: "Tenant B"
    });
    await repositories.prospects.insert(tenantB.context, {
      id: "tenant-b-only",
      business_name: "Tenant B only"
    });
    await repositories.opportunities.insert(tenantB.context, {
      id: "tenant-b-opportunity",
      business_name: "Tenant B opportunity",
      stage: "QUALIFIED",
      value: 0,
      next_action: ""
    });
    await repositories.tasks.insert(tenantB.context, {
      id: "tenant-b-task",
      opportunity_id: "tenant-b-opportunity",
      title: "Tenant B task",
      status: "OPEN"
    });
    await repositories.activities.insert(tenantB.context, {
      id: "tenant-b-activity",
      opportunity_id: "tenant-b-opportunity",
      type: "TENANT_B_ONLY"
    });
    const tenantBAction = (await repositories.revenueActions.materialize(
      tenantB.context,
      { id: "tenant-b-action", opportunity_id: "tenant-b-opportunity" }
    )).record;

    assert.equal(
      (await repositories.prospects.findById(tenantA.context, "same-id"))
        .business_name,
      "Tenant A"
    );
    assert.equal(
      await repositories.prospects.findById(tenantA.context, "tenant-b-only"),
      null
    );
    assert.equal(
      await repositories.prospects.findById(tenantA.context, "does-not-exist"),
      null
    );
    assert.equal(
      await repositories.prospects.update(
        tenantA.context,
        "tenant-b-only",
        { business_name: "Forbidden" }
      ),
      null
    );
    assert.equal(
      await repositories.prospects.delete(tenantA.context, "tenant-b-only"),
      false
    );
    await assert.rejects(
      async () => repositories.prospects.insert(tenantA.context, {
        tenant_id: tenantB.tenantId,
        id: "caller-tenant",
        business_name: "Forbidden"
      }),
      error => error.code === "TENANT_FIELD_FORBIDDEN"
    );

    for (const [repository, crossTenantId, missingId] of [
      [repositories.opportunities, "tenant-b-opportunity", "missing-opportunity"],
      [repositories.tasks, "tenant-b-task", "missing-task"],
      [repositories.activities, "tenant-b-activity", "missing-activity"],
      [repositories.revenueActions, tenantBAction.id, "missing-action"]
    ]) {
      assert.equal(
        await repository.findById(tenantA.context, crossTenantId),
        await repository.findById(tenantA.context, missingId)
      );
    }
    assert.equal(
      await repositories.revenueActions.transition(
        tenantA.context,
        tenantBAction.id,
        { to: "PREPARED" }
      ),
      await repositories.revenueActions.transition(
        tenantA.context,
        "missing-action",
        { to: "PREPARED" }
      )
    );
    assert.equal(
      await repositories.revenueActions.executeAtomic(
        tenantA.context,
        tenantBAction.id
      ),
      await repositories.revenueActions.executeAtomic(
        tenantA.context,
        "missing-action"
      )
    );
    assert.equal(
      await repositories.revenueActions.materialize(tenantA.context, {
        opportunity_id: "tenant-b-opportunity"
      }),
      await repositories.revenueActions.materialize(tenantA.context, {
        opportunity_id: "missing-opportunity"
      })
    );
  });

  test("injected PostgreSQL HTTP composition uses atomic lifecycle operations and tenant-scoped refreshes", async () => {
    const databasePool = createPool();
    let checkoutCount = 0;
    const pool = {
      async connect() {
        checkoutCount += 1;
        return databasePool.connect();
      }
    };
    const checkpoints = [];
    const persistence = createPersistence({
      adapter: "postgres",
      pool,
      failureInjector(name) {
        checkpoints.push(name);
      }
    });
    const repositories = persistence.repositories;
    const tenantA = await createTenant("http-a");
    const tenantB = await createTenant("http-b");
    await repositories.opportunities.insert(tenantA.context, {
      id: "http-a-opportunity",
      business_name: "HTTP A",
      stage: "QUALIFIED",
      value: 1200,
      next_action: ""
    });
    await repositories.opportunities.insert(tenantB.context, {
      id: "http-b-opportunity",
      business_name: "HTTP B",
      stage: "QUALIFIED",
      value: 999999,
      next_action: ""
    });
    const tenantBAction = (await repositories.revenueActions.materialize(
      tenantB.context,
      { id: "http-b-action", opportunity_id: "http-b-opportunity" }
    )).record;
    const app = createApp({
      persistence,
      resolveTenantContext: () => tenantA.context
    });

    await withApp(app, async baseUrl => {
      let beforeRequest = checkoutCount;
      const created = await request(
        baseUrl,
        "POST",
        `/api/opportunities/http-a-opportunity/revenue-actions?tenant_id=${tenantB.tenantId}`,
        { tenant_id: tenantB.tenantId },
        { "x-tenant-id": tenantB.tenantId }
      );
      assert.equal(checkoutCount - beforeRequest, 1);
      assert.equal(created.status, 201);
      assert.equal(created.data.data.opportunity_id, "http-a-opportunity");
      assert.equal(created.data.data.action_type, "CREATE_TASK");
      const actionId = created.data.data.id;
      beforeRequest = checkoutCount;
      assert.equal(
        (await request(baseUrl, "POST", `/api/revenue-actions/${actionId}/prepare`, {})).status,
        200
      );
      assert.equal(checkoutCount - beforeRequest, 1);
      beforeRequest = checkoutCount;
      assert.equal(
        (await request(baseUrl, "POST", `/api/revenue-actions/${actionId}/approve`, {})).status,
        200
      );
      assert.equal(checkoutCount - beforeRequest, 1);
      beforeRequest = checkoutCount;
      const executed = await request(
        baseUrl,
        "POST",
        `/api/revenue-actions/${actionId}/execute`,
        { executionMode: "MANUAL_CONFIRMED" }
      );
      assert.equal(checkoutCount - beforeRequest, 1);
      assert.equal(executed.status, 200);
      assert.equal(executed.data.data.status, "EXECUTED");
      assert.equal(executed.data.data.execution_result.mode, "SYSTEM_INTERNAL");
      assert.ok(executed.data.data.resulting_task_id);
      assert.ok(executed.data.data.resulting_activity_id);
      assert.equal(executed.data.refreshed.opportunity.id, "http-a-opportunity");
      assert.notEqual(
        executed.data.refreshed.opportunity_intelligence.next_best_action.type,
        "CREATE_TASK"
      );
      assert.equal(executed.data.refreshed.pipeline_metrics.total, 1);
      assert.equal(executed.data.refreshed.pipeline_metrics.pipeline_value, 1200);
      assert.equal(executed.data.refreshed.revenue_intelligence.active_pipeline.count, 1);
      assert.equal(
        executed.data.refreshed.revenue_intelligence.active_pipeline.value.known_total,
        1200
      );
      for (const checkpoint of [
        "afterTaskPersisted",
        "afterActivityPersisted",
        "afterActionFinalized"
      ]) {
        assert.equal(
          checkpoints.filter(name => name === checkpoint).length,
          1,
          checkpoint
        );
      }
      const persistedTasks = await repositories.tasks.list(tenantA.context, {
        opportunityId: "http-a-opportunity"
      });
      const persistedActivities = await repositories.activities.list(
        tenantA.context,
        { opportunityId: "http-a-opportunity" }
      );
      assert.deepEqual(
        persistedTasks.map(task => task.id),
        [executed.data.data.resulting_task_id]
      );
      assert.deepEqual(
        persistedActivities.map(activity => activity.id),
        [executed.data.data.resulting_activity_id]
      );

      for (const [crossPath, missingPath] of [
        [
          `/api/revenue-actions/${tenantBAction.id}`,
          "/api/revenue-actions/missing-action"
        ],
        [
          "/api/opportunities/http-b-opportunity/revenue-actions",
          "/api/opportunities/missing-opportunity/revenue-actions"
        ],
        [
          `/api/revenue-actions/${tenantBAction.id}/prepare`,
          "/api/revenue-actions/missing-action/prepare"
        ],
        [
          `/api/revenue-actions/${tenantBAction.id}/execute`,
          "/api/revenue-actions/missing-action/execute"
        ]
      ]) {
        const method = crossPath.includes("/opportunities/") ||
          crossPath.endsWith("/prepare") || crossPath.endsWith("/execute")
          ? "POST"
          : "GET";
        const cross = await request(baseUrl, method, crossPath, method === "POST" ? {} : undefined);
        const missing = await request(baseUrl, method, missingPath, method === "POST" ? {} : undefined);
        assert.equal(cross.status, 404, crossPath);
        assert.equal(missing.status, 404, missingPath);
        assert.equal(cross.data.error, missing.data.error, crossPath);
        assert.equal(cross.data.message, missing.data.message, crossPath);
      }
    });
  });

  test("required HTTP refresh failure rolls back RevenueAction execution on the same checkout", async () => {
    const databasePool = createPool({ max: 1 });
    let checkoutCount = 0;
    let rejectRefresh = false;
    const pool = {
      async connect() {
        checkoutCount += 1;
        const client = await databasePool.connect();
        return {
          async query(sql, values) {
            if (
              rejectRefresh &&
              /select \* from tge\.prospects/i.test(String(sql))
            ) {
              rejectRefresh = false;
              const error = new Error("injected required refresh failure");
              error.code = "INJECTED_REFRESH_FAILURE";
              throw error;
            }
            return client.query(sql, values);
          },
          release(error) {
            return client.release(error);
          }
        };
      }
    };
    const persistence = createPersistence({
      adapter: "postgres",
      pool,
      failureInjector(name) {
        if (name === "afterActionFinalized") rejectRefresh = true;
      }
    });
    const tenant = await createTenant("refresh-rollback-http");
    const repositories = persistence.repositories;
    await repositories.opportunities.insert(tenant.context, {
      id: "refresh-rollback-http-opportunity",
      business_name: "Refresh rollback HTTP",
      stage: "QUALIFIED",
      next_action: ""
    });
    const action = (await repositories.revenueActions.materialize(
      tenant.context,
      {
        id: "refresh-rollback-http-action",
        opportunity_id: "refresh-rollback-http-opportunity"
      }
    )).record;
    await repositories.revenueActions.transition(tenant.context, action.id, {
      to: "PREPARED"
    });
    await repositories.revenueActions.transition(tenant.context, action.id, {
      to: "APPROVED"
    });
    const app = createApp({
      persistence,
      resolveTenantContext: () => tenant.context
    });

    await withApp(app, async baseUrl => {
      const beforeRequest = checkoutCount;
      const response = await request(
        baseUrl,
        "POST",
        `/api/revenue-actions/${action.id}/execute`,
        {}
      );
      assert.equal(response.status, 500);
      assert.equal(
        response.data.error,
        "REVENUE_ACTION_PERSISTENCE_UNAVAILABLE"
      );
      assert.equal(checkoutCount - beforeRequest, 1);
    });

    const persisted = await repositories.revenueActions.findById(
      tenant.context,
      action.id
    );
    assert.equal(persisted.status, "APPROVED");
    assert.equal(persisted.execution_attempts, 0);
    assert.deepEqual(
      await repositories.tasks.list(tenant.context, {
        opportunityId: action.opportunity_id
      }),
      []
    );
    assert.deepEqual(
      await repositories.activities.list(tenant.context, {
        opportunityId: action.opportunity_id
      }),
      []
    );
    assert.equal(
      (await repositories.opportunities.findById(
        tenant.context,
        action.opportunity_id
      )).next_action,
      ""
    );
  });

  test("max-one pool does not leak A, B, or rollback context into the next checkout", async () => {
    const pool = createPool({ max: 1 });
    const repositories = createPostgresRepositories({ pool });
    const tenantA = await createTenant("pool-a");
    const tenantB = await createTenant("pool-b");

    const initial = await inspectRawConnection(pool);
    await repositories.prospects.insert(tenantA.context, {
      id: "pool-a",
      business_name: "Pool A"
    });
    const afterA = await inspectRawConnection(pool);
    await repositories.prospects.insert(tenantB.context, {
      id: "pool-b",
      business_name: "Pool B"
    });
    const afterB = await inspectRawConnection(pool);
    await assert.rejects(
      repositories.prospects.insert(tenantA.context, {
        id: "pool-a",
        business_name: "Duplicate triggers rollback"
      }),
      error => error.code === "23505"
    );
    const afterRollback = await inspectRawConnection(pool);
    await assert.rejects(
      repositories.prospects.list(),
      error => error.code === "TENANT_CONTEXT_REQUIRED"
    );
    const afterNoContext = await inspectRawConnection(pool);

    assert.deepEqual(
      [initial.pid, afterA.pid, afterB.pid, afterRollback.pid, afterNoContext.pid],
      Array(5).fill(initial.pid)
    );
    for (const inspection of [afterA, afterB, afterRollback, afterNoContext]) {
      assert.equal(inspection.tenant_id, null);
      assert.equal(inspection.subject_id, null);
      assert.equal(inspection.visible_prospects, 0);
    }
  });

  test("max-one repository transactions reject accidental public nesting without waiting for a client", async () => {
    const pool = createPool({ max: 1 });
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("nested-max-one");
    await repositories.transaction(context, async scoped => {
      await Promise.race([
        assert.rejects(
          Promise.resolve().then(() => repositories.prospects.list(context)),
          error => error.code === "NESTED_REPOSITORY_TRANSACTION"
        ),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("nested repository call waited for the pool")),
            1000
          );
          timer.unref();
        })
      ]);
      assert.equal(scoped.revenueActions.insert, undefined);
      assert.equal(scoped.revenueActions.update, undefined);
      assert.equal(scoped.revenueActions.delete, undefined);
      assert.deepEqual(await scoped.prospects.list(), []);
    });
  });

  test("repository transactions do not block unrelated tenant work", async () => {
    const pool = createPool({ max: 2 });
    let holdMaterialize = false;
    let heldTenantId;
    let releaseHeld;
    let announceHeld;
    const held = new Promise(resolve => {
      announceHeld = resolve;
    });
    const release = new Promise(resolve => {
      releaseHeld = resolve;
    });
    const repositories = createPostgresRepositories({
      pool,
      async failureInjector(name, { context, id }) {
        if (
          name === "beforeRevenueActionInsert" &&
          holdMaterialize &&
          context.tenantId === heldTenantId &&
          id === "held-action"
        ) {
          announceHeld();
          await release;
        }
      }
    });
    const tenantA = await createTenant("availability-a");
    const tenantB = await createTenant("availability-b");
    heldTenantId = tenantA.tenantId;
    await repositories.opportunities.insert(tenantA.context, {
      id: "held-opportunity",
      business_name: "Held opportunity",
      stage: "QUALIFIED",
      next_action: ""
    });
    await repositories.opportunities.insert(tenantB.context, {
      id: "held-opportunity",
      business_name: "Tenant B same operational ID",
      stage: "QUALIFIED",
      next_action: ""
    });
    await repositories.opportunities.insert(tenantA.context, {
      id: "unrelated-opportunity",
      business_name: "Unrelated opportunity",
      stage: "QUALIFIED",
      next_action: ""
    });

    holdMaterialize = true;
    const materializing = repositories.revenueActions.materialize(
      tenantA.context,
      { id: "held-action", opportunity_id: "held-opportunity" }
    );
    try {
      await Promise.race([
        held,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("held materialize did not reach its checkpoint")),
            3000
          );
          timer.unref();
        })
      ]);
      const timeout = new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("unrelated repository work was blocked")),
          3000
        );
        timer.unref();
      });
      await Promise.race([
        (async () => {
          await repositories.prospects.insert(tenantB.context, {
            id: "tenant-b-available",
            business_name: "Tenant B available"
          });
          const tenantBSameIds = await repositories.revenueActions.materialize(
            tenantB.context,
            { id: "held-action", opportunity_id: "held-opportunity" }
          );
          assert.equal(tenantBSameIds.created, true);
          const unrelatedAction = await repositories.revenueActions.materialize(
            tenantA.context,
            {
              id: "unrelated-action",
              opportunity_id: "unrelated-opportunity"
            }
          );
          assert.equal(unrelatedAction.created, true);
          const updated = await repositories.opportunities.update(
            tenantA.context,
            "unrelated-opportunity",
            { next_action: "Still available" }
          );
          assert.equal(updated.next_action, "Still available");
        })(),
        timeout
      ]);
    } finally {
      releaseHeld();
      holdMaterialize = false;
      await materializing.catch(() => {});
    }
    const materialized = await materializing;
    assert.equal(materialized.created, true);
  });

  test("RevenueAction materialization refuses both WON and LOST opportunities", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("closed-materialize");

    for (const stage of ["WON", "LOST"]) {
      const opportunityId = `closed-${stage.toLowerCase()}`;
      await repositories.opportunities.insert(context, {
        id: opportunityId,
        business_name: `Closed ${stage}`,
        stage,
        value: 1000
      });
      await assert.rejects(
        repositories.revenueActions.materialize(context, {
          opportunity_id: opportunityId
        }),
        error =>
          error.code === "REVENUE_ACTION_OPPORTUNITY_CLOSED" &&
          error.details.stage === stage
      );
    }
    assert.deepEqual(await repositories.revenueActions.list(context), []);
  });

  test("RevenueAction execution rolls back every multi-write checkpoint and records one consistent failure", async () => {
    const databasePool = createPool();
    let checkoutCount = 0;
    const pool = {
      async connect() {
        checkoutCount += 1;
        return databasePool.connect();
      }
    };
    let failurePoint = null;
    const repositories = createPostgresRepositories({
      pool,
      failureInjector(name) {
        if (name === failurePoint) {
          const error = new Error(`Injected failure at ${name}`);
          error.code = "INJECTED_FAILURE";
          throw error;
        }
      }
    });
    const { context } = await createTenant("rollback");

    for (const checkpoint of [
      "afterExecutionStarted",
      "afterTaskPersisted",
      "afterActivityPersisted",
      "afterOpportunityUpdated",
      "afterActionFinalized",
      "beforeCommit"
    ]) {
      const suffix = checkpoint.toLowerCase();
      const action = await createApprovedTaskAction(
        repositories,
        context,
        `rollback-${suffix}`
      );
      failurePoint = checkpoint;
      const beforeExecute = checkoutCount;
      await assert.rejects(
        repositories.revenueActions.executeAtomic(context, action.id),
        error => {
          assert.equal(error.code, "INJECTED_FAILURE");
          assert.equal(error.failedAction.status, "FAILED");
          return true;
        }
      );
      assert.equal(checkoutCount - beforeExecute, 1, checkpoint);
      failurePoint = null;

      const failed = await repositories.revenueActions.findById(
        context,
        action.id
      );
      assert.equal(failed.status, "FAILED", checkpoint);
      assert.deepEqual(
        failed.audit.slice(-2).map(entry => entry.transition),
        ["EXECUTION_STARTED", "FAILED"],
        checkpoint
      );
      assert.equal(failed.resulting_task_id, null, checkpoint);
      assert.equal(failed.resulting_activity_id, null, checkpoint);
      assert.equal(
        (await repositories.tasks.list(context, {
          opportunityId: action.opportunity_id
        })).length,
        0,
        checkpoint
      );
      assert.equal(
        (await repositories.activities.list(context, {
          opportunityId: action.opportunity_id
        })).length,
        0,
        checkpoint
      );
      assert.equal(
        (await repositories.opportunities.findById(
          context,
          action.opportunity_id
        )).next_action,
        "",
        checkpoint
      );
    }
  });

  test("incomplete EXECUTING actions resume their persisted attempt without another start audit", async () => {
    const databasePool = createPool();
    let failingActionId = null;
    const repositories = createPostgresRepositories({
      pool: databasePool,
      failureInjector(name, details) {
        if (name === "afterActivityPersisted" && details.id === failingActionId) {
          const error = new Error(`Injected resumed failure for ${details.id}`);
          error.code = "INJECTED_RESUME_FAILURE";
          throw error;
        }
      }
    });
    const { context, tenantId } = await createTenant("executing-resume");

    for (const taskOnly of [false, true]) {
      const suffix = taskOnly ? "partial-effects" : "no-effects";
      const action = await createApprovedTaskAction(
        repositories,
        context,
        `executing-resume-${suffix}`
      );
      const seeded = await seedExecutingAttempt({
        tenantId,
        action,
        taskOnly
      });
      failingActionId = action.id;

      await assert.rejects(
        repositories.revenueActions.executeAtomic(context, action.id),
        error => {
          assert.equal(error.code, "INJECTED_RESUME_FAILURE");
          assert.equal(error.failedAction.status, "FAILED");
          return true;
        }
      );

      const failed = await repositories.revenueActions.findById(
        context,
        action.id
      );
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.execution_attempts, 1);
      assert.equal(
        failed.execution_request.requested_at,
        seeded.requestedAt
      );
      assert.deepEqual(
        failed.audit.slice(-2).map(entry => entry.transition),
        ["EXECUTION_STARTED", "FAILED"]
      );
      assert.equal(
        failed.audit.filter(entry => entry.transition === "EXECUTION_STARTED").length,
        1
      );
      assert.equal(
        (await repositories.tasks.list(context, {
          opportunityId: action.opportunity_id
        })).length,
        taskOnly ? 1 : 0
      );
      assert.equal(
        (await repositories.activities.list(context, {
          opportunityId: action.opportunity_id
        })).length,
        0
      );
    }

    failingActionId = null;
    for (const taskOnly of [false, true]) {
      const suffix = taskOnly ? "partial-success" : "zero-effect-success";
      const action = await createApprovedTaskAction(
        repositories,
        context,
        `executing-resume-${suffix}`
      );
      const seeded = await seedExecutingAttempt({
        tenantId,
        action,
        taskOnly
      });

      const executed = await repositories.revenueActions.executeAtomic(
        context,
        action.id
      );
      assert.equal(executed.record.status, "EXECUTED");
      assert.equal(executed.record.execution_attempts, 1);
      assert.equal(
        executed.record.execution_request.requested_at,
        seeded.requestedAt
      );
      assert.equal(executed.record.execution_result.outcome, "TASK_CREATED");
      assert.equal(
        executed.record.audit.filter(
          entry => entry.transition === "EXECUTION_STARTED"
        ).length,
        1
      );
      assert.equal(
        (await repositories.tasks.list(context, {
          opportunityId: action.opportunity_id
        })).length,
        1
      );
      assert.equal(
        (await repositories.activities.list(context, {
          opportunityId: action.opportunity_id
        })).length,
        1
      );
    }
  });

  test("lost COMMIT acknowledgement is UNKNOWN and never rewritten as a safe FAILED retry", async () => {
    const databasePool = createPool();
    let loseCommitAcknowledgement = false;
    const pool = {
      async connect() {
        const client = await databasePool.connect();
        return {
          async query(sql, values) {
            if (sql === "COMMIT" && loseCommitAcknowledgement) {
              await client.query(sql, values);
              const error = new Error("commit acknowledgement lost");
              error.code = "CONNECTION_LOST_AFTER_COMMIT";
              throw error;
            }
            return client.query(sql, values);
          },
          release(error) {
            return client.release(error);
          }
        };
      }
    };
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("commit-failure");
    const action = await createApprovedTaskAction(
      repositories,
      context,
      "commit-failure",
      { actionId: "commit-failure-action" }
    );
    loseCommitAcknowledgement = true;

    await assert.rejects(
      repositories.revenueActions.executeAtomic(context, action.id),
      error => {
        assert.equal(error.code, "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN");
        assert.equal(error.outcome, "UNKNOWN");
        assert.equal(error.retryable, false);
        assert.equal(error.attemptedId, action.id);
        assert.equal(error.failedAction, undefined);
        return true;
      }
    );
    loseCommitAcknowledgement = false;

    const reconciled = await repositories.revenueActions.findById(
      context,
      action.id
    );
    assert.equal(reconciled.status, "EXECUTED");
    assert.ok(reconciled.resulting_task_id);
    assert.ok(reconciled.resulting_activity_id);
    assert.equal(
      (await repositories.tasks.list(context, {
        opportunityId: action.opportunity_id
      })).length,
      1
    );
    assert.equal(
      (await repositories.activities.list(context, {
        opportunityId: action.opportunity_id
      })).length,
      1
    );
  });

  test("RevenueAction recovery accepts exact committed effects and rejects malformed semantic identity", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context, tenantId } = await createTenant("recovery-semantics");

    const recoverable = await createApprovedTaskAction(
      repositories,
      context,
      "recoverable-effects"
    );
    await seedCommittedExecutionEffects({ tenantId, action: recoverable });
    const recovered = await repositories.revenueActions.executeAtomic(
      context,
      recoverable.id
    );
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.record.status, "EXECUTED");
    assert.equal(
      recovered.record.execution_result.outcome,
      "RECOVERED_LINKED_EFFECTS"
    );

    const partial = await createApprovedTaskAction(
      repositories,
      context,
      "partial-effects"
    );
    await seedCommittedExecutionEffects({
      tenantId,
      action: partial,
      taskOnly: true
    });
    const completedPartial = await repositories.revenueActions.executeAtomic(
      context,
      partial.id
    );
    assert.equal(completedPartial.record.status, "EXECUTED");
    assert.equal(completedPartial.record.execution_result.outcome, "TASK_CREATED");
    assert.equal(
      (await repositories.tasks.list(context, {
        opportunityId: partial.opportunity_id
      })).length,
      1
    );
    assert.equal(
      (await repositories.activities.list(context, {
        opportunityId: partial.opportunity_id
      })).length,
      1
    );

    const repair = await createApprovedTaskAction(
      repositories,
      context,
      "repair-effects"
    );
    await seedCommittedExecutionEffects({
      tenantId,
      action: repair,
      omitOpportunityMutation: true
    });
    const repaired = await repositories.revenueActions.executeAtomic(
      context,
      repair.id
    );
    assert.equal(repaired.record.status, "EXECUTED");
    assert.equal(
      (await repositories.opportunities.findById(
        context,
        repair.opportunity_id
      )).next_action,
      repair.proposed_execution.title
    );
    assert.equal(
      (await repositories.tasks.list(context, {
        opportunityId: repair.opportunity_id
      })).length,
      1
    );
    assert.equal(
      (await repositories.activities.list(context, {
        opportunityId: repair.opportunity_id
      })).length,
      1
    );

    const malformed = await createApprovedTaskAction(
      repositories,
      context,
      "malformed-effects"
    );
    await seedCommittedExecutionEffects({
      tenantId,
      action: malformed,
      malformed: true
    });
    await assert.rejects(
      repositories.revenueActions.executeAtomic(context, malformed.id),
      error =>
        error.code === "REVENUE_ACTION_EFFECT_CONFLICT" &&
        error.details.reason === "INVALID_LINKED_INTERNAL_EFFECT"
    );
    assert.equal(
      (await repositories.revenueActions.findById(context, malformed.id)).status,
      "FAILED"
    );
  });

  test("PostgreSQL communication execution requires manual confirmation and recovers exact effects", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context, tenantId } = await createTenant("communication");

    const action = await createApprovedCommunicationAction(
      repositories,
      context,
      "normal"
    );
    await assert.rejects(
      repositories.revenueActions.executeAtomic(context, action.id),
      error => error.code === "MANUAL_CONFIRMATION_REQUIRED"
    );
    const executed = await repositories.revenueActions.executeAtomic(
      context,
      action.id,
      { executionMode: "MANUAL_CONFIRMED" }
    );
    assert.equal(executed.record.status, "EXECUTED");
    assert.deepEqual(executed.record.execution_result, {
      mode: "MANUAL_CONFIRMED",
      outcome: "USER_CONFIRMED_COMPLETION",
      external_send_performed: false
    });
    assert.equal(executed.record.resulting_task_id, null);
    assert.ok(executed.record.resulting_activity_id);
    assert.deepEqual(
      await repositories.tasks.list(context, {
        opportunityId: action.opportunity_id
      }),
      []
    );
    const activities = await repositories.activities.list(context, {
      opportunityId: action.opportunity_id
    });
    assert.equal(activities.length, 1);
    assert.equal(activities[0].type, "REVENUE_ACTION_MANUALLY_CONFIRMED");
    assert.deepEqual(activities[0].metadata, {
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      action_key: `revenue-action:${action.id}`,
      execution_mode: "MANUAL_CONFIRMED",
      execution_effect_type: "COMMUNICATION_MANUAL_CONFIRMATION",
      channel: action.proposed_execution.channel
    });
    assert.equal(
      (await repositories.revenueActions.executeAtomic(
        context,
        action.id,
        { executionMode: "MANUAL_CONFIRMED" }
      )).duplicate,
      true
    );
    assert.equal(
      (await repositories.activities.list(context, {
        opportunityId: action.opportunity_id
      })).length,
      1
    );

    const recoverable = await createApprovedCommunicationAction(
      repositories,
      context,
      "recovery"
    );
    await seedCommittedCommunicationEffect({ tenantId, action: recoverable });
    const recovered = await repositories.revenueActions.executeAtomic(
      context,
      recoverable.id,
      { executionMode: "MANUAL_CONFIRMED" }
    );
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.record.status, "EXECUTED");
    assert.equal(
      recovered.record.execution_result.outcome,
      "RECOVERED_LINKED_EFFECTS"
    );
    assert.equal(
      (await repositories.activities.list(context, {
        opportunityId: recoverable.opportunity_id
      })).length,
      1
    );
    assert.deepEqual(
      await repositories.tasks.list(context, {
        opportunityId: recoverable.opportunity_id
      }),
      []
    );
  });

  test("executed RevenueAction replay remains idempotent after linked task completion", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("completed-task-replay");
    const action = await createApprovedTaskAction(
      repositories,
      context,
      "completed-task-replay"
    );
    const executed = await repositories.revenueActions.executeAtomic(
      context,
      action.id
    );
    await assert.rejects(
      repositories.tasks.update(context, executed.record.resulting_task_id, {
        updated_at: "2026-08-30T03:00:00.000Z"
      }),
      error => error.code === "REVENUE_ACTION_EFFECT_IMMUTABLE"
    );
    await repositories.tasks.update(context, executed.record.resulting_task_id, {
      status: "COMPLETED",
      completed_at: "2026-08-30T03:00:00.000Z"
    });

    const replay = await repositories.revenueActions.executeAtomic(
      context,
      action.id
    );

    assert.equal(replay.duplicate, true);
    assert.equal(replay.record.id, action.id);
    assert.equal(
      (await repositories.tasks.list(context, {
        opportunityId: action.opportunity_id
      })).length,
      1
    );
    assert.equal(
      (await repositories.activities.list(context, {
        opportunityId: action.opportunity_id
      })).length,
      1
    );
  });

  test("communication execution rolls back every relevant multi-write checkpoint", async () => {
    const pool = createPool();
    let failurePoint = null;
    const repositories = createPostgresRepositories({
      pool,
      failureInjector(name) {
        if (name === failurePoint) {
          const error = new Error(`Injected communication failure at ${name}`);
          error.code = "INJECTED_FAILURE";
          throw error;
        }
      }
    });
    const { context } = await createTenant("communication-rollback");

    for (const checkpoint of [
      "afterExecutionStarted",
      "afterActivityPersisted",
      "afterOpportunityUpdated",
      "afterActionFinalized",
      "beforeCommit"
    ]) {
      const action = await createApprovedCommunicationAction(
        repositories,
        context,
        checkpoint.toLowerCase()
      );
      failurePoint = checkpoint;
      await assert.rejects(
        repositories.revenueActions.executeAtomic(
          context,
          action.id,
          { executionMode: "MANUAL_CONFIRMED" }
        ),
        error =>
          error.code === "INJECTED_FAILURE" &&
          error.failedAction?.status === "FAILED"
      );
      failurePoint = null;
      const failed = await repositories.revenueActions.findById(
        context,
        action.id
      );
      assert.equal(failed.status, "FAILED", checkpoint);
      assert.equal(failed.resulting_task_id, null, checkpoint);
      assert.equal(failed.resulting_activity_id, null, checkpoint);
      assert.deepEqual(
        failed.audit.slice(-2).map(entry => entry.transition),
        ["EXECUTION_STARTED", "FAILED"],
        checkpoint
      );
      assert.deepEqual(
        await repositories.activities.list(context, {
          opportunityId: action.opportunity_id
        }),
        [],
        checkpoint
      );
      assert.equal(
        (await repositories.opportunities.findById(
          context,
          action.opportunity_id
        )).next_action,
        "Follow up on proposal",
        checkpoint
      );
    }
  });

  test("RevenueAction immutable execution semantics and derived effects reject caller overrides", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("immutable-semantics");
    await repositories.opportunities.insert(context, {
      id: "immutable-opportunity",
      business_name: "Immutable Opportunity",
      stage: "QUALIFIED",
      value: 0,
      next_action: ""
    });
    const action = await buildCurrentRevenueAction(repositories, context, {
      id: "immutable-action",
      opportunityId: "immutable-opportunity"
    });

    await assert.rejects(
      async () => repositories.revenueActions.materialize(context, action),
      error => error.code === "REVENUE_ACTION_EVIDENCE_OVERRIDE_FORBIDDEN"
    );
    const materialized = await repositories.revenueActions.materialize(
      context,
      { id: action.id, opportunity_id: action.opportunity_id }
    );
    await assert.rejects(
      repositories.revenueActions.transition(context, materialized.record.id, {
        to: "PREPARED",
        proposedExecution: { type: "INTERNAL_TASK", title: "Caller override" }
      }),
      error => error.code === "PROPOSED_EXECUTION_INVALID"
    );
    await repositories.revenueActions.transition(context, materialized.record.id, {
      to: "PREPARED"
    });
    await repositories.revenueActions.transition(context, materialized.record.id, {
      to: "APPROVED"
    });
    await assert.rejects(
      repositories.revenueActions.executeAtomic(context, materialized.record.id, {
        result: { outcome: "CALLER_OVERRIDE" }
      }),
      error => error.code === "REVENUE_ACTION_EXECUTION_OVERRIDE_FORBIDDEN"
    );
  });

  test("compatible RevenueAction replay supersedes mixed incompatible active rows", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context, tenantId } = await createTenant("mixed-compatible-replay");
    await repositories.opportunities.insert(context, {
      id: "mixed-compatible-opportunity",
      business_name: "Mixed compatible replay",
      stage: "QUALIFIED",
      value: 0,
      next_action: ""
    });
    const incompatibleSource = (await repositories.revenueActions.materialize(
      context,
      {
        id: "mixed-incompatible-source",
        opportunity_id: "mixed-compatible-opportunity"
      }
    )).record;
    const preparedIncompatible = (await repositories.revenueActions.transition(
      context,
      incompatibleSource.id,
      { to: "PREPARED" }
    )).record;
    await repositories.opportunities.update(
      context,
      "mixed-compatible-opportunity",
      { next_action: "Research account before outreach" }
    );
    const compatible = (await repositories.revenueActions.materialize(
      context,
      {
        id: "mixed-compatible-action",
        opportunity_id: "mixed-compatible-opportunity"
      }
    )).record;
    const incompatible = {
      ...JSON.parse(JSON.stringify(preparedIncompatible)),
      id: "mixed-incompatible-action"
    };
    await seedRevenueActionFixture(tenantId, incompatible, 0);

    const replay = await repositories.revenueActions.materialize(context, {
      opportunity_id: compatible.opportunity_id
    });

    assert.equal(replay.duplicate, true);
    assert.equal(replay.record.id, compatible.id);
    const superseded = await repositories.revenueActions.findById(
      context,
      incompatible.id
    );
    assert.equal(superseded.status, "CANCELLED");
    assert.equal(
      superseded.audit.at(-1).transition,
      "SUPERSEDED_BY_CURRENT_RECOMMENDATION"
    );
    assert.deepEqual(
      (await repositories.revenueActions.list(context)).filter(action =>
        ["RECOMMENDED", "PREPARED", "APPROVED", "EXECUTING", "FAILED"]
          .includes(action.status)
      ).map(action => action.id),
      [compatible.id]
    );
  });

  test("compatible RevenueAction replay requires recovery for linked FAILED effects", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({
      pool,
      clock: () => "2026-09-01T00:01:00.000Z"
    });
    const { context, tenantId } = await createTenant("compatible-recovery");
    await repositories.opportunities.insert(context, {
      id: "compatible-recovery-opportunity",
      business_name: "Compatible recovery",
      stage: "PROPOSAL",
      value: 42000,
      next_action: "Follow up on proposal",
      contact_name: "Ava Wilson"
    });
    await repositories.activities.insert(context, {
      id: "compatible-recovery-baseline",
      opportunity_id: "compatible-recovery-opportunity",
      type: "BASELINE_ACTIVITY",
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z"
    });
    const materialized = await repositories.revenueActions.materialize(
      context,
      {
        id: "compatible-recovery-action",
        opportunity_id: "compatible-recovery-opportunity"
      }
    );
    await repositories.revenueActions.transition(
      context,
      materialized.record.id,
      { to: "PREPARED" }
    );
    const approved = await repositories.revenueActions.transition(
      context,
      materialized.record.id,
      { to: "APPROVED" }
    );
    assert.equal(approved.record.execution_type, "INTERNAL_TASK");
    await seedCommittedExecutionEffects({
      tenantId,
      action: approved.record
    });

    await assert.rejects(
      repositories.revenueActions.materialize(context, {
        opportunity_id: "compatible-recovery-opportunity"
      }),
      error =>
        error.code === "REVENUE_ACTION_RECOVERY_REQUIRED" &&
        error.details.id === approved.record.id
    );
    assert.equal(
      (await repositories.revenueActions.findById(
        context,
        approved.record.id
      )).status,
      "FAILED"
    );
  });

  test("concurrent RevenueAction materialize and execute calls are idempotent", async () => {
    const pool = createPool({ max: 4 });
    let synchronizeMaterialize = false;
    let materializeArrivals = 0;
    let releaseMaterialize;
    let announceBothArrived;
    const materializeGate = new Promise(resolve => {
      releaseMaterialize = resolve;
    });
    const bothArrived = new Promise(resolve => {
      announceBothArrived = resolve;
    });
    const repositories = createPostgresRepositories({
      pool,
      async failureInjector(name) {
        if (name !== "beforeRevenueActionInsert" || !synchronizeMaterialize) {
          return;
        }
        materializeArrivals += 1;
        if (materializeArrivals === 2) announceBothArrived();
        await materializeGate;
      }
    });
    const { context } = await createTenant("concurrency");
    await repositories.opportunities.insert(context, {
      id: "concurrent-opportunity",
      business_name: "Concurrent Opportunity",
      stage: "QUALIFIED",
      value: 0,
      next_action: ""
    });

    const base = {
      id: "concurrent-action-a",
      opportunity_id: "concurrent-opportunity"
    };
    synchronizeMaterialize = true;
    const materializeCalls = [
      repositories.revenueActions.materialize(context, base),
      repositories.revenueActions.materialize(context, {
        id: "concurrent-action-b",
        opportunity_id: base.opportunity_id
      })
    ];
    let barrierError;
    try {
      await Promise.race([
        bothArrived,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("concurrent materialize calls did not race")),
            3000
          );
          timer.unref();
        })
      ]);
    } catch (error) {
      barrierError = error;
    } finally {
      releaseMaterialize();
      synchronizeMaterialize = false;
    }
    const settledMaterialize = await Promise.allSettled(materializeCalls);
    if (barrierError) throw barrierError;
    const rejectedMaterialize = settledMaterialize.find(
      result => result.status === "rejected"
    );
    if (rejectedMaterialize) throw rejectedMaterialize.reason;
    const [left, right] = settledMaterialize.map(result => result.value);

    assert.equal(materializeArrivals, 2);
    assert.equal(left.record.id, right.record.id);
    assert.equal([left.created, right.created].filter(Boolean).length, 1);

    await repositories.revenueActions.transition(context, left.record.id, {
      to: "PREPARED",
      proposedExecution: buildTaskProposal(left.record)
    });
    await repositories.revenueActions.transition(context, left.record.id, {
      to: "APPROVED"
    });
    const [first, second] = await Promise.all([
      repositories.revenueActions.executeAtomic(context, left.record.id),
      repositories.revenueActions.executeAtomic(context, left.record.id)
    ]);

    assert.equal(first.record.id, second.record.id);
    assert.equal(first.record.status, "EXECUTED");
    assert.equal(second.record.status, "EXECUTED");
    assert.equal([first.duplicate, second.duplicate].filter(Boolean).length, 1);
    assert.equal(
      (await repositories.tasks.list(context, {
        opportunityId: "concurrent-opportunity"
      })).length,
      1
    );
    assert.equal(
      (await repositories.activities.list(context, {
        opportunityId: "concurrent-opportunity"
      })).length,
      1
    );
  });

  test("mixed RevenueAction materialize and transition operations share one deadlock-free lock order", async () => {
    const pool = createPool({ max: 4 });
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("mixed-lock-order");
    await repositories.opportunities.insert(context, {
      id: "mixed-opportunity",
      business_name: "Mixed Opportunity",
      stage: "QUALIFIED",
      value: 0,
      next_action: ""
    });
    const input = {
      id: "mixed-action",
      opportunity_id: "mixed-opportunity"
    };
    const materialized = await repositories.revenueActions.materialize(
      context,
      input
    );

    const results = await Promise.race([
      Promise.all([
        repositories.revenueActions.materialize(context, {
          ...input,
          id: "mixed-duplicate"
        }),
        repositories.revenueActions.transition(
          context,
          materialized.record.id,
          { to: "PREPARED" }
        )
      ]),
      new Promise((_, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("mixed RevenueAction operations timed out")),
          5000
        );
        timeout.unref();
      })
    ]);
    assert.equal(results[0].record.id, materialized.record.id);
    assert.equal(results[1].record.status, "PREPARED");
  });

  test("PostgreSQL execution preserves reused task provenance and records truthful effects", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("task-reuse");
    const action = await createApprovedTaskAction(
      repositories,
      context,
      "task-reuse",
      {
        beforeApprove: async prepared => {
          const proposal = prepared.proposed_execution;
          await repositories.tasks.insert(context, {
            id: "identified-intelligence-task",
            opportunity_id: prepared.opportunity_id,
            title: "Display text may differ",
            description: "Intelligence-created task",
            priority: proposal.priority,
            due_at: proposal.due_at,
            status: "OPEN",
            metadata: {
              source: "deal_intelligence",
              action_type: prepared.action_type,
              normalized_title: proposal.normalized_title
            }
          });
        }
      }
    );
    const executed = await repositories.revenueActions.executeAtomic(
      context,
      action.id
    );
    const task = await repositories.tasks.findById(
      context,
      "identified-intelligence-task"
    );
    const activities = await repositories.activities.list(context, {
      opportunityId: action.opportunity_id
    });

    assert.equal(executed.record.execution_result.outcome, "TASK_REUSED");
    assert.equal(task.metadata.source, "deal_intelligence");
    assert.equal(task.metadata.revenue_action_id, action.id);
    assert.match(activities[0].description, /reused internal task/i);
  });

  test("PostgreSQL RevenueAction validation cancels stale execution before CRM effects", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("stale-action");
    const action = await createApprovedTaskAction(
      repositories,
      context,
      "stale-action"
    );

    await repositories.opportunities.update(context, action.opportunity_id, {
      next_action: "Evidence changed after approval"
    });
    const result = await repositories.revenueActions.executeAtomic(
      context,
      action.id
    );

    assert.equal(result.record.status, "CANCELLED");
    assert.equal(result.conflict.code, "REVENUE_ACTION_STALE");
    assert.deepEqual(
      await repositories.tasks.list(context, {
        opportunityId: action.opportunity_id
      }),
      []
    );
    assert.deepEqual(
      await repositories.activities.list(context, {
        opportunityId: action.opportunity_id
      }),
      []
    );
  });

  test("malformed stored RevenueActions are quarantined or blocked before duplicate and replay success", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context, tenantId } = await createTenant("malformed-actions");

    async function createOpportunity(id) {
      await repositories.opportunities.insert(context, {
        id,
        business_name: id,
        stage: "QUALIFIED"
      });
      return buildCurrentRevenueAction(repositories, context, {
        id: `${id}-malformed`,
        opportunityId: id
      });
    }

    const duplicateMalformed = await createOpportunity(
      "malformed-duplicate-opportunity"
    );
    duplicateMalformed.evidence = {
      ...duplicateMalformed.evidence,
      factual: null
    };
    duplicateMalformed.recommendation_snapshot.evidence =
      JSON.parse(JSON.stringify(duplicateMalformed.evidence));
    await seedRevenueActionFixture(tenantId, duplicateMalformed, 100);
    const duplicate = await repositories.revenueActions.materialize(context, {
      id: "must-not-replace-malformed",
      opportunity_id: duplicateMalformed.opportunity_id
    });
    assert.equal(duplicate.conflict.code, "REVENUE_ACTION_EVIDENCE_INVALID");
    assert.equal(duplicate.record.status, "CANCELLED");
    const duplicateRaw = await getAdminClient().query(
      `select evidence, status from tge.revenue_actions
       where tenant_id = $1 and id = $2`,
      [tenantId, duplicateMalformed.id]
    );
    assert.equal(duplicateRaw.rows[0].evidence.factual, null);
    assert.equal(duplicateRaw.rows[0].status, "CANCELLED");

    const conflictTemplate = await createOpportunity(
      "malformed-conflict-opportunity"
    );
    conflictTemplate.evidence = {
      ...conflictTemplate.evidence,
      derived: null
    };
    conflictTemplate.recommendation_snapshot.evidence =
      JSON.parse(JSON.stringify(conflictTemplate.evidence));
    let releaseInsert;
    let reachedInsert;
    const insertReached = new Promise(resolve => { reachedInsert = resolve; });
    const insertGate = new Promise(resolve => { releaseInsert = resolve; });
    const racingRepositories = createPostgresRepositories({
      pool,
      failureInjector: async name => {
        if (name !== "beforeRevenueActionInsert") return;
        reachedInsert();
        await insertGate;
      }
    });
    const racingMaterialize = racingRepositories.revenueActions.materialize(
      context,
      {
        id: "racing-valid-action",
        opportunity_id: conflictTemplate.opportunity_id
      }
    );
    await insertReached;
    await seedRevenueActionFixture(tenantId, conflictTemplate, 101);
    releaseInsert();
    const conflictWinner = await racingMaterialize;
    assert.equal(
      conflictWinner.conflict.code,
      "REVENUE_ACTION_EVIDENCE_INVALID"
    );
    assert.equal(conflictWinner.record.status, "CANCELLED");

    const executedMalformed = await createOpportunity(
      "malformed-executed-opportunity"
    );
    const executedAt = "2026-08-30T07:00:00.000Z";
    executedMalformed.status = "EXECUTED";
    executedMalformed.evidence = {
      ...executedMalformed.evidence,
      factual: null
    };
    executedMalformed.recommendation_snapshot.evidence =
      JSON.parse(JSON.stringify(executedMalformed.evidence));
    executedMalformed.prepared_at = executedAt;
    executedMalformed.approved_at = executedAt;
    executedMalformed.executed_at = executedAt;
    executedMalformed.updated_at = executedAt;
    await seedRevenueActionFixture(tenantId, executedMalformed, 102);
    await assert.rejects(
      repositories.revenueActions.executeAtomic(
        context,
        executedMalformed.id,
        {}
      ),
      error => error.code === "REVENUE_ACTION_EVIDENCE_INVALID"
    );
    const executedRaw = await getAdminClient().query(
      `select evidence, status from tge.revenue_actions
       where tenant_id = $1 and id = $2`,
      [tenantId, executedMalformed.id]
    );
    assert.equal(executedRaw.rows[0].evidence.factual, null);
    assert.equal(executedRaw.rows[0].status, "EXECUTED");
  });

  test("PR-1 JSON fixtures round-trip through PostgreSQL repositories with all value states intact", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context, tenantId } = await createTenant("compatibility");
    const fixtures = readFixtures();
    await seedFixtureSnapshot(tenantId, fixtures);

    const postgres = {
      prospects: await repositories.prospects.list(context),
      opportunities: await repositories.opportunities.list(context),
      tasks: await repositories.tasks.list(context),
      activities: await repositories.activities.list(context),
      revenue_actions: await repositories.revenueActions.list(context)
    };
    const jsonStore = createFixtureStore(fixtures);
    const json = createPersistence({ adapter: "json", store: jsonStore });

    for (const collection of [
      "prospects",
      "opportunities",
      "tasks",
      "activities"
    ]) {
      assert.deepEqual(
        postgres[collection],
        await json.repositories[collection].list()
      );
    }
    assert.deepEqual(
      postgres.revenue_actions,
      await json.repositories.revenueActions.list()
    );

    const expectedStates = new Map([
      ["opp-known", [true, 20000]],
      ["opp-zero", [true, 0]],
      ["opp-unknown", [true, null]],
      ["opp-missing-value", [false, undefined]],
      ["opp-blank-value", [true, "   "]],
      ["opp-unknown-string-value", [true, "unknown"]],
      ["opp-non-numeric-value", [true, "not-a-number"]]
    ]);
    for (const [id, [hasValue, value]] of expectedStates) {
      const opportunity = postgres.opportunities.find(record => record.id === id);
      assert.equal(Object.hasOwn(opportunity, "value"), hasValue, id);
      assert.equal(opportunity.value, value, id);
    }

    const generatedAt = "2026-01-06T09:00:00.000Z";
    const intelligence = postgres.opportunities.map(opportunity =>
      buildDealIntelligenceFromData(opportunity, {
        prospects: postgres.prospects,
        activities: postgres.activities,
        tasks: postgres.tasks,
        generatedAt
      })
    );
    const revenue = buildRevenueIntelligence({
      opportunities: postgres.opportunities,
      intelligences: intelligence,
      generatedAt
    });
    assert.deepEqual(revenue.active_pipeline.value, {
      known_total: 20000,
      known_count: 1,
      unknown_count: 6
    });
    assert.equal(
      revenue.top_actions.some(item =>
        ["opp-won", "opp-lost"].includes(item.opportunity_id)
      ),
      false
    );
  });

  test("equal-timestamp imported RevenueActions preserve ascending source ordinal like stable JSON order", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const { context, tenantId } = await createTenant("equal-action-order");
    await repositories.opportunities.insert(context, {
      id: "equal-order-opportunity",
      business_name: "Equal order opportunity",
      stage: "QUALIFIED"
    });
    const template = readFixtures().revenue_actions[0];
    const records = ["source-z", "source-a"].map(id => ({
      ...JSON.parse(JSON.stringify(template)),
      id,
      opportunity_id: "equal-order-opportunity",
      status: "CANCELLED",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
      cancelled_at: "2026-02-01T00:00:00.000Z",
      resulting_task_id: null,
      resulting_activity_id: null
    }));
    for (const [sourceOrdinal, record] of records.entries()) {
      await seedRevenueActionFixture(tenantId, record, sourceOrdinal);
    }

    const postgresOrder = (await repositories.revenueActions.list(context))
      .map(record => record.id);
    const json = createPersistence({
      adapter: "json",
      store: createFixtureStore({ revenue_actions: records })
    });
    const jsonOrder = (await json.repositories.revenueActions.list())
      .map(record => record.id);
    assert.deepEqual(postgresOrder, ["source-z", "source-a"]);
    assert.deepEqual(postgresOrder, jsonOrder);
  });

  test("equal-timestamp live records preserve insertion order instead of mutable or random IDs", async () => {
    const pool = createPool();
    const timestamp = "2026-08-30T06:00:00.000Z";
    const repositories = createPostgresRepositories({
      pool,
      clock: () => timestamp
    });
    const { context } = await createTenant("equal-live-order");
    const opportunity = await repositories.opportunities.insert(context, {
      id: "equal-live-opportunity",
      business_name: "Equal live order",
      stage: "QUALIFIED",
      created_at: timestamp,
      updated_at: timestamp
    });

    for (const id of ["z-live-task", "a-live-task"]) {
      await repositories.tasks.insert(context, {
        id,
        opportunity_id: opportunity.id,
        title: id,
        status: "OPEN",
        created_at: timestamp,
        updated_at: timestamp
      });
    }
    for (const id of ["z-live-activity", "a-live-activity"]) {
      await repositories.activities.insert(context, {
        id,
        opportunity_id: opportunity.id,
        type: "EQUAL_TIME",
        description: id,
        created_at: timestamp,
        updated_at: timestamp
      });
    }

    const tasks = await repositories.tasks.list(context, {
      opportunityId: opportunity.id
    });
    const activities = await repositories.activities.list(context, {
      opportunityId: opportunity.id
    });
    assert.deepEqual(tasks.map(record => record.id), [
      "z-live-task",
      "a-live-task"
    ]);
    assert.deepEqual(activities.map(record => record.id), [
      "z-live-activity",
      "a-live-activity"
    ]);
    const intelligence = buildDealIntelligenceFromData(opportunity, {
      prospects: [],
      tasks,
      activities,
      generatedAt: timestamp
    });
    assert.equal(intelligence.tasks.latest.id, "z-live-task");
    assert.equal(intelligence.activity.latest.id, "z-live-activity");

    for (const [id, opportunityId] of [
      ["z-live-action", "z-live-action-opportunity"],
      ["a-live-action", "a-live-action-opportunity"]
    ]) {
      await repositories.opportunities.insert(context, {
        id: opportunityId,
        business_name: opportunityId,
        stage: "QUALIFIED",
        created_at: timestamp,
        updated_at: timestamp
      });
      const materialized = await repositories.revenueActions.materialize(
        context,
        { id, opportunity_id: opportunityId }
      );
      assert.equal(materialized.created, true);
    }
    const liveActions = await repositories.revenueActions.list(context);
    const postgresOrder = liveActions.map(record => record.id);
    assert.deepEqual(postgresOrder, ["z-live-action", "a-live-action"]);
    const json = createPersistence({
      adapter: "json",
      store: createFixtureStore({ revenue_actions: liveActions })
    });
    assert.deepEqual(
      (await json.repositories.revenueActions.list()).map(record => record.id),
      postgresOrder
    );
  });

  test("concurrent PostgreSQL core mutations serialize on parent rows and remain idempotent", async () => {
    const pool = createPool({ max: 4 });
    const persistence = createPersistence({ adapter: "postgres", pool });
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("core-concurrency");
    await repositories.prospects.insert(context, {
      id: "core-concurrent-prospect",
      business_name: "Core Concurrent Prospect",
      qualification_score: 82,
      qualification_status: "HIGH"
    });
    let id = 0;
    const service = createPostgresCoreService({
      persistence,
      createId: () => `core-concurrent-${++id}`,
      clock: () => "2026-08-30T08:00:00.000Z"
    }).forTenant(context);

    const opportunityResults = await Promise.all([
      service.createOpportunityFromProspect("core-concurrent-prospect"),
      service.createOpportunityFromProspect("core-concurrent-prospect")
    ]);
    const opportunities = await repositories.opportunities.list(context, {
      prospectId: "core-concurrent-prospect"
    });
    assert.equal(opportunities.length, 1);
    assert.deepEqual(
      opportunityResults.map(result => result.created).sort(),
      [false, true]
    );
    const opportunityId = opportunities[0].id;

    const taskResults = await Promise.all([
      service.createIntelligenceTask({
        opportunityId,
        title: "Create one durable task",
        priority: "HIGH",
        actionType: "CREATE_TASK"
      }),
      service.createIntelligenceTask({
        opportunityId,
        title: " create one durable task ",
        priority: "HIGH",
        actionType: "CREATE_TASK"
      })
    ]);
    assert.equal(
      (await repositories.tasks.list(context, { opportunityId })).length,
      1
    );
    assert.equal(
      (await repositories.activities.list(context, { opportunityId }))
        .filter(activity => activity.type === "INTELLIGENCE_TASK_CREATED").length,
      1
    );
    assert.deepEqual(
      taskResults.map(result => result.task_created).sort(),
      [false, true]
    );

    await Promise.all([
      service.addContact({ opportunityId, contactName: "Ada Lovelace" }),
      service.addContact({ opportunityId, contactName: "  ada   lovelace  " })
    ]);
    assert.equal(
      (await repositories.activities.list(context, { opportunityId }))
        .filter(activity => activity.type === "CONTACT_ADDED").length,
      1
    );
  });

  test("PostgreSQL core reuses migrated semantic activities without action keys", async () => {
    const pool = createPool();
    const persistence = createPersistence({ adapter: "postgres", pool });
    const repositories = createPostgresRepositories({ pool });
    const { context } = await createTenant("legacy-core-dedupe");
    await repositories.opportunities.insert(context, {
      id: "legacy-core-opportunity",
      business_name: "Legacy Core Opportunity",
      stage: "QUALIFIED",
      probability: 0.2,
      next_action: "Define next action"
    });
    await repositories.tasks.insert(context, {
      id: "legacy-core-task",
      opportunity_id: "legacy-core-opportunity",
      title: "Define next action",
      status: "OPEN"
    });
    for (const activity of [
      {
        id: "legacy-core-task-activity",
        type: "INTELLIGENCE_TASK_CREATED",
        description: "Intelligence task created: Define next action"
      },
      {
        id: "legacy-core-contact-activity",
        type: "CONTACT_ADDED",
        description: "Decision maker added: Ada Lovelace"
      },
      {
        id: "legacy-core-value-activity",
        type: "VALUE_UPDATED",
        description: "Opportunity value updated to 42000"
      }
    ]) {
      await repositories.activities.insert(context, {
        ...activity,
        opportunity_id: "legacy-core-opportunity"
      });
    }
    const service = createPostgresCoreService({
      persistence,
      createId: () => randomUUID()
    }).forTenant(context);

    const task = await service.createIntelligenceTask({
      opportunityId: "legacy-core-opportunity",
      title: " define next action ",
      priority: "HIGH",
      actionType: "CREATE_TASK"
    });
    const contact = await service.addContact({
      opportunityId: "legacy-core-opportunity",
      contactName: " ada   lovelace "
    });
    const value = await service.setValue({
      opportunityId: "legacy-core-opportunity",
      value: 42000
    });

    assert.equal(task.activity.id, "legacy-core-task-activity");
    assert.equal(contact.activity.id, "legacy-core-contact-activity");
    assert.equal(value.activity.id, "legacy-core-value-activity");
    assert.equal(
      (await repositories.activities.list(context, {
        opportunityId: "legacy-core-opportunity"
      })).length,
      3
    );
  });

  test("PostgreSQL import preview is atomic, tenant-isolated, and leaves canonical records unchanged", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const tenantA = await createTenant("import-a");
    const tenantB = await createTenant("import-b");
    const batchId = `batch-${randomUUID()}`;
    const before = await getAdminClient().query(
      `select
         (select count(*)::int from tge.prospects where tenant_id = $1) as prospects,
         (select count(*)::int from tge.opportunities where tenant_id = $1) as opportunities,
         (select count(*)::int from tge.tasks where tenant_id = $1) as tasks,
         (select count(*)::int from tge.activities where tenant_id = $1) as activities,
         (select count(*)::int from tge.revenue_actions where tenant_id = $1) as revenue_actions`,
      [tenantA.tenantId]
    );
    const at = "2026-09-01T00:00:00.000Z";
    const rawPayload = {
      sourceRowNumber: 2,
      cells: [{
        columnOrdinal: 0,
        present: true,
        raw: "0",
        valueKind: "KNOWN_ZERO"
      }]
    };
    const rawHash = hashImportEvidence(rawPayload);
    const created = await repositories.imports.stagePreview(tenantA.context, {
      batch: {
        id: batchId,
        status: "PREVIEWED",
        sourceFilename: "untrusted.xlsx",
        sourceSha256: "a".repeat(64),
        authorizedBySubjectId: tenantA.context.subjectId,
        authorizationVerifiedAt: at,
        previewSummary: {
          format: "CSV",
          sourceCollection: "prospects",
          rowCount: 1,
          headers: ["id"],
          valueKindCounts: { KNOWN_ZERO: 1 }
        },
        rawStorageKey: null,
        rawExpiresAt: "2026-09-08T00:00:00.000Z",
        metadataRetainUntil: "2027-09-01T00:00:00.000Z",
        createdAt: at
      },
      records: [{
        id: "row:0",
        sourceCollection: "prospects",
        sourceId: `csv-row:0:${rawHash}`,
        sourceOrdinal: 0,
        rawPayload,
        rawPayloadSha256: rawHash,
        disposition: "PENDING",
        idempotencyKey: "c".repeat(64),
        metadata: { source_id_kind: "SYNTHETIC_ROW_EVIDENCE" }
      }],
      auditEvent: {
        id: `import-preview:${batchId}`,
        eventType: "IMPORT_PREVIEW_CREATED",
        subjectId: tenantA.context.subjectId,
        entityType: "import_batch",
        entityId: batchId,
        payload: { row_count: 1, external_action_performed: false },
        occurredAt: at,
        retainUntil: "2027-09-01T00:00:00.000Z"
      }
    });

    assert.equal(created.batch.id, batchId);
    assert.equal(created.records[0].sourceOrdinal, 0);
    assert.equal(created.records[0].rawPayload.cells[0].raw, "0");
    assert.equal(created.records[0].rawPayload.cells[0].valueKind, "KNOWN_ZERO");
    assert.equal(
      hashImportEvidence(created.records[0].rawPayload),
      created.records[0].rawPayloadSha256
    );
    assert.equal(
      (await repositories.imports.findPreview(tenantA.context, batchId)).batch.id,
      batchId
    );
    assert.equal(
      await repositories.imports.findPreview(tenantB.context, batchId),
      null
    );
    const analysisEvidence = await repositories.imports.findAnalysisEvidence(
      tenantA.context,
      batchId
    );
    assert.equal(analysisEvidence.records.length, 1);
    assert.equal(analysisEvidence.records[0].rawPayload.cells[0].raw, "0");
    assert.equal(
      await repositories.imports.findAnalysisEvidence(tenantB.context, batchId),
      null
    );

    const evidence = await getAdminClient().query(
      `select
         (select count(*)::int from tge.import_staging_records
          where tenant_id = $1 and import_batch_id = $2) as staged,
         (select count(*)::int from tge.audit_events
          where tenant_id = $1 and entity_id = $2
            and event_type = 'IMPORT_PREVIEW_CREATED') as audited`,
      [tenantA.tenantId, batchId]
    );
    assert.deepEqual(evidence.rows[0], { staged: 1, audited: 1 });
    const after = await getAdminClient().query(
      `select
         (select count(*)::int from tge.prospects where tenant_id = $1) as prospects,
         (select count(*)::int from tge.opportunities where tenant_id = $1) as opportunities,
         (select count(*)::int from tge.tasks where tenant_id = $1) as tasks,
         (select count(*)::int from tge.activities where tenant_id = $1) as activities,
         (select count(*)::int from tge.revenue_actions where tenant_id = $1) as revenue_actions`,
      [tenantA.tenantId]
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
  });

  test("canonical import is atomic, tenant-isolated, map-reconciled, and retry-idempotent", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const tenantA = await createTenant("canonical-import-a");
    const tenantB = await createTenant("canonical-import-b");
    const input = canonicalOpportunityInput("canonical-attempt-1");
    const csv =
      "source_id,id,business_name,stage,value,probability\n" +
      "source-1,canonical-opp-1,Canonical Trade,QUALIFIED,unknown,0";
    const batchId = `canonical-${randomUUID()}`;
    await stageCsvBatch(repositories, tenantA.context, batchId, csv);

    const committed = await commitCsvBatch(
      repositories,
      tenantA.context,
      batchId,
      input
    );
    assert.equal(committed.outcome, "COMMITTED");
    assert.equal(committed.reconciled, false);
    assert.deepEqual(committed.summary, {
      total: 1,
      committed: 1,
      skipped: 0,
      conflicted: 0,
      failed: 0
    });
    const canonical = await repositories.opportunities.findById(
      tenantA.context,
      "canonical-opp-1"
    );
    assert.equal(canonical.value, "unknown");
    assert.equal(canonical.probability, 0);
    assert.equal(canonical.metadata.import.batch_id, batchId);
    assert.equal(canonical.metadata.import.source_record_id, "source-1");
    assert.equal(await repositories.opportunities.findById(
      tenantB.context,
      "canonical-opp-1"
    ), null);
    assert.equal(await repositories.imports.findCommit(
      tenantB.context,
      batchId
    ), null);

    const evidenceBeforeRetry = await getAdminClient().query(
      `select
         (select count(*)::int from tge.opportunities
          where tenant_id = $1 and id = 'canonical-opp-1') as canonical,
         (select count(*)::int from tge.import_id_map
          where tenant_id = $1 and source_system = 'pilot-crm'
            and source_record_id = 'source-1') as maps,
         (select count(*)::int from tge.audit_events
          where tenant_id = $1 and entity_id = $2
            and event_type = 'IMPORT_COMMIT_COMPLETED') as audits`,
      [tenantA.tenantId, batchId]
    );
    const retry = await commitCsvBatch(
      repositories,
      tenantA.context,
      batchId,
      { ...input, selections: [...input.selections].reverse() },
      "2026-09-03T00:00:00.000Z"
    );
    assert.equal(retry.reconciled, true);
    const normalizedRetry = await commitCsvBatch(
      repositories,
      tenantA.context,
      batchId,
      {
        ...input,
        selections: [
          ...input.selections,
          {
            targetField: "contact_name",
            sourceColumn: null,
            selectedType: "TEXT"
          }
        ]
      },
      "2026-09-03T00:00:00.500Z"
    );
    assert.equal(normalizedRetry.reconciled, true);
    const evidenceAfterRetry = await getAdminClient().query(
      `select
         (select count(*)::int from tge.opportunities
          where tenant_id = $1 and id = 'canonical-opp-1') as canonical,
         (select count(*)::int from tge.import_id_map
          where tenant_id = $1 and source_system = 'pilot-crm'
            and source_record_id = 'source-1') as maps,
         (select count(*)::int from tge.audit_events
          where tenant_id = $1 and entity_id = $2
            and event_type = 'IMPORT_COMMIT_COMPLETED') as audits`,
      [tenantA.tenantId, batchId]
    );
    assert.deepEqual(evidenceAfterRetry.rows[0], evidenceBeforeRetry.rows[0]);

    const changedRetry = await commitCsvBatch(
      repositories,
      tenantA.context,
      batchId,
      {
        ...input,
        selections: input.selections.filter(selection =>
          selection.targetField !== "probability")
      },
      "2026-09-03T00:00:01.000Z"
    );
    assert.equal(changedRetry.outcome, "CONFLICTED");
    assert.equal(changedRetry.conflicts[0].code, "BATCH_ALREADY_COMMITTED");
    const changedRetryAudit = await getAdminClient().query(
      `select count(*)::int as count
       from tge.audit_events
       where tenant_id = $1 and entity_id = $2
         and event_type = 'IMPORT_COMMIT_CONFLICTED'`,
      [tenantA.tenantId, batchId]
    );
    assert.equal(changedRetryAudit.rows[0].count, 1);

    const reusedKeyBatch = `canonical-reused-key-${randomUUID()}`;
    await stageCsvBatch(
      repositories,
      tenantA.context,
      reusedKeyBatch,
      csv
        .replace("source-1", "source-reused-key")
        .replace("canonical-opp-1", "canonical-reused-key")
    );
    const reusedKey = await commitCsvBatch(
      repositories,
      tenantA.context,
      reusedKeyBatch,
      canonicalOpportunityInput("canonical-attempt-1")
    );
    assert.equal(reusedKey.outcome, "CONFLICTED");
    assert.equal(
      reusedKey.conflicts[0].code,
      "IMPORT_IDEMPOTENCY_KEY_CONFLICT"
    );

    const reconciliationBatch = `canonical-reconcile-${randomUUID()}`;
    await stageCsvBatch(
      repositories,
      tenantA.context,
      reconciliationBatch,
      csv
    );
    const reconciled = await commitCsvBatch(
      repositories,
      tenantA.context,
      reconciliationBatch,
      canonicalOpportunityInput("canonical-attempt-2")
    );
    assert.deepEqual(reconciled.summary, {
      total: 1,
      committed: 0,
      skipped: 1,
      conflicted: 0,
      failed: 0
    });
    assert.equal(reconciled.rows[0].disposition, "EXACT_DUPLICATE");
    assert.equal(reconciled.rows[0].reconciledImportBatchId, batchId);

    const conflictBatch = `canonical-conflict-${randomUUID()}`;
    await stageCsvBatch(
      repositories,
      tenantA.context,
      conflictBatch,
      csv.replace("Canonical Trade", "Changed Trade")
    );
    const conflict = await commitCsvBatch(
      repositories,
      tenantA.context,
      conflictBatch,
      canonicalOpportunityInput("canonical-attempt-3")
    );
    assert.equal(conflict.outcome, "CONFLICTED");
    assert.equal(conflict.conflicts[0].code, "SOURCE_IDENTITY_MAP_CONFLICT");
    const conflictEvidence = await getAdminClient().query(
      `select batch.status, batch.conflict_summary,
         record.disposition,
         (select count(*)::int from tge.audit_events
          where tenant_id = $1 and entity_id = $2
            and event_type = 'IMPORT_COMMIT_CONFLICTED') as audited
       from tge.import_batches batch
       join tge.import_staging_records record
         on record.tenant_id = batch.tenant_id
        and record.import_batch_id = batch.id
       where batch.tenant_id = $1 and batch.id = $2`,
      [tenantA.tenantId, conflictBatch]
    );
    assert.equal(conflictEvidence.rows[0].status, "PREVIEWED");
    assert.equal(conflictEvidence.rows[0].disposition, "PENDING");
    assert.equal(conflictEvidence.rows[0].conflict_summary.outcome, "CONFLICTED");
    assert.equal(conflictEvidence.rows[0].audited, 1);

    const failedBatch = `canonical-failed-${randomUUID()}`;
    const privateRaw = "tenant-private-validation-evidence";
    await stageCsvBatch(
      repositories,
      tenantA.context,
      failedBatch,
      "source_id,id,business_name,stage,value,probability,note\n" +
        `source-failed,canonical-failed,,QUALIFIED,0,0,${privateRaw}`
    );
    const failed = await commitCsvBatch(
      repositories,
      tenantA.context,
      failedBatch,
      canonicalOpportunityInput("canonical-failed-attempt")
    );
    assert.equal(failed.outcome, "FAILED");
    assert.deepEqual(failed.summary, {
      total: 1,
      committed: 0,
      skipped: 0,
      conflicted: 0,
      failed: 1
    });
    const failedEvidence = await getAdminClient().query(
      `select batch.status, record.disposition, audit.payload
       from tge.import_batches batch
       join tge.import_staging_records record
         on record.tenant_id = batch.tenant_id
        and record.import_batch_id = batch.id
       join tge.audit_events audit
         on audit.tenant_id = batch.tenant_id
        and audit.entity_id = batch.id
        and audit.event_type = 'IMPORT_COMMIT_FAILED'
       where batch.tenant_id = $1 and batch.id = $2`,
      [tenantA.tenantId, failedBatch]
    );
    assert.equal(failedEvidence.rows[0].status, "PREVIEWED");
    assert.equal(failedEvidence.rows[0].disposition, "PENDING");
    assert.equal(JSON.stringify(failedEvidence.rows[0].payload).includes(privateRaw), false);
    assert.equal(JSON.stringify(failedEvidence.rows[0].payload).includes("rawEvidence"), false);

    const directClient = await pool.connect();
    try {
      await directClient.query("begin");
      await directClient.query(
        "select tge.set_request_context($1::uuid, $2::text)",
        [tenantA.tenantId, tenantA.context.subjectId]
      );
      await assert.rejects(
        directClient.query(
          `select tge.record_import_commit_outcome(
             $1::uuid, $2::text, 'row:0', 'COMMITTED', $3::timestamptz,
             $4::jsonb
           )`,
          [
            tenantA.tenantId,
            conflictBatch,
            "2026-09-02T00:00:00.000Z",
            JSON.stringify({
              canonical_payload_sha256: "f".repeat(64),
              source_system: "pilot-crm",
              source_record_id: "source-1",
              target_id: "canonical-opp-1"
            })
          ]
        ),
        error => error.code === "23514"
      );
      await directClient.query("rollback");
    } finally {
      directClient.release();
    }

    const privileges = await pool.query(
      `select
         has_function_privilege(
           current_user,
           'tge.finalize_import_commit(uuid,text,text,jsonb,timestamptz)',
           'execute'
         ) as can_finalize,
         has_table_privilege(current_user, 'tge.import_batches', 'update')
           as can_update_batches,
         has_table_privilege(current_user, 'tge.import_staging_records', 'update')
           as can_update_rows`
    );
    assert.deepEqual(privileges.rows[0], {
      can_finalize: true,
      can_update_batches: false,
      can_update_rows: false
    });
  });

  test("canonical import preserves exact numeric and canonical unknown evidence", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const tenant = await createTenant("canonical-import-exact-evidence");
    const batchId = `canonical-exact-${randomUUID()}`;
    await stageCsvBatch(
      repositories,
      tenant.context,
      batchId,
      "source_id,id,business_name,stage,value,probability\n" +
        "source-large,exact-large,Large Trade,QUALIFIED,9007199254740993,1e-4000\n" +
        "source-decimal,exact-decimal,Decimal Trade,QUALIFIED,1.234567890123456789,0.1234567890123456789\n" +
        "source-tiny,exact-tiny,Tiny Trade,QUALIFIED,1e-4000,0\n" +
        "source-unknown,exact-unknown,Unknown Trade,QUALIFIED,n/a,0\n" +
        "source-zero,exact-zero,Zero Trade,QUALIFIED,0,0"
    );

    const result = await commitCsvBatch(
      repositories,
      tenant.context,
      batchId,
      canonicalOpportunityInput(`exact-${randomUUID()}`)
    );
    assert.equal(result.outcome, "COMMITTED");

    const [large, decimal, tiny, unknown, zero] = await Promise.all([
      repositories.opportunities.findById(tenant.context, "exact-large"),
      repositories.opportunities.findById(tenant.context, "exact-decimal"),
      repositories.opportunities.findById(tenant.context, "exact-tiny"),
      repositories.opportunities.findById(tenant.context, "exact-unknown"),
      repositories.opportunities.findById(tenant.context, "exact-zero")
    ]);
    assert.equal(large.value, "9007199254740993");
    assert.equal(large.probability, "1e-4000");
    assert.equal(decimal.value, "1.234567890123456789");
    assert.equal(decimal.probability, "0.1234567890123456789");
    assert.equal(tiny.value, "1e-4000");
    assert.equal(unknown.value, "unknown");
    assert.equal(zero.value, 0);

    const stored = await getAdminClient().query(
      `select id, commercial_value::text as numeric_value,
         commercial_value_state, commercial_value_raw::text as raw_value,
         metadata#>>'{import,numeric_evidence,value,raw}' as exact_raw
       from tge.opportunities
       where tenant_id = $1 and id = any($2::text[])
       order by id`,
      [tenant.tenantId, [
        "exact-large", "exact-decimal", "exact-tiny", "exact-unknown", "exact-zero"
      ]]
    );
    const byId = Object.fromEntries(stored.rows.map(row => [row.id, row]));
    assert.equal(byId["exact-large"].numeric_value, "9007199254740993");
    assert.equal(byId["exact-large"].raw_value, "9007199254740993");
    assert.equal(byId["exact-large"].exact_raw, "9007199254740993");
    assert.equal(byId["exact-decimal"].numeric_value, "1.234567890123456789");
    assert.equal(byId["exact-decimal"].raw_value, "1.234567890123456789");
    assert.equal(byId["exact-decimal"].exact_raw, "1.234567890123456789");
    assert.equal(byId["exact-tiny"].exact_raw, "1e-4000");
    assert.equal(byId["exact-tiny"].commercial_value_state, "KNOWN");
    assert.equal(byId["exact-unknown"].commercial_value_state, "UNKNOWN_LITERAL");
    assert.equal(byId["exact-unknown"].raw_value, '"unknown"');
    assert.equal(byId["exact-zero"].commercial_value_state, "ZERO");
    assert.equal(byId["exact-zero"].numeric_value, "0");

    const updatedDecimal = await repositories.opportunities.update(
      tenant.context,
      "exact-decimal",
      { next_action: "Unrelated exact-evidence update" }
    );
    const updatedTiny = await repositories.opportunities.update(
      tenant.context,
      "exact-tiny",
      { next_action: "Unrelated underflow-evidence update" }
    );
    assert.equal(updatedDecimal.value, "1.234567890123456789");
    assert.equal(updatedDecimal.probability, "0.1234567890123456789");
    assert.equal(updatedTiny.value, "1e-4000");
    const afterUpdates = await getAdminClient().query(
      `select id, commercial_value::text as numeric_value,
         commercial_value_state, commercial_value_raw::text as raw_value,
         metadata#>>'{import,numeric_evidence,value,raw}' as exact_raw
       from tge.opportunities
       where tenant_id = $1 and id = any($2::text[])
       order by id`,
      [tenant.tenantId, ["exact-decimal", "exact-tiny"]]
    );
    const updatedById = Object.fromEntries(afterUpdates.rows.map(row => [row.id, row]));
    assert.equal(updatedById["exact-decimal"].numeric_value, "1.234567890123456789");
    assert.equal(updatedById["exact-decimal"].commercial_value_state, "KNOWN");
    assert.equal(updatedById["exact-decimal"].raw_value, "1.234567890123456789");
    assert.equal(updatedById["exact-decimal"].exact_raw, "1.234567890123456789");
    assert.equal(updatedById["exact-tiny"].numeric_value, byId["exact-tiny"].numeric_value);
    assert.equal(updatedById["exact-tiny"].commercial_value_state, "KNOWN");
    assert.equal(updatedById["exact-tiny"].exact_raw, "1e-4000");

    const unknownIdentityBatch = `canonical-unknown-identity-${randomUUID()}`;
    await stageCsvBatch(
      repositories,
      tenant.context,
      unknownIdentityBatch,
      "source_id,id,business_name,stage,value,probability\n" +
        "n/a,unknown-identity,Unknown Identity,QUALIFIED,0,0"
    );
    const unknownIdentity = await commitCsvBatch(
      repositories,
      tenant.context,
      unknownIdentityBatch,
      canonicalOpportunityInput(`unknown-identity-${randomUUID()}`)
    );
    assert.equal(unknownIdentity.outcome, "FAILED");
    const unknownIdentityMaps = await getAdminClient().query(
      `select count(*)::int as count from tge.import_id_map
       where tenant_id = $1 and source_system = 'pilot-crm'
         and source_record_id = 'n/a'`,
      [tenant.tenantId]
    );
    assert.equal(unknownIdentityMaps.rows[0].count, 0);
  });

  test("canonical import rejects PostgreSQL-unrepresentable numerics before SQL materialization", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const tenant = await createTenant("canonical-import-numeric-bounds");
    const batchId = `canonical-numeric-bounds-${randomUUID()}`;
    await stageCsvBatch(
      repositories,
      tenant.context,
      batchId,
      "source_id,id,business_name,stage,value,probability\n" +
        "source-huge,unrepresentable-huge,Huge Trade,QUALIFIED,1e999999999999999999999,0\n" +
        "source-tiny,unrepresentable-tiny,Tiny Trade,QUALIFIED,1e-16384,0"
    );

    const result = await commitCsvBatch(
      repositories,
      tenant.context,
      batchId,
      canonicalOpportunityInput(`numeric-bounds-${randomUUID()}`)
    );

    assert.equal(result.outcome, "FAILED");
    assert.equal(result.summary.failed, 2);
    assert.equal(result.failures.length, 2);
    assert.equal(result.failures.every(failure => failure.validationErrors.some(issue =>
      issue.code === "POSTGRES_NUMERIC_UNREPRESENTABLE"
      && issue.targetField === "value"
    )), true);
    const batch = await getAdminClient().query(
      `select status from tge.import_batches where tenant_id = $1 and id = $2`,
      [tenant.tenantId, batchId]
    );
    const canonical = await getAdminClient().query(
      `select id from tge.opportunities
       where tenant_id = $1 and id = any($2::text[])`,
      [tenant.tenantId, ["unrepresentable-huge", "unrepresentable-tiny"]]
    );
    assert.equal(batch.rows[0].status, "PREVIEWED");
    assert.deepEqual(canonical.rows, []);
  });

  test("migration 011 rejects NULL identity hashes and function evidence", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const tenant = await createTenant("canonical-import-null-guards");
    const batchId = `canonical-null-${randomUUID()}`;
    const staged = await stageCsvBatch(
      repositories,
      tenant.context,
      batchId,
      "source_id,id,business_name\nsource-null,prospect-null,Null Guard",
      "prospects"
    );
    await repositories.prospects.insert(tenant.context, {
      id: "prospect-null-target",
      business_name: "Null Target"
    });

    async function rejectsCheck(sql, params) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          "select tge.set_request_context($1::uuid, $2::text)",
          [tenant.tenantId, tenant.context.subjectId]
        );
        await assert.rejects(client.query(sql, params), error => error.code === "23514");
        await client.query("rollback");
      } finally {
        client.release();
      }
    }

    await rejectsCheck(
      `insert into tge.import_id_map (
         tenant_id, import_batch_id, source_collection, source_id,
         source_ordinal, source_system, source_record_id,
         canonical_payload_sha256, commit_idempotency_key,
         target_prospect_id, metadata
       ) values ($1, $2, 'prospects', $3, 0, 'pilot-crm', 'source-null',
         null, 'null-guard-attempt', 'prospect-null-target', '{}'::jsonb)`,
      [tenant.tenantId, batchId, staged.records[0].sourceId]
    );
    await rejectsCheck(
      `select tge.record_import_commit_outcome(
         $1::uuid, $2::text, 'row:0', 'COMMITTED', $3::timestamptz,
         '{}'::jsonb
       )`,
      [tenant.tenantId, batchId, "2026-09-02T00:00:00.000Z"]
    );
    await rejectsCheck(
      `select tge.record_import_commit_attempt(
         $1::uuid, $2::text, '{"summary":{}}'::jsonb, $3::timestamptz
       )`,
      [tenant.tenantId, batchId, "2026-09-02T00:00:00.000Z"]
    );
    await rejectsCheck(
      `select tge.record_import_commit_attempt(
         $1::uuid, $2::text,
         '{"outcome":"FAILED","summary":{"total":1}}'::jsonb,
         $3::timestamptz
       )`,
      [tenant.tenantId, batchId, "2026-09-02T00:00:00.000Z"]
    );
    await rejectsCheck(
      `select tge.finalize_import_commit(
         $1::uuid, $2::text, 'null-guard-attempt',
         '{"result":{"outcome":"COMMITTED"}}'::jsonb,
         $3::timestamptz
       )`,
      [tenant.tenantId, batchId, "2026-09-02T00:00:00.000Z"]
    );
  });

  test("illegal import lifecycle commit attempts are audited without transitions or raw cells", async () => {
    const pool = createPool();
    const repositories = createPostgresRepositories({ pool });
    const tenant = await createTenant("canonical-import-lifecycle-conflicts");
    const privateRaw = "private-lifecycle-cell";

    for (const status of ["STAGED", "READY", "FAILED", "EXPIRED"]) {
      const batchId = `canonical-${status.toLowerCase()}-${randomUUID()}`;
      await stageCsvBatch(
        repositories,
        tenant.context,
        batchId,
        "source_id,id,business_name,note\n" +
          `source-${status},prospect-${status},Lifecycle ${status},${privateRaw}`,
        "prospects"
      );
      await getAdminClient().query(
        "update tge.import_batches set status = $3 where tenant_id = $1 and id = $2",
        [tenant.tenantId, batchId, status]
      );
      const input = canonicalProspectInput(`lifecycle-${status}-${randomUUID()}`);
      const result = await commitCsvBatch(
        repositories,
        tenant.context,
        batchId,
        input
      );
      assert.equal(result.outcome, "CONFLICTED", status);
      assert.equal(result.batch.status, status);

      const evidence = await getAdminClient().query(
        `select batch.status, batch.conflict_summary, audit.payload
         from tge.import_batches batch
         join tge.audit_events audit
           on audit.tenant_id = batch.tenant_id
          and audit.entity_id = batch.id
          and audit.event_type = 'IMPORT_COMMIT_CONFLICTED'
         where batch.tenant_id = $1 and batch.id = $2`,
        [tenant.tenantId, batchId]
      );
      assert.equal(evidence.rows[0].status, status);
      assert.equal(evidence.rows[0].conflict_summary.lifecycleStatus, status);
      assert.equal(JSON.stringify(evidence.rows[0]).includes(privateRaw), false);
    }
  });

  test("prospect dedupe races become atomic bounded import conflicts", async () => {
    const pool = createPool({ max: 4 });
    const repositories = createPostgresRepositories({ pool });
    const tenant = await createTenant("canonical-import-dedupe-race");
    const leftBatch = `canonical-dedupe-left-${randomUUID()}`;
    const rightBatch = `canonical-dedupe-right-${randomUUID()}`;
    await stageCsvBatch(
      repositories,
      tenant.context,
      leftBatch,
      "source_id,id,business_name,dedupe_key\nsource-left,prospect-left,Left Trade,shared-key",
      "prospects"
    );
    await stageCsvBatch(
      repositories,
      tenant.context,
      rightBatch,
      "source_id,id,business_name,dedupe_key\nsource-right,prospect-right,Right Trade,shared-key",
      "prospects"
    );

    const [left, right] = await Promise.all([
      commitCsvBatch(
        repositories,
        tenant.context,
        leftBatch,
        canonicalProspectInput(`dedupe-left-${randomUUID()}`)
      ),
      commitCsvBatch(
        repositories,
        tenant.context,
        rightBatch,
        canonicalProspectInput(`dedupe-right-${randomUUID()}`)
      )
    ]);
    assert.deepEqual(
      [left.outcome, right.outcome].sort(),
      ["COMMITTED", "CONFLICTED"]
    );
    const conflict = [left, right].find(result => result.outcome === "CONFLICTED");
    assert.equal(conflict.conflicts[0].code, "PROSPECT_DEDUPE_KEY_COLLISION");
    const evidence = await getAdminClient().query(
      `select
         (select count(*)::int from tge.prospects
          where tenant_id = $1 and dedupe_key = 'shared-key') as canonical,
         (select count(*)::int from tge.import_id_map
          where tenant_id = $1 and source_system = 'pilot-crm'
            and source_record_id in ('source-left', 'source-right')) as maps,
         (select count(*)::int from tge.audit_events
          where tenant_id = $1 and event_type = 'IMPORT_COMMIT_CONFLICTED'
            and entity_id in ($2, $3)) as conflicted_audits`,
      [tenant.tenantId, leftBatch, rightBatch]
    );
    assert.deepEqual(evidence.rows[0], {
      canonical: 1,
      maps: 1,
      conflicted_audits: 1
    });

    const toctouBatch = `canonical-dedupe-toctou-${randomUUID()}`;
    await stageCsvBatch(
      repositories,
      tenant.context,
      toctouBatch,
      "source_id,id,business_name,dedupe_key\n" +
        "source-toctou,prospect-toctou,TOCTOU Trade,toctou-key",
      "prospects"
    );
    let insertedCompetitor = false;
    const racingRepositories = createPostgresRepositories({
      pool,
      async failureInjector(name) {
        if (name !== "beforeImportCanonicalInserted" || insertedCompetitor) return;
        insertedCompetitor = true;
        await getAdminClient().query(
          `insert into tge.prospects (
             tenant_id, id, business_name, dedupe_key, evidence, metadata,
             created_at, updated_at
           ) values ($1, 'prospect-toctou-winner', 'TOCTOU Winner',
             'toctou-key', '[]'::jsonb, '{}'::jsonb, now(), now())`,
          [tenant.tenantId]
        );
      }
    });
    const toctou = await commitCsvBatch(
      racingRepositories,
      tenant.context,
      toctouBatch,
      canonicalProspectInput(`dedupe-toctou-${randomUUID()}`)
    );
    assert.equal(toctou.outcome, "CONFLICTED");
    assert.equal(
      toctou.conflicts[0].code,
      "PROSPECT_DEDUPE_KEY_COLLISION"
    );
    const toctouEvidence = await getAdminClient().query(
      `select
         (select count(*)::int from tge.prospects
          where tenant_id = $1 and dedupe_key = 'toctou-key') as canonical,
         (select count(*)::int from tge.import_id_map
          where tenant_id = $1 and source_record_id = 'source-toctou') as maps,
         (select count(*)::int from tge.audit_events
          where tenant_id = $1 and entity_id = $2
            and event_type = 'IMPORT_COMMIT_CONFLICTED') as audits`,
      [tenant.tenantId, toctouBatch]
    );
    assert.deepEqual(toctouEvidence.rows[0], {
      canonical: 1,
      maps: 0,
      audits: 1
    });
  });

  test("concurrent canonical identities serialize and injected failure rolls back every write", async () => {
    const pool = createPool({ max: 4 });
    const repositories = createPostgresRepositories({ pool });
    const tenant = await createTenant("canonical-import-concurrency");
    const csv =
      "source_id,id,business_name,stage,value,probability\n" +
      "source-concurrent,canonical-concurrent,Concurrent Trade,QUALIFIED,0,0";
    const leftBatch = `canonical-left-${randomUUID()}`;
    const rightBatch = `canonical-right-${randomUUID()}`;
    await stageCsvBatch(repositories, tenant.context, leftBatch, csv);
    await stageCsvBatch(repositories, tenant.context, rightBatch, csv);

    const [left, right] = await Promise.all([
      commitCsvBatch(
        repositories,
        tenant.context,
        leftBatch,
        canonicalOpportunityInput("concurrent-left")
      ),
      commitCsvBatch(
        repositories,
        tenant.context,
        rightBatch,
        canonicalOpportunityInput("concurrent-right")
      )
    ]);
    assert.deepEqual(
      [left.summary.committed, right.summary.committed].sort(),
      [0, 1]
    );
    assert.deepEqual(
      [left.summary.skipped, right.summary.skipped].sort(),
      [0, 1]
    );
    const concurrentEvidence = await getAdminClient().query(
      `select
         (select count(*)::int from tge.opportunities
          where tenant_id = $1 and id = 'canonical-concurrent') as canonical,
         (select count(*)::int from tge.import_id_map
          where tenant_id = $1 and source_system = 'pilot-crm'
            and source_record_id = 'source-concurrent') as maps`,
      [tenant.tenantId]
    );
    assert.deepEqual(concurrentEvidence.rows[0], { canonical: 1, maps: 1 });

    const rollbackBatch = `canonical-rollback-${randomUUID()}`;
    const rollbackCsv = csv
      .replace("source-concurrent", "source-rollback")
      .replace("canonical-concurrent", "canonical-rollback")
      .replace("Concurrent Trade", "Rollback Trade");
    await stageCsvBatch(repositories, tenant.context, rollbackBatch, rollbackCsv);
    const failingRepositories = createPostgresRepositories({
      pool,
      async failureInjector(name) {
        if (name === "afterImportIdMapInserted") {
          throw new Error("injected canonical import rollback");
        }
      }
    });
    await assert.rejects(
      commitCsvBatch(
        failingRepositories,
        tenant.context,
        rollbackBatch,
        canonicalOpportunityInput("rollback-attempt")
      ),
      /injected canonical import rollback/
    );
    const rollbackEvidence = await getAdminClient().query(
      `select batch.status, record.disposition,
         (select count(*)::int from tge.opportunities
          where tenant_id = $1 and id = 'canonical-rollback') as canonical,
         (select count(*)::int from tge.import_id_map
          where tenant_id = $1 and source_record_id = 'source-rollback') as maps,
         (select count(*)::int from tge.audit_events
          where tenant_id = $1 and entity_id = $2
            and event_type = 'IMPORT_COMMIT_COMPLETED') as audits
       from tge.import_batches batch
       join tge.import_staging_records record
         on record.tenant_id = batch.tenant_id
        and record.import_batch_id = batch.id
       where batch.tenant_id = $1 and batch.id = $2`,
      [tenant.tenantId, rollbackBatch]
    );
    assert.deepEqual(rollbackEvidence.rows[0], {
      status: "PREVIEWED",
      disposition: "PENDING",
      canonical: 0,
      maps: 0,
      audits: 0
    });
  });

  async function stageCsvBatch(
    repositories,
    context,
    batchId,
    csv,
    sourceCollection = "opportunities"
  ) {
    const parsed = parseCsvUpload({
      filename: "canonical.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from(csv, "utf8").toString("base64")
    });
    const createdAt = "2026-09-01T00:00:00.000Z";
    return repositories.imports.stagePreview(context, {
      batch: {
        id: batchId,
        status: "PREVIEWED",
        sourceFilename: "canonical.csv",
        sourceSha256: parsed.sourceSha256,
        authorizedBySubjectId: context.subjectId,
        authorizationVerifiedAt: createdAt,
        previewSummary: {
          format: "CSV",
          sourceCollection,
          rowCount: parsed.rows.length,
          headers: parsed.headers
        },
        rawStorageKey: null,
        rawExpiresAt: "2026-09-08T00:00:00.000Z",
        metadataRetainUntil: "2027-09-01T00:00:00.000Z",
        createdAt
      },
      records: parsed.rows.map(row => ({
        id: `row:${row.sourceOrdinal}`,
        sourceCollection,
        sourceId: `csv-row:${row.sourceOrdinal}:${row.rawPayloadSha256}`,
        sourceOrdinal: row.sourceOrdinal,
        sourceRowNumber: row.sourceRowNumber,
        rawPayload: row.rawPayload,
        rawPayloadSha256: row.rawPayloadSha256,
        disposition: "PENDING",
        idempotencyKey: hashImportEvidence({
          batchId,
          sourceOrdinal: row.sourceOrdinal,
          rawPayloadSha256: row.rawPayloadSha256
        }),
        metadata: { source_id_kind: "SYNTHETIC_ROW_EVIDENCE" }
      })),
      auditEvent: {
        id: `import-preview:${batchId}`,
        eventType: "IMPORT_PREVIEW_CREATED",
        subjectId: context.subjectId,
        entityType: "import_batch",
        entityId: batchId,
        payload: {
          source_collection: sourceCollection,
          row_count: parsed.rows.length,
          external_action_performed: false
        },
        occurredAt: createdAt,
        retainUntil: "2027-09-01T00:00:00.000Z"
      }
    });
  }

  function canonicalOpportunityInput(idempotencyKey) {
    return {
      sourceSystem: "pilot-crm",
      idempotencyKey,
      sourceIdentitySelection: { sourceColumn: "source_id" },
      selections: [
        { targetField: "id", sourceColumn: "id", selectedType: "TEXT" },
        {
          targetField: "business_name",
          sourceColumn: "business_name",
          selectedType: "TEXT"
        },
        { targetField: "stage", sourceColumn: "stage", selectedType: "STATUS" },
        { targetField: "value", sourceColumn: "value", selectedType: "NUMBER" },
        {
          targetField: "probability",
          sourceColumn: "probability",
          selectedType: "NUMBER"
        }
      ]
    };
  }

  function canonicalProspectInput(idempotencyKey) {
    return {
      sourceSystem: "pilot-crm",
      idempotencyKey,
      sourceIdentitySelection: { sourceColumn: "source_id" },
      selections: [
        { targetField: "id", sourceColumn: "id", selectedType: "TEXT" },
        {
          targetField: "business_name",
          sourceColumn: "business_name",
          selectedType: "TEXT"
        },
        {
          targetField: "dedupe_key",
          sourceColumn: "dedupe_key",
          selectedType: "TEXT"
        }
      ]
    };
  }

  function commitCsvBatch(
    repositories,
    context,
    batchId,
    input,
    committedAt = "2026-09-02T00:00:00.000Z"
  ) {
    return repositories.imports.commitCanonical(context, {
      batchId,
      committedAt,
      subjectId: context.subjectId,
      input,
      prepare: evidence => buildCanonicalCommitPlan(evidence, input)
    });
  }

  async function createApprovedTaskAction(
    repositories,
    context,
    suffix,
    {
      actionId = `action-${suffix}`,
      beforeApprove
    } = {}
  ) {
    const opportunityId = `opportunity-${suffix}`;
    await repositories.opportunities.insert(context, {
      id: opportunityId,
      business_name: `Opportunity ${suffix}`,
      stage: "QUALIFIED",
      value: 0,
      next_action: ""
    });
    const action = (await repositories.revenueActions.materialize(context, {
      id: actionId,
      opportunity_id: opportunityId
    })).record;
    const prepared = await repositories.revenueActions.transition(context, action.id, {
      to: "PREPARED",
      proposedExecution: buildTaskProposal(action)
    });
    if (beforeApprove) await beforeApprove(prepared.record);
    const approved = await repositories.revenueActions.transition(
      context,
      action.id,
      { to: "APPROVED" }
    );
    return approved.record;
  }

  async function createApprovedCommunicationAction(
    repositories,
    context,
    suffix
  ) {
    const opportunityId = `communication-opportunity-${suffix}`;
    await repositories.opportunities.insert(context, {
      id: opportunityId,
      business_name: `Communication ${suffix}`,
      stage: "PROPOSAL",
      value: 42000,
      next_action: "Follow up on proposal",
      contact_name: "Ava Wilson"
    });
    const action = (await repositories.revenueActions.materialize(context, {
      id: `communication-action-${suffix}`,
      opportunity_id: opportunityId
    })).record;
    assert.equal(action.action_type, "FOLLOW_UP");
    const prepared = await repositories.revenueActions.transition(
      context,
      action.id,
      { to: "PREPARED" }
    );
    const approved = await repositories.revenueActions.transition(
      context,
      action.id,
      { to: "APPROVED" }
    );
    assert.equal(prepared.record.execution_type, "COMMUNICATION_DRAFT");
    return approved.record;
  }

  return async function closePostgresRepositoryPools() {
    await Promise.all([...pools].map(pool => pool.end()));
  };
}

async function buildCurrentRevenueAction(
  repositories,
  context,
  { id, opportunityId }
) {
  const [opportunity, prospects, tasks, activities] = await Promise.all([
    repositories.opportunities.findById(context, opportunityId),
    repositories.prospects.list(context),
    repositories.tasks.list(context, { opportunityId }),
    repositories.activities.list(context, { opportunityId })
  ]);
  const intelligence = buildDealIntelligenceFromData(opportunity, {
    prospects,
    tasks,
    activities
  });
  const { recommendation, evidence, basisFingerprint } =
    calculateRevenueActionBasis({ opportunity, intelligence });
  const executionType = recommendation.type === "FOLLOW_UP"
    ? "COMMUNICATION_DRAFT"
    : "INTERNAL_TASK";
  const timestamp = intelligence.generated_at;
  return {
    id,
    opportunity_id: opportunityId,
    action_type: recommendation.type,
    execution_type: executionType,
    approval_requirement: "HUMAN",
    risk_class: executionType === "COMMUNICATION_DRAFT"
      ? "EXTERNAL_CONSEQUENTIAL"
      : "INTERNAL",
    status: "RECOMMENDED",
    priority: recommendation.priority,
    title: recommendation.title,
    reason: recommendation.reason,
    evidence,
    recommendation_snapshot: {
      action_type: recommendation.type,
      title: recommendation.title,
      reason: recommendation.reason,
      priority: recommendation.priority,
      task_title: recommendation.taskTitle || null,
      evidence: JSON.parse(JSON.stringify(evidence)),
      generated_at: timestamp
    },
    basis_fingerprint: basisFingerprint,
    proposed_execution: null,
    execution_result: null,
    source: "DEAL_INTELLIGENCE",
    audit: [{
      transition: "CREATED_AS_RECOMMENDED",
      at: timestamp,
      source: "DEAL_INTELLIGENCE"
    }],
    created_at: timestamp,
    updated_at: timestamp,
    prepared_at: null,
    approved_at: null,
    executed_at: null,
    rejected_at: null,
    cancelled_at: null,
    failed_at: null,
    rejection_reason: null,
    resulting_task_id: null,
    resulting_activity_id: null
  };
}

function buildTaskProposal(action) {
  const title =
    action.recommendation_snapshot.task_title ||
    action.recommendation_snapshot.title;
  const normalizedTitle = String(title).trim().replace(/\s+/g, " ").toLowerCase();
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

async function inspectRawConnection(pool) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
        select
          pg_backend_pid()::int as pid,
          tge.current_tenant_id()::text as tenant_id,
          tge.current_subject_id() as subject_id,
          (select count(*)::int from tge.prospects) as visible_prospects
      `
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

function createFixtureStore(fixtures) {
  const data = Object.fromEntries(
    Object.entries(fixtures).map(([name, records]) => [
      name,
      JSON.parse(JSON.stringify(records))
    ])
  );
  return {
    readCollection(name) {
      return JSON.parse(JSON.stringify(data[name] || []));
    },
    findRecord(name, id) {
      return this.readCollection(name).find(record => record.id === id) || null;
    },
    createRecord(name, record) {
      data[name] ||= [];
      data[name].push(record);
      return record;
    },
    updateRecord(name, id, changes) {
      const index = data[name].findIndex(record => record.id === id);
      if (index === -1) return null;
      data[name][index] = { ...data[name][index], ...changes };
      return data[name][index];
    },
    deleteRecord(name, id) {
      const before = data[name].length;
      data[name] = data[name].filter(record => record.id !== id);
      return data[name].length !== before;
    }
  };
}

module.exports = {
  registerPostgresRepositoryContractTests
};
