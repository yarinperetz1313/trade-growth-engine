"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const {
  createTenantContext
} = require("../../src/persistence/tenantContext");
const {
  createPostgresRepositories
} = require("../../src/persistence/postgres/repositories");

const databaseUrl = process.env.TGE_TEST_DATABASE_URL;
const root = path.resolve(__dirname, "../..");

if (!databaseUrl) {
  test("raw expiry/offboarding PostgreSQL tests require TGE_TEST_DATABASE_URL", () => {
    assert.fail("TGE_TEST_DATABASE_URL is required for the Slice 2 database authority gate");
  });
} else {
  const { Client, Pool } = require("pg");
  const databaseName = `tge_slice2_${randomUUID().replaceAll("-", "")}`;
  const runtimeRole = `tge_slice2_runtime_${randomUUID().replaceAll("-", "")}`;
  const maintenanceRole = `tge_slice2_maintenance_${randomUUID().replaceAll("-", "")}`;
  const runtimePassword = randomUUID();
  const maintenancePassword = randomUUID();
  const adminUrl = replaceDatabase(databaseUrl, databaseName);
  const controlUrl = replaceDatabase(databaseUrl, "postgres");
  const runtimeUrl = replaceCredentials(adminUrl, runtimeRole, runtimePassword);
  const maintenanceUrl = replaceCredentials(
    adminUrl,
    maintenanceRole,
    maintenancePassword
  );
  let control;
  let admin;
  let runtime;

  test.before(async () => {
    control = new Client({ connectionString: controlUrl });
    await control.connect();
    await control.query(`create database ${quoteIdentifier(databaseName)}`);
    const { runMigrations } = await import(pathToFileURL(
      path.join(root, "scripts/migrate-db.mjs")
    ));
    await runMigrations({ connectionString: adminUrl, logger: { log() {} } });
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await createLogin(admin, runtimeRole, runtimePassword);
    await createLogin(admin, maintenanceRole, maintenancePassword);
    await admin.query(`grant tge_runtime to ${quoteIdentifier(runtimeRole)}`);
    runtime = new Client({ connectionString: runtimeUrl });
    await runtime.connect();
  });

  test.after(async () => {
    await runtime?.end();
    await admin?.end();
    if (control) {
      await control.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [databaseName]
      );
      await control.query(`drop database if exists ${quoteIdentifier(databaseName)}`);
      await control.query(`drop role if exists ${quoteIdentifier(runtimeRole)}`);
      await control.query(`drop role if exists ${quoteIdentifier(maintenanceRole)}`);
      await control.end();
    }
  });

  test("runtime import timestamps are database-authored with one exact seven-day horizon", async () => {
    const tenant = await seedTenant("clock", "OWNER");
    const before = Date.now();
    const result = await withContext(runtime, tenant, () => runtime.query(
      `insert into tge.import_batches (
         tenant_id, id, status, source_filename, source_sha256,
         authorized_by_subject_id, authorization_verified_at, preview_summary,
         raw_expires_at, metadata_retain_until, created_at, updated_at
       ) values (
         $1, 'client-clock', 'PREVIEWED', 'private.csv', $2, $3,
         '2000-01-01T00:00:00Z', '{"rowCount":0,"sourceCollection":"prospects"}',
         '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z',
         '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'
       ) returning created_at, raw_expires_at, metadata_retain_until,
         raw_cleanup_state, raw_cleanup_attempts`,
      [tenant.id, "a".repeat(64), tenant.subject]
    ));
    const after = Date.now();
    const row = result.rows[0];
    assert.ok(row.created_at.valueOf() >= before && row.created_at.valueOf() <= after);
    assert.equal(
      row.raw_expires_at.valueOf() - row.created_at.valueOf(),
      7 * 24 * 60 * 60 * 1000
    );
    assert.ok(
      row.metadata_retain_until.valueOf() >= addMonths(row.created_at, 12).valueOf()
    );
    assert.equal(row.raw_cleanup_state, "PENDING");
    assert.equal(row.raw_cleanup_attempts, 0);
  });

  test("maintenance login has only connection, schema, and targetless processor authority", async () => {
    await grantMaintenance();
    const role = await admin.query(
      `select rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls,
         pg_has_role('tge_maintenance', 'tge_owner', 'member') owner_member,
         pg_has_role('tge_maintenance', 'tge_migrator', 'member') migrator_member,
         pg_has_role('tge_maintenance', 'tge_runtime', 'member') runtime_member
       from pg_roles where rolname = 'tge_maintenance'`
    );
    assert.deepEqual(role.rows[0], {
      rolcanlogin: false,
      rolinherit: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      owner_member: false,
      migrator_member: false,
      runtime_member: false
    });

    const maintenance = new Client({ connectionString: maintenanceUrl });
    await maintenance.connect();
    try {
      const privileges = await maintenance.query(
        `select
           has_database_privilege(current_user, current_database(), 'CONNECT') can_connect,
           has_schema_privilege(current_user, 'tge', 'USAGE') schema_usage,
           has_schema_privilege(current_user, 'tge', 'CREATE') schema_create,
           has_function_privilege(current_user,
             'tge.process_due_raw_import_cleanup(integer)', 'EXECUTE') raw_processor,
           has_function_privilege(current_user,
             'tge.process_pending_tenant_offboarding(integer)', 'EXECUTE') offboard_processor,
           (select count(*)::integer from pg_proc function_record
             join pg_namespace namespace_record
               on namespace_record.oid = function_record.pronamespace
             where namespace_record.nspname = 'tge'
               and has_function_privilege(
                 current_user, function_record.oid, 'EXECUTE'
               )) executable_functions,
           (select count(*)::integer from pg_class relation_record
             join pg_namespace namespace_record
               on namespace_record.oid = relation_record.relnamespace
             where namespace_record.nspname = 'tge'
               and relation_record.relkind in ('r', 'p', 'v', 'm', 'S')
               and has_table_privilege(
                 current_user,
                 relation_record.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               )) privileged_relations`
      );
      assert.deepEqual(privileges.rows[0], {
        can_connect: true,
        schema_usage: true,
        schema_create: false,
        raw_processor: true,
        offboard_processor: true,
        executable_functions: 2,
        privileged_relations: 0
      });
      await assert.rejects(
        maintenance.query("set role tge_owner"),
        error => error?.code === "42501"
      );
      await assert.rejects(
        maintenance.query("set role tge_migrator"),
        error => error?.code === "42501"
      );
      assert.deepEqual(
        (await maintenance.query(
          "select * from tge.process_due_raw_import_cleanup(1)"
        )).rows,
        []
      );
      assert.deepEqual(
        (await maintenance.query(
          "select * from tge.process_pending_tenant_offboarding(1)"
        )).rows,
        []
      );
      await assert.rejects(
        maintenance.query("select * from tge.import_batches"),
        error => error?.code === "42501"
      );
    } finally {
      await maintenance.end();
    }
  });

  test("exact 168-hour expiry survives both Melbourne DST boundaries", async () => {
    const tenant = await seedTenant("dst", "OWNER");
    await admin.query("set timezone to 'Australia/Melbourne'");
    try {
      for (const [id, createdAt, expiresAt] of [
        ["dst-autumn", "2026-04-01T00:00:00Z", "2026-04-08T00:00:00Z"],
        ["dst-spring", "2026-10-01T00:00:00Z", "2026-10-08T00:00:00Z"]
      ]) {
        await admin.query(
          `insert into tge.import_batches (
             tenant_id, id, status, source_filename, source_sha256,
             authorized_by_subject_id, authorization_verified_at,
             preview_summary, raw_expires_at, metadata_retain_until,
             created_at, updated_at
           ) values ($1, $2, 'PREVIEWED', 'dst.csv', $3, $4, $5,
             '{"rowCount":0,"sourceCollection":"prospects"}', $6,
             '2027-11-01T00:00:00Z', $5, $5)`,
          [tenant.id, id, "a".repeat(64), tenant.subject, createdAt, expiresAt]
        );
      }
      const horizons = await admin.query(
        `select id, extract(epoch from (raw_expires_at - created_at))::integer seconds
         from tge.import_batches where tenant_id = $1 order by id`,
        [tenant.id]
      );
      assert.deepEqual(horizons.rows, [
        { id: "dst-autumn", seconds: 604800 },
        { id: "dst-spring", seconds: 604800 }
      ]);
    } finally {
      await admin.query("set timezone to 'UTC'");
      await admin.query(
        "delete from tge.import_batches where tenant_id = $1",
        [tenant.id]
      );
    }
  });

  test("due raw cells are denied before cleanup while future and other-tenant evidence stays isolated", async () => {
    const dueTenant = await seedTenant("due", "OWNER");
    const otherTenant = await seedTenant("other", "OWNER");
    await seedImport(dueTenant, "due-batch", -8);
    await seedImport(dueTenant, "future-batch", -6);
    await seedImport(otherTenant, "other-batch", -8);

    const { due, future, crossTenant } = await withContext(
      runtime,
      dueTenant,
      async () => ({
        due: await runtime.query(
          "select raw_payload from tge.import_staging_records where tenant_id = $1 and import_batch_id = 'due-batch'",
          [dueTenant.id]
        ),
        future: await runtime.query(
          "select raw_payload from tge.import_staging_records where tenant_id = $1 and import_batch_id = 'future-batch'",
          [dueTenant.id]
        ),
        crossTenant: await runtime.query(
          "select raw_payload from tge.import_staging_records where tenant_id = $1",
          [otherTenant.id]
        )
      })
    );
    assert.equal(due.rowCount, 0);
    assert.equal(future.rowCount, 1);
    assert.equal(future.rows[0].raw_payload.cells[0].raw, "private-future-batch");
    assert.equal(crossTenant.rowCount, 0);

    for (const [tenant, batches] of [
      [dueTenant, ["due-batch", "future-batch"]],
      [otherTenant, ["other-batch"]]
    ]) {
      await admin.query(
        "delete from tge.audit_events where tenant_id = $1 and entity_id = any($2::text[])",
        [tenant.id, batches]
      );
      await admin.query(
        "delete from tge.import_staging_records where tenant_id = $1 and import_batch_id = any($2::text[])",
        [tenant.id, batches]
      );
      await admin.query(
        "delete from tge.import_batches where tenant_id = $1 and id = any($2::text[])",
        [tenant.id, batches]
      );
    }
  });

  test("runtime cannot stage raw rows into expired, cleaned, or terminal batches", async () => {
    const tenant = await seedTenant("staging-boundary", "OWNER");
    await seedImport(tenant, "expired-write", -8);
    await seedImport(tenant, "committed-write", -1, { committed: true });
    await seedImport(tenant, "cleaned-write", -8);
    try {
      await admin.query(
        `update tge.import_batches
         set status = 'EXPIRED', raw_cleanup_state = 'SUCCEEDED',
           raw_cleanup_attempts = 1, raw_cleanup_started_at = clock_timestamp(),
           raw_cleanup_completed_at = clock_timestamp()
         where tenant_id = $1 and id = 'cleaned-write'`,
        [tenant.id]
      );

      for (const batchId of ["expired-write", "committed-write", "cleaned-write"]) {
        await assert.rejects(
          withContext(runtime, tenant, () => insertDirectStaging(runtime, tenant, batchId)),
          error => error?.code === "23514"
            && error.message === "Import staging write denied."
        );
      }
    } finally {
      await admin.query("delete from tge.audit_events where tenant_id = $1", [tenant.id]);
      await admin.query("delete from tge.prospects where tenant_id = $1", [tenant.id]);
      await admin.query("delete from tge.import_staging_records where tenant_id = $1", [tenant.id]);
      await admin.query("delete from tge.import_batches where tenant_id = $1", [tenant.id]);
    }
  });

  test("targetless cleanup is concurrency-safe, retry-safe, minimized, and preserves canonical/audit truth", async () => {
    const tenant = await seedTenant("cleanup", "OWNER");
    await seedImport(tenant, "cleanup-batch", -8, { committed: true });
    await grantMaintenance();
    const pool = new Pool({ connectionString: maintenanceUrl, max: 2 });
    try {
      const run = async () => {
        const client = await pool.connect();
        try {
          return (await client.query(
            "select * from tge.process_due_raw_import_cleanup(1)"
          )).rows;
        } finally {
          client.release();
        }
      };
      const [left, right] = await Promise.all([run(), run()]);
      assert.equal(left.length + right.length, 1);
      assert.equal([...left, ...right][0].cleanup_state, "SUCCEEDED");

      const batch = await admin.query(
        "select * from tge.import_batches where tenant_id = $1 and id = 'cleanup-batch'",
        [tenant.id]
      );
      const staged = await admin.query(
        "select raw_payload, metadata, conflict_details from tge.import_staging_records where tenant_id = $1 and import_batch_id = 'cleanup-batch'",
        [tenant.id]
      );
      const canonical = await admin.query(
        "select count(*)::integer as count from tge.prospects where tenant_id = $1",
        [tenant.id]
      );
      const audits = await admin.query(
        "select count(*)::integer as count from tge.audit_events where tenant_id = $1",
        [tenant.id]
      );
      const evidence = await admin.query(
        "select status, facts from tge.data_deletion_evidence where tenant_id = $1 and evidence_type = 'RAW_IMPORT_EVIDENCE'",
        [tenant.id]
      );
      assert.equal(batch.rows[0].status, "COMMITTED");
      assert.equal(batch.rows[0].raw_cleanup_state, "SUCCEEDED");
      assert.equal(batch.rows[0].source_filename, "[deleted]");
      assert.equal(staged.rows[0].raw_payload, null);
      assert.deepEqual(staged.rows[0].metadata, { raw_evidence_deleted: true });
      assert.equal(staged.rows[0].conflict_details, null);
      assert.equal(canonical.rows[0].count, 1);
      assert.equal(audits.rows[0].count, 1);
      assert.equal(evidence.rowCount, 1);
      assert.equal(evidence.rows[0].status, "SUCCEEDED");
      assert.equal(evidence.rows[0].facts.external_actions_performed, false);
      const serialized = JSON.stringify(evidence.rows[0]);
      for (const forbidden of ["private-cleanup-batch", "@", "token", "dsn"]) {
        assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
      }

      const replay = await run();
      assert.deepEqual(replay, []);
      const evidenceAfter = await admin.query(
        "select count(*)::integer as count from tge.data_deletion_evidence where tenant_id = $1 and evidence_type = 'RAW_IMPORT_EVIDENCE'",
        [tenant.id]
      );
      assert.equal(evidenceAfter.rows[0].count, 1);
    } finally {
      await pool.end();
    }
  });

  test("raw cleanup records a bounded retryable failure and later recovers atomically", async () => {
    const tenant = await seedTenant("recovery", "OWNER");
    await seedImport(tenant, "recovery-batch", -8);
    await grantMaintenance();
    await admin.query(
      `create function tge.test_fail_raw_cleanup() returns trigger language plpgsql as $$
       begin raise exception 'private raw cleanup provider detail'; end $$`
    );
    await admin.query(
      `create trigger test_fail_raw_cleanup before update on tge.import_staging_records
       for each row when (old.tenant_id = '${tenant.id}'::uuid)
       execute function tge.test_fail_raw_cleanup()`
    );
    const maintenance = new Client({ connectionString: maintenanceUrl });
    await maintenance.connect();
    try {
      const failed = await maintenance.query(
        "select * from tge.process_due_raw_import_cleanup(1)"
      );
      assert.equal(failed.rows[0].cleanup_state, "FAILED");
      assert.equal(failed.rows[0].retryable, true);
      assert.equal(failed.rows[0].failure_code, "RAW_IMPORT_CLEANUP_FAILED");
      const failureEvidence = await admin.query(
        `select status, failure_code, facts
         from tge.data_deletion_evidence
         where tenant_id = $1 and evidence_type = 'RAW_IMPORT_EVIDENCE'`,
        [tenant.id]
      );
      assert.equal(failureEvidence.rows[0].status, "FAILED");
      assert.equal(
        failureEvidence.rows[0].failure_code,
        "RAW_IMPORT_CLEANUP_FAILED"
      );
      assert.equal(failureEvidence.rows[0].facts.raw_import_rows_scrubbed, 0);
      assert.equal(failureEvidence.rows[0].facts.audit_events_retained, 1);
      const stillRaw = await admin.query(
        "select raw_payload from tge.import_staging_records where tenant_id = $1 and import_batch_id = 'recovery-batch'",
        [tenant.id]
      );
      assert.equal(stillRaw.rows[0].raw_payload.cells[0].raw, "private-recovery-batch");

      await admin.query("drop trigger test_fail_raw_cleanup on tge.import_staging_records");
      await admin.query("drop function tge.test_fail_raw_cleanup()");
      const recovered = await maintenance.query(
        "select * from tge.process_due_raw_import_cleanup(1)"
      );
      assert.equal(recovered.rows[0].cleanup_state, "SUCCEEDED");
      const final = await admin.query(
        "select raw_payload from tge.import_staging_records where tenant_id = $1 and import_batch_id = 'recovery-batch'",
        [tenant.id]
      );
      assert.equal(final.rows[0].raw_payload, null);
    } finally {
      await maintenance.end();
    }
  });

  test("the repository transaction carries trusted issuer authority into an offboarding request", async () => {
    const tenant = await seedTenant("repository-offboarding", "OWNER");
    const pool = new Pool({ connectionString: runtimeUrl, max: 1 });
    try {
      const repositories = createPostgresRepositories({ pool });
      const result = await repositories.tenantOffboarding.request(
        createTenantContext({
          tenantId: tenant.id,
          identityIssuer: tenant.issuer,
          subjectId: tenant.subject
        }),
        { confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE" }
      );
      assert.equal(result.state, "PENDING");
      assert.equal(result.scope, "ACCESS_AND_RAW_EVIDENCE_ONLY");
    } finally {
      await pool.end();
      await admin.query(
        "delete from tge.tenant_offboarding_requests where tenant_id = $1",
        [tenant.id]
      );
      await admin.query(
        "delete from tge.tenant_memberships where tenant_id = $1",
        [tenant.id]
      );
      await admin.query("delete from tge.tenants where id = $1", [tenant.id]);
    }
  });

  test("offboarding request is OWNER-only, database-targeted, idempotent, and non-oracular", async () => {
    const owner = await seedTenant("offboard-owner", "OWNER");
    const adminTenant = await seedTenant("offboard-admin", "ADMIN");
    const { created, replay } = await withContext(runtime, owner, async () => ({
      created: await runtime.query(
        "select * from tge.request_tenant_offboarding('OFFBOARD_ACCESS_AND_RAW_EVIDENCE')"
      ),
      replay: await runtime.query(
        "select * from tge.request_tenant_offboarding('OFFBOARD_ACCESS_AND_RAW_EVIDENCE')"
      )
    }));
    assert.equal(created.rowCount, 1);
    assert.equal(created.rows[0].state, "PENDING");
    assert.equal(replay.rows[0].request_id, created.rows[0].request_id);

    const denial = tenant => withContext(runtime, tenant, () => runtime.query(
        "select * from tge.request_tenant_offboarding('OFFBOARD_ACCESS_AND_RAW_EVIDENCE')"
      ));
    await assert.rejects(denial(adminTenant), genericOffboardingDenial);
    await assert.rejects(
      runtime.query(
        "select * from tge.request_tenant_offboarding($1::uuid, 'OFFBOARD_ACCESS_AND_RAW_EVIDENCE')",
        [owner.id]
      )
    );
    await admin.query(
      "delete from tge.tenant_offboarding_requests where tenant_id = $1",
      [owner.id]
    );
  });

  test("offboarding atomically revokes access and raw evidence but truthfully retains canonical and immutable evidence", async () => {
    const tenant = await seedTenant("offboard-process", "OWNER", {
      billing_reference: "preserve-me",
      unclassified_nested: { value: 7 }
    });
    const other = await seedTenant("offboard-neighbor", "OWNER");
    await seedImport(tenant, "offboard-batch", -1, { committed: true });
    await seedImport(other, "neighbor-batch", -1, { committed: true });
    await seedInvitation(tenant);
    await seedPilotEvidence(tenant);
    await withContext(runtime, tenant, () => runtime.query(
      "select * from tge.request_tenant_offboarding('OFFBOARD_ACCESS_AND_RAW_EVIDENCE')"
    ));
    await grantMaintenance();
    const maintenance = new Client({ connectionString: maintenanceUrl });
    const competingMaintenance = new Client({ connectionString: maintenanceUrl });
    await maintenance.connect();
    await competingMaintenance.connect();
    try {
      await admin.query(
        `create function tge.test_fail_offboarding() returns trigger language plpgsql as $$
         begin raise exception 'private offboarding provider detail'; end $$`
      );
      await admin.query(
        `create trigger test_fail_offboarding before delete on tge.tenant_memberships
         for each row when (old.tenant_id = '${tenant.id}'::uuid)
         execute function tge.test_fail_offboarding()`
      );
      const failed = await maintenance.query(
        "select * from tge.process_pending_tenant_offboarding(1)"
      );
      assert.equal(failed.rows[0].state, "FAILED");
      assert.equal(failed.rows[0].retryable, true);
      assert.equal(failed.rows[0].failure_code, "TENANT_OFFBOARDING_FAILED");
      const rolledBack = await admin.query(
        `select
           (select count(*) from tge.tenant_memberships where tenant_id = $1)::integer memberships,
           (select raw_payload from tge.import_staging_records where tenant_id = $1 limit 1) raw_payload`,
        [tenant.id]
      );
      assert.equal(rolledBack.rows[0].memberships, 1);
      assert.equal(
        rolledBack.rows[0].raw_payload.cells[0].raw,
        "private-offboard-batch"
      );
      const failedEvidence = await admin.query(
        `select status, failure_code, retryable, facts
         from tge.data_deletion_evidence
         where tenant_id = $1 and evidence_type = 'TENANT_OFFBOARDING'
         order by attempt_number`,
        [tenant.id]
      );
      assert.equal(failedEvidence.rowCount, 1);
      assert.equal(failedEvidence.rows[0].status, "FAILED");
      assert.equal(
        failedEvidence.rows[0].failure_code,
        "TENANT_OFFBOARDING_FAILED"
      );
      assert.equal(failedEvidence.rows[0].retryable, true);
      assert.equal(failedEvidence.rows[0].facts.canonical_records_retained, 1);
      assert.equal(failedEvidence.rows[0].facts.audit_events_retained, 1);
      assert.equal(failedEvidence.rows[0].facts.external_actions_performed, false);
      assert.doesNotMatch(JSON.stringify(failedEvidence.rows[0]), /private-|auth0\||@|token|dsn/i);

      await admin.query("drop trigger test_fail_offboarding on tge.tenant_memberships");
      await admin.query("drop function tge.test_fail_offboarding()");
      const [left, right] = await Promise.all([
        maintenance.query("select * from tge.process_pending_tenant_offboarding(1)"),
        competingMaintenance.query(
          "select * from tge.process_pending_tenant_offboarding(1)"
        )
      ]);
      assert.equal(left.rowCount + right.rowCount, 1);
      const processed = [...left.rows, ...right.rows][0];
      assert.equal(processed.state, "OFFBOARDED_ACCESS_REVOKED");
      assert.equal(processed.retryable, false);
      assert.equal(processed.scope, "ACCESS_AND_RAW_EVIDENCE_ONLY");

      const counts = await admin.query(
        `select
           (select count(*) from tge.tenant_memberships where tenant_id = $1)::integer memberships,
           (select count(*) from tge.assisted_invitations where tenant_id = $1)::integer invitations,
           (select count(*) from tge.prospects where tenant_id = $1)::integer prospects,
           (select count(*) from tge.audit_events where tenant_id = $1)::integer audits,
           (select count(*) from tge.pilot_evidence_events where tenant_id = $1)::integer pilot_events,
           (select count(*) from tge.tenant_memberships where tenant_id = $2)::integer neighbor_memberships,
           (select count(*) from tge.prospects where tenant_id = $2)::integer neighbor_prospects`,
        [tenant.id, other.id]
      );
      assert.deepEqual(counts.rows[0], {
        memberships: 0,
        invitations: 0,
        prospects: 1,
        audits: 1,
        pilot_events: 1,
        neighbor_memberships: 1,
        neighbor_prospects: 1
      });
      const raw = await admin.query(
        "select raw_payload from tge.import_staging_records where tenant_id = $1",
        [tenant.id]
      );
      const neighborRaw = await admin.query(
        "select raw_payload from tge.import_staging_records where tenant_id = $1",
        [other.id]
      );
      assert.equal(raw.rows[0].raw_payload, null);
      assert.equal(neighborRaw.rows[0].raw_payload.cells[0].raw, "private-neighbor-batch");

      const request = await admin.query(
        "select state, scope, retryable, deletion_evidence from tge.tenant_offboarding_requests where tenant_id = $1",
        [tenant.id]
      );
      assert.equal(request.rows[0].state, "OFFBOARDED_ACCESS_REVOKED");
      assert.equal(request.rows[0].deletion_evidence.canonical_records_retained, 1);
      assert.equal(request.rows[0].deletion_evidence.audit_events_retained, 1);
      assert.equal(request.rows[0].deletion_evidence.external_actions_performed, false);
      assert.doesNotMatch(JSON.stringify(request.rows[0]), /private-|auth0\||@|token|dsn/i);
      const tenantMetadata = await admin.query(
        "select metadata from tge.tenants where id = $1",
        [tenant.id]
      );
      assert.deepEqual(tenantMetadata.rows[0].metadata, {
        billing_reference: "preserve-me",
        unclassified_nested: { value: 7 },
        offboarding_state: "OFFBOARDED_ACCESS_REVOKED"
      });
      const evidenceStates = await admin.query(
        `select status, attempt_number
         from tge.data_deletion_evidence
         where tenant_id = $1 and evidence_type = 'TENANT_OFFBOARDING'
         order by attempt_number`,
        [tenant.id]
      );
      assert.deepEqual(evidenceStates.rows, [
        { status: "FAILED", attempt_number: 1 },
        { status: "SUCCEEDED", attempt_number: 2 }
      ]);

      const replay = await maintenance.query(
        "select * from tge.process_pending_tenant_offboarding(1)"
      );
      assert.deepEqual(replay.rows, []);
    } finally {
      await competingMaintenance.end();
      await maintenance.end();
    }
  });

  test("offboarding waits for an already-authorized import and leaves no post-success raw evidence", async () => {
    const tenant = await seedTenant("offboard-barrier", "OWNER");
    await withContext(runtime, tenant, () => runtime.query(
      "select * from tge.request_tenant_offboarding('OFFBOARD_ACCESS_AND_RAW_EVIDENCE')"
    ));
    await grantMaintenance();
    const importing = new Client({ connectionString: runtimeUrl });
    const maintenance = new Client({
      connectionString: maintenanceUrl,
      application_name: `slice2-offboard-barrier-${tenant.id}`
    });
    let settled = false;
    await importing.connect();
    await maintenance.connect();
    try {
      await importing.query("begin");
      await setContext(importing, tenant);
      await importing.query(
        `insert into tge.import_batches (
           tenant_id, id, status, source_filename, source_sha256,
           authorized_by_subject_id, authorization_verified_at,
           preview_summary, raw_expires_at, metadata_retain_until,
           created_at, updated_at
         ) values ($1, 'in-flight-batch', 'PREVIEWED', 'private.csv', $2, $3,
           clock_timestamp(), '{"rowCount":1,"sourceCollection":"prospects"}',
           clock_timestamp() + interval '7 days',
           clock_timestamp() + interval '12 months', clock_timestamp(), clock_timestamp())`,
        [tenant.id, "9".repeat(64), tenant.subject]
      );

      const offboarding = maintenance.query(
        "select * from tge.process_pending_tenant_offboarding(1)"
      ).finally(() => { settled = true; });
      const blocked = await waitForMaintenanceLock(
        admin,
        `slice2-offboard-barrier-${tenant.id}`,
        () => settled
      );
      assert.equal(blocked, true, "offboarding must wait for the in-flight import");

      await insertDirectStaging(importing, tenant, "in-flight-batch");
      await importing.query("commit");
      const processed = await offboarding;
      assert.equal(processed.rows[0].state, "OFFBOARDED_ACCESS_REVOKED");
      const raw = await admin.query(
        `select raw_payload from tge.import_staging_records
         where tenant_id = $1 and import_batch_id = 'in-flight-batch'`,
        [tenant.id]
      );
      assert.equal(raw.rows[0].raw_payload, null);
    } finally {
      if (!settled) await importing.query("rollback").catch(() => {});
      await importing.end();
      await maintenance.end();
    }
  });

  test("raw cleanup and offboarding share a bounded tenant-before-batch lock order", async () => {
    const tenant = await seedTenant("cleanup-offboarding-overlap", "OWNER");
    const neighbor = await seedTenant("cleanup-offboarding-neighbor", "OWNER");
    await seedImport(tenant, "cleanup-offboarding-batch", -8, { committed: true });
    await seedImport(neighbor, "cleanup-offboarding-neighbor-batch", -1, {
      committed: true
    });
    await seedInvitation(tenant);
    await seedPilotEvidence(tenant);
    await withContext(runtime, tenant, () => runtime.query(
      "select * from tge.request_tenant_offboarding('OFFBOARD_ACCESS_AND_RAW_EVIDENCE')"
    ));
    await grantMaintenance();

    const barrier = new Client({ connectionString: adminUrl });
    const cleanup = new Client({
      connectionString: maintenanceUrl,
      application_name: `slice2-cleanup-overlap-${tenant.id}`
    });
    const offboarding = new Client({
      connectionString: maintenanceUrl,
      application_name: `slice2-offboarding-overlap-${tenant.id}`
    });
    let barrierHeld = false;
    let cleanupPromise;
    let offboardingPromise;
    await barrier.connect();
    await cleanup.connect();
    await offboarding.connect();
    try {
      await Promise.all([
        cleanup.query("set statement_timeout = '8s'"),
        offboarding.query("set statement_timeout = '8s'")
      ]);
      await barrier.query("begin");
      await barrier.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [tenant.id]
      );
      barrierHeld = true;
      await admin.query(
        `create function tge.test_pause_cleanup_offboarding_overlap()
         returns trigger language plpgsql as $$
         begin
           perform pg_advisory_xact_lock(hashtextextended('${tenant.id}', 0));
           return new;
         end $$`
      );
      await admin.query(
        `create trigger test_pause_cleanup_offboarding_overlap
         before update on tge.import_staging_records
         for each row when (
           old.tenant_id = '${tenant.id}'::uuid
           and old.raw_payload is not null
           and new.raw_payload is null
         ) execute function tge.test_pause_cleanup_offboarding_overlap()`
      );

      cleanupPromise = cleanup.query(
        "select * from tge.process_due_raw_import_cleanup(1)"
      );
      assert.equal(
        await waitForBlockingPid(admin, cleanup.processID, barrier.processID),
        true,
        "cleanup must reach the deterministic post-claim barrier"
      );

      offboardingPromise = offboarding.query(
        "select * from tge.process_pending_tenant_offboarding(1)"
      );
      assert.equal(
        await waitForBlockingPid(admin, offboarding.processID, cleanup.processID),
        true,
        "offboarding must be queued behind the overlapping cleanup"
      );

      await barrier.query("commit");
      barrierHeld = false;
      const [cleaned, offboarded] = await withDeadline(
        Promise.all([cleanupPromise, offboardingPromise]),
        9000,
        "cleanup/offboarding overlap did not complete within the bounded deadline"
      );
      assert.deepEqual(cleaned.rows.map(row => row.cleanup_state), ["SUCCEEDED"]);
      assert.deepEqual(
        offboarded.rows.map(row => row.state),
        ["OFFBOARDED_ACCESS_REVOKED"]
      );

      const truth = await admin.query(
        `select
           (select raw_cleanup_state from tge.import_batches
             where tenant_id = $1 and id = 'cleanup-offboarding-batch') cleanup_state,
           (select state from tge.tenant_offboarding_requests
             where tenant_id = $1) offboarding_state,
           (select count(*) from tge.import_staging_records
             where tenant_id = $1 and raw_payload is not null)::integer raw_rows,
           (select count(*) from tge.tenant_memberships
             where tenant_id = $1)::integer memberships,
           (select count(*) from tge.prospects
             where tenant_id = $1)::integer canonical_records,
           (select count(*) from tge.audit_events
             where tenant_id = $1)::integer audit_events,
           (select count(*) from tge.pilot_evidence_events
             where tenant_id = $1)::integer pilot_events,
           (select count(*) from tge.data_deletion_evidence
             where tenant_id = $1 and status = 'FAILED')::integer failed_evidence,
           (select count(*) from tge.tenant_memberships
             where tenant_id = $2)::integer neighbor_memberships,
           (select count(*) from tge.import_staging_records
             where tenant_id = $2 and raw_payload is not null)::integer neighbor_raw_rows`,
        [tenant.id, neighbor.id]
      );
      assert.deepEqual(truth.rows[0], {
        cleanup_state: "SUCCEEDED",
        offboarding_state: "OFFBOARDED_ACCESS_REVOKED",
        raw_rows: 0,
        memberships: 0,
        canonical_records: 1,
        audit_events: 1,
        pilot_events: 1,
        failed_evidence: 0,
        neighbor_memberships: 1,
        neighbor_raw_rows: 1
      });

      const evidence = await admin.query(
        `select evidence_type, status, facts
         from tge.data_deletion_evidence
         where tenant_id = $1
         order by evidence_type`,
        [tenant.id]
      );
      assert.deepEqual(evidence.rows, [
        {
          evidence_type: "RAW_IMPORT_EVIDENCE",
          status: "SUCCEEDED",
          facts: {
            audit_events_retained: 1,
            canonical_records_retained: 1,
            external_actions_performed: false,
            raw_import_rows_scrubbed: 1
          }
        },
        {
          evidence_type: "TENANT_OFFBOARDING",
          status: "SUCCEEDED",
          facts: {
            audit_events_retained: 1,
            canonical_records_retained: 1,
            external_actions_performed: false,
            invitations_deleted: 1,
            memberships_revoked: 1,
            pilot_evidence_events_retained: 1,
            raw_import_batches_scrubbed: 0,
            raw_import_rows_scrubbed: 0
          }
        }
      ]);
    } finally {
      if (barrierHeld) await barrier.query("rollback").catch(() => {});
      await Promise.allSettled([cleanupPromise, offboardingPromise].filter(Boolean));
      await cleanup.end();
      await offboarding.end();
      await barrier.end();
      await admin.query(
        "drop trigger if exists test_pause_cleanup_offboarding_overlap on tge.import_staging_records"
      );
      await admin.query(
        "drop function if exists tge.test_pause_cleanup_offboarding_overlap()"
      );
    }
  });

  async function seedTenant(label, role, metadata = {}) {
    const tenant = {
      id: randomUUID(),
      subject: `auth0|${label}-${randomUUID()}`,
      issuer: "https://pilot.au.auth0.com/"
    };
    await admin.query(
      "insert into tge.tenants (id, slug, name, metadata) values ($1, $2, $3, $4::jsonb)",
      [tenant.id, `${label}-${tenant.id}`, `Private ${label}`, JSON.stringify(metadata)]
    );
    await admin.query(
      `insert into tge.tenant_memberships (
         tenant_id, identity_issuer, subject_id, role, status
       ) values ($1, $2, $3, $4, 'ACTIVE')`,
      [tenant.id, tenant.issuer, tenant.subject, role]
    );
    return tenant;
  }

  async function seedImport(tenant, batchId, createdDaysAgo, { committed = false } = {}) {
    const createdAt = new Date(Date.now() + createdDaysAgo * 86400000);
    const expiresAt = new Date(createdAt.valueOf() + 7 * 86400000);
    const retainUntil = addMonths(createdAt, 12);
    await admin.query(
      `insert into tge.import_batches (
         tenant_id, id, status, source_filename, source_sha256,
         authorized_by_subject_id, authorization_verified_at, preview_summary,
         commit_idempotency_key, commit_metadata, committed_at,
         raw_expires_at, metadata_retain_until, created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
         $9, $10::jsonb, $11, $12, $13, $7, $7
       )`,
      [
        tenant.id,
        batchId,
        committed ? "COMMITTED" : "PREVIEWED",
        `private-${batchId}.csv`,
        "a".repeat(64),
        tenant.subject,
        createdAt,
        JSON.stringify({
          format: "CSV",
          sourceCollection: "prospects",
          rowCount: 1,
          columnCount: 1,
          headers: ["private_header"]
        }),
        committed ? `key-${batchId}` : null,
        committed ? JSON.stringify({
          inputFingerprint: "b".repeat(64),
          requestFingerprint: "c".repeat(64),
          reviewedMapping: { selections: [{ sourceColumn: "private_header" }] },
          result: {
            outcome: "COMMITTED",
            rows: [{ sourceRecordId: `private-${batchId}` }],
            summary: { total: 1, committed: 1, skipped: 0, conflicted: 0, failed: 0 }
          }
        }) : null,
        committed ? createdAt : null,
        expiresAt,
        retainUntil
      ]
    );
    await admin.query(
      `insert into tge.import_staging_records (
         tenant_id, import_batch_id, id, source_collection, source_id,
         source_ordinal, raw_payload, raw_payload_sha256, disposition,
         idempotency_key, conflict_details, metadata, committed_at,
         created_at, updated_at
       ) values (
         $1, $2, 'row:0', 'prospects', $3, 0, $4::jsonb, $5, $6,
         $7, $8::jsonb, $9::jsonb, $10, $11, $11
       )`,
      [
        tenant.id,
        batchId,
        `csv-row:0:${"d".repeat(64)}`,
        JSON.stringify({
          sourceRowNumber: 2,
          cells: [{ columnOrdinal: 0, present: true, raw: `private-${batchId}`, valueKind: "NONNUMERIC" }]
        }),
        "d".repeat(64),
        committed ? "COMMITTED" : "PENDING",
        "e".repeat(64),
        JSON.stringify({ private_value: `private-${batchId}` }),
        JSON.stringify({ source_record_id: `private-${batchId}` }),
        committed ? createdAt : null,
        createdAt
      ]
    );
    await admin.query(
      `insert into tge.audit_events (
         tenant_id, id, event_type, subject_id, entity_type, entity_id,
         payload, occurred_at, retain_until, created_at
       ) values ($1, $2, 'IMPORT_PREVIEW_CREATED', $3, 'import_batch', $4,
         '{"external_action_performed":false}', $5, $6, $5)`,
      [tenant.id, `audit-${batchId}`, tenant.subject, batchId, createdAt, retainUntil]
    );
    if (committed) {
      await admin.query(
        `insert into tge.prospects (
           tenant_id, id, business_name, source_ordinal, legacy_payload,
           current_payload, created_at, updated_at
         ) values ($1, $2, 'Private canonical customer', 0,
           '{"private":"canonical"}', '{"business_name":"Private canonical customer"}',
           $3, $3)`,
        [tenant.id, `prospect-${batchId}`, createdAt]
      );
    }
  }

  async function seedInvitation(tenant) {
    const now = new Date();
    await admin.query(
      `insert into tge.assisted_invitations (
         tenant_id, token_hash, normalized_email, intended_role, status,
         created_by_subject_id, expires_at, created_at, updated_at
       ) values ($1, $2, 'private@example.test', 'MEMBER', 'PENDING', $3,
         $4, $5, $5)`,
      [tenant.id, "f".repeat(64), tenant.subject, new Date(now.valueOf() + 86400000), now]
    );
  }

  async function seedPilotEvidence(tenant) {
    const now = new Date();
    await admin.query(
      `insert into tge.pilot_evidence_events (
         tenant_id, id, event_type, actor_subject_id, occurred_at,
         semantic_key, facts, created_at
       ) values ($1, 'pilot-evidence', 'PORTFOLIO_SCAN_COMPLETED', $2, $3,
         $4, $5::jsonb, $3)`,
      [tenant.id, tenant.subject, now, "1".repeat(64), JSON.stringify({
        evaluated_count: 0,
        eligible_leak_count: 0,
        eligible_no_leak_count: 0,
        insufficient_evidence_count: 0,
        stale_source_count: 0,
        data_health_suppressed_count: 0,
        excluded_count: 0
      })]
    );
  }

  async function setContext(client, tenant) {
    await client.query(
      "select tge.set_request_context($1::uuid, $2::text, $3::text)",
      [tenant.id, tenant.issuer, tenant.subject]
    );
  }

  async function withContext(client, tenant, work) {
    await client.query("begin");
    try {
      await setContext(client, tenant);
      const result = await work();
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  async function grantMaintenance() {
    await admin.query(`grant tge_maintenance to ${quoteIdentifier(maintenanceRole)}`);
  }
}

async function insertDirectStaging(client, tenant, batchId) {
  return client.query(
    `insert into tge.import_staging_records (
       tenant_id, import_batch_id, id, source_collection, source_id,
       source_ordinal, raw_payload, raw_payload_sha256, disposition,
       idempotency_key, metadata, created_at, updated_at
     ) values ($1, $2, $3, 'prospects', $4, 999,
       '{"cells":[{"raw":"post-terminal-private"}]}'::jsonb, $5,
       'PENDING', $6, '{}'::jsonb, clock_timestamp(), clock_timestamp())`,
    [
      tenant.id,
      batchId,
      `late-row-${randomUUID()}`,
      `late-source-${randomUUID()}`,
      "8".repeat(64),
      `late-key-${randomUUID()}`
    ]
  );
}

async function waitForMaintenanceLock(client, applicationName, isSettled) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query(
      `select wait_event_type from pg_stat_activity
       where application_name = $1 and state = 'active'`,
      [applicationName]
    );
    if (result.rows[0]?.wait_event_type === "Lock") return true;
    if (isSettled()) return false;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}

async function waitForBlockingPid(client, blockedPid, blockerPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await client.query(
      `select $2::integer = any(pg_blocking_pids($1::integer)) blocked`,
      [blockedPid, blockerPid]
    );
    if (result.rows[0]?.blocked) return true;
    await new Promise(resolve => setImmediate(resolve));
  }
  return false;
}

async function withDeadline(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function addMonths(value, count) {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date;
}

function genericOffboardingDenial(error) {
  return error?.code === "42501"
    && error.message === "Tenant offboarding request denied.";
}

async function createLogin(client, role, password) {
  const result = await client.query(
    "select format('create role %I login password %L nosuperuser nocreatedb nocreaterole noreplication nobypassrls', $1::text, $2::text) sql",
    [role, password]
  );
  await client.query(result.rows[0].sql);
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
  return `"${String(value).replaceAll('"', '""')}"`;
}
