"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PostgresAuthRepository
} = require("../src/auth/postgresAuthRepository");
const {
  resolveTenantContext,
  runWithTenantContext
} = require("../src/auth/authorization");

const ISSUER = "https://pilot.au.auth0.com/";
const SUBJECT = "auth0|member";
const TENANT_ID = "10000000-0000-4000-8000-000000000001";

function fakePool(respond) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return respond(text, values);
    },
    release() {
      calls.push({ text: "release" });
    }
  };
  return {
    calls,
    pool: {
      async connect() {
        return client;
      }
    }
  };
}

test("PostgresAuthRepository resolves active membership by exact issuer and subject", async () => {
  const fixture = fakePool(text => {
    if (/select\s+tenant_id/i.test(text)) {
      return {
        rows: [{
          tenant_id: TENANT_ID,
          identity_issuer: ISSUER,
          subject_id: SUBJECT,
          role: "ADMIN",
          status: "ACTIVE"
        }]
      };
    }
    return { rows: [] };
  });
  const repository = new PostgresAuthRepository({ pool: fixture.pool });
  const memberships = await repository.findActiveMembershipsByIdentity({
    issuer: ISSUER,
    subject: SUBJECT
  });

  assert.deepEqual(memberships, [{
    tenantId: TENANT_ID,
    issuer: ISSUER,
    subject: SUBJECT,
    role: "ADMIN",
    status: "ACTIVE"
  }]);
  const identityContext = fixture.calls.find(call =>
    /set_identity_context/.test(call.text)
  );
  assert.deepEqual(identityContext.values, [ISSUER, SUBJECT]);
  const lookup = fixture.calls.find(call => /select\s+tenant_id/i.test(call.text));
  assert.match(lookup.text, /identity_issuer = \$1/);
  assert.match(lookup.text, /subject_id = \$2/);
  assert.match(lookup.text, /status = 'ACTIVE'/);
  assert.match(lookup.text, /limit 2/);
});

test("PostgresAuthRepository binds the trusted context transaction for PR-3", async () => {
  const fixture = fakePool(() => ({ rows: [] }));
  const repository = new PostgresAuthRepository({ pool: fixture.pool });
  const context = await resolveTenantContext({
    identity: { issuer: ISSUER, subject: SUBJECT },
    membershipRepository: {
      async findActiveMembershipsByIdentity() {
        return [{
          tenantId: TENANT_ID,
          issuer: ISSUER,
          subject: SUBJECT,
          role: "MEMBER",
          status: "ACTIVE"
        }];
      }
    }
  });
  const result = await runWithTenantContext({
    tenantContext: context,
    transactionRunner: repository,
    work: async client => {
      await client.query("select 'work'");
      return "value";
    }
  });

  assert.equal(result, "value");
  const contextCall = fixture.calls.find(call => /set_request_context/.test(call.text));
  assert.deepEqual(contextCall.values, [TENANT_ID, ISSUER, SUBJECT]);
  assert.deepEqual(
    fixture.calls.filter(call => ["begin", "commit", "rollback"].includes(call.text)),
    [{ text: "begin", values: undefined }, { text: "commit", values: undefined }]
  );
});

test("PostgresAuthRepository calls the atomic invitation consume function", async () => {
  const fixture = fakePool(text => {
    if (/consume_assisted_invitation/.test(text)) {
      return { rows: [{ resolved_tenant_id: TENANT_ID, resolved_role: "MEMBER" }] };
    }
    return { rows: [] };
  });
  const repository = new PostgresAuthRepository({ pool: fixture.pool });
  const result = await repository.consumeInvitation({
    tokenHash: "a".repeat(64),
    identity: { issuer: ISSUER, subject: SUBJECT },
    membershipAuditEvent: { id: "membership-audit" },
    invitationAuditEvent: { id: "invitation-audit" }
  });

  assert.deepEqual(result, {
    tenantId: TENANT_ID,
    issuer: ISSUER,
    subject: SUBJECT,
    role: "MEMBER",
    status: "ACTIVE"
  });
  const consume = fixture.calls.find(call => /consume_assisted_invitation/.test(call.text));
  assert.deepEqual(consume.values, [
    "a".repeat(64),
    ISSUER,
    SUBJECT,
    "membership-audit",
    "invitation-audit"
  ]);
});
