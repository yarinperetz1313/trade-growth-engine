"use strict";

const { timingSafeEqual } = require("node:crypto");

function clone(value) {
  return structuredClone(value);
}

function hashesEqual(first, second) {
  if (typeof first !== "string" || typeof second !== "string") {
    return false;
  }
  const firstBuffer = Buffer.from(first, "hex");
  const secondBuffer = Buffer.from(second, "hex");
  return firstBuffer.length === 32
    && secondBuffer.length === 32
    && timingSafeEqual(firstBuffer, secondBuffer);
}

class InMemoryAuthRepository {
  constructor({ memberships = [], invitations = [], auditEvents = [] } = {}) {
    this.memberships = clone(memberships);
    this.invitations = clone(invitations);
    this.auditEvents = clone(auditEvents);
  }

  async findActiveMembershipsByIdentity({ issuer, subject }) {
    return clone(this.memberships.filter(item =>
      item.issuer === issuer
      && item.subject === subject
      && item.status === "ACTIVE"
    ));
  }

  async createInvitation({ invitation, auditEvent }) {
    if (this.invitations.some(item => item.tokenHash === invitation.tokenHash)) {
      throw new Error("duplicate invitation token hash");
    }
    this.invitations.push(clone(invitation));
    this.auditEvents.push(clone(auditEvent));
    return clone(invitation);
  }

  async recordProvisionedIdentity({
    tenantContext,
    invitationId,
    identity,
    auditEvent
  }) {
    const invitation = this.invitations.find(item =>
      item.id === invitationId
      && item.tenantId === tenantContext.tenantId
    );
    if (!invitation || invitation.status !== "PENDING") {
      return null;
    }
    if (invitation.expectedIssuer || invitation.expectedSubject) {
      if (
        invitation.expectedIssuer === identity.issuer
        && invitation.expectedSubject === identity.subject
      ) {
        return clone(invitation);
      }
      return null;
    }

    invitation.expectedIssuer = identity.issuer;
    invitation.expectedSubject = identity.subject;
    invitation.updatedAt = auditEvent.occurredAt;
    this.auditEvents.push(clone(auditEvent));
    return clone(invitation);
  }

  async findAvailableInvitationByHash({ tokenHash, now }) {
    const invitation = this.invitations.find(item => hashesEqual(item.tokenHash, tokenHash));
    if (
      !invitation
      || invitation.status !== "PENDING"
      || invitation.expiresAt <= now
      || !invitation.expectedIssuer
      || !invitation.expectedSubject
    ) {
      return null;
    }
    return clone(invitation);
  }

  async revokeInvitation({ tenantContext, invitationId, auditEvent }) {
    const invitation = this.invitations.find(item =>
      item.id === invitationId
      && item.tenantId === tenantContext.tenantId
    );
    if (!invitation) {
      return null;
    }
    if (invitation.status === "REVOKED") {
      return clone(invitation);
    }
    if (invitation.status !== "PENDING") {
      return null;
    }
    invitation.status = "REVOKED";
    invitation.revokedAt = auditEvent.occurredAt;
    invitation.revokedBySubject = tenantContext.subject;
    invitation.updatedAt = auditEvent.occurredAt;
    this.auditEvents.push(clone(auditEvent));
    return clone(invitation);
  }

  async consumeInvitation({
    tokenHash,
    identity,
    now,
    membershipAuditEvent,
    invitationAuditEvent
  }) {
    const invitation = this.invitations.find(item => hashesEqual(item.tokenHash, tokenHash));
    if (
      !invitation
      || invitation.status !== "PENDING"
      || invitation.expiresAt <= now
      || invitation.expectedIssuer !== identity.issuer
      || invitation.expectedSubject !== identity.subject
    ) {
      return null;
    }

    const activeMemberships = this.memberships.filter(item =>
      item.issuer === identity.issuer
      && item.subject === identity.subject
      && item.status === "ACTIVE"
    );
    const exactMembership = activeMemberships.find(item =>
      item.tenantId === invitation.tenantId
    );
    if (
      activeMemberships.some(item => item.tenantId !== invitation.tenantId)
      || (exactMembership && exactMembership.role !== invitation.role)
    ) {
      return null;
    }

    const membership = exactMembership || {
      tenantId: invitation.tenantId,
      issuer: identity.issuer,
      subject: identity.subject,
      role: invitation.role,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now
    };
    if (!exactMembership) {
      this.memberships.push(membership);
      this.auditEvents.push(clone({
        ...membershipAuditEvent,
        tenantId: invitation.tenantId,
        entityType: "TENANT_MEMBERSHIP",
        entityId: identity.subject
      }));
    }

    invitation.status = "CONSUMED";
    invitation.consumedAt = now;
    invitation.consumedByIssuer = identity.issuer;
    invitation.consumedBySubject = identity.subject;
    invitation.updatedAt = now;
    this.auditEvents.push(clone({
      ...invitationAuditEvent,
      tenantId: invitation.tenantId,
      entityId: invitation.id
    }));
    return clone(membership);
  }

  snapshot() {
    return clone({
      memberships: this.memberships,
      invitations: this.invitations,
      auditEvents: this.auditEvents
    });
  }
}

module.exports = {
  InMemoryAuthRepository
};
