const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const policyUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/migration-runner-policy.mjs")
).href;
const diagnosticsUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/migration-error.mjs")
).href;

test("runner requires the owner role only after the bootstrap migration", async () => {
  const { requiredExecutionRole } = await import(policyUrl);

  assert.equal(requiredExecutionRole("001"), null);
  assert.equal(requiredExecutionRole("002"), null);
  assert.equal(requiredExecutionRole("003"), "tge_owner");
  assert.equal(requiredExecutionRole("999"), "tge_owner");
});

test("runner refuses an implicit 001 baseline when a known object exists", async () => {
  const { assertNoImplicitInitialBaseline } = await import(policyUrl);

  assert.doesNotThrow(() => assertNoImplicitInitialBaseline([]));
  assert.throws(
    () => assertNoImplicitInitialBaseline([
      "public.audit_events",
      "public.prospects"
    ]),
    error => {
      assert.match(error.message, /Audited baseline required/);
      assert.match(error.message, /migration 001 is unapplied/);
      assert.match(error.message, /public\.audit_events, public\.prospects/);
      assert.match(error.message, /Refusing to infer or record migration 001/);
      return true;
    }
  );
});

test("runner fails explicitly when the owner role cannot be selected", async () => {
  const { setMigrationExecutionRole } = await import(policyUrl);
  const unavailable = new Error("role does not exist");
  const client = {
    async query(sql) {
      assert.equal(sql, "set local role tge_owner");
      throw unavailable;
    }
  };

  await assert.rejects(
    setMigrationExecutionRole(client, {
      id: "003",
      fileName: "003_roles_rls_and_grants.sql"
    }),
    error => {
      assert.match(error.message, /requires SET LOCAL ROLE tge_owner/);
      assert.match(error.message, /role is unavailable/);
      assert.equal(error.cause, unavailable);
      return true;
    }
  );
});

test("migration diagnostics expose safe PostgreSQL context without SQL or secrets", async () => {
  const { createMigrationError } = await import(diagnosticsUrl);
  const sql = [
    "create table tge.must_rollback (id integer);",
    "select 1 / 0;"
  ].join("\n");
  const cause = Object.assign(new Error("division by zero"), {
    code: "22012",
    severity: "ERROR",
    detail: "safe detail",
    hint: "safe hint",
    schema: "tge",
    table: "must_rollback",
    constraint: "must_rollback_check",
    routine: "int4div",
    position: String(sql.indexOf("select") + 1),
    query: sql,
    connectionString: "postgres://admin:super-secret@localhost/tge",
    parameters: ["secret-parameter"],
    config: { password: "super-secret" }
  });

  const error = createMigrationError(cause, {
    id: "004",
    fileName: "004_broken_transaction.sql",
    sql
  });

  assert.match(
    error.message,
    /Migration 004_broken_transaction\.sql failed \[22012\]: division by zero/
  );
  assert.equal(error.cause, cause);
  assert.deepEqual(error.migration, {
    id: "004",
    fileName: "004_broken_transaction.sql"
  });
  assert.equal(error.code, "22012");
  assert.equal(error.severity, "ERROR");
  assert.equal(error.detail, "safe detail");
  assert.equal(error.hint, "safe hint");
  assert.equal(error.schema, "tge");
  assert.equal(error.table, "must_rollback");
  assert.equal(error.constraint, "must_rollback_check");
  assert.equal(error.routine, "int4div");
  assert.equal(error.position, String(sql.indexOf("select") + 1));
  assert.equal(error.migrationLine, 2);
  assert.deepEqual(error.context, {
    fileName: "004_broken_transaction.sql",
    line: 2,
    position: String(sql.indexOf("select") + 1)
  });

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
  assert.doesNotMatch(serialized, /select 1 \/ 0|super-secret|secret-parameter/);
});
