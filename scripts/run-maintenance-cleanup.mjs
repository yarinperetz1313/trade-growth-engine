import pg from "pg";

import { drainMaintenanceWork } from "./maintenance-cleanup-policy.mjs";

const { Client } = pg;
const connectionString = process.env.TGE_MAINTENANCE_DATABASE_URL;
const batchLimit = readBoundedInteger(
  process.env.TGE_MAINTENANCE_BATCH_LIMIT,
  25,
  100
);
const maxRounds = readBoundedInteger(
  process.env.TGE_MAINTENANCE_MAX_ROUNDS,
  8,
  100
);

if (!connectionString || batchLimit === null || maxRounds === null) {
  console.error("MAINTENANCE_CLEANUP_CONFIGURATION_INVALID");
  process.exitCode = 1;
} else {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await drainMaintenanceWork({
      batchLimit,
      maxRounds,
      runRawImportBatch: limit => runRawImportBatch(client, limit),
      runTenantOffboardingBatch: limit => runTenantOffboardingBatch(client, limit)
    });
    console.log(JSON.stringify({
      status: result.status,
      rounds: result.rounds,
      rawImportCleanup: result.rawImportCleanup,
      tenantOffboarding: result.tenantOffboarding
    }));
    if (result.exitCode === 2) {
      console.error("MAINTENANCE_CLEANUP_ACTION_REQUIRED");
    } else if (result.exitCode === 3) {
      console.error("MAINTENANCE_CLEANUP_BACKLOG_REMAINING");
    }
    process.exitCode = result.exitCode;
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

async function runRawImportBatch(client, limit) {
  await client.query("begin");
  try {
    const result = await client.query(
      "select * from tge.process_due_raw_import_cleanup($1::integer)",
      [limit]
    );
    await client.query("commit");
    return result.rows;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function runTenantOffboardingBatch(client, limit) {
  await client.query("begin");
  try {
    const result = await client.query(
      "select * from tge.process_pending_tenant_offboarding($1::integer)",
      [limit]
    );
    await client.query("commit");
    return result.rows;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

function readBoundedInteger(raw, fallback, maximum) {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}
