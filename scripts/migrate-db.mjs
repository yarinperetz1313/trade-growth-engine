import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  assertNoImplicitInitialBaseline,
  setMigrationExecutionRole
} from "./migration-runner-policy.mjs";

const { Client } = pg;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const defaultMigrationsDirectory = path.join(repositoryRoot, "database", "migrations");
const migrationFilePattern = /^\d{3}_[a-z0-9_]+\.sql$/;
const advisoryLockKey = "tge:append-only-migrations:v1";
const initialMigrationId = "001";
const knownInitialRelations = Object.freeze([
  "public.prospects",
  "public.prospects_business_name_idx",
  "public.prospects_location_idx",
  "public.prospects_qualification_idx",
  "public.leads",
  "public.leads_status_idx",
  "public.outreach_events",
  "public.outreach_events_lead_idx",
  "public.outreach_events_type_idx",
  "public.experiments",
  "public.reports",
  "public.audit_events"
]);

export async function readMigrations(
  migrationsDirectory = defaultMigrationsDirectory
) {
  const fileNames = (await readdir(migrationsDirectory))
    .filter(fileName => migrationFilePattern.test(fileName))
    .sort();

  if (fileNames.length === 0) {
    throw new Error(`No migrations found in ${migrationsDirectory}`);
  }

  return Promise.all(
    fileNames.map(async fileName => {
      const sql = await readFile(path.join(migrationsDirectory, fileName), "utf8");
      return {
        id: fileName.slice(0, 3),
        fileName,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql
      };
    })
  );
}

export async function runMigrations({
  connectionString,
  migrationsDirectory = defaultMigrationsDirectory,
  logger = console
}) {
  if (!connectionString) {
    throw new Error("TGE_DATABASE_URL is required to run database migrations");
  }

  const migrations = await readMigrations(migrationsDirectory);
  assertUniqueMigrationIds(migrations);
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [advisoryLockKey]);
    await ensureLedger(client);

    const appliedResult = await client.query(`
      select migration_id, file_name, checksum, applied_at
      from tge_migration.schema_migrations
      order by migration_id
    `);
    const appliedById = new Map(
      appliedResult.rows.map(row => [row.migration_id, row])
    );
    const migrationsById = new Map(migrations.map(migration => [migration.id, migration]));

    if (!appliedById.has(initialMigrationId)) {
      const existingInitialRelations = await findExistingInitialRelations(client);
      assertNoImplicitInitialBaseline(existingInitialRelations);
    }

    for (const applied of appliedResult.rows) {
      const migration = migrationsById.get(applied.migration_id);
      if (!migration) {
        throw new Error(
          `Applied migration ${applied.migration_id} is missing from the append-only migration directory`
        );
      }
      assertMigrationMatches(applied, migration);
    }

    const highestAppliedId = appliedResult.rows.at(-1)?.migration_id;
    if (highestAppliedId) {
      const retroactive = migrations.find(
        migration => !appliedById.has(migration.id)
          && migration.id.localeCompare(highestAppliedId) < 0
      );
      if (retroactive) {
        throw new Error(
          `Migration ${retroactive.fileName} is retroactive; append-only migrations must follow ${highestAppliedId}`
        );
      }
    }

    const applied = [];
    for (const migration of migrations) {
      const existing = appliedById.get(migration.id);
      if (existing) {
        assertMigrationMatches(existing, migration);
        continue;
      }

      await client.query("begin");
      try {
        await setMigrationExecutionRole(client, migration);
        await client.query(migration.sql);
        await client.query("reset role");
        await client.query(
          `
            insert into tge_migration.schema_migrations (
              migration_id,
              file_name,
              checksum
            ) values ($1, $2, $3)
          `,
          [migration.id, migration.fileName, migration.checksum]
        );
        await client.query("commit");
        applied.push(migration.id);
        logger.log(`Applied migration ${migration.fileName}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${migration.fileName} failed`, { cause: error });
      }
    }

    if (applied.length === 0) {
      logger.log("Database migrations are already up to date");
    }

    return {
      applied,
      migrations: migrations.map(({ id, fileName, checksum }) => ({
        id,
        fileName,
        checksum
      }))
    };
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [advisoryLockKey]);
    } finally {
      await client.end();
    }
  }
}

function assertUniqueMigrationIds(migrations) {
  const seen = new Set();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id ${migration.id}`);
    }
    seen.add(migration.id);
  }
}

function assertMigrationMatches(applied, migration) {
  if (applied.file_name !== migration.fileName) {
    throw new Error(
      `Migration ${migration.id} filename drift: ledger has ${applied.file_name}, disk has ${migration.fileName}`
    );
  }
  if (applied.checksum !== migration.checksum) {
    throw new Error(
      `Migration ${migration.fileName} checksum drift: applied migrations are immutable`
    );
  }
}

async function findExistingInitialRelations(client) {
  const result = await client.query(
    `
      select relation_name
      from unnest($1::text[]) as known(relation_name)
      where to_regclass(relation_name) is not null
      order by relation_name
    `,
    [knownInitialRelations]
  );
  return result.rows.map(row => row.relation_name);
}

async function ensureLedger(client) {
  await client.query("begin");
  try {
    await client.query(`
      create schema if not exists tge_migration;
      create table if not exists tge_migration.schema_migrations (
        migration_id text primary key check (migration_id ~ '^[0-9]{3}$'),
        file_name text not null unique,
        checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz not null default clock_timestamp()
      );
    `);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  runMigrations({ connectionString: process.env.TGE_DATABASE_URL }).catch(error => {
    console.error(error.message);
    if (error.cause) console.error(error.cause);
    process.exitCode = 1;
  });
}
