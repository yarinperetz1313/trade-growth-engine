"use strict";

const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "../..");
const testDatabaseUrl = process.env.TGE_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test("backup/restore PostgreSQL proof requires TGE_TEST_DATABASE_URL", () => {
    assert.fail("TGE_TEST_DATABASE_URL is required for the real backup/restore gate");
  });
} else {
  const { Client } = require("pg");
  const sourceDatabase = `tge_backup_source_${compactUuid()}`;
  const targetDatabase = `tge_restore_target_${compactUuid()}`;
  const runtimeRole = `tge_restore_runtime_${compactUuid()}`;
  const maintenanceRole = `tge_restore_maintenance_${compactUuid()}`;
  const adminRole = `tge_restore_admin_${compactUuid()}`;
  const adminPassword = randomUUID();
  const runtimePassword = randomUUID();
  const maintenancePassword = randomUUID();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const operatorUrl = replaceDatabase(testDatabaseUrl, "postgres");
  const sourceUrl = replaceCredentials(
    replaceDatabase(testDatabaseUrl, sourceDatabase),
    adminRole,
    adminPassword
  );
  const targetUrl = replaceCredentials(
    replaceDatabase(testDatabaseUrl, targetDatabase),
    adminRole,
    adminPassword
  );
  const runtimeUrl = replaceCredentials(targetUrl, runtimeRole, runtimePassword);
  const maintenanceUrl = replaceCredentials(
    targetUrl,
    maintenanceRole,
    maintenancePassword
  );
  let operator;
  let evidenceDirectory;
  const retainedEvidenceDirectory = process.env.TGE_BACKUP_RESTORE_TEST_EVIDENCE_DIR;

  test.before(async () => {
    operator = new Client({ connectionString: operatorUrl });
    await operator.connect();
    const adminStatement = await operator.query(
      "select format('create role %I login password %L superuser createdb createrole', $1::text, $2::text) sql",
      [adminRole, adminPassword]
    );
    await operator.query(adminStatement.rows[0].sql);
    await operator.query(`create database ${quoteIdentifier(sourceDatabase)}`);
    await operator.query(`create database ${quoteIdentifier(targetDatabase)}`);
    const { runMigrations } = await import(
      pathToFileURL(path.join(repositoryRoot, "scripts", "migrate-db.mjs")).href
    );
    await runMigrations({ connectionString: sourceUrl, logger: { log() {} } });
    const source = new Client({ connectionString: sourceUrl });
    await source.connect();
    try {
      for (const [role, password, group] of [
        [runtimeRole, runtimePassword, "tge_runtime"],
        [maintenanceRole, maintenancePassword, "tge_maintenance"]
      ]) {
        const statement = await source.query(
          "select format('create role %I login password %L nosuperuser nocreatedb nocreaterole noreplication nobypassrls', $1::text, $2::text) sql",
          [role, password]
        );
        await source.query(statement.rows[0].sql);
        await source.query(`grant ${group} to ${quoteIdentifier(role)}`);
      }
      await seedSource(source, tenantA, tenantB);
    } finally {
      await source.end();
    }
    if (retainedEvidenceDirectory) {
      evidenceDirectory = retainedEvidenceDirectory;
      assert.equal(fs.existsSync(evidenceDirectory), false);
    } else {
      evidenceDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "tge-backup-restore-evidence-parent-")
      );
      fs.rmdirSync(evidenceDirectory);
    }
  });

  test.after(async () => {
    if (operator) {
      for (const database of [sourceDatabase, targetDatabase]) {
        await operator.query(
          "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
          [database]
        );
        await operator.query(`drop database if exists ${quoteIdentifier(database)}`);
      }
      await operator.query(`drop role if exists ${quoteIdentifier(runtimeRole)}`);
      await operator.query(`drop role if exists ${quoteIdentifier(maintenanceRole)}`);
      await operator.query(`drop role if exists ${quoteIdentifier(adminRole)}`);
      await operator.end();
    }
    if (evidenceDirectory && !retainedEvidenceDirectory) {
      fs.rmSync(evidenceDirectory, { recursive: true, force: true });
    }
  });

  test("full backup, isolated restore, verification, evidence, and teardown are real", async () => {
    const command = path.join(repositoryRoot, "scripts", "run-backup-restore-drill.mjs");
    const { runBackupRestoreDrill } = await import(pathToFileURL(command).href);
    const migration = fs.readFileSync(
      path.join(repositoryRoot, "database", "migrations", "016_authoritative_opportunity_currency.sql")
    );
    const env = {
      TGE_BACKUP_RESTORE_MODE: "LOCAL_LOGICAL_REHEARSAL",
      TGE_BACKUP_SOURCE_ADMIN_URL: sourceUrl,
      TGE_RESTORE_TARGET_ADMIN_URL: targetUrl,
      TGE_RESTORE_TARGET_RUNTIME_URL: runtimeUrl,
      TGE_RESTORE_TARGET_MAINTENANCE_URL: maintenanceUrl,
      TGE_BACKUP_RESTORE_DRILL_ID: "postgresql-16-15-proof",
      TGE_BACKUP_RESTORE_TENANT_ID: tenantA,
      TGE_BACKUP_RESTORE_EXPECTED_MIGRATION_ID: "016",
      TGE_BACKUP_RESTORE_EXPECTED_MIGRATION_CHECKSUM: sha256(migration),
      TGE_BACKUP_RESTORE_DISPOSABLE_TARGET_ACK:
        "I_ACKNOWLEDGE_TARGET_DATABASE_IS_DISPOSABLE",
      TGE_BACKUP_RESTORE_EVIDENCE_DIR: evidenceDirectory
    };

    const result = await runBackupRestoreDrill({ env });
    assert.deepEqual(result, {
      status: "VERIFIED",
      proofLabel: "LOCAL_SYNTHETIC_LOGICAL_REHEARSAL",
      evidenceDirectory
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(evidenceDirectory, "tenant-manifest.json"), "utf8")
    );
    const proofText = fs.readFileSync(
      path.join(evidenceDirectory, "drill-evidence.json"),
      "utf8"
    );
    const proof = JSON.parse(proofText);
    assert.equal(manifest.tables.tenants.row_count, 1);
    assert.equal(manifest.tables.opportunities.row_count, 3);
    assert.equal(manifest.tables.revenue_leak_cases.row_count, 2);
    assert.equal(manifest.tables.import_batches.row_count, 2);
    assert.equal(manifest.tables.data_deletion_evidence.row_count, 1);
    assert.equal(proof.verification.expired_raw_unavailable_scrubbed, "VERIFIED_BEFORE_TRAFFIC");
    assert.equal(proof.verification.offboarded_access_cannot_reopen, "REOPEN_DENIED");
    assert.equal(proof.cleanup.restored_database, "REMOVED");
    assert.equal(proof.recovery_objectives.rpo_met, true);
    assert.equal(proof.recovery_objectives.rto_met, true);
    for (const forbidden of [
      runtimePassword,
      maintenancePassword,
      adminPassword,
      "owner-a-subject",
      "owner@example.invalid",
      "Synthetic Customer A",
      "123.45",
      "source-private.csv",
      sourceUrl,
      targetUrl
    ]) assert.equal(proofText.includes(forbidden), false, forbidden);

    const database = await operator.query(
      "select exists(select 1 from pg_database where datname = $1) present",
      [targetDatabase]
    );
    assert.equal(database.rows[0].present, false);
  });
}

async function seedSource(client, tenantA, tenantB) {
  const h = value => sha256(value);
  await client.query(
    `insert into tge.tenants (id, slug, name, metadata) values
       ($1, 'synthetic-a', 'Synthetic Customer A', '{}'::jsonb),
       ($2, 'offboarded', 'Offboarded Synthetic',
        '{"offboarding_state":"OFFBOARDED_ACCESS_REVOKED"}'::jsonb)`,
    [tenantA, tenantB]
  );
  await client.query(
    `insert into tge.tenant_memberships
       (tenant_id, identity_issuer, subject_id, role, status)
     values ($1, 'urn:tge:synthetic', 'owner-a-subject', 'OWNER', 'ACTIVE')`,
    [tenantA]
  );
  await client.query(
    `insert into tge.assisted_invitations (
       tenant_id, token_hash, normalized_email, intended_role, status,
       created_by_subject_id, revoked_by_subject_id, expires_at, revoked_at
     ) values ($1, $2, 'owner@example.invalid', 'MEMBER', 'REVOKED',
       'owner-a-subject', 'owner-a-subject', clock_timestamp() + interval '1 day',
       clock_timestamp())`,
    [tenantA, h("revoked-invitation")]
  );
  await client.query(
    `insert into tge.prospects (tenant_id, id, business_name, email)
     values ($1, 'prospect-a', 'Synthetic Prospect', 'contact@example.invalid')`,
    [tenantA]
  );
  await client.query(
    `insert into tge.opportunities (
       tenant_id, id, prospect_id, business_name, stage,
       commercial_value, commercial_value_state, commercial_value_raw, currency
     ) values
       ($1, 'opp-known', 'prospect-a', 'Synthetic Known', 'OPEN', 123.45, 'KNOWN', '123.45'::jsonb, 'AUD'),
       ($1, 'opp-zero', 'prospect-a', 'Synthetic Zero', 'OPEN', 0, 'ZERO', '0'::jsonb, 'AUD'),
       ($1, 'opp-unknown', 'prospect-a', 'Synthetic Unknown', 'OPEN', null, 'MISSING', null, null)`,
    [tenantA]
  );
  await client.query(
    `insert into tge.revenue_actions (
       tenant_id, id, opportunity_id, action_type, execution_type,
       approval_requirement, risk_class, status, title, reason, evidence,
       recommendation_snapshot, basis_fingerprint, source, audit
     ) values ($1, 'action-a', 'opp-known', 'CREATE_TASK', 'INTERNAL_TASK',
       'HUMAN', 'INTERNAL', 'RECOMMENDED', 'Synthetic action', 'Synthetic reason',
       '{"factual":{},"derived":{}}'::jsonb, '{}'::jsonb, $2,
       'DEAL_INTELLIGENCE', '[]'::jsonb)`,
    [tenantA, h("action-basis")]
  );
  await client.query(
    `insert into tge.tasks
       (tenant_id, id, opportunity_id, title, status)
     values ($1, 'task-a', 'opp-known', 'Synthetic task', 'OPEN')`,
    [tenantA]
  );
  await client.query(
    `insert into tge.activities
       (tenant_id, id, opportunity_id, prospect_id, type, description)
     values ($1, 'activity-a', 'opp-known', 'prospect-a', 'NOTE', 'Synthetic activity')`,
    [tenantA]
  );
  await client.query(
    `insert into tge.revenue_leak_cases (
       tenant_id, id, leak_type, state, source_system, source_entity_type,
       source_entity_id, opportunity_id, source_observed_at,
       source_observed_version, detector_id, detector_version, reason_code,
       evidence_classification, evidence_snapshot, evidence_fingerprint,
       series_key, semantic_key, commercial_value_classification,
       revenue_at_risk, currency, recommended_action_type,
       supersession_condition, detected_at, updated_at, created_at, audit
     ) values
       ($1, 'case-zero', 'STALLED_OPPORTUNITY', 'OPEN', 'TGE', 'OPPORTUNITY',
        'opp-zero', 'opp-zero', '2026-09-01T00:00:00Z', 'v1', 'stalled', 'v1',
        'STALE', 'OBSERVED', '{"facts":{"stale":true},"classification":"OBSERVED"}',
        $2, $3, $4, 'KNOWN', 0, 'AUD', 'FOLLOW_UP', '{"kind":"changed"}',
        '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z',
        '[{"transition":"OPEN"}]'),
       ($1, 'case-unknown', 'STALLED_OPPORTUNITY', 'OPEN', 'TGE', 'OPPORTUNITY',
        'opp-unknown', 'opp-unknown', '2026-09-01T00:00:00Z', 'v1', 'stalled', 'v1',
        'STALE', 'OBSERVED', '{"facts":{"stale":true},"classification":"OBSERVED"}',
        $5, $6, $7, 'UNKNOWN', null, null, 'FOLLOW_UP', '{"kind":"changed"}',
        '2026-09-02T00:01:00Z', '2026-09-02T00:01:00Z', '2026-09-02T00:01:00Z',
        '[{"transition":"OPEN"}]')`,
    [tenantA, h("zero-evidence"), h("zero-series"), h("zero-semantic"),
      h("unknown-evidence"), h("unknown-series"), h("unknown-semantic")]
  );
  await client.query(
    `with moment as (select clock_timestamp() observed_at)
     insert into tge.import_batches (
       tenant_id, id, status, source_filename, source_sha256,
       authorized_by_subject_id, authorization_verified_at,
       raw_storage_key, raw_expires_at, metadata_retain_until,
       created_at, updated_at
     ) select $1, 'due-batch', 'PREVIEWED', 'source-private.csv', $2,
        'owner-a-subject', observed_at - interval '8 days', 'private/raw',
        observed_at - interval '1 day', observed_at + interval '12 months',
        observed_at - interval '8 days', observed_at - interval '8 days'
       from moment`,
    [tenantA, h("due-source")]
  );
  await client.query(
    `with moment as (select clock_timestamp() observed_at)
     insert into tge.import_batches (
       tenant_id, id, status, source_filename, source_sha256,
       authorized_by_subject_id, authorization_verified_at,
       commit_idempotency_key, commit_metadata, committed_at,
       raw_storage_key, raw_expires_at, metadata_retain_until,
       created_at, updated_at
     ) select $1, 'committed-batch', 'COMMITTED', 'committed-private.csv', $2,
       'owner-a-subject', observed_at, 'commit-key', '{}'::jsonb, observed_at,
       null, observed_at + interval '168 hours', observed_at + interval '12 months',
       observed_at, observed_at from moment`,
    [tenantA, h("committed-source")]
  );
  await client.query(
    `insert into tge.import_staging_records (
       tenant_id, import_batch_id, id, source_collection, source_id,
       source_ordinal, raw_payload, raw_payload_sha256, disposition,
       conflict_details, idempotency_key, committed_at
     ) values
       ($1, 'due-batch', 'staging-due', 'prospects', 'due-source', 0,
        '{"email":"private@example.invalid"}', $2, 'PENDING',
        '{"private":"value"}', 'due-idempotency', null),
       ($1, 'committed-batch', 'staging-committed', 'prospects', 'prospect-a', 0,
        null, $3, 'COMMITTED', null, 'committed-idempotency', clock_timestamp())`,
    [tenantA, h("due-raw"), h("committed-raw")]
  );
  await client.query(
    `insert into tge.import_id_map (
       tenant_id, import_batch_id, source_collection, source_id, source_ordinal,
       target_prospect_id
     ) values ($1, 'committed-batch', 'prospects', 'prospect-a', 0, 'prospect-a')`,
    [tenantA]
  );
  await client.query(
    `insert into tge.audit_events (
       tenant_id, id, event_type, subject_id, entity_type, entity_id,
       occurred_at, retain_until
     ) values ($1::uuid, 'audit-a', 'SYNTHETIC_RESTORE_PROOF', 'owner-a-subject',
       'TENANT', $1::uuid::text, clock_timestamp(), clock_timestamp() + interval '12 months')`,
    [tenantA]
  );
  await client.query(
    `insert into tge.pilot_evidence_events (
       tenant_id, id, event_type, actor_subject_id, occurred_at,
       semantic_key, facts, created_at
     ) values ($1, 'pilot-a', 'CASE_INSPECTED', 'owner-a-subject',
       '2026-09-03T00:00:00Z', $2,
       '{"case_id":"case-zero","import_batch_id":"committed-batch"}',
       '2026-09-03T00:00:00Z')`,
    [tenantA, h("pilot-semantic")]
  );
}

function replaceDatabase(connectionString, database) {
  const value = new URL(connectionString);
  value.pathname = `/${database}`;
  return value.toString();
}

function replaceCredentials(connectionString, username, password) {
  const value = new URL(connectionString);
  value.username = username;
  value.password = password;
  return value.toString();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function compactUuid() {
  return randomUUID().replaceAll("-", "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
