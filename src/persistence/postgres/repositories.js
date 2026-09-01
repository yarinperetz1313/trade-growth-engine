const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

const {
  buildDealIntelligenceFromData
} = require("../../intelligence/dealIntelligence");
const {
  buildProposedExecution,
  calculateRevenueActionBasis,
  expectedRevenueActionSemantics,
  fingerprint,
  recommendationBasis
} = require("../../revenueActions/revenueActionBasis");
const {
  manualConfirmationRequired,
  revenueActionEffectConflict,
  revenueActionRecoveryRequired
} = require("../../revenueActions/revenueActionErrors");
const {
  activityFromRow,
  activityToRow,
  encodeColumnValue,
  opportunityFromRow,
  opportunityToRow,
  prospectFromRow,
  prospectToRow,
  rejectCallerTenant,
  revenueActionFromRow,
  revenueActionToRow,
  taskFromRow,
  taskToRow
} = require("./mappers");
const {
  withTenantTransaction
} = require("./transaction");

const ACTIVE_ACTION_STATUSES = [
  "RECOMMENDED",
  "PREPARED",
  "APPROVED",
  "EXECUTING",
  "FAILED"
];

const ENTITY_CONFIGS = {
  prospects: {
    table: "prospects",
    toRow: prospectToRow,
    fromRow: prospectFromRow,
    orderBy: "case when source_ordinal is null then 1 else 0 end, source_ordinal, live_ordinal",
    filters: {},
    mutableFields: new Set([
      "id", "business_name", "website", "email", "phone", "service",
      "location", "source", "source_url", "dedupe_key",
      "qualification_score", "qualification_status", "evidence", "metadata",
      "created_at", "updated_at"
    ])
  },
  opportunities: {
    table: "opportunities",
    toRow: opportunityToRow,
    fromRow: opportunityFromRow,
    orderBy: "case when source_ordinal is null then 1 else 0 end, source_ordinal, live_ordinal",
    filters: { prospectId: "prospect_id", stage: "stage" },
    mutableFields: new Set([
      "id", "prospect_id", "business_name", "stage", "priority",
      "qualification_score", "value", "probability", "weighted_value",
      "next_action", "contact_name", "metadata", "created_at", "updated_at"
    ])
  },
  tasks: {
    table: "tasks",
    toRow: taskToRow,
    fromRow: taskFromRow,
    orderBy: "case when source_ordinal is null then 1 else 0 end, source_ordinal, live_ordinal",
    filters: { opportunityId: "opportunity_id", status: "status" },
    mutableFields: new Set([
      "id", "opportunity_id", "title", "description", "due_at", "priority",
      "status", "completed_at", "metadata", "created_at", "updated_at"
    ])
  },
  activities: {
    table: "activities",
    toRow: activityToRow,
    fromRow: activityFromRow,
    orderBy: "case when source_ordinal is null then 1 else 0 end, source_ordinal, live_ordinal",
    filters: { opportunityId: "opportunity_id", prospectId: "prospect_id" },
    mutableFields: new Set([
      "id", "opportunity_id", "prospect_id", "type", "description",
      "metadata", "created_at", "updated_at"
    ])
  },
  revenueActions: {
    table: "revenue_actions",
    toRow: revenueActionToRow,
    fromRow: revenueActionFromRow,
    orderBy: "coalesce(source_created_at, created_at) desc, case when source_ordinal is null then 1 else 0 end, source_ordinal asc nulls last, live_ordinal asc",
    filters: { opportunityId: "opportunity_id", status: "status" }
  }
};

const LIFECYCLE_TRANSITIONS = {
  RECOMMENDED: new Set(["PREPARED", "CANCELLED"]),
  PREPARED: new Set(["APPROVED", "REJECTED", "CANCELLED"])
};

class PersistenceConflictError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PersistenceConflictError";
    this.code = code;
    this.details = details;
  }
}

function createPostgresRepositories({
  pool,
  failureInjector,
  onCleanupError,
  clock
} = {}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("PostgreSQL persistence requires an injected pool.");
  }
  if (failureInjector !== undefined && typeof failureInjector !== "function") {
    throw new TypeError("failureInjector must be a function when provided.");
  }
  if (clock !== undefined && typeof clock !== "function") {
    throw new TypeError("clock must be a function when provided.");
  }
  if (onCleanupError !== undefined && typeof onCleanupError !== "function") {
    throw new TypeError("onCleanupError must be a function when provided.");
  }

  const now = () => normalizeTimestamp(
    clock ? clock() : new Date(),
    "server clock"
  );
  const transactionScope = new AsyncLocalStorage();
  const repositoryScope = Object.freeze({});

  const run = (context, operation) => {
    if (transactionScope.getStore() === repositoryScope) {
      const error = new Error(
        "Nested public repository transactions are forbidden; use the scoped repositories supplied to transaction()."
      );
      error.code = "NESTED_REPOSITORY_TRANSACTION";
      throw error;
    }
    return withTenantTransaction(
      pool,
      context,
      transaction => transactionScope.run(repositoryScope, async () => {
        const scoped = createClientRepositories(transaction);
        return operation(scoped, transaction);
      }),
      { onCleanupError }
    );
  };

  const publicRepositories = Object.fromEntries(
    Object.keys(ENTITY_CONFIGS).map(name => {
      const mutable = name !== "revenueActions";
      return [name, {
        list: (context, filters) => run(
          context,
          scoped => scoped[name].list(filters)
        ),
        findById: (context, id) => run(
          context,
          scoped => scoped[name].findById(id)
        ),
        ...(mutable ? {
          insert: (context, record) => {
            const prepared = prepareInsertRecord(record, now);
            return run(
              context,
              scoped => scoped[name].insert(prepared)
            );
          },
          update: (context, id, changes) => run(
            context,
            scoped => scoped[name].update(id, changes)
          ),
          delete: (context, id) => run(
            context,
            scoped => scoped[name].delete(id)
          )
        } : {})
      }];
    })
  );

  publicRepositories.revenueActions.materialize = (context, action) => {
    const attemptedAction = prepareMaterializeAttempt(action);
    return run(
      context,
      scoped => scoped.revenueActions.materialize(attemptedAction)
    );
  };
  publicRepositories.revenueActions.transition = (context, id, transition) =>
    run(context, scoped => scoped.revenueActions.transition(id, transition));
  publicRepositories.revenueActions.executeAtomic = (context, id, plan) =>
    executeRevenueActionAtomic(context, id, plan);

  async function executeRevenueActionAtomic(
    context,
    id,
    plan = {},
    transactionOverride = null
  ) {
    let attemptedExecution = null;
    const operation = async transaction => {
        validateExecutionPlan(plan);
        const locked = await lockRevenueActionAndOpportunity(
          transaction.client,
          transaction.tenantId,
          id
        );
        if (!locked) return null;
        const { action, opportunity } = locked;
        const integrity = validateStoredRevenueActionIntegrity(action);
        if (!integrity.valid) {
          throw new PersistenceConflictError(
            integrity.conflict.code,
            integrity.conflict.message,
            integrity.conflict.details
          );
        }
        if (action.status === "EXECUTED") {
          const executedEffects = await inspectExecutionEffects(
            transaction.client,
            transaction.tenantId,
            action,
            opportunity
          );
          if (executedEffects.conflict || !executedEffects.complete) {
            const conflict = revenueActionEffectConflict(
              id,
              executedEffects.reason || "INCOMPLETE_LINKED_EFFECTS"
            );
            throw new PersistenceConflictError(
              conflict.code,
              conflict.message,
              conflict.details
            );
          }
          return { record: action, duplicate: true };
        }
        if (
          !["APPROVED", "FAILED", "EXECUTING"].includes(action.status) ||
          !action.approved_at
        ) {
          throw new PersistenceConflictError(
            "INVALID_REVENUE_ACTION_TRANSITION",
            `Cannot execute a revenue action from ${action.status}.`,
            { id, from: action.status, to: "EXECUTED" }
          );
        }
        const expectedMode = action.execution_type === "COMMUNICATION_DRAFT"
          ? "MANUAL_CONFIRMED"
          : "SYSTEM_INTERNAL";
        if (
          action.execution_type === "COMMUNICATION_DRAFT" &&
          plan.executionMode !== "MANUAL_CONFIRMED"
        ) {
          const conflict = manualConfirmationRequired();
          throw new PersistenceConflictError(
            conflict.code,
            conflict.message,
            conflict.details
          );
        }
        if (
          ["FAILED", "EXECUTING"].includes(action.status) &&
          action.execution_request?.mode !== expectedMode
        ) {
          throw new PersistenceConflictError(
            "INVALID_REVENUE_ACTION_TRANSITION",
            "Execution recovery requires a matching persisted execution request.",
            { id, requiredMode: expectedMode }
          );
        }

        const existingEffects = await inspectExecutionEffects(
          transaction.client,
          transaction.tenantId,
          action,
          opportunity
        );
        if (existingEffects.conflict) {
          const conflict = revenueActionEffectConflict(
            id,
            existingEffects.reason
          );
          throw new PersistenceConflictError(
            conflict.code,
            conflict.message,
            conflict.details
          );
        }

        const recovering = ["FAILED", "EXECUTING"].includes(action.status);
        if (!recovering && existingEffects.hasEffects) {
          const conflict = revenueActionEffectConflict(
            id,
            "EFFECTS_EXIST_BEFORE_EXECUTION_STARTED"
          );
          throw new PersistenceConflictError(
            conflict.code,
            conflict.message,
            conflict.details
          );
        }
        if (recovering && existingEffects.complete) {
          const recoveredAt = now();
          const recovered = await finalizeExecution(
            transaction.client,
            transaction.tenantId,
            action,
            existingEffects,
            {
              mode: expectedMode,
              outcome: "RECOVERED_LINKED_EFFECTS",
              external_send_performed: false
            },
            recoveredAt,
            transaction.subjectId
          );
          await checkpoint("afterActionFinalized", transaction, { id });
          await checkpoint("beforeCommit", transaction, { id });
          return { record: recovered, duplicate: false, recovered: true };
        }
        if (
          recovering &&
          existingEffects.hasEffects &&
          !(
            action.execution_type === "INTERNAL_TASK" &&
            existingEffects.task
          )
        ) {
          const conflict = revenueActionEffectConflict(
            id,
            "INCOMPLETE_LINKED_EFFECTS"
          );
          throw new PersistenceConflictError(
            conflict.code,
            conflict.message,
            conflict.details
          );
        }

        const basisValidation = await validateRevenueActionBasis(
          transaction.client,
          transaction.tenantId,
          action,
          opportunity
        );
        if (!basisValidation.valid) {
          const supersededAt = now();
          const cancelled = await cancelSupersededRevenueAction(
            transaction.client,
            transaction.tenantId,
            action,
            basisValidation,
            supersededAt,
            "EXECUTE",
            transaction.subjectId
          );
          return {
            record: cancelled,
            duplicate: false,
            conflict: basisValidation.conflict
          };
        }

        const requestedAt = now();
        const attempt = (action.execution_attempts || 0) + 1;
        attemptedExecution = { id, mode: expectedMode, requestedAt };
        const executing = await updateRevenueActionLifecycle(
          transaction.client,
          transaction.tenantId,
          id,
          {
            status: "EXECUTING",
            execution_request: { mode: expectedMode, requested_at: requestedAt },
            execution_attempts: attempt,
            failed_at: null,
            updated_at: requestedAt,
            audit: appendAudit(action.audit, "EXECUTION_STARTED", requestedAt, {
              attempt,
              subject_id: transaction.subjectId
            })
          }
        );
        await checkpoint("afterExecutionStarted", transaction, { id });

        let task = existingEffects.task || null;
        let taskReused = Boolean(task);
        if (executing.execution_type === "INTERNAL_TASK" && !task) {
          const taskEffect = await persistInternalTask(
            transaction.client,
            transaction.tenantId,
            executing,
            requestedAt
          );
          task = taskEffect.task;
          taskReused = taskEffect.reused;
          await checkpoint("afterTaskPersisted", transaction, { id, taskId: task.id });
        }

        let activity = existingEffects.activity || null;
        if (!activity) {
          activity = await persistExecutionActivity(
            transaction.client,
            transaction.tenantId,
            executing,
            task,
            taskReused,
            requestedAt
          );
          await checkpoint(
            "afterActivityPersisted",
            transaction,
            { id, activityId: activity.id }
          );
        }

        if (executing.action_type === "CREATE_TASK") {
          await transaction.client.query(
            `
              update tge.opportunities
              set next_action = $3, updated_at = $4
              where tenant_id = $1 and id = $2
            `,
            [transaction.tenantId, executing.opportunity_id, task.title, requestedAt]
          );
        }
        await checkpoint("afterOpportunityUpdated", transaction, { id });

        const completedAt = now();
        const result = {
          mode: expectedMode,
          outcome: task
            ? taskReused ? "TASK_REUSED" : "TASK_CREATED"
            : "USER_CONFIRMED_COMPLETION",
          external_send_performed: false
        };
        const finalized = await finalizeExecution(
          transaction.client,
          transaction.tenantId,
          executing,
          { task, activity },
          result,
          completedAt,
          transaction.subjectId
        );
        await checkpoint("afterActionFinalized", transaction, { id });
        await checkpoint("beforeCommit", transaction, { id });
        return { record: finalized, duplicate: false, recovered: false };
    };

    const executeInTransaction = transaction => runExecutionAttempt(
      transaction,
      operation,
      () => attemptedExecution
    );
    const outcome = transactionOverride
      ? await executeInTransaction(transactionOverride)
      : await run(context, (scoped, transaction) =>
          executeInTransaction(transaction));

    if (!transactionOverride && outcome?.executionError) {
      Object.defineProperty(outcome.executionError, "failedAction", {
        configurable: true,
        enumerable: false,
        value: outcome.failedAction
      });
      throw outcome.executionError;
    }
    return outcome;
  }

  async function runExecutionAttempt(transaction, operation, getAttempt) {
    await transaction.client.query("SAVEPOINT revenue_action_execution_attempt");
    try {
      const result = await operation(transaction);
      await transaction.client.query("RELEASE SAVEPOINT revenue_action_execution_attempt");
      return result;
    } catch (executionError) {
      await transaction.client.query("ROLLBACK TO SAVEPOINT revenue_action_execution_attempt");
      await transaction.client.query("RELEASE SAVEPOINT revenue_action_execution_attempt");
      const attempt = getAttempt();
      if (!attempt || executionError.outcomeUnknown) throw executionError;
      try {
        const failedAction = await markExecutionFailed(transaction, attempt);
        return { executionError, failedAction };
      } catch (failurePersistenceError) {
        Object.defineProperty(executionError, "failurePersistenceError", {
          configurable: true,
          enumerable: false,
          value: failurePersistenceError
        });
        throw executionError;
      }
    }
  }

  async function markExecutionFailed(transaction, attempt) {
      const locked = await lockRevenueActionAndOpportunity(
        transaction.client,
        transaction.tenantId,
        attempt.id
      );
      if (!locked) return null;
      const { action } = locked;
      if (action.status === "EXECUTED") return action;
      if (!["APPROVED", "EXECUTING", "FAILED"].includes(action.status)) {
        return action;
      }

      const failedAt = now();
      const attemptNumber = (action.execution_attempts || 0) + 1;
      const startedAudit = appendAudit(
        action.audit,
        "EXECUTION_STARTED",
        attempt.requestedAt,
        { attempt: attemptNumber, subject_id: transaction.subjectId }
      );
      return updateRevenueActionLifecycle(
        transaction.client,
        transaction.tenantId,
        attempt.id,
        {
          status: "FAILED",
          execution_request: {
            mode: attempt.mode,
            requested_at: attempt.requestedAt
          },
          execution_result: {
            mode: attempt.mode,
            outcome: "FAILED",
            external_send_performed: false,
            error: "EXECUTION_EFFECT_FAILED"
          },
          execution_attempts: attemptNumber,
          failed_at: failedAt,
          updated_at: failedAt,
          audit: appendAudit(startedAudit, "FAILED", failedAt, {
            error: "EXECUTION_EFFECT_FAILED",
            subject_id: transaction.subjectId
          })
        }
      );
  }

  async function checkpoint(name, transaction, details) {
    if (!failureInjector) return;
    await failureInjector(name, {
      ...details,
      client: transaction.client,
      context: transaction.context
    });
  }

  function createClientRepositories(transaction) {
    const scoped = Object.fromEntries(
      Object.entries(ENTITY_CONFIGS).map(([name, config]) => [
        name,
        createEntityRepository(
          transaction.client,
          transaction.tenantId,
          config,
          now
        )
      ])
    );

    delete scoped.revenueActions.update;
    delete scoped.revenueActions.delete;
    delete scoped.revenueActions.insert;

    scoped.revenueActions.materialize = action => materializeRevenueAction(
      transaction.client,
      transaction.tenantId,
      action,
      now,
      transaction.subjectId,
      (name, details) => checkpoint(name, transaction, details)
    );
    scoped.revenueActions.transition = (id, transition) => transitionRevenueAction(
      transaction.client,
      transaction.tenantId,
      id,
      transition,
      now,
      transaction.subjectId
    );
    scoped.revenueActions.executeAtomic = (id, plan) =>
      executeRevenueActionAtomic(null, id, plan, transaction);
    return scoped;
  }

  return {
    ...publicRepositories,
    transaction: (context, operation) => {
      if (typeof operation !== "function") {
        throw new TypeError("A persistence transaction operation is required.");
      }
      return run(context, scoped => operation(scoped));
    }
  };
}

function createEntityRepository(client, tenantId, config, now) {
  return {
    async list(filters = {}) {
      const values = [tenantId];
      const predicates = ["tenant_id = $1"];
      for (const [filterName, column] of Object.entries(config.filters)) {
        if (filters?.[filterName] === undefined) continue;
        values.push(filters[filterName]);
        predicates.push(`${column} = $${values.length}`);
      }
      const result = await client.query(
        `select * from tge.${config.table}
         where ${predicates.join(" and ")}
         order by ${config.orderBy}`,
        values
      );
      return result.rows.map(config.fromRow);
    },

    async findById(id, { lock = false } = {}) {
      const result = await client.query(
        `select * from tge.${config.table}
         where tenant_id = $1 and id = $2${lock ? " for update" : ""}`,
        [tenantId, id]
      );
      return result.rows[0] ? config.fromRow(result.rows[0]) : null;
    },

    async insert(record) {
      const prepared = prepareInsertRecord(record, now);
      rejectCallerAuthoredRevenueActionEvidence(config, prepared);
      await lockParentOpportunitiesForMutation(
        client,
        tenantId,
        config,
        [prepared.opportunity_id]
      );
      const result = await insertMappedRow(
        client,
        tenantId,
        config,
        prepared
      );
      return config.fromRow(result);
    },

    async update(id, changes) {
      rejectCallerTenant(changes);
      validateUpdateChanges(config, changes);
      rejectCallerAuthoredRevenueActionEvidence(config, changes);
      if (["tasks", "activities"].includes(config.table)) {
        const preview = await client.query(
          `select opportunity_id from tge.${config.table}
           where tenant_id = $1 and id = $2`,
          [tenantId, id]
        );
        if (preview.rows.length === 0) return null;
        await lockParentOpportunitiesForMutation(
          client,
          tenantId,
          config,
          [preview.rows[0].opportunity_id, changes.opportunity_id]
        );
      }
      const selected = await client.query(
        `select * from tge.${config.table}
         where tenant_id = $1 and id = $2
         for update`,
        [tenantId, id]
      );
      if (selected.rows.length === 0) return null;
      rejectMutationOfRevenueActionEffect(config, selected.rows[0], changes);

      const current = config.fromRow(selected.rows[0]);
      const updatedAt = now();
      const nextId = Object.hasOwn(changes, "id")
        ? normalizeIdentifier(changes.id)
        : id;
      const createdAt = Object.hasOwn(changes, "created_at")
        ? normalizeTimestamp(changes.created_at, "created_at")
        : current.created_at;
      const merged = {
        ...current,
        ...changes,
        id: nextId,
        created_at: createdAt,
        updated_at: updatedAt
      };
      const mapped = config.toRow(merged);
      const immutableColumns = new Set([
        "source_ordinal",
        "source_created_at",
        "source_updated_at",
        "legacy_payload"
      ]);
      const entries = Object.entries(mapped).filter(
        ([column]) => !immutableColumns.has(column)
      );
      const values = [tenantId, id];
      const assignments = entries.map(([column, value]) => {
        values.push(encodeColumnValue(column, value));
        return `${column} = $${values.length}`;
      });
      const result = await client.query(
        `update tge.${config.table}
         set ${assignments.join(", ")}
         where tenant_id = $1 and id = $2
         returning *`,
        values
      );
      return config.fromRow(result.rows[0]);
    },

    async delete(id) {
      if (["tasks", "activities"].includes(config.table)) {
        const preview = await client.query(
          `select opportunity_id from tge.${config.table}
           where tenant_id = $1 and id = $2`,
          [tenantId, id]
        );
        if (preview.rows.length === 0) return false;
        await lockParentOpportunitiesForMutation(
          client,
          tenantId,
          config,
          [preview.rows[0].opportunity_id]
        );
      }
      const actionEffectPredicate = ["tasks", "activities"].includes(config.table)
        ? " and revenue_action_id is null"
        : "";
      const result = await client.query(
        `delete from tge.${config.table}
         where tenant_id = $1 and id = $2${actionEffectPredicate}
         returning id`,
        [tenantId, id]
      );
      return result.rows.length === 1;
    }
  };
}

async function lockParentOpportunitiesForMutation(
  client,
  tenantId,
  config,
  opportunityIds
) {
  if (!["tasks", "activities"].includes(config.table)) return;
  const ids = [...new Set(opportunityIds.filter(Boolean))].sort();
  if (ids.length === 0) return;
  await client.query(
    `select id from tge.opportunities
     where tenant_id = $1 and id = any($2::text[])
     order by id
     for update`,
    [tenantId, ids]
  );
}

function prepareInsertRecord(record, now) {
  rejectCallerTenant(record);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("A persistence record object is required.");
  }
  const timestamp = now();
  const hasId = Object.hasOwn(record, "id");
  const hasCreatedAt = Object.hasOwn(record, "created_at");
  const hasUpdatedAt = Object.hasOwn(record, "updated_at");
  const id = hasId ? normalizeIdentifier(record.id) : crypto.randomUUID();
  const createdAt = hasCreatedAt
    ? normalizeTimestamp(record.created_at, "created_at")
    : timestamp;
  const updatedAt = hasUpdatedAt
    ? normalizeTimestamp(record.updated_at, "updated_at")
    : timestamp;
  return {
    ...record,
    id,
    created_at: createdAt,
    updated_at: updatedAt
  };
}

function normalizeIdentifier(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    const error = new TypeError("Persistence record IDs must be non-empty strings.");
    error.code = "RECORD_ID_INVALID";
    throw error;
  }
  return value;
}

function normalizeTimestamp(value, field) {
  if (
    value === null ||
    value === undefined ||
    (!(value instanceof Date) && typeof value !== "string") ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    const error = new TypeError(`${field} must be a valid timestamp.`);
    error.code = "RECORD_TIMESTAMP_INVALID";
    error.field = field;
    throw error;
  }
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    const error = new TypeError(`${field} must be a valid timestamp.`);
    error.code = "RECORD_TIMESTAMP_INVALID";
    error.field = field;
    throw error;
  }
  return timestamp.toISOString();
}

function validateUpdateChanges(config, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new TypeError("Persistence updates require a record patch object.");
  }
  const immutable = new Set([
    "tenant_id",
    "tenantId",
    "legacy_payload",
    "current_payload",
    "source_ordinal",
    "source_created_at",
    "source_updated_at",
    "live_ordinal",
    "commercial_value",
    "commercial_value_state",
    "commercial_value_raw",
    "revenue_action_id"
  ]);
  const unsupported = Object.keys(changes).filter(field => immutable.has(field));
  if (unsupported.length > 0) {
    const error = new Error(
      "Persistence updates cannot mutate tenant, imported-source, or database-managed evidence."
    );
    error.code = "RECORD_FIELD_IMMUTABLE";
    error.fields = unsupported;
    throw error;
  }
}

function rejectCallerAuthoredRevenueActionEvidence(config, record) {
  if (!record?.metadata || !["tasks", "activities"].includes(config.table)) {
    return;
  }
  const metadata = record.metadata;
  const reserved = [
    "revenue_action_id",
    "execution_effect_type",
    "execution_mode",
    "action_key",
    "revenue_action_linked_at"
  ];
  if (
    metadata.source === "revenue_action" ||
    reserved.some(field => Object.hasOwn(metadata, field))
  ) {
    const error = new Error(
      "RevenueAction effect evidence can only be authored by atomic execution."
    );
    error.code = "REVENUE_ACTION_EFFECT_EVIDENCE_FORBIDDEN";
    throw error;
  }
}

function rejectMutationOfRevenueActionEffect(config, row, changes) {
  if (
    ["tasks", "activities"].includes(config.table) &&
    row.revenue_action_id
  ) {
    if (
      config.table === "tasks" &&
      Object.keys(changes).every(field =>
        ["status", "completed_at"].includes(field))
    ) {
      return;
    }
    const error = new Error(
      "RevenueAction effects can only be mutated by atomic lifecycle operations."
    );
    error.code = "REVENUE_ACTION_EFFECT_IMMUTABLE";
    throw error;
  }
}

async function insertMappedRow(
  client,
  tenantId,
  config,
  record,
  conflictClause = ""
) {
  const mapped = config.toRow(record);
  const entries = Object.entries(mapped);
  const columns = ["tenant_id", ...entries.map(([column]) => column)];
  const values = [
    tenantId,
    ...entries.map(([column, value]) => encodeColumnValue(column, value))
  ];
  const placeholders = values.map((_, index) => `$${index + 1}`);
  const result = await client.query(
    `insert into tge.${config.table} (${columns.join(", ")})
     values (${placeholders.join(", ")})
     ${conflictClause}
     returning *`,
    values
  );
  return result.rows[0] || null;
}

async function materializeRevenueAction(
  client,
  tenantId,
  input,
  now,
  subjectId,
  checkpoint = async () => {}
) {
  validateMaterializeInput(input);
  const opportunityResult = await client.query(
    `select * from tge.opportunities
     where tenant_id = $1 and id = $2
     for share`,
    [tenantId, input.opportunity_id]
  );
  if (opportunityResult.rows.length === 0) return null;
  const opportunity = opportunityFromRow(opportunityResult.rows[0]);
  if (["WON", "LOST"].includes(opportunity.stage)) {
    throw new PersistenceConflictError(
      "REVENUE_ACTION_OPPORTUNITY_CLOSED",
      "Closed opportunities cannot enter an active execution lifecycle.",
      { opportunityId: opportunity.id, stage: opportunity.stage }
    );
  }
  const action = await buildCurrentRevenueActionRecord(
    client,
    tenantId,
    opportunity,
    input,
    now(),
    subjectId
  );
  const active = await client.query(
    `select * from tge.revenue_actions
     where tenant_id = $1 and opportunity_id = $2
       and status = any($3::text[])
     order by id
     for update`,
    [tenantId, action.opportunity_id, ACTIVE_ACTION_STATUSES]
  );
  for (const row of active.rows) {
    const stored = revenueActionFromRow(row);
    const integrity = validateStoredRevenueActionIntegrity(stored);
    if (!integrity.valid) {
      const quarantined = await quarantineInvalidRevenueAction(
        client,
        tenantId,
        stored,
        integrity,
        now(),
        subjectId
      );
      return {
        record: quarantined,
        created: false,
        duplicate: false,
        conflict: integrity.conflict
      };
    }
  }
  const sameIdentity = active.rows.find(row =>
    row.action_type === action.action_type &&
    row.basis_fingerprint === action.basis_fingerprint
  );
  const recoveryRequired = active.rows.find(row =>
    ["EXECUTING", "FAILED"].includes(row.status) &&
    (row.resulting_task_id || row.resulting_activity_id)
  );
  if (recoveryRequired) {
    const conflict = revenueActionRecoveryRequired(
      recoveryRequired.id,
      action.opportunity_id
    );
    throw new PersistenceConflictError(
      conflict.code,
      conflict.message,
      conflict.details
    );
  }

  const incompatible = active.rows.filter(row => row !== sameIdentity);
  if (incompatible.length > 0) {
    const cancelledAt = now();
    for (const row of incompatible) {
      await updateRevenueActionLifecycle(client, tenantId, row.id, {
        status: "CANCELLED",
        cancelled_at: cancelledAt,
        updated_at: cancelledAt,
        audit: appendAudit(
          row.audit,
          "SUPERSEDED_BY_CURRENT_RECOMMENDATION",
          cancelledAt,
          {
            replacement_action_type: action.action_type,
            replacement_fingerprint: action.basis_fingerprint,
            ...(subjectId ? { subject_id: subjectId } : {})
          }
        )
      });
    }
  }

  if (sameIdentity) {
    return {
      record: revenueActionFromRow(sameIdentity),
      created: false,
      duplicate: true
    };
  }

  await checkpoint("beforeRevenueActionInsert", {
    id: action.id,
    opportunityId: action.opportunity_id,
    basisFingerprint: action.basis_fingerprint
  });
  const inserted = await insertMappedRow(
    client,
    tenantId,
    ENTITY_CONFIGS.revenueActions,
    action,
    `on conflict (tenant_id, opportunity_id, action_type, basis_fingerprint)
       where status in ('RECOMMENDED', 'PREPARED', 'APPROVED', 'EXECUTING', 'FAILED')
       do nothing`
  );
  if (inserted) {
    return {
      record: revenueActionFromRow(inserted),
      created: true,
      duplicate: false
    };
  }

  const existing = await client.query(
    `select * from tge.revenue_actions
     where tenant_id = $1 and opportunity_id = $2
       and action_type = $3 and basis_fingerprint = $4
       and status = any($5::text[])
     order by created_at desc, live_ordinal asc
     limit 1
     for update`,
    [
      tenantId,
      action.opportunity_id,
      action.action_type,
      action.basis_fingerprint,
      ACTIVE_ACTION_STATUSES
    ]
  );
  if (!existing.rows[0]) {
    throw new PersistenceConflictError(
      "REVENUE_ACTION_MATERIALIZATION_CONFLICT",
      "The active RevenueAction identity changed during materialization.",
      { opportunityId: action.opportunity_id }
    );
  }
  const stored = revenueActionFromRow(existing.rows[0]);
  const integrity = validateStoredRevenueActionIntegrity(stored);
  if (!integrity.valid) {
    const quarantined = await quarantineInvalidRevenueAction(
      client,
      tenantId,
      stored,
      integrity,
      now(),
      subjectId
    );
    return {
      record: quarantined,
      created: false,
      duplicate: false,
      conflict: integrity.conflict
    };
  }
  return {
    record: stored,
    created: false,
    duplicate: true
  };
}

function validateMaterializeInput(input) {
  rejectCallerTenant(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("RevenueAction materialization requires an input object.");
  }
  const allowed = new Set(["id", "opportunity_id"]);
  const forbidden = Object.keys(input).filter(field => !allowed.has(field));
  if (forbidden.length > 0) {
    const error = new Error(
      "RevenueAction evidence and lifecycle state are derived by the repository."
    );
    error.code = "REVENUE_ACTION_EVIDENCE_OVERRIDE_FORBIDDEN";
    error.fields = forbidden;
    throw error;
  }
  normalizeIdentifier(input.opportunity_id);
  if (Object.hasOwn(input, "id")) normalizeIdentifier(input.id);
}

function prepareMaterializeAttempt(input) {
  validateMaterializeInput(input);
  return {
    ...input,
    id: Object.hasOwn(input, "id") ? input.id : crypto.randomUUID()
  };
}

async function buildCurrentRevenueActionRecord(
  client,
  tenantId,
  opportunity,
  input,
  at,
  subjectId
) {
  const prospects = await client.query(
    `select * from tge.prospects
     where tenant_id = $1 and id = $2
     order by case when source_ordinal is null then 1 else 0 end,
       source_ordinal, live_ordinal
     for share`,
    [tenantId, opportunity.prospect_id]
  );
  const tasks = await client.query(
    `select * from tge.tasks
     where tenant_id = $1 and opportunity_id = $2
     order by case when source_ordinal is null then 1 else 0 end,
       source_ordinal, live_ordinal
     for share`,
    [tenantId, opportunity.id]
  );
  const activities = await client.query(
    `select * from tge.activities
     where tenant_id = $1 and opportunity_id = $2
     order by case when source_ordinal is null then 1 else 0 end,
       source_ordinal, live_ordinal
     for share`,
    [tenantId, opportunity.id]
  );
  const intelligence = buildDealIntelligenceFromData(opportunity, {
    prospects: prospects.rows.map(prospectFromRow),
    tasks: tasks.rows.map(taskFromRow),
    activities: activities.rows.map(activityFromRow),
    generatedAt: at
  });
  const { recommendation, evidence, basisFingerprint } =
    calculateRevenueActionBasis({ opportunity, intelligence });
  const semantics = expectedRevenueActionSemantics(recommendation?.type);
  if (!semantics) {
    throw new PersistenceConflictError(
      "RECOMMENDATION_NOT_EXECUTABLE",
      "The current recommendation does not have an execution adapter.",
      { actionType: recommendation?.type || null }
    );
  }
  return {
    id: Object.hasOwn(input, "id") ? input.id : crypto.randomUUID(),
    opportunity_id: opportunity.id,
    action_type: recommendation.type,
    execution_type: semantics.executionType,
    approval_requirement: semantics.approvalRequirement,
    risk_class: semantics.riskClass,
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
      generated_at: intelligence.generated_at
    },
    basis_fingerprint: basisFingerprint,
    proposed_execution: null,
    execution_request: null,
    execution_result: null,
    source: semantics.source,
    audit: [{
      transition: "CREATED_AS_RECOMMENDED",
      at,
      source: semantics.source,
      ...(subjectId ? { subject_id: subjectId } : {})
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
    created_at: at,
    updated_at: at
  };
}

async function lockRevenueActionAndOpportunity(client, tenantId, id) {
  const preview = await client.query(
    `select opportunity_id from tge.revenue_actions
     where tenant_id = $1 and id = $2`,
    [tenantId, id]
  );
  if (preview.rows.length === 0) return null;

  const opportunityResult = await client.query(
    `select * from tge.opportunities
     where tenant_id = $1 and id = $2
     for update`,
    [tenantId, preview.rows[0].opportunity_id]
  );
  if (opportunityResult.rows.length === 0) return null;

  const actionResult = await client.query(
    `select * from tge.revenue_actions
     where tenant_id = $1 and id = $2
     for update`,
    [tenantId, id]
  );
  if (actionResult.rows.length === 0) return null;

  return {
    action: revenueActionFromRow(actionResult.rows[0]),
    opportunity: opportunityFromRow(opportunityResult.rows[0])
  };
}

async function transitionRevenueAction(
  client,
  tenantId,
  id,
  transition = {},
  now,
  subjectId
) {
  validateTransitionRequest(transition);
  const locked = await lockRevenueActionAndOpportunity(client, tenantId, id);
  if (!locked) return null;
  const { action, opportunity } = locked;
  const integrity = validateStoredRevenueActionIntegrity(action);
  if (!integrity.valid) {
    throw new PersistenceConflictError(
      integrity.conflict.code,
      integrity.conflict.message,
      integrity.conflict.details
    );
  }
  const to = transition.to;
  if (["PREPARED", "APPROVED"].includes(to)) {
    const basisValidation = await validateRevenueActionBasis(
      client,
      tenantId,
      action,
      opportunity
    );
    if (!basisValidation.valid) {
      const supersededAt = now();
      const cancelled = await cancelSupersededRevenueAction(
        client,
        tenantId,
        action,
        basisValidation,
        supersededAt,
        to,
        subjectId
      );
      return {
        record: cancelled,
        duplicate: false,
        conflict: basisValidation.conflict
      };
    }
  }
  if (action.status === to) return { record: action, duplicate: true };
  if (!LIFECYCLE_TRANSITIONS[action.status]?.has(to)) {
    throw new PersistenceConflictError(
      "INVALID_REVENUE_ACTION_TRANSITION",
      `Cannot transition a revenue action from ${action.status} to ${to}.`,
      { id, from: action.status, to }
    );
  }

  const at = now();
  const rejectionReason = to === "REJECTED"
    ? normalizeRejectionReason(transition.rejectionReason)
    : null;
  const auditMetadata = {
    ...sanitizeAuditMetadata(transition.metadata),
    ...(to === "APPROVED" ? { approval: "HUMAN" } : {}),
    ...(to === "REJECTED" ? { reason: rejectionReason } : {}),
    ...(subjectId ? { subject_id: subjectId } : {})
  };
  const changes = {
    status: to,
    updated_at: at,
    audit: appendAudit(action.audit, to, at, auditMetadata)
  };
  if (to === "PREPARED") {
    const proposedExecution = buildProposedExecution(action);
    if (!proposedExecution) {
      throw new PersistenceConflictError(
        "REVENUE_ACTION_EXECUTION_SEMANTICS_INVALID",
        "The revenue action execution semantics are not deterministic.",
        { id }
      );
    }
    if (
      transition.proposedExecution !== undefined &&
      fingerprint(transition.proposedExecution) !== fingerprint(proposedExecution)
    ) {
      throw new PersistenceConflictError(
        "PROPOSED_EXECUTION_INVALID",
        "The proposed execution must match the deterministic recommendation.",
        { id }
      );
    }
    changes.prepared_at = at;
    changes.proposed_execution = proposedExecution;
  } else if (to === "APPROVED") {
    changes.approved_at = at;
  } else if (to === "REJECTED") {
    changes.rejected_at = at;
    changes.rejection_reason = rejectionReason;
  } else if (to === "CANCELLED") {
    changes.cancelled_at = at;
  }

  const updated = await updateRevenueActionLifecycle(
    client,
    tenantId,
    id,
    changes
  );
  return { record: updated, duplicate: false };
}

function validateTransitionRequest(transition) {
  if (!transition || typeof transition !== "object" || Array.isArray(transition)) {
    throw new TypeError("A RevenueAction transition object is required.");
  }
  const allowed = new Set(["to", "rejectionReason", "metadata", "proposedExecution"]);
  const forbidden = Object.keys(transition).filter(field => !allowed.has(field));
  if (forbidden.length > 0) {
    const error = new Error(
      "RevenueAction transition names, timestamps, and reserved audit evidence are server-derived."
    );
    error.code = "REVENUE_ACTION_AUDIT_OVERRIDE_FORBIDDEN";
    error.fields = forbidden;
    throw error;
  }
  if (typeof transition.to !== "string" || transition.to.trim().length === 0) {
    throw new TypeError("A RevenueAction destination status is required.");
  }
}

function sanitizeAuditMetadata(metadata) {
  if (metadata === undefined) return {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("RevenueAction audit metadata must be an object.");
  }
  const allowed = new Set(["request_id", "correlation_id", "note"]);
  const forbidden = Object.keys(metadata).filter(field => !allowed.has(field));
  if (forbidden.length > 0) {
    const error = new Error("RevenueAction audit metadata contains non-additive fields.");
    error.code = "REVENUE_ACTION_AUDIT_METADATA_FORBIDDEN";
    error.fields = forbidden;
    throw error;
  }
  return Object.fromEntries(Object.entries(metadata).map(([field, value]) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      const error = new TypeError(
        "RevenueAction additive audit metadata values must be non-empty strings."
      );
      error.code = "REVENUE_ACTION_AUDIT_METADATA_INVALID";
      error.field = field;
      throw error;
    }
    return [field, value.trim().slice(0, 512)];
  }));
}

function normalizeRejectionReason(reason) {
  if (reason === undefined || reason === null) return null;
  if (typeof reason !== "string") {
    throw new TypeError("RevenueAction rejection reason must be a string.");
  }
  return reason.trim().replace(/\s+/g, " ") || null;
}

async function updateRevenueActionLifecycle(client, tenantId, id, changes) {
  const allowed = new Set([
    "status",
    "proposed_execution",
    "execution_request",
    "execution_result",
    "audit",
    "execution_attempts",
    "prepared_at",
    "approved_at",
    "executed_at",
    "rejected_at",
    "cancelled_at",
    "failed_at",
    "rejection_reason",
    "resulting_task_id",
    "resulting_activity_id",
    "updated_at"
  ]);
  const entries = Object.entries(changes).filter(([column]) => allowed.has(column));
  if (entries.length !== Object.keys(changes).length) {
    throw new TypeError("RevenueAction lifecycle updates contain immutable fields.");
  }
  const values = [tenantId, id];
  const assignments = entries.map(([column, value]) => {
    values.push(encodeColumnValue(column, value));
    return `${column} = $${values.length}`;
  });
  const result = await client.query(
    `update tge.revenue_actions
     set ${assignments.join(", ")}
     where tenant_id = $1 and id = $2
     returning *`,
    values
  );
  return result.rows[0] ? revenueActionFromRow(result.rows[0]) : null;
}

async function inspectExecutionEffects(client, tenantId, action, opportunity) {
  const tasks = await client.query(
    `select * from tge.tasks
     where tenant_id = $1 and revenue_action_id = $2
     order by live_ordinal
     for update`,
    [tenantId, action.id]
  );
  const activities = await client.query(
    `select * from tge.activities
     where tenant_id = $1 and revenue_action_id = $2
     order by live_ordinal
     for update`,
    [tenantId, action.id]
  );
  if (tasks.rows.length > 1 || activities.rows.length > 1) {
    return { conflict: true, reason: "MULTIPLE_LINKED_EFFECTS" };
  }

  const task = tasks.rows[0] ? taskFromRow(tasks.rows[0]) : null;
  const activity = activities.rows[0]
    ? activityFromRow(activities.rows[0])
    : null;
  const hasEffects = Boolean(task || activity);
  if (task && task.opportunity_id !== action.opportunity_id) {
    return { conflict: true, reason: "INVALID_LINKED_TASK" };
  }
  if (activity && activity.opportunity_id !== action.opportunity_id) {
    return { conflict: true, reason: "INVALID_LINKED_ACTIVITY" };
  }
  if (
    action.resulting_task_id &&
    (!task || action.resulting_task_id !== task.id)
  ) {
    return { conflict: true, reason: "INVALID_LINKED_TASK" };
  }
  if (
    action.resulting_activity_id &&
    (!activity || action.resulting_activity_id !== activity.id)
  ) {
    return { conflict: true, reason: "INVALID_LINKED_ACTIVITY" };
  }

  const mode = expectedExecutionMode(action);
  if (action.execution_type === "COMMUNICATION_DRAFT") {
    if (task) return { conflict: true, reason: "UNEXPECTED_LINKED_TASK" };
    if (!activity) {
      return {
        conflict: false,
        complete: false,
        hasEffects: false,
        task: null,
        activity: null
      };
    }
    const validActivity =
      activity.opportunity_id === action.opportunity_id &&
      activity.type === "REVENUE_ACTION_MANUALLY_CONFIRMED" &&
      activity.metadata?.source === "revenue_action" &&
      activity.metadata?.revenue_action_id === action.id &&
      activity.metadata?.action_type === action.action_type &&
      activity.metadata?.execution_effect_type ===
        "COMMUNICATION_MANUAL_CONFIRMATION" &&
      activity.metadata?.execution_mode === mode &&
      activity.metadata?.channel === action.proposed_execution?.channel;
    return validActivity
      ? { conflict: false, complete: true, hasEffects, task: null, activity }
      : { conflict: true, reason: "INVALID_LINKED_ACTIVITY" };
  }

  const validTask = !task || taskMatchesRevenueAction(task, action);
  const validActivity = !activity || (
    activity.opportunity_id === action.opportunity_id &&
    activity.type === "REVENUE_ACTION_TASK_EXECUTED" &&
    activity.metadata?.source === "revenue_action" &&
    activity.metadata?.revenue_action_id === action.id &&
    activity.metadata?.action_type === action.action_type &&
    activity.metadata?.execution_effect_type === "INTERNAL_TASK" &&
    activity.metadata?.execution_mode === mode &&
    Boolean(task) &&
    activity.metadata?.task_id === task.id
  );
  if (!validTask || !validActivity || (activity && !task)) {
    return { conflict: true, reason: "INVALID_LINKED_INTERNAL_EFFECT" };
  }

  const opportunityMutationComplete =
    action.action_type !== "CREATE_TASK" ||
    opportunity.next_action === task?.title;
  return {
    conflict: false,
    complete: Boolean(task && activity && opportunityMutationComplete),
    hasEffects,
    opportunityMutationComplete,
    task,
    activity
  };
}

async function validateRevenueActionBasis(
  client,
  tenantId,
  action,
  opportunity
) {
  const integrity = validateStoredRevenueActionIntegrity(action);
  if (!integrity.valid) return integrity;

  if (["WON", "LOST"].includes(opportunity.stage)) {
    return {
      valid: false,
      conflict: {
        code: "REVENUE_ACTION_OPPORTUNITY_CLOSED",
        message: "The opportunity is closed; this revenue action was superseded.",
        details: {
          id: action.id,
          opportunityId: action.opportunity_id,
          stage: opportunity.stage
        }
      },
      transition: "SUPERSEDED_OPPORTUNITY_CLOSED"
    };
  }

  const prospects = await client.query(
    `select * from tge.prospects
     where tenant_id = $1 and id = $2
     order by case when source_ordinal is null then 1 else 0 end,
       source_ordinal, live_ordinal
     for share`,
    [tenantId, opportunity.prospect_id]
  );
  const tasks = await client.query(
    `select * from tge.tasks
     where tenant_id = $1 and opportunity_id = $2
       and revenue_action_id is distinct from $3
     order by case when source_ordinal is null then 1 else 0 end,
       source_ordinal, live_ordinal
     for share`,
    [tenantId, action.opportunity_id, action.id]
  );
  const activities = await client.query(
    `select * from tge.activities
     where tenant_id = $1 and opportunity_id = $2
       and revenue_action_id is distinct from $3
     order by case when source_ordinal is null then 1 else 0 end,
       source_ordinal, live_ordinal
     for share`,
    [tenantId, action.opportunity_id, action.id]
  );
  const state = {
    opportunity,
    intelligence: buildDealIntelligenceFromData(opportunity, {
      prospects: prospects.rows.map(prospectFromRow),
      tasks: tasks.rows.map(taskFromRow),
      activities: activities.rows.map(activityFromRow)
    })
  };
  const current = calculateRevenueActionBasis(state);
  const recommendation = current.recommendation || {};
  const snapshot = action.recommendation_snapshot || {};
  const recommendationMatches =
    recommendation.type === action.action_type &&
    recommendation.priority === action.priority &&
    recommendation.title === action.title &&
    recommendation.reason === action.reason;
  if (
    current.basisFingerprint === action.basis_fingerprint &&
    recommendationMatches &&
    (snapshot.task_title ?? null) === (recommendation.taskTitle ?? null)
  ) {
    return { valid: true, current };
  }

  return {
    valid: false,
    current,
    conflict: {
      code: "REVENUE_ACTION_STALE",
      message: "The opportunity evidence changed; this action was superseded.",
      details: {
        id: action.id,
        expectedFingerprint: action.basis_fingerprint,
        currentFingerprint: current.basisFingerprint
      }
    },
    transition: "SUPERSEDED_AS_STALE"
  };
}

function validateStoredRevenueActionIntegrity(action) {
  try {
    if (!isPlainRecord(action)) {
      return invalidRevenueActionEvidence(
        action,
        "The stored revenue action is not a valid record."
      );
    }
    if (
      !isPlainRecord(action.evidence) ||
      !isPlainRecord(action.evidence.factual) ||
      !isPlainRecord(action.evidence.derived) ||
      !isPlainRecord(action.recommendation_snapshot) ||
      !Array.isArray(action.audit) ||
      action.audit.some(entry =>
        !isPlainRecord(entry) ||
        typeof entry.transition !== "string" ||
        entry.transition.trim().length === 0 ||
        typeof entry.at !== "string" ||
        Number.isNaN(new Date(entry.at).valueOf())) ||
      typeof action.basis_fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(action.basis_fingerprint)
    ) {
      return invalidRevenueActionEvidence(
        action,
        "The immutable recommendation evidence has an invalid stored shape."
      );
    }

    const semantics = expectedRevenueActionSemantics(action.action_type);
    const expectedProposal = buildProposedExecution(action);
    const proposalRequired = [
      "PREPARED",
      "APPROVED",
      "EXECUTING",
      "EXECUTED",
      "FAILED"
    ].includes(action.status);
    if (
      !semantics ||
      action.execution_type !== semantics.executionType ||
      action.approval_requirement !== semantics.approvalRequirement ||
      action.risk_class !== semantics.riskClass ||
      action.source !== semantics.source ||
      (proposalRequired && (
        !isPlainRecord(action.proposed_execution) ||
        !expectedProposal ||
        fingerprint(action.proposed_execution) !== fingerprint(expectedProposal)
      ))
    ) {
      return invalidRevenueActionEvidence(
        action,
        "The immutable execution semantics do not match the deterministic recommendation."
      );
    }

    const snapshot = action.recommendation_snapshot;
    const suppliedFingerprint = fingerprint(recommendationBasis(
      { opportunity: { id: action.opportunity_id } },
      {
        type: action.action_type,
        priority: action.priority,
        title: action.title,
        reason: action.reason,
        taskTitle: snapshot.task_title
      },
      action.evidence
    ));
    const snapshotMatches =
      snapshot.action_type === action.action_type &&
      snapshot.priority === action.priority &&
      snapshot.title === action.title &&
      snapshot.reason === action.reason &&
      Object.hasOwn(snapshot, "evidence") &&
      fingerprint(snapshot.evidence) === fingerprint(action.evidence);
    if (
      suppliedFingerprint !== action.basis_fingerprint ||
      !snapshotMatches
    ) {
      return invalidRevenueActionEvidence(
        action,
        "The immutable recommendation evidence does not match its fingerprint.",
        { suppliedFingerprint }
      );
    }
    if (!validateRevenueActionLifecycleTruth(action)) {
      return invalidRevenueActionEvidence(
        action,
        "The stored revenue action lifecycle and execution evidence are incoherent."
      );
    }
    return { valid: true };
  } catch {
    return invalidRevenueActionEvidence(
      action,
      "The immutable recommendation evidence has an invalid stored shape."
    );
  }
}

function validateRevenueActionLifecycleTruth(action) {
  const status = action.status;
  const expectedMode = expectedExecutionMode(action);
  const attempts = action.execution_attempts ?? 0;
  if (
    ![
      "RECOMMENDED",
      "PREPARED",
      "APPROVED",
      "EXECUTING",
      "EXECUTED",
      "FAILED",
      "REJECTED",
      "CANCELLED"
    ].includes(status) ||
    !Number.isInteger(attempts) ||
    attempts < 0 ||
    action.audit.length === 0 ||
    action.audit[0].transition !== "CREATED_AS_RECOMMENDED" ||
    action.audit[0].source !== action.source ||
    !timestampsEqual(action.audit[0].at, action.created_at)
  ) {
    return false;
  }

  let auditState = "RECOMMENDED";
  let previousAt = new Date(action.audit[0].at).valueOf();
  const transitions = new Map();
  transitions.set("CREATED_AS_RECOMMENDED", action.audit[0]);
  for (const entry of action.audit.slice(1)) {
    const entryAt = new Date(entry.at).valueOf();
    if (entryAt < previousAt) return false;
    previousAt = entryAt;
    if (entry.transition === "PREPARED" && auditState === "RECOMMENDED") {
      auditState = "PREPARED";
    } else if (entry.transition === "APPROVED" && auditState === "PREPARED") {
      auditState = "APPROVED";
    } else if (
      entry.transition === "EXECUTION_STARTED" &&
      ["APPROVED", "FAILED"].includes(auditState)
    ) {
      auditState = "EXECUTING";
    } else if (entry.transition === "FAILED" && auditState === "EXECUTING") {
      auditState = "FAILED";
    } else if (
      entry.transition === "EXECUTED" &&
      ["EXECUTING", "FAILED"].includes(auditState)
    ) {
      auditState = "EXECUTED";
    } else if (entry.transition === "REJECTED" && auditState === "PREPARED") {
      auditState = "REJECTED";
    } else if (
      [
        "CANCELLED",
        "SUPERSEDED_BY_CURRENT_RECOMMENDATION",
        "SUPERSEDED_AS_STALE",
        "SUPERSEDED_OPPORTUNITY_CLOSED",
        "QUARANTINED_INVALID_EVIDENCE"
      ].includes(entry.transition) &&
      !["EXECUTED", "REJECTED", "CANCELLED"].includes(auditState)
    ) {
      auditState = "CANCELLED";
    } else {
      return false;
    }
    transitions.set(entry.transition, entry);
  }
  if (auditState !== status) return false;

  const prepared = transitions.get("PREPARED");
  const approved = transitions.get("APPROVED");
  const started = [...action.audit].reverse().find(
    entry => entry.transition === "EXECUTION_STARTED"
  );
  const executed = transitions.get("EXECUTED");
  const failed = transitions.get("FAILED");
  const rejected = transitions.get("REJECTED");
  const cancelled = status === "CANCELLED" ? action.audit.at(-1) : null;
  const currentFailure = status === "FAILED" ||
    (status === "CANCELLED" && Boolean(failed));
  if (
    !optionalTimestampMatches(action.prepared_at, prepared?.at) ||
    !optionalTimestampMatches(action.approved_at, approved?.at) ||
    !optionalTimestampMatches(action.executed_at, executed?.at) ||
    !optionalTimestampMatches(
      action.failed_at,
      currentFailure ? failed?.at : undefined
    ) ||
    !optionalTimestampMatches(action.rejected_at, rejected?.at) ||
    !optionalTimestampMatches(action.cancelled_at, cancelled?.at)
  ) {
    return false;
  }

  const noExecution =
    action.execution_request == null &&
    action.execution_result == null &&
    attempts === 0 &&
    action.resulting_task_id == null &&
    action.resulting_activity_id == null;
  if (status === "RECOMMENDED") {
    return action.proposed_execution == null &&
      noExecution &&
      allNull(action, [
        "prepared_at", "approved_at", "executed_at", "rejected_at",
        "cancelled_at", "failed_at", "rejection_reason"
      ]);
  }
  if (status === "PREPARED") {
    return Boolean(prepared) &&
      noExecution &&
      allNull(action, [
        "approved_at", "executed_at", "rejected_at", "cancelled_at",
        "failed_at", "rejection_reason"
      ]);
  }
  if (status === "APPROVED") {
    return Boolean(prepared && approved) &&
      noExecution &&
      allNull(action, [
        "executed_at", "rejected_at", "cancelled_at", "failed_at",
        "rejection_reason"
      ]);
  }
  if (status === "REJECTED") {
    return Boolean(prepared && rejected) &&
      noExecution &&
      allNull(action, ["approved_at", "executed_at", "cancelled_at", "failed_at"]);
  }
  if (status === "CANCELLED") {
    return Boolean(cancelled) &&
      action.executed_at == null &&
      action.rejected_at == null;
  }

  if (
    !prepared ||
    !approved ||
    !started ||
    !isPlainRecord(action.execution_request) ||
    action.execution_request.mode !== expectedMode ||
    !timestampsEqual(action.execution_request.requested_at, started.at) ||
    attempts < 1 ||
    started.attempt !== attempts
  ) {
    return false;
  }
  if (status === "EXECUTING") {
    return action.execution_result == null &&
      allNull(action, [
        "executed_at", "rejected_at", "cancelled_at", "failed_at",
        "resulting_task_id", "resulting_activity_id"
      ]);
  }
  if (
    !isPlainRecord(action.execution_result) ||
    action.execution_result.mode !== expectedMode ||
    action.execution_result.external_send_performed !== false
  ) {
    return false;
  }
  if (status === "FAILED") {
    return Boolean(failed) &&
      action.execution_result.outcome === "FAILED" &&
      allNull(action, ["executed_at", "rejected_at", "cancelled_at"]);
  }

  const internal = action.execution_type === "INTERNAL_TASK";
  return Boolean(executed) &&
    action.execution_result.outcome !== "FAILED" &&
    typeof action.execution_result.outcome === "string" &&
    action.execution_result.outcome.length > 0 &&
    isNonEmptyString(action.resulting_activity_id) &&
    (internal
      ? isNonEmptyString(action.resulting_task_id)
      : action.resulting_task_id == null) &&
    executed.execution_mode === expectedMode &&
    executed.resulting_task_id === (action.resulting_task_id ?? null) &&
    executed.resulting_activity_id === action.resulting_activity_id &&
    allNull(action, ["rejected_at", "cancelled_at", "failed_at"]);
}

function optionalTimestampMatches(value, expected) {
  if (expected === undefined) return value == null;
  return timestampsEqual(value, expected);
}

function timestampsEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftValue = new Date(left).valueOf();
  const rightValue = new Date(right).valueOf();
  return !Number.isNaN(leftValue) &&
    !Number.isNaN(rightValue) &&
    leftValue === rightValue;
}

function allNull(record, fields) {
  return fields.every(field => record[field] == null);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidRevenueActionEvidence(
  action,
  message,
  { current, suppliedFingerprint = null } = {}
) {
  return {
    valid: false,
    current,
    conflict: {
      code: "REVENUE_ACTION_EVIDENCE_INVALID",
      message,
      details: {
        id: typeof action?.id === "string" ? action.id : null,
        expectedFingerprint: typeof action?.basis_fingerprint === "string"
          ? action.basis_fingerprint
          : null,
        suppliedFingerprint
      }
    },
    transition: "SUPERSEDED_AS_STALE"
  };
}

function quarantineInvalidRevenueAction(
  client,
  tenantId,
  action,
  validation,
  at,
  subjectId
) {
  return updateRevenueActionLifecycle(client, tenantId, action.id, {
    status: "CANCELLED",
    cancelled_at: at,
    updated_at: at,
    audit: appendAudit(
      action.audit,
      "QUARANTINED_INVALID_EVIDENCE",
      at,
      {
        conflict: validation.conflict.code,
        ...(subjectId ? { subject_id: subjectId } : {})
      }
    )
  });
}

function cancelSupersededRevenueAction(
  client,
  tenantId,
  action,
  validation,
  at,
  operation,
  subjectId
) {
  return updateRevenueActionLifecycle(client, tenantId, action.id, {
    status: "CANCELLED",
    cancelled_at: at,
    updated_at: at,
    audit: appendAudit(action.audit, validation.transition, at, {
      operation,
      ...(subjectId ? { subject_id: subjectId } : {}),
      ...(validation.transition === "SUPERSEDED_AS_STALE"
        ? {
            expected_fingerprint: action.basis_fingerprint,
            current_fingerprint: validation.current?.basisFingerprint || null
          }
        : { stage: validation.conflict.details.stage })
    })
  });
}

async function persistInternalTask(client, tenantId, action, at) {
  const proposed = buildProposedExecution(action);
  const taskRecord = {
    id: crypto.randomUUID(),
    opportunity_id: action.opportunity_id,
    title: proposed.title,
    description: proposed.description ?? "",
    due_at: proposed.due_at ?? null,
    priority: proposed.priority ?? action.priority ?? "MEDIUM",
    status: "OPEN",
    completed_at: null,
    metadata: {
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      execution_effect_type: "INTERNAL_TASK",
      normalized_title: proposed.normalized_title || normalizeSemanticValue(proposed.title),
      semantic_task_key: proposed.semantic_task_key || [
        action.opportunity_id,
        action.action_type,
        normalizeSemanticValue(proposed.title)
      ].join(":")
    },
    created_at: at,
    updated_at: at
  };

  const equivalent = await client.query(
    `select * from tge.tasks
     where tenant_id = $1 and opportunity_id = $2
       and revenue_action_id is null and status = 'OPEN'
       and metadata->>'source' = 'deal_intelligence'
       and metadata->>'action_type' = $3
       and metadata->>'normalized_title' = $4
       and priority is not distinct from $5
       and due_at is not distinct from $6::timestamptz
     order by case when source_ordinal is null then 1 else 0 end,
       source_ordinal, live_ordinal
     limit 1
     for update`,
    [
      tenantId,
      action.opportunity_id,
      action.action_type,
      taskRecord.metadata.normalized_title,
      taskRecord.priority,
      taskRecord.due_at
    ]
  );
  if (equivalent.rows[0]) {
    const metadata = {
      ...(equivalent.rows[0].metadata || {}),
      ...taskRecord.metadata,
      source: equivalent.rows[0].metadata?.source || "deal_intelligence",
      revenue_action_linked_at: at
    };
    const linked = await client.query(
      `update tge.tasks
       set revenue_action_id = $3,
         metadata = $4::jsonb,
         current_payload = jsonb_set(current_payload, '{metadata}', $4::jsonb, true),
         updated_at = $5
       where tenant_id = $1 and id = $2 and revenue_action_id is null
       returning *`,
      [tenantId, equivalent.rows[0].id, action.id, JSON.stringify(metadata), at]
    );
    if (linked.rows[0]) {
      return { task: taskFromRow(linked.rows[0]), reused: true };
    }
  }

  const inserted = await insertMappedRow(
    client,
    tenantId,
    ENTITY_CONFIGS.tasks,
    taskRecord
  );
  return { task: taskFromRow(inserted), reused: false };
}

async function persistExecutionActivity(
  client,
  tenantId,
  action,
  task,
  taskReused,
  at
) {
  const communication = action.execution_type === "COMMUNICATION_DRAFT";
  const activity = {
    id: crypto.randomUUID(),
    opportunity_id: action.opportunity_id,
    type: communication
      ? "REVENUE_ACTION_MANUALLY_CONFIRMED"
      : "REVENUE_ACTION_TASK_EXECUTED",
    description: communication
      ? "User confirmed the recommended follow-up was completed manually."
      : taskReused
        ? `Revenue action reused internal task: ${task.title}`
        : `Revenue action created internal task: ${task.title}`,
    metadata: {
      source: "revenue_action",
      revenue_action_id: action.id,
      action_type: action.action_type,
      action_key: `revenue-action:${action.id}`,
      execution_mode: communication ? "MANUAL_CONFIRMED" : "SYSTEM_INTERNAL",
      execution_effect_type: communication
        ? "COMMUNICATION_MANUAL_CONFIRMATION"
        : "INTERNAL_TASK",
      ...(communication
        ? { channel: buildProposedExecution(action).channel }
        : { task_id: task.id })
    },
    created_at: at,
    updated_at: at
  };
  const inserted = await insertMappedRow(
    client,
    tenantId,
    ENTITY_CONFIGS.activities,
    activity
  );
  return activityFromRow(inserted);
}

async function finalizeExecution(
  client,
  tenantId,
  action,
  effects,
  result,
  at,
  subjectId
) {
  return updateRevenueActionLifecycle(client, tenantId, action.id, {
    status: "EXECUTED",
    execution_result: result,
    resulting_task_id: effects.task?.id || null,
    resulting_activity_id: effects.activity?.id || null,
    executed_at: at,
    failed_at: null,
    updated_at: at,
    audit: appendAudit(action.audit, "EXECUTED", at, {
      execution_mode: result.mode,
      resulting_task_id: effects.task?.id || null,
      resulting_activity_id: effects.activity?.id || null,
      ...(subjectId ? { subject_id: subjectId } : {})
    })
  });
}

function appendAudit(audit, transition, at, metadata = {}) {
  return [
    ...(audit || []),
    { ...metadata, transition, at }
  ];
}

function normalizeSemanticValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function expectedExecutionMode(action) {
  return action.execution_type === "COMMUNICATION_DRAFT"
    ? "MANUAL_CONFIRMED"
    : "SYSTEM_INTERNAL";
}

function taskMatchesRevenueAction(task, action) {
  const proposal = buildProposedExecution(action);
  if (!proposal || proposal.type !== "INTERNAL_TASK") return false;
  return (
    task.opportunity_id === action.opportunity_id &&
    task.status === "OPEN" &&
    ["revenue_action", "deal_intelligence"].includes(task.metadata?.source) &&
    task.metadata?.revenue_action_id === action.id &&
    task.metadata?.action_type === action.action_type &&
    task.metadata?.execution_effect_type === "INTERNAL_TASK" &&
    task.metadata?.normalized_title === proposal.normalized_title &&
    task.metadata?.semantic_task_key === proposal.semantic_task_key &&
    (task.priority || null) === (proposal.priority || null) &&
    normalizeNullableTimestamp(task.due_at) ===
      normalizeNullableTimestamp(proposal.due_at)
  );
}

function normalizeNullableTimestamp(value) {
  if (value === null || value === undefined) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf())
    ? String(value)
    : timestamp.toISOString();
}

function validateExecutionPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("A RevenueAction execution plan object is required.");
  }
  const allowed = new Set(["executionMode"]);
  if (Object.keys(plan).some(key => !allowed.has(key))) {
    const error = new TypeError(
      "RevenueAction execution effects are derived and cannot be overridden."
    );
    error.code = "REVENUE_ACTION_EXECUTION_OVERRIDE_FORBIDDEN";
    throw error;
  }
}

module.exports = {
  PersistenceConflictError,
  createPostgresRepositories,
  validateStoredRevenueActionIntegrity
};
