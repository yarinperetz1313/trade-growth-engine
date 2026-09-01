const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issuedTenantContexts = new WeakSet();

class TenantContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TenantContextError";
    this.code = code;
  }
}

function createTenantContext(input) {
  const tenantId = typeof input?.tenantId === "string"
    ? input.tenantId.trim().toLowerCase()
    : "";
  const subjectId = typeof input?.subjectId === "string"
    ? input.subjectId.trim()
    : "";

  if (!UUID_PATTERN.test(tenantId) || subjectId.length === 0) {
    throw new TenantContextError(
      "TENANT_CONTEXT_INVALID",
      "Tenant context requires a valid tenant UUID and non-empty subject."
    );
  }

  const context = Object.freeze({
    tenantId,
    subjectId
  });
  issuedTenantContexts.add(context);
  return context;
}

function requireTenantContext(context) {
  if (!context || !issuedTenantContexts.has(context)) {
    throw new TenantContextError(
      "TENANT_CONTEXT_REQUIRED",
      "A trusted server-created TenantContext is required."
    );
  }

  return context;
}

module.exports = {
  TenantContextError,
  createTenantContext,
  requireTenantContext
};
