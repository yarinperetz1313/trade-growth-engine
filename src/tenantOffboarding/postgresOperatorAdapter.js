"use strict";

const pg = require("pg");

const { PostgresAuthRepository } = require("../auth/postgresAuthRepository");
const { resolveTenantContext } = require("../auth/authorization");
const { createPersistence } = require("../persistence/createPersistence");
const {
  createTenantContext: createPersistenceTenantContext
} = require("../persistence/tenantContext");
const { withTenantTransaction } = require("../persistence/postgres/transaction");
const {
  createTenantOffboardingService
} = require("./tenantOffboardingService");

function createPostgresOffboardingOperatorAdapter({ connectionString } = {}) {
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new TypeError("A dedicated offboarding operator DSN is required.");
  }
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    application_name: "tge-offboarding-operator"
  });
  const membershipRepository = new PostgresAuthRepository({ pool });
  let loginPreflight;
  const assertSafeOperatorLogin = () => {
    loginPreflight ||= validateOperatorLogin(pool);
    return loginPreflight;
  };
  const persistence = createPersistence({ adapter: "postgres", pool });
  const operatorAssurance = Object.freeze({ channel: "OFFBOARDING_OPERATOR" });
  const operatorRequest = Object.freeze({ channel: "OFFBOARDING_OPERATOR" });
  const service = createTenantOffboardingService({
    persistence,
    sensitiveActionPolicy: {
      async assertSatisfied({ assurance }) {
        if (assurance !== operatorAssurance) throw new Error("denied");
      }
    },
    assuranceResolver: async request => request === operatorRequest
      ? operatorAssurance
      : null
  });

  const authority = {
    async resolveActiveOwner(target) {
      await assertSafeOperatorLogin();
      const authorizationContext = await resolveTenantContext({
        identity: { issuer: target.issuer, subject: target.subject },
        membershipRepository
      });
      return {
        tenantId: authorizationContext.tenantId,
        issuer: authorizationContext.issuer,
        subject: authorizationContext.subject,
        role: authorizationContext.role,
        authorizationContext,
        persistenceContext: createPersistenceTenantContext({
          tenantId: authorizationContext.tenantId,
          identityIssuer: authorizationContext.issuer,
          subjectId: authorizationContext.subject
        })
      };
    }
  };

  const requestService = {
    request(input) {
      return service.request({ ...input, request: operatorRequest });
    }
  };

  const receiptRepository = {
    read(target) {
      return assertSafeOperatorLogin().then(() => readReceipt(target));
    }
  };

  function readReceipt(target) {
    const context = createPersistenceTenantContext({
      tenantId: target.tenantId,
      identityIssuer: target.issuer,
      subjectId: target.subject
    });
    return withTenantTransaction(pool, context, async ({ client }) => {
      const result = await client.query(
          `select request.requested_by_subject_hash = encode(sha256(convert_to(
               $2::text || ':' || $3::text, 'UTF8'
             )), 'hex') actor_matches,
             request.state, request.scope, request.retryable,
             request.requested_at, request.completed_at, request.attempt_count,
             request.deletion_evidence,
             (
               select count(*)::integer from tge.prospects
               where tenant_id = $1
             ) + (
               select count(*)::integer from tge.opportunities
               where tenant_id = $1
             ) + (
               select count(*)::integer from tge.tasks where tenant_id = $1
             ) + (
               select count(*)::integer from tge.activities where tenant_id = $1
             ) + (
               select count(*)::integer from tge.revenue_actions
               where tenant_id = $1
             ) + (
               select count(*)::integer from tge.revenue_leak_cases
               where tenant_id = $1
             ) canonical_crm_count,
             (
               select count(*)::integer from tge.import_id_map
               where tenant_id = $1
             ) identity_map_count,
             (
               select count(*)::integer from tge.audit_events
               where tenant_id = $1
             ) audit_evidence_count,
             (
               select count(*)::integer from tge.pilot_evidence_events
               where tenant_id = $1
             ) pilot_evidence_count,
             (
               select count(*)::integer from tge.tenant_memberships
               where tenant_id = $1 and status = 'ACTIVE'
             ) active_membership_count,
             (
               select count(*)::integer from tge.assisted_invitations
               where tenant_id = $1
             ) invitation_count,
             (
               select count(*)::integer from tge.import_staging_records
               where tenant_id = $1 and (
                 raw_payload is not null or conflict_details is not null
                 or metadata is distinct from '{"raw_evidence_deleted":true}'::jsonb
               )
             ) raw_import_rows_remaining,
             (
               select count(*)::integer from tge.import_batches
               where tenant_id = $1 and (
                 source_filename <> '[deleted]' or raw_storage_key is not null
                 or preview_summary ? 'headers'
               )
             ) raw_batches_with_sensitive_metadata
           from tge.tenant_offboarding_requests request
           where request.tenant_id = $1`,
        [target.tenantId, target.issuer, target.subject]
      );
      return mapReceipt(result.rows[0]);
    });
  }

  return Object.freeze({
    authority,
    requestService,
    receiptRepository,
    async close() {
      await pool.end();
    }
  });
}

async function validateOperatorLogin(pool) {
  const result = await pool.query(
    `select session_user login_name, current_user effective_role_name,
       session_user = current_user effective_role_matches,
       roles.rolinherit, roles.rolsuper,
       roles.rolcreatedb, roles.rolcreaterole, roles.rolreplication,
       roles.rolbypassrls,
       pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member') runtime_member,
       pg_catalog.pg_has_role(session_user, 'tge_owner', 'member') owner_member,
       pg_catalog.pg_has_role(session_user, 'tge_migrator', 'member') migrator_member,
       pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member') maintenance_member,
       has_schema_privilege(session_user, 'tge', 'CREATE') schema_create,
       exists (
         select 1
         from pg_catalog.pg_roles granted_roles
         where granted_roles.rolname not in (session_user, 'tge_runtime')
           and pg_catalog.pg_has_role(
             session_user, granted_roles.oid, 'member'
           )
       ) unexpected_role_membership
     from pg_catalog.pg_roles roles
     where roles.rolname = session_user`
  );
  const role = result.rows[0];
  if (
    !role
    || ["tge_runtime", "tge_owner", "tge_migrator", "tge_maintenance"]
      .includes(role.login_name)
    || role.effective_role_matches !== true
    || role.rolinherit !== true
    || role.rolsuper !== false
    || role.rolcreatedb !== false
    || role.rolcreaterole !== false
    || role.rolreplication !== false
    || role.rolbypassrls !== false
    || role.runtime_member !== true
    || role.owner_member !== false
    || role.migrator_member !== false
    || role.maintenance_member !== false
    || role.schema_create !== false
    || role.unexpected_role_membership !== false
  ) {
    const error = new Error("The offboarding operator login is unsafe.");
    error.code = "OFFBOARDING_OPERATOR_CONFIGURATION_INVALID";
    throw error;
  }
}

function mapReceipt(row) {
  if (!row) return null;
  if (row.actor_matches !== true) return { actorMismatch: true };
  const facts = row.deletion_evidence || {};
  return {
    state: row.state,
    scope: row.scope,
    retryable: row.retryable,
    requestedAt: timestamp(row.requested_at),
    ...(row.completed_at ? { completedAt: timestamp(row.completed_at) } : {}),
    attemptCount: row.attempt_count,
    ...(row.deletion_evidence ? {
      deletionEvidence: {
        rawImportBatchesScrubbed: facts.raw_import_batches_scrubbed,
        rawImportRowsScrubbed: facts.raw_import_rows_scrubbed,
        membershipsRevoked: facts.memberships_revoked,
        invitationsDeleted: facts.invitations_deleted,
        canonicalRecordsRetained: facts.canonical_records_retained,
        auditEventsRetained: facts.audit_events_retained,
        pilotEvidenceEventsRetained: facts.pilot_evidence_events_retained,
        externalActionsPerformed: facts.external_actions_performed
      }
    } : {}),
    inventory: {
      canonicalCrmCount: row.canonical_crm_count,
      identityMapCount: row.identity_map_count,
      auditEvidenceCount: row.audit_evidence_count,
      pilotEvidenceCount: row.pilot_evidence_count,
      activeMembershipCount: row.active_membership_count,
      invitationCount: row.invitation_count,
      rawImportRowsRemaining: row.raw_import_rows_remaining,
      rawImportBatchesWithSensitiveMetadata: row.raw_batches_with_sensitive_metadata
    }
  };
}

function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

module.exports = { createPostgresOffboardingOperatorAdapter };
