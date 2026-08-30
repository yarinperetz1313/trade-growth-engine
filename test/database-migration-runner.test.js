const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const policyUrl = pathToFileURL(
  path.resolve(__dirname, "../scripts/migration-runner-policy.mjs")
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
