"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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
