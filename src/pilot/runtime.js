"use strict";

const express = require("express");
const { Pool } = require("pg");

const { createApp } = require("../app/server");
const { Auth0TokenVerifier } = require("../auth/authentication");
const { InvitationService } = require("../auth/invitations");
const { PostgresAuthRepository } = require("../auth/postgresAuthRepository");
const { createAuthRuntime } = require("../auth/runtime");
const { createPersistence } = require("../persistence/createPersistence");
const {
  createTenantOffboardingService
} = require("../tenantOffboarding/tenantOffboardingService");

const REQUIRED_ENVIRONMENT = Object.freeze([
  "PORT",
  "TGE_RUNTIME_DATABASE_URL",
  "TGE_PUBLIC_APP_URL",
  "TGE_PUBLIC_API_URL",
  "TGE_AUTH0_ISSUER",
  "TGE_AUTH0_AUDIENCE",
  "TGE_AUTH0_CLIENT_ID",
  "TGE_AUTH0_CALLBACK_URL",
  "TGE_AUTH0_LOGOUT_URL"
]);
const EXPECTED_SCHEMA_VERSION = "015";
const DEFAULT_PROBE_INTERVAL_MS = 5000;
const DEFAULT_OPERATION_TIMEOUT_MS = 3000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;

class PilotConfigurationError extends Error {
  constructor(invalidNames) {
    super("Pilot runtime configuration is invalid.");
    this.name = "PilotConfigurationError";
    this.code = "PILOT_CONFIGURATION_INVALID";
    this.invalidNames = Object.freeze([...new Set(invalidNames)].sort());
  }
}

function exactValue(env, name, invalidNames) {
  const value = env?.[name];
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalidNames.push(name);
    return null;
  }
  return value;
}

function exactHttpsUrl(value, { originOnly = false, trailingSlash = null } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || value.includes("*")
    || (!originOnly && parsed.href !== value)
    || (originOnly && value !== parsed.origin)
    || (trailingSlash === true && !value.endsWith("/"))
    || (trailingSlash === false && value.endsWith("/"))
  ) return null;
  return parsed;
}

function exactPostgresUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return (
    ["postgres:", "postgresql:"].includes(parsed.protocol)
    && parsed.hostname
    && parsed.pathname.length > 1
    && !parsed.hash
    && parsed.href === value
  ) ? parsed : null;
}

function readPilotConfig(env = process.env) {
  const invalidNames = [];
  const values = Object.fromEntries(
    REQUIRED_ENVIRONMENT.map(name => [name, exactValue(env, name, invalidNames)])
  );

  const port = Number(values.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    invalidNames.push("PORT");
  }
  if (!exactPostgresUrl(values.TGE_RUNTIME_DATABASE_URL)) {
    invalidNames.push("TGE_RUNTIME_DATABASE_URL");
  }

  const publicApp = exactHttpsUrl(values.TGE_PUBLIC_APP_URL, { originOnly: true });
  const publicApi = exactHttpsUrl(values.TGE_PUBLIC_API_URL, { originOnly: true });
  if (!publicApp) invalidNames.push("TGE_PUBLIC_APP_URL");
  if (!publicApi) invalidNames.push("TGE_PUBLIC_API_URL");

  const issuer = exactHttpsUrl(values.TGE_AUTH0_ISSUER, { trailingSlash: true });
  if (!issuer || issuer.search) invalidNames.push("TGE_AUTH0_ISSUER");
  if (
    !values.TGE_AUTH0_AUDIENCE
    || values.TGE_AUTH0_AUDIENCE.length > 2048
  ) invalidNames.push("TGE_AUTH0_AUDIENCE");
  if (
    !values.TGE_AUTH0_CLIENT_ID
    || values.TGE_AUTH0_CLIENT_ID.length > 512
  ) invalidNames.push("TGE_AUTH0_CLIENT_ID");

  const callback = exactHttpsUrl(values.TGE_AUTH0_CALLBACK_URL);
  const logout = exactHttpsUrl(values.TGE_AUTH0_LOGOUT_URL);
  if (!callback || callback.origin !== publicApp?.origin) {
    invalidNames.push("TGE_AUTH0_CALLBACK_URL");
  }
  if (!logout || logout.origin !== publicApp?.origin) {
    invalidNames.push("TGE_AUTH0_LOGOUT_URL");
  }

  if (invalidNames.length > 0) throw new PilotConfigurationError(invalidNames);

  const auth = Object.freeze({
    issuer: values.TGE_AUTH0_ISSUER,
    audience: values.TGE_AUTH0_AUDIENCE,
    jwksUri: new URL(".well-known/jwks.json", issuer).href,
    clientId: values.TGE_AUTH0_CLIENT_ID,
    allowedOrigins: Object.freeze([values.TGE_PUBLIC_APP_URL]),
    callbackUrls: Object.freeze([values.TGE_AUTH0_CALLBACK_URL]),
    logoutUrls: Object.freeze([values.TGE_AUTH0_LOGOUT_URL])
  });
  return Object.freeze({
    mode: "pilot",
    port,
    databaseUrl: values.TGE_RUNTIME_DATABASE_URL,
    publicAppUrl: values.TGE_PUBLIC_APP_URL,
    publicApiUrl: values.TGE_PUBLIC_API_URL,
    auth
  });
}

function createReadinessState() {
  let closed = false;
  let current = freezeSnapshot(false, {
    configuration: "ready",
    auth: "configured_not_externally_verified",
    database: "not_ready",
    migrations: "not_ready",
    membership: "not_ready"
  });
  return Object.freeze({
    isReady: () => current.ready,
    snapshot: () => current,
    mark(checks) {
      if (closed) return current;
      current = freezeSnapshot(Object.values(checks).every(value => [
        "ready",
        "usable",
        "current",
        "configured_not_externally_verified"
      ].includes(value)), checks);
      return current;
    },
    close() {
      if (closed) return current;
      closed = true;
      current = freezeSnapshot(false, {
        ...current.checks,
        database: "closed",
        migrations: "not_ready",
        membership: "not_ready"
      });
      return current;
    }
  });
}

function freezeSnapshot(ready, checks) {
  return Object.freeze({
    ready,
    checks: Object.freeze({ ...checks })
  });
}

function createPilotHealthRouter(readiness) {
  const router = express.Router();
  const live = (req, res) => res.json({
    ok: true,
    service: "trade-growth-engine",
    mode: "pilot",
    status: "live",
    readiness: "/health/ready",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
  router.get("/health", live);
  router.get("/health/live", live);
  router.get("/health/ready", (req, res) => {
    const snapshot = readiness.snapshot();
    const body = {
      ok: snapshot.ready,
      service: "trade-growth-engine",
      mode: "pilot",
      status: snapshot.ready ? "ready" : "not_ready",
      checks: snapshot.checks,
      limitations: {
        external_auth0: "not_verified",
        smtp_otp: "not_verified",
        provisioning: "not_verified"
      }
    };
    if (!snapshot.ready) {
      body.error = "SECURE_RUNTIME_NOT_READY";
      body.message = "The secure pilot runtime is not ready.";
    }
    res.status(snapshot.ready ? 200 : 503).json(body);
  });
  return router;
}

function denyUnavailablePolicy() {
  return Object.freeze({
    async assertSatisfied() {
      throw new Error("policy unavailable");
    },
    async assertServerOperation() {
      throw new Error("policy unavailable");
    }
  });
}

function createPilotRuntime({
  assuranceResolver = async () => null,
  config,
  logger = console,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  pool,
  poolOwned = false,
  probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  sensitiveActionPolicy,
  tokenVerifier
} = {}) {
  if (!config || config.mode !== "pilot" || !pool?.connect) {
    throw new TypeError("Pilot runtime requires validated configuration and PostgreSQL pool.");
  }
  for (const value of [operationTimeoutMs, probeIntervalMs, shutdownTimeoutMs]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new TypeError("Pilot runtime timeouts must be positive integers.");
    }
  }

  const readiness = createReadinessState();
  const persistence = createPersistence({
    adapter: "postgres",
    pool,
    onCleanupError: () => safeLog(logger, "warn", "PILOT_DATABASE_CLEANUP_FAILED")
  });
  const membershipRepository = new PostgresAuthRepository({ pool });
  const deniedPolicies = denyUnavailablePolicy();
  const invitationService = new InvitationService({
    repository: membershipRepository,
    sensitiveActionPolicy: deniedPolicies,
    provisioningPolicy: deniedPolicies
  });
  const verifier = tokenVerifier || new Auth0TokenVerifier(config.auth);
  const authRuntime = createAuthRuntime({
    config: config.auth,
    tokenVerifier: verifier,
    membershipRepository,
    invitationService,
    assuranceResolver
  });
  const tenantOffboardingService = createTenantOffboardingService({
    persistence,
    sensitiveActionPolicy: sensitiveActionPolicy || deniedPolicies,
    assuranceResolver
  });
  const app = createApp({
    authRuntime,
    healthRouter: createPilotHealthRouter(readiness),
    onUnhandledError: () => safeLog(logger, "error", "PILOT_REQUEST_FAILED"),
    persistence,
    secureReadiness: readiness,
    tenantOffboardingService
  });

  let server = null;
  let readinessTimer = null;
  let probeInFlight = null;
  let closePromise = null;
  let lifecycle = "open";
  let readinessRevision = 0;
  const signalHandlers = new Map();
  const onPoolError = () => {
    readinessRevision += 1;
    readiness.mark(createUnavailableChecks());
    safeLog(logger, "error", "PILOT_DATABASE_POOL_ERROR");
  };
  if (poolOwned && typeof pool.on === "function") {
    pool.on("error", onPoolError);
  }

  function probeReadiness() {
    if (lifecycle !== "open") return Promise.resolve(readiness.snapshot());
    if (probeInFlight) return probeInFlight.result;
    const revision = readinessRevision;
    const checks = createUnavailableChecks();
    const work = (async () => {
      const row = await readDatabaseReadiness(pool);
      checks.database = "usable";
      if (
        row?.schema_version !== EXPECTED_SCHEMA_VERSION
        || row.runtime_role_member !== true
        || row.login_nonprivileged !== true
        || row.required_relations_available !== true
      ) {
        return checks;
      }
      checks.migrations = "current";
      if (lifecycle !== "open" || revision !== readinessRevision) return checks;
      const memberships = await membershipRepository.findActiveMembershipsByIdentity({
        issuer: config.auth.issuer,
        subject: "urn:tge:pilot-readiness:v1"
      });
      if (!Array.isArray(memberships)) throw new Error("membership probe failed");
      checks.membership = "usable";
      return checks;
    })();
    const result = withTimeout(work, operationTimeoutMs).then(
      completedChecks => {
        if (lifecycle !== "open" || revision !== readinessRevision) {
          return readiness.snapshot();
        }
        const snapshot = readiness.mark(completedChecks);
        if (!snapshot.ready) {
          safeLog(logger, "warn", "PILOT_READINESS_CHECK_FAILED");
        }
        return snapshot;
      },
      () => {
        if (lifecycle !== "open" || revision !== readinessRevision) {
          return readiness.snapshot();
        }
        readiness.mark(checks);
        safeLog(logger, "warn", "PILOT_READINESS_CHECK_FAILED");
        return readiness.snapshot();
      }
    );
    const record = { result, work };
    probeInFlight = record;
    const clearProbe = () => {
      if (probeInFlight === record) probeInFlight = null;
    };
    work.then(clearProbe, clearProbe);
    return result;
  }

  async function listen({ port = config.port, autoProbe = true } = {}) {
    if (lifecycle !== "open") throw new Error("Pilot runtime is closing.");
    if (server) throw new Error("Pilot runtime is already listening.");
    server = await listenApp(app, port);
    if (autoProbe) {
      void probeReadiness();
      readinessTimer = setInterval(() => void probeReadiness(), probeIntervalMs);
      readinessTimer.unref?.();
    }
    safeLog(logger, "info", "PILOT_RUNTIME_LISTENING");
    return server;
  }

  function registerSignalHandlers(processRef = process) {
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const handler = () => void close();
      signalHandlers.set(signal, { handler, processRef });
      processRef.once(signal, handler);
    }
  }

  async function close() {
    if (closePromise) return closePromise;
    lifecycle = "closing";
    readinessRevision += 1;
    closePromise = (async () => {
      if (readinessTimer) clearInterval(readinessTimer);
      readinessTimer = null;
      for (const [signal, registration] of signalHandlers) {
        registration.processRef.removeListener(signal, registration.handler);
      }
      signalHandlers.clear();
      readiness.close();
      const activeProbe = probeInFlight?.work;
      if (server) {
        await closeServer(server, shutdownTimeoutMs, logger);
      }
      if (
        activeProbe
        && !await settlesWithin(activeProbe, shutdownTimeoutMs)
      ) {
        safeLog(logger, "warn", "PILOT_READINESS_SHUTDOWN_TIMEOUT");
      }
      let poolEnded = false;
      if (poolOwned && typeof pool.end === "function") {
        try {
          await withTimeout(pool.end(), shutdownTimeoutMs);
          poolEnded = true;
        } catch {
          safeLog(logger, "error", "PILOT_DATABASE_SHUTDOWN_FAILED");
        }
      }
      if (poolEnded && typeof pool.removeListener === "function") {
        pool.removeListener("error", onPoolError);
      }
      lifecycle = "closed";
      safeLog(logger, "info", "PILOT_RUNTIME_STOPPED");
    })();
    return closePromise;
  }

  return Object.freeze({
    app,
    close,
    listen,
    probeReadiness,
    readiness,
    registerSignalHandlers
  });
}

function createUnavailableChecks() {
  return {
    configuration: "ready",
    auth: "configured_not_externally_verified",
    database: "not_ready",
    migrations: "not_ready",
    membership: "not_ready"
  };
}

async function readDatabaseReadiness(pool) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "select * from tge.pilot_runtime_readiness()"
    );
    return result.rows?.length === 1 ? result.rows[0] : null;
  } finally {
    client.release();
  }
}

function listenApp(app, port) {
  return new Promise((resolve, reject) => {
    let candidate;
    try {
      candidate = app.listen(port);
    } catch (error) {
      reject(error);
      return;
    }
    const onError = error => {
      candidate.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      candidate.removeListener("error", onError);
      resolve(candidate);
    };
    candidate.once("error", onError);
    candidate.once("listening", onListening);
  });
}

function closeServer(server, timeoutMs, logger) {
  if (!server.listening) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      safeLog(logger, "warn", "PILOT_HTTP_SHUTDOWN_FORCED");
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    timer.unref?.();
    server.close(finish);
  });
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("operation timed out")), timeoutMs);
    timer.unref?.();
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function settlesWithin(promise, timeoutMs) {
  try {
    await withTimeout(Promise.resolve(promise).then(
      () => undefined,
      () => undefined
    ), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

function safeLog(logger, level, code) {
  try {
    logger?.[level]?.(code);
  } catch {
    // Logging must never change runtime availability or expose the original error.
  }
}

async function startPilotRuntime({
  env = process.env,
  logger = console,
  PoolClass = Pool,
  processRef = process
} = {}) {
  const config = readPilotConfig(env);
  const pool = new PoolClass({
    application_name: "tge-secure-pilot-runtime",
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: DEFAULT_OPERATION_TIMEOUT_MS,
    idleTimeoutMillis: 30000,
    max: 10,
    query_timeout: DEFAULT_OPERATION_TIMEOUT_MS,
    statement_timeout: DEFAULT_OPERATION_TIMEOUT_MS
  });
  let runtime;
  try {
    runtime = createPilotRuntime({
      config,
      logger,
      pool,
      poolOwned: true
    });
    await runtime.listen();
    runtime.registerSignalHandlers(processRef);
    return runtime;
  } catch (error) {
    if (runtime) {
      await runtime.close();
    } else {
      try {
        await withTimeout(pool.end(), DEFAULT_SHUTDOWN_TIMEOUT_MS);
      } catch {
        safeLog(logger, "error", "PILOT_DATABASE_SHUTDOWN_FAILED");
      }
    }
    throw error;
  }
}

module.exports = {
  PilotConfigurationError,
  createPilotRuntime,
  readPilotConfig,
  startPilotRuntime
};
