"use strict";

const crypto = require("node:crypto");

const {
  RevenueLeakCaseError,
  buildRevenueLeakCaseDetection,
  normalizeTimestamp
} = require("./revenueLeakCaseDomain");
const {
  requireTenantContext
} = require("../persistence/tenantContext");
const {
  LOCAL_REVENUE_LEAK_TENANT_ID
} = require("./jsonRevenueLeakCaseRepository");
const {
  evaluateStalledOpportunity
} = require("./stalledOpportunityDetector");

const ERROR_STATUS = Object.freeze({
  REVENUE_LEAK_CASE_INPUT_INVALID: 400,
  REVENUE_LEAK_CASE_NOT_FOUND: 404,
  REVENUE_LEAK_SOURCE_UNAVAILABLE: 404,
  REVENUE_ACTION_UNAVAILABLE: 404,
  REVENUE_LEAK_CASE_TRANSITION_INVALID: 409,
  REVENUE_LEAK_CASE_ACTION_LINK_CONFLICT: 409,
  REVENUE_LEAK_CASE_INTEGRITY_CONFLICT: 409,
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
  clock = () => new Date()
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
  if (typeof createId !== "function" || typeof clock !== "function") {
    throw new TypeError("RevenueLeakCase ID and clock providers must be functions.");
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
        clock,
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
  { createId, clock, persistence }
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
    const [activities, tasks] = await Promise.all([
      scoped.activities.list({ opportunityId }),
      scoped.tasks.list({ opportunityId })
    ]);
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
