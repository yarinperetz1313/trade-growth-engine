import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const RPO_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const RTO_THRESHOLD_MS = 4 * 60 * 60 * 1000;

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
  const source = parseDatabaseUrl(env.TGE_BACKUP_SOURCE_ADMIN_URL);
  const target = parseDatabaseUrl(env.TGE_RESTORE_TARGET_ADMIN_URL);
  const runtime = parseDatabaseUrl(env.TGE_RESTORE_TARGET_RUNTIME_URL);
  const maintenance = parseDatabaseUrl(env.TGE_RESTORE_TARGET_MAINTENANCE_URL);
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
  Object.defineProperty(config, "urls", {
    enumerable: false,
    value: Object.freeze({
      sourceAdmin: env.TGE_BACKUP_SOURCE_ADMIN_URL,
      targetAdmin: env.TGE_RESTORE_TARGET_ADMIN_URL,
      targetRuntime: env.TGE_RESTORE_TARGET_RUNTIME_URL,
      targetMaintenance: env.TGE_RESTORE_TARGET_MAINTENANCE_URL
    })
  });
  return Object.freeze(config);
}

export async function runBackupRestoreDrill({
  env = process.env,
  commandRunner = runCommand,
  now = () => new Date()
} = {}) {
  const config = readBackupRestoreConfig(env);
  if (config.mode === PROVIDER_MODE) {
    const error = new BackupRestoreConfigurationError();
    error.code = "BACKUP_RESTORE_EXTERNAL_PROVIDER_ACTION_REQUIRED";
    throw error;
  }

  const startedAt = now();
  let phase = "PREFLIGHT";
  let temporaryDirectory;
  let archivePath;
  let archiveDeleted = false;
  let targetRemoved = false;
  let targetValidatedDisposable = false;
  try {
    await mkdir(config.evidenceDirectory, { recursive: false, mode: 0o700 });
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "tge-backup-restore-"));
    archivePath = path.join(temporaryDirectory, "full-database.dump");

    const sourceClient = await connect(config.urls.sourceAdmin);
    const targetClient = await connect(config.urls.targetAdmin);
    let sourceLedger;
    let sourceManifest;
    let sourceObservedAt;
    let unrelatedTenantId;
    let selectedMembership;
    let expiredBatchId;
    try {
      await assertServerVersion(sourceClient);
      await assertServerVersion(targetClient);
      await assertTargetEmpty(targetClient);
      targetValidatedDisposable = true;
      sourceLedger = await readAndVerifyLedger(
        sourceClient,
        config.expectedMigration
      );
      const sourceContext = await readSourceContext(sourceClient, config.tenantId);
      sourceObservedAt = sourceContext.observedAt;
      unrelatedTenantId = sourceContext.unrelatedTenantId;
      selectedMembership = sourceContext.selectedMembership;
      expiredBatchId = sourceContext.expiredBatchId;
      sourceManifest = await buildTenantManifest(sourceClient, config.tenantId);
    } finally {
      await Promise.allSettled([sourceClient.end(), targetClient.end()]);
    }

    phase = "BACKUP";
    await commandRunner("pg_dump", [
      "--format=custom",
      "--compress=9",
      "--no-password",
      `--file=${archivePath}`,
      `--dbname=${passwordlessConnectionUrl(config.urls.sourceAdmin)}`
    ], { env: postgresCommandEnvironment(config.urls.sourceAdmin) });
    const archive = await readFile(archivePath);
    const archiveSha256 = sha256(archive);
    const backupCompletedAt = now();

    phase = "FULL_ISOLATED_RESTORE";
    const restoreStartedAt = now();
    await commandRunner("pg_restore", [
      "--exit-on-error",
      "--no-password",
      `--dbname=${passwordlessConnectionUrl(config.urls.targetAdmin)}`,
      archivePath
    ], { env: postgresCommandEnvironment(config.urls.targetAdmin) });

    phase = "VERIFY_FULL_RESTORE_BEFORE_TRAFFIC";
    const restoredAdmin = await connect(config.urls.targetAdmin);
    try {
      const restoredLedger = await readAndVerifyLedger(
        restoredAdmin,
        config.expectedMigration
      );
      assertSameLedger(sourceLedger, restoredLedger);
      const restoredManifest = await buildTenantManifest(
        restoredAdmin,
        config.tenantId
      );
      assertSameManifest(sourceManifest, restoredManifest);
    } finally {
      await restoredAdmin.end();
    }

    phase = "DUE_CLEANUP_BEFORE_TRAFFIC";
    const cleanup = await runDueCleanup(config.urls.targetMaintenance);

    phase = "VERIFY_RESTORED_DATABASE";
    const targetAdmin = await connect(config.urls.targetAdmin);
    let targetLedger;
    let targetManifest;
    let adminChecks;
    try {
      targetLedger = await readAndVerifyLedger(targetAdmin, config.expectedMigration);
      assertSameLedger(sourceLedger, targetLedger);
      targetManifest = await buildTenantManifest(targetAdmin, config.tenantId);
      adminChecks = await runAdministrativeVerification(
        targetAdmin,
        config.tenantId,
        unrelatedTenantId
      );
    } finally {
      await targetAdmin.end();
    }
    const runtimeChecks = await runRuntimeVerification({
      runtimeUrl: config.urls.targetRuntime,
      tenantId: config.tenantId,
      unrelatedTenantId,
      selectedMembership,
      expiredBatchId
    });
    const verifiedAt = now();
    const backupAgeMs = verifiedAt.getTime() - sourceObservedAt.getTime();
    const restoreToVerifiedMs = verifiedAt.getTime() - restoreStartedAt.getTime();
    if (backupAgeMs < 0 || backupAgeMs > RPO_THRESHOLD_MS) fail("RPO");
    if (restoreToVerifiedMs < 0 || restoreToVerifiedMs > RTO_THRESHOLD_MS) fail("RTO");

    await rm(archivePath, { force: true });
    archiveDeleted = true;
    await teardownLocalTarget(config.urls.targetAdmin, config.target.database);
    targetRemoved = true;

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
        sensitive_archive_deleted: archiveDeleted
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
        restored_database: targetRemoved ? "REMOVED" : "FAILED",
        sensitive_archive: archiveDeleted ? "REMOVED" : "FAILED",
        source_database: "UNCHANGED"
      },
      remaining_external_action:
        "FULL_CLOUD_SQL_AU_ISOLATED_RESTORE_AND_TEARDOWN_NOT_PERFORMED"
    });
    await writeJson(path.join(config.evidenceDirectory, "tenant-manifest.json"), manifest);
    await writeJson(path.join(config.evidenceDirectory, "drill-evidence.json"), proof);
    return Object.freeze({
      status: "VERIFIED",
      proofLabel: proof.proof_label,
      evidenceDirectory: config.evidenceDirectory
    });
  } catch (error) {
    if (error instanceof BackupRestoreConfigurationError) throw error;
    throw new BackupRestoreDrillError(error?.phase || phase);
  } finally {
    if (!archiveDeleted && archivePath) await rm(archivePath, { force: true }).catch(() => {});
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    if (!targetRemoved && targetValidatedDisposable && config.mode === LOCAL_MODE) {
      await teardownLocalTarget(config.urls.targetAdmin, config.target.database).catch(() => {});
    }
  }
}

async function readSourceContext(client, tenantId) {
  const result = await client.query(
    `select clock_timestamp() observed_at,
       exists (select 1 from tge.tenants where id = $1::uuid) selected_exists,
       (select id from tge.tenants
         where id <> $1::uuid
           and metadata->>'offboarding_state' = 'OFFBOARDED_ACCESS_REVOKED'
         order by id limit 1) unrelated_tenant_id,
       (select identity_issuer from tge.tenant_memberships
         where tenant_id = $1::uuid and status = 'ACTIVE'
         order by identity_issuer, subject_id limit 1) identity_issuer,
       (select subject_id from tge.tenant_memberships
         where tenant_id = $1::uuid and status = 'ACTIVE'
         order by identity_issuer, subject_id limit 1) subject_id,
       (select id from tge.import_batches
         where tenant_id = $1::uuid and raw_expires_at <= clock_timestamp()
         order by raw_expires_at, id limit 1) expired_batch_id`,
    [tenantId]
  );
  if (!result.rows[0].selected_exists || !result.rows[0].unrelated_tenant_id
    || !result.rows[0].identity_issuer || !result.rows[0].subject_id
    || !result.rows[0].expired_batch_id) {
    fail("SOURCE_FIXTURE");
  }
  return {
    observedAt: new Date(result.rows[0].observed_at),
    unrelatedTenantId: result.rows[0].unrelated_tenant_id,
    selectedMembership: Object.freeze({
      identityIssuer: result.rows[0].identity_issuer,
      subjectId: result.rows[0].subject_id
    }),
    expiredBatchId: result.rows[0].expired_batch_id
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
  const last = result.rows.at(-1);
  if (!last || last.migration_id !== expected.id || last.checksum !== expected.checksum) {
    fail("MIGRATION_IDENTITY");
  }
  return result.rows;
}

async function runDueCleanup(url) {
  const client = await connect(url);
  try {
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
    return Object.freeze({ rawCleanup: "VERIFIED_BEFORE_TRAFFIC" });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function runAdministrativeVerification(client, tenantId, unrelatedTenantId) {
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
  runtimeUrl,
  tenantId,
  unrelatedTenantId,
  selectedMembership,
  expiredBatchId
}) {
  const client = await connect(runtimeUrl);
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
    const expiredRaw = await client.query(
      `select count(*)::integer visible
       from tge.import_staging_records where import_batch_id = $1`,
      [expiredBatchId]
    );
    if (expiredRaw.rows[0].visible !== 0) fail("EXPIRED_RAW_VISIBLE");
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

    await client.query("begin");
    await client.query(
      "select tge.set_request_context($1::uuid, $2::text, $3::text)",
      [unrelatedTenantId, "urn:tge:restore-proof", "revoked-proof-subject"]
    );
    await client.query("savepoint reopen_attempt");
    let reopenDenied = false;
    try {
      await client.query(
        `insert into tge.assisted_invitations (
           tenant_id, token_hash, normalized_email, intended_role, status,
           created_by_subject_id, expires_at
         ) values ($1::uuid, $2, 'restore-proof@example.invalid', 'MEMBER',
           'PENDING', 'revoked-proof-subject', clock_timestamp() + interval '1 hour')`,
        [unrelatedTenantId, sha256("offboarded-reopen-attempt")]
      );
    } catch (error) {
      reopenDenied = error.code === "42501" || error.code === "23514";
      await client.query("rollback to savepoint reopen_attempt");
    }
    if (!reopenDenied) fail("OFFBOARD_REOPEN");
    await client.query("rollback");
    return Object.freeze({
      roleAndRls: "VERIFIED",
      ownTenant: "VERIFIED",
      crossTenant: "DENIED",
      unrelatedTenant: "ISOLATED",
      offboarded: "REOPEN_DENIED"
    });
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
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

async function teardownLocalTarget(targetUrl, targetDatabase) {
  const maintenance = new URL(targetUrl);
  maintenance.pathname = "/postgres";
  const client = await connect(maintenance.toString());
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

async function connect(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      ...options
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      if (stderr.length < 8192) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 256)}`));
    });
  });
}

function postgresCommandEnvironment(connectionString) {
  const url = new URL(connectionString);
  const environment = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1))
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) environment.PGSSLMODE = sslmode;
  return environment;
}

function passwordlessConnectionUrl(connectionString) {
  const url = new URL(connectionString);
  url.password = "";
  return url.toString();
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

function parseDatabaseUrl(value) {
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
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(database)) invalid();
  return {
    raw,
    hostname: url.hostname,
    port: url.port || "5432",
    username: url.username,
    database
  };
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
  runBackupRestoreDrill().then(result => {
    console.log(JSON.stringify(result));
  }).catch(error => {
    console.error(error?.code || "BACKUP_RESTORE_DRILL_FAILED");
    process.exitCode = 1;
  });
}
