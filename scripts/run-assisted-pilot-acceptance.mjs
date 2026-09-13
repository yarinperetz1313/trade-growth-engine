import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_POSTGRES_VERSION = "16.15";
const DETERMINISTIC_VERIFIER_LABEL = "LOCAL_DETERMINISTIC_NOT_AUTH0_OR_SMTP";
const ACCEPTANCE_ROLE_NAMES = Object.freeze([
  "tge_owner",
  "tge_migrator",
  "tge_runtime",
  "tge_maintenance"
]);
const ACCEPTANCE_ROLE_DEFINITIONS = Object.freeze([
  "tge_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls",
  "tge_migrator nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls",
  "tge_runtime nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls",
  "tge_maintenance nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls"
]);
const ACCEPTANCE_ADVISORY_LOCK_KEY = "tge:assisted-pilot-acceptance:v1";
const ACCEPTANCE_ROLE_OWNERSHIP_PREFIX = "tge:assisted-pilot-acceptance:";
const ACCEPTANCE_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);
const DEFAULT_SIGNAL_CLEANUP_TIMEOUT_MS = 10_000;
const EXTERNAL_PROOF_EXCLUSIONS = Object.freeze([
  "AUTH0_AU_NOT_VERIFIED",
  "JWKS_NOT_VERIFIED",
  "SMTP_OTP_NOT_VERIFIED",
  "AU_INFRASTRUCTURE_NOT_VERIFIED",
  "BACKUP_RESTORE_NOT_VERIFIED",
  "PRODUCTION_MAINTENANCE_NOT_VERIFIED",
  "PRIVACY_VENDOR_NOT_APPROVED",
  "CANONICAL_TENANT_DATA_DELETION_NOT_APPROVED"
]);

export class AcceptanceConfigurationError extends Error {
  constructor() {
    super("Assisted Pilot acceptance configuration is invalid.");
    this.name = "AcceptanceConfigurationError";
    this.code = "ASSISTED_PILOT_ACCEPTANCE_CONFIGURATION_INVALID";
  }
}

export class AcceptanceRunError extends Error {
  constructor(cleanup = {
    database: "UNKNOWN",
    runtime_login: "UNKNOWN",
    migration_roles: "UNKNOWN"
  }, phase = "UNKNOWN") {
    super("Assisted Pilot acceptance failed.");
    this.name = "AcceptanceRunError";
    this.code = "ASSISTED_PILOT_ACCEPTANCE_FAILED";
    this.phase = phase;
    this.cleanup = Object.freeze({
      database: cleanup.database,
      runtime_login: cleanup.runtime_login,
      migration_roles: cleanup.migration_roles
    });
  }

  toJSON() {
    return { code: this.code, phase: this.phase, cleanup: this.cleanup };
  }
}

export function readAcceptanceConfig(env = process.env) {
  const value = env?.TGE_ACCEPTANCE_DATABASE_URL;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new AcceptanceConfigurationError();

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AcceptanceConfigurationError();
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || !url.port
    || url.pathname !== "/postgres"
    || url.search
    || url.hash
  ) throw new AcceptanceConfigurationError();

  return Object.freeze({ operatorUrl: value });
}

export async function runAssistedPilotAcceptance({
  env = process.env,
  provision = provisionAcceptanceResources,
  journey = executeAcceptanceJourney,
  cleanup = cleanupAcceptanceResources,
  signalTarget = null,
  signalCleanupTimeoutMs = DEFAULT_SIGNAL_CLEANUP_TIMEOUT_MS,
  onSignal = null
} = {}) {
  const config = readAcceptanceConfig(env);
  const resources = {
    operatorUrl: config.operatorUrl,
    databaseName: null,
    runtimeRole: null,
    runtimePassword: null,
    runtimeUrl: null,
    cleanServerVerified: false,
    acceptanceLockHeld: false,
    migrationRoleOwnershipToken: null,
    operatorClient: null,
    databaseClient: null,
    runtimePool: null,
    runtime: null
  };
  let setup;
  let evidence;
  let failed = false;
  let failedPhase = "UNKNOWN";
  let cleanupPromise = null;
  const cleanupOnce = () => {
    if (!cleanupPromise) cleanupPromise = Promise.resolve().then(() => cleanup(resources));
    return cleanupPromise;
  };
  const signalLifecycle = signalTarget
    ? installAcceptanceSignalLifecycle({
        target: signalTarget,
        cleanupOnce,
        timeoutMs: signalCleanupTimeoutMs,
        onSignal
      })
    : null;

  try {
    setup = await provision(resources);
    evidence = await journey(resources);
  } catch {
    failed = true;
    failedPhase = resources.phase || "PROVISIONING";
  }

  let cleanupState;
  try {
    cleanupState = await cleanupOnce();
  } catch {
    cleanupState = {
      database: "FAILED",
      runtime_login: "FAILED",
      migration_roles: "FAILED"
    };
    failed = true;
  }

  try {
    if (
      failed
      || cleanupState?.database !== "REMOVED"
      || cleanupState?.runtime_login !== "REMOVED"
      || cleanupState?.migration_roles !== "REMOVED"
    ) throw new AcceptanceRunError(cleanupState, failedPhase);
    try {
      return buildAcceptanceProof(setup, evidence, cleanupState);
    } catch {
      throw new AcceptanceRunError(cleanupState, "PROOF_VALIDATION");
    }
  } finally {
    signalLifecycle?.dispose();
  }
}

export function installAcceptanceSignalLifecycle({
  target,
  cleanupOnce,
  timeoutMs = DEFAULT_SIGNAL_CLEANUP_TIMEOUT_MS,
  onSignal = null
}) {
  if (
    !target
    || typeof target.once !== "function"
    || typeof target.removeListener !== "function"
    || typeof target.removeAllListeners !== "function"
    || typeof target.kill !== "function"
    || !Number.isInteger(target.pid)
    || target.pid <= 0
    || typeof cleanupOnce !== "function"
    || !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
  ) throw new AcceptanceConfigurationError();

  let terminating = false;
  let disposed = false;
  const handlers = new Map();
  const removeOwnedHandlers = () => {
    if (disposed) return;
    disposed = true;
    for (const [signal, handler] of handlers) target.removeListener(signal, handler);
  };
  const reemitSignal = signal => {
    removeOwnedHandlers();
    target.removeAllListeners(signal);
    target.kill(target.pid, signal);
  };
  const beginTermination = signal => {
    if (terminating) return;
    terminating = true;
    if (typeof onSignal === "function") onSignal(signal);
    const timeout = new Promise(resolve => setTimeout(resolve, timeoutMs));
    void Promise.race([
      Promise.resolve().then(cleanupOnce).catch(() => {}),
      timeout
    ]).then(() => reemitSignal(signal));
  };

  for (const signal of ACCEPTANCE_SIGNALS) {
    const handler = () => beginTermination(signal);
    handlers.set(signal, handler);
    target.once(signal, handler);
  }
  return Object.freeze({ dispose: removeOwnedHandlers });
}

function buildAcceptanceProof(setup, evidence, cleanup) {
  expect(setup?.postgresVersion, REQUIRED_POSTGRES_VERSION);
  for (const [field, expected] of [
    ["initialReadiness", "NOT_READY"],
    ["secureReadiness", "READY"],
    ["authentication", DETERMINISTIC_VERIFIER_LABEL],
    ["membershipAuthority", "VERIFIED"],
    ["forgedClientTenant", "REJECTED"],
    ["secondTenantIsolation", "VERIFIED"],
    ["previewRows", 1],
    ["validRows", 1],
    ["blockingRows", 0],
    ["committedRows", 1],
    ["authoritativeCurrency", "AUD"],
    ["evaluatedCount", 1],
    ["detectedCount", 1],
    ["queueCount", 1],
    ["rankedFirst", true],
    ["actionStatus", "EXECUTED"],
    ["executionMode", "SYSTEM_INTERNAL"],
    ["effectType", "INTERNAL_TASK"],
    ["durableCaseId", true],
    ["durableActionId", true],
    ["durableTaskId", true],
    ["durableActivityId", true],
    ["externalSendPerformed", false]
  ]) expect(evidence?.[field], expected);

  return Object.freeze({
    status: "PASS",
    postgresql_version: REQUIRED_POSTGRES_VERSION,
    gates: Object.freeze({
      initial_readiness: "NOT_READY",
      secure_readiness: "READY",
      authentication: DETERMINISTIC_VERIFIER_LABEL,
      membership_authority: "VERIFIED",
      forged_client_tenant: "REJECTED",
      second_tenant_isolation: "VERIFIED",
      import: Object.freeze({
        preview_rows: 1,
        valid_rows: 1,
        blocking_rows: 0,
        committed_rows: 1,
        authoritative_currency: "AUD"
      }),
      detector: Object.freeze({ evaluated_count: 1, detected_count: 1 }),
      queue: Object.freeze({ case_count: 1, ranked_first: true }),
      action: Object.freeze({
        status: "EXECUTED",
        execution_mode: "SYSTEM_INTERNAL",
        effect_type: "INTERNAL_TASK",
        durable_case_id: true,
        durable_action_id: true,
        durable_task_id: true,
        durable_activity_id: true,
        external_send_performed: false
      })
    }),
    external_proof_exclusions: [...EXTERNAL_PROOF_EXCLUSIONS],
    cleanup: Object.freeze({
      database: cleanup.database,
      runtime_login: cleanup.runtime_login,
      migration_roles: cleanup.migration_roles
    })
  });
}

export async function provisionAcceptanceResources(resources, {
  postgres = null,
  migrate = null
} = {}) {
  resources.phase = "PROVISIONING";
  const pg = postgres || (await import("pg")).default;
  const { Client, Pool } = pg;
  const operatorClient = new Client({ connectionString: resources.operatorUrl });
  resources.operatorClient = operatorClient;
  await operatorClient.connect();

  const ownershipLock = await operatorClient.query(
    "select pg_try_advisory_lock(hashtext($1)) as acquired",
    [ACCEPTANCE_ADVISORY_LOCK_KEY]
  );
  expect(ownershipLock.rows?.[0]?.acquired, true);
  resources.acceptanceLockHeld = true;

  const identity = await operatorClient.query(
    `select
       current_setting('server_version_num') as version_number,
       current_user as operator`
  );
  expect(identity.rows?.length, 1);
  expect(identity.rows[0].version_number, "160015");
  resources.operatorUser = identity.rows[0].operator;

  const userDatabases = await operatorClient.query(
    `select datname from pg_database
     where datname not in ('postgres', 'template0', 'template1')`
  );
  const existingRoles = await operatorClient.query(
    "select rolname from pg_roles where rolname = any($1::text[])",
    [ACCEPTANCE_ROLE_NAMES]
  );
  expect(userDatabases.rows.length, 0);
  expect(existingRoles.rows.length, 0);
  resources.cleanServerVerified = true;

  const ownershipToken = `${ACCEPTANCE_ROLE_OWNERSHIP_PREFIX}${randomUUID()}`;
  await operatorClient.query("begin");
  try {
    for (const definition of ACCEPTANCE_ROLE_DEFINITIONS) {
      await operatorClient.query(`create role ${definition}`);
    }
    for (const role of ACCEPTANCE_ROLE_NAMES) {
      const comment = await operatorClient.query(
        "select format('comment on role %I is %L', $1::text, $2::text) as sql",
        [role, ownershipToken]
      );
      await operatorClient.query(comment.rows[0].sql);
    }
    await operatorClient.query("commit");
    resources.migrationRoleOwnershipToken = ownershipToken;
  } catch (error) {
    await operatorClient.query("rollback").catch(() => {});
    throw error;
  }

  const suffix = randomBytes(12).toString("hex");
  resources.databaseName = `tge_acceptance_${suffix}`;
  resources.runtimeRole = `tge_acceptance_runtime_${suffix}`;
  resources.runtimePassword = randomBytes(32).toString("base64url");
  await operatorClient.query(
    `create database ${quoteIdentifier(resources.databaseName)}`
  );

  const databaseUrl = replaceDatabase(resources.operatorUrl, resources.databaseName);
  const runMigrations = migrate || (await import("./migrate-db.mjs")).runMigrations;
  await runMigrations({ connectionString: databaseUrl, logger: { log() {} } });

  const databaseClient = new Client({ connectionString: databaseUrl });
  resources.databaseClient = databaseClient;
  await databaseClient.connect();
  const createRole = await databaseClient.query(
    "select format('create role %I login password %L nosuperuser nocreatedb nocreaterole noreplication nobypassrls', $1::text, $2::text) as sql",
    [resources.runtimeRole, resources.runtimePassword]
  );
  await databaseClient.query(createRole.rows[0].sql);
  await databaseClient.query(
    `grant tge_runtime to ${quoteIdentifier(resources.runtimeRole)}`
  );
  resources.runtimeUrl = replaceCredentials(
    databaseUrl,
    resources.runtimeRole,
    resources.runtimePassword
  );
  resources.Pool = Pool;
  return { postgresVersion: REQUIRED_POSTGRES_VERSION };
}

async function executeAcceptanceJourney(resources) {
  resources.phase = "TENANT_SETUP";
  const {
    createPilotRuntime,
    readPilotConfig
  } = require(path.join(repositoryRoot, "src/pilot/runtime"));
  const issuer = "https://local-deterministic.invalid/";
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const subjectA = `local|${randomUUID()}`;
  const subjectB = `local|${randomUUID()}`;
  const tokenA = randomBytes(32).toString("base64url");
  const tokenB = randomBytes(32).toString("base64url");
  const opportunityId = `acceptance-opportunity-${randomBytes(8).toString("hex")}`;

  await resources.databaseClient.query(
    `insert into tge.tenants (id, slug, name)
     values ($1, $2, 'Acceptance Tenant A'), ($3, $4, 'Acceptance Tenant B')`,
    [tenantA, `acceptance-a-${randomUUID()}`, tenantB, `acceptance-b-${randomUUID()}`]
  );
  await resources.databaseClient.query(
    `insert into tge.tenant_memberships
       (tenant_id, identity_issuer, subject_id, role)
     values ($1, $2, $3, 'OWNER'), ($4, $2, $5, 'OWNER')`,
    [tenantA, issuer, subjectA, tenantB, subjectB]
  );

  resources.runtimePool = new resources.Pool({
    connectionString: resources.runtimeUrl,
    max: 4
  });
  const config = readPilotConfig({
    PORT: "3000",
    TGE_RUNTIME_DATABASE_URL: resources.runtimeUrl,
    TGE_PUBLIC_APP_URL: "https://local-app.invalid",
    TGE_PUBLIC_API_URL: "https://local-api.invalid",
    TGE_AUTH0_ISSUER: issuer,
    TGE_AUTH0_AUDIENCE: "https://local-api.invalid",
    TGE_AUTH0_CLIENT_ID: "local-deterministic-public-client",
    TGE_AUTH0_CALLBACK_URL: "https://local-app.invalid/auth/callback",
    TGE_AUTH0_LOGOUT_URL: "https://local-app.invalid/signed-out"
  });
  resources.runtime = createPilotRuntime({
    config,
    pool: resources.runtimePool,
    poolOwned: true,
    tokenVerifier: {
      async verify(token) {
        if (token === tokenA) return Object.freeze({ issuer, subject: subjectA });
        if (token === tokenB) return Object.freeze({ issuer, subject: subjectB });
        throw new Error("deterministic verifier rejection");
      }
    },
    logger: { info() {}, warn() {}, error() {} }
  });
  const server = await resources.runtime.listen({ port: 0, autoProbe: false });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headersA = { authorization: `Bearer ${tokenA}` };
  const headersB = { authorization: `Bearer ${tokenB}` };

  resources.phase = "NOT_READY_GATE";
  const initialReady = await request(baseUrl, "GET", "/health/ready");
  expect(initialReady.status, 503);
  expect(initialReady.data.status, "not_ready");
  const gated = await request(
    baseUrl,
    "GET",
    "/api/revenue-leak-cases/operating-queue",
    undefined,
    headersA
  );
  expect(gated.status, 503);
  expect(gated.data.error, "SECURE_RUNTIME_NOT_READY");

  resources.phase = "SECURE_READINESS";
  const readiness = await resources.runtime.probeReadiness();
  expect(readiness.ready, true);
  const ready = await request(baseUrl, "GET", "/health/ready");
  expect(ready.status, 200);
  expect(ready.data.status, "ready");

  resources.phase = "MEMBERSHIP_AUTHORITY";
  const context = await request(baseUrl, "GET", "/api/auth/context", undefined, headersA);
  expect(context.status, 200);
  expect(context.data.tenantContext.tenantId, tenantA);
  expect(context.data.tenantContext.role, "OWNER");

  const now = Date.now();
  const createdAt = new Date(now - 20 * 86400000).toISOString();
  const updatedAt = new Date(now - 86400000).toISOString();
  const csv = [
    "source_id,id,business_name,stage,next_action,value,currency,created_at,updated_at",
    `synthetic-source,${opportunityId},Synthetic Acceptance Trade,PROPOSAL,,42000.500000,AUD,${createdAt},${updatedAt}`
  ].join("\n");
  const upload = {
    filename: "synthetic-acceptance.csv",
    mediaType: "text/csv",
    contentBase64: Buffer.from(csv, "utf8").toString("base64")
  };
  resources.phase = "FORGED_TENANT_REJECTION";
  const forged = await request(
    baseUrl,
    "POST",
    "/api/import-batches/preview",
    { sourceCollection: "opportunities", upload, tenantId: tenantB },
    headersA
  );
  expect(forged.status, 400);
  expect(forged.data.error, "IMPORT_REQUEST_INVALID");

  resources.phase = "CSV_PREVIEW";
  const preview = await request(
    baseUrl,
    "POST",
    `/api/import-batches/preview?tenantId=${tenantB}`,
    { sourceCollection: "opportunities", upload },
    {
      ...headersA,
      "x-tenant-id": tenantB,
      "x-role": "OWNER"
    }
  );
  expect(preview.status, 201);
  expect(preview.data.data.batch.previewSummary.rowCount, 1);
  const batchId = preview.data.data.batch.id;
  const selections = [
    { targetField: "id", sourceColumn: "id", selectedType: "TEXT" },
    { targetField: "business_name", sourceColumn: "business_name", selectedType: "TEXT" },
    { targetField: "stage", sourceColumn: "stage", selectedType: "STATUS" },
    { targetField: "next_action", sourceColumn: "next_action", selectedType: "TEXT" },
    { targetField: "value", sourceColumn: "value", selectedType: "NUMBER" },
    { targetField: "currency", sourceColumn: "currency", selectedType: "TEXT" },
    { targetField: "created_at", sourceColumn: "created_at", selectedType: "TIMESTAMP" },
    { targetField: "updated_at", sourceColumn: "updated_at", selectedType: "TIMESTAMP" }
  ];
  const sourceIdentitySelection = { sourceColumn: "source_id" };
  resources.phase = "DATA_HEALTH";
  const analysis = await request(
    baseUrl,
    "POST",
    `/api/import-batches/${batchId}/analysis`,
    { selections, sourceIdentitySelection },
    headersA
  );
  expect(analysis.status, 200);
  expect(analysis.data.data.dataHealth.totalRows, 1);
  expect(analysis.data.data.dataHealth.validRows, 1);
  expect(analysis.data.data.dataHealth.rowsWithBlockingErrors, 0);

  resources.phase = "CANONICAL_COMMIT";
  const committed = await request(
    baseUrl,
    "POST",
    `/api/import-batches/${batchId}/commit`,
    {
      sourceSystem: "assisted-pilot-acceptance",
      idempotencyKey: "assisted-pilot-acceptance-v1",
      sourceIdentitySelection,
      selections
    },
    headersA
  );
  expect(committed.status, 200);
  expect(committed.data.data.outcome, "COMMITTED");
  expect(committed.data.data.summary.committed, 1);

  const opportunities = await request(baseUrl, "GET", "/api/opportunities", undefined, headersA);
  expect(opportunities.status, 200);
  expect(opportunities.data.count, 1);
  expect(opportunities.data.data[0].id, opportunityId);
  expect(opportunities.data.data[0].currency, "AUD");
  expect(String(opportunities.data.data[0].value), "42000.5");

  resources.phase = "STALLED_SCAN";
  const scan = await request(
    baseUrl,
    "POST",
    "/api/revenue-leak-cases/scan-stalled-opportunities",
    {},
    headersA
  );
  expect(scan.status, 200);
  expect(scan.data.summary.total_opportunities, 1);
  expect(scan.data.summary.reconciliation.detected_count, 1);
  resources.phase = "OPERATING_QUEUE";
  const queue = await request(
    baseUrl,
    "GET",
    "/api/revenue-leak-cases/operating-queue",
    undefined,
    headersA
  );
  expect(queue.status, 200);
  expect(queue.data.data.total_cases, 1);
  expect(queue.data.data.entries[0].opportunity.id, opportunityId);
  expect(queue.data.data.entries[0].potential_value.currency, "AUD");
  const caseId = queue.data.data.entries[0].case.id;

  resources.phase = "CASE_HANDOFF";
  const handoff = await request(
    baseUrl,
    "POST",
    `/api/revenue-leak-cases/${caseId}/revenue-action`,
    {},
    headersA
  );
  expect(handoff.status, 201);
  expect(handoff.data.handoff.action_created, true);
  expect(handoff.data.data.case.id, caseId);
  const actionId = handoff.data.data.revenue_action.id;
  expect(handoff.data.data.case.revenue_action_id, actionId);
  expect(handoff.data.data.revenue_action.execution_type, "INTERNAL_TASK");

  resources.phase = "ACTION_LIFECYCLE";
  const prepared = await request(
    baseUrl,
    "POST",
    `/api/revenue-actions/${actionId}/prepare`,
    {},
    headersA
  );
  expect(prepared.status, 200);
  expect(prepared.data.data.status, "PREPARED");
  const approved = await request(
    baseUrl,
    "POST",
    `/api/revenue-actions/${actionId}/approve`,
    {},
    headersA
  );
  expect(approved.status, 200);
  expect(approved.data.data.status, "APPROVED");
  const executed = await request(
    baseUrl,
    "POST",
    `/api/revenue-actions/${actionId}/execute`,
    {},
    headersA
  );
  expect(executed.status, 200);
  expect(executed.data.data.status, "EXECUTED");
  expect(executed.data.data.execution_result.mode, "SYSTEM_INTERNAL");
  expect(executed.data.data.execution_result.external_send_performed, false);
  const taskId = executed.data.data.resulting_task_id;
  const activityId = executed.data.data.resulting_activity_id;
  expect(typeof taskId === "string" && taskId.length > 0, true);
  expect(typeof activityId === "string" && activityId.length > 0, true);

  resources.phase = "DURABLE_EFFECTS";
  const [durableCase, durableAction, tasks, activities] = await Promise.all([
    request(baseUrl, "GET", `/api/revenue-leak-cases/${caseId}`, undefined, headersA),
    request(baseUrl, "GET", `/api/revenue-actions/${actionId}`, undefined, headersA),
    request(baseUrl, "GET", `/api/tasks/opportunity/${opportunityId}`, undefined, headersA),
    request(baseUrl, "GET", `/api/opportunities/${opportunityId}/activities`, undefined, headersA)
  ]);
  expect(durableCase.status, 200);
  expect(durableCase.data.data.id, caseId);
  expect(durableAction.status, 200);
  expect(durableAction.data.data.id, actionId);
  expect(tasks.data.data.some(task => task.id === taskId), true);
  expect(activities.data.data.some(activity => activity.id === activityId), true);

  resources.phase = "SECOND_TENANT_ISOLATION";
  const [hiddenPreview, hiddenAction, tenantBQueue, tenantBOpportunities] = await Promise.all([
    request(baseUrl, "GET", `/api/import-batches/${batchId}/preview`, undefined, headersB),
    request(baseUrl, "GET", `/api/revenue-actions/${actionId}`, undefined, headersB),
    request(baseUrl, "GET", "/api/revenue-leak-cases/operating-queue", undefined, headersB),
    request(baseUrl, "GET", "/api/opportunities", undefined, headersB)
  ]);
  expect(hiddenPreview.status, 404);
  expect(hiddenPreview.data.error, "IMPORT_BATCH_UNAVAILABLE");
  expect(hiddenAction.status, 404);
  expect(hiddenAction.data.error, "REVENUE_ACTION_NOT_FOUND");
  expect(tenantBQueue.status, 200);
  expect(tenantBQueue.data.data.total_cases, 0);
  expect(tenantBOpportunities.status, 200);
  expect(tenantBOpportunities.data.count, 0);

  return {
    initialReadiness: "NOT_READY",
    secureReadiness: "READY",
    authentication: DETERMINISTIC_VERIFIER_LABEL,
    membershipAuthority: "VERIFIED",
    forgedClientTenant: "REJECTED",
    secondTenantIsolation: "VERIFIED",
    previewRows: 1,
    validRows: 1,
    blockingRows: 0,
    committedRows: 1,
    authoritativeCurrency: "AUD",
    evaluatedCount: 1,
    detectedCount: 1,
    queueCount: 1,
    rankedFirst: queue.data.data.entries[0].case.id === caseId,
    actionStatus: "EXECUTED",
    executionMode: "SYSTEM_INTERNAL",
    effectType: "INTERNAL_TASK",
    durableCaseId: durableCase.data.data.id === caseId,
    durableActionId: durableAction.data.data.id === actionId,
    durableTaskId: tasks.data.data.some(task => task.id === taskId),
    durableActivityId: activities.data.data.some(activity => activity.id === activityId),
    externalSendPerformed: false
  };
}

export async function cleanupAcceptanceResources(resources) {
  let database = resources.databaseName ? "FAILED" : "REMOVED";
  let runtimeLogin = resources.runtimeRole ? "FAILED" : "REMOVED";
  let migrationRoles = resources.migrationRoleOwnershipToken ? "FAILED" : "REMOVED";

  let runtimeClosed = false;
  if (resources.runtime) {
    try {
      await resources.runtime.close();
      runtimeClosed = true;
    } catch {
      // Continue to the operator cleanup boundary.
    }
    resources.runtime = null;
  }
  if (resources.runtimePool) {
    if (!runtimeClosed) {
      try {
        await resources.runtimePool.end();
      } catch {
        // Continue to the operator cleanup boundary.
      }
    }
    resources.runtimePool = null;
  }
  if (resources.databaseClient) {
    try {
      await resources.databaseClient.end();
    } catch {
      // Continue to the operator cleanup boundary.
    }
    resources.databaseClient = null;
  }

  let operatorClient = resources.operatorClient;
  if (!operatorClient) {
    const pg = await import("pg");
    operatorClient = new pg.default.Client({ connectionString: resources.operatorUrl });
    await operatorClient.connect();
  }
  try {
    if (resources.databaseName) {
      try {
        await operatorClient.query(
          `select pg_terminate_backend(pid) from pg_stat_activity
           where datname = $1 and pid <> pg_backend_pid()`,
          [resources.databaseName]
        );
        await operatorClient.query(
          `drop database if exists ${quoteIdentifier(resources.databaseName)}`
        );
        const remaining = await operatorClient.query(
          "select 1 from pg_database where datname = $1",
          [resources.databaseName]
        );
        if (remaining.rows.length === 0) database = "REMOVED";
      } catch {
        database = "FAILED";
      }
    }

    if (resources.runtimeRole) {
      try {
        await operatorClient.query(
          `drop role if exists ${quoteIdentifier(resources.runtimeRole)}`
        );
        const remaining = await operatorClient.query(
          "select 1 from pg_roles where rolname = $1",
          [resources.runtimeRole]
        );
        if (remaining.rows.length === 0) runtimeLogin = "REMOVED";
      } catch {
        runtimeLogin = "FAILED";
      }
    }

    if (resources.migrationRoleOwnershipToken) {
      try {
        const ownedRoles = await operatorClient.query(
          `select rolname,
                  shobj_description(oid, 'pg_authid') as ownership_marker
           from pg_roles
           where rolname = any($1::text[])`,
          [ACCEPTANCE_ROLE_NAMES]
        );
        const ownsCompleteRoleSet = ownedRoles.rows.length === ACCEPTANCE_ROLE_NAMES.length
          && ownedRoles.rows.every(
            row => ACCEPTANCE_ROLE_NAMES.includes(row.rolname)
              && row.ownership_marker === resources.migrationRoleOwnershipToken
          );
        if (!ownsCompleteRoleSet) throw new Error("Acceptance role ownership changed.");
        if (resources.operatorUser) {
          await operatorClient.query(
            `revoke tge_migrator from ${quoteIdentifier(resources.operatorUser)}`
          );
        }
        await operatorClient.query("revoke tge_owner from tge_migrator");
        for (const role of ["tge_maintenance", "tge_runtime", "tge_migrator", "tge_owner"]) {
          await operatorClient.query(`drop role ${quoteIdentifier(role)}`);
        }
        const remainingMigrationRoles = await operatorClient.query(
          "select rolname from pg_roles where rolname = any($1::text[])",
          [ACCEPTANCE_ROLE_NAMES]
        );
        if (remainingMigrationRoles.rows.length === 0) migrationRoles = "REMOVED";
      } catch {
        migrationRoles = "FAILED";
      }
    }
  } finally {
    if (resources.acceptanceLockHeld) {
      await operatorClient.query(
        "select pg_advisory_unlock(hashtext($1))",
        [ACCEPTANCE_ADVISORY_LOCK_KEY]
      ).catch(() => {});
      resources.acceptanceLockHeld = false;
    }
    await operatorClient.end().catch(() => {});
    resources.operatorClient = null;
  }

  return {
    database,
    runtime_login: runtimeLogin,
    migration_roles: migrationRoles
  };
}

async function request(baseUrl, method, pathname, body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Acceptance response was not JSON.");
  }
  return { status: response.status, data };
}

function replaceDatabase(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function replaceCredentials(connectionString, username, password) {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("Generated PostgreSQL identifier is invalid.");
  }
  return `"${value}"`;
}

function expect(actual, expected) {
  if (actual !== expected) throw new Error("Acceptance invariant failed.");
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  let interrupted = false;
  runAssistedPilotAcceptance({
    signalTarget: process,
    onSignal() {
      interrupted = true;
    }
  }).then(
    proof => process.stdout.write(`${JSON.stringify(proof)}\n`),
    error => {
      if (interrupted) return;
      const code = error instanceof AcceptanceConfigurationError
        ? error.code
        : "ASSISTED_PILOT_ACCEPTANCE_FAILED";
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    }
  );
}
