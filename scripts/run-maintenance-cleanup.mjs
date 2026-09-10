import pg from "pg";

const { Client } = pg;
const connectionString = process.env.TGE_MAINTENANCE_DATABASE_URL;
const limit = 25;

if (!connectionString) {
  console.error("MAINTENANCE_CLEANUP_CONFIGURATION_INVALID");
  process.exitCode = 1;
} else {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query("begin");
    await client.query("set local role tge_migrator");
    const raw = await client.query(
      "select * from tge.process_due_raw_import_cleanup($1::integer)",
      [limit]
    );
    const offboarding = await client.query(
      "select * from tge.process_pending_tenant_offboarding($1::integer)",
      [limit]
    );
    await client.query("commit");
    console.log(JSON.stringify({
      rawImportCleanup: summarize(raw.rows, "cleanup_state"),
      tenantOffboarding: summarize(offboarding.rows, "state")
    }));
  } catch {
    try {
      await client.query("rollback");
    } catch {
      // The stable failure line remains the only operator output.
    }
    console.error("MAINTENANCE_CLEANUP_FAILED");
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

function summarize(rows, stateField) {
  return {
    processed: rows.length,
    succeeded: rows.filter(row => [
      "SUCCEEDED", "OFFBOARDED_ACCESS_REVOKED"
    ].includes(row[stateField])).length,
    failed: rows.filter(row => row[stateField] === "FAILED").length,
    retryable: rows.filter(row => row.retryable === true).length
  };
}
