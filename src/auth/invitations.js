"use strict";

const {
  createHash,
  randomBytes: secureRandomBytes,
  randomUUID
} = require("node:crypto");
const {
  PERMISSIONS,
  assertPermission,
  assertTrustedTenantContext,
  authorizeSensitiveMembershipAction,
  resolveTenantContext
} = require("./authorization");

class InvitationError extends Error {
  constructor() {
    super("The invitation is unavailable.");
    this.name = "InvitationError";
    this.code = "INVITATION_UNAVAILABLE";
    this.status = 404;
  }
}

function unavailable() {
  throw new InvitationError();
}

function normalizeEmail(email) {
  if (typeof email !== "string") {
    unavailable();
  }
  const normalized = email.normalize("NFKC").trim().toLowerCase();
  if (
    normalized.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    unavailable();
  }
  return normalized;
}

function tokenHash(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    unavailable();
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function asIso(value) {
  return new Date(value).toISOString();
}

function retainUntil(now) {
  const result = new Date(now);
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result.toISOString();
}

function auditEvent({ tenantContext, eventType, entityId, now, payload = {} }) {
  return {
    id: randomUUID(),
    tenantId: tenantContext.tenantId,
    eventType,
    subject: tenantContext.subject,
    entityType: "INVITATION",
    entityId,
    payload,
    occurredAt: asIso(now),
    retainUntil: retainUntil(now)
  };
}

function validateIdentity(identity) {
  let issuer;
  try {
    issuer = new URL(identity?.issuer);
  } catch {
    unavailable();
  }
  if (
    issuer.protocol !== "https:"
    || issuer.href !== identity.issuer
    || !identity.issuer.endsWith("/")
    || typeof identity.subject !== "string"
    || !identity.subject.trim()
  ) {
    unavailable();
  }
}

class InvitationService {
  constructor({
    repository,
    now = () => new Date(),
    randomBytes = secureRandomBytes,
    sensitiveActionPolicy,
    provisioningPolicy
  }) {
    this.repository = repository;
    this.now = now;
    this.randomBytes = randomBytes;
    this.sensitiveActionPolicy = sensitiveActionPolicy;
    this.provisioningPolicy = provisioningPolicy;
  }

  async create({ tenantContext, email, role, expiresAt, assurance }) {
    await authorizeSensitiveMembershipAction({
      tenantContext,
      action: "INVITATION_CREATE",
      assurance,
      sensitiveActionPolicy: this.sensitiveActionPolicy
    });
    assertPermission(tenantContext, PERMISSIONS.INVITATION_ADMIN);
    if (!this.repository?.createInvitation || !["ADMIN", "MEMBER"].includes(role)) {
      unavailable();
    }

    const now = this.now();
    const expiry = new Date(expiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry <= now) {
      unavailable();
    }
    const normalizedEmail = normalizeEmail(email);
    const token = this.randomBytes(32).toString("base64url");
    const invitation = {
      id: randomUUID(),
      tenantId: tenantContext.tenantId,
      tokenHash: tokenHash(token),
      normalizedEmail,
      role,
      status: "PENDING",
      expectedIssuer: null,
      expectedSubject: null,
      createdBySubject: tenantContext.subject,
      expiresAt: asIso(expiry),
      consumedAt: null,
      revokedAt: null,
      createdAt: asIso(now),
      updatedAt: asIso(now)
    };
    const stored = await this.repository.createInvitation({
      tenantContext,
      invitation,
      auditEvent: auditEvent({
        tenantContext,
        eventType: "INVITATION_CREATED",
        entityId: invitation.id,
        now,
        payload: { normalizedEmail, intendedRole: role }
      })
    });
    return Object.freeze({ token, invitation: Object.freeze(stored) });
  }

  async recordProvisionedIdentity({
    tenantContext,
    invitationId,
    identity,
    provisioningContext
  }) {
    assertTrustedTenantContext(tenantContext);
    assertPermission(tenantContext, PERMISSIONS.INVITATION_ADMIN);
    validateIdentity(identity);
    if (!this.repository?.recordProvisionedIdentity) {
      unavailable();
    }
    try {
      await this.provisioningPolicy?.assertServerOperation?.({
        tenantContext,
        invitationId,
        identity,
        provisioningContext
      });
    } catch {
      unavailable();
    }
    if (!this.provisioningPolicy?.assertServerOperation) {
      unavailable();
    }

    const now = this.now();
    const result = await this.repository.recordProvisionedIdentity({
      tenantContext,
      invitationId,
      identity,
      auditEvent: auditEvent({
        tenantContext,
        eventType: "INVITATION_IDENTITY_PROVISIONED",
        entityId: invitationId,
        now,
        payload: {
          expectedIssuer: identity.issuer,
          expectedSubject: identity.subject
        }
      })
    });
    if (!result) {
      unavailable();
    }
    return Object.freeze(result);
  }

  async begin({ token, redirectUri, allowedRedirectUris }) {
    if (
      typeof redirectUri !== "string"
      || !Array.isArray(allowedRedirectUris)
      || !allowedRedirectUris.includes(redirectUri)
      || !this.repository?.findAvailableInvitationByHash
    ) {
      unavailable();
    }
    const invitation = await this.repository.findAvailableInvitationByHash({
      tokenHash: tokenHash(token),
      now: asIso(this.now())
    });
    if (!invitation) {
      unavailable();
    }
    return Object.freeze({ ready: true, redirectUri });
  }

  async revoke({ tenantContext, invitationId, assurance }) {
    await authorizeSensitiveMembershipAction({
      tenantContext,
      action: "INVITATION_REVOKE",
      assurance,
      sensitiveActionPolicy: this.sensitiveActionPolicy
    });
    if (!this.repository?.revokeInvitation) {
      unavailable();
    }
    const now = this.now();
    const result = await this.repository.revokeInvitation({
      tenantContext,
      invitationId,
      auditEvent: auditEvent({
        tenantContext,
        eventType: "INVITATION_REVOKED",
        entityId: invitationId,
        now
      })
    });
    if (!result) {
      unavailable();
    }
    return Object.freeze(result);
  }

  async consume({ token, identity }) {
    validateIdentity(identity);
    if (!this.repository?.consumeInvitation) {
      unavailable();
    }
    const now = this.now();
    const hash = tokenHash(token);
    const placeholderContext = {
      tenantId: "pending",
      subject: identity.subject
    };
    const membership = await this.repository.consumeInvitation({
      tokenHash: hash,
      identity,
      now: asIso(now),
      membershipAuditEvent: auditEvent({
        tenantContext: placeholderContext,
        eventType: "MEMBERSHIP_ACTIVATED",
        entityId: identity.subject,
        now,
        payload: { issuer: identity.issuer }
      }),
      invitationAuditEvent: auditEvent({
        tenantContext: placeholderContext,
        eventType: "INVITATION_CONSUMED",
        entityId: hash,
        now
      })
    });
    if (!membership) {
      unavailable();
    }
    return resolveTenantContext({
      identity,
      membershipRepository: {
        async findActiveMembershipsByIdentity() {
          return [membership];
        }
      }
    });
  }
}

module.exports = {
  InvitationError,
  InvitationService,
  normalizeEmail,
  tokenHash
};
