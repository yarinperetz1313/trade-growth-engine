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
const {
  withTenantTransaction
} = require("../../src/persistence/postgres/transaction");

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

  test("operator preflight rejects a privileged session login hidden by SET ROLE and a file-server role member", async () => {
    const owner = await seedTenant("unsafe-login-owner", "OWNER");
    const roleSwitchLogin = `tge_offboarding_switch_${randomUUID().replaceAll("-", "")}`;
    const fileServerLogin = `tge_offboarding_file_${randomUUID().replaceAll("-", "")}`;
    const roleSwitchPassword = randomUUID();
    const fileServerPassword = randomUUID();
    await createLogin(admin, roleSwitchLogin, roleSwitchPassword);
    await createLogin(admin, fileServerLogin, fileServerPassword);
    try {
      await admin.query(
        `alter role ${quoteIdentifier(roleSwitchLogin)} createdb createrole`
      );
      await admin.query(
        `grant ${quoteIdentifier(operatorRole)} to ${quoteIdentifier(roleSwitchLogin)}`
      );
      await admin.query(`grant tge_runtime to ${quoteIdentifier(fileServerLogin)}`);
      await admin.query(
        `grant pg_write_server_files to ${quoteIdentifier(fileServerLogin)}`
      );

      const switchedUrl = replaceCredentials(
        adminUrl,
        roleSwitchLogin,
        roleSwitchPassword
      );
      const switched = new URL(switchedUrl);
      switched.searchParams.set("options", `-c role=${operatorRole}`);
      const fileServerUrl = replaceCredentials(
        adminUrl,
        fileServerLogin,
        fileServerPassword
      );

      for (const connectionString of [switched.toString(), fileServerUrl]) {
        const unsafeAdapter = createPostgresOffboardingOperatorAdapter({
          connectionString
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
      }
    } finally {
      await admin.query(
        `revoke pg_write_server_files from ${quoteIdentifier(fileServerLogin)}`
      );
      await admin.query(`revoke tge_runtime from ${quoteIdentifier(fileServerLogin)}`);
      await admin.query(
        `revoke ${quoteIdentifier(operatorRole)} from ${quoteIdentifier(roleSwitchLogin)}`
      );
      await admin.query(`drop role ${quoteIdentifier(roleSwitchLogin)}`);
      await admin.query(`drop role ${quoteIdentifier(fileServerLogin)}`);
    }
  });

  test("two synchronized OWNER actors cannot both accept one authoritative request", async () => {
    const first = await seedTenant("actor-race-first", "OWNER");
    const second = {
      ...first,
      subject: `auth0|actor-race-second-${randomUUID()}`
    };
    await admin.query(
      `insert into tge.tenant_memberships (
         tenant_id, identity_issuer, subject_id, role, status
       ) values ($1, $2, $3, 'OWNER', 'ACTIVE')`,
      [second.id, second.issuer, second.subject]
    );

    const { adapter } = operator();
    let arrivals = 0;
    let releaseBarrier;
    const barrier = new Promise(resolve => { releaseBarrier = resolve; });
    const synchronizedService = {
      async request(input) {
        arrivals += 1;
        if (arrivals === 2) releaseBarrier();
        await barrier;
        return adapter.requestService.request(input);
      }
    };
    const workflow = createOffboardingOperatorWorkflow({
      authority: adapter.authority,
      requestService: synchronizedService,
      receiptRepository: adapter.receiptRepository
    });
    try {
      const apply = actor => workflow.request({
        ...target(actor),
        apply: true,
        confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
      });
      const results = await Promise.allSettled([apply(first), apply(second)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.filter(result => result.status === "rejected").length, 1);
      const acceptedIndex = results.findIndex(result => result.status === "fulfilled");
      const rejected = results.find(result => result.status === "rejected");
      assert.equal(rejected.reason.code, "OFFBOARDING_REQUEST_ACTOR_MISMATCH");

      const persisted = await admin.query(
        `select requested_by_subject_hash = encode(sha256(convert_to(
           $2::text || ':' || $3::text, 'UTF8'
         )), 'hex') actor_matches
         from tge.tenant_offboarding_requests where tenant_id = $1`,
        [first.id, first.issuer, [first, second][acceptedIndex].subject]
      );
      assert.deepEqual(persisted.rows, [{ actor_matches: true }]);
    } finally {
      await adapter.close();
    }
  });

  test("lost COMMIT acknowledgement reports reconciliation while the authoritative request remains pending", async () => {
    const owner = await seedTenant("unknown-outcome-owner", "OWNER");
    const { adapter } = operator();
    const lossyPool = commitAcknowledgementLossPool(operatorUrl);
    const requestService = {
      request({ persistenceContext }) {
        return withTenantTransaction(lossyPool, persistenceContext, async ({ client }) => {
          const result = await client.query(
            "select * from tge.request_tenant_offboarding($1::text)",
            ["OFFBOARD_ACCESS_AND_RAW_EVIDENCE"]
          );
          return result.rows[0];
        });
      }
    };
    const workflow = createOffboardingOperatorWorkflow({
      authority: adapter.authority,
      requestService,
      receiptRepository: adapter.receiptRepository
    });
    try {
      const result = await workflow.request({
        ...target(owner),
        apply: true,
        confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
      });
      assert.equal(result.code, "OFFBOARDING_REQUEST_RECONCILIATION_REQUIRED");
      assert.equal(result.state, "UNKNOWN");
      assert.equal(result.retryable, false);
      assert.equal(result.outcomeConfirmed, false);
      assert.equal(result.nextAction.operatorCommand, "status");

      const persisted = await admin.query(
        `select state, count(*) over ()::integer request_count
         from tge.tenant_offboarding_requests where tenant_id = $1`,
        [owner.id]
      );
      assert.deepEqual(persisted.rows, [{ state: "PENDING", request_count: 1 }]);
      const status = await workflow.inspect(target(owner));
      assert.equal(status.code, "OFFBOARDING_STATUS_PENDING");
      assert.equal(status.nextAction.command, "npm run maintenance:cleanup");
    } finally {
      await lossyPool.end();
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

function commitAcknowledgementLossPool(connectionString) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString, max: 1 });
  let acknowledgementLost = false;
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query(statement, values) {
          if (!acknowledgementLost && statement === "COMMIT") {
            await client.query(statement, values);
            acknowledgementLost = true;
            const error = new Error("commit acknowledgement lost");
            error.code = "CONNECTION_LOST_AFTER_COMMIT";
            throw error;
          }
          return client.query(statement, values);
        },
        release(error) {
          return client.release(error);
        }
      };
    },
    end() {
      return pool.end();
    }
  };
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
