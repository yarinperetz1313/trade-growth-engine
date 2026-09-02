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
    "003_roles_rls_and_grants.sql",
    "004_global_function_default_privileges.sql",
    "005_task_in_progress_status.sql",
    "006_runtime_revenue_action_integrity.sql",
    "007_revenue_action_lifecycle_integrity.sql",
    "008_revenue_action_outcome_integrity.sql",
    "009_revenue_action_cancellation_integrity.sql",
    "010_auth_membership_and_invitations.sql",
    "011_canonical_import_commit.sql"
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

test("migration 004 revokes global PUBLIC function defaults as tge_owner", () => {
  const security = read(
    "database/migrations/004_global_function_default_privileges.sql"
  );
  const defaultPrivileges = security.match(
    /alter default privileges[\s\S]*?;/
  )?.[0];

  assert.match(security, /^set local role tge_owner;/);
  assert.ok(defaultPrivileges);
  assert.match(
    defaultPrivileges,
    /alter default privileges for role tge_owner\s+revoke execute on functions from public;/
  );
  assert.doesNotMatch(defaultPrivileges, /\bin schema tge\b/i);
  assert.match(
    security,
    /revoke execute on all functions in schema tge from public;/
  );
});

test("migration 005 preserves the existing IN_PROGRESS task status", () => {
  const compatibility = read(
    "database/migrations/005_task_in_progress_status.sql"
  );

  assert.match(compatibility, /^set local role tge_owner;/);
  assert.match(
    compatibility,
    /drop constraint tasks_status_check/
  );
  assert.match(
    compatibility,
    /status in \('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'\)/
  );
});

test("migration 006 enforces runtime history integrity and durable live ordering", () => {
  const integrity = read(
    "database/migrations/006_runtime_revenue_action_integrity.sql"
  );

  assert.match(integrity, /^set local role tge_owner;/);
  for (const table of [
    "prospects",
    "opportunities",
    "tasks",
    "activities",
    "revenue_actions"
  ]) {
    assert.match(
      integrity,
      new RegExp(`alter table tge\\.${table}[\\s\\S]*?current_payload jsonb`)
    );
    assert.match(
      integrity,
      new RegExp(`alter table tge\\.${table}[\\s\\S]*?live_ordinal bigint`)
    );
  }
  assert.match(integrity, /create trigger revenue_actions_runtime_integrity/);
  assert.match(integrity, /create trigger tasks_runtime_effect_integrity/);
  assert.match(integrity, /create trigger activities_runtime_effect_integrity/);
  assert.match(integrity, /RevenueAction audit history is append-only/);
  assert.match(integrity, /RevenueAction rows cannot be deleted by runtime/);
  assert.match(integrity, /Linked RevenueAction task effects are immutable/);
  assert.match(integrity, /Linked RevenueAction activity effects are immutable/);
  assert.match(
    integrity,
    /tg_op = 'INSERT' and new\.source_ordinal is not null[\s\S]*?Runtime inserts cannot claim imported source ordering/
  );
  assert.equal(
    (integrity.match(/Runtime inserts cannot claim imported source ordering/g) || []).length,
    3
  );
  assert.match(
    integrity,
    /create trigger prospects_runtime_source_integrity\s+before insert or update on tge\.prospects/
  );
  assert.match(
    integrity,
    /create trigger opportunities_runtime_source_integrity\s+before insert or update on tge\.opportunities/
  );
  assert.match(
    integrity,
    /tg_table_name = 'activities'[\s\S]*?old\.revenue_action_id is null[\s\S]*?new\.revenue_action_id is not null[\s\S]*?Existing activities cannot be linked to RevenueActions/
  );
  assert.match(
    integrity,
    /new\.metadata\s+- 'revenue_action_id'[\s\S]*?- 'revenue_action_linked_at'[\s\S]*?old\.metadata\s+- 'revenue_action_id'[\s\S]*?- 'revenue_action_linked_at'/
  );
  assert.match(
    integrity,
    /new\.current_payload is distinct from[\s\S]*?jsonb_set\(old\.current_payload, '\{metadata\}', new\.metadata, true\)/
  );
  assert.doesNotMatch(integrity, /security\s+definer/i);
});

test("migration 007 binds runtime lifecycle transitions to coherent audit suffixes", () => {
  const lifecycle = read(
    "database/migrations/007_revenue_action_lifecycle_integrity.sql"
  );

  assert.match(lifecycle, /^set local role tge_owner;/);
  assert.match(lifecycle, /create function tge\.guard_runtime_revenue_action_lifecycle\(\)/);
  assert.match(
    lifecycle,
    /create trigger revenue_actions_runtime_lifecycle_integrity\s+before update on tge\.revenue_actions/
  );
  assert.match(lifecycle, /new_audit_length <> old_audit_length \+ 2/);
  for (const transition of [
    "PREPARED",
    "APPROVED",
    "REJECTED",
    "EXECUTION_STARTED",
    "FAILED",
    "EXECUTED"
  ]) {
    assert.match(lifecycle, new RegExp(`'${transition}'`));
  }
  assert.match(lifecycle, /new\.execution_attempts <> old\.execution_attempts \+ 1/);
  assert.match(lifecycle, /new\.execution_request->>'requested_at'/);
  assert.match(lifecycle, /new\.execution_result->>'external_send_performed'/);
  assert.match(lifecycle, /new\.resulting_activity_id is null/);
  assert.match(lifecycle, /Runtime RevenueAction lifecycle evidence is incoherent/);
  assert.doesNotMatch(lifecycle, /security\s+definer/i);
});

test("migration 008 guards resumed attempts and execution outcome semantics", () => {
  const integrity = read(
    "database/migrations/008_revenue_action_outcome_integrity.sql"
  );

  assert.match(integrity, /^set local role tge_owner;/);
  assert.match(
    integrity,
    /create or replace function tge\.guard_runtime_revenue_action_lifecycle\(\)/
  );
  assert.match(
    integrity,
    /old\.status = 'EXECUTING'[\s\S]*?new_audit_length <> old_audit_length \+ 1/
  );
  assert.match(integrity, /new\.execution_attempts <> old\.execution_attempts/);
  assert.match(integrity, /'USER_CONFIRMED_COMPLETION'/);
  assert.match(integrity, /'TASK_CREATED'/);
  assert.match(integrity, /'TASK_REUSED'/);
  assert.match(integrity, /'RECOVERED_LINKED_EFFECTS'/);
  assert.match(integrity, /linked_task_source/);
  assert.match(integrity, /suffix_last->>'error' is distinct from new\.execution_result->>'error'/);
  assert.doesNotMatch(integrity, /security\s+definer/i);
});

test("migration 009 prevents cancellation from smuggling lifecycle or effect evidence", () => {
  const integrity = read(
    "database/migrations/009_revenue_action_cancellation_integrity.sql"
  );

  assert.match(integrity, /^set local role tge_owner;/);
  assert.match(
    integrity,
    /create function tge\.guard_runtime_revenue_action_cancellation\(\)/
  );
  assert.match(
    integrity,
    /create trigger revenue_actions_runtime_cancellation_integrity\s+before update on tge\.revenue_actions/
  );
  for (const field of [
    "proposed_execution",
    "execution_request",
    "execution_result",
    "execution_attempts",
    "prepared_at",
    "approved_at",
    "executed_at",
    "rejected_at",
    "failed_at",
    "rejection_reason",
    "resulting_task_id",
    "resulting_activity_id"
  ]) {
    assert.match(
      integrity,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
      field
    );
  }
  assert.match(integrity, /new_audit_length <> old_audit_length \+ 1/);
  assert.match(integrity, /new\.cancelled_at is distinct from suffix_at/);
  assert.match(integrity, /new\.updated_at is distinct from suffix_at/);
  assert.match(
    integrity,
    /Runtime RevenueAction cancellation evidence is incoherent\./
  );
  assert.doesNotMatch(integrity, /security\s+definer/i);
});

test("migration 010 binds active membership to issuer and subject with replay-safe invitations", () => {
  const auth = read(
    "database/migrations/010_auth_membership_and_invitations.sql"
  );

  assert.match(auth, /^set local role tge_owner;/);
  assert.match(auth, /add column identity_issuer text not null/);
  assert.match(auth, /add column status text not null/);
  assert.match(auth, /status in \('ACTIVE', 'SUSPENDED', 'REVOKED'\)/);
  assert.match(
    auth,
    /primary key \(tenant_id, identity_issuer, subject_id\)/
  );
  assert.match(auth, /create function tge\.set_identity_context/);
  assert.match(
    auth,
    /identity_issuer = tge\.current_identity_issuer\(\)[\s\S]*?subject_id = tge\.current_subject_id\(\)/
  );
  assert.match(auth, /create table tge\.assisted_invitations/);
  assert.match(auth, /token_hash text not null unique/);
  assert.match(auth, /token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(auth, /status in \('PENDING', 'CONSUMED', 'REVOKED'\)/);
  assert.match(auth, /expected_identity_issuer text/);
  assert.match(auth, /expected_subject_id text/);
  assert.match(auth, /expires_at timestamptz not null/);
  assert.match(auth, /create function tge\.consume_assisted_invitation/);
  const identityLockPosition = auth.indexOf("pg_advisory_xact_lock");
  const membershipCountPosition = auth.indexOf("select count(*)::integer");
  assert.ok(identityLockPosition > -1, "invitation activation serializes by identity");
  assert.ok(
    identityLockPosition < membershipCountPosition,
    "identity serialization precedes membership counting"
  );
  assert.match(auth, /for update/);
  assert.match(auth, /status = 'PENDING'/);
  assert.match(auth, /expires_at > requested_at/);
  assert.match(auth, /'MEMBERSHIP_ACTIVATED'/);
  assert.match(auth, /'INVITATION_CONSUMED'/);
  assert.match(auth, /grant execute on function tge\.consume_assisted_invitation/);
  assert.match(auth, /revoke execute on all functions in schema tge from public/);
  assert.doesNotMatch(auth, /grant[^;]*delete[^;]*assisted_invitations/i);
});

test("migration 011 adds globally deterministic import identity and narrow commit lifecycle functions", () => {
  const commit = read("database/migrations/011_canonical_import_commit.sql");
  const security = read("database/migrations/003_roles_rls_and_grants.sql");

  assert.match(commit, /alter table tge\.import_id_map[\s\S]*add column source_system text/);
  assert.match(commit, /add column source_record_id text/);
  assert.match(commit, /add column canonical_payload_sha256 text/);
  assert.match(commit, /add column commit_idempotency_key text/);
  for (const [table, column] of [
    ["prospects", "qualification_score"],
    ["opportunities", "qualification_score"],
    ["opportunities", "commercial_value"],
    ["opportunities", "probability"],
    ["opportunities", "weighted_value"]
  ]) {
    assert.match(
      commit,
      new RegExp(`alter table tge\\.${table}[\\s\\S]*?alter column ${column} type numeric\\(20,6\\)`)
    );
  }
  assert.match(commit, /create unique index import_id_map_source_identity_uidx[\s\S]*tenant_id,[\s\S]*source_system,[\s\S]*source_collection,[\s\S]*source_record_id/);
  for (const target of ["prospect", "opportunity", "task", "activity"]) {
    assert.match(
      commit,
      new RegExp(`create unique index import_id_map_global_target_${target}_uidx`)
    );
  }
  for (const name of [
    "lock_import_commit_batch",
    "lock_import_commit_records",
    "record_import_commit_outcome",
    "record_import_commit_attempt",
    "record_import_commit_lifecycle_conflict",
    "finalize_import_commit"
  ]) {
    assert.match(commit, new RegExp(`create function tge\\.${name}\\(`));
    assert.match(commit, new RegExp(`grant execute on function tge\\.${name}\\(`));
  }
  assert.match(commit, /security definer/g);
  assert.match(commit, /canonical_payload_sha256 is not null/);
  assert.match(commit, /requested_metadata is null[\s\S]*jsonb_typeof\(requested_metadata\) is distinct from 'object'/);
  assert.match(commit, /requested_metadata->>'canonical_payload_sha256' is null/);
  assert.match(commit, /requested_summary is null[\s\S]*jsonb_typeof\(requested_summary\) is distinct from 'object'/);
  assert.match(commit, /requested_summary->>'outcome' is null/);
  assert.match(commit, /requested_summary->>'inputFingerprint' is null/);
  assert.match(commit, /requested_summary->>'requestFingerprint' is null/);
  assert.match(commit, /requested_commit_metadata->>'requestFingerprint' is null/);
  assert.match(commit, /requested_commit_metadata->>'inputFingerprint' is null/);
  assert.match(commit, /requested_commit_metadata#>>'\{result,outcome\}' is null/);
  assert.match(commit, /old_status = 'PREVIEWED'|status = 'PREVIEWED'/);
  assert.match(commit, /revoke execute on all functions in schema tge from public/);
  assert.doesNotMatch(commit, /grant[^;]*(?:update|delete)[^;]*tge\.import_/i);
  assert.doesNotMatch(
    security,
    /grant[^;]*update[^;]*tge\.import_(?:batches|staging_records|id_map)/i
  );
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
