"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "database/migrations/015_raw_import_expiry_tenant_offboarding.sql"
);
const migration = () => fs.existsSync(migrationPath)
  ? fs.readFileSync(migrationPath, "utf8")
  : "";

const startingHashes = Object.freeze([
  "d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62",
  "a95f94263c5a1dd1a246a3be905e7f27bd5f4222ba871c137cf90fa2faf17c1c",
  "311a02a67deb09ad44b2782f90c2ff3c67d6a537ca9b9ed1f116cafd37a149a8",
  "ad9633daf1dd791c8889c79745d8741bace24e0827b76d3fec59d6d73371aa2d",
  "2e9bc0029cbfdc03828de7784aa19014de3f7e988cc8f5668bcacd729e206a66",
  "f110d2f7937c6133ed1785df05be8c3ca725add7d207a6d94b8a27610b3bca6f",
  "514d12b74519405b28e76960244483880f01092b30bcac650a97f247469f4dc6",
  "7e4f8b74df1ecc496fa6c7ac8b55169d3e7db7efccdcf3f1f7d0ad37aa95cd72",
  "f248d2d5a7363331cd4f4732551a62f9ac28f3315ad5e9777ded1547657d3736",
  "fcb19ddba6c2d5bc654af0c3a3172505675dd5c4160876d717b51943b2863e03",
  "df50ee0697bb7849b3575f9f5aef40673855ec77a4ebcfcd0cf0d8d5e59ca04b",
  "0ec9ffaf16987d84b319b6dc579edea86bbedcd3cff65f8b9d881f9c4dbba6d8",
  "b27c7d6c69990f459b1e51c0d902d55f6a1f44fbf17accb69459b2c26465f6a8",
  "699cb9c1e7fc4319f71cf7e98e99934706f9f75a8f0f00ae9c22ff90c5c9ea10"
]);

test("migrations 001-014 remain byte-identical", () => {
  const files = fs.readdirSync(path.join(root, "database/migrations"))
    .filter(file => /^0(?:0[1-9]|1[0-4])_/.test(file))
    .sort();
  assert.equal(files.length, 14);
  assert.deepEqual(files.map(file => createHash("sha256").update(
    fs.readFileSync(path.join(root, "database/migrations", file))
  ).digest("hex")), startingHashes);
});

test("migration 015 makes the database timestamp the exact seven-day authority", () => {
  const sql = migration();
  const clockGuard = sql.match(
    /create function tge\.guard_runtime_import_retention_clock[\s\S]*?\$function\$;/i
  )?.[0] || "";
  assert.match(sql, /^set local role tge_owner;/);
  assert.match(sql, /guard_runtime_import_retention_clock/i);
  assert.match(sql, /clock_timestamp\(\)/i);
  assert.match(sql, /raw_expires_at\s*:=\s*authoritative_at\s*\+\s*interval '7 days'/i);
  assert.match(sql, /raw_expires_at\s*=\s*created_at\s*\+\s*interval '7 days'/i);
  assert.doesNotMatch(clockGuard, /requested_(?:at|time|tenant|batch|target)/i);
});

test("migration 015 exposes truthful retry-safe raw cleanup without runtime delete authority", () => {
  const sql = migration();
  for (const state of ["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED"]) {
    assert.match(sql, new RegExp(`'${state}'`));
  }
  assert.match(sql, /process_due_raw_import_cleanup\(requested_limit integer\)/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /raw_payload\s*=\s*null/i);
  assert.match(sql, /source_filename\s*=\s*'\[deleted\]'/i);
  assert.match(sql, /grant execute on function tge\.process_due_raw_import_cleanup\(integer\)\s+to tge_migrator/i);
  assert.doesNotMatch(sql, /grant[^;]*(?:update|delete)[^;]*to tge_runtime/i);
});

test("migration 015 preserves canonical CRM and immutable audit during raw cleanup", () => {
  const cleanupBody = migration().match(
    /create function tge\.process_due_raw_import_cleanup[\s\S]*?\$function\$;/i
  )?.[0] || "";
  assert.doesNotMatch(cleanupBody, /delete from tge\.(?:prospects|opportunities|tasks|activities|revenue_actions|revenue_leak_cases|audit_events|pilot_evidence_events)/i);
  assert.match(cleanupBody, /external_actions_performed/i);
  for (const forbidden of ["raw_payload'", "contentBase64", "token", "dsn", "source_filename'"]) {
    assert.doesNotMatch(cleanupBody, new RegExp(forbidden, "i"));
  }
});

test("migration 015 derives offboarding authority from active OWNER membership", () => {
  const sql = migration();
  assert.match(sql, /create function tge\.request_tenant_offboarding\(requested_confirmation text\)/i);
  assert.match(sql, /tge\.current_tenant_id\(\)/i);
  assert.match(sql, /tge\.current_subject_id\(\)/i);
  assert.match(sql, /membership\.role = 'OWNER'/i);
  assert.match(sql, /membership\.status = 'ACTIVE'/i);
  assert.match(sql, /grant execute on function tge\.request_tenant_offboarding\(text\) to tge_runtime/i);
  assert.doesNotMatch(sql, /request_tenant_offboarding\([^)]*(?:uuid|timestamptz)/i);
});

test("migration 015 uses the existing server-only operations role and minimized offboarding evidence", () => {
  const sql = migration();
  assert.match(sql, /pg_has_role\(session_user, 'tge_migrator', 'member'\)/i);
  assert.match(sql, /process_pending_tenant_offboarding\(requested_limit integer\)/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /ACCESS_AND_RAW_EVIDENCE_ONLY/i);
  assert.match(sql, /OFFBOARDED_ACCESS_REVOKED/i);
  assert.match(sql, /canonical_records_retained/i);
  assert.match(sql, /audit_events_retained/i);
  assert.match(sql, /external_actions_performed/i);
  assert.doesNotMatch(sql, /delete from tge\.(?:prospects|opportunities|tasks|activities|revenue_actions|revenue_leak_cases|audit_events|pilot_evidence_events)/i);
});
