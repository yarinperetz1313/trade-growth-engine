const crypto = require("node:crypto");

const {
  buildDealIntelligenceFromData
} = require("../intelligence/dealIntelligence");
const {
  buildRevenueIntelligence
} = require("../intelligence/revenueIntelligence");
const {
  buildPipelineMetrics
} = require("../opportunities/opportunityEngine");
const {
  buildPilotEvidenceEvent
} = require("../pilotEvidence/pilotEvidenceDomain");
const {
  classifyOpportunityDataOrigin
} = require("../pilotEvidence/dataOrigin");
const { requireTenantContext } = require("../persistence/tenantContext");

const ERROR_STATUS = Object.freeze({
  OPPORTUNITY_NOT_FOUND: 404,
  REVENUE_ACTION_NOT_FOUND: 404,
  INVALID_REVENUE_ACTION_TRANSITION: 409,
  REVENUE_ACTION_OPPORTUNITY_CLOSED: 409,
  REVENUE_ACTION_STALE: 409,
  REVENUE_ACTION_RECOVERY_REQUIRED: 409,
  REVENUE_ACTION_EFFECT_CONFLICT: 409,
  REVENUE_ACTION_EVIDENCE_INVALID: 409,
  REVENUE_ACTION_EXECUTION_SEMANTICS_INVALID: 409,
  REVENUE_ACTION_MATERIALIZATION_CONFLICT: 409,
  MANUAL_CONFIRMATION_REQUIRED: 400,
  RECOMMENDATION_NOT_EXECUTABLE: 422,
  PROPOSED_EXECUTION_INVALID: 409,
  REVENUE_ACTION_EXECUTION_OVERRIDE_FORBIDDEN: 400,
  REVENUE_ACTION_AUDIT_OVERRIDE_FORBIDDEN: 400,
  REVENUE_ACTION_AUDIT_METADATA_FORBIDDEN: 400,
  REVENUE_ACTION_AUDIT_METADATA_INVALID: 400,
  POSTGRES_TRANSACTION_OUTCOME_UNKNOWN: 500
});

function failure(error, message, statusCode, details = {}) {
  return { ok: false, error, message, statusCode, details };
}

function notFound(entity, id) {
  const opportunity = entity === "OPPORTUNITY";
  return failure(
    `${entity}_NOT_FOUND`,
    opportunity ? "Opportunity was not found." : "Revenue action was not found.",
    404,
    opportunity ? { opportunityId: id } : { id }
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
  if (error?.failedAction) {
    return failure(
      "REVENUE_ACTION_EXECUTION_FAILED",
      "Revenue action execution failed and can be safely retried.",
      500,
      { id: error.failedAction.id }
    );
  }
  const statusCode = ERROR_STATUS[error?.code];
  if (!statusCode) return null;
  return failure(
    error.code,
    error.message || "The RevenueAction operation was rejected.",
    statusCode,
    error.details || {}
  );
}

function createPostgresRevenueActionService({
  persistence,
  createId = crypto.randomUUID,
  clock = () => new Date()
} = {}) {
  if (
    !persistence ||
    persistence.adapter !== "postgres" ||
    typeof persistence.forTenant !== "function"
  ) {
    throw new TypeError(
      "The PostgreSQL RevenueAction service requires injected PostgreSQL persistence."
    );
  }
  if (typeof createId !== "function") {
    throw new TypeError("createId must be a function when provided.");
  }
  if (typeof clock !== "function") {
    throw new TypeError("clock must be a function when provided.");
  }

  return Object.freeze({
    forTenant(context) {
      const trusted = requireTenantContext(context);
      const repositories = persistence.forTenant(trusted);
      return createTenantService(repositories, trusted, { createId, clock });
    }
  });
}

function createTenantService(repositories, context, { createId, clock }) {
  async function buildRefresh(scoped, opportunityId) {
    const prospects = await scoped.prospects.list();
    const opportunities = await scoped.opportunities.list();
    const tasks = await scoped.tasks.list();
    const activities = await scoped.activities.list();
    const generatedAt = new Date(clock()).toISOString();
    const intelligences = opportunities.map(opportunity =>
      buildDealIntelligenceFromData(opportunity, {
        prospects,
        tasks,
        activities,
        generatedAt
      })
    );
    const opportunity = opportunities.find(item => item.id === opportunityId);
    if (!opportunity) return null;
    return {
      opportunity,
      opportunity_intelligence: intelligences.find(
        item => item.opportunity_id === opportunityId
      ),
      pipeline_metrics: buildPipelineMetrics(opportunities),
      revenue_intelligence: buildRevenueIntelligence({
        opportunities,
        intelligences,
        generatedAt
      })
    };
  }

  function success(result, refreshed, extras = {}) {
    return {
      ok: true,
      data: result.record,
      refreshed,
      ...extras
    };
  }

  async function observeActionMilestone(scoped, eventType, action) {
    if (
      typeof scoped.revenueLeakCases?.findByRevenueActionId !== "function"
      || typeof scoped.pilotEvidence?.append !== "function"
    ) return null;
    const linkedCase = await scoped.revenueLeakCases.findByRevenueActionId(
      action.id
    );
    if (!linkedCase || linkedCase.opportunity_id !== action.opportunity_id) {
      return null;
    }
    const opportunity = await scoped.opportunities.findById(
      linkedCase.opportunity_id
    );
    const origin = classifyOpportunityDataOrigin(opportunity);
    if (origin.kind !== "IMPORTED_CUSTOMER") return null;
    const committed = await scoped.imports.findCommit(origin.importBatchId);
    if (
      committed?.outcome !== "COMMITTED"
      || committed?.batch?.status !== "COMMITTED"
      || !committed.rows?.some(row => row.targetId === linkedCase.opportunity_id)
    ) return null;
    const facts = {
      case_id: linkedCase.id,
      import_batch_id: origin.importBatchId,
      revenue_action_id: action.id,
      action_status: eventType === "ACTION_APPROVED" ? "APPROVED" : "EXECUTED",
      ...(eventType === "ACTION_EXECUTED" ? {
        execution_effect_type: action.execution_type === "INTERNAL_TASK"
          ? "INTERNAL_TASK"
          : "COMMUNICATION_MANUAL_CONFIRMATION"
      } : {})
    };
    const occurredAt = eventType === "ACTION_APPROVED"
      ? action.approved_at
      : action.executed_at;
    const digest = crypto.createHash("sha256")
      .update(`${eventType}:${linkedCase.id}:${action.id}`)
      .digest("hex");
    return scoped.pilotEvidence.append(buildPilotEvidenceEvent({
      eventType,
      facts
    }, {
      tenantId: context.tenantId,
      subjectId: context.subjectId,
      occurredAt,
      id: `pilot-action:${digest}`
    }));
  }

  async function transition(id, request) {
    try {
      return await repositories.transaction(async scoped => {
        const result = await scoped.revenueActions.transition(id, request);
        if (!result) return notFound("REVENUE_ACTION", id);
        if (result.conflict) {
          return failure(
            result.conflict.code,
            result.conflict.message,
            ERROR_STATUS[result.conflict.code] || 409,
            result.conflict.details || {}
          );
        }
        if (request.to === "APPROVED" && result.record.status === "APPROVED") {
          await observeActionMilestone(scoped, "ACTION_APPROVED", result.record);
        }
        const refreshed = await buildRefresh(
          scoped,
          result.record.opportunity_id
        );
        return success(result, refreshed, { duplicate: result.duplicate });
      });
    } catch (error) {
      const rejected = knownFailure(error);
      if (rejected) return rejected;
      throw error;
    }
  }

  return Object.freeze({
    async listRevenueActions({ opportunityId } = {}) {
      return repositories.revenueActions.list({ opportunityId });
    },

    async getRevenueAction(id) {
      return (await repositories.revenueActions.findById(id)) ||
        notFound("REVENUE_ACTION", id);
    },

    async materializeRevenueAction(opportunityId) {
      const id = createId();
      try {
        return await repositories.transaction(async scoped => {
          const result = await scoped.revenueActions.materialize({
            id,
            opportunity_id: opportunityId
          });
          if (!result) return notFound("OPPORTUNITY", opportunityId);
          if (result.conflict) {
            return failure(
              result.conflict.code,
              result.conflict.message,
              ERROR_STATUS[result.conflict.code] || 409,
              result.conflict.details || {}
            );
          }
          const refreshed = await buildRefresh(
            scoped,
            result.record.opportunity_id
          );
          return success(result, refreshed, {
            duplicate: result.duplicate,
            created: result.created
          });
        });
      } catch (error) {
        const rejected = knownFailure(error);
        if (rejected) return rejected;
        throw error;
      }
    },

    prepareRevenueAction(id) {
      return transition(id, { to: "PREPARED" });
    },

    approveRevenueAction(id) {
      return transition(id, { to: "APPROVED" });
    },

    rejectRevenueAction(id, reason) {
      return transition(id, { to: "REJECTED", rejectionReason: reason });
    },

    cancelRevenueAction(id) {
      return transition(id, { to: "CANCELLED" });
    },

    async executeRevenueAction(id, body = {}) {
      try {
        return await repositories.transaction(async scoped => {
          const action = await scoped.revenueActions.findById(id);
          if (!action) return notFound("REVENUE_ACTION", id);
          const plan = action.execution_type === "COMMUNICATION_DRAFT" &&
            Object.hasOwn(body, "executionMode")
            ? { executionMode: body.executionMode }
            : {};
          const result = await scoped.revenueActions.executeAtomic(id, plan);
          if (!result) return notFound("REVENUE_ACTION", id);
          if (result.executionError) {
            return knownFailure(Object.assign(result.executionError, {
              failedAction: result.failedAction
            }));
          }
          if (result.conflict) {
            return failure(
              result.conflict.code,
              result.conflict.message,
              ERROR_STATUS[result.conflict.code] || 409,
              result.conflict.details || {}
            );
          }
          if (result.record.status === "EXECUTED") {
            await observeActionMilestone(
              scoped,
              "ACTION_EXECUTED",
              result.record
            );
          }
          const refreshed = await buildRefresh(
            scoped,
            result.record.opportunity_id
          );
          return success(result, refreshed, {
            duplicate: result.duplicate,
            recovered: result.recovered
          });
        });
      } catch (error) {
        const rejected = knownFailure(error);
        if (rejected) return rejected;
        throw error;
      }
    }
  });
}

module.exports = {
  createPostgresRevenueActionService
};
