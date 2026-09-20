import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readMigrations } from "./migrate-db.mjs";

const { Client, Pool } = pg;
const require = createRequire(import.meta.url);
const { createPostgresRepositories } = require("../src/persistence/postgres/repositories");
const { createTenantContext } = require("../src/persistence/tenantContext");
const LOCAL_MODE = "LOCAL_LOGICAL_REHEARSAL";
const PROVIDER_MODE = "CLOUD_SQL_AU_ISOLATED_VERIFICATION";
const DISPOSABLE_ACK = "I_ACKNOWLEDGE_TARGET_DATABASE_IS_DISPOSABLE";
const PROVIDER_ACK = "APPROVED_CLOUD_SQL_AU_ISOLATED_RESTORE_TARGET";
const GENERIC_DATABASE_VARIABLES = Object.freeze([
  "DATABASE_URL",
  "POSTGRES_URL",
  "TGE_DATABASE_URL",
  "TGE_RUNTIME_DATABASE_URL",
  "TGE_MAINTENANCE_DATABASE_URL",
  "TGE_TEST_DATABASE_URL"
]);
const UNSAFE_DATABASE_NAMES = /^(postgres|template0|template1|prod|production|primary|main)$/i;
const MANIFEST_TABLES = Object.freeze([
  ["tenants", "id", "id"],
  ["tenant_memberships", "tenant_id", "identity_issuer, subject_id"],
  ["assisted_invitations", "tenant_id", "id"],
  ["prospects", "tenant_id", "id"],
  ["opportunities", "tenant_id", "id"],
  ["revenue_actions", "tenant_id", "id"],
  ["tasks", "tenant_id", "id"],
  ["activities", "tenant_id", "id"],
  ["revenue_leak_cases", "tenant_id", "id"],
  ["import_batches", "tenant_id", "id"],
  ["import_staging_records", "tenant_id", "import_batch_id, id"],
  ["import_id_map", "tenant_id", "import_batch_id, source_collection, source_id"],
  ["audit_events", "tenant_id", "id"],
  ["pilot_evidence_events", "tenant_id", "id"],
  ["data_deletion_evidence", "tenant_id", "id"],
  ["tenant_offboarding_requests", "tenant_id", "tenant_id"]
]);
const RUNTIME_SELECT_TABLES = Object.freeze(
  MANIFEST_TABLES.map(([table]) => table).filter(table => table !== "data_deletion_evidence")
);
const RUNTIME_SEQUENCE_NAMES = Object.freeze([
  "prospects_live_ordinal_seq",
  "opportunities_live_ordinal_seq",
  "tasks_live_ordinal_seq",
  "activities_live_ordinal_seq",
  "revenue_actions_live_ordinal_seq"
]);
const TABLE_PRIVILEGES = Object.freeze([
  "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"
]);
const RUNTIME_TABLE_PRIVILEGES = Object.freeze({
  tenants: Object.freeze(["SELECT"]),
  tenant_memberships: Object.freeze(["SELECT"]),
  assisted_invitations: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  prospects: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
  opportunities: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
  revenue_actions: Object.freeze(["SELECT", "INSERT"]),
  tasks: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
  activities: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
  revenue_leak_cases: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  import_batches: Object.freeze(["SELECT", "INSERT"]),
  import_staging_records: Object.freeze(["SELECT", "INSERT"]),
  import_id_map: Object.freeze(["SELECT", "INSERT"]),
  audit_events: Object.freeze(["SELECT", "INSERT"]),
  pilot_evidence_events: Object.freeze(["SELECT", "INSERT"]),
  data_deletion_evidence: Object.freeze([]),
  tenant_offboarding_requests: Object.freeze(["SELECT"])
});
const RUNTIME_REVENUE_ACTION_UPDATE_COLUMNS = Object.freeze([
  "status",
  "proposed_execution",
  "execution_request",
  "execution_result",
  "audit",
  "execution_attempts",
  "prepared_at",
  "approved_at",
  "executed_at",
  "rejected_at",
  "cancelled_at",
  "failed_at",
  "rejection_reason",
  "resulting_task_id",
  "resulting_activity_id",
  "updated_at"
]);
const RUNTIME_FUNCTION_SIGNATURES = Object.freeze([
  "consume_assisted_invitation(text, text, text, text, text)",
  "current_tenant_id()",
  "current_subject_id()",
  "set_request_context(uuid, text)",
  "current_identity_issuer()",
  "current_invitation_token_hash()",
  "set_identity_context(text, text)",
  "set_request_context(uuid, text, text)",
  "invitation_available(text)",
  "lock_import_commit_batch(uuid, text)",
  "lock_import_commit_records(uuid, text)",
  "record_import_commit_outcome(uuid, text, text, text, timestamp with time zone, jsonb)",
  "record_import_commit_attempt(uuid, text, jsonb, timestamp with time zone)",
  "finalize_import_commit(uuid, text, text, jsonb, timestamp with time zone)",
  "pilot_evidence_exact_keys(jsonb, text[])",
  "pilot_evidence_count(jsonb)",
  "pilot_evidence_bounded_id(jsonb, integer)",
  "pilot_evidence_facts_valid(text, jsonb)",
  "pilot_runtime_readiness()",
  "request_tenant_offboarding(text)",
  "lock_current_tenant_access_writable()",
  "record_import_commit_lifecycle_conflict(uuid, text, jsonb, timestamp with time zone)"
]);
const MAINTENANCE_FUNCTION_SIGNATURES = Object.freeze([
  "process_due_raw_import_cleanup(integer)",
  "process_pending_tenant_offboarding(integer)"
]);
const RPO_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const RTO_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);
const DEFAULT_SIGNAL_CLEANUP_TIMEOUT_MS = 10_000;
const DEFAULT_CHILD_TERMINATION_TIMEOUT_MS = 2_000;
const SAFE_URL_PARAMETERS = Object.freeze({
  application_name: new Set(["tge-backup-restore-proof"]),
  sslmode: new Set(["verify-full"])
});

export class BackupRestoreConfigurationError extends Error {
  constructor() {
    super("Backup/restore drill configuration is invalid.");
    this.name = "BackupRestoreConfigurationError";
    this.code = "BACKUP_RESTORE_CONFIGURATION_INVALID";
  }
}

export class BackupRestoreDrillError extends Error {
  constructor(phase) {
    super("Backup/restore drill failed.");
    this.name = "BackupRestoreDrillError";
    this.code = "BACKUP_RESTORE_DRILL_FAILED";
    this.phase = phase;
  }
}

export function readBackupRestoreConfig(env = process.env) {
  if (!env || GENERIC_DATABASE_VARIABLES.some(name => present(env[name]))) invalid();
  const mode = exact(env.TGE_BACKUP_RESTORE_MODE);
  if (![LOCAL_MODE, PROVIDER_MODE].includes(mode)) invalid();
  const source = buildPostgresAuthority(env.TGE_BACKUP_SOURCE_ADMIN_URL);
  const target = buildPostgresAuthority(env.TGE_RESTORE_TARGET_ADMIN_URL);
  const runtime = buildPostgresAuthority(env.TGE_RESTORE_TARGET_RUNTIME_URL);
  const maintenance = buildPostgresAuthority(env.TGE_RESTORE_TARGET_MAINTENANCE_URL);
  if (databaseIdentity(source) === databaseIdentity(target)) invalid();
  if (mode === LOCAL_MODE && source.database === target.database) invalid();
  if (databaseIdentity(runtime) !== databaseIdentity(target)) invalid();
  if (databaseIdentity(maintenance) !== databaseIdentity(target)) invalid();
  if (new Set([target.username, runtime.username, maintenance.username]).size !== 3) invalid();
  if (UNSAFE_DATABASE_NAMES.test(source.database) || UNSAFE_DATABASE_NAMES.test(target.database)) invalid();
  if (exact(env.TGE_BACKUP_RESTORE_DISPOSABLE_TARGET_ACK) !== DISPOSABLE_ACK) invalid();

  const drillId = exact(env.TGE_BACKUP_RESTORE_DRILL_ID);
  const tenantId = exact(env.TGE_BACKUP_RESTORE_TENANT_ID);
  const migrationId = exact(env.TGE_BACKUP_RESTORE_EXPECTED_MIGRATION_ID);
  const migrationChecksum = exact(env.TGE_BACKUP_RESTORE_EXPECTED_MIGRATION_CHECKSUM);
  const evidenceDirectory = exact(env.TGE_BACKUP_RESTORE_EVIDENCE_DIR);
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(drillId)) invalid();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) invalid();
  if (!/^\d{3}$/.test(migrationId) || !/^[0-9a-f]{64}$/.test(migrationChecksum)) invalid();
  if (!path.isAbsolute(evidenceDirectory) || /[\u0000-\u001f\u007f]/.test(evidenceDirectory)) invalid();

  const all = [source, target, runtime, maintenance];
  if (mode === LOCAL_MODE && all.some(value => !isLoopback(value.hostname))) invalid();
  if (mode === PROVIDER_MODE
    && exact(env.TGE_BACKUP_RESTORE_PROVIDER_APPROVAL) !== PROVIDER_ACK) invalid();

  const config = {
    mode,
    drillId,
    tenantId,
    expectedMigration: Object.freeze({ id: migrationId, checksum: migrationChecksum }),
    evidenceDirectory,
    source: publicDatabaseIdentity(source),
    target: publicDatabaseIdentity(target)
  };
  Object.defineProperty(config, "authorities", {
    enumerable: false,
    value: Object.freeze({
      sourceAdmin: source,
      targetAdmin: target,
      targetRuntime: runtime,
      targetMaintenance: maintenance
    })
  });
  return Object.freeze(config);
}

export async function runBackupRestoreDrill({
  env = process.env,
  commandRunner = runCommand,
  now = () => new Date(),
  signalTarget = null,
  signalCleanupTimeoutMs = DEFAULT_SIGNAL_CLEANUP_TIMEOUT_MS,
  teardown = teardownLocalTarget,
  remove = rm
} = {}) {
  const config = readBackupRestoreConfig(env);
  if (config.mode === PROVIDER_MODE) {
    const error = new BackupRestoreConfigurationError();
    error.code = "BACKUP_RESTORE_EXTERNAL_PROVIDER_ACTION_REQUIRED";
    throw error;
  }

  const startedAt = now();
  let phase = "PREFLIGHT";
  const lifecycle = createDrillResourceLifecycle({ config, teardown, remove });
  const signalLifecycle = signalTarget
    ? installBackupRestoreSignalLifecycle({
        target: signalTarget,
        cleanupOnce: lifecycle.cleanupOnce,
        timeoutMs: signalCleanupTimeoutMs
      })
    : null;
  let result;
  let primaryError;
  try {
    const repositoryLedger = await readMigrations();
    const terminalMigration = repositoryLedger.at(-1);
    if (terminalMigration?.id !== config.expectedMigration.id
      || terminalMigration?.checksum !== config.expectedMigration.checksum) {
      fail("REPOSITORY_MIGRATION_IDENTITY");
    }
    await mkdir(config.evidenceDirectory, { recursive: false, mode: 0o700 });
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "tge-backup-restore-"));
    const archivePath = path.join(temporaryDirectory, "full-database.dump");
    lifecycle.setTemporaryDirectory(temporaryDirectory, archivePath);

    const sourceClient = await connect(config.authorities.sourceAdmin, lifecycle);
    const targetClient = await connect(config.authorities.targetAdmin, lifecycle);
    let sourceLedger;
    let sourceManifest;
    let sourceObservedAt;
    let unrelatedTenantId;
    let unrelatedMembership;
    let selectedMembership;
    let committedBatchId;
    let offboardingTenantId;
    let offboardingMembership;
    let offboardingRequestId;
    try {
      await assertServerVersion(sourceClient);
      await assertServerVersion(targetClient);
      await assertTargetEmpty(targetClient);
      lifecycle.validateDisposableTarget();
      await assertClusterRoleContract(sourceClient);
      await assertManifestCatalog(sourceClient);
      sourceLedger = await readAndVerifyLedger(
        sourceClient,
        repositoryLedger
      );
      const sourceContext = await readSourceContext(sourceClient, config.tenantId);
      sourceObservedAt = sourceContext.observedAt;
      unrelatedTenantId = sourceContext.unrelatedTenantId;
      unrelatedMembership = sourceContext.unrelatedMembership;
      selectedMembership = sourceContext.selectedMembership;
      committedBatchId = sourceContext.committedBatchId;
      offboardingTenantId = sourceContext.offboardingTenantId;
      offboardingMembership = sourceContext.offboardingMembership;
      offboardingRequestId = sourceContext.offboardingRequestId;
      sourceManifest = await buildTenantManifest(sourceClient, config.tenantId);
    } finally {
      await Promise.all([
        closeTrackedClient(lifecycle, sourceClient),
        closeTrackedClient(lifecycle, targetClient)
      ]);
    }

    phase = "BACKUP";
    await commandRunner("pg_dump", [
      "--format=custom",
      "--compress=9",
      "--no-password",
      `--file=${archivePath}`,
      `--dbname=${config.authorities.sourceAdmin.database}`
    ], { env: postgresCommandEnvironment(config.authorities.sourceAdmin), lifecycle });
    const archive = await readFile(archivePath);
    const archiveSha256 = sha256(archive);
    const backupCompletedAt = now();

    phase = "FULL_ISOLATED_RESTORE";
    const restoreStartedAt = now();
    await commandRunner("pg_restore", [
      "--exit-on-error",
      "--no-password",
      `--dbname=${config.authorities.targetAdmin.database}`,
      archivePath
    ], { env: postgresCommandEnvironment(config.authorities.targetAdmin), lifecycle });

    phase = "VERIFY_FULL_RESTORE_BEFORE_TRAFFIC";
    const restoredAdmin = await connect(config.authorities.targetAdmin, lifecycle);
    try {
      const restoredLedger = await readAndVerifyLedger(
        restoredAdmin,
        repositoryLedger
      );
      assertSameLedger(sourceLedger, restoredLedger);
      await assertClusterRoleContract(restoredAdmin);
      await assertManifestCatalog(restoredAdmin);
      const restoredManifest = await buildTenantManifest(
        restoredAdmin,
        config.tenantId
      );
      assertSameManifest(sourceManifest, restoredManifest);
    } finally {
      await closeTrackedClient(lifecycle, restoredAdmin);
    }

    phase = "DUE_CLEANUP_BEFORE_TRAFFIC";
    const cleanup = await runDueCleanup(
      config.authorities.targetMaintenance,
      offboardingRequestId,
      lifecycle
    );

    phase = "VERIFY_RESTORED_DATABASE";
    const targetAdmin = await connect(config.authorities.targetAdmin, lifecycle);
    let targetLedger;
    let targetManifest;
    let adminChecks;
    try {
      targetLedger = await readAndVerifyLedger(targetAdmin, repositoryLedger);
      assertSameLedger(sourceLedger, targetLedger);
      targetManifest = await buildTenantManifest(targetAdmin, config.tenantId);
      adminChecks = await runAdministrativeVerification(
        targetAdmin,
        config.tenantId,
        unrelatedTenantId,
        offboardingTenantId,
        offboardingRequestId
      );
    } finally {
      await closeTrackedClient(lifecycle, targetAdmin);
    }
    const runtimeChecks = await runRuntimeVerification({
      runtimeAuthority: config.authorities.targetRuntime,
      tenantId: config.tenantId,
      unrelatedTenantId,
      unrelatedMembership,
      selectedMembership,
      committedBatchId,
      offboardingTenantId,
      offboardingMembership,
      lifecycle
    });
    const verifiedAt = now();
    const backupAgeMs = verifiedAt.getTime() - sourceObservedAt.getTime();
    const restoreToVerifiedMs = verifiedAt.getTime() - restoreStartedAt.getTime();
    if (backupAgeMs < 0 || backupAgeMs > RPO_THRESHOLD_MS) fail("RPO");
    if (restoreToVerifiedMs < 0 || restoreToVerifiedMs > RTO_THRESHOLD_MS) fail("RTO");

    phase = "SAFE_TEARDOWN";
    await lifecycle.deleteArchive();
    await lifecycle.removeTarget();

    phase = "RECORD_REDACTED_EVIDENCE";
    const tenantReference = sha256(config.tenantId);
    const manifest = Object.freeze({
      artifact_version: 1,
      artifact_type: "PRIVACY_MINIMIZED_LOGICAL_TENANT_MANIFEST",
      tenant_reference_sha256: tenantReference,
      migration: config.expectedMigration,
      tables: targetManifest.tables
    });
    const proof = Object.freeze({
      artifact_version: 1,
      proof_label: "LOCAL_SYNTHETIC_LOGICAL_REHEARSAL",
      live_cloud_sql_readiness_proven: false,
      drill_id: config.drillId,
      started_at: startedAt.toISOString(),
      completed_at: verifiedAt.toISOString(),
      selected_tenant_reference_sha256: tenantReference,
      backup: {
        kind: "FULL_POSTGRESQL_CUSTOM_ARCHIVE",
        sha256: archiveSha256,
        created_at: backupCompletedAt.toISOString(),
        sensitive_archive_deleted: lifecycle.archiveDeleted
      },
      recovery_objectives: {
        rpo_threshold_hours: 24,
        backup_age_ms: backupAgeMs,
        rpo_met: true,
        rto_threshold_business_hours: 4,
        restore_to_verified_ms: restoreToVerifiedMs,
        rto_met: true,
        measurement_scope: "LOCAL_SYNTHETIC_WALL_CLOCK_ONLY"
      },
      verification: {
        full_database_restore: "VERIFIED",
        migration_ledger_and_checksums: "VERIFIED",
        selected_tenant_manifest_match: "VERIFIED",
        authoritative_money_currency_classification: adminChecks.money,
        relationship_integrity: adminChecks.relationships,
        no_external_send: adminChecks.noExternalSend,
        runtime_nonprivileged_forced_rls: runtimeChecks.roleAndRls,
        own_tenant_journey: runtimeChecks.ownTenant,
        forged_cross_tenant_denial: runtimeChecks.crossTenant,
        unrelated_tenant_isolation: runtimeChecks.unrelatedTenant,
        expired_raw_unavailable_scrubbed: cleanup.rawCleanup,
        offboarded_access_cannot_reopen: runtimeChecks.offboarded,
        tenant_export_kind: "LOGICAL_MANIFEST_NOT_NATIVE_TENANT_RESTORE"
      },
      cleanup: {
        restored_database: lifecycle.targetRemoved ? "REMOVED" : "FAILED",
        sensitive_archive: lifecycle.archiveDeleted ? "REMOVED" : "FAILED",
        source_database: "UNCHANGED"
      },
      remaining_external_action:
        "FULL_CLOUD_SQL_AU_ISOLATED_RESTORE_AND_TEARDOWN_NOT_PERFORMED"
    });
    await writeJson(path.join(config.evidenceDirectory, "tenant-manifest.json"), manifest);
    await writeJson(path.join(config.evidenceDirectory, "drill-evidence.json"), proof);
    result = Object.freeze({
      status: "VERIFIED",
      proofLabel: proof.proof_label,
      evidenceDirectory: config.evidenceDirectory
    });
  } catch (error) {
    primaryError = error instanceof BackupRestoreConfigurationError
      ? error
      : new BackupRestoreDrillError(error?.phase || phase);
  } finally {
    signalLifecycle?.dispose();
    try {
      await lifecycle.cleanupOnce();
    } catch {
      throw new BackupRestoreDrillError(`CLEANUP_AFTER_${primaryError?.phase || phase}`);
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

async function readSourceContext(client, tenantId) {
  const result = await client.query(
    `select clock_timestamp() observed_at,
       exists (select 1 from tge.tenants where id = $1::uuid) selected_exists,
       (select tenant.id from tge.tenants tenant
         where tenant.id <> $1::uuid
           and tenant.metadata->>'offboarding_state' is distinct from 'OFFBOARDED_ACCESS_REVOKED'
           and exists (select 1 from tge.opportunities opportunity
             where opportunity.tenant_id = tenant.id)
           and not exists (select 1 from tge.tenant_offboarding_requests request
             where request.tenant_id = tenant.id)
         order by tenant.id limit 1) unrelated_tenant_id,
       (select identity_issuer from tge.tenant_memberships
         where tenant_id = $1::uuid and status = 'ACTIVE'
         order by identity_issuer, subject_id limit 1) identity_issuer,
       (select subject_id from tge.tenant_memberships
         where tenant_id = $1::uuid and status = 'ACTIVE'
         order by identity_issuer, subject_id limit 1) subject_id,
       (select id from tge.import_batches
         where tenant_id = $1::uuid and raw_expires_at <= clock_timestamp()
         order by raw_expires_at, id limit 1) expired_batch_id,
       (select id from tge.import_batches
         where tenant_id = $1::uuid and status = 'COMMITTED'
         order by id limit 1) committed_batch_id,
       (select tenant_id from tge.tenant_offboarding_requests
         where state = 'PENDING' order by tenant_id limit 1) offboarding_tenant_id,
       (select request_id from tge.tenant_offboarding_requests
         where state = 'PENDING' order by tenant_id limit 1) offboarding_request_id,
       exists(select 1 from tge.assisted_invitations invitation
         join tge.tenant_offboarding_requests request on request.tenant_id = invitation.tenant_id
         where request.state = 'PENDING' and invitation.status = 'PENDING') offboarding_invitation,
       exists(select 1 from tge.import_staging_records staging
         join tge.tenant_offboarding_requests request on request.tenant_id = staging.tenant_id
         where request.state = 'PENDING'
           and (staging.raw_payload is not null or staging.conflict_details is not null)) offboarding_raw`,
    [tenantId]
  );
  if (!result.rows[0].selected_exists || !result.rows[0].unrelated_tenant_id
    || !result.rows[0].identity_issuer || !result.rows[0].subject_id
    || !result.rows[0].expired_batch_id || !result.rows[0].committed_batch_id
    || !result.rows[0].offboarding_tenant_id || !result.rows[0].offboarding_request_id
    || !result.rows[0].offboarding_invitation || !result.rows[0].offboarding_raw) {
    fail("SOURCE_FIXTURE");
  }
  const memberships = await client.query(
    `select tenant_id, identity_issuer, subject_id from tge.tenant_memberships
     where tenant_id = any($1::uuid[]) and status = 'ACTIVE' and role = 'OWNER'
     order by tenant_id, identity_issuer, subject_id`,
    [[result.rows[0].unrelated_tenant_id, result.rows[0].offboarding_tenant_id]]
  );
  const membershipFor = id => memberships.rows.find(row => row.tenant_id === id);
  if (!membershipFor(result.rows[0].unrelated_tenant_id)
    || !membershipFor(result.rows[0].offboarding_tenant_id)) fail("SOURCE_FIXTURE");
  return {
    observedAt: new Date(result.rows[0].observed_at),
    unrelatedTenantId: result.rows[0].unrelated_tenant_id,
    selectedMembership: Object.freeze({
      identityIssuer: result.rows[0].identity_issuer,
      subjectId: result.rows[0].subject_id
    }),
    unrelatedMembership: Object.freeze({
      identityIssuer: membershipFor(result.rows[0].unrelated_tenant_id).identity_issuer,
      subjectId: membershipFor(result.rows[0].unrelated_tenant_id).subject_id
    }),
    offboardingMembership: Object.freeze({
      identityIssuer: membershipFor(result.rows[0].offboarding_tenant_id).identity_issuer,
      subjectId: membershipFor(result.rows[0].offboarding_tenant_id).subject_id
    }),
    committedBatchId: result.rows[0].committed_batch_id,
    offboardingTenantId: result.rows[0].offboarding_tenant_id,
    offboardingRequestId: result.rows[0].offboarding_request_id
  };
}

async function buildTenantManifest(client, tenantId) {
  const tables = {};
  for (const [table, tenantColumn, order] of MANIFEST_TABLES) {
    const result = await client.query(
      `select count(*)::integer row_count,
        encode(digest(coalesce(string_agg(
          encode(digest(to_jsonb(record)::text, 'sha256'), 'hex'),
          E'\\n' order by ${order}
        ), ''), 'sha256'), 'hex') sha256
       from tge.${table} record where ${tenantColumn} = $1::uuid`,
      [tenantId]
    );
    tables[table] = Object.freeze({
      row_count: result.rows[0].row_count,
      sha256: result.rows[0].sha256
    });
  }
  return Object.freeze({ tables: Object.freeze(tables) });
}

async function readAndVerifyLedger(client, expected) {
  const result = await client.query(
    `select migration_id, file_name, checksum
     from tge_migration.schema_migrations order by migration_id`
  );
  assertCompleteMigrationLedger(result.rows, expected);
  return result.rows;
}

export function assertCompleteMigrationLedger(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)
    || actual.length !== expected.length) {
    throw new Error("MIGRATION_LEDGER_INCOMPLETE");
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actualRow = actual[index];
    const expectedRow = expected[index];
    if (actualRow?.migration_id !== expectedRow?.id
      || actualRow?.file_name !== expectedRow?.fileName
      || actualRow?.checksum !== expectedRow?.checksum) {
      throw new Error("MIGRATION_LEDGER_MISMATCH");
    }
  }
}

async function runDueCleanup(authority, expectedOffboardingRequestId, lifecycle) {
  const client = await connect(authority, lifecycle);
  try {
    await assertMaintenanceRole(client);
    await client.query("begin");
    const raw = await client.query(
      "select * from tge.process_due_raw_import_cleanup($1::integer)",
      [100]
    );
    await client.query("commit");
    await client.query("begin");
    const offboarding = await client.query(
      "select * from tge.process_pending_tenant_offboarding($1::integer)",
      [100]
    );
    await client.query("commit");
    if (raw.rows.some(row => row.cleanup_state !== "SUCCEEDED")) fail("RAW_CLEANUP");
    if (offboarding.rows.some(row => row.state !== "OFFBOARDED_ACCESS_REVOKED")) {
      fail("OFFBOARDING_CLEANUP");
    }
    if (!offboarding.rows.some(row => row.request_id === expectedOffboardingRequestId)) {
      fail("OFFBOARDING_NOT_PROCESSED");
    }
    return Object.freeze({ rawCleanup: "VERIFIED_BEFORE_TRAFFIC" });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await closeTrackedClient(lifecycle, client);
  }
}

async function runAdministrativeVerification(
  client,
  tenantId,
  unrelatedTenantId,
  offboardingTenantId,
  offboardingRequestId
) {
  const money = await client.query(
    `select encode(digest(coalesce(string_agg(value, E'\\n' order by value), ''), 'sha256'), 'hex') digest
     from (
       select concat_ws('|', 'opportunity', id, commercial_value_state,
         coalesce(commercial_value::text, '<NULL>'), coalesce(currency, '<NULL>')) value
       from tge.opportunities where tenant_id = $1::uuid
       union all
       select concat_ws('|', 'case', id, commercial_value_classification,
         coalesce(revenue_at_risk::text, '<NULL>'), coalesce(currency, '<NULL>')) value
       from tge.revenue_leak_cases where tenant_id = $1::uuid
     ) monetary_truth`,
    [tenantId]
  );
  if (!/^[0-9a-f]{64}$/.test(money.rows[0].digest)) fail("MONEY");

  const integrity = await client.query(
    `select
       count(*) filter (where not constraint_record.convalidated)::integer unvalidated,
       count(*)::integer total
     from pg_catalog.pg_constraint constraint_record
     join pg_catalog.pg_namespace namespace
       on namespace.oid = constraint_record.connamespace
     where namespace.nspname = 'tge'
       and constraint_record.contype in ('p', 'u', 'f', 'c')`
  );
  if (integrity.rows[0].unvalidated !== 0 || integrity.rows[0].total < 1) fail("RELATIONSHIPS");

  const raw = await client.query(
    `select count(*)::integer unsafe
     from tge.import_batches batch
     left join tge.import_staging_records staging
       on staging.tenant_id = batch.tenant_id and staging.import_batch_id = batch.id
     where batch.raw_expires_at <= clock_timestamp()
       and (batch.raw_cleanup_state <> 'SUCCEEDED'
         or batch.source_filename <> '[deleted]'
         or batch.raw_storage_key is not null
         or staging.raw_payload is not null
         or staging.conflict_details is not null)`,
  );
  if (raw.rows[0].unsafe !== 0) fail("RAW_RETENTION");

  const offboarded = await client.query(
    `select count(*)::integer unsafe
     from tge.tenants tenant
     where tenant.metadata->>'offboarding_state' = 'OFFBOARDED_ACCESS_REVOKED'
       and (exists (select 1 from tge.tenant_memberships membership
             where membership.tenant_id = tenant.id and membership.status = 'ACTIVE')
         or exists (select 1 from tge.assisted_invitations invitation
             where invitation.tenant_id = tenant.id and invitation.status = 'PENDING'))`
  );
  if (offboarded.rows[0].unsafe !== 0) fail("OFFBOARDED_ACCESS");
  const offboardingProof = await client.query(
    `select request.state, request.request_id,
       tenant.metadata->>'offboarding_state' offboarding_state,
       (select count(*)::integer from tge.tenant_memberships membership
         where membership.tenant_id = request.tenant_id and membership.status = 'ACTIVE') active_memberships,
       (select count(*)::integer from tge.assisted_invitations invitation
         where invitation.tenant_id = request.tenant_id and invitation.status = 'PENDING') pending_invitations,
       (select count(*)::integer from tge.import_staging_records staging
         where staging.tenant_id = request.tenant_id
           and (staging.raw_payload is not null or staging.conflict_details is not null)) raw_rows
     from tge.tenant_offboarding_requests request
     join tge.tenants tenant on tenant.id = request.tenant_id
     where request.tenant_id = $1::uuid`,
    [offboardingTenantId]
  );
  const offboardedRow = offboardingProof.rows[0];
  if (!offboardedRow || offboardedRow.request_id !== offboardingRequestId
    || offboardedRow.state !== "OFFBOARDED_ACCESS_REVOKED"
    || offboardedRow.offboarding_state !== "OFFBOARDED_ACCESS_REVOKED"
    || offboardedRow.active_memberships !== 0 || offboardedRow.pending_invitations !== 0
    || offboardedRow.raw_rows !== 0) fail("OFFBOARDING_PROOF");
  const unrelated = await client.query(
    `select exists(select 1 from tge.tenant_memberships
       where tenant_id = $1::uuid and status = 'ACTIVE') active_access,
       exists(select 1 from tge.opportunities where tenant_id = $1::uuid) actual_data`,
    [unrelatedTenantId]
  );
  if (!unrelated.rows[0].active_access || !unrelated.rows[0].actual_data) {
    fail("UNRELATED_TENANT_INTACT");
  }
  const pendingOffboarding = await client.query(
    `select count(*)::integer pending
     from tge.tenant_offboarding_requests
     where state in ('PENDING', 'IN_PROGRESS', 'FAILED')`
  );
  if (pendingOffboarding.rows[0].pending !== 0) fail("OFFBOARDING_PENDING");

  const sends = await client.query(
    `select
       (select count(*) from tge.activities
         where jsonb_path_exists(metadata, '$.**.external_send_performed ? (@ == true)'))
       + (select count(*) from tge.revenue_actions
         where (jsonb_path_exists(coalesce(execution_result, '{}'::jsonb), '$.**.external_send_performed ? (@ == true)')
           or jsonb_path_exists(coalesce(current_payload, '{}'::jsonb), '$.**.external_send_performed ? (@ == true)')))
       + (select count(*) from tge.pilot_evidence_events
         where jsonb_path_exists(facts, '$.**.external_send_performed ? (@ == true)'))
       as external_send_claims`
  );
  if (Number(sends.rows[0].external_send_claims) !== 0) fail("EXTERNAL_SEND");
  return Object.freeze({
    money: "EXACT_HASH_MATCH_NO_VALUES_RECORDED",
    relationships: "VALIDATED",
    noExternalSend: "VERIFIED"
  });
}

async function runRuntimeVerification({
  runtimeAuthority,
  tenantId,
  unrelatedTenantId,
  unrelatedMembership,
  selectedMembership,
  committedBatchId,
  offboardingTenantId,
  offboardingMembership,
  lifecycle
}) {
  const client = await connect(runtimeAuthority, lifecycle);
  try {
    const role = await client.query(
      `select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
        pg_has_role(session_user, 'tge_runtime', 'member') runtime_member
       from pg_roles where rolname = session_user`
    );
    const attributes = role.rows[0];
    if (!attributes || attributes.rolsuper || attributes.rolcreatedb
      || attributes.rolcreaterole || attributes.rolreplication
      || attributes.rolbypassrls || !attributes.runtime_member) fail("RUNTIME_ROLE");
    const readiness = await client.query("select * from tge.pilot_runtime_readiness()");
    if (readiness.rows[0]?.schema_version !== "016"
      || !readiness.rows[0]?.runtime_role_member
      || !readiness.rows[0]?.login_nonprivileged
      || !readiness.rows[0]?.required_relations_available) fail("RUNTIME_READINESS");
    await assertNoSetRole(client, ["tge_owner", "tge_migrator", "tge_maintenance"]);
    const privileges = await client.query(
      `select
        has_schema_privilege(session_user, 'tge', 'USAGE') schema_usage,
        has_schema_privilege(session_user, 'tge', 'CREATE') schema_create,
        has_table_privilege(session_user, 'tge.opportunities', 'SELECT') opportunity_select,
        has_table_privilege(session_user, 'tge.opportunities', 'TRUNCATE') opportunity_truncate,
        has_function_privilege(session_user, 'tge.set_request_context(uuid,text,text)', 'EXECUTE') context_execute,
        has_function_privilege(session_user, 'tge.pilot_runtime_readiness()', 'EXECUTE') readiness_execute,
        has_schema_privilege(session_user, 'tge_migration', 'USAGE') migration_schema_usage,
        (select has_table_privilege(session_user, ledger.oid, 'SELECT')
          from pg_class ledger join pg_namespace namespace on namespace.oid = ledger.relnamespace
          where namespace.nspname = 'tge_migration'
            and ledger.relname = 'schema_migrations') ledger_select,
        has_function_privilege(session_user, 'tge.process_due_raw_import_cleanup(integer)', 'EXECUTE') maintenance_execute,
        (select count(*)::integer from (values ${RUNTIME_SELECT_TABLES.map(table => `('${table}')`).join(",")}) required(relname)
          where not has_table_privilege(session_user, format('tge.%I', required.relname), 'SELECT')) missing_select,
        (select count(*)::integer from (values ${RUNTIME_SEQUENCE_NAMES.map(name => `('${name}')`).join(",")}) required(relname)
          where not has_sequence_privilege(session_user, format('tge.%I', required.relname), 'USAGE')) missing_sequence_usage,
        (select count(*)::integer from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'tge' and relation.relkind in ('r','p')
            and (has_table_privilege(session_user, relation.oid, 'TRUNCATE')
              or has_table_privilege(session_user, relation.oid, 'REFERENCES')
              or has_table_privilege(session_user, relation.oid, 'TRIGGER'))) prohibited_table_grants,
        (select count(*)::integer from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname in ('tge', 'tge_migration')
            and pg_get_userbyid(relation.relowner) = session_user) owned_relations`
    );
    const privilege = privileges.rows[0];
    if (!privilege.schema_usage || !privilege.opportunity_select
      || !privilege.context_execute || !privilege.readiness_execute
      || privilege.missing_select !== 0 || privilege.missing_sequence_usage !== 0) {
      fail("RUNTIME_REQUIRED_GRANTS");
    }
    if (privilege.schema_create || privilege.opportunity_truncate
      || privilege.migration_schema_usage || privilege.ledger_select
      || privilege.maintenance_execute || privilege.prohibited_table_grants !== 0
      || privilege.owned_relations !== 0) fail("RUNTIME_PROHIBITED_GRANTS");
    const identity = await client.query("select session_user role_name");
    await assertEffectivePrivilegeContract(client, identity.rows[0].role_name, "runtime");
    const rls = await client.query(
      `select count(*)::integer missing
       from (values ${MANIFEST_TABLES.map(([table]) => `('${table}')`).join(",")}) required(relname)
       where not exists (
         select 1 from pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'tge'
           and relation.relname = required.relname
           and relation.relrowsecurity
           and relation.relforcerowsecurity
       )`
    );
    if (rls.rows[0].missing !== 0) fail("FORCED_RLS");

    await client.query("begin");
    await client.query(
      "select tge.set_request_context($1::uuid, $2::text, $3::text)",
      [tenantId, selectedMembership.identityIssuer, selectedMembership.subjectId]
    );
    const own = await client.query(
      "select array_agg(id order by id) tenant_ids from tge.tenants"
    );
    if (own.rows[0].tenant_ids?.length !== 1 || own.rows[0].tenant_ids[0] !== tenantId) {
      fail("OWN_TENANT");
    }
    await client.query("commit");
    const journey = await runRestoredRepositoryJourney({
      runtimeAuthority,
      tenantId,
      selectedMembership,
      unrelatedTenantId,
      unrelatedMembership,
      offboardingTenantId,
      offboardingMembership,
      committedBatchId,
      lifecycle
    });
    await client.query("begin");
    await client.query(
      "select tge.set_request_context($1::uuid, $2::text, $3::text)",
      [tenantId, selectedMembership.identityIssuer, selectedMembership.subjectId]
    );
    await client.query("savepoint forged_write");
    let crossTenantDenied = false;
    try {
      await client.query(
        `insert into tge.prospects (tenant_id, id, business_name)
         values ($1::uuid, 'forged-restore-proof', 'forged-restore-proof')`,
        [unrelatedTenantId]
      );
    } catch (error) {
      crossTenantDenied = error.code === "42501" || error.code === "23514";
      await client.query("rollback to savepoint forged_write");
    }
    if (!crossTenantDenied) fail("CROSS_TENANT");
    await client.query("rollback");
    return Object.freeze({
      roleAndRls: "VERIFIED",
      ownTenant: "VERIFIED",
      crossTenant: "DENIED",
      unrelatedTenant: journey.unrelated,
      offboarded: journey.offboarded
    });
  } finally {
    await client.query("rollback").catch(() => {});
    await closeTrackedClient(lifecycle, client);
  }
}

async function runRestoredRepositoryJourney({
  runtimeAuthority,
  tenantId,
  selectedMembership,
  unrelatedTenantId,
  unrelatedMembership,
  offboardingTenantId,
  offboardingMembership,
  committedBatchId,
  lifecycle
}) {
  const pool = new Pool(postgresClientOptions(runtimeAuthority));
  lifecycle.trackClient(pool);
  try {
    const repositories = createPostgresRepositories({ pool });
    const selected = createTenantContext({
      tenantId,
      identityIssuer: selectedMembership.identityIssuer,
      subjectId: selectedMembership.subjectId
    });
    const unrelated = createTenantContext({
      tenantId: unrelatedTenantId,
      identityIssuer: unrelatedMembership.identityIssuer,
      subjectId: unrelatedMembership.subjectId
    });
    const offboarded = createTenantContext({
      tenantId: offboardingTenantId,
      identityIssuer: offboardingMembership.identityIssuer,
      subjectId: offboardingMembership.subjectId
    });
    const prospects = await repositories.prospects.list(selected);
    const opportunities = await repositories.opportunities.list(selected);
    const tasks = await repositories.tasks.list(selected);
    const activities = await repositories.activities.list(selected);
    const actions = await repositories.revenueActions.list(selected);
    const cases = await repositories.revenueLeakCases.list(selected);
    const evidence = await repositories.pilotEvidence.list(selected);
    const committed = await repositories.imports.findCommit(selected, committedBatchId);
    if (prospects.length !== 1 || tasks.length !== 1 || activities.length !== 1
      || actions.length !== 1 || cases.length !== 2 || evidence.length !== 1
      || committed?.outcome !== "COMMITTED") fail("RESTORED_REPOSITORY_JOURNEY");
    const byId = new Map(opportunities.map(record => [record.id, record]));
    if (opportunities.length !== 3
      || byId.get("opp-known")?.value !== 123.45
      || byId.get("opp-known")?.currency !== "AUD"
      || byId.get("opp-zero")?.value !== 0
      || byId.get("opp-zero")?.currency !== "AUD"
      || Object.hasOwn(byId.get("opp-unknown") || {}, "value")
      || Object.hasOwn(byId.get("opp-unknown") || {}, "currency")) {
      fail("RESTORED_MONEY_CLASSIFICATION");
    }
    const caseById = new Map(cases.map(record => [record.id, record]));
    if (caseById.get("case-zero")?.commercial_value?.classification !== "KNOWN"
      || String(caseById.get("case-zero")?.commercial_value?.amount) !== "0"
      || caseById.get("case-zero")?.commercial_value?.currency !== "AUD"
      || caseById.get("case-unknown")?.commercial_value?.classification !== "UNKNOWN"
      || caseById.get("case-unknown")?.commercial_value?.amount !== null
      || caseById.get("case-unknown")?.commercial_value?.currency !== null) {
      fail("RESTORED_CASE_CLASSIFICATION");
    }
    if (await repositories.opportunities.findById(selected, "opp-b") !== null) {
      fail("FORGED_CROSS_TENANT_READ");
    }
    const unrelatedOpportunities = await repositories.opportunities.list(unrelated);
    if (unrelatedOpportunities.length !== 1
      || unrelatedOpportunities[0].id !== "opp-b"
      || await repositories.opportunities.findById(unrelated, "opp-known") !== null) {
      fail("UNRELATED_TENANT_JOURNEY");
    }
    const lookup = await pool.connect();
    try {
      await lookup.query("begin");
      await lookup.query(
        "select tge.set_identity_context($1::text, $2::text)",
        [offboardingMembership.identityIssuer, offboardingMembership.subjectId]
      );
      const membership = await lookup.query(
        `select count(*)::integer visible from tge.tenant_memberships
         where identity_issuer = $1 and subject_id = $2 and status = 'ACTIVE'`,
        [offboardingMembership.identityIssuer, offboardingMembership.subjectId]
      );
      if (membership.rows[0].visible !== 0) fail("OFFBOARD_AUTH_LOOKUP");
      await lookup.query("rollback");
    } finally {
      lookup.release();
    }
    if ((await repositories.opportunities.list(offboarded)).length !== 0) {
      fail("OFFBOARD_DATA_VISIBLE");
    }
    let offboardedDenied = false;
    try {
      await repositories.tenantOffboarding.request(offboarded, {
        confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
      });
    } catch (error) {
      offboardedDenied = error?.code === "42501" || error?.code === "23514";
    }
    if (!offboardedDenied) fail("OFFBOARD_REOPEN");
    return Object.freeze({ unrelated: "ACTIVE_DATA_ISOLATED", offboarded: "AUTH_LOOKUP_DENIED" });
  } finally {
    await closeTrackedClient(lifecycle, pool);
  }
}

async function assertNoSetRole(client, roleNames) {
  for (const roleName of roleNames) {
    await client.query("begin");
    let denied = false;
    try {
      await client.query(`set role ${quoteIdentifier(roleName)}`);
    } catch (error) {
      denied = error.code === "42501";
    } finally {
      await client.query("rollback");
    }
    if (!denied) fail("PROHIBITED_SET_ROLE");
  }
}

async function assertMaintenanceRole(client) {
  const role = await client.query(
    `select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
       pg_has_role(session_user, 'tge_maintenance', 'member') maintenance_member,
       pg_has_role(session_user, 'tge_runtime', 'member') runtime_member,
       pg_has_role(session_user, 'tge_migrator', 'member') migrator_member,
       pg_has_role(session_user, 'tge_owner', 'member') owner_member,
       (select count(*)::integer from pg_roles granted_role
         where granted_role.rolname not in (session_user, 'tge_maintenance')
           and pg_has_role(session_user, granted_role.oid, 'member')) other_memberships
     from pg_roles where rolname = session_user`
  );
  const row = role.rows[0];
  if (!row || row.rolsuper || row.rolcreatedb || row.rolcreaterole
    || row.rolreplication || row.rolbypassrls || !row.maintenance_member
    || row.runtime_member || row.migrator_member || row.owner_member
    || row.other_memberships !== 0) {
    fail("MAINTENANCE_ROLE");
  }
  await assertNoSetRole(client, ["tge_owner", "tge_migrator", "tge_runtime"]);
  const grants = await client.query(
    `select
       has_schema_privilege(session_user, 'tge', 'USAGE') schema_usage,
       has_schema_privilege(session_user, 'tge', 'CREATE') schema_create,
       has_table_privilege(session_user, 'tge.opportunities', 'SELECT') opportunity_select,
       (select count(*)::integer from pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname in ('tge', 'tge_migration')
           and pg_get_userbyid(relation.relowner) = session_user) owned_relations,
       has_function_privilege(session_user, 'tge.process_due_raw_import_cleanup(integer)', 'EXECUTE') raw_execute,
       has_function_privilege(session_user, 'tge.process_pending_tenant_offboarding(integer)', 'EXECUTE') offboard_execute`
  );
  const grant = grants.rows[0];
  if (!grant.schema_usage || grant.schema_create || grant.opportunity_select
    || grant.owned_relations !== 0 || !grant.raw_execute
    || !grant.offboard_execute) fail("MAINTENANCE_PRIVILEGES");
  const identity = await client.query("select session_user role_name");
  await assertEffectivePrivilegeContract(client, identity.rows[0].role_name, "maintenance");
}

async function assertClusterRoleContract(client) {
  const roles = await client.query(
    `select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls
     from pg_roles where rolname = any($1::text[]) order by rolname`,
    [["tge_owner", "tge_migrator", "tge_runtime", "tge_maintenance"]]
  );
  if (roles.rows.length !== 4 || roles.rows.some(role => role.rolcanlogin
    || role.rolsuper || role.rolcreatedb || role.rolcreaterole
    || role.rolreplication || role.rolbypassrls)) fail("CLUSTER_ROLE_PREREQUISITES");
  const memberships = await client.query(
    `select
       pg_has_role('tge_migrator', 'tge_owner', 'member') migrator_owner,
       pg_has_role('tge_runtime', 'tge_owner', 'member') runtime_owner,
       pg_has_role('tge_runtime', 'tge_migrator', 'member') runtime_migrator,
       pg_has_role('tge_runtime', 'tge_maintenance', 'member') runtime_maintenance,
       pg_has_role('tge_maintenance', 'tge_owner', 'member') maintenance_owner,
       pg_has_role('tge_maintenance', 'tge_migrator', 'member') maintenance_migrator,
       pg_has_role('tge_maintenance', 'tge_runtime', 'member') maintenance_runtime,
       (select count(*)::integer from pg_roles granted_role
         where granted_role.rolname not in ('tge_migrator', 'tge_owner')
           and pg_has_role('tge_migrator', granted_role.oid, 'member')) migrator_other,
       (select count(*)::integer from pg_roles granted_role
         where granted_role.rolname <> 'tge_owner'
           and pg_has_role('tge_owner', granted_role.oid, 'member')) owner_other`
  );
  const member = memberships.rows[0];
  if (!member.migrator_owner || member.runtime_owner || member.runtime_migrator
    || member.runtime_maintenance || member.maintenance_owner
    || member.maintenance_migrator || member.maintenance_runtime
    || member.migrator_other !== 0 || member.owner_other !== 0) {
    fail("CLUSTER_ROLE_MEMBERSHIP");
  }
  const ownership = await client.query(
    `select count(*)::integer incorrect from (
       select pg_get_userbyid(relation.relowner) owner
       from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'tge' and relation.relkind in ('r','p','S','v','m')
       union all
       select pg_get_userbyid(routine.proowner) owner
       from pg_proc routine join pg_namespace namespace on namespace.oid = routine.pronamespace
       where namespace.nspname = 'tge'
     ) owned where owner <> 'tge_owner'`
  );
  if (ownership.rows[0].incorrect !== 0) fail("OBJECT_OWNERSHIP");
  const migrator = await client.query(
    `select
       pg_get_userbyid(namespace.nspowner) migration_schema_owner,
       pg_get_userbyid(ledger.relowner) ledger_owner,
       has_schema_privilege('tge_migrator', 'tge_migration', 'USAGE') schema_usage,
       has_schema_privilege('tge_migrator', 'tge_migration', 'CREATE') schema_create
     from pg_namespace namespace
     join pg_class ledger on ledger.relnamespace = namespace.oid
       and ledger.relname = 'schema_migrations'
     where namespace.nspname = 'tge_migration'`
  );
  const migrationRole = migrator.rows[0];
  if (!migrationRole || migrationRole.migration_schema_owner !== "tge_migrator"
    || migrationRole.ledger_owner !== "tge_migrator"
    || !migrationRole.schema_usage || !migrationRole.schema_create) {
    fail("MIGRATOR_PRIVILEGES");
  }
  await assertEffectivePrivilegeContract(client, "tge_runtime", "runtime");
  await assertEffectivePrivilegeContract(client, "tge_maintenance", "maintenance");
}

async function assertManifestCatalog(client) {
  const result = await client.query(
    `select table_record.relname table_name,
       table_record.relrowsecurity,
       table_record.relforcerowsecurity,
       exists (
         select 1 from pg_attribute attribute
         where attribute.attrelid = table_record.oid
           and attribute.attname = 'tenant_id'
           and attribute.attnum > 0
           and not attribute.attisdropped
       ) tenant_bearing
     from pg_class table_record
     join pg_namespace namespace on namespace.oid = table_record.relnamespace
     where namespace.nspname = 'tge' and table_record.relkind in ('r','p')
     order by table_record.relname`
  );
  const expected = MANIFEST_TABLES.map(([table]) => table).sort();
  const tenantBearing = result.rows.filter(row => row.tenant_bearing)
    .map(row => row.table_name).sort();
  const expectedTenantBearing = expected.filter(table => table !== "tenants");
  if (JSON.stringify(tenantBearing) !== JSON.stringify(expectedTenantBearing)) {
    fail("MANIFEST_CATALOG_INCOMPLETE");
  }
  const expectedRows = result.rows.filter(row => expected.includes(row.table_name));
  if (expectedRows.length !== expected.length
    || expectedRows.some(row => !row.relrowsecurity || !row.relforcerowsecurity)) {
    fail("MANIFEST_RLS_INCOMPLETE");
  }
}

async function assertEffectivePrivilegeContract(client, roleName, kind) {
  const expectedTables = kind === "runtime" ? RUNTIME_TABLE_PRIVILEGES : Object.freeze({});
  const tables = await client.query(
    `select relation.relname table_name,
       ${TABLE_PRIVILEGES.map((privilege, index) =>
         `has_table_privilege($1::text, relation.oid, '${privilege}') privilege_${index}`
       ).join(",\n       ")}
     from pg_class relation
     join pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'tge' and relation.relkind in ('r','p')
     order by relation.relname`,
    [roleName]
  );
  for (const row of tables.rows) {
    const allowed = new Set(expectedTables[row.table_name] || []);
    for (const [index, privilege] of TABLE_PRIVILEGES.entries()) {
      if (Boolean(row[`privilege_${index}`]) !== allowed.has(privilege)) {
        fail(`${kind.toUpperCase()}_TABLE_PRIVILEGES`);
      }
    }
  }

  const sequences = await client.query(
    `select relation.relname sequence_name,
       has_sequence_privilege($1::text, relation.oid, 'USAGE') usage,
       has_sequence_privilege($1::text, relation.oid, 'SELECT') select_privilege,
       has_sequence_privilege($1::text, relation.oid, 'UPDATE') update_privilege
     from pg_class relation
     join pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'tge' and relation.relkind = 'S'
     order by relation.relname`,
    [roleName]
  );
  if (JSON.stringify(sequences.rows.map(row => row.sequence_name))
      !== JSON.stringify([...RUNTIME_SEQUENCE_NAMES].sort())) {
    fail("SEQUENCE_CATALOG");
  }
  for (const row of sequences.rows) {
    if (row.usage !== (kind === "runtime")
      || row.select_privilege || row.update_privilege) {
      fail(`${kind.toUpperCase()}_SEQUENCE_PRIVILEGES`);
    }
  }

  const routines = await client.query(
    `select routine.proname,
       pg_catalog.oidvectortypes(routine.proargtypes) identity_arguments,
       has_function_privilege($1::text, routine.oid, 'EXECUTE') execute
     from pg_proc routine
     join pg_namespace namespace on namespace.oid = routine.pronamespace
     where namespace.nspname = 'tge'
     order by routine.proname, pg_catalog.oidvectortypes(routine.proargtypes)`,
    [roleName]
  );
  const actualExecutable = routines.rows.filter(row => row.execute)
    .map(row => `${row.proname}(${row.identity_arguments})`).sort();
  const expectedExecutable = [...(kind === "runtime"
    ? RUNTIME_FUNCTION_SIGNATURES
    : MAINTENANCE_FUNCTION_SIGNATURES)].sort();
  if (JSON.stringify(actualExecutable) !== JSON.stringify(expectedExecutable)) {
    fail(`${kind.toUpperCase()}_FUNCTION_PRIVILEGES`);
  }

  const schemas = await client.query(
    `select
       has_schema_privilege($1::text, 'tge', 'USAGE') tge_usage,
       has_schema_privilege($1::text, 'tge', 'CREATE') tge_create,
       has_schema_privilege($1::text, 'tge_migration', 'USAGE') migration_usage,
       has_schema_privilege($1::text, 'tge_migration', 'CREATE') migration_create`,
    [roleName]
  );
  const schema = schemas.rows[0];
  if (!schema.tge_usage || schema.tge_create || schema.migration_usage || schema.migration_create) {
    fail(`${kind.toUpperCase()}_SCHEMA_PRIVILEGES`);
  }

  if (kind === "runtime") {
    const columns = await client.query(
      `select column_record.column_name,
         has_column_privilege($1::text, 'tge.revenue_actions', column_record.column_name, 'UPDATE') update
       from information_schema.columns column_record
       where column_record.table_schema = 'tge'
         and column_record.table_name = 'revenue_actions'
       order by column_record.column_name`,
      [roleName]
    );
    const actualUpdates = columns.rows.filter(row => row.update)
      .map(row => row.column_name).sort();
    if (JSON.stringify(actualUpdates)
      !== JSON.stringify([...RUNTIME_REVENUE_ACTION_UPDATE_COLUMNS].sort())) {
      fail("RUNTIME_REVENUE_ACTION_UPDATE_COLUMNS");
    }
  }
}

async function assertServerVersion(client) {
  const result = await client.query("show server_version");
  if (!/^16\.15(?:\s|$)/.test(result.rows[0].server_version)) fail("POSTGRES_VERSION");
}

async function assertTargetEmpty(client) {
  const result = await client.query(
    `select count(*)::integer relations
     from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname not in ('pg_catalog', 'information_schema')
       and namespace.nspname !~ '^pg_toast'
       and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`
  );
  if (result.rows[0].relations !== 0) fail("TARGET_NOT_EMPTY");
}

async function teardownLocalTarget(targetAuthority, targetDatabase) {
  const maintenance = clonePostgresAuthority(targetAuthority, { database: "postgres" });
  const client = await connect(maintenance);
  try {
    const current = await client.query("select current_database() database");
    if (current.rows[0].database !== "postgres" || UNSAFE_DATABASE_NAMES.test(targetDatabase)) {
      fail("TEARDOWN_SAFETY");
    }
    await client.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [targetDatabase]
    );
    await client.query(`drop database ${quoteIdentifier(targetDatabase)}`);
  } finally {
    await client.end();
  }
}

async function connect(authority, lifecycle) {
  const client = new Client(postgresClientOptions(authority));
  lifecycle?.trackClient(client);
  await client.connect();
  return client;
}

async function closeTrackedClient(lifecycle, client) {
  await client.end();
  lifecycle?.releaseClient(client);
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const lifecycle = options.lifecycle;
    const spawnOptions = { ...options };
    delete spawnOptions.lifecycle;
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      ...spawnOptions
    });
    lifecycle?.trackChild(child);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      if (stderr.length < 8192) stderr += chunk;
    });
    child.on("error", error => {
      lifecycle?.releaseChild(child);
      reject(error);
    });
    child.on("close", code => {
      lifecycle?.releaseChild(child);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 256)}`));
    });
  });
}

export function createDrillResourceLifecycle({
  config,
  teardown,
  remove,
  childTerminationTimeoutMs = DEFAULT_CHILD_TERMINATION_TIMEOUT_MS
}) {
  if (!Number.isInteger(childTerminationTimeoutMs) || childTerminationTimeoutMs < 1) {
    throw new TypeError("Invalid child termination timeout.");
  }
  const clients = new Set();
  const children = new Set();
  let temporaryDirectory;
  let archivePath;
  let targetValidatedDisposable = false;
  let targetRemoved = false;
  let archiveDeleted = false;
  let cleanupPromise;

  const api = {
    get targetRemoved() { return targetRemoved; },
    get archiveDeleted() { return archiveDeleted; },
    setTemporaryDirectory(directory, archive) {
      temporaryDirectory = directory;
      archivePath = archive;
    },
    validateDisposableTarget() { targetValidatedDisposable = true; },
    trackClient(client) { clients.add(client); },
    releaseClient(client) { clients.delete(client); },
    trackChild(child) { children.add(child); },
    releaseChild(child) { children.delete(child); },
    async deleteArchive() {
      if (!archivePath || archiveDeleted) return;
      await remove(archivePath, { force: true });
      archiveDeleted = true;
    },
    async removeTarget() {
      if (!targetValidatedDisposable || targetRemoved) return;
      await teardown(config.authorities.targetAdmin, config.target.database);
      targetRemoved = true;
    },
    cleanupOnce() {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        const failures = [];
        await Promise.all([...children].map(async child => {
          try {
            await terminateTrackedChild(child, childTerminationTimeoutMs);
            children.delete(child);
          } catch (error) {
            failures.push(error);
          }
        }));
        const closing = [...clients].map(async client => {
          try { await client.end(); } catch (error) { failures.push(error); }
        });
        await Promise.all(closing);
        clients.clear();
        if (children.size > 0) {
          throw new AggregateError(failures, "Backup/restore child cleanup failed.");
        }
        try { await api.deleteArchive(); } catch (error) { failures.push(error); }
        try { await api.removeTarget(); } catch (error) { failures.push(error); }
        if (temporaryDirectory) {
          try { await remove(temporaryDirectory, { recursive: true, force: true }); }
          catch (error) { failures.push(error); }
        }
        if (failures.length > 0) throw new AggregateError(failures, "Backup/restore cleanup failed.");
      })();
      return cleanupPromise;
    }
  };
  return Object.freeze(api);
}

async function terminateTrackedChild(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill("SIGTERM"); } catch (error) { throw error; }
  if (await waitForChildClose(child, timeoutMs)) return;
  try { child.kill("SIGKILL"); } catch (error) { throw error; }
  if (!await waitForChildClose(child, timeoutMs)) {
    throw new Error("Owned backup/restore child did not exit after escalation.");
  }
}

function waitForChildClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    let timer;
    const settle = exited => {
      if (timer) clearTimeout(timer);
      child.removeListener?.("close", onClose);
      child.removeListener?.("error", onError);
      resolve(exited);
    };
    const onClose = () => settle(true);
    const onError = () => settle(true);
    child.once("close", onClose);
    child.once("error", onError);
    if (child.exitCode !== null || child.signalCode !== null) settle(true);
    else timer = setTimeout(() => settle(false), timeoutMs);
  });
}

export function postgresCommandEnvironment(authority, baseEnv = process.env) {
  const environment = {
    ...(baseEnv.PATH ? { PATH: baseEnv.PATH } : {}),
    ...(baseEnv.TMPDIR ? { TMPDIR: baseEnv.TMPDIR } : {}),
    ...(baseEnv.LANG ? { LANG: baseEnv.LANG } : {}),
    ...(baseEnv.LC_ALL ? { LC_ALL: baseEnv.LC_ALL } : {}),
    PGHOST: authority.hostname,
    PGPORT: String(authority.port),
    PGUSER: authority.username,
    PGPASSWORD: authority.password,
    PGDATABASE: authority.database
  };
  if (authority.sslmode) environment.PGSSLMODE = authority.sslmode;
  if (authority.applicationName) environment.PGAPPNAME = authority.applicationName;
  return environment;
}

export function postgresClientOptions(authority) {
  return Object.freeze({
    host: authority.hostname,
    port: authority.port,
    user: authority.username,
    password: authority.password,
    database: authority.database,
    ...(authority.applicationName
      ? { application_name: authority.applicationName }
      : {}),
    ...(authority.sslmode === "verify-full"
      ? { ssl: Object.freeze({ rejectUnauthorized: true }) }
      : {})
  });
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
}

function assertSameLedger(source, target) {
  if (JSON.stringify(source) !== JSON.stringify(target)) fail("LEDGER_MISMATCH");
}

function assertSameManifest(source, target) {
  if (JSON.stringify(source) !== JSON.stringify(target)) fail("MANIFEST_MISMATCH");
}

export function buildPostgresAuthority(value) {
  const raw = exact(value);
  let url;
  try {
    url = new URL(raw);
  } catch {
    invalid();
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !url.hostname || !url.username || !url.password
    || url.hash || url.pathname.split("/").length !== 2) invalid();
  const seenParameters = new Set();
  for (const [name, parameterValue] of url.searchParams) {
    if (seenParameters.has(name)
      || !Object.hasOwn(SAFE_URL_PARAMETERS, name)
      || !SAFE_URL_PARAMETERS[name].has(parameterValue)) invalid();
    seenParameters.add(name);
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(database)) invalid();
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(username) || password.length === 0) invalid();
  const authority = {
    hostname: url.hostname.toLowerCase(),
    port: Number(url.port || 5432),
    username,
    database,
    sslmode: url.searchParams.get("sslmode") || null,
    applicationName: url.searchParams.get("application_name") || null
  };
  if (!Number.isInteger(authority.port) || authority.port < 1 || authority.port > 65535) invalid();
  Object.defineProperty(authority, "password", {
    enumerable: false,
    value: password
  });
  return Object.freeze(authority);
}

function clonePostgresAuthority(authority, overrides) {
  const clone = {
    hostname: overrides.hostname || authority.hostname,
    port: overrides.port || authority.port,
    username: overrides.username || authority.username,
    database: overrides.database || authority.database,
    sslmode: authority.sslmode,
    applicationName: authority.applicationName
  };
  Object.defineProperty(clone, "password", {
    enumerable: false,
    value: authority.password
  });
  return Object.freeze(clone);
}

export function installBackupRestoreSignalLifecycle({
  target,
  cleanupOnce,
  timeoutMs = DEFAULT_SIGNAL_CLEANUP_TIMEOUT_MS
}) {
  if (!target || typeof target.once !== "function"
    || typeof target.removeListener !== "function"
    || typeof target.kill !== "function"
    || typeof cleanupOnce !== "function"
    || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("Invalid signal lifecycle configuration.");
  }
  let handling = false;
  const handlers = new Map();
  const dispose = () => {
    for (const [signal, handler] of handlers) target.removeListener(signal, handler);
    handlers.clear();
  };
  for (const signal of SIGNALS) {
    const handler = async () => {
      if (handling) return;
      handling = true;
      let timer;
      try {
        await Promise.race([
          Promise.resolve().then(cleanupOnce),
          new Promise((resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Backup/restore cleanup deadline exceeded.")),
              timeoutMs
            );
          })
        ]);
      } catch (error) {
        target.stderr?.write?.("BACKUP_RESTORE_CLEANUP_FAILED\n");
      } finally {
        if (timer) clearTimeout(timer);
        dispose();
        target.kill(target.pid, signal);
      }
    };
    handlers.set(signal, handler);
    target.once(signal, handler);
  }
  return Object.freeze({ dispose });
}

function publicDatabaseIdentity(value) {
  return Object.freeze({
    hostname: value.hostname,
    port: value.port,
    username: value.username,
    database: value.database
  });
}

function databaseIdentity(value) {
  return `${value.hostname.toLowerCase()}:${value.port}/${value.database}`;
}

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "localhost";
}

function exact(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}

function present(value) {
  return value !== undefined && value !== null && String(value).length > 0;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invalid() {
  throw new BackupRestoreConfigurationError();
}

function fail(phase) {
  const error = new Error(phase);
  error.phase = phase;
  throw error;
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  runBackupRestoreDrill({ signalTarget: process }).then(result => {
    console.log(JSON.stringify(result));
  }).catch(error => {
    console.error(error?.code || "BACKUP_RESTORE_DRILL_FAILED");
    process.exitCode = 1;
  });
}
