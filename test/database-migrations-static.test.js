const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const migrationsDirectory = path.join(repositoryRoot, "database", "migrations");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("migration 001 remains byte-for-byte unchanged and migrations are append-only", () => {
  const migrationFiles = fs
    .readdirSync(migrationsDirectory)
    .filter(fileName => /^\d{3}_[a-z0-9_]+\.sql$/.test(fileName))
    .sort();
  const initialMigration = read("database/migrations/001_initial_schema.sql");

  assert.deepEqual(migrationFiles, [
    "001_initial_schema.sql",
    "002_tenant_domain_schema.sql",
    "003_roles_rls_and_grants.sql"
  ]);
  assert.equal(Buffer.byteLength(initialMigration), 2752);
  assert.equal(
    createHash("sha256").update(initialMigration).digest("hex"),
    "d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62"
  );
});

test("tenant schema preserves source identity, unknown values, ordering, and scoped relationships", () => {
  const schema = read("database/migrations/002_tenant_domain_schema.sql");
  const tenantOwnedTables = [
    "tenant_memberships",
    "prospects",
    "opportunities",
    "tasks",
    "activities",
    "revenue_actions",
    "import_batches",
    "import_staging_records",
    "import_id_map",
    "audit_events"
  ];

  for (const table of tenantOwnedTables) {
    const tableStart = schema.indexOf(`create table tge.${table} (`);
    assert.notEqual(tableStart, -1, table);
    const tableEnd = schema.indexOf("\n);", tableStart);
    assert.match(schema.slice(tableStart, tableEnd), /tenant_id uuid not null/);
  }

  assert.match(schema, /primary key \(tenant_id, id\)/);
  assert.match(
    schema,
    /foreign key \(tenant_id, prospect_id\) references tge\.prospects\(tenant_id, id\)/
  );
  assert.match(
    schema,
    /references tge\.opportunities\(tenant_id, id\)/
  );
  assert.doesNotMatch(schema, /on delete cascade|on delete set null/i);
  assert.match(schema, /commercial_value numeric,/);
  assert.doesNotMatch(schema, /commercial_value numeric[^\n]*default\s+0/i);

  for (const state of [
    "KNOWN",
    "ZERO",
    "NULL",
    "MISSING",
    "BLANK",
    "UNKNOWN_LITERAL",
    "NON_NUMERIC"
  ]) {
    assert.match(schema, new RegExp(`'${state}'`));
  }

  assert.match(schema, /probability numeric check/);
  assert.match(schema, /source_ordinal bigint/);
  assert.match(schema, /source_created_at timestamptz/);
  assert.match(schema, /source_updated_at timestamptz/);
  assert.match(schema, /legacy_payload jsonb/);
  assert.match(
    schema,
    /source_created_at desc,\n\s+source_ordinal desc/
  );
});

test("RevenueAction identity, import evidence, and audit foundation retain locked semantics", () => {
  const schema = read("database/migrations/002_tenant_domain_schema.sql");
  const security = read("database/migrations/003_roles_rls_and_grants.sql");
  const activeIndex = schema.match(
    /create unique index revenue_actions_active_identity_uidx[\s\S]*?;/
  )?.[0];

  assert.ok(activeIndex);
  assert.match(
    activeIndex,
    /tenant_id,\s+opportunity_id,\s+action_type,\s+basis_fingerprint/
  );
  assert.match(
    activeIndex,
    /where status in \('RECOMMENDED', 'PREPARED', 'APPROVED', 'EXECUTING', 'FAILED'\)/
  );
  assert.doesNotMatch(activeIndex, /unique.*opportunity_id\)/);
  assert.match(schema, /raw_expires_at <= created_at \+ interval '7 days'/);
  assert.match(
    schema,
    /metadata_retain_until >= created_at \+ interval '12 months'/
  );
  assert.match(schema, /commit_idempotency_key text/);
  assert.match(schema, /'EXACT_DUPLICATE', 'AMBIGUOUS'/);
  assert.match(schema, /create table tge\.import_id_map/);
  assert.match(schema, /create table tge\.audit_events/);
  assert.match(
    schema,
    /foreign key \(tenant_id, resulting_task_id, opportunity_id, id\)[\s\S]*?references tge\.tasks\(tenant_id, id, opportunity_id, revenue_action_id\)[\s\S]*?deferrable initially deferred/
  );
  assert.match(
    schema,
    /foreign key \(tenant_id, revenue_action_id, opportunity_id, id\)[\s\S]*?resulting_task_id[\s\S]*?deferrable initially deferred/
  );
  assert.match(schema, /unique \(tenant_id, revenue_action_id\)/);

  const idMapStart = schema.indexOf("create table tge.import_id_map (");
  const idMapEnd = schema.indexOf("\n);", idMapStart);
  const idMap = schema.slice(idMapStart, idMapEnd);
  assert.match(
    idMap,
    /references tge\.import_staging_records\([\s\S]*?source_ordinal, source_id/
  );
  for (const target of [
    "prospect",
    "opportunity",
    "task",
    "activity",
    "revenue_action"
  ]) {
    assert.match(idMap, new RegExp(`target_${target}_id text`));
  }
  assert.match(idMap, /num_nonnulls\([\s\S]*?\) = 1/);
  assert.match(idMap, /constraint import_id_map_source_target_type_check check/);
  for (const [collection, target] of [
    ["prospects", "prospect"],
    ["opportunities", "opportunity"],
    ["tasks", "task"],
    ["activities", "activity"],
    ["revenue_actions", "revenue_action"]
  ]) {
    assert.match(
      idMap,
      new RegExp(
        `source_collection = '${collection}'[\\s\\S]*?target_${target}_id is not null`
      )
    );
  }
  assert.doesNotMatch(idMap, /target_collection|target_id text/);
  assert.doesNotMatch(schema, /committed_target_(?:type|id)/);
  assert.match(
    security,
    /grant select, insert on\s+tge\.import_batches,\s+tge\.import_staging_records\s+to tge_runtime/
  );
  assert.doesNotMatch(
    security,
    /grant[^;]*update[^;]*tge\.import_(?:batches|staging_records|id_map)/i
  );
});

test("roles and RLS fail closed and keep runtime away from legacy and privileged operations", () => {
  const schema = read("database/migrations/002_tenant_domain_schema.sql");
  const security = read("database/migrations/003_roles_rls_and_grants.sql");

  for (const role of ["tge_owner", "tge_migrator", "tge_runtime"]) {
    assert.match(schema, new RegExp(`create role ${role} nologin`));
  }

  assert.ok(
    schema.indexOf("create role tge_owner nologin")
      < schema.indexOf("create schema if not exists tge")
  );
  assert.ok(
    schema.indexOf("create schema if not exists tge authorization tge_owner")
      < schema.indexOf("set local role tge_owner")
  );
  assert.ok(
    schema.indexOf("set local role tge_owner")
      < schema.indexOf("revoke all on schema tge from public")
  );
  assert.doesNotMatch(schema, /grant\s+create\s+on\s+database/i);
  assert.match(schema, /grant tge_migrator to %I/);
  assert.match(schema, /create role tge_migrator nologin noinherit/);
  assert.match(schema, /nobypassrls/);
  assert.match(security, /^set local role tge_owner;/);
  assert.doesNotMatch(security, /create role tge_/);
  assert.match(security, /set_config\('app\.tenant_id'.*true\)/);
  assert.match(security, /set_config\('app\.subject_id'.*true\)/);
  assert.match(security, /force row level security/);
  assert.match(
    security,
    /using \(tenant_id = tge\.current_tenant_id\(\)\)/
  );
  assert.match(schema, /revoke all on schema public from public/);
  assert.match(
    schema,
    /revoke all on all tables in schema public from tge_owner, tge_migrator, tge_runtime/
  );
  assert.match(
    security,
    /grant select, insert on\s+tge\.import_id_map,\s+tge\.audit_events\s+to tge_runtime/
  );
  assert.doesNotMatch(security, /grant\s+truncate/i);
  assert.doesNotMatch(
    security,
    /grant[^;]*(?:update|delete)[^;]*tge\.audit_events/i
  );
  assert.match(
    security,
    /alter default privileges for role tge_owner in schema tge[\s\S]*?revoke all on functions from public/
  );
  assert.match(security, /revoke all on all functions in schema tge from public/);
});

test("runner, package scripts, Compose, and CI use the real pinned PostgreSQL gate", () => {
  const runner = read("scripts/migrate-db.mjs");
  const runnerPolicy = read("scripts/migration-runner-policy.mjs");
  const packageJson = JSON.parse(read("package.json"));
  const compose = read("compose.test.yml");
  const workflow = read(".github/workflows/verify.yml");

  assert.match(runner, /createHash\("sha256"\)/);
  assert.match(runner, /schema_migrations/);
  assert.match(runner, /checksum drift/);
  assert.match(runner, /retroactive; append-only migrations/);
  assert.match(runnerPolicy, /Audited baseline required: migration 001 is unapplied/);
  assert.match(runnerPolicy, /set local role \$\{role\}/);
  assert.match(runnerPolicy, /the role is unavailable or the migration login lacks membership/);
  assert.match(runner, /await client\.query\("reset role"\)/);
  assert.match(runner, /await client\.query\("begin"\)/);
  assert.match(runner, /await client\.query\("commit"\)/);
  assert.match(runner, /pg_advisory_lock/);
  assert.equal(packageJson.dependencies.pg, "^8.23.0");
  assert.equal(packageJson.scripts["db:migrate"], "node scripts/migrate-db.mjs");
  assert.equal(
    packageJson.scripts["test:db"],
    "node --test test/database/*.test.js"
  );
  assert.match(packageJson.scripts.verify, /npm run test:db/);
  assert.match(compose, /image: postgres:16\.15/);
  assert.match(workflow, /image: postgres:16\.15/);
  assert.match(workflow, /TGE_TEST_DATABASE_URL:/);
});
