"use strict";

const {
  createHash,
  randomBytes: secureRandomBytes,
  randomUUID
} = require("node:crypto");

const APPLY_CONFIRMATIONS = Object.freeze({
  BOOTSTRAP: "BOOTSTRAP_FIRST_TENANT",
  INVITE: "CREATE_PROVISIONED_INVITATION",
  INVITATION_REVOKE: "REVOKE_INVITATION",
  REVOKE: "REVOKE_MEMBERSHIP"
});

class IdentityOperationError extends Error {
  constructor() {
    super("The identity operation was denied.");
    this.name = "IdentityOperationError";
    this.code = "IDENTITY_OPERATION_DENIED";
    this.status = 409;
  }
}

function deny() {
  throw new IdentityOperationError();
}

function exactUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function exactIssuer(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    deny();
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.href !== value
    || !value.endsWith("/")
  ) deny();
  return value;
}

function exactSubject(value) {
  if (
    typeof value !== "string"
    || value.length < 3
    || value.length > 512
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) deny();
  return value;
}

function exactIdentity(value) {
  if (!value || typeof value !== "object") deny();
  return Object.freeze({
    issuer: exactIssuer(value.issuer),
    subject: exactSubject(value.subject)
  });
}

function exactSlug(value) {
  if (
    typeof value !== "string"
    || value.length > 80
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) deny();
  return value;
}

function exactName(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 160
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) deny();
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedEmail(value) {
  if (typeof value !== "string") deny();
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (
    normalized.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) deny();
  return normalized;
}

function requireApplyConfirmation(apply, confirmation, expected) {
  if (apply === undefined || apply === false) return false;
  if (apply !== true || confirmation !== expected) deny();
  return true;
}

class IdentityOperationsService {
  constructor({
    repository,
    provisioner = null,
    randomBytes = secureRandomBytes,
    now = () => new Date()
  }) {
    if (!repository || typeof repository !== "object") {
      throw new TypeError("Identity operations require a repository.");
    }
    this.repository = repository;
    this.provisioner = provisioner;
    this.randomBytes = randomBytes;
    this.now = now;
  }

  async bootstrapFirstTenant(input = {}) {
    if (!this.repository.bootstrapFirstTenant || !exactUuid(input.tenantId)) deny();
    const issuer = exactIssuer(input.issuer);
    const subject = exactSubject(input.subject);
    const apply = requireApplyConfirmation(
      input.apply,
      input.confirmation,
      APPLY_CONFIRMATIONS.BOOTSTRAP
    );
    const issuerFingerprint = fingerprint(issuer);
    const subjectFingerprint = fingerprint(`${issuer}\u0000${subject}`);
    try {
      const result = await this.repository.bootstrapFirstTenant({
        tenantId: input.tenantId,
        slug: exactSlug(input.slug),
        name: exactName(input.name),
        issuer,
        subject,
        apply,
        auditId: randomUUID(),
        issuerFingerprint,
        subjectFingerprint,
        auditPayload: {
          issuer_fingerprint: issuerFingerprint,
          subject_fingerprint: subjectFingerprint,
          role: "OWNER"
        }
      });
      if (!result || result.tenantId !== input.tenantId) deny();
      return Object.freeze({ status: result.status, tenantId: result.tenantId });
    } catch (error) {
      if (error instanceof IdentityOperationError) throw error;
      deny();
    }
  }

  async revokeMembership(input = {}) {
    if (!this.repository.revokeMembership || !exactUuid(input.tenantId)) deny();
    const actor = exactIdentity(input.actor);
    const target = exactIdentity(input.target);
    const apply = requireApplyConfirmation(
      input.apply,
      input.confirmation,
      APPLY_CONFIRMATIONS.REVOKE
    );
    const actorFingerprint = fingerprint(`${actor.issuer}\u0000${actor.subject}`);
    const targetFingerprint = fingerprint(`${target.issuer}\u0000${target.subject}`);
    try {
      const result = await this.repository.revokeMembership({
        tenantId: input.tenantId,
        actor,
        target,
        apply,
        auditId: randomUUID(),
        auditPayload: {
          actor_fingerprint: actorFingerprint,
          target_fingerprint: targetFingerprint
        }
      });
      if (!result || result.tenantId !== input.tenantId) deny();
      return Object.freeze({ status: result.status, tenantId: result.tenantId });
    } catch (error) {
      if (error instanceof IdentityOperationError) throw error;
      deny();
    }
  }

  async revokeInvitation(input = {}) {
    if (
      !this.repository.revokeInvitation
      || !exactUuid(input.tenantId)
      || !exactUuid(input.invitationId)
    ) deny();
    const actor = exactIdentity(input.actor);
    const apply = requireApplyConfirmation(
      input.apply,
      input.confirmation,
      APPLY_CONFIRMATIONS.INVITATION_REVOKE
    );
    const actorFingerprint = fingerprint(`${actor.issuer}\u0000${actor.subject}`);
    try {
      const result = await this.repository.revokeInvitation({
        tenantId: input.tenantId,
        invitationId: input.invitationId,
        actor,
        apply,
        auditId: randomUUID(),
        auditPayload: { actor_fingerprint: actorFingerprint }
      });
      if (
        !result
        || result.tenantId !== input.tenantId
        || result.invitationId !== input.invitationId
      ) deny();
      return Object.freeze({
        status: result.status,
        tenantId: result.tenantId,
        invitationId: result.invitationId
      });
    } catch (error) {
      if (error instanceof IdentityOperationError) throw error;
      deny();
    }
  }

  async createProvisionedInvitation(input = {}) {
    if (
      !this.repository.preflightProvisionedInvitation
      || !this.repository.createProvisionedInvitation
      || !this.provisioner?.provisionIdentity
      || !exactUuid(input.operationId)
      || !exactUuid(input.tenantId)
      || !["ADMIN", "MEMBER"].includes(input.role)
    ) deny();
    const apply = requireApplyConfirmation(
      input.apply,
      input.confirmation,
      APPLY_CONFIRMATIONS.INVITE
    );
    if (!apply) deny();
    const actor = exactIdentity(input.actor);
    const email = normalizedEmail(input.email);
    const expiry = new Date(input.expiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry <= this.now()) deny();

    try {
      const preflight = await this.repository.preflightProvisionedInvitation({
        operationId: input.operationId,
        tenantId: input.tenantId,
        actor
      });
      if (
        !preflight
        || preflight.status !== "AUTHORIZED"
        || preflight.tenantId !== input.tenantId
      ) deny();
      const identity = await this.provisioner.provisionIdentity({
        normalizedEmail: email,
        operationId: input.operationId
      });
      const expected = exactIdentity(identity);
      const token = this.randomBytes(32).toString("base64url");
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) deny();
      const tokenHash = fingerprint(token);
      const now = this.now().toISOString();
      const result = await this.repository.createProvisionedInvitation({
        operationId: input.operationId,
        tenantId: input.tenantId,
        actor,
        normalizedEmail: email,
        role: input.role,
        status: "PENDING",
        tokenHash,
        expectedIssuer: expected.issuer,
        expectedSubject: expected.subject,
        expiresAt: expiry.toISOString(),
        createdAt: now,
        auditId: randomUUID(),
        auditPayload: {
          intended_role: input.role,
          identity_fingerprint: fingerprint(`${expected.issuer}\u0000${expected.subject}`),
          provider_reconciled: identity.reconciled === true
        }
      });
      if (!result || result.invitationId !== input.operationId) deny();
      return Object.freeze({
        status: result.status,
        invitationId: result.invitationId,
        ...(result.status === "CREATED" ? { token } : {})
      });
    } catch (error) {
      if (error instanceof IdentityOperationError) throw error;
      deny();
    }
  }

  planProvisionedInvitation(input = {}) {
    if (
      !exactUuid(input.operationId)
      || !exactUuid(input.tenantId)
      || !["ADMIN", "MEMBER"].includes(input.role)
    ) deny();
    exactIdentity(input.actor);
    normalizedEmail(input.email);
    const expiry = new Date(input.expiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry <= this.now()) deny();
    return Object.freeze({ status: "WOULD_PROVISION" });
  }
}

module.exports = {
  APPLY_CONFIRMATIONS,
  IdentityOperationError,
  IdentityOperationsService
};
