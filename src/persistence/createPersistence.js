const {
  createJsonRepositories
} = require("./jsonRepositories");
const {
  createPostgresRepositories
} = require("./postgres/repositories");
const {
  requireTenantContext
} = require("./tenantContext");

function createPersistence({
  adapter,
  pool,
  failureInjector,
  onCleanupError,
  clock,
  store
} = {}) {
  if (!adapter) {
    throw new TypeError("Persistence adapter selection is required.");
  }
  if (adapter === "json") {
    return {
      adapter,
      repositories: createJsonRepositories({ store }),
      forTenant() {
        throw new TypeError(
          "Tenant-bound persistence is available only for the PostgreSQL adapter."
        );
      }
    };
  }

  if (adapter === "postgres") {
    if (!pool || typeof pool.connect !== "function") {
      throw new TypeError("PostgreSQL persistence requires an injected pool.");
    }
    const repositories = createPostgresRepositories({
      pool,
      failureInjector,
      onCleanupError,
      clock
    });
    return {
      adapter,
      repositories,
      forTenant(context) {
        return bindTenantRepositories(
          repositories,
          requireTenantContext(context)
        );
      }
    };
  }

  throw new TypeError(`Unsupported persistence adapter: ${adapter}`);
}

function bindTenantRepositories(repositories, context) {
  const bound = {};
  for (const name of [
    "prospects",
    "opportunities",
    "tasks",
    "activities",
    "revenueActions"
  ]) {
    bound[name] = Object.fromEntries(
      Object.entries(repositories[name]).map(([method, operation]) => [
        method,
        (...args) => operation(context, ...args)
      ])
    );
  }
  bound.transaction = operation => repositories.transaction(context, operation);
  return Object.freeze(bound);
}

module.exports = {
  createPersistence
};
