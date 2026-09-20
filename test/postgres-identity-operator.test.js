"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PostgresIdentityOperatorRepository
} = require("../src/auth/postgresIdentityOperatorRepository");

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const ISSUER = "https://pilot.au.auth0.com/";

function fakePool(respond) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return respond(text, values, calls);
    },
    release() { calls.push({ text: "release" }); }
  };
  return {
    calls,
    pool: { async connect() { return client; } }
  };
}

function baseInput(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    slug: "pilot-one",
    name: "Pilot One",
    issuer: ISSUER,
    subject: "auth0|owner",
    apply: false,
    auditId: "audit-1",
    auditPayload: { role: "OWNER" },
    ...overrides
  };
}

test("PostgreSQL bootstrap serializes, verifies privileged operator authority, and does not mutate on dry-run", async () => {
  const fixture = fakePool(text => {
    if (/rolsuper/.test(text)) return { rows: [{ authorized: true }] };
    if (/from tge\.tenants/.test(text)) return { rows: [] };
    if (/from tge\.tenant_memberships/.test(text)) return { rows: [] };
    return { rows: [] };
  });
  const repository = new PostgresIdentityOperatorRepository({ pool: fixture.pool });
  assert.deepEqual(await repository.bootstrapFirstTenant(baseInput()), {
    status: "WOULD_APPLY",
    tenantId: TENANT_ID
  });
  assert.ok(fixture.calls.some(call => /serializable/.test(call.text)));
  assert.ok(fixture.calls.some(call => /pg_advisory_xact_lock/.test(call.text)));
  assert.equal(fixture.calls.some(call => /insert into tge\.tenants/.test(call.text)), false);
  assert.equal(fixture.calls.at(-2).text, "commit");
});

test("PostgreSQL bootstrap atomically writes tenant, exact OWNER membership, and minimized audit evidence", async () => {
  const fixture = fakePool(text => {
    if (/rolsuper/.test(text)) return { rows: [{ authorized: true }] };
    if (/from tge\.tenants/.test(text)) return { rows: [] };
    if (/from tge\.tenant_memberships/.test(text)) return { rows: [] };
    return { rows: [] };
  });
  const repository = new PostgresIdentityOperatorRepository({ pool: fixture.pool });
  assert.equal((await repository.bootstrapFirstTenant(baseInput({ apply: true }))).status, "APPLIED");
  const membership = fixture.calls.find(call => /insert into tge\.tenant_memberships/.test(call.text));
  assert.deepEqual(membership.values.slice(0, 4), [TENANT_ID, ISSUER, "auth0|owner", "OWNER"]);
  const audit = fixture.calls.find(call => /insert into tge\.audit_events/.test(call.text));
  assert.doesNotMatch(JSON.stringify(audit.values), /Pilot One|pilot-one/);
  assert.match(audit.values.join(" "), /IDENTITY_BOOTSTRAPPED/);
});

test("PostgreSQL revocation denies terminal, cross-tenant, non-OWNER actor, and last OWNER states before update", async () => {
  const scenarios = [
    {
      tenant: { id: TENANT_ID, terminal: true },
      memberships: []
    },
    {
      tenant: { id: TENANT_ID, terminal: false },
      memberships: [
        { tenant_id: TENANT_ID, identity_issuer: ISSUER, subject_id: "auth0|owner", role: "MEMBER", status: "ACTIVE" },
        { tenant_id: TENANT_ID, identity_issuer: ISSUER, subject_id: "auth0|target", role: "MEMBER", status: "ACTIVE" }
      ]
    },
    {
      tenant: { id: TENANT_ID, terminal: false },
      memberships: [
        { tenant_id: TENANT_ID, identity_issuer: ISSUER, subject_id: "auth0|owner", role: "OWNER", status: "ACTIVE" },
        { tenant_id: "20000000-0000-4000-8000-000000000002", identity_issuer: ISSUER, subject_id: "auth0|target", role: "MEMBER", status: "ACTIVE" }
      ]
    },
    {
      tenant: { id: TENANT_ID, terminal: false },
      memberships: [
        { tenant_id: TENANT_ID, identity_issuer: ISSUER, subject_id: "auth0|owner", role: "OWNER", status: "ACTIVE" }
      ],
      targetOwner: true
    }
  ];

  for (const scenario of scenarios) {
    const fixture = fakePool((text, values) => {
      if (/rolsuper/.test(text)) return { rows: [{ authorized: true }] };
      if (/from tge\.tenants/.test(text)) return { rows: scenario.tenant ? [scenario.tenant] : [] };
      if (/count\(\*\)::integer as owner_count/.test(text)) {
        return { rows: [{ owner_count: 1 }] };
      }
      if (/from tge\.tenant_memberships/.test(text)) {
        if (scenario.targetOwner && values?.[1] === "auth0|owner") return { rows: scenario.memberships };
        return { rows: scenario.memberships };
      }
      return { rows: [] };
    });
    const repository = new PostgresIdentityOperatorRepository({ pool: fixture.pool });
    await assert.rejects(repository.revokeMembership({
      tenantId: TENANT_ID,
      actor: { issuer: ISSUER, subject: "auth0|owner" },
      target: { issuer: ISSUER, subject: scenario.targetOwner ? "auth0|owner" : "auth0|target" },
      apply: true,
      auditId: "audit-revoke",
      auditPayload: {}
    }));
    assert.equal(fixture.calls.some(call => /update tge\.tenant_memberships/.test(call.text)), false);
  }
});

test("PostgreSQL provisioned invitation persists expected identity in the initial pending insert and reconciles exact operation replays", async () => {
  let existing = [];
  const fixture = fakePool((text) => {
    if (/rolsuper/.test(text)) return { rows: [{ authorized: true }] };
    if (/from tge\.tenants/.test(text)) return { rows: [{ id: TENANT_ID, terminal: false }] };
    if (/from tge\.tenant_memberships/.test(text)) return { rows: [{
      tenant_id: TENANT_ID,
      identity_issuer: ISSUER,
      subject_id: "auth0|owner",
      role: "OWNER",
      status: "ACTIVE"
    }] };
    if (/from tge\.assisted_invitations/.test(text)) return { rows: existing };
    return { rows: [] };
  });
  const repository = new PostgresIdentityOperatorRepository({ pool: fixture.pool });
  const input = {
    operationId: "20000000-0000-4000-8000-000000000002",
    tenantId: TENANT_ID,
    actor: { issuer: ISSUER, subject: "auth0|owner" },
    normalizedEmail: "invited@example.test",
    role: "MEMBER",
    status: "PENDING",
    tokenHash: "a".repeat(64),
    expectedIssuer: ISSUER,
    expectedSubject: "email|invited",
    expiresAt: "2026-09-21T00:00:00.000Z",
    createdAt: "2026-09-20T00:00:00.000Z",
    auditId: "audit-invite",
    auditPayload: {}
  };
  assert.equal((await repository.createProvisionedInvitation(input)).status, "CREATED");
  const insert = fixture.calls.find(call => /insert into tge\.assisted_invitations/.test(call.text));
  assert.match(insert.text, /expected_identity_issuer/);
  assert.match(insert.text, /expected_subject_id/);
  assert.deepEqual(insert.values.slice(7, 9), [ISSUER, "email|invited"]);

  existing = [{
    tenant_id: TENANT_ID,
    id: input.operationId,
    token_hash: input.tokenHash,
    normalized_email: input.normalizedEmail,
    intended_role: input.role,
    status: "PENDING",
    expected_identity_issuer: input.expectedIssuer,
    expected_subject_id: input.expectedSubject,
    created_by_subject_id: input.actor.subject,
    expires_at: new Date(input.expiresAt)
  }];
  assert.equal((await repository.createProvisionedInvitation(input)).status, "RECONCILED");
});

test("PostgreSQL invitation preflight requires one exact active same-tenant OWNER before provider access", async () => {
  const fixture = fakePool(text => {
    if (/rolsuper/.test(text)) return { rows: [{ authorized: true }] };
    if (/from tge\.tenants/.test(text)) return { rows: [{ id: TENANT_ID, terminal: false }] };
    if (/from tge\.tenant_memberships/.test(text)) return { rows: [{
      tenant_id: TENANT_ID,
      identity_issuer: ISSUER,
      subject_id: "auth0|owner",
      role: "MEMBER",
      status: "ACTIVE"
    }] };
    return { rows: [] };
  });
  const repository = new PostgresIdentityOperatorRepository({ pool: fixture.pool });
  await assert.rejects(repository.preflightProvisionedInvitation({
    tenantId: TENANT_ID,
    actor: { issuer: ISSUER, subject: "auth0|owner" }
  }));
  assert.equal(
    fixture.calls.some(call => /^\s*(insert|update|delete)\b/i.test(call.text)),
    false
  );
});

test("PostgreSQL invitation revocation requires the exact active OWNER and only mutates pending same-tenant invitations", async () => {
  const invitationId = "20000000-0000-4000-8000-000000000002";
  const fixture = fakePool(text => {
    if (/rolsuper/.test(text)) return { rows: [{ authorized: true }] };
    if (/from tge\.tenants/.test(text)) return { rows: [{ id: TENANT_ID, terminal: false }] };
    if (/from tge\.tenant_memberships/.test(text)) return { rows: [{
      tenant_id: TENANT_ID,
      identity_issuer: ISSUER,
      subject_id: "auth0|owner",
      role: "OWNER",
      status: "ACTIVE"
    }] };
    if (/from tge\.assisted_invitations/.test(text)) return { rows: [{
      tenant_id: TENANT_ID,
      id: invitationId,
      status: "PENDING"
    }] };
    if (/update tge\.assisted_invitations/.test(text)) return { rows: [{ id: invitationId }] };
    return { rows: [] };
  });
  const repository = new PostgresIdentityOperatorRepository({ pool: fixture.pool });
  const input = {
    tenantId: TENANT_ID,
    invitationId,
    actor: { issuer: ISSUER, subject: "auth0|owner" },
    apply: false,
    auditId: "audit-revoke-invite",
    auditPayload: { actor_fingerprint: "a".repeat(64) }
  };
  assert.equal((await repository.revokeInvitation(input)).status, "WOULD_REVOKE");
  assert.equal((await repository.revokeInvitation({ ...input, apply: true })).status, "REVOKED");
  assert.ok(fixture.calls.some(call => /status = 'REVOKED'/.test(call.text)));
});
