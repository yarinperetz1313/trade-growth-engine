"use strict";

const crypto = require("node:crypto");

const {
  buildPilotEvidenceEvent
} = require("./pilotEvidenceDomain");
const { requireTenantContext } = require("../persistence/tenantContext");

function createPilotEvidenceService({
  persistence,
  clock = () => new Date(),
  idFactory = () => crypto.randomUUID()
} = {}) {
  if (
    !persistence
    || !["json", "postgres"].includes(persistence.adapter)
    || !persistence.repositories?.pilotEvidence
  ) throw new TypeError("Pilot evidence requires JSON or PostgreSQL persistence.");
  if (typeof clock !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Pilot evidence clock and ID factory must be functions.");
  }

  return Object.freeze({
    forTenant(context) {
      const trusted = requireTenantContext(context);
      const repository = persistence.adapter === "postgres"
        ? persistence.forTenant(trusted).pilotEvidence
        : bindJson(persistence.repositories.pilotEvidence, trusted);
      return createTenantService({
        context: trusted,
        idFactory,
        clock,
        persistence,
        repository
      });
    }
  });
}

function createTenantService({ context, idFactory, clock, persistence, repository }) {
  const now = () => {
    const date = new Date(clock());
    if (Number.isNaN(date.valueOf())) throw new TypeError("Pilot evidence clock is invalid.");
    return date.toISOString();
  };

  async function append(scoped, eventType, facts, occurredAt = now()) {
    const event = buildPilotEvidenceEvent({ eventType, facts }, {
      tenantId: context.tenantId,
      subjectId: context.subjectId,
      occurredAt,
      id: String(idFactory(eventType))
    });
    const result = await scoped.pilotEvidence.append(event);
    return {
      ok: true,
      data: result.record,
      duplicate: Boolean(result.duplicate)
    };
  }

  async function withScoped(operation) {
    if (persistence.adapter === "postgres") {
      return persistence.repositories.transaction(context, operation);
    }
    return operation({
      ...persistence.repositories,
      pilotEvidence: repository
    });
  }

  async function importedCase(scoped, caseId) {
    const record = await scoped.revenueLeakCases.findById(caseId);
    if (!record || !["OPEN", "SNOOZED", "DISMISSED", "SUPERSEDED"].includes(record.state)) {
      return null;
    }
    const opportunity = await scoped.opportunities.findById(record.opportunity_id);
    const provenance = classifyOpportunityDataOrigin(opportunity);
    if (provenance.kind !== "IMPORTED_CUSTOMER") return null;
    if (persistence.adapter === "postgres") {
      const committed = await scoped.imports.findCommit(provenance.importBatchId);
      if (
        committed?.outcome !== "COMMITTED"
        || committed?.batch?.status !== "COMMITTED"
        || !Array.isArray(committed.rows)
        || !committed.rows.some(row => row.targetId === record.opportunity_id)
      ) return null;
    }
    return { record, opportunity, importBatchId: provenance.importBatchId };
  }

  async function recordCase(eventType, caseId, extraFacts = {}) {
    if (!validId(caseId, 255)) return unavailableCase();
    return withScoped(async scoped => {
      const loaded = await importedCase(scoped, caseId);
      if (!loaded) return unavailableCase();
      return append(scoped, eventType, {
        case_id: loaded.record.id,
        import_batch_id: loaded.importBatchId,
        ...extraFacts
      });
    });
  }

  return Object.freeze({
    async getStatus() {
      const events = await repository.list();
      const eventTypes = new Set(events.map(event => event.event_type));
      const latestImport = [...events]
        .filter(event => event.event_type === "IMPORT_COMMITTED")
        .sort((left, right) =>
          right.occurred_at.localeCompare(left.occurred_at)
          || right.id.localeCompare(left.id)
        )[0] || null;
      return {
        milestones: {
          import_committed: eventTypes.has("IMPORT_COMMITTED"),
          portfolio_scan_completed: eventTypes.has("PORTFOLIO_SCAN_COMPLETED"),
          first_credible_case_surfaced: eventTypes.has("FIRST_CREDIBLE_CASE_SURFACED"),
          case_inspected: eventTypes.has("CASE_INSPECTED"),
          revenue_action_materialized_linked: eventTypes.has("REVENUE_ACTION_MATERIALIZED_LINKED"),
          action_approved: eventTypes.has("ACTION_APPROVED"),
          action_executed: eventTypes.has("ACTION_EXECUTED")
        },
        latest_import: latestImport ? structuredClone(latestImport.facts) : null,
        case_feedback: events
          .filter(event => event.event_type === "OPERATOR_FEEDBACK")
          .map(event => ({
            case_id: event.facts.case_id,
            feedback_code: event.facts.feedback_code
          }))
      };
    },

    recordCaseSurfaced(caseId) {
      return recordCase("FIRST_CREDIBLE_CASE_SURFACED", caseId, {
        value_kind: "UNKNOWN",
        currency: null
      });
    },

    recordCaseInspected(caseId) {
      return recordCase("CASE_INSPECTED", caseId);
    },

    recordFeedback(caseId, feedbackCode) {
      return recordCase("OPERATOR_FEEDBACK", caseId, {
        feedback_code: feedbackCode
      });
    }
  });
}

function classifyOpportunityDataOrigin(opportunity) {
  if (opportunity?.metadata?.data_origin === "SAMPLE_DEMO") {
    return Object.freeze({ kind: "SAMPLE_DEMO", importBatchId: null });
  }
  const imported = opportunity?.metadata?.import;
  if (
    validId(imported?.batch_id, 200)
    && validId(imported?.source_system, 128)
    && validId(imported?.source_record_id, 512)
    && /^[0-9a-f]{64}$/.test(imported?.raw_payload_sha256 || "")
  ) {
    return Object.freeze({
      kind: "IMPORTED_CUSTOMER",
      importBatchId: imported.batch_id
    });
  }
  return Object.freeze({ kind: "EXISTING_CUSTOMER", importBatchId: null });
}

function bindJson(repository, context) {
  return Object.freeze(Object.fromEntries(
    Object.entries(repository).map(([name, operation]) => [
      name,
      (...args) => operation(context, ...args)
    ])
  ));
}

function validId(value, maximumBytes) {
  return typeof value === "string"
    && value !== ""
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= maximumBytes;
}

function unavailableCase() {
  return {
    ok: false,
    error: "PILOT_EVIDENCE_CASE_UNAVAILABLE",
    message: "The imported-customer case is unavailable.",
    statusCode: 404
  };
}

module.exports = {
  classifyOpportunityDataOrigin,
  createPilotEvidenceService
};
