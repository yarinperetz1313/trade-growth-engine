"use strict";

const {
  AuthorizationError,
  PERMISSIONS,
  assertPermission,
  authorizeSensitiveMembershipAction
} = require("../auth/authorization");
const { requireTenantContext } = require("../persistence/tenantContext");

const CONFIRMATION = "OFFBOARD_ACCESS_AND_RAW_EVIDENCE";

class TenantOffboardingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "TenantOffboardingError";
    this.code = code;
    this.status = status;
  }
}

function createTenantOffboardingService({
  persistence,
  sensitiveActionPolicy,
  assuranceResolver = async () => null
} = {}) {
  if (persistence?.adapter !== "postgres" || typeof persistence.forTenant !== "function") {
    throw new TypeError("Tenant offboarding requires tenant-bound PostgreSQL persistence.");
  }
  if (typeof assuranceResolver !== "function") {
    throw new TypeError("Tenant offboarding assurance resolver must be a function.");
  }

  function authorize(authorizationContext, persistenceContext) {
    const authorized = assertPermission(
      authorizationContext,
      PERMISSIONS.TENANT_OFFBOARDING
    );
    let trustedPersistence;
    try {
      trustedPersistence = requireTenantContext(persistenceContext);
    } catch {
      throw new AuthorizationError();
    }
    if (
      authorized.tenantId !== trustedPersistence.tenantId
      || authorized.issuer !== trustedPersistence.identityIssuer
    ) {
      throw new AuthorizationError();
    }
    return { authorized, trustedPersistence };
  }

  async function request({
    authorizationContext,
    persistenceContext,
    input,
    request: httpRequest
  }) {
    if (!exactObject(input, ["confirmation"]) || input.confirmation !== CONFIRMATION) {
      throw new TenantOffboardingError(
        "TENANT_OFFBOARDING_REQUEST_INVALID",
        "The tenant offboarding request is invalid."
      );
    }
    const { authorized, trustedPersistence } = authorize(
      authorizationContext,
      persistenceContext
    );
    await authorizeSensitiveMembershipAction({
      tenantContext: authorized,
      action: "TENANT_OFFBOARDING_REQUEST",
      assurance: await assuranceResolver(httpRequest),
      sensitiveActionPolicy
    });
    return persistence
      .forTenant(trustedPersistence)
      .tenantOffboarding.request({ confirmation: input.confirmation });
  }

  async function status({ authorizationContext, persistenceContext }) {
    const { trustedPersistence } = authorize(
      authorizationContext,
      persistenceContext
    );
    const result = await persistence
      .forTenant(trustedPersistence)
      .tenantOffboarding.status();
    if (!result) {
      throw new TenantOffboardingError(
        "TENANT_OFFBOARDING_UNAVAILABLE",
        "Tenant offboarding state is unavailable.",
        404
      );
    }
    return result;
  }

  return Object.freeze({ request, status });
}


function exactObject(value, keys) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
  );
}

module.exports = {
  CONFIRMATION,
  TenantOffboardingError,
  createTenantOffboardingService
};
