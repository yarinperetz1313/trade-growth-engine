"use strict";

const {
  assertTrustedTenantContext
} = require("./authorization");

function mapMembership(row) {
  return {
    tenantId: row.tenant_id,
    issuer: row.identity_issuer,
    subject: row.subject_id,
    role: row.role,
    status: row.status
  };
}

function mapInvitation(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tokenHash: row.token_hash,
    normalizedEmail: row.normalized_email,
    role: row.intended_role,
    status: row.status,
    expectedIssuer: row.expected_identity_issuer,
    expectedSubject: row.expected_subject_id,
    createdBySubject: row.created_by_subject_id,
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at,
    consumedAt: row.consumed_at?.toISOString?.() || row.consumed_at,
    revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

async function insertAudit(client, event) {
  await client.query(
    `
      insert into tge.audit_events (
        tenant_id, id, event_type, subject_id, entity_type, entity_id,
        payload, occurred_at, retain_until
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    `,
    [
      event.tenantId,
      event.id,
      event.eventType,
      event.subject,
      event.entityType,
      event.entityId,
      JSON.stringify(event.payload || {}),
      event.occurredAt,
      event.retainUntil
    ]
  );
}

class PostgresAuthRepository {
  constructor({ pool }) {
    if (!pool?.connect) {
      throw new Error("Postgres auth repository requires a pool.");
    }
    this.pool = pool;
  }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original error without logging query or identity values.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveMembershipsByIdentity({ issuer, subject }) {
    return this.transaction(async client => {
      await client.query("select tge.set_identity_context($1, $2)", [issuer, subject]);
      const result = await client.query(
        `
          select tenant_id, identity_issuer, subject_id, role, status
          from tge.tenant_memberships
          where identity_issuer = $1
            and subject_id = $2
            and status = 'ACTIVE'
          order by tenant_id
          limit 2
        `,
        [issuer, subject]
      );
      return result.rows.map(mapMembership);
    });
  }

  async run(tenantContext, work) {
    assertTrustedTenantContext(tenantContext);
    return this.transaction(async client => {
      await client.query(
        "select tge.set_request_context($1, $2, $3)",
        [tenantContext.tenantId, tenantContext.issuer, tenantContext.subject]
      );
      return work(client);
    });
  }

  async createInvitation({ tenantContext, invitation, auditEvent }) {
    return this.run(tenantContext, async client => {
      const result = await client.query(
        `
          insert into tge.assisted_invitations (
            tenant_id, id, token_hash, normalized_email, intended_role,
            status, created_by_subject_id, expires_at, created_at, updated_at
          ) values ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, $8)
          returning *
        `,
        [
          invitation.tenantId,
          invitation.id,
          invitation.tokenHash,
          invitation.normalizedEmail,
          invitation.role,
          invitation.createdBySubject,
          invitation.expiresAt,
          invitation.createdAt
        ]
      );
      await insertAudit(client, auditEvent);
      return mapInvitation(result.rows[0]);
    });
  }

  async recordProvisionedIdentity({
    tenantContext,
    invitationId,
    identity,
    auditEvent
  }) {
    return this.run(tenantContext, async client => {
      const changed = await client.query(
        `
          update tge.assisted_invitations
          set expected_identity_issuer = $3,
              expected_subject_id = $4,
              updated_at = $5
          where tenant_id = $1
            and id = $2
            and status = 'PENDING'
            and expected_identity_issuer is null
            and expected_subject_id is null
          returning *
        `,
        [
          tenantContext.tenantId,
          invitationId,
          identity.issuer,
          identity.subject,
          auditEvent.occurredAt
        ]
      );
      if (changed.rows[0]) {
        await insertAudit(client, auditEvent);
        return mapInvitation(changed.rows[0]);
      }
      const replay = await client.query(
        `
          select * from tge.assisted_invitations
          where tenant_id = $1
            and id = $2
            and status = 'PENDING'
            and expected_identity_issuer = $3
            and expected_subject_id = $4
        `,
        [tenantContext.tenantId, invitationId, identity.issuer, identity.subject]
      );
      return mapInvitation(replay.rows[0]);
    });
  }

  async findAvailableInvitationByHash({ tokenHash }) {
    return this.transaction(async client => {
      const result = await client.query(
        "select tge.invitation_available($1) as available",
        [tokenHash]
      );
      return result.rows[0]?.available ? { available: true } : null;
    });
  }

  async revokeInvitation({ tenantContext, invitationId, auditEvent }) {
    return this.run(tenantContext, async client => {
      const changed = await client.query(
        `
          update tge.assisted_invitations
          set status = 'REVOKED',
              revoked_by_subject_id = $3,
              revoked_at = $4,
              updated_at = $4
          where tenant_id = $1 and id = $2 and status = 'PENDING'
          returning *
        `,
        [
          tenantContext.tenantId,
          invitationId,
          tenantContext.subject,
          auditEvent.occurredAt
        ]
      );
      if (changed.rows[0]) {
        await insertAudit(client, auditEvent);
        return mapInvitation(changed.rows[0]);
      }
      const replay = await client.query(
        `select * from tge.assisted_invitations
         where tenant_id = $1 and id = $2 and status = 'REVOKED'`,
        [tenantContext.tenantId, invitationId]
      );
      return mapInvitation(replay.rows[0]);
    });
  }

  async consumeInvitation({
    tokenHash,
    identity,
    membershipAuditEvent,
    invitationAuditEvent
  }) {
    return this.transaction(async client => {
      const result = await client.query(
        `
          select resolved_tenant_id, resolved_role
          from tge.consume_assisted_invitation($1, $2, $3, $4, $5)
        `,
        [
          tokenHash,
          identity.issuer,
          identity.subject,
          membershipAuditEvent.id,
          invitationAuditEvent.id
        ]
      );
      if (!result.rows[0]) return null;
      return {
        tenantId: result.rows[0].resolved_tenant_id,
        issuer: identity.issuer,
        subject: identity.subject,
        role: result.rows[0].resolved_role,
        status: "ACTIVE"
      };
    });
  }
}

module.exports = {
  PostgresAuthRepository
};
