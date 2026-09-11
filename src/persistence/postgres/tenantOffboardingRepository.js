"use strict";

function createPostgresTenantOffboardingRepository(client, tenantId) {
  return {
    async request({ confirmation }) {
      const result = await client.query(
        "select * from tge.request_tenant_offboarding($1::text)",
        [confirmation]
      );
      return mapRequest(result.rows[0]);
    },

    async status() {
      const result = await client.query(
        `select request_id, state, scope, retryable, requested_at,
           completed_at, deletion_evidence
         from tge.tenant_offboarding_requests
         where tenant_id = $1`,
        [tenantId]
      );
      return mapRequest(result.rows[0]);
    }
  };
}

function mapRequest(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    state: row.state,
    scope: row.scope,
    retryable: row.retryable,
    requestedAt: timestamp(row.requested_at),
    ...(row.completed_at ? { completedAt: timestamp(row.completed_at) } : {}),
    ...(row.deletion_evidence
      ? { deletionEvidence: mapEvidence(row.deletion_evidence) }
      : {})
  };
}

function mapEvidence(facts) {
  return {
    rawImportBatchesScrubbed: facts.raw_import_batches_scrubbed,
    rawImportRowsScrubbed: facts.raw_import_rows_scrubbed,
    membershipsRevoked: facts.memberships_revoked,
    invitationsDeleted: facts.invitations_deleted,
    canonicalRecordsRetained: facts.canonical_records_retained,
    auditEventsRetained: facts.audit_events_retained,
    pilotEvidenceEventsRetained: facts.pilot_evidence_events_retained,
    externalActionsPerformed: facts.external_actions_performed
  };
}

function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

module.exports = { createPostgresTenantOffboardingRepository };
