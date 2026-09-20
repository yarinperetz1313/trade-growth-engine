"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const {
  createOffboardingOperatorWorkflow
} = require("../../src/tenantOffboarding/operatorWorkflow");
const {
  createPostgresOffboardingOperatorAdapter
} = require("../../src/tenantOffboarding/postgresOperatorAdapter");

const databaseUrl = process.env.TGE_TEST_DATABASE_URL;
const root = path.resolve(__dirname, "../..");

if (!databaseUrl) {
  test("offboarding operator PostgreSQL tests require TGE_TEST_DATABASE_URL", () => {
    assert.fail("TGE_TEST_DATABASE_URL is required for the offboarding operator database gate");
  });
} else {
  const { Client } = require("pg");
  const databaseName = `tge_offboarding_operator_${randomUUID().replaceAll("-", "")}`;
  const operatorRole = `tge_offboarding_operator_${randomUUID().replaceAll("-", "")}`;
  const maintenanceRole = `tge_offboarding_maintenance_${randomUUID().replaceAll("-", "")}`;
  const operatorPassword = randomUUID();
  const maintenancePassword = randomUUID();
  const adminUrl = replaceDatabase(databaseUrl, databaseName);
  const controlUrl = replaceDatabase(databaseUrl, "postgres");
  const operatorUrl = replaceCredentials(adminUrl, operatorRole, operatorPassword);
  const maintenanceUrl = replaceCredentials(
    adminUrl,
    maintenanceRole,
    maintenancePassword
  );
  let control;
  let admin;

  test.before(async () => {
    control = new Client({ connectionString: controlUrl });
    await control.connect();
    await control.query(`create database ${quoteIdentifier(databaseName)}`);
    const { runMigrations } = await import(pathToFileURL(
      path.join(root, "scripts/migrate-db.mjs")
    ));
    await runMigrations({ connectionString: adminUrl, logger: { log() {} } });
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await createLogin(admin, operatorRole, operatorPassword);
    await createLogin(admin, maintenanceRole, maintenancePassword);
    await admin.query(`grant tge_runtime to ${quoteIdentifier(operatorRole)}`);
    await admin.query(`grant tge_maintenance to ${quoteIdentifier(maintenanceRole)}`);
  });

  test.after(async () => {
    await admin?.end();
    if (control) {
      await control.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [databaseName]
      );
      await control.query(`drop database if exists ${quoteIdentifier(databaseName)}`);
      await control.query(`drop role if exists ${quoteIdentifier(operatorRole)}`);
      await control.query(`drop role if exists ${quoteIdentifier(maintenanceRole)}`);
      await control.end();
    }
  });

  test("dry-run is side-effect free and fails closed for non-owner, cross-tenant, and ambiguous identities", async () => {
    const owner = await seedTenant("dry-owner", "OWNER");
    const other = await seedTenant("dry-other", "OWNER");
    const adminActor = await seedTenant("dry-admin", "ADMIN");
    const ambiguousA = await seedTenant("dry-ambiguous-a", "OWNER");
    const ambiguousB = await seedTenant("dry-ambiguous-b", "OWNER", {
      issuer: ambiguousA.issuer,
      subject: ambiguousA.subject
    });
    assert.notEqual(ambiguousA.id, ambiguousB.id);

    const { adapter, workflow } = operator();
    try {
      const dryRun = await workflow.request({ ...target(owner), apply: false });
      assert.equal(dryRun.code, "OFFBOARDING_REQUEST_DRY_RUN_READY");
      assert.equal(dryRun.databaseWritesPerformed, false);
      assert.equal(dryRun.offboardingEffectsApplied, false);
      assert.equal(
        Number((await admin.query(
          "select count(*) from tge.tenant_offboarding_requests where tenant_id = $1",
          [owner.id]
        )).rows[0].count),
        0
      );

      for (const input of [
        target(adminActor),
        { ...target(owner), tenantId: other.id },
        target(ambiguousA)
      ]) {
        await assert.rejects(
          workflow.request({ ...input, apply: false }),
          error => error.code === "OFFBOARDING_OWNER_UNAVAILABLE"
        );
      }

      const unsafeAdapter = createPostgresOffboardingOperatorAdapter({
        connectionString: adminUrl
      });
      try {
        const unsafeWorkflow = createOffboardingOperatorWorkflow(unsafeAdapter);
        await assert.rejects(
          unsafeWorkflow.request({ ...target(owner), apply: false }),
          error => error.code === "OFFBOARDING_OPERATOR_CONFIGURATION_INVALID"
        );
      } finally {
        await unsafeAdapter.close();
      }
    } finally {
      await adapter.close();
    }
  });

  test("concurrent apply is idempotent and final database revalidation denies a stale OWNER", async () => {
    const owner = await seedTenant("race-owner", "OWNER");
    const { adapter, workflow } = operator();
    try {
      const apply = () => workflow.request({
        ...target(owner),
        apply: true,
        confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
      });
      const results = await Promise.all([apply(), apply()]);
      assert.deepEqual(results.map(result => result.state), ["PENDING", "PENDING"]);
      const rows = await admin.query(
        "select count(*)::integer count from tge.tenant_offboarding_requests where tenant_id = $1",
        [owner.id]
      );
      assert.equal(rows.rows[0].count, 1);

      const stale = await seedTenant("stale-owner", "OWNER");
      const authority = await adapter.authority.resolveActiveOwner(target(stale));
      await admin.query(
        "update tge.tenant_memberships set status = 'REVOKED' where tenant_id = $1",
        [stale.id]
      );
      await assert.rejects(
        adapter.requestService.request({
          authorizationContext: authority.authorizationContext,
          persistenceContext: authority.persistenceContext,
          input: { confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE" }
        }),
        error => error.code === "42501"
          && error.message === "Tenant offboarding request denied."
      );
      assert.equal(
        Number((await admin.query(
          "select count(*) from tge.tenant_offboarding_requests where tenant_id = $1",
          [stale.id]
        )).rows[0].count),
        0
      );
    } finally {
      await adapter.close();
    }
  });

  test("maintenance produces an actor-bound receipt while preserving unrelated and retained truth", async () => {
    const owner = await seedTenant("complete-owner", "OWNER");
    const neighbor = await seedTenant("complete-neighbor", "OWNER");
    await seedImport(owner, "complete-owner-batch");
    await seedImport(neighbor, "complete-neighbor-batch");
    await seedPilotEvidence(owner);
    await seedInvitation(owner);

    const { adapter, workflow } = operator();
    try {
      const dryRunCommand = await runOperatorCommand("request", owner);
      assert.equal(dryRunCommand.code, 0);
      assert.equal(dryRunCommand.result.code, "OFFBOARDING_REQUEST_DRY_RUN_READY");
      assert.equal(
        Number((await admin.query(
          "select count(*) from tge.tenant_offboarding_requests where tenant_id = $1",
          [owner.id]
        )).rows[0].count),
        0
      );
      const applyCommand = await runOperatorCommand("request", owner, [
        "--apply", "--confirm", "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
      ]);
      assert.equal(applyCommand.code, 0);
      const accepted = applyCommand.result;
      assert.equal(accepted.state, "PENDING");
      assert.equal(accepted.nextAction.command, "npm run maintenance:cleanup");

      const maintenance = new Client({ connectionString: maintenanceUrl });
      await maintenance.connect();
      try {
        const processed = await maintenance.query(
          "select * from tge.process_pending_tenant_offboarding(100)"
        );
        assert.ok(processed.rows.length >= 1);
        assert.ok(processed.rows.every(
          row => row.state === "OFFBOARDED_ACCESS_REVOKED"
        ));
      } finally {
        await maintenance.end();
      }

      const receiptCommand = await runOperatorCommand("receipt", owner);
      assert.equal(receiptCommand.code, 0);
      const receipt = receiptCommand.result;
      assert.equal(receipt.code, "OFFBOARDING_RECEIPT_COMPLETE");
      assert.equal(receipt.deletionEvidence.status, "SUCCEEDED");
      assert.equal(receipt.deletionEvidence.immutableEvidenceCount, 1);
      assert.equal(receipt.deletionEvidence.rawImportBatchesScrubbed, 1);
      assert.equal(receipt.deletionEvidence.rawImportRowsScrubbed, 1);
      assert.equal(receipt.deletionEvidence.membershipsRevoked, 1);
      assert.equal(receipt.deletionEvidence.invitationsDeleted, 1);
      assert.deepEqual(receipt.retentionInventory.databaseAccess, {
        status: "REVOKED",
        activeMembershipCount: 0,
        invitationCount: 0
      });
      assert.equal(receipt.retentionInventory.rawImportEvidence.status, "SCRUBBED");
      assert.equal(receipt.retentionInventory.canonicalCrm.count, 1);
      assert.equal(receipt.retentionInventory.identityMaps.count, 1);
      assert.equal(receipt.retentionInventory.auditEvidence.count, 1);
      assert.equal(receipt.retentionInventory.pilotEvidence.count, 1);
      assert.equal(receipt.policyBoundary.canonicalDeletion, "NOT_PERFORMED");
      assert.equal(
        receipt.policyBoundary.providerUserDisableOrDelete,
        "EXTERNAL_ACTION_REQUIRED"
      );

      const persisted = await admin.query(
        `select
           (select count(*)::integer from tge.prospects where tenant_id = $1) canonical,
           (select count(*)::integer from tge.import_id_map where tenant_id = $1) id_maps,
           (select count(*)::integer from tge.audit_events where tenant_id = $1) audits,
           (select count(*)::integer from tge.pilot_evidence_events where tenant_id = $1) pilot,
           (select count(*)::integer from tge.import_staging_records
             where tenant_id = $1 and raw_payload is not null) raw_rows,
           (select count(*)::integer from tge.tenant_memberships
             where tenant_id = $1) memberships,
           (select count(*)::integer from tge.assisted_invitations
             where tenant_id = $1) invitations,
           (select count(*)::integer from tge.data_deletion_evidence
             where tenant_id = $1 and evidence_type = 'TENANT_OFFBOARDING'
               and status = 'SUCCEEDED') immutable_evidence,
           (select count(*)::integer from tge.import_staging_records
             where tenant_id = $2 and raw_payload is not null) neighbor_raw,
           (select count(*)::integer from tge.tenant_memberships
             where tenant_id = $2 and status = 'ACTIVE') neighbor_memberships`,
        [owner.id, neighbor.id]
      );
      assert.deepEqual(persisted.rows[0], {
        canonical: 1,
        id_maps: 1,
        audits: 1,
        pilot: 1,
        raw_rows: 0,
        memberships: 0,
        invitations: 0,
        immutable_evidence: 1,
        neighbor_raw: 1,
        neighbor_memberships: 1
      });

      await assert.rejects(
        workflow.request({ ...target(owner), apply: false }),
        error => error.code === "OFFBOARDING_REQUEST_TERMINAL"
      );
      await assert.rejects(
        workflow.receipt({ ...target(owner), subject: "auth0|wrong-actor" }),
        error => error.code === "OFFBOARDING_REQUEST_UNAVAILABLE"
      );
      await assert.rejects(
        workflow.request({
          ...target(owner),
          subject: "auth0|wrong-actor",
          apply: false
        }),
        error => error.code === "OFFBOARDING_REQUEST_ACTOR_MISMATCH"
      );

      const serialized = JSON.stringify(receipt);
      assert.doesNotMatch(serialized, new RegExp(owner.id, "i"));
      assert.doesNotMatch(serialized, new RegExp(owner.subject, "i"));
      assert.doesNotMatch(serialized, /private|filename|email|dsn|token/i);
    } finally {
      await adapter.close();
    }
  });

  function runOperatorCommand(command, tenant, extra = []) {
    const child = spawn(process.execPath, [
      path.join(root, "scripts/run-offboarding-operator.mjs"),
      command,
      "--tenant", tenant.id,
      "--issuer", tenant.issuer,
      "--subject", tenant.subject,
      ...extra
    ], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://generic-fallback-must-not-be-used",
        TGE_OFFBOARDING_OPERATOR_DATABASE_URL: operatorUrl
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => {
        const output = `${stdout}${stderr}`;
        for (const forbidden of [tenant.id, tenant.issuer, tenant.subject]) {
          assert.doesNotMatch(output, new RegExp(forbidden, "i"));
        }
        resolve({
          code,
          result: JSON.parse((stdout || stderr).trim())
        });
      });
    });
  }

  function operator() {
    const adapter = createPostgresOffboardingOperatorAdapter({
      connectionString: operatorUrl
    });
    return {
      adapter,
      workflow: createOffboardingOperatorWorkflow(adapter)
    };
  }

  async function seedTenant(label, role, identity = {}) {
    const tenant = {
      id: randomUUID(),
      issuer: identity.issuer || "https://pilot.au.auth0.com/",
      subject: identity.subject || `auth0|${label}-${randomUUID()}`
    };
    await admin.query(
      "insert into tge.tenants (id, slug, name) values ($1, $2, $3)",
      [tenant.id, `${label}-${tenant.id}`, `Private ${label}`]
    );
    await admin.query(
      `insert into tge.tenant_memberships (
         tenant_id, identity_issuer, subject_id, role, status
       ) values ($1, $2, $3, $4, 'ACTIVE')`,
      [tenant.id, tenant.issuer, tenant.subject, role]
    );
    return tenant;
  }

  async function seedImport(tenant, batchId) {
    const now = new Date();
    const sourceId = `csv-row:0:${"d".repeat(64)}`;
    const prospectId = `prospect-${batchId}`;
    await admin.query(
      `insert into tge.import_batches (
         tenant_id, id, status, source_filename, source_sha256,
         authorized_by_subject_id, authorization_verified_at, preview_summary,
         commit_idempotency_key, commit_metadata, committed_at,
         raw_expires_at, metadata_retain_until, created_at, updated_at
       ) values ($1, $2, 'COMMITTED', $3, $4, $5, $6, $7::jsonb, $8,
         $9::jsonb, $6, $10, $11, $6, $6)`,
      [
        tenant.id,
        batchId,
        `private-${batchId}.csv`,
        "a".repeat(64),
        tenant.subject,
        now,
        JSON.stringify({
          format: "CSV",
          sourceCollection: "prospects",
          rowCount: 1,
          columnCount: 1,
          headers: ["private_header"]
        }),
        `key-${batchId}`,
        JSON.stringify({
          inputFingerprint: "b".repeat(64),
          requestFingerprint: "c".repeat(64),
          reviewedMapping: { selections: [{ sourceColumn: "private_header" }] },
          result: {
            outcome: "COMMITTED",
            rows: [{ sourceRecordId: `private-${batchId}` }],
            summary: { total: 1, committed: 1, skipped: 0, conflicted: 0, failed: 0 }
          }
        }),
        new Date(now.valueOf() + 7 * 86400000),
        addMonths(now, 12)
      ]
    );
    await admin.query(
      `insert into tge.import_staging_records (
         tenant_id, import_batch_id, id, source_collection, source_id,
         source_ordinal, raw_payload, raw_payload_sha256, disposition,
         idempotency_key, conflict_details, metadata, committed_at,
         created_at, updated_at
       ) values ($1, $2, 'row:0', 'prospects', $3, 0, $4::jsonb, $5,
         'COMMITTED', $6, $7::jsonb, $8::jsonb, $9, $9, $9)`,
      [
        tenant.id,
        batchId,
        sourceId,
        JSON.stringify({ cells: [{ raw: `private-${batchId}` }] }),
        "d".repeat(64),
        "e".repeat(64),
        JSON.stringify({ private_value: `private-${batchId}` }),
        JSON.stringify({ source_record_id: `private-${batchId}` }),
        now
      ]
    );
    await admin.query(
      `insert into tge.prospects (
         tenant_id, id, business_name, source_ordinal, legacy_payload,
         current_payload, created_at, updated_at
       ) values ($1, $2, 'Private canonical customer', 0,
         '{"private":"canonical"}', '{"business_name":"Private canonical customer"}',
         $3, $3)`,
      [tenant.id, prospectId, now]
    );
    await admin.query(
      `insert into tge.import_id_map (
         tenant_id, import_batch_id, source_collection, source_id,
         source_ordinal, target_prospect_id
       ) values ($1, $2, 'prospects', $3, 0, $4)`,
      [tenant.id, batchId, sourceId, prospectId]
    );
    await admin.query(
      `insert into tge.audit_events (
         tenant_id, id, event_type, subject_id, entity_type, entity_id,
         payload, occurred_at, retain_until, created_at
       ) values ($1, $2, 'IMPORT_PREVIEW_CREATED', $3, 'import_batch', $4,
         '{"external_action_performed":false}', $5, $6, $5)`,
      [tenant.id, `audit-${batchId}`, tenant.subject, batchId, now, addMonths(now, 12)]
    );
  }

  async function seedPilotEvidence(tenant) {
    const now = new Date();
    await admin.query(
      `insert into tge.pilot_evidence_events (
         tenant_id, id, event_type, actor_subject_id, occurred_at,
         semantic_key, facts, created_at
       ) values ($1, $2, 'PORTFOLIO_SCAN_COMPLETED', $3, $4, $5, $6::jsonb, $4)`,
      [tenant.id, randomUUID(), tenant.subject, now, "1".repeat(64), JSON.stringify({
        evaluated_count: 0,
        eligible_leak_count: 0,
        eligible_no_leak_count: 0,
        insufficient_evidence_count: 0,
        stale_source_count: 0,
        data_health_suppressed_count: 0,
        excluded_count: 0
      })]
    );
  }

  async function seedInvitation(tenant) {
    const now = new Date();
    await admin.query(
      `insert into tge.assisted_invitations (
         tenant_id, token_hash, normalized_email, intended_role, status,
         created_by_subject_id, expires_at, created_at, updated_at
       ) values ($1, $2, 'private@example.test', 'MEMBER', 'PENDING', $3,
         $4, $5, $5)`,
      [
        tenant.id,
        randomUUID().replaceAll("-", "").padEnd(64, "0"),
        tenant.subject,
        new Date(now.valueOf() + 86400000),
        now
      ]
    );
  }
}

function target(tenant) {
  return {
    tenantId: tenant.id,
    issuer: tenant.issuer,
    subject: tenant.subject
  };
}

function addMonths(value, count) {
  const date = new Date(value);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date;
}

async function createLogin(client, role, password) {
  const result = await client.query(
    "select format('create role %I login password %L nosuperuser nocreatedb nocreaterole noreplication nobypassrls', $1::text, $2::text) sql",
    [role, password]
  );
  await client.query(result.rows[0].sql);
}

function replaceDatabase(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function replaceCredentials(connectionString, username, password) {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
