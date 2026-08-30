"use strict";

class AuthorizationError extends Error {
  constructor({
    code = "ACCESS_DENIED",
    message = "Access is denied."
  } = {}) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = 403;
  }
}

const PERMISSIONS = Object.freeze({
  CRM_READ: "crm:read",
  CRM_WRITE: "crm:write",
  OPERATIONAL_ADMIN: "operations:admin",
  INVITATION_ADMIN: "security:invitations",
  MEMBERSHIP_ADMIN: "security:memberships",
  OWNERSHIP_TRANSFER: "security:ownership-transfer"
});

const ROLE_POLICY = Object.freeze({
  OWNER: new Set(Object.values(PERMISSIONS)),
  ADMIN: new Set([
    PERMISSIONS.CRM_READ,
    PERMISSIONS.CRM_WRITE,
    PERMISSIONS.OPERATIONAL_ADMIN
  ]),
  MEMBER: new Set([
    PERMISSIONS.CRM_READ,
    PERMISSIONS.CRM_WRITE
  ])
});

const trustedContexts = new WeakSet();
const SENSITIVE_PERMISSION_BY_ACTION = Object.freeze({
  INVITATION_CREATE: PERMISSIONS.INVITATION_ADMIN,
  INVITATION_REVOKE: PERMISSIONS.INVITATION_ADMIN,
  MEMBERSHIP_ROLE_CHANGE: PERMISSIONS.MEMBERSHIP_ADMIN,
  MEMBERSHIP_REVOKE: PERMISSIONS.MEMBERSHIP_ADMIN,
  OWNERSHIP_TRANSFER: PERMISSIONS.OWNERSHIP_TRANSFER
});

function deny() {
  throw new AuthorizationError();
}

function validateIdentity(identity) {
  if (
    !identity
    || typeof identity.issuer !== "string"
    || !identity.issuer
    || typeof identity.subject !== "string"
    || !identity.subject
  ) {
    deny();
  }
}

function createTenantContext(identity, membership) {
  validateIdentity(identity);
  if (
    !membership
    || membership.status !== "ACTIVE"
    || membership.issuer !== identity.issuer
    || membership.subject !== identity.subject
    || typeof membership.tenantId !== "string"
    || !membership.tenantId
    || !ROLE_POLICY[membership.role]
  ) {
    deny();
  }

  const context = {
    tenantId: membership.tenantId,
    issuer: identity.issuer,
    subject: identity.subject,
    role: membership.role
  };
  trustedContexts.add(context);
  return Object.freeze(context);
}

async function resolveTenantContext({ identity, membershipRepository }) {
  validateIdentity(identity);
  if (
    !membershipRepository
    || typeof membershipRepository.findActiveMembershipsByIdentity !== "function"
  ) {
    deny();
  }

  let memberships;
  try {
    memberships = await membershipRepository.findActiveMembershipsByIdentity({
      issuer: identity.issuer,
      subject: identity.subject
    });
  } catch {
    deny();
  }

  if (!Array.isArray(memberships) || memberships.length !== 1) {
    deny();
  }

  return createTenantContext(identity, memberships[0]);
}

function assertTrustedTenantContext(context) {
  if (!context || !trustedContexts.has(context) || !Object.isFrozen(context)) {
    deny();
  }
  return context;
}

function assertPermission(context, permission) {
  assertTrustedTenantContext(context);
  const permissions = ROLE_POLICY[context?.role];
  if (!permissions || !permissions.has(permission)) {
    deny();
  }
  return context;
}

function assertTenantResource(context, resource) {
  assertTrustedTenantContext(context);
  if (!resource || resource.tenantId !== context.tenantId) {
    throw new AuthorizationError({
      code: "RESOURCE_UNAVAILABLE",
      message: "The requested resource is unavailable."
    });
  }
  return resource;
}

async function authorizeSensitiveMembershipAction({
  tenantContext,
  action,
  assurance,
  sensitiveActionPolicy
}) {
  assertTrustedTenantContext(tenantContext);
  const permission = SENSITIVE_PERMISSION_BY_ACTION[action];
  if (!permission) {
    deny();
  }
  assertPermission(tenantContext, permission);
  if (!sensitiveActionPolicy?.assertSatisfied) {
    deny();
  }

  try {
    await sensitiveActionPolicy.assertSatisfied({
      tenantContext,
      action,
      assurance: assurance || null
    });
  } catch {
    deny();
  }
}

async function runWithTenantContext({ tenantContext, transactionRunner, work }) {
  assertTrustedTenantContext(tenantContext);
  if (typeof transactionRunner?.run !== "function" || typeof work !== "function") {
    deny();
  }
  return transactionRunner.run(tenantContext, work);
}

module.exports = {
  AuthorizationError,
  PERMISSIONS,
  assertPermission,
  assertTenantResource,
  assertTrustedTenantContext,
  authorizeSensitiveMembershipAction,
  resolveTenantContext,
  runWithTenantContext
};
