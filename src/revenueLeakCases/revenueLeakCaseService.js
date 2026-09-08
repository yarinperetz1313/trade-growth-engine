"use strict";

const crypto = require("node:crypto");

const {
  RevenueLeakCaseError,
  buildRevenueLeakCaseDetection,
  isCanonicalRevenueLeakSourceId,
  normalizeTimestamp
} = require("./revenueLeakCaseDomain");
const {
  requireTenantContext
} = require("../persistence/tenantContext");
const {
  LOCAL_REVENUE_LEAK_TENANT_ID
} = require("./jsonRevenueLeakCaseRepository");
const {
  OUTCOMES,
  evaluateStalledOpportunity
} = require("./stalledOpportunityDetector");
const {
  OPERATING_QUEUE_LIMIT,
  PORTFOLIO_SCAN_LIMIT,
  buildRevenueLeakOperatingQueue
} = require("./revenueLeakOperatingQueue");
const legacyRevenueActionService = require(
  "../revenueActions/revenueActionService"
);

const REVENUE_ACTION_STATUSES = new Set([
  "RECOMMENDED",
  "PREPARED",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "REJECTED",
  "CANCELLED",
  "FAILED"
]);

const ERROR_STATUS = Object.freeze({
  REVENUE_LEAK_CASE_INPUT_INVALID: 400,
  REVENUE_LEAK_CASE_NOT_FOUND: 404,
  REVENUE_LEAK_SOURCE_UNAVAILABLE: 404,
  REVENUE_ACTION_UNAVAILABLE: 404,
  REVENUE_LEAK_CASE_TRANSITION_INVALID: 409,
  REVENUE_LEAK_CASE_ACTION_LINK_CONFLICT: 409,
  REVENUE_LEAK_CASE_ACTION_INCOMPATIBLE: 409,
  REVENUE_LEAK_CASE_STALE: 409,
  REVENUE_LEAK_CASE_INTEGRITY_CONFLICT: 409,
  REVENUE_LEAK_SCAN_LIMIT_EXCEEDED: 409,
  REVENUE_LEAK_SCAN_SOURCE_INVALID: 409,
  REVENUE_LEAK_QUEUE_LIMIT_EXCEEDED: 409,
  REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT: 409,
  REVENUE_ACTION_NOT_FOUND: 404,
  OPPORTUNITY_NOT_FOUND: 404,
  INVALID_REVENUE_ACTION_TRANSITION: 409,
  REVENUE_ACTION_OPPORTUNITY_CLOSED: 409,
  REVENUE_ACTION_STALE: 409,
  REVENUE_ACTION_RECOVERY_REQUIRED: 409,
  REVENUE_ACTION_EFFECT_CONFLICT: 409,
  REVENUE_ACTION_EVIDENCE_INVALID: 409,
  REVENUE_ACTION_EXECUTION_SEMANTICS_INVALID: 409,
  REVENUE_ACTION_MATERIALIZATION_CONFLICT: 409,
  RECOMMENDATION_NOT_EXECUTABLE: 422,
  POSTGRES_TRANSACTION_OUTCOME_UNKNOWN: 500
});

function failure(error, message, statusCode, details = {}) {
  return { ok: false, error, message, statusCode, details };
}

function caseNotFound() {
  return failure(
    "REVENUE_LEAK_CASE_NOT_FOUND",
    "Revenue leak case was not found.",
    404
  );
}

function sourceUnavailable() {
  return failure(
    "REVENUE_LEAK_SOURCE_UNAVAILABLE",
    "The requested source is unavailable.",
    404
  );
}

function knownFailure(error) {
  if (error?.outcomeUnknown) {
    return failure(
      "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
      error.message,
      500,
      error.details || {}
    );
  }
  const statusCode = ERROR_STATUS[error?.code];
  if (!statusCode) return null;
  return failure(error.code, error.message, statusCode, error.details || {});
}

function createRevenueLeakCaseService({
  persistence,
  createId = crypto.randomUUID,
  createRevenueActionId = crypto.randomUUID,
  clock = () => new Date(),
  handoffCheckpoint = async () => {},
  revenueActionAuthority = persistence?.adapter === "json"
    ? legacyRevenueActionService
    : null
} = {}) {
  if (
    !persistence
    || !["json", "postgres"].includes(persistence.adapter)
    || !persistence.repositories?.revenueLeakCases
  ) {
    throw new TypeError(
      "The RevenueLeakCase service requires an injected JSON or PostgreSQL repository."
    );
  }
  if (
    typeof createId !== "function"
    || typeof createRevenueActionId !== "function"
    || typeof clock !== "function"
    || typeof handoffCheckpoint !== "function"
  ) {
    throw new TypeError(
      "RevenueLeakCase ID, RevenueAction ID, clock, and handoff checkpoint providers must be functions."
    );
  }
  if (
    persistence.adapter === "json"
    && (
      typeof revenueActionAuthority?.materializeRevenueAction !== "function"
      || typeof revenueActionAuthority?.getRevenueAction !== "function"
    )
  ) {
    throw new TypeError(
      "JSON RevenueLeakCase handoff requires the existing RevenueAction authority."
    );
  }

  return Object.freeze({
    forTenant(context) {
      const trusted = requireTenantContext(context);
      const repository = persistence.adapter === "postgres"
        ? persistence.forTenant(trusted).revenueLeakCases
        : bindJsonRepository(persistence.repositories.revenueLeakCases, trusted);
      if (!repository) {
        throw new TypeError("RevenueLeakCase persistence is unavailable.");
      }
      return createTenantService(repository, trusted, {
        createId,
        createRevenueActionId,
        clock,
        handoffCheckpoint,
        revenueActionAuthority,
        persistence
      });
    }
  });
}

function bindJsonRepository(repository, context) {
  return Object.freeze(Object.fromEntries(
    Object.entries(repository).map(([name, operation]) => [
      name,
      (...args) => operation(context, ...args)
    ])
  ));
}

function createTenantService(
  repository,
  context,
  {
    createId,
    createRevenueActionId,
    clock,
    handoffCheckpoint,
    revenueActionAuthority,
    persistence
  }
) {
  const now = () => normalizeTimestamp(clock(), "server clock");

  async function run(operation) {
    try {
      return await operation();
    } catch (error) {
      const rejected = knownFailure(error);
      if (rejected) return rejected;
      throw error;
    }
  }

  async function transition(id, to, body = {}) {
    return run(async () => {
      const result = await repository.transition(id, {
        to,
        reason: body.reason,
        wake_at: body.wake_at,
        at: now()
      });
      if (!result) return caseNotFound();
      return {
        ok: true,
        data: result.record,
        duplicate: Boolean(result.duplicate)
      };
    });
  }

  async function detectWithRepositories(
    scoped,
    opportunityId,
    evaluatedAt,
    { lockSource = false } = {}
  ) {
    const opportunity = await scoped.opportunities.findById(
      opportunityId,
      lockSource ? { lock: true } : undefined
    );
    if (!opportunity) return sourceUnavailable();
    // PostgreSQL transaction repositories share one checked-out client, so keep
    // these reads ordered instead of issuing concurrent queries on that client.
    const activities = await scoped.activities.list({ opportunityId });
    const tasks = await scoped.tasks.list({ opportunityId });
    const evaluation = evaluateStalledOpportunity({
      opportunity,
      activities,
      tasks,
      evaluatedAt
    });
    const response = {
      ok: true,
      outcome: evaluation.outcome,
      reason_code: evaluation.reason_code,
      detector: evaluation.detector,
      source: evaluation.source,
      evidence: evaluation.evidence,
      commercial_value: evaluation.commercial_value,
      case: null,
      reconciliation: null
    };
    if (!evaluation.detection) return response;

    const detection = buildRevenueLeakCaseDetection(evaluation.detection, {
      id: createId(),
      detectedAt: evaluatedAt,
      subjectId: context.subjectId
    });
    const reconciled = await scoped.revenueLeakCases.reconcile(detection);
    return {
      ...response,
      case: reconciled.record,
      reconciliation: {
        created: Boolean(reconciled.created),
        duplicate: Boolean(reconciled.duplicate),
        ...(reconciled.terminal ? { terminal: true } : {}),
        superseded_case_id: reconciled.superseded_case_id || null
      }
    };
  }

  function scanFailure(code, message, totalOpportunities, extras = {}) {
    return failure(code, message, 409, {
      complete: false,
      limit: PORTFOLIO_SCAN_LIMIT,
      total_opportunities: totalOpportunities,
      evaluated_count: 0,
      unevaluated_count: totalOpportunities,
      overflow_count: Math.max(0, totalOpportunities - PORTFOLIO_SCAN_LIMIT),
      invalid_record_count: 0,
      excluded_count: 0,
      ...extras
    });
  }

  async function scanWithRepositories(scoped, evaluatedAt) {
    const candidates = await scoped.opportunities.listForStalledScan({
      limit: PORTFOLIO_SCAN_LIMIT
    });
    const total = candidates?.totalCount;
    const records = candidates?.records;
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(records)) {
      const observedCount = Array.isArray(records) ? records.length : 0;
      const reportedTotal = Number.isSafeInteger(total) && total >= 0
        ? total
        : observedCount;
      return scanFailure(
        "REVENUE_LEAK_SCAN_SOURCE_INVALID",
        "Canonical opportunity enumeration is invalid.",
        reportedTotal,
        { invalid_record_count: Math.max(reportedTotal, observedCount) }
      );
    }
    if (total > PORTFOLIO_SCAN_LIMIT) {
      return scanFailure(
        "REVENUE_LEAK_SCAN_LIMIT_EXCEEDED",
        "The tenant opportunity portfolio exceeds the safe scan limit.",
        total
      );
    }
    if (records.length !== total) {
      return scanFailure(
        "REVENUE_LEAK_SCAN_SOURCE_INVALID",
        "Canonical opportunity enumeration is incomplete.",
        total,
        { invalid_record_count: total }
      );
    }

    const ids = records.map(record =>
      isCanonicalRevenueLeakSourceId(record?.id) ? record.id : null
    );
    const frequencies = new Map();
    for (const id of ids) {
      if (id !== null) frequencies.set(id, (frequencies.get(id) || 0) + 1);
    }
    const invalidCount = ids.filter(id =>
      id === null || frequencies.get(id) !== 1
    ).length;
    if (invalidCount > 0) {
      return scanFailure(
        "REVENUE_LEAK_SCAN_SOURCE_INVALID",
        "Canonical opportunity identities are invalid or duplicated.",
        total,
        { invalid_record_count: invalidCount }
      );
    }

    const ordered = [...records].sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    const evaluations = [];
    const detections = [];
    for (const opportunity of ordered) {
      const activities = await scoped.activities.list({
        opportunityId: opportunity.id
      });
      const tasks = await scoped.tasks.list({ opportunityId: opportunity.id });
      const evaluation = evaluateStalledOpportunity({
        opportunity,
        activities,
        tasks,
        evaluatedAt
      });
      const item = {
        opportunity_id: opportunity.id,
        outcome: evaluation.outcome,
        reason_code: evaluation.reason_code,
        disposition: "READ_ONLY",
        case_id: null,
        superseded_case_id: null
      };
      evaluations.push({ item, evaluation });
      if (evaluation.detection) {
        detections.push(buildRevenueLeakCaseDetection(evaluation.detection, {
          id: createId(),
          detectedAt: evaluatedAt,
          subjectId: context.subjectId
        }));
      }
    }

    const reconciliations = await scoped.revenueLeakCases.reconcileBatch(
      detections
    );
    let reconciliationIndex = 0;
    for (const result of evaluations) {
      if (!result.evaluation.detection) continue;
      const reconciliation = reconciliations[reconciliationIndex++];
      result.item.case_id = reconciliation.record.id;
      result.item.superseded_case_id = reconciliation.superseded_case_id || null;
      result.item.disposition = reconciliation.duplicate
        ? "REPLAYED"
        : reconciliation.superseded_case_id
          ? "SUPERSEDED"
          : "CREATED";
    }
    const results = evaluations.map(result => result.item);
    return {
      ok: true,
      evaluated_at: evaluatedAt,
      detector: { id: "stalled-opportunity", version: "1" },
      scope: "TENANT_VISIBLE_CANONICAL_OPPORTUNITIES",
      summary: summarizeScan(results, total),
      results
    };
  }

  function summarizeScan(results, total) {
    const outcomes = Object.fromEntries(Object.values(OUTCOMES).map(name => [
      name,
      { count: 0, reasons: {} }
    ]));
    const reconciliation = {
      detected_count: 0,
      created_count: 0,
      replayed_count: 0,
      superseded_count: 0
    };
    for (const result of results) {
      const summary = outcomes[result.outcome];
      summary.count += 1;
      summary.reasons[result.reason_code] =
        (summary.reasons[result.reason_code] || 0) + 1;
      if (result.outcome === OUTCOMES.LEAK) {
        reconciliation.detected_count += 1;
        if (result.disposition === "CREATED") reconciliation.created_count += 1;
        if (result.disposition === "REPLAYED") reconciliation.replayed_count += 1;
        if (result.disposition === "SUPERSEDED") {
          reconciliation.superseded_count += 1;
        }
      }
    }
    return {
      complete: true,
      limit: PORTFOLIO_SCAN_LIMIT,
      total_opportunities: total,
      evaluated_count: results.length,
      unevaluated_count: 0,
      overflow_count: 0,
      invalid_record_count: 0,
      excluded_count: 0,
      reconciliation,
      outcomes
    };
  }

  async function queueWithRepository(scoped, generatedAt) {
    const loaded = await scoped.revenueLeakCases.listOperatingQueueContexts({
      limit: OPERATING_QUEUE_LIMIT
    });
    return buildRevenueLeakOperatingQueue({
      contexts: loaded.contexts,
      totalCount: loaded.totalCount,
      generatedAt
    });
  }

  function staleCase(caseId, details = {}) {
    return failure(
      "REVENUE_LEAK_CASE_STALE",
      "The revenue leak case no longer matches current canonical evidence.",
      409,
      { case_id: caseId, ...details }
    );
  }

  function incompatibleAction(caseId, actionType = null) {
    return new RevenueLeakCaseError(
      "REVENUE_LEAK_CASE_ACTION_INCOMPATIBLE",
      "The current RevenueAction is not compatible with this revenue leak case.",
      { case_id: caseId, action_type: actionType }
    );
  }

  function expectedHandoffActionType(record, evaluation) {
    if (
      record.leak_type === "STALLED_OPPORTUNITY"
      && record.recommended_action_type === "FOLLOW_UP"
      && evaluation.reason_code === "STALE_WITHOUT_NEXT_ACTION"
      && evaluation.evidence?.next_action?.present === false
    ) {
      return "CREATE_TASK";
    }
    return record.recommended_action_type;
  }

  function compatibleHandoffActionType(record) {
    return record.leak_type === "STALLED_OPPORTUNITY"
      && record.recommended_action_type === "FOLLOW_UP"
      ? "CREATE_TASK"
      : record.recommended_action_type;
  }

  function validateLinkedAction(record, action) {
    if (
      !action
      || action.ok === false
      || action.id !== record.revenue_action_id
      || action.opportunity_id !== record.opportunity_id
      || action.action_type !== compatibleHandoffActionType(record)
      || action.basis_fingerprint !== record.revenue_action_fingerprint
      || !REVENUE_ACTION_STATUSES.has(action.status)
    ) {
      throw new RevenueLeakCaseError(
        "REVENUE_ACTION_UNAVAILABLE",
        "The requested RevenueAction is unavailable."
      );
    }
    return action;
  }

  async function loadExistingLinkedAction(scoped, record) {
    const action = persistence.adapter === "postgres"
      ? await scoped.revenueActions.findById(record.revenue_action_id)
      : await revenueActionAuthority.getRevenueAction(record.revenue_action_id);
    return validateLinkedAction(record, action);
  }

  async function validateCurrentCase(scoped, record, evaluatedAt) {
    const opportunity = await scoped.opportunities.findById(
      record.opportunity_id,
      persistence.adapter === "postgres" ? { lock: true } : undefined
    );
    if (!opportunity) return { failure: sourceUnavailable() };
    const activities = await scoped.activities.list({
      opportunityId: record.opportunity_id
    });
    const tasks = await scoped.tasks.list({ opportunityId: record.opportunity_id });
    const evaluation = evaluateStalledOpportunity({
      opportunity,
      activities,
      tasks,
      evaluatedAt
    });
    if (!evaluation.detection) {
      return {
        failure: staleCase(record.id, {
          current_outcome: evaluation.outcome,
          current_reason_code: evaluation.reason_code
        })
      };
    }
    const current = buildRevenueLeakCaseDetection(evaluation.detection, {
      id: createId(),
      detectedAt: evaluatedAt,
      subjectId: context.subjectId
    });
    if (current.semantic_key !== record.semantic_key) {
      return {
        failure: staleCase(record.id, {
          current_outcome: evaluation.outcome,
          current_reason_code: evaluation.reason_code
        })
      };
    }
    return {
      evaluation,
      expectedActionType: expectedHandoffActionType(record, evaluation)
    };
  }

  async function materializeWithAuthority(scoped, opportunityId) {
    if (persistence.adapter === "postgres") {
      const result = await scoped.revenueActions.materialize({
        id: createRevenueActionId(),
        opportunity_id: opportunityId
      });
      if (!result) return sourceUnavailable();
      if (result.conflict) {
        return failure(
          result.conflict.code,
          result.conflict.message,
          ERROR_STATUS[result.conflict.code] || 409,
          result.conflict.details || {}
        );
      }
      return {
        ok: true,
        data: result.record,
        created: Boolean(result.created),
        duplicate: Boolean(result.duplicate)
      };
    }
    return revenueActionAuthority.materializeRevenueAction(opportunityId);
  }

  async function handoffWithRepositories(scoped, id, evaluatedAt) {
    const record = await scoped.revenueLeakCases.findById(
      id,
      persistence.adapter === "postgres" ? { lock: true } : undefined
    );
    if (!record) return caseNotFound();
    if (!["OPEN", "SNOOZED"].includes(record.state)) {
      return failure(
        "REVENUE_LEAK_CASE_TRANSITION_INVALID",
        "Terminal revenue leak cases cannot create new RevenueActions.",
        409,
        { from: record.state }
      );
    }
    if (record.revenue_action_id) {
      const action = await loadExistingLinkedAction(scoped, record);
      return {
        ok: true,
        data: { case: record, revenue_action: action },
        handoff: {
          action_created: false,
          action_reused: true,
          link_created: false,
          reconciled: true
        }
      };
    }

    const validation = await validateCurrentCase(scoped, record, evaluatedAt);
    if (validation.failure) return validation.failure;
    const materialized = await materializeWithAuthority(
      scoped,
      record.opportunity_id
    );
    if (materialized?.ok === false) return materialized;
    const action = materialized?.data;
    if (
      !action
      || action.opportunity_id !== record.opportunity_id
      || action.action_type !== validation.expectedActionType
      || !REVENUE_ACTION_STATUSES.has(action.status)
      || typeof action.basis_fingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(action.basis_fingerprint)
    ) {
      throw incompatibleAction(record.id, action?.action_type || null);
    }

    await handoffCheckpoint("afterRevenueActionMaterialized", {
      adapter: persistence.adapter,
      caseId: record.id,
      revenueActionId: action.id
    });
    const linked = await scoped.revenueLeakCases.linkRevenueAction(record.id, {
      revenue_action_id: action.id,
      at: evaluatedAt
    });
    if (!linked) return caseNotFound();
    return {
      ok: true,
      data: { case: linked.record, revenue_action: action },
      handoff: {
        action_created: Boolean(materialized.created),
        action_reused: !materialized.created,
        link_created: !linked.duplicate,
        reconciled: Boolean(materialized.duplicate || linked.duplicate)
      }
    };
  }

  return Object.freeze({
    listRevenueLeakCases(filters = {}) {
      return repository.list(filters);
    },

    async getRevenueLeakCase(id) {
      const record = await repository.findById(id);
      return record || caseNotFound();
    },

    reconcileRevenueLeakCase(input) {
      return run(async () => {
        const record = buildRevenueLeakCaseDetection(input, {
          id: createId(),
          detectedAt: now(),
          subjectId: context.subjectId
        });
        const result = await repository.reconcile(record);
        return {
          ok: true,
          data: result.record,
          created: Boolean(result.created),
          duplicate: Boolean(result.duplicate),
          ...(result.terminal ? { terminal: true } : {}),
          superseded_case_id: result.superseded_case_id || null
        };
      });
    },

    detectStalledOpportunity(opportunityId) {
      return run(async () => {
        if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
          return sourceUnavailable();
        }
        const evaluatedAt = now();
        if (persistence.adapter === "postgres") {
          return persistence.repositories.transaction(
            context,
            scoped => detectWithRepositories(
              scoped,
              opportunityId.trim(),
              evaluatedAt,
              { lockSource: true }
            )
          );
        }
        if (context.tenantId !== LOCAL_REVENUE_LEAK_TENANT_ID) {
          return sourceUnavailable();
        }
        const scoped = {
          opportunities: persistence.repositories.opportunities,
          activities: persistence.repositories.activities,
          tasks: persistence.repositories.tasks,
          revenueLeakCases: repository
        };
        return detectWithRepositories(scoped, opportunityId.trim(), evaluatedAt);
      });
    },

    scanStalledOpportunities() {
      return run(async () => {
        const evaluatedAt = now();
        if (persistence.adapter === "postgres") {
          return persistence.repositories.transaction(
            context,
            scoped => scanWithRepositories(scoped, evaluatedAt)
          );
        }
        if (context.tenantId !== LOCAL_REVENUE_LEAK_TENANT_ID) {
          return sourceUnavailable();
        }
        const scoped = {
          opportunities: persistence.repositories.opportunities,
          activities: persistence.repositories.activities,
          tasks: persistence.repositories.tasks,
          revenueLeakCases: repository
        };
        return scanWithRepositories(scoped, evaluatedAt);
      });
    },

    getRevenueLeakOperatingQueue() {
      return run(async () => {
        const generatedAt = now();
        const data = persistence.adapter === "postgres"
          ? await persistence.repositories.transaction(
            context,
            scoped => queueWithRepository(scoped, generatedAt)
          )
          : await queueWithRepository(
            { revenueLeakCases: repository },
            generatedAt
          );
        return { ok: true, data };
      });
    },

    createRevenueActionForCase(id) {
      return run(async () => {
        if (
          typeof id !== "string"
          || id === ""
          || id !== id.trim()
          || Buffer.byteLength(id) > 255
        ) return caseNotFound();
        const evaluatedAt = now();
        if (persistence.adapter === "postgres") {
          return persistence.repositories.transaction(
            context,
            scoped => handoffWithRepositories(scoped, id, evaluatedAt)
          );
        }
        if (context.tenantId !== LOCAL_REVENUE_LEAK_TENANT_ID) {
          return caseNotFound();
        }
        return handoffWithRepositories({
          opportunities: persistence.repositories.opportunities,
          activities: persistence.repositories.activities,
          tasks: persistence.repositories.tasks,
          revenueLeakCases: repository
        }, id, evaluatedAt);
      });
    },

    snoozeRevenueLeakCase(id, body) {
      return transition(id, "SNOOZED", body);
    },

    resumeRevenueLeakCase(id, body) {
      return transition(id, "OPEN", body);
    },

    dismissRevenueLeakCase(id, body) {
      return transition(id, "DISMISSED", body);
    },

    linkRevenueAction(id, body = {}) {
      return run(async () => {
        const result = await repository.linkRevenueAction(id, {
          revenue_action_id: body.revenue_action_id,
          at: now()
        });
        if (!result) return caseNotFound();
        return {
          ok: true,
          data: result.record,
          duplicate: Boolean(result.duplicate)
        };
      });
    }
  });
}

module.exports = {
  ERROR_STATUS,
  createRevenueLeakCaseService
};
