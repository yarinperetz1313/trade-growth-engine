"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const {
  IdentityOperationsService
} = require("../../src/auth/identityOperations");
const {
  PostgresIdentityOperatorRepository
} = require("../../src/auth/postgresIdentityOperatorRepository");

const databaseUrl = process.env.TGE_TEST_DATABASE_URL;
const root = path.resolve(__dirname, "../..");

if (!databaseUrl) {
  test("identity operator PostgreSQL tests require TGE_TEST_DATABASE_URL", () => {
    assert.fail("TGE_TEST_DATABASE_URL is required for identity operator database evidence");
  });
} else {
  const { Client, Pool } = require("pg");
  const databaseName = `tge_identity_${randomUUID().replaceAll("-", "")}`;
  const controlUrl = replaceDatabase(databaseUrl, "postgres");
  const adminUrl = replaceDatabase(databaseUrl, databaseName);
  const tenantId = randomUUID();
  const issuer = "https://pilot.au.auth0.com/";
  let control;
  let pool;
  let service;

  test.before(async () => {
    control = new Client({ connectionString: controlUrl });
    await control.connect();
    await control.query(`create database ${quoteIdentifier(databaseName)}`);
    const { runMigrations } = await import(pathToFileURL(
      path.join(root, "scripts/migrate-db.mjs")
    ));
    await runMigrations({ connectionString: adminUrl, logger: { log() {} } });
    pool = new Pool({ connectionString: adminUrl, max: 2 });
    service = new IdentityOperationsService({
      repository: new PostgresIdentityOperatorRepository({ pool }),
      now: () => new Date("2026-09-20T00:00:00.000Z"),
      randomBytes: size => Buffer.alloc(size, 5)
    });
  });

  test.after(async () => {
    await pool?.end();
    if (control) {
      await control.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [databaseName]
      );
      await control.query(`drop database if exists ${quoteIdentifier(databaseName)}`);
      await control.end();
    }
  });

  test("first tenant bootstrap is dry-run, exact, idempotent, and conflict-safe", async () => {
    const input = {
      tenantId,
      slug: "pilot-one",
      name: "Pilot One",
      issuer,
      subject: "auth0|owner-one"
    };
    assert.equal((await service.bootstrapFirstTenant(input)).status, "WOULD_APPLY");
    assert.equal(Number((await pool.query("select count(*) from tge.tenants")).rows[0].count), 0);

    assert.equal((await service.bootstrapFirstTenant({
      ...input,
      apply: true,
      confirmation: "BOOTSTRAP_FIRST_TENANT"
    })).status, "APPLIED");
    assert.equal((await service.bootstrapFirstTenant({
      ...input,
      apply: true,
      confirmation: "BOOTSTRAP_FIRST_TENANT"
    })).status, "ALREADY_APPLIED");

    const membership = await pool.query(
      `select identity_issuer, subject_id, role, status
       from tge.tenant_memberships where tenant_id = $1`,
      [tenantId]
    );
    assert.deepEqual(membership.rows, [{
      identity_issuer: issuer,
      subject_id: "auth0|owner-one",
      role: "OWNER",
      status: "ACTIVE"
    }]);
    const audit = await pool.query(
      "select subject_id, payload from tge.audit_events where event_type = 'IDENTITY_BOOTSTRAPPED'"
    );
    assert.equal(audit.rows[0].subject_id, "urn:tge:operator:identity-bootstrap");
    assert.deepEqual(Object.keys(audit.rows[0].payload).sort(), [
      "issuer_fingerprint",
      "role",
      "subject_fingerprint"
    ]);
    assert.doesNotMatch(JSON.stringify(audit.rows), /owner-one|Pilot One|pilot-one/);

    await assert.rejects(service.bootstrapFirstTenant({
      ...input,
      subject: "auth0|different"
    }), error => error?.code === "IDENTITY_OPERATION_DENIED");
  });

  test("provisioned invitation stores exact expected identity before availability and reconciles exact retries", async () => {
    const repository = new PostgresIdentityOperatorRepository({ pool });
    const provisionedService = new IdentityOperationsService({
      repository,
      provisioner: {
        async provisionIdentity() {
          return { issuer, subject: "email|invited-one", reconciled: true };
        }
      },
      now: () => new Date("2026-09-20T00:00:00.000Z")
    });
    const operationId = randomUUID();
    const input = {
      operationId,
      tenantId,
      actor: { issuer, subject: "auth0|owner-one" },
      email: "invited@example.test",
      role: "MEMBER",
      expiresAt: "2099-09-21T00:00:00.000Z"
    };
    const created = await provisionedService.createProvisionedInvitation(input);
    assert.equal(created.status, "CREATED");
    const row = await pool.query(
      `select status, expected_identity_issuer, expected_subject_id,
         normalized_email, token_hash
       from tge.assisted_invitations where id = $1`,
      [operationId]
    );
    assert.deepEqual(row.rows[0], {
      status: "PENDING",
      expected_identity_issuer: issuer,
      expected_subject_id: "email|invited-one",
      normalized_email: "invited@example.test",
      token_hash: row.rows[0].token_hash
    });
    assert.equal(row.rows[0].token_hash.length, 64);
    assert.equal((await pool.query(
      "select tge.invitation_available($1) as available",
      [row.rows[0].token_hash]
    )).rows[0].available, true);
    assert.equal(
      (await provisionedService.createProvisionedInvitation(input)).status,
      "RECONCILED"
    );

    await assert.rejects(provisionedService.createProvisionedInvitation({
      ...input,
      operationId: randomUUID()
    }), error => error?.code === "IDENTITY_OPERATION_DENIED");

    const revokeInput = {
      tenantId,
      invitationId: operationId,
      actor: { issuer, subject: "auth0|owner-one" }
    };
    assert.equal(
      (await provisionedService.revokeInvitation(revokeInput)).status,
      "WOULD_REVOKE"
    );
    assert.equal((await provisionedService.revokeInvitation({
      ...revokeInput,
      apply: true,
      confirmation: "REVOKE_INVITATION"
    })).status, "REVOKED");
    assert.equal((await provisionedService.revokeInvitation({
      ...revokeInput,
      apply: true,
      confirmation: "REVOKE_INVITATION"
    })).status, "ALREADY_REVOKED");
    assert.equal((await pool.query(
      "select status from tge.assisted_invitations where id = $1",
      [operationId]
    )).rows[0].status, "REVOKED");
  });

  test("membership revocation is dry-run, audited, idempotent, cross-tenant safe, and protects last OWNER/terminal tenant", async () => {
    await pool.query(
      `insert into tge.tenant_memberships (
         tenant_id, identity_issuer, subject_id, role, status
       ) values ($1, $2, 'auth0|member-one', 'MEMBER', 'ACTIVE')`,
      [tenantId, issuer]
    );
    const input = {
      tenantId,
      actor: { issuer, subject: "auth0|owner-one" },
      target: { issuer, subject: "auth0|member-one" }
    };
    assert.equal((await service.revokeMembership(input)).status, "WOULD_REVOKE");
    assert.equal((await pool.query(
      "select status from tge.tenant_memberships where tenant_id = $1 and subject_id = 'auth0|member-one'",
      [tenantId]
    )).rows[0].status, "ACTIVE");
    assert.equal((await service.revokeMembership({
      ...input,
      apply: true,
      confirmation: "REVOKE_MEMBERSHIP"
    })).status, "REVOKED");
    assert.equal((await service.revokeMembership({
      ...input,
      apply: true,
      confirmation: "REVOKE_MEMBERSHIP"
    })).status, "ALREADY_REVOKED");

    const audit = await pool.query(
      "select payload from tge.audit_events where event_type = 'MEMBERSHIP_REVOKED'"
    );
    assert.deepEqual(Object.keys(audit.rows[0].payload).sort(), [
      "actor_fingerprint",
      "target_fingerprint"
    ]);
    assert.doesNotMatch(JSON.stringify(audit.rows), /owner-one|member-one/);

    await assert.rejects(service.revokeMembership({
      tenantId,
      actor: { issuer, subject: "auth0|owner-one" },
      target: { issuer, subject: "auth0|owner-one" }
    }), error => error?.code === "IDENTITY_OPERATION_DENIED");

    const otherTenant = randomUUID();
    await pool.query(
      "insert into tge.tenants (id, slug, name) values ($1, 'other-tenant', 'Other Tenant')",
      [otherTenant]
    );
    await pool.query(
      `insert into tge.tenant_memberships (
         tenant_id, identity_issuer, subject_id, role, status
       ) values ($1, $2, 'auth0|other-member', 'MEMBER', 'ACTIVE')`,
      [otherTenant, issuer]
    );
    await assert.rejects(service.revokeMembership({
      tenantId,
      actor: { issuer, subject: "auth0|owner-one" },
      target: { issuer, subject: "auth0|other-member" }
    }), error => error?.code === "IDENTITY_OPERATION_DENIED");

    await pool.query(
      `update tge.tenants set metadata = jsonb_build_object(
         'offboarding_state', 'OFFBOARDED_ACCESS_REVOKED'
       ) where id = $1`,
      [tenantId]
    );
    await assert.rejects(service.revokeMembership(input), error =>
      error?.code === "IDENTITY_OPERATION_DENIED"
    );
  });
}

function replaceDatabase(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.href;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
