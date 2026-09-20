"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "..");
const command = path.join(repositoryRoot, "scripts", "run-backup-restore-drill.mjs");
const runbook = path.join(
  repositoryRoot,
  "docs",
  "operations",
  "BACKUP_RESTORE_TENANT_PROOF.md"
);
const checksum = "a".repeat(64);
const validEnvironment = Object.freeze({
  TGE_BACKUP_RESTORE_MODE: "LOCAL_LOGICAL_REHEARSAL",
  TGE_BACKUP_SOURCE_ADMIN_URL:
    "postgresql://source-admin:source-secret@127.0.0.1:55432/tge_source",
  TGE_RESTORE_TARGET_ADMIN_URL:
    "postgresql://target-admin:target-secret@127.0.0.1:55432/tge_restore",
  TGE_RESTORE_TARGET_RUNTIME_URL:
    "postgresql://runtime:runtime-secret@127.0.0.1:55432/tge_restore",
  TGE_RESTORE_TARGET_MAINTENANCE_URL:
    "postgresql://maintenance:maintenance-secret@127.0.0.1:55432/tge_restore",
  TGE_BACKUP_RESTORE_DRILL_ID: "local-proof-20260920",
  TGE_BACKUP_RESTORE_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  TGE_BACKUP_RESTORE_EXPECTED_MIGRATION_ID: "016",
  TGE_BACKUP_RESTORE_EXPECTED_MIGRATION_CHECKSUM: checksum,
  TGE_BACKUP_RESTORE_DISPOSABLE_TARGET_ACK:
    "I_ACKNOWLEDGE_TARGET_DATABASE_IS_DISPOSABLE",
  TGE_BACKUP_RESTORE_EVIDENCE_DIR: "/tmp/tge-backup-restore-evidence"
});

test("package exposes the repository-native backup/restore proof command", () => {
  const packageJson = require("../package.json");
  assert.equal(
    packageJson.scripts["proof:backup-restore"],
    "node scripts/run-backup-restore-drill.mjs"
  );
  assert.equal(fs.statSync(command).isFile(), true);
});

test("backup/restore configuration accepts only explicit loopback rehearsal inputs", async () => {
  const { readBackupRestoreConfig } = await import(pathToFileURL(command).href);
  const config = readBackupRestoreConfig(validEnvironment);

  assert.equal(config.mode, "LOCAL_LOGICAL_REHEARSAL");
  assert.equal(config.drillId, "local-proof-20260920");
  assert.equal(config.tenantId, "11111111-1111-4111-8111-111111111111");
  assert.equal(config.expectedMigration.id, "016");
  assert.equal(config.expectedMigration.checksum, checksum);
  assert.equal(config.source.database, "tge_source");
  assert.equal(config.target.database, "tge_restore");
  assert.equal(config.evidenceDirectory, "/tmp/tge-backup-restore-evidence");
  assert.equal(JSON.stringify(config).includes("secret"), false);
});

for (const [name, patch] of [
  ["missing source URL", { TGE_BACKUP_SOURCE_ADMIN_URL: undefined }],
  ["same source and target", {
    TGE_RESTORE_TARGET_ADMIN_URL: validEnvironment.TGE_BACKUP_SOURCE_ADMIN_URL
  }],
  ["production-like target database", {
    TGE_RESTORE_TARGET_ADMIN_URL:
      "postgresql://target-admin:target-secret@127.0.0.1:55432/production"
  }],
  ["unsafe drill id", { TGE_BACKUP_RESTORE_DRILL_ID: "../../escape" }],
  ["unsafe tenant id", { TGE_BACKUP_RESTORE_TENANT_ID: "tenant-a" }],
  ["wrong target acknowledgement", {
    TGE_BACKUP_RESTORE_DISPOSABLE_TARGET_ACK: "yes"
  }],
  ["non-loopback local source", {
    TGE_BACKUP_SOURCE_ADMIN_URL:
      "postgresql://source-admin:source-secret@db.example.test/tge_source"
  }],
  ["runtime points at another target", {
    TGE_RESTORE_TARGET_RUNTIME_URL:
      "postgresql://runtime:runtime-secret@127.0.0.1:55432/not_the_restore"
  }],
  ["generic database URL is present", {
    DATABASE_URL: "postgresql://operator:secret@127.0.0.1:55432/production"
  }]
]) {
  test(`backup/restore configuration fails closed for ${name}`, async () => {
    const { readBackupRestoreConfig, BackupRestoreConfigurationError } =
      await import(`${pathToFileURL(command).href}?${encodeURIComponent(name)}`);
    assert.throws(
      () => readBackupRestoreConfig({ ...validEnvironment, ...patch }),
      BackupRestoreConfigurationError
    );
  });
}

test("non-loopback provider verification needs the exact external-action approval", async () => {
  const { readBackupRestoreConfig, BackupRestoreConfigurationError } =
    await import(`${pathToFileURL(command).href}?provider-mode`);
  const provider = {
    ...validEnvironment,
    TGE_BACKUP_RESTORE_MODE: "CLOUD_SQL_AU_ISOLATED_VERIFICATION",
    TGE_BACKUP_SOURCE_ADMIN_URL:
      "postgresql://source-admin:source-secret@source.private/tge_source",
    TGE_RESTORE_TARGET_ADMIN_URL:
      "postgresql://target-admin:target-secret@restore.private/tge_restore",
    TGE_RESTORE_TARGET_RUNTIME_URL:
      "postgresql://runtime:runtime-secret@restore.private/tge_restore",
    TGE_RESTORE_TARGET_MAINTENANCE_URL:
      "postgresql://maintenance:maintenance-secret@restore.private/tge_restore"
  };

  assert.throws(() => readBackupRestoreConfig(provider), BackupRestoreConfigurationError);
  const accepted = readBackupRestoreConfig({
    ...provider,
    TGE_BACKUP_RESTORE_PROVIDER_APPROVAL:
      "APPROVED_CLOUD_SQL_AU_ISOLATED_RESTORE_TARGET"
  });
  assert.equal(accepted.mode, "CLOUD_SQL_AU_ISOLATED_VERIFICATION");
});

for (const query of [
  "host=attacker.invalid",
  "hostaddr=203.0.113.10",
  "port=6543",
  "user=attacker",
  "password=override",
  "dbname=production",
  "service=production",
  "servicefile=/tmp/pg_service.conf",
  "passfile=/tmp/.pgpass",
  "sslcert=/tmp/client.crt",
  "sslkey=/tmp/client.key",
  "sslrootcert=/tmp/ca.crt",
  "options=-c%20search_path%3Dattacker",
  "target_session_attrs=read-write"
]) {
  test(`database URLs reject routing/auth override ${query.split("=")[0]}`, async () => {
    const { readBackupRestoreConfig, BackupRestoreConfigurationError } =
      await import(`${pathToFileURL(command).href}?url-${encodeURIComponent(query)}`);
    assert.throws(() => readBackupRestoreConfig({
      ...validEnvironment,
      TGE_BACKUP_SOURCE_ADMIN_URL:
        `${validEnvironment.TGE_BACKUP_SOURCE_ADMIN_URL}?${query}`
    }), BackupRestoreConfigurationError);
  });
}

test("validated endpoints drive pg.Client and command environments identically", async () => {
  const {
    buildPostgresAuthority,
    postgresClientOptions,
    postgresCommandEnvironment
  } = await import(`${pathToFileURL(command).href}?effective-authority`);
  const authority = buildPostgresAuthority(
    "postgresql://proof-user:proof-secret@127.0.0.1:55432/proof_db" +
      "?application_name=tge-backup-restore-proof&sslmode=verify-full"
  );
  const client = postgresClientOptions(authority);
  const environment = postgresCommandEnvironment(authority, {
    PATH: "/safe/bin",
    PGHOSTADDR: "203.0.113.10",
    PGSERVICE: "production",
    PGOPTIONS: "-c search_path=attacker"
  });

  assert.deepEqual(
    { host: client.host, port: client.port, user: client.user, database: client.database },
    { host: "127.0.0.1", port: 55432, user: "proof-user", database: "proof_db" }
  );
  assert.equal(client.password, "proof-secret");
  assert.equal(environment.PGHOST, client.host);
  assert.equal(environment.PGPORT, String(client.port));
  assert.equal(environment.PGUSER, client.user);
  assert.equal(environment.PGDATABASE, client.database);
  assert.equal(environment.PGPASSWORD, client.password);
  assert.equal(environment.PGHOSTADDR, undefined);
  assert.equal(environment.PGSERVICE, undefined);
  assert.equal(environment.PGOPTIONS, undefined);
  assert.equal(environment.PGAPPNAME, "tge-backup-restore-proof");
  assert.equal(environment.PGSSLMODE, "verify-full");
  assert.deepEqual(client.ssl, { rejectUnauthorized: true });
  assert.equal(JSON.stringify(authority).includes("proof-secret"), false);
  for (const unsafe of [
    "sslmode=require",
    "application_name=another-client",
    "sslmode=verify-full&sslmode=verify-full"
  ]) assert.throws(
    () => buildPostgresAuthority(`postgresql://proof-user:proof-secret@127.0.0.1:55432/proof_db?${unsafe}`),
    /invalid/i
  );
});

test("complete migration ledger rejects missing, extra, reordered, and altered rows", async () => {
  const { assertCompleteMigrationLedger } = await import(
    `${pathToFileURL(command).href}?complete-ledger`
  );
  const expected = [
    { id: "001", fileName: "001_initial_schema.sql", checksum: "a".repeat(64) },
    { id: "002", fileName: "002_tenant_domain_schema.sql", checksum: "b".repeat(64) }
  ];
  const actual = expected.map(row => ({
    migration_id: row.id,
    file_name: row.fileName,
    checksum: row.checksum
  }));
  assert.doesNotThrow(() => assertCompleteMigrationLedger(actual, expected));
  for (const invalid of [
    actual.slice(0, 1),
    [...actual, { migration_id: "003", file_name: "003_extra.sql", checksum }],
    [...actual].reverse(),
    [{ ...actual[0], checksum: "c".repeat(64) }, actual[1]],
    [{ ...actual[0], file_name: "001_drift.sql" }, actual[1]]
  ]) assert.throws(() => assertCompleteMigrationLedger(invalid, expected), /MIGRATION_LEDGER/);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`signal lifecycle cleans once before preserving ${signal} termination`, async () => {
    const { installBackupRestoreSignalLifecycle } = await import(
      `${pathToFileURL(command).href}?signal-lifecycle-${signal}`
    );
    const target = new EventEmitter();
    target.pid = 4321;
    const kills = [];
    target.kill = (pid, deliveredSignal) => kills.push([pid, deliveredSignal]);
    let cleanups = 0;
    const lifecycle = installBackupRestoreSignalLifecycle({
      target,
      cleanupOnce: async () => { cleanups += 1; },
      timeoutMs: 100
    });

    target.emit(signal);
    target.emit(signal);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cleanups, 1);
    assert.deepEqual(kills, [[4321, signal]]);
    lifecycle.dispose();
  });
}

test("signal cleanup failure is reported before preserving termination", async () => {
  const { installBackupRestoreSignalLifecycle } = await import(
    `${pathToFileURL(command).href}?signal-cleanup-failure`
  );
  const target = new EventEmitter();
  target.pid = 9876;
  const kills = [];
  let stderr = "";
  target.kill = (pid, signal) => kills.push([pid, signal]);
  target.stderr = { write: value => { stderr += value; } };
  installBackupRestoreSignalLifecycle({
    target,
    cleanupOnce: async () => { throw new Error("secret teardown detail"); },
    timeoutMs: 100
  });
  target.emit("SIGTERM");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stderr, "BACKUP_RESTORE_CLEANUP_FAILED\n");
  assert.equal(stderr.includes("secret teardown detail"), false);
  assert.deepEqual(kills, [[9876, "SIGTERM"]]);
});

test("resource cleanup waits for a SIGTERM-ignoring child and escalates before teardown", async t => {
  const { createDrillResourceLifecycle } = await import(
    `${pathToFileURL(command).href}?owned-child-escalation`
  );
  const events = [];
  const child = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM',()=>{});process.stdout.write('READY\\n');setInterval(()=>{},1000)"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  await waitForOutput(child.stdout, "READY\n");
  child.once("exit", () => events.push("child-exit"));
  const lifecycle = createDrillResourceLifecycle({
    config: {
      authorities: { targetAdmin: Object.freeze({}) },
      target: { database: "disposable_restore" }
    },
    teardown: async () => { events.push("target-remove"); },
    remove: async value => { events.push(`remove:${path.basename(value)}`); },
    childTerminationTimeoutMs: 30
  });
  lifecycle.trackChild(child);
  lifecycle.setTemporaryDirectory("/tmp/owned-restore-proof", "/tmp/owned-restore-proof/archive");
  lifecycle.validateDisposableTarget();

  await lifecycle.cleanupOnce();

  assert.equal(child.signalCode, "SIGKILL");
  assert.equal(events[0], "child-exit");
  assert.deepEqual(events.slice(1), [
    "remove:archive",
    "target-remove",
    "remove:owned-restore-proof"
  ]);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`signal cleanup timeout reports a redacted failure before preserving ${signal}`, async t => {
    const moduleUrl = pathToFileURL(command).href;
    const child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      `import { installBackupRestoreSignalLifecycle } from ${JSON.stringify(moduleUrl)};
installBackupRestoreSignalLifecycle({
  target: process,
  cleanupOnce: () => new Promise(() => {}),
  timeoutMs: 30
});
process.stdout.write("READY\\n");
setInterval(() => {}, 1000);`
    ], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    await waitForOutput(child.stdout, "READY\n");

    child.kill(signal);
    const result = await waitForExit(child, 2_000);

    assert.equal(result.signal, signal);
    assert.equal(stderr, "BACKUP_RESTORE_CLEANUP_FAILED\n");
  });
}

test("CLI emits only the stable configuration error for unsafe input", () => {
  const result = spawnSync(process.execPath, [command], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...validEnvironment, TGE_BACKUP_RESTORE_DRILL_ID: "bad id" }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "BACKUP_RESTORE_CONFIGURATION_INVALID\n");
});

test("runbook keeps Cloud SQL restore external and labels local evidence honestly", () => {
  const content = fs.readFileSync(runbook, "utf8");
  for (const required of [
    "LOCAL_SYNTHETIC_LOGICAL_REHEARSAL",
    "does not prove live Cloud SQL readiness",
    "australia-southeast2",
    "14 daily backups",
    "RPO <= 24 hours",
    "RTO <= 4 business hours",
    "full isolated Cloud SQL restore",
    "before traffic",
    "logical tenant manifest",
    "not a native tenant restore",
    "external provider action",
    "cleanup"
  ]) assert.match(content, new RegExp(escapeRegExp(required), "i"), required);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function waitForOutput(stream, expected) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("subprocess output timeout")), 2_000);
    stream.setEncoding("utf8");
    stream.on("data", chunk => {
      output += chunk;
      if (output.includes(expected)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    stream.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("subprocess exit timeout")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
