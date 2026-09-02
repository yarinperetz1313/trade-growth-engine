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
  test("real PostgreSQL tests require TGE_TEST_DATABASE_URL", () => {
    assert.fail(
      "TGE_TEST_DATABASE_URL is required; database verification must not be reported as passed without PostgreSQL"
    );
  });
} else {
  const { Client, Pool } = require("pg");
  const {
    registerPostgresRepositoryContractTests
  } = require("./postgres-repositories.contract");
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const runtimeRole = `tge_runtime_test_${randomUUID().replaceAll("-", "")}`;
  const runtimePassword = randomUUID();
  const databaseName = `tge_pr2_${randomUUID().replaceAll("-", "")}`;
  const maintenanceUrl = replaceDatabase(testDatabaseUrl, "postgres");
  const ephemeralUrl = replaceDatabase(testDatabaseUrl, databaseName);
  const runtimeUrl = replaceCredentials(
    ephemeralUrl,
    runtimeRole,
    runtimePassword
  );
  const fixturesDirectory = path.join(
    repositoryRoot,
    "test",
    "fixtures",
    "legacy-json-compat"
  );
  let maintenanceClient;
  let adminClient;
  let runtimeClient;
  let runMigrations;
  let closePostgresRepositoryPools = async () => {};

  test.before(async () => {
    maintenanceClient = new Client({ connectionString: maintenanceUrl });
    await maintenanceClient.connect();
    await maintenanceClient.query(`create database ${quoteIdentifier(databaseName)}`);

    ({ runMigrations } = await import(
      pathToFileURL(path.join(repositoryRoot, "scripts", "migrate-db.mjs"))
    ));
    await runMigrations({ connectionString: ephemeralUrl, logger: silentLogger });

    adminClient = new Client({ connectionString: ephemeralUrl });
    await adminClient.connect();
    const createRuntimeRole = await adminClient.query(
      "select format('create role %I login password %L nosuperuser nocreatedb nocreaterole noreplication nobypassrls', $1::text, $2::text) as sql",
      [runtimeRole, runtimePassword]
    );
    await adminClient.query(createRuntimeRole.rows[0].sql);
    await adminClient.query(
      `grant tge_runtime to ${quoteIdentifier(runtimeRole)}`
    );

    runtimeClient = new Client({ connectionString: runtimeUrl });
    await runtimeClient.connect();

    await adminClient.query(
      `
        insert into tge.tenants (id, slug, name)
        values ($1, 'tenant-a', 'Tenant A'), ($2, 'tenant-b', 'Tenant B')
      `,
      [tenantA, tenantB]
    );
    await adminClient.query(
      `
        insert into tge.tenant_memberships (tenant_id, subject_id, role)
        values
          ($1, 'auth0|owner-a', 'OWNER'),
          ($1, 'auth0|member-a', 'MEMBER'),
          ($2, 'auth0|owner-b', 'OWNER')
      `,
      [tenantA, tenantB]
    );
  });

  test.after(async () => {
    await closePostgresRepositoryPools();
    if (runtimeClient) await runtimeClient.end();
    if (adminClient) await adminClient.end();
    if (maintenanceClient) {
      await maintenanceClient.query(
        `
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = $1 and pid <> pg_backend_pid()
        `,
        [databaseName]
      );
      await maintenanceClient.query(`drop database ${quoteIdentifier(databaseName)}`);
      await maintenanceClient.query(`drop role if exists ${quoteIdentifier(runtimeRole)}`);
      await maintenanceClient.end();
    }
  });

  test("fresh migrations are transactional, checksummed, and deterministic on rerun", async () => {
    const ledgerBefore = await adminClient.query(
      `
        select migration_id, file_name, checksum, applied_at
        from tge_migration.schema_migrations
        order by migration_id
      `
    );

    assert.deepEqual(
      ledgerBefore.rows.map(row => [row.migration_id, row.file_name]),
      [
        ["001", "001_initial_schema.sql"],
        ["002", "002_tenant_domain_schema.sql"],
        ["003", "003_roles_rls_and_grants.sql"],
        ["004", "004_global_function_default_privileges.sql"],
        ["005", "005_task_in_progress_status.sql"],
        ["006", "006_runtime_revenue_action_integrity.sql"],
        ["007", "007_revenue_action_lifecycle_integrity.sql"],
        ["008", "008_revenue_action_outcome_integrity.sql"],
        ["009", "009_revenue_action_cancellation_integrity.sql"],
        ["010", "010_auth_membership_and_invitations.sql"],
        ["011", "011_canonical_import_commit.sql"],
        ["012", "012_revenue_leak_case_foundation.sql"]
      ]
    );
    assert.equal(
      ledgerBefore.rows[0].checksum,
      "d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62"
    );
    assert.equal(
      ledgerBefore.rows.at(-1).checksum,
      sha256(fs.readFileSync(
        path.join(
          repositoryRoot,
          "database/migrations/012_revenue_leak_case_foundation.sql"
        )
      ))
    );

    const functionDefaultAcl = await adminClient.query(
      `
        select
          r.rolname as owner,
          d.defaclobjtype as object_type,
          d.defaclnamespace::integer as defaclnamespace,
          exists (
            select 1
            from aclexplode(d.defaclacl) acl
            where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
          ) as public_execute
        from pg_default_acl d
        join pg_roles r on r.oid = d.defaclrole
        where r.rolname = 'tge_owner'
          and d.defaclobjtype = 'f'
          and d.defaclnamespace = 0
      `
    );
    assert.deepEqual(functionDefaultAcl.rows, [{
      owner: "tge_owner",
      object_type: "f",
      defaclnamespace: 0,
      public_execute: false
    }]);

    const rerun = await runMigrations({
      connectionString: ephemeralUrl,
      logger: silentLogger
    });
    assert.deepEqual(rerun.applied, []);

    const ledgerAfter = await adminClient.query(
      `
        select migration_id, applied_at
        from tge_migration.schema_migrations
        order by migration_id
      `
    );
    assert.deepEqual(ledgerAfter.rows, ledgerBefore.rows.map(row => ({
      migration_id: row.migration_id,
      applied_at: row.applied_at
    })));

    const driftDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tge-drift-"));
    const retroactiveDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "tge-retroactive-")
    );
    const brokenDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tge-broken-"));
    const ownerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tge-owner-"));
    try {
      copyMigrations(driftDirectory);
      fs.appendFileSync(
        path.join(driftDirectory, "002_tenant_domain_schema.sql"),
        "\n-- forbidden drift\n"
      );
      await assert.rejects(
        runMigrations({
          connectionString: ephemeralUrl,
          migrationsDirectory: driftDirectory,
          logger: silentLogger
        }),
        /checksum drift/
      );

      copyMigrations(retroactiveDirectory);
      fs.writeFileSync(
        path.join(retroactiveDirectory, "000_retroactive.sql"),
        "create table tge.must_not_apply_retroactively (id integer);\n"
      );
      await assert.rejects(
        runMigrations({
          connectionString: ephemeralUrl,
          migrationsDirectory: retroactiveDirectory,
          logger: silentLogger
        }),
        /retroactive; append-only migrations must follow 012/
      );

      copyMigrations(brokenDirectory);
      fs.writeFileSync(
        path.join(brokenDirectory, "013_broken_transaction.sql"),
        "create table tge.must_rollback (id integer);\nselect 1 / 0;\n"
      );
      await assert.rejects(
        runMigrations({
          connectionString: ephemeralUrl,
          migrationsDirectory: brokenDirectory,
          logger: silentLogger
        }),
        error => {
          assert.match(
            error.message,
            /Migration 013_broken_transaction\.sql failed \[22012\]: division by zero/
          );
          assert.equal(error.code, "22012");
          assert.equal(error.migrationLine, undefined);
          assert.deepEqual(error.migration, {
            id: "013",
            fileName: "013_broken_transaction.sql"
          });
          assert.equal(error.cause?.message, "division by zero");
          for (const unsafeField of [
            "sql",
            "query",
            "connectionString",
            "password",
            "parameters",
            "config"
          ]) {
            assert.equal(Object.hasOwn(error, unsafeField), false, unsafeField);
          }
          const serialized = JSON.stringify(error);
          assert.doesNotMatch(
            serialized,
            /create table tge\.must_rollback|select 1 \/ 0|TGE_TEST_DATABASE_URL/
          );
          assert.equal(serialized.includes(ephemeralUrl), false);
          const databasePassword = new URL(ephemeralUrl).password;
          if (databasePassword) {
            assert.equal(serialized.includes(databasePassword), false);
          }
          return true;
        }
      );
      const rolledBack = await adminClient.query(
        `
          select
            to_regclass('tge.must_rollback') as relation,
            exists (
              select 1 from tge_migration.schema_migrations
              where migration_id = '013'
            ) as ledger_row
        `
      );
      assert.deepEqual(rolledBack.rows[0], {
        relation: null,
        ledger_row: false
      });

      copyMigrations(ownerDirectory);
      fs.writeFileSync(
        path.join(ownerDirectory, "013_owner_default_probe.sql"),
        `
          create function tge.owner_default_probe()
          returns integer
          language sql
          as 'select 1';
        `
      );
      const ownerProbe = await runMigrations({
        connectionString: ephemeralUrl,
        migrationsDirectory: ownerDirectory,
        logger: silentLogger
      });
      assert.deepEqual(ownerProbe.applied, ["013"]);
      const ownerProbeSecurity = await adminClient.query(
        `
          select
            pg_get_userbyid(p.proowner) as owner,
            exists (
              select 1
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
              where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
            ) as public_execute
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'tge' and p.proname = 'owner_default_probe'
        `
      );
      assert.deepEqual(ownerProbeSecurity.rows[0], {
        owner: "tge_owner",
        public_execute: false
      });
    } finally {
      fs.rmSync(driftDirectory, { recursive: true, force: true });
      fs.rmSync(retroactiveDirectory, { recursive: true, force: true });
      fs.rmSync(brokenDirectory, { recursive: true, force: true });
      fs.rmSync(ownerDirectory, { recursive: true, force: true });
    }
  });

  test("runner refuses an implicit 001 baseline when known objects exist", async () => {
    const baselineDatabaseName = `tge_baseline_${randomUUID().replaceAll("-", "")}`;
    const baselineUrl = replaceDatabase(testDatabaseUrl, baselineDatabaseName);
    let baselineClient;

    await maintenanceClient.query(
      `create database ${quoteIdentifier(baselineDatabaseName)}`
    );
    try {
      baselineClient = new Client({ connectionString: baselineUrl });
      await baselineClient.connect();
      await baselineClient.query("create table public.prospects (id uuid primary key)");
      await baselineClient.end();
      baselineClient = null;

      await assert.rejects(
        runMigrations({ connectionString: baselineUrl, logger: silentLogger }),
        /Audited baseline required: migration 001 is unapplied.*public\.prospects/
      );

      baselineClient = new Client({ connectionString: baselineUrl });
      await baselineClient.connect();
      const ledger = await baselineClient.query(
        `
          select migration_id
          from tge_migration.schema_migrations
          where migration_id = '001'
        `
      );
      assert.deepEqual(ledger.rows, []);
    } finally {
      if (baselineClient) await baselineClient.end();
      await maintenanceClient.query(
        `
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = $1 and pid <> pg_backend_pid()
        `,
        [baselineDatabaseName]
      );
      await maintenanceClient.query(
        `drop database if exists ${quoteIdentifier(baselineDatabaseName)}`
      );
    }
  });

  test("all PR-1 fixtures retain IDs, timestamps, raw values, relationships, and ordering", async () => {
    const fixtures = readFixtures();
    await adminClient.query("begin");
    try {
      for (const [ordinal, prospect] of fixtures.prospects.entries()) {
        await adminClient.query(
          `
            insert into tge.prospects (
              tenant_id, id, business_name, service, location,
              legacy_payload, source_ordinal, source_created_at, source_updated_at,
              created_at, updated_at
            ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $8, $9)
          `,
          [
            tenantA,
            prospect.id,
            prospect.business_name,
            prospect.service,
            prospect.location,
            JSON.stringify(prospect),
            ordinal,
            prospect.created_at,
            prospect.updated_at
          ]
        );
      }

      for (const [ordinal, opportunity] of fixtures.opportunities.entries()) {
        const value = classifyCommercialValue(opportunity);
        await adminClient.query(
          `
            insert into tge.opportunities (
              tenant_id, id, prospect_id, business_name, stage, priority,
              qualification_score, commercial_value, commercial_value_state,
              commercial_value_raw, probability, weighted_value, next_action,
              contact_name, legacy_payload, source_ordinal, source_created_at,
              source_updated_at, created_at, updated_at
            ) values (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12,
              $13, $14, $15::jsonb, $16, $17, $18, $17, $18
            )
          `,
          [
            tenantA,
            opportunity.id,
            opportunity.prospect_id ?? null,
            opportunity.business_name,
            opportunity.stage,
            opportunity.priority ?? null,
            opportunity.qualification_score ?? null,
            value.numeric,
            value.state,
            value.raw,
            opportunity.probability ?? null,
            opportunity.weighted_value ?? null,
            opportunity.next_action ?? null,
            opportunity.contact_name ?? null,
            JSON.stringify(opportunity),
            ordinal,
            opportunity.created_at,
            opportunity.updated_at
          ]
        );
      }

      for (const [ordinal, taskFixture] of fixtures.tasks.entries()) {
        await adminClient.query(
          `
            insert into tge.tasks (
              tenant_id, id, opportunity_id, revenue_action_id, title,
              description, due_at, priority, status, completed_at, metadata,
              legacy_payload, source_ordinal, source_created_at, source_updated_at,
              created_at, updated_at
            ) values (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
              $12::jsonb, $13, $14, $15, $14, $15
            )
          `,
          [
            tenantA,
            taskFixture.id,
            taskFixture.opportunity_id,
            taskFixture.metadata?.revenue_action_id ?? null,
            taskFixture.title,
            taskFixture.description ?? null,
            taskFixture.due_at ?? null,
            taskFixture.priority ?? null,
            taskFixture.status,
            taskFixture.completed_at ?? null,
            JSON.stringify(taskFixture.metadata ?? {}),
            JSON.stringify(taskFixture),
            ordinal,
            taskFixture.created_at,
            taskFixture.updated_at
          ]
        );
      }

      for (const [ordinal, activity] of fixtures.activities.entries()) {
        await adminClient.query(
          `
            insert into tge.activities (
              tenant_id, id, opportunity_id, revenue_action_id, type,
              description, metadata, legacy_payload, source_ordinal,
              source_created_at, source_updated_at, created_at, updated_at
            ) values (
              $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9,
              $10, $11, $10, $11
            )
          `,
          [
            tenantA,
            activity.id,
            activity.opportunity_id,
            activity.metadata?.revenue_action_id ?? null,
            activity.type,
            activity.description ?? null,
            JSON.stringify(activity.metadata ?? {}),
            JSON.stringify(activity),
            ordinal,
            activity.created_at,
            activity.updated_at
          ]
        );
      }

      for (const [ordinal, action] of fixtures.revenue_actions.entries()) {
        await adminClient.query(
          `
            insert into tge.revenue_actions (
              tenant_id, id, opportunity_id, action_type, execution_type,
              approval_requirement, risk_class, status, priority, title, reason,
              evidence, recommendation_snapshot, basis_fingerprint,
              proposed_execution, execution_result, source, audit, prepared_at,
              approved_at, executed_at, rejected_at, cancelled_at, failed_at,
              rejection_reason, resulting_task_id, resulting_activity_id,
              legacy_payload, source_ordinal, source_created_at, source_updated_at,
              created_at, updated_at
            ) values (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              $12::jsonb, $13::jsonb, $14, $15::jsonb, $16::jsonb, $17,
              $18::jsonb, $19, $20, $21, $22, $23, $24, $25, $26, $27,
              $28::jsonb, $29, $30, $31, $30, $31
            )
          `,
          [
            tenantA,
            action.id,
            action.opportunity_id,
            action.action_type,
            action.execution_type,
            action.approval_requirement,
            action.risk_class,
            action.status,
            action.priority ?? null,
            action.title,
            action.reason,
            JSON.stringify(action.evidence),
            JSON.stringify(action.recommendation_snapshot),
            action.basis_fingerprint,
            JSON.stringify(action.proposed_execution),
            JSON.stringify(action.execution_result),
            action.source,
            JSON.stringify(action.audit),
            action.prepared_at,
            action.approved_at,
            action.executed_at,
            action.rejected_at,
            action.cancelled_at,
            action.failed_at,
            action.rejection_reason,
            action.resulting_task_id,
            action.resulting_activity_id,
            JSON.stringify(action),
            ordinal,
            action.created_at,
            action.updated_at
          ]
        );
      }
      await adminClient.query("commit");
    } catch (error) {
      await adminClient.query("rollback");
      throw error;
    }

    const counts = await adminClient.query(
      `
        select
          (select count(*)::int from tge.prospects where tenant_id = $1) prospects,
          (select count(*)::int from tge.opportunities where tenant_id = $1) opportunities,
          (select count(*)::int from tge.activities where tenant_id = $1) activities,
          (select count(*)::int from tge.tasks where tenant_id = $1) tasks,
          (select count(*)::int from tge.revenue_actions where tenant_id = $1) revenue_actions
      `,
      [tenantA]
    );
    assert.deepEqual(counts.rows[0], {
      prospects: 1,
      opportunities: 9,
      activities: 4,
      tasks: 3,
      revenue_actions: 2
    });

    const linked = await adminClient.query(
      `
        select ra.id, t.id task_id, a.id activity_id
        from tge.revenue_actions ra
        left join tge.tasks t
          on (t.tenant_id, t.id) = (ra.tenant_id, ra.resulting_task_id)
        left join tge.activities a
          on (a.tenant_id, a.id) = (ra.tenant_id, ra.resulting_activity_id)
        where ra.tenant_id = $1
        order by ra.source_ordinal
      `,
      [tenantA]
    );
    assert.deepEqual(linked.rows, [
      {
        id: "action-history-executed",
        task_id: null,
        activity_id: "activity-history-executed"
      },
      {
        id: "action-history-task",
        task_id: "task-history-executed",
        activity_id: "activity-history-task"
      }
    ]);

    const rawProspect = await adminClient.query(
      `select id, legacy_payload, source_created_at, source_updated_at
       from tge.prospects where tenant_id = $1 and id = 'prospect-known'`,
      [tenantA]
    );
    assert.deepEqual(rawProspect.rows[0].legacy_payload, fixtures.prospects[0]);
    assert.equal(
      rawProspect.rows[0].source_created_at.toISOString(),
      fixtures.prospects[0].created_at
    );
    assert.equal(
      rawProspect.rows[0].source_updated_at.toISOString(),
      fixtures.prospects[0].updated_at
    );

    await adminClient.query(
      `
        insert into tge.activities (
          tenant_id, id, opportunity_id, type, description,
          source_ordinal, source_created_at, source_updated_at
        ) values
          ($1, 'equal-time-earlier', 'opp-known', 'ORDER_EVIDENCE', 'Earlier ordinal', 100, $2, $2),
          ($1, 'equal-time-later', 'opp-known', 'ORDER_EVIDENCE', 'Later ordinal', 101, $2, $2)
      `,
      [tenantA, "2026-01-06T00:00:00.000Z"]
    );
    const equalTimestampOrder = await adminClient.query(
      `
        select id from tge.activities
        where tenant_id = $1 and type = 'ORDER_EVIDENCE'
        order by source_created_at desc, source_ordinal desc
      `,
      [tenantA]
    );
    assert.deepEqual(
      equalTimestampOrder.rows.map(row => row.id),
      ["equal-time-later", "equal-time-earlier"]
    );
  });

  test("unknown commercial states, zero, and null probability remain distinguishable", async () => {
    const values = await adminClient.query(
      `
        select id, commercial_value::text, commercial_value_state,
          commercial_value_raw,
          commercial_value_raw is null as raw_is_sql_null,
          jsonb_typeof(commercial_value_raw) as raw_json_type,
          probability::text
        from tge.opportunities
        where tenant_id = $1
        order by source_ordinal
      `,
      [tenantA]
    );
    const byId = new Map(values.rows.map(row => [row.id, row]));

    assert.deepEqual(
      [
        "opp-known",
        "opp-zero",
        "opp-unknown",
        "opp-missing-value",
        "opp-blank-value",
        "opp-unknown-string-value",
        "opp-non-numeric-value"
      ].map(id => byId.get(id).commercial_value_state),
      [
        "KNOWN",
        "ZERO",
        "NULL",
        "MISSING",
        "BLANK",
        "UNKNOWN_LITERAL",
        "NON_NUMERIC"
      ]
    );
    assert.equal(byId.get("opp-zero").commercial_value, "0.000000");
    assert.equal(byId.get("opp-unknown").commercial_value, null);
    assert.equal(byId.get("opp-unknown").commercial_value_raw, null);
    assert.equal(byId.get("opp-unknown").raw_is_sql_null, false);
    assert.equal(byId.get("opp-unknown").raw_json_type, "null");
    assert.equal(byId.get("opp-missing-value").commercial_value_raw, null);
    assert.equal(byId.get("opp-missing-value").raw_is_sql_null, true);
    assert.equal(byId.get("opp-missing-value").raw_json_type, null);
    assert.equal(byId.get("opp-blank-value").commercial_value_raw, "   ");
    assert.equal(byId.get("opp-unknown-string-value").commercial_value_raw, "unknown");
    assert.equal(byId.get("opp-non-numeric-value").commercial_value_raw, "not-a-number");
    assert.equal(byId.get("opp-unknown").probability, null);

    await assertSqlState(
      adminClient.query(
        `
          insert into tge.opportunities (
            tenant_id, id, business_name, stage,
            commercial_value, commercial_value_state, commercial_value_raw
          ) values ($1, 'invalid-zero', 'Invalid', 'NEW', 0, 'KNOWN', '0'::jsonb)
        `,
        [tenantA]
      ),
      "23514"
    );
  });

  test("composite foreign keys reject cross-tenant relationships", async () => {
    await adminClient.query(
      `
        insert into tge.prospects (tenant_id, id, business_name)
        values ($1, 'tenant-b-prospect', 'Tenant B Prospect')
      `,
      [tenantB]
    );

    await assertSqlState(
      adminClient.query(
        `
          insert into tge.opportunities (
            tenant_id, id, prospect_id, business_name, stage,
            commercial_value_state
          ) values ($1, 'cross-tenant-opportunity', 'tenant-b-prospect', 'Invalid', 'NEW', 'MISSING')
        `,
        [tenantA]
      ),
      "23503"
    );
  });

  test("non-superuser runtime RLS fails closed and isolates same-tenant access", async () => {
    const runtimeAttributes = await adminClient.query(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
       from pg_roles where rolname = $1`,
      [runtimeRole]
    );
    assert.deepEqual(runtimeAttributes.rows[0], {
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false
    });

    const noContext = await runtimeClient.query("select id from tge.prospects");
    assert.deepEqual(noContext.rows, []);
    await assertSqlState(
      runtimeClient.query(
        "insert into tge.prospects (tenant_id, id, business_name) values ($1, 'no-context', 'Denied')",
        [tenantA]
      ),
      "42501"
    );

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|member-a"
    ]);
    const sameTenant = await runtimeClient.query(
      "select id from tge.prospects order by id"
    );
    assert.ok(sameTenant.rows.some(row => row.id === "prospect-known"));
    assert.ok(!sameTenant.rows.some(row => row.id === "tenant-b-prospect"));
    await runtimeClient.query(
      "insert into tge.prospects (tenant_id, id, business_name) values ($1, 'runtime-same-tenant', 'Allowed')",
      [tenantA]
    );
    await runtimeClient.query("commit");

    const contextWasLocal = await runtimeClient.query(
      "select id from tge.prospects where id = 'runtime-same-tenant'"
    );
    assert.deepEqual(contextWasLocal.rows, []);

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|member-a"
    ]);
    await assertSqlState(
      runtimeClient.query(
        "insert into tge.prospects (tenant_id, id, business_name) values ($1, 'runtime-cross-tenant', 'Denied')",
        [tenantB]
      ),
      "42501"
    );
    await runtimeClient.query("rollback");
  });

  test("runtime cannot DDL, truncate, mutate audit history, or access legacy public tables", async () => {
    await assertSqlState(
      runtimeClient.query("create table tge.runtime_ddl_denied (id integer)"),
      "42501"
    );
    await assertSqlState(
      runtimeClient.query("drop policy tenant_scope on tge.prospects"),
      "42501"
    );
    await assertSqlState(
      runtimeClient.query("alter role tge_runtime createdb"),
      "42501"
    );
    await assertSqlState(runtimeClient.query("truncate tge.prospects"), "42501");
    await assertSqlState(
      runtimeClient.query("select * from tge_migration.schema_migrations"),
      "42501"
    );
    await assertSqlState(runtimeClient.query("select * from public.prospects"), "42501");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|member-a"
    ]);
    await runtimeClient.query(
      `
        insert into tge.audit_events (
          tenant_id, id, event_type, subject_id, payload,
          occurred_at, retain_until
        ) values ($1, 'runtime-audit', 'TEST_EVENT', $2, '{}'::jsonb, $3, $4)
      `,
      [
        tenantA,
        "auth0|member-a",
        "2026-01-01T00:00:00.000Z",
        "2027-02-01T00:00:00.000Z"
      ]
    );
    await runtimeClient.query("commit");

    for (const statement of [
      "update tge.audit_events set event_type = 'TAMPERED' where id = 'runtime-audit'",
      "delete from tge.audit_events where id = 'runtime-audit'"
    ]) {
      await runtimeClient.query("begin");
      await runtimeClient.query("select tge.set_request_context($1, $2)", [
        tenantA,
        "auth0|member-a"
      ]);
      await assertSqlState(runtimeClient.query(statement), "42501");
      await runtimeClient.query("rollback");
    }
  });

  test("membership roles and RevenueAction active identity constraints are exact", async () => {
    await assertSqlState(
      adminClient.query(
        `
          insert into tge.tenant_memberships (tenant_id, subject_id, role)
          values ($1, 'auth0|invalid', 'VIEWER')
        `,
        [tenantA]
      ),
      "23514"
    );

    const identity = {
      opportunityId: "opp-known",
      actionType: "QUALIFY_DEAL",
      fingerprint: "a".repeat(64)
    };
    await insertRevenueAction(adminClient, tenantA, {
      id: "active-identity",
      status: "RECOMMENDED",
      ...identity
    });
    await assertSqlState(
      insertRevenueAction(adminClient, tenantA, {
        id: "failed-duplicate",
        status: "FAILED",
        ...identity
      }),
      "23505"
    );
    await insertRevenueAction(adminClient, tenantA, {
      id: "terminal-repeat-one",
      status: "EXECUTED",
      ...identity
    });
    await insertRevenueAction(adminClient, tenantA, {
      id: "terminal-repeat-two",
      status: "EXECUTED",
      ...identity
    });
    await insertRevenueAction(adminClient, tenantA, {
      id: "second-active-same-opportunity",
      status: "RECOMMENDED",
      opportunityId: identity.opportunityId,
      actionType: "FOLLOW_UP",
      fingerprint: "b".repeat(64)
    });
  });

  test("issuer-bound membership and assisted invitation consumption fail closed", async () => {
    const issuer = "https://pilot.au.auth0.com/";
    const subject = "auth0|invited-member";
    const tokenHash = "c".repeat(64);
    const mismatchHash = "d".repeat(64);

    await adminClient.query(
      `
        insert into tge.assisted_invitations (
          tenant_id, token_hash, normalized_email, intended_role,
          expected_identity_issuer, expected_subject_id,
          created_by_subject_id, expires_at
        ) values
          ($1, $2, 'invited@example.test', 'MEMBER', $3, $4,
           'auth0|owner-a', now() + interval '1 hour'),
          ($1, $5, 'mismatch@example.test', 'ADMIN', $3, 'auth0|expected-other',
           'auth0|owner-a', now() + interval '1 hour')
      `,
      [tenantA, tokenHash, issuer, subject, mismatchHash]
    );

    assert.equal(
      (
        await runtimeClient.query(
          "select tge.invitation_available($1) as available",
          [tokenHash]
        )
      ).rows[0].available,
      true
    );

    const consumed = await runtimeClient.query(
      `
        select resolved_tenant_id, resolved_role
        from tge.consume_assisted_invitation($1, $2, $3, $4, $5)
      `,
      [tokenHash, issuer, subject, "membership-auth-audit", "invitation-auth-audit"]
    );
    assert.deepEqual(consumed.rows, [{
      resolved_tenant_id: tenantA,
      resolved_role: "MEMBER"
    }]);

    const replay = await runtimeClient.query(
      `
        select resolved_tenant_id, resolved_role
        from tge.consume_assisted_invitation($1, $2, $3, $4, $5)
      `,
      [tokenHash, issuer, subject, "membership-replay-audit", "invitation-replay-audit"]
    );
    assert.deepEqual(replay.rows, []);

    const mismatch = await runtimeClient.query(
      `
        select resolved_tenant_id, resolved_role
        from tge.consume_assisted_invitation($1, $2, $3, $4, $5)
      `,
      [mismatchHash, issuer, subject, "membership-mismatch-audit", "invitation-mismatch-audit"]
    );
    assert.deepEqual(mismatch.rows, []);

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_identity_context($1, $2)", [
      issuer,
      subject
    ]);
    const memberships = await runtimeClient.query(
      `
        select tenant_id, identity_issuer, subject_id, role, status
        from tge.tenant_memberships
        where identity_issuer = $1 and subject_id = $2
      `,
      [issuer, subject]
    );
    await runtimeClient.query("commit");
    assert.deepEqual(memberships.rows, [{
      tenant_id: tenantA,
      identity_issuer: issuer,
      subject_id: subject,
      role: "MEMBER",
      status: "ACTIVE"
    }]);

    const evidence = await adminClient.query(
      `
        select event_type
        from tge.audit_events
        where id in ('membership-auth-audit', 'invitation-auth-audit')
        order by event_type
      `
    );
    assert.deepEqual(
      evidence.rows.map(row => row.event_type),
      ["INVITATION_CONSUMED", "MEMBERSHIP_ACTIVATED"]
    );
    assert.equal(
      (
        await adminClient.query(
          "select status from tge.assisted_invitations where token_hash = $1",
          [mismatchHash]
        )
      ).rows[0].status,
      "PENDING"
    );
  });

  test("concurrent invitations serialize activation by issuer and subject", async () => {
    const issuer = "https://pilot.au.auth0.com/";
    const subject = "auth0|concurrent-invite";
    const tokenHashes = ["e".repeat(64), "f".repeat(64)];
    const barrierLock = [17497, 4];
    const secondRuntimeClient = new Client({ connectionString: runtimeUrl });
    let barrierHeld = false;
    let consumeAttempts = [];

    await secondRuntimeClient.connect();
    try {
      await adminClient.query(
        `
          create function tge.test_invitation_activation_barrier()
          returns trigger
          language plpgsql
          as $$
          begin
            if new.identity_issuer = 'https://pilot.au.auth0.com/'
              and new.subject_id = 'auth0|concurrent-invite' then
              perform pg_advisory_xact_lock(17497, 4);
            end if;
            return new;
          end
          $$;

          create trigger test_invitation_activation_barrier
          before insert on tge.tenant_memberships
          for each row execute function tge.test_invitation_activation_barrier();
        `
      );
      await adminClient.query(
        `
          insert into tge.assisted_invitations (
            tenant_id, token_hash, normalized_email, intended_role,
            expected_identity_issuer, expected_subject_id,
            created_by_subject_id, expires_at
          ) values
            ($1, $3, 'concurrent-a@example.test', 'MEMBER', $5, $6,
             'auth0|owner-a', now() + interval '1 hour'),
            ($2, $4, 'concurrent-b@example.test', 'MEMBER', $5, $6,
             'auth0|owner-b', now() + interval '1 hour')
        `,
        [tenantA, tenantB, ...tokenHashes, issuer, subject]
      );

      await adminClient.query("select pg_advisory_lock($1, $2)", barrierLock);
      barrierHeld = true;

      const runtimePids = await Promise.all([
        runtimeClient.query("select pg_backend_pid()::int as pid"),
        secondRuntimeClient.query("select pg_backend_pid()::int as pid")
      ]);
      const consumeSql = `
        select resolved_tenant_id, resolved_role
        from tge.consume_assisted_invitation($1, $2, $3, $4, $5)
      `;
      consumeAttempts = [
        runtimeClient.query(consumeSql, [
          tokenHashes[0], issuer, subject,
          "membership-concurrency-audit-a", "invitation-concurrency-audit-a"
        ]),
        secondRuntimeClient.query(consumeSql, [
          tokenHashes[1], issuer, subject,
          "membership-concurrency-audit-b", "invitation-concurrency-audit-b"
        ])
      ];

      await waitForLockWaiters(
        adminClient,
        runtimePids.map(result => result.rows[0].pid)
      );
      await adminClient.query("select pg_advisory_unlock($1, $2)", barrierLock);
      barrierHeld = false;

      const results = await Promise.all(consumeAttempts);
      consumeAttempts = [];
      assert.deepEqual(
        results.map(result => result.rows.length).sort(),
        [0, 1]
      );
      const activated = results.flatMap(result => result.rows);
      assert.equal(activated[0].resolved_role, "MEMBER");
      assert.ok(
        [tenantA, tenantB].includes(activated[0].resolved_tenant_id),
        "one invited tenant wins activation"
      );

      const memberships = await adminClient.query(
        `
          select tenant_id, role, status
          from tge.tenant_memberships
          where identity_issuer = $1 and subject_id = $2
        `,
        [issuer, subject]
      );
      assert.equal(memberships.rows.length, 1);
      assert.deepEqual(memberships.rows[0], {
        tenant_id: activated[0].resolved_tenant_id,
        role: "MEMBER",
        status: "ACTIVE"
      });

      const invitations = await adminClient.query(
        `
          select status
          from tge.assisted_invitations
          where token_hash = any($1::text[])
          order by status
        `,
        [tokenHashes]
      );
      assert.deepEqual(
        invitations.rows.map(row => row.status),
        ["CONSUMED", "PENDING"]
      );

      const evidence = await adminClient.query(
        `
          select event_type
          from tge.audit_events
          where id like '%-concurrency-audit-%'
          order by event_type
        `
      );
      assert.deepEqual(
        evidence.rows.map(row => row.event_type),
        ["INVITATION_CONSUMED", "MEMBERSHIP_ACTIVATED"]
      );
    } finally {
      if (barrierHeld) {
        await adminClient.query("select pg_advisory_unlock($1, $2)", barrierLock);
      }
      if (consumeAttempts.length > 0) {
        await Promise.allSettled(consumeAttempts);
      }
      await secondRuntimeClient.end();
      await adminClient.query(
        `
          drop trigger if exists test_invitation_activation_barrier
            on tge.tenant_memberships;
          drop function if exists tge.test_invitation_activation_barrier();
        `
      );
    }
  });

  test("RevenueAction effect links are reciprocal, opportunity-scoped, and singular", async () => {
    const runtimeClient = adminClient;
    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await runtimeClient.query(
      `
        insert into tge.opportunities (
          tenant_id, id, business_name, stage, commercial_value_state
        ) values ($1, 'opp-effect-other', 'Other effect opportunity', 'NEW', 'MISSING')
      `,
      [tenantA]
    );
    await insertRevenueAction(runtimeClient, tenantA, {
      id: "effect-valid",
      status: "EXECUTED",
      opportunityId: "opp-known",
      actionType: "EFFECT_VALID",
      fingerprint: "1".repeat(64),
      resultingTaskId: "effect-valid-task",
      resultingActivityId: "effect-valid-activity"
    });
    await runtimeClient.query(
      `
        insert into tge.tasks (
          tenant_id, id, opportunity_id, revenue_action_id, title, status
        ) values ($1, 'effect-valid-task', 'opp-known', 'effect-valid', 'Valid effect', 'OPEN')
      `,
      [tenantA]
    );
    await runtimeClient.query(
      `
        insert into tge.activities (
          tenant_id, id, opportunity_id, revenue_action_id, type, description
        ) values ($1, 'effect-valid-activity', 'opp-known', 'effect-valid', 'ACTION_EXECUTED', 'Valid effect')
      `,
      [tenantA]
    );
    await runtimeClient.query("commit");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await insertRevenueAction(runtimeClient, tenantA, {
      id: "effect-valid-update",
      status: "EXECUTED",
      opportunityId: "opp-known",
      actionType: "EFFECT_VALID_UPDATE",
      fingerprint: "9".repeat(64)
    });
    await runtimeClient.query(
      `
        insert into tge.tasks (
          tenant_id, id, opportunity_id, title, status
        ) values ($1, 'effect-valid-update-task', 'opp-known', 'Update effect', 'OPEN')
      `,
      [tenantA]
    );
    await runtimeClient.query(
      `
        insert into tge.activities (
          tenant_id, id, opportunity_id, type, description
        ) values ($1, 'effect-valid-update-activity', 'opp-known', 'ACTION_EXECUTED', 'Update effect')
      `,
      [tenantA]
    );
    await runtimeClient.query("commit");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await runtimeClient.query(
      `
        update tge.revenue_actions
        set resulting_task_id = 'effect-valid-update-task',
          resulting_activity_id = 'effect-valid-update-activity'
        where tenant_id = $1 and id = 'effect-valid-update'
      `,
      [tenantA]
    );
    await runtimeClient.query(
      `
        update tge.tasks
        set revenue_action_id = 'effect-valid-update'
        where tenant_id = $1 and id = 'effect-valid-update-task'
      `,
      [tenantA]
    );
    await runtimeClient.query(
      `
        update tge.activities
        set revenue_action_id = 'effect-valid-update'
        where tenant_id = $1 and id = 'effect-valid-update-activity'
      `,
      [tenantA]
    );
    await runtimeClient.query("commit");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await insertRevenueAction(runtimeClient, tenantA, {
      id: "effect-cross-opportunity",
      status: "RECOMMENDED",
      opportunityId: "opp-known",
      actionType: "EFFECT_CROSS_OPPORTUNITY",
      fingerprint: "2".repeat(64),
      resultingTaskId: "effect-cross-opportunity-task"
    });
    await runtimeClient.query(
      `
        insert into tge.tasks (
          tenant_id, id, opportunity_id, revenue_action_id, title, status
        ) values (
          $1, 'effect-cross-opportunity-task', 'opp-effect-other',
          'effect-cross-opportunity', 'Cross opportunity', 'OPEN'
        )
      `,
      [tenantA]
    );
    await assertSqlState(runtimeClient.query("commit"), "23503");
    await runtimeClient.query("rollback");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await insertRevenueAction(runtimeClient, tenantA, {
      id: "effect-one-sided-action",
      status: "RECOMMENDED",
      opportunityId: "opp-known",
      actionType: "EFFECT_ONE_SIDED_ACTION",
      fingerprint: "3".repeat(64)
    });
    await runtimeClient.query(
      `
        insert into tge.tasks (
          tenant_id, id, opportunity_id, revenue_action_id, title, status
        ) values (
          $1, 'effect-one-sided-task', 'opp-known',
          'effect-one-sided-action', 'One-sided task', 'OPEN'
        )
      `,
      [tenantA]
    );
    await assertSqlState(runtimeClient.query("commit"), "23503");
    await runtimeClient.query("rollback");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await insertRevenueAction(runtimeClient, tenantA, {
      id: "effect-one-sided-result",
      status: "RECOMMENDED",
      opportunityId: "opp-known",
      actionType: "EFFECT_ONE_SIDED_RESULT",
      fingerprint: "4".repeat(64),
      resultingActivityId: "effect-one-sided-activity"
    });
    await runtimeClient.query(
      `
        insert into tge.activities (
          tenant_id, id, opportunity_id, type, description
        ) values (
          $1, 'effect-one-sided-activity', 'opp-known',
          'ACTION_EXECUTED', 'Missing action backlink'
        )
      `,
      [tenantA]
    );
    await assertSqlState(runtimeClient.query("commit"), "23503");
    await runtimeClient.query("rollback");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await insertRevenueAction(runtimeClient, tenantA, {
      id: "effect-mismatch-owner",
      status: "RECOMMENDED",
      opportunityId: "opp-known",
      actionType: "EFFECT_MISMATCH_OWNER",
      fingerprint: "5".repeat(64),
      resultingTaskId: "effect-mismatch-task"
    });
    await insertRevenueAction(runtimeClient, tenantA, {
      id: "effect-mismatch-backlink",
      status: "RECOMMENDED",
      opportunityId: "opp-known",
      actionType: "EFFECT_MISMATCH_BACKLINK",
      fingerprint: "6".repeat(64)
    });
    await runtimeClient.query(
      `
        insert into tge.tasks (
          tenant_id, id, opportunity_id, revenue_action_id, title, status
        ) values (
          $1, 'effect-mismatch-task', 'opp-known',
          'effect-mismatch-backlink', 'Mismatched backlink', 'OPEN'
        )
      `,
      [tenantA]
    );
    await assertSqlState(runtimeClient.query("commit"), "23503");
    await runtimeClient.query("rollback");

    for (const effectType of ["task", "activity"]) {
      await runtimeClient.query("begin");
      await runtimeClient.query("select tge.set_request_context($1, $2)", [
        tenantA,
        "auth0|owner-a"
      ]);
      const actionId = `effect-duplicate-${effectType}`;
      const firstEffectId = `${actionId}-one`;
      await insertRevenueAction(runtimeClient, tenantA, {
        id: actionId,
        status: "RECOMMENDED",
        opportunityId: "opp-known",
        actionType: `EFFECT_DUPLICATE_${effectType.toUpperCase()}`,
        fingerprint: (effectType === "task" ? "7" : "8").repeat(64),
        resultingTaskId: effectType === "task" ? firstEffectId : null,
        resultingActivityId: effectType === "activity" ? firstEffectId : null
      });
      if (effectType === "task") {
        await runtimeClient.query(
          `
            insert into tge.tasks (
              tenant_id, id, opportunity_id, revenue_action_id, title, status
            ) values ($1, $2, 'opp-known', $3, 'First task', 'OPEN')
          `,
          [tenantA, firstEffectId, actionId]
        );
        await assertSqlState(
          runtimeClient.query(
            `
              insert into tge.tasks (
                tenant_id, id, opportunity_id, revenue_action_id, title, status
              ) values ($1, $2, 'opp-known', $3, 'Duplicate task', 'OPEN')
            `,
            [tenantA, `${actionId}-two`, actionId]
          ),
          "23505"
        );
      } else {
        await runtimeClient.query(
          `
            insert into tge.activities (
              tenant_id, id, opportunity_id, revenue_action_id, type
            ) values ($1, $2, 'opp-known', $3, 'ACTION_EXECUTED')
          `,
          [tenantA, firstEffectId, actionId]
        );
        await assertSqlState(
          runtimeClient.query(
            `
              insert into tge.activities (
                tenant_id, id, opportunity_id, revenue_action_id, type
              ) values ($1, $2, 'opp-known', $3, 'ACTION_EXECUTED')
            `,
            [tenantA, `${actionId}-two`, actionId]
          ),
          "23505"
        );
      }
      await runtimeClient.query("rollback");
    }
  });

  test("runtime SQL cannot fabricate or rewrite RevenueAction and linked-effect history", async () => {
    const at = "2026-08-30T05:00:00.000Z";
    await adminClient.query("begin");
    try {
      await insertRevenueAction(adminClient, tenantA, {
        id: "runtime-protected-action",
        status: "EXECUTED",
        opportunityId: "opp-known",
        actionType: "FOLLOW_UP",
        fingerprint: "d".repeat(64),
        resultingTaskId: "runtime-protected-task",
        resultingActivityId: "runtime-protected-activity"
      });
      await adminClient.query(
        `insert into tge.tasks (
           tenant_id, id, opportunity_id, revenue_action_id, title, status,
           metadata, current_payload, created_at, updated_at
         ) values ($1, 'runtime-protected-task', 'opp-known',
           'runtime-protected-action', 'Protected task', 'OPEN', $2::jsonb,
           $3::jsonb, $4, $4)`,
        [
          tenantA,
          JSON.stringify({
            source: "revenue_action",
            revenue_action_id: "runtime-protected-action",
            action_type: "FOLLOW_UP",
            execution_effect_type: "INTERNAL_TASK",
            normalized_title: "protected task",
            semantic_task_key: "opp-known:FOLLOW_UP:protected task"
          }),
          JSON.stringify({
            id: "runtime-protected-task",
            opportunity_id: "opp-known",
            title: "Protected task",
            status: "OPEN"
          }),
          at
        ]
      );
      await adminClient.query(
        `insert into tge.activities (
           tenant_id, id, opportunity_id, revenue_action_id, type,
           description, metadata, current_payload, created_at, updated_at
         ) values ($1, 'runtime-protected-activity', 'opp-known',
           'runtime-protected-action', 'REVENUE_ACTION_TASK_EXECUTED',
           'Protected activity', $2::jsonb, $3::jsonb, $4, $4)`,
        [
          tenantA,
          JSON.stringify({
            source: "revenue_action",
            revenue_action_id: "runtime-protected-action",
            action_type: "FOLLOW_UP",
            action_key: "revenue-action:runtime-protected-action",
            execution_mode: "SYSTEM_INTERNAL",
            execution_effect_type: "INTERNAL_TASK",
            task_id: "runtime-protected-task"
          }),
          JSON.stringify({
            id: "runtime-protected-activity",
            opportunity_id: "opp-known",
            type: "REVENUE_ACTION_TASK_EXECUTED"
          }),
          at
        ]
      );
      await insertRevenueAction(adminClient, tenantA, {
        id: "runtime-audit-protected",
        status: "RECOMMENDED",
        opportunityId: "opp-known",
        actionType: "FOLLOW_UP",
        fingerprint: "e".repeat(64)
      });
      await adminClient.query(
        `update tge.revenue_actions
         set audit = $3::jsonb, updated_at = $4
         where tenant_id = $1 and id = $2`,
        [
          tenantA,
          "runtime-audit-protected",
          JSON.stringify([{
            transition: "CREATED_AS_RECOMMENDED",
            at,
            source: "TEST"
          }]),
          at
        ]
      );
      for (const [id, taskId, activityId] of [
        ["runtime-executing-failure-guard", null, null],
        [
          "runtime-executing-outcome-guard",
          "runtime-outcome-task",
          "runtime-outcome-activity"
        ]
      ]) {
        await insertRevenueAction(adminClient, tenantA, {
          id,
          status: "RECOMMENDED",
          opportunityId: "opp-known",
          actionType: "CREATE_TASK",
          fingerprint: (id.includes("failure") ? "b" : "c").repeat(64)
        });
        await adminClient.query(
          `update tge.revenue_actions
           set status = 'EXECUTING',
             proposed_execution = $3::jsonb,
             execution_request = $4::jsonb,
             execution_attempts = 1,
             prepared_at = $5,
             approved_at = $6,
             resulting_task_id = $7,
             resulting_activity_id = $8,
             audit = $9::jsonb,
             updated_at = $10
           where tenant_id = $1 and id = $2`,
          [
            tenantA,
            id,
            JSON.stringify({ type: "INTERNAL_TASK", title: "Protected task" }),
            JSON.stringify({
              mode: "SYSTEM_INTERNAL",
              requested_at: "2026-08-30T05:03:00.000Z"
            }),
            "2026-08-30T05:01:00.000Z",
            "2026-08-30T05:02:00.000Z",
            taskId,
            activityId,
            JSON.stringify([
              { transition: "CREATED_AS_RECOMMENDED", at, source: "TEST" },
              { transition: "PREPARED", at: "2026-08-30T05:01:00.000Z" },
              {
                transition: "APPROVED",
                approval: "HUMAN",
                at: "2026-08-30T05:02:00.000Z"
              },
              {
                transition: "EXECUTION_STARTED",
                attempt: 1,
                at: "2026-08-30T05:03:00.000Z"
              }
            ]),
            "2026-08-30T05:03:00.000Z"
          ]
        );
      }
      await adminClient.query(
        `insert into tge.tasks (
           tenant_id, id, opportunity_id, revenue_action_id, title, status,
           metadata, current_payload, created_at, updated_at
         ) values ($1, 'runtime-outcome-task', 'opp-known',
           'runtime-executing-outcome-guard', 'Protected task', 'OPEN',
           $2::jsonb, '{}'::jsonb, $3, $3)`,
        [
          tenantA,
          JSON.stringify({
            source: "revenue_action",
            revenue_action_id: "runtime-executing-outcome-guard",
            action_type: "CREATE_TASK",
            execution_effect_type: "INTERNAL_TASK",
            normalized_title: "protected task",
            semantic_task_key: "opp-known:CREATE_TASK:protected task"
          }),
          "2026-08-30T05:03:00.000Z"
        ]
      );
      await adminClient.query(
        `insert into tge.activities (
           tenant_id, id, opportunity_id, revenue_action_id, type,
           description, metadata, current_payload, created_at, updated_at
         ) values ($1, 'runtime-outcome-activity', 'opp-known',
           'runtime-executing-outcome-guard', 'REVENUE_ACTION_TASK_EXECUTED',
           'Protected activity', $2::jsonb, '{}'::jsonb, $3, $3)`,
        [
          tenantA,
          JSON.stringify({
            source: "revenue_action",
            revenue_action_id: "runtime-executing-outcome-guard",
            action_type: "CREATE_TASK",
            action_key: "revenue-action:runtime-executing-outcome-guard",
            execution_mode: "SYSTEM_INTERNAL",
            execution_effect_type: "INTERNAL_TASK",
            task_id: "runtime-outcome-task"
          }),
          "2026-08-30T05:03:00.000Z"
        ]
      );
      await adminClient.query("commit");
    } catch (error) {
      await adminClient.query("rollback");
      throw error;
    }

    async function asRuntime(statement, expectedCode, values = []) {
      await runtimeClient.query("begin");
      await runtimeClient.query("select tge.set_request_context($1, $2)", [
        tenantA,
        "auth0|owner-a"
      ]);
      await assertSqlState(runtimeClient.query(statement, values), expectedCode);
      await runtimeClient.query("rollback");
    }

    await asRuntime(
      `insert into tge.revenue_actions (
         tenant_id, id, opportunity_id, action_type, execution_type,
         approval_requirement, risk_class, status, title, reason, evidence,
         recommendation_snapshot, basis_fingerprint, source, audit,
         prepared_at, approved_at, executed_at
       ) values ($1, 'runtime-terminal-fabrication', 'opp-known', 'FOLLOW_UP',
         'COMMUNICATION_DRAFT', 'HUMAN', 'EXTERNAL_CONSEQUENTIAL', 'EXECUTED',
         'Fabricated', 'Fabricated', '{"factual":{},"derived":{}}'::jsonb,
         '{}'::jsonb, $2, 'DEAL_INTELLIGENCE', '[]'::jsonb, $3, $3, $3)`,
      "23514",
      [tenantA, "f".repeat(64), at]
    );
    await asRuntime(
      `insert into tge.revenue_actions (
         tenant_id, id, opportunity_id, action_type, execution_type,
         approval_requirement, risk_class, status, title, reason, evidence,
         recommendation_snapshot, basis_fingerprint, source, audit
       ) values ($1, 'runtime-malformed-fabrication', 'opp-known', 'FOLLOW_UP',
         'COMMUNICATION_DRAFT', 'HUMAN', 'EXTERNAL_CONSEQUENTIAL', 'RECOMMENDED',
         'Fabricated', 'Fabricated', '{}'::jsonb, '{}'::jsonb, $2,
         'DEAL_INTELLIGENCE', '[]'::jsonb)`,
      "23514",
      [tenantA, "a".repeat(64)]
    );
    await asRuntime(
      "delete from tge.revenue_actions where tenant_id = $1 and id = 'runtime-protected-action'",
      "42501",
      [tenantA]
    );
    await asRuntime(
      `update tge.revenue_actions set evidence = '{}'::jsonb
       where tenant_id = $1 and id = 'runtime-audit-protected'`,
      "42501",
      [tenantA]
    );
    await asRuntime(
      `update tge.revenue_actions set audit = '[]'::jsonb,
         updated_at = $2
       where tenant_id = $1 and id = 'runtime-audit-protected'`,
      "23514",
      [tenantA, "2026-08-30T05:01:00.000Z"]
    );
    await asRuntime(
      `update tge.revenue_actions
       set status = 'CANCELLED',
         proposed_execution = '{"type":"INTERNAL_TASK"}'::jsonb,
         execution_request = $2::jsonb,
         execution_result = $3::jsonb,
         execution_attempts = 1,
         failed_at = $4,
         resulting_task_id = 'smuggled-task',
         resulting_activity_id = 'smuggled-activity',
         cancelled_at = $5,
         audit = audit || $6::jsonb,
         updated_at = $5
       where tenant_id = $1 and id = 'runtime-audit-protected'`,
      "23514",
      [
        tenantA,
        JSON.stringify({
          mode: "SYSTEM_INTERNAL",
          requested_at: "2026-08-30T05:00:30.000Z"
        }),
        JSON.stringify({
          mode: "SYSTEM_INTERNAL",
          outcome: "FAILED",
          external_send_performed: false,
          error: "SMUGGLED_FAILURE"
        }),
        "2026-08-30T05:00:45.000Z",
        "2026-08-30T05:01:00.000Z",
        JSON.stringify([{
          transition: "CANCELLED",
          at: "2026-08-30T05:01:00.000Z"
        }])
      ]
    );
    await asRuntime(
      `update tge.revenue_actions
       set status = 'PREPARED',
         proposed_execution = '{"type":"INTERNAL_TASK"}'::jsonb,
         prepared_at = $2,
         audit = audit || $3::jsonb,
         updated_at = $2
       where tenant_id = $1 and id = 'runtime-audit-protected'`,
      "23514",
      [
        tenantA,
        "2026-08-30T05:01:00.000Z",
        JSON.stringify([{
          transition: "APPROVED",
          approval: "HUMAN",
          at: "2026-08-30T05:01:00.000Z"
        }])
      ]
    );
    await asRuntime(
      `update tge.revenue_actions
       set status = 'FAILED',
         execution_result = $2::jsonb,
         failed_at = $3,
         audit = audit || $4::jsonb,
         updated_at = $3
       where tenant_id = $1 and id = 'runtime-executing-failure-guard'`,
      "23514",
      [
        tenantA,
        JSON.stringify({
          mode: "SYSTEM_INTERNAL",
          outcome: "FAILED",
          external_send_performed: false,
          error: "DIFFERENT_FAILURE"
        }),
        "2026-08-30T05:04:00.000Z",
        JSON.stringify([{
          transition: "FAILED",
          error: "EXPECTED_FAILURE",
          at: "2026-08-30T05:04:00.000Z"
        }])
      ]
    );
    await asRuntime(
      `update tge.revenue_actions
       set status = 'EXECUTED',
         execution_result = $2::jsonb,
         executed_at = $3,
         audit = audit || $4::jsonb,
         updated_at = $3
       where tenant_id = $1 and id = 'runtime-executing-outcome-guard'`,
      "23514",
      [
        tenantA,
        JSON.stringify({
          mode: "SYSTEM_INTERNAL",
          outcome: "TASK_REUSED",
          external_send_performed: false
        }),
        "2026-08-30T05:04:00.000Z",
        JSON.stringify([{
          transition: "EXECUTED",
          execution_mode: "SYSTEM_INTERNAL",
          resulting_task_id: "runtime-outcome-task",
          resulting_activity_id: "runtime-outcome-activity",
          at: "2026-08-30T05:04:00.000Z"
        }])
      ]
    );
    await asRuntime(
      `update tge.revenue_actions set resulting_task_id = 'rewritten-task',
         audit = audit || $2::jsonb, updated_at = $3
       where tenant_id = $1 and id = 'runtime-protected-action'`,
      "23514",
      [
        tenantA,
        JSON.stringify([{ transition: "TAMPERED", at }]),
        "2026-08-30T05:01:00.000Z"
      ]
    );
    await asRuntime(
      `update tge.tasks set title = 'Rewritten'
       where tenant_id = $1 and id = 'runtime-protected-task'`,
      "23514",
      [tenantA]
    );
    await asRuntime(
      "delete from tge.tasks where tenant_id = $1 and id = 'runtime-protected-task'",
      "23514",
      [tenantA]
    );
    await asRuntime(
      `update tge.activities set description = 'Rewritten'
       where tenant_id = $1 and id = 'runtime-protected-activity'`,
      "23514",
      [tenantA]
    );
    await asRuntime(
      "delete from tge.activities where tenant_id = $1 and id = 'runtime-protected-activity'",
      "23514",
      [tenantA]
    );
    await asRuntime(
      `update tge.prospects set live_ordinal = live_ordinal + 1
       where tenant_id = $1 and id = 'prospect-known'`,
      "23514",
      [tenantA]
    );

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await runtimeClient.query(
      `update tge.tasks set status = 'COMPLETED', completed_at = $2,
         updated_at = $2,
         current_payload = current_payload || $3::jsonb
       where tenant_id = $1 and id = 'runtime-protected-task'`,
      [
        tenantA,
        "2026-08-30T05:02:00.000Z",
        JSON.stringify({
          status: "COMPLETED",
          completed_at: "2026-08-30T05:02:00.000Z",
          updated_at: "2026-08-30T05:02:00.000Z"
        })
      ]
    );
    await runtimeClient.query("commit");

    const protections = await adminClient.query(
      `select
         bool_and(c.relforcerowsecurity) as all_rls_forced,
         bool_and(not p.prosecdef) as all_invoker,
         bool_and(not has_function_privilege($1::text, p.oid, 'EXECUTE')) as runtime_cannot_execute
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral (
         select relforcerowsecurity from pg_class
         where oid = any(array[
           'tge.prospects'::regclass,
           'tge.opportunities'::regclass,
           'tge.tasks'::regclass,
           'tge.activities'::regclass,
           'tge.revenue_actions'::regclass,
           'tge.revenue_leak_cases'::regclass
         ])
       ) c
       where n.nspname = 'tge'
         and p.proname in (
           'assign_live_ordinal',
           'guard_runtime_source_evidence',
           'guard_runtime_revenue_action',
           'guard_runtime_revenue_action_effect',
           'guard_runtime_revenue_action_lifecycle',
           'guard_runtime_revenue_action_cancellation',
           'guard_runtime_revenue_leak_case_history'
         )`,
      [runtimeRole]
    );
    assert.deepEqual(protections.rows[0], {
      all_rls_forced: true,
      all_invoker: true,
      runtime_cannot_execute: true
    });
  });

  test("import and audit foundations are tenant-scoped and append-oriented", async () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await runtimeClient.query(
      `
        insert into tge.prospects (tenant_id, id, business_name)
        values ($1, 'prospect-unmapped', 'Unmapped Prospect')
      `,
      [tenantA]
    );
    await runtimeClient.query(
      `
        insert into tge.import_batches (
          tenant_id, id, status, source_filename, source_sha256,
          authorized_by_subject_id, authorization_verified_at,
          preview_summary, conflict_summary, raw_storage_key, raw_expires_at,
          metadata_retain_until, created_at, updated_at
        ) values (
          $1, 'batch-1', 'PREVIEWED', 'legacy.json', $2, $3, $4,
          '{"records":1}'::jsonb, '{"ambiguous":0}'::jsonb,
          'raw/batch-1', $5, $6, $4, $4
        )
      `,
      [
        tenantA,
        "c".repeat(64),
        "auth0|owner-a",
        createdAt,
        "2026-01-08T00:00:00.000Z",
        "2027-02-01T00:00:00.000Z"
      ]
    );
    const rawPayload = { id: "prospect-known", business_name: "Known Trade Co" };
    await runtimeClient.query(
      `
        insert into tge.import_staging_records (
          tenant_id, import_batch_id, id, source_collection, source_id,
          source_ordinal, raw_payload, raw_payload_sha256, disposition,
          idempotency_key
        ) values ($1, 'batch-1', 'stage-1', 'prospects', 'prospect-known', 0,
          $2::jsonb, $3, 'ACCEPT', 'prospects:prospect-known')
      `,
      [tenantA, JSON.stringify(rawPayload), sha256(JSON.stringify(rawPayload))]
    );
    await runtimeClient.query(
      `
        insert into tge.import_id_map (
          tenant_id, import_batch_id, source_collection, source_id,
          source_ordinal, target_prospect_id
        ) values ($1, 'batch-1', 'prospects', 'prospect-known',
          0, 'prospect-known')
      `,
      [tenantA]
    );

    const typedTargets = [
      ["opportunities", "opp-known", "target_opportunity_id"],
      ["tasks", "task-known-open-earlier", "target_task_id"],
      ["activities", "activity-known-earlier", "target_activity_id"],
      ["revenue_actions", "action-history-executed", "target_revenue_action_id"]
    ];
    for (const [collection, targetId, targetColumn] of typedTargets) {
      await runtimeClient.query(
        `
          insert into tge.import_staging_records (
            tenant_id, import_batch_id, id, source_collection, source_id,
            source_ordinal, raw_payload_sha256, disposition, idempotency_key
          ) values ($1, 'batch-1', $2, $3, $4, 0, $5, 'ACCEPT', $6)
        `,
        [
          tenantA,
          `stage-${collection}`,
          collection,
          targetId,
          "9".repeat(64),
          `${collection}:${targetId}`
        ]
      );
      await runtimeClient.query(
        `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal, ${targetColumn}
          ) values ($1, 'batch-1', $2, $3, 0, $3)
        `,
        [tenantA, collection, targetId]
      );
    }
    await runtimeClient.query("commit");

    for (const statement of [
      "update tge.import_batches set status = 'READY' where id = 'batch-1'",
      "delete from tge.import_batches where id = 'batch-1'",
      "update tge.import_staging_records set disposition = 'REJECT' where import_batch_id = 'batch-1'",
      "delete from tge.import_staging_records where import_batch_id = 'batch-1'",
      "update tge.import_id_map set metadata = '{\"tampered\":true}'::jsonb where import_batch_id = 'batch-1'",
      "delete from tge.import_id_map where import_batch_id = 'batch-1'"
    ]) {
      await runtimeClient.query("begin");
      await runtimeClient.query("select tge.set_request_context($1, $2)", [
        tenantA,
        "auth0|owner-a"
      ]);
      await assertSqlState(runtimeClient.query(statement), "42501");
      await runtimeClient.query("rollback");
    }

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await assertSqlState(
      runtimeClient.query(
        `
          insert into tge.import_staging_records (
            tenant_id, import_batch_id, id, source_collection, source_id,
            source_ordinal, raw_payload_sha256, disposition, idempotency_key
          ) values ($1, 'batch-1', 'stage-duplicate', 'prospects', 'another-id', 1,
            $2, 'ACCEPT', 'prospects:prospect-known')
        `,
        [tenantA, "e".repeat(64)]
      ),
      "23505"
    );
    await runtimeClient.query("rollback");

    await assertSqlState(
      adminClient.query(
        `
          insert into tge.import_batches (
            tenant_id, id, status, source_filename, source_sha256,
            authorized_by_subject_id, authorization_verified_at,
            raw_expires_at, metadata_retain_until, created_at, updated_at
          ) values ($1, 'invalid-committed-batch', 'COMMITTED', 'legacy.json', $2,
            'auth0|owner-a', $3, $4, $5, $3, $3)
        `,
        [
          tenantA,
          "f".repeat(64),
          createdAt,
          "2026-01-08T00:00:00.000Z",
          "2027-02-01T00:00:00.000Z"
        ]
      ),
      "23514"
    );

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    for (const [ordinal, sourceId, sourceCollection] of [
      [10, "map-cross-tenant-target", "prospects"],
      [11, "map-missing-target", "prospects"],
      [12, "map-no-target", "prospects"],
      [13, "map-two-targets", "prospects"],
      [14, "map-type-match", "opportunities"],
      [15, "map-duplicate-target", "prospects"]
    ]) {
      await runtimeClient.query(
        `
          insert into tge.import_staging_records (
            tenant_id, import_batch_id, id, source_collection, source_id,
            source_ordinal, raw_payload_sha256, disposition, idempotency_key
          ) values ($1, 'batch-1', $2, $3, $4, $5, $6, 'ACCEPT', $4)
        `,
        [
          tenantA,
          `stage-${sourceId}`,
          sourceCollection,
          sourceId,
          ordinal,
          "a".repeat(64)
        ]
      );
    }

    const rejectedMaps = [
      {
        name: "cross_tenant_target",
        code: "23503",
        sql: `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal, target_prospect_id
          ) values ($1, 'batch-1', 'prospects', 'map-cross-tenant-target',
            10, 'tenant-b-prospect')
        `
      },
      {
        name: "missing_target",
        code: "23503",
        sql: `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal, target_prospect_id
          ) values ($1, 'batch-1', 'prospects', 'map-missing-target',
            11, 'missing-prospect')
        `
      },
      {
        name: "no_typed_target",
        code: "23514",
        sql: `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal
          ) values ($1, 'batch-1', 'prospects', 'map-no-target', 12)
        `
      },
      {
        name: "two_typed_targets",
        code: "23514",
        sql: `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal, target_prospect_id, target_opportunity_id
          ) values ($1, 'batch-1', 'prospects', 'map-two-targets',
            13, 'prospect-known', 'opp-known')
        `
      },
      {
        name: "wrong_typed_target",
        code: "23514",
        sql: `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal, target_task_id
          ) values ($1, 'batch-1', 'opportunities', 'map-type-match',
            14, 'task-known-completed-latest')
        `
      },
      {
        name: "duplicate_target",
        code: "23505",
        sql: `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal, target_prospect_id
          ) values ($1, 'batch-1', 'prospects', 'map-duplicate-target',
            15, 'prospect-known')
        `
      },
      {
        name: "missing_source",
        code: "23503",
        sql: `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal, target_prospect_id
          ) values ($1, 'batch-1', 'prospects', 'map-missing-source',
            99, 'prospect-unmapped')
        `
      }
    ];

    for (const rejectedMap of rejectedMaps) {
      await runtimeClient.query(`savepoint ${rejectedMap.name}`);
      await assertSqlState(
        runtimeClient.query(rejectedMap.sql, [tenantA]),
        rejectedMap.code
      );
      await runtimeClient.query(`rollback to savepoint ${rejectedMap.name}`);
    }

    await runtimeClient.query(
      `
        insert into tge.import_id_map (
          tenant_id, import_batch_id, source_collection, source_id,
          source_ordinal, target_opportunity_id
        ) values ($1, 'batch-1', 'opportunities', 'map-type-match',
          14, 'opp-zero')
      `,
      [tenantA]
    );
    await runtimeClient.query("commit");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantB,
      "auth0|owner-b"
    ]);
    const hidden = await runtimeClient.query(
      "select id from tge.import_batches where id = 'batch-1'"
    );
    assert.deepEqual(hidden.rows, []);
    await runtimeClient.query(
      `
        insert into tge.import_batches (
          tenant_id, id, status, source_filename, source_sha256,
          authorized_by_subject_id, authorization_verified_at,
          raw_expires_at, metadata_retain_until, created_at, updated_at
        ) values ($1, 'batch-cross-source', 'STAGED', 'tenant-b.json', $2,
          'auth0|owner-b', $3, $4, $5, $3, $3)
      `,
      [
        tenantB,
        "b".repeat(64),
        createdAt,
        "2026-01-08T00:00:00.000Z",
        "2027-02-01T00:00:00.000Z"
      ]
    );
    await runtimeClient.query(
      `
        insert into tge.import_staging_records (
          tenant_id, import_batch_id, id, source_collection, source_id,
          source_ordinal, raw_payload_sha256, disposition, idempotency_key
        ) values ($1, 'batch-cross-source', 'tenant-b-source', 'prospects',
          'cross-tenant-source', 0, $2, 'ACCEPT', 'cross-tenant-source')
      `,
      [tenantB, "d".repeat(64)]
    );
    await runtimeClient.query("commit");

    await runtimeClient.query("begin");
    await runtimeClient.query("select tge.set_request_context($1, $2)", [
      tenantA,
      "auth0|owner-a"
    ]);
    await runtimeClient.query(
      `
        insert into tge.import_batches (
          tenant_id, id, status, source_filename, source_sha256,
          authorized_by_subject_id, authorization_verified_at,
          raw_expires_at, metadata_retain_until, created_at, updated_at
        ) values ($1, 'batch-cross-source', 'STAGED', 'tenant-a.json', $2,
          'auth0|owner-a', $3, $4, $5, $3, $3)
      `,
      [
        tenantA,
        "a".repeat(64),
        createdAt,
        "2026-01-08T00:00:00.000Z",
        "2027-02-01T00:00:00.000Z"
      ]
    );
    await assertSqlState(
      runtimeClient.query(
        `
          insert into tge.import_id_map (
            tenant_id, import_batch_id, source_collection, source_id,
            source_ordinal, target_prospect_id
          ) values ($1, 'batch-cross-source', 'prospects',
            'cross-tenant-source', 0, 'prospect-known')
        `,
        [tenantA]
      ),
      "23503"
    );
    await runtimeClient.query("rollback");
  });

  test("essential indexes, forced policies, and least-privilege grants exist", async () => {
    const groupRoles = await adminClient.query(
      `
        select rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole,
          rolcreatedb, rolreplication, rolbypassrls
        from pg_roles
        where rolname in ('tge_owner', 'tge_migrator', 'tge_runtime')
        order by rolname
      `
    );
    assert.deepEqual(groupRoles.rows, [
      {
        rolname: "tge_migrator",
        rolcanlogin: false,
        rolinherit: false,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: false
      },
      {
        rolname: "tge_owner",
        rolcanlogin: false,
        rolinherit: false,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: false
      },
      {
        rolname: "tge_runtime",
        rolcanlogin: false,
        rolinherit: true,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: false
      }
    ]);

    const migrationMembership = await adminClient.query(
      `
        select
          pg_has_role(current_user, 'tge_migrator', 'MEMBER') as login_is_migrator,
          pg_has_role('tge_migrator', 'tge_owner', 'MEMBER') as migrator_can_set_owner
      `
    );
    assert.deepEqual(migrationMembership.rows[0], {
      login_is_migrator: true,
      migrator_can_set_owner: true
    });

    const indexes = await adminClient.query(
      `select indexname from pg_indexes where schemaname = 'tge'`
    );
    const indexNames = new Set(indexes.rows.map(row => row.indexname));
    for (const indexName of [
      "revenue_actions_active_identity_uidx",
      "revenue_leak_cases_active_series_uidx",
      "revenue_leak_cases_active_semantic_uidx",
      "activities_opportunity_order_idx",
      "tasks_opportunity_order_idx",
      "import_batches_raw_expiry_idx",
      "audit_events_tenant_time_idx"
    ]) {
      assert.ok(indexNames.has(indexName), indexName);
    }

    const rls = await adminClient.query(
      `
        select relname, relrowsecurity, relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'tge' and c.relkind = 'r'
      `
    );
    assert.ok(rls.rows.length >= 13);
    for (const table of rls.rows) {
      assert.equal(table.relrowsecurity, true, table.relname);
      assert.equal(table.relforcerowsecurity, true, table.relname);
    }

    const privileges = await adminClient.query(
      `
        select
          has_schema_privilege($1, 'tge', 'create') as can_create,
          has_table_privilege($1, 'tge.prospects', 'truncate') as can_truncate,
          has_table_privilege($1, 'tge.audit_events', 'update') as can_update_audit,
          has_table_privilege($1, 'tge.audit_events', 'delete') as can_delete_audit,
          has_table_privilege($1, 'tge.import_batches', 'update') as can_update_batch,
          has_table_privilege($1, 'tge.import_batches', 'delete') as can_delete_batch,
          has_table_privilege($1, 'tge.import_staging_records', 'update') as can_update_staging,
          has_table_privilege($1, 'tge.import_staging_records', 'delete') as can_delete_staging,
          has_table_privilege($1, 'tge.import_id_map', 'update') as can_update_id_map,
          has_table_privilege($1, 'tge.import_id_map', 'delete') as can_delete_id_map,
          has_table_privilege($1, 'tge.revenue_leak_cases', 'delete') as can_delete_leak_case,
          has_table_privilege($1, 'public.prospects', 'select') as can_select_legacy
      `,
      [runtimeRole]
    );
    assert.deepEqual(privileges.rows[0], {
      can_create: false,
      can_truncate: false,
      can_update_audit: false,
      can_delete_audit: false,
      can_update_batch: false,
      can_delete_batch: false,
      can_update_staging: false,
      can_delete_staging: false,
      can_update_id_map: false,
      can_delete_id_map: false,
      can_delete_leak_case: false,
      can_select_legacy: false
    });

    const ownership = await adminClient.query(
      `
        select distinct pg_get_userbyid(c.relowner) as owner
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'tge'
          and c.relkind in ('r', 'i')
      `
    );
    assert.deepEqual(ownership.rows, [{ owner: "tge_owner" }]);

    const schemaOwner = await adminClient.query(
      `
        select pg_get_userbyid(nspowner) as owner
        from pg_namespace
        where nspname = 'tge'
      `
    );
    assert.deepEqual(schemaOwner.rows[0], { owner: "tge_owner" });

    const publicAccess = await adminClient.query(
      `
        select
          exists (
            select 1
            from pg_namespace n,
              lateral aclexplode(
                coalesce(n.nspacl, acldefault('n', n.nspowner))
              ) acl
            where n.nspname = 'tge' and acl.grantee = 0
          ) as schema_access,
          exists (
            select 1
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace,
              lateral aclexplode(
                coalesce(c.relacl, acldefault('r', c.relowner))
              ) acl
            where n.nspname = 'tge'
              and c.relkind = 'r'
              and acl.grantee = 0
          ) as table_access
      `
    );
    assert.deepEqual(publicAccess.rows[0], {
      schema_access: false,
      table_access: false
    });

    const functionSecurity = await adminClient.query(
      `
        select
          p.proname,
          pg_get_userbyid(p.proowner) as owner,
          exists (
            select 1
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
          ) as public_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'tge'
        order by p.proname
      `
    );
    assert.ok(functionSecurity.rows.length >= 4);
    for (const fn of functionSecurity.rows) {
      assert.equal(fn.owner, "tge_owner", fn.proname);
      assert.equal(fn.public_execute, false, fn.proname);
    }

    const compositeForeignKeys = await adminClient.query(
      `
        select count(*)::int as count
        from pg_constraint c
        join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'tge'
          and c.contype = 'f'
          and cardinality(c.conkey) = 2
      `
    );
    assert.ok(compositeForeignKeys.rows[0].count >= 8);

    const deferredEffectForeignKeys = await adminClient.query(
      `
        select count(*)::int as count
        from pg_constraint c
        join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'tge'
          and c.contype = 'f'
          and cardinality(c.conkey) = 4
          and c.condeferrable
          and c.condeferred
      `
    );
    assert.equal(deferredEffectForeignKeys.rows[0].count, 4);
  });

  closePostgresRepositoryPools = registerPostgresRepositoryContractTests({
    test,
    Pool,
    runtimeUrl,
    getAdminClient: () => adminClient,
    readFixtures
  });

  function readFixtures() {
    return Object.fromEntries(
      ["prospects", "opportunities", "activities", "tasks", "revenue_actions"]
        .map(collection => [
          collection,
          JSON.parse(
            fs.readFileSync(path.join(fixturesDirectory, `${collection}.json`), "utf8")
          )
        ])
    );
  }

  function copyMigrations(destination) {
    fs.cpSync(
      path.join(repositoryRoot, "database", "migrations"),
      destination,
      { recursive: true }
    );
  }
}

const silentLogger = { log() {} };

function classifyCommercialValue(opportunity) {
  if (!Object.hasOwn(opportunity, "value")) {
    return { numeric: null, state: "MISSING", raw: null };
  }
  if (opportunity.value === null) {
    return { numeric: null, state: "NULL", raw: "null" };
  }
  if (typeof opportunity.value === "number") {
    return {
      numeric: opportunity.value,
      state: opportunity.value === 0 ? "ZERO" : "KNOWN",
      raw: JSON.stringify(opportunity.value)
    };
  }
  if (opportunity.value.trim() === "") {
    return { numeric: null, state: "BLANK", raw: JSON.stringify(opportunity.value) };
  }
  if (opportunity.value.trim().toLowerCase() === "unknown") {
    return {
      numeric: null,
      state: "UNKNOWN_LITERAL",
      raw: JSON.stringify(opportunity.value)
    };
  }
  return {
    numeric: null,
    state: "NON_NUMERIC",
    raw: JSON.stringify(opportunity.value)
  };
}

async function insertRevenueAction(client, tenantId, action) {
  const terminal = action.status === "EXECUTED";
  const failed = action.status === "FAILED";
  return client.query(
    `
      insert into tge.revenue_actions (
        tenant_id, id, opportunity_id, action_type, execution_type,
        approval_requirement, risk_class, status, title, reason, evidence,
        recommendation_snapshot, basis_fingerprint, source, audit,
        prepared_at, approved_at, executed_at, failed_at,
        resulting_task_id, resulting_activity_id
      ) values (
        $1, $2, $3, $4, 'INTERNAL_TASK', 'HUMAN', 'INTERNAL', $5,
        'Identity test', 'Constraint evidence', '{}'::jsonb, '{}'::jsonb,
        $6, 'TEST', '[]'::jsonb, $7, $7, $8, $9, $10, $11
      )
    `,
    [
      tenantId,
      action.id,
      action.opportunityId,
      action.actionType,
      action.status,
      action.fingerprint,
      terminal || failed ? "2026-01-01T00:00:00.000Z" : null,
      terminal ? "2026-01-01T00:01:00.000Z" : null,
      failed ? "2026-01-01T00:01:00.000Z" : null,
      action.resultingTaskId ?? null,
      action.resultingActivityId ?? null
    ]
  );
}

async function assertSqlState(promise, expectedCode) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, expectedCode, error.message);
    return true;
  });
}

async function waitForLockWaiters(client, pids) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await client.query(
      `
        select count(*)::int as count
        from pg_stat_activity
        where pid = any($1::int[])
          and wait_event_type = 'Lock'
      `,
      [pids]
    );
    if (waiting.rows[0].count === pids.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("concurrent invitation clients did not reach the lock barrier");
}

function replaceDatabase(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function replaceCredentials(connectionString, userName, password) {
  const url = new URL(connectionString);
  url.username = userName;
  url.password = password;
  return url.toString();
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
