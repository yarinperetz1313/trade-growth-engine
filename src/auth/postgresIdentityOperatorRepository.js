"use strict";

const { IdentityOperationError } = require("./identityOperations");

function deny() {
  throw new IdentityOperationError();
}

function terminalTenant(row) {
  return row?.terminal === true
    || row?.metadata?.offboarding_state === "OFFBOARDED_ACCESS_REVOKED";
}

function sameInstant(first, second) {
  return new Date(first).getTime() === new Date(second).getTime();
}

class PostgresIdentityOperatorRepository {
  constructor({ pool }) {
    if (!pool?.connect) {
      throw new TypeError("PostgreSQL identity operator repository requires a pool.");
    }
    this.pool = pool;
  }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query("begin isolation level serializable");
      await this.assertOperator(client);
      await client.query("select pg_advisory_xact_lock(776151118211901::bigint)");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the privacy-minimized operation failure.
      }
      if (error instanceof IdentityOperationError) throw error;
      deny();
    } finally {
      client.release();
    }
  }

  async assertOperator(client) {
    const result = await client.query(
      `select (rolsuper or rolbypassrls) as authorized
       from pg_catalog.pg_roles where rolname = current_user`
    );
    if (result.rows[0]?.authorized !== true) deny();
  }

  async bootstrapFirstTenant(input) {
    return this.transaction(async client => {
      const tenants = await client.query(
        `select id, slug, name, metadata,
           metadata->>'offboarding_state' = 'OFFBOARDED_ACCESS_REVOKED' as terminal
         from tge.tenants order by id for update`
      );
      const memberships = await client.query(
        `select tenant_id, identity_issuer, subject_id, role, status
         from tge.tenant_memberships
         order by tenant_id, identity_issuer, subject_id for update`
      );

      if (tenants.rows.length === 0 && memberships.rows.length === 0) {
        if (!input.apply) {
          return { status: "WOULD_APPLY", tenantId: input.tenantId };
        }
        await client.query(
          `insert into tge.tenants (id, slug, name, metadata)
           values ($1, $2, $3, '{}'::jsonb)`,
          [input.tenantId, input.slug, input.name]
        );
        await client.query(
          `insert into tge.tenant_memberships (
             tenant_id, identity_issuer, subject_id, role, status
           ) values ($1, $2, $3, $4, 'ACTIVE')`,
          [input.tenantId, input.issuer, input.subject, "OWNER"]
        );
        await insertAudit(client, {
          tenantId: input.tenantId,
          id: input.auditId,
          eventType: "IDENTITY_BOOTSTRAPPED",
          subject: "urn:tge:operator:identity-bootstrap",
          entityType: "TENANT_MEMBERSHIP",
          entityId: input.tenantId,
          payload: input.auditPayload
        });
        return { status: "APPLIED", tenantId: input.tenantId };
      }

      if (tenants.rows.length !== 1 || memberships.rows.length !== 1) deny();
      const tenant = tenants.rows[0];
      const membership = memberships.rows[0];
      if (
        terminalTenant(tenant)
        || tenant.id !== input.tenantId
        || tenant.slug !== input.slug
        || tenant.name !== input.name
        || membership.tenant_id !== input.tenantId
        || membership.identity_issuer !== input.issuer
        || membership.subject_id !== input.subject
        || membership.role !== "OWNER"
        || membership.status !== "ACTIVE"
      ) deny();
      return { status: "ALREADY_APPLIED", tenantId: input.tenantId };
    });
  }

  async revokeMembership(input) {
    return this.transaction(async client => {
      const tenantResult = await client.query(
        `select id, metadata,
           metadata->>'offboarding_state' = 'OFFBOARDED_ACCESS_REVOKED' as terminal
         from tge.tenants where id = $1 for update`,
        [input.tenantId]
      );
      const tenant = tenantResult.rows[0];
      if (!tenant || terminalTenant(tenant)) deny();

      const membershipResult = await client.query(
        `select tenant_id, identity_issuer, subject_id, role, status
         from tge.tenant_memberships
         where (identity_issuer = $1 and subject_id = $2)
            or (identity_issuer = $3 and subject_id = $4)
         order by tenant_id, identity_issuer, subject_id for update`,
        [
          input.actor.issuer,
          input.actor.subject,
          input.target.issuer,
          input.target.subject
        ]
      );
      const actorRows = membershipResult.rows.filter(row =>
        row.identity_issuer === input.actor.issuer
        && row.subject_id === input.actor.subject
      );
      const targetRows = membershipResult.rows.filter(row =>
        row.identity_issuer === input.target.issuer
        && row.subject_id === input.target.subject
      );
      const actor = actorRows.find(row => row.tenant_id === input.tenantId);
      const target = targetRows.find(row => row.tenant_id === input.tenantId);
      if (
        actorRows.length !== 1
        || targetRows.length !== 1
        || !actor
        || actor.role !== "OWNER"
        || actor.status !== "ACTIVE"
        || !target
      ) deny();
      if (target.status === "REVOKED") {
        return { status: "ALREADY_REVOKED", tenantId: input.tenantId };
      }
      if (target.status !== "ACTIVE") deny();

      if (target.role === "OWNER") {
        const owners = await client.query(
          `select count(*)::integer as owner_count
           from tge.tenant_memberships
           where tenant_id = $1 and role = 'OWNER' and status = 'ACTIVE'`,
          [input.tenantId]
        );
        if (owners.rows[0]?.owner_count <= 1) deny();
      }
      if (!input.apply) {
        return { status: "WOULD_REVOKE", tenantId: input.tenantId };
      }
      const changed = await client.query(
        `update tge.tenant_memberships
         set status = 'REVOKED', updated_at = clock_timestamp()
         where tenant_id = $1 and identity_issuer = $2 and subject_id = $3
           and status = 'ACTIVE'
         returning tenant_id`,
        [input.tenantId, input.target.issuer, input.target.subject]
      );
      if (changed.rows.length !== 1) deny();
      await insertAudit(client, {
        tenantId: input.tenantId,
        id: input.auditId,
        eventType: "MEMBERSHIP_REVOKED",
        subject: input.actor.subject,
        entityType: "TENANT_MEMBERSHIP",
        entityId: input.auditPayload.target_fingerprint || input.auditId,
        payload: input.auditPayload
      });
      return { status: "REVOKED", tenantId: input.tenantId };
    });
  }

  async createProvisionedInvitation(input) {
    return this.transaction(async client => {
      const tenantResult = await client.query(
        `select id, metadata,
           metadata->>'offboarding_state' = 'OFFBOARDED_ACCESS_REVOKED' as terminal
         from tge.tenants where id = $1 for update`,
        [input.tenantId]
      );
      if (!tenantResult.rows[0] || terminalTenant(tenantResult.rows[0])) deny();

      const membershipResult = await client.query(
        `select tenant_id, identity_issuer, subject_id, role, status
         from tge.tenant_memberships
         where (identity_issuer = $1 and subject_id = $2)
            or (identity_issuer = $3 and subject_id = $4)
         order by tenant_id, identity_issuer, subject_id for update`,
        [
          input.actor.issuer,
          input.actor.subject,
          input.expectedIssuer,
          input.expectedSubject
        ]
      );
      const actorRows = membershipResult.rows.filter(row =>
        row.identity_issuer === input.actor.issuer
        && row.subject_id === input.actor.subject
      );
      const expectedRows = membershipResult.rows.filter(row =>
        row.identity_issuer === input.expectedIssuer
        && row.subject_id === input.expectedSubject
      );
      if (
        actorRows.length !== 1
        || actorRows[0].tenant_id !== input.tenantId
        || actorRows[0].role !== "OWNER"
        || actorRows[0].status !== "ACTIVE"
        || expectedRows.length !== 0
      ) deny();

      const existing = await client.query(
        `select tenant_id, id, token_hash, normalized_email, intended_role,
           status, expected_identity_issuer, expected_subject_id,
           created_by_subject_id, expires_at
         from tge.assisted_invitations
         where id = $1
            or (
              expected_identity_issuer = $2
              and expected_subject_id = $3
              and status = 'PENDING'
            )
         order by tenant_id, id for update`,
        [input.operationId, input.expectedIssuer, input.expectedSubject]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (
          existing.rows.length !== 1
          || row.tenant_id !== input.tenantId
          || row.id !== input.operationId
          || row.normalized_email !== input.normalizedEmail
          || row.intended_role !== input.role
          || row.status !== "PENDING"
          || row.expected_identity_issuer !== input.expectedIssuer
          || row.expected_subject_id !== input.expectedSubject
          || row.created_by_subject_id !== input.actor.subject
          || !sameInstant(row.expires_at, input.expiresAt)
        ) deny();
        return { status: "RECONCILED", invitationId: input.operationId };
      }

      await client.query(
        `insert into tge.assisted_invitations (
           tenant_id, id, token_hash, normalized_email, intended_role,
           created_by_subject_id, expires_at, expected_identity_issuer,
           expected_subject_id, status, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10, $10)`,
        [
          input.tenantId,
          input.operationId,
          input.tokenHash,
          input.normalizedEmail,
          input.role,
          input.actor.subject,
          input.expiresAt,
          input.expectedIssuer,
          input.expectedSubject,
          input.createdAt
        ]
      );
      await insertAudit(client, {
        tenantId: input.tenantId,
        id: input.auditId,
        eventType: "PROVISIONED_INVITATION_CREATED",
        subject: input.actor.subject,
        entityType: "ASSISTED_INVITATION",
        entityId: input.operationId,
        payload: input.auditPayload
      });
      return { status: "CREATED", invitationId: input.operationId };
    });
  }

  async revokeInvitation(input) {
    return this.transaction(async client => {
      const tenantResult = await client.query(
        `select id, metadata,
           metadata->>'offboarding_state' = 'OFFBOARDED_ACCESS_REVOKED' as terminal
         from tge.tenants where id = $1 for update`,
        [input.tenantId]
      );
      if (!tenantResult.rows[0] || terminalTenant(tenantResult.rows[0])) deny();

      const actorResult = await client.query(
        `select tenant_id, identity_issuer, subject_id, role, status
         from tge.tenant_memberships
         where identity_issuer = $1 and subject_id = $2
         order by tenant_id for update`,
        [input.actor.issuer, input.actor.subject]
      );
      if (
        actorResult.rows.length !== 1
        || actorResult.rows[0].tenant_id !== input.tenantId
        || actorResult.rows[0].role !== "OWNER"
        || actorResult.rows[0].status !== "ACTIVE"
      ) deny();

      const invitationResult = await client.query(
        `select tenant_id, id, status
         from tge.assisted_invitations where id = $1 for update`,
        [input.invitationId]
      );
      if (
        invitationResult.rows.length !== 1
        || invitationResult.rows[0].tenant_id !== input.tenantId
      ) deny();
      const invitation = invitationResult.rows[0];
      if (invitation.status === "REVOKED") {
        return {
          status: "ALREADY_REVOKED",
          tenantId: input.tenantId,
          invitationId: input.invitationId
        };
      }
      if (invitation.status !== "PENDING") deny();
      if (!input.apply) {
        return {
          status: "WOULD_REVOKE",
          tenantId: input.tenantId,
          invitationId: input.invitationId
        };
      }
      const changed = await client.query(
        `update tge.assisted_invitations
         set status = 'REVOKED', revoked_by_subject_id = $3,
           revoked_at = clock_timestamp(), updated_at = clock_timestamp()
         where tenant_id = $1 and id = $2 and status = 'PENDING'
         returning id`,
        [input.tenantId, input.invitationId, input.actor.subject]
      );
      if (changed.rows.length !== 1) deny();
      await insertAudit(client, {
        tenantId: input.tenantId,
        id: input.auditId,
        eventType: "INVITATION_REVOKED",
        subject: input.actor.subject,
        entityType: "ASSISTED_INVITATION",
        entityId: input.invitationId,
        payload: input.auditPayload
      });
      return {
        status: "REVOKED",
        tenantId: input.tenantId,
        invitationId: input.invitationId
      };
    });
  }
}

async function insertAudit(client, event) {
  await client.query(
    `insert into tge.audit_events (
       tenant_id, id, event_type, subject_id, entity_type, entity_id,
       payload, occurred_at, retain_until
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb,
       clock_timestamp(), clock_timestamp() + interval '12 months')`,
    [
      event.tenantId,
      event.id,
      event.eventType,
      event.subject,
      event.entityType,
      event.entityId,
      JSON.stringify(event.payload || {})
    ]
  );
}

module.exports = {
  PostgresIdentityOperatorRepository
};
