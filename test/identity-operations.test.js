"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  IdentityOperationError,
  IdentityOperationsService
} = require("../src/auth/identityOperations");
const {
  Auth0ProvisioningAdapter,
  ProvisioningConfigurationError
} = require("../src/auth/provisioning");

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const ISSUER = "https://pilot.au.auth0.com/";

function auth0EmailUser(overrides = {}) {
  return {
    user_id: "email|provisioned",
    email: "invited@example.test",
    identities: [{
      connection: "email",
      provider: "email",
      user_id: "provisioned"
    }],
    ...overrides
  };
}

function denied(error) {
  return error instanceof IdentityOperationError
    && error.code === "IDENTITY_OPERATION_DENIED"
    && !/owner|subject|email@example/i.test(error.message);
}

test("first-tenant OWNER bootstrap is dry-run by default, explicit on apply, and idempotent", async () => {
  const calls = [];
  const repository = {
    async bootstrapFirstTenant(input) {
      calls.push(input);
      return input.apply
        ? { status: "APPLIED", tenantId: input.tenantId }
        : { status: "WOULD_APPLY", tenantId: input.tenantId };
    }
  };
  const service = new IdentityOperationsService({ repository });
  const input = {
    tenantId: TENANT_ID,
    slug: "pilot-one",
    name: "Pilot One",
    issuer: ISSUER,
    subject: "auth0|owner-one"
  };

  assert.deepEqual(await service.bootstrapFirstTenant(input), {
    status: "WOULD_APPLY",
    tenantId: TENANT_ID
  });
  assert.equal(calls[0].apply, false);
  assert.match(calls[0].issuerFingerprint, /^[0-9a-f]{64}$/);
  assert.match(calls[0].subjectFingerprint, /^[0-9a-f]{64}$/);
  assert.equal("name" in calls[0].auditPayload, false);
  assert.equal("slug" in calls[0].auditPayload, false);
  assert.equal("subject" in calls[0].auditPayload, false);

  assert.deepEqual(await service.bootstrapFirstTenant({
    ...input,
    apply: true,
    confirmation: "BOOTSTRAP_FIRST_TENANT"
  }), { status: "APPLIED", tenantId: TENANT_ID });
  assert.equal(calls[1].apply, true);

  await assert.rejects(
    service.bootstrapFirstTenant({ ...input, apply: true, confirmation: "yes" }),
    denied
  );
});

test("bootstrap and revocation validation rejects ambiguous identity, cross-tenant input, and missing confirmation generically", async () => {
  const service = new IdentityOperationsService({
    repository: {
      async bootstrapFirstTenant() { assert.fail("invalid input reached repository"); },
      async revokeMembership() { assert.fail("invalid input reached repository"); }
    }
  });

  for (const input of [
    { tenantId: "not-a-uuid", slug: "pilot", name: "Pilot", issuer: ISSUER, subject: "auth0|owner" },
    { tenantId: TENANT_ID, slug: "Pilot One", name: "Pilot", issuer: ISSUER, subject: "auth0|owner" },
    { tenantId: TENANT_ID, slug: "pilot", name: "Pilot", issuer: "http://issuer/", subject: "auth0|owner" },
    { tenantId: TENANT_ID, slug: "pilot", name: "Pilot", issuer: ISSUER, subject: " owner " }
  ]) {
    await assert.rejects(service.bootstrapFirstTenant(input), denied);
  }

  await assert.rejects(service.revokeMembership({
    tenantId: TENANT_ID,
    actor: { issuer: ISSUER, subject: "auth0|owner" },
    target: { issuer: ISSUER, subject: "auth0|member" },
    apply: true,
    confirmation: "wrong"
  }), denied);
});

test("individual revocation passes exact actor/target authority and privacy-minimized evidence to the repository", async () => {
  const calls = [];
  const service = new IdentityOperationsService({
    repository: {
      async revokeMembership(input) {
        calls.push(input);
        return { status: input.apply ? "REVOKED" : "WOULD_REVOKE", tenantId: input.tenantId };
      }
    }
  });
  const input = {
    tenantId: TENANT_ID,
    actor: { issuer: ISSUER, subject: "auth0|owner" },
    target: { issuer: ISSUER, subject: "auth0|member" }
  };

  assert.equal((await service.revokeMembership(input)).status, "WOULD_REVOKE");
  assert.equal((await service.revokeMembership({
    ...input,
    apply: true,
    confirmation: "REVOKE_MEMBERSHIP"
  })).status, "REVOKED");
  assert.deepEqual(calls[1].actor, input.actor);
  assert.deepEqual(calls[1].target, input.target);
  assert.deepEqual(Object.keys(calls[1].auditPayload).sort(), [
    "actor_fingerprint",
    "target_fingerprint"
  ]);
});

test("operator invitation revocation is explicit, idempotent, and carries no invitee PII in evidence", async () => {
  const calls = [];
  const service = new IdentityOperationsService({
    repository: {
      async revokeInvitation(input) {
        calls.push(input);
        return {
          status: input.apply ? "REVOKED" : "WOULD_REVOKE",
          tenantId: input.tenantId,
          invitationId: input.invitationId
        };
      }
    }
  });
  const input = {
    tenantId: TENANT_ID,
    invitationId: "20000000-0000-4000-8000-000000000002",
    actor: { issuer: ISSUER, subject: "auth0|owner" }
  };
  assert.equal((await service.revokeInvitation(input)).status, "WOULD_REVOKE");
  assert.equal((await service.revokeInvitation({
    ...input,
    apply: true,
    confirmation: "REVOKE_INVITATION"
  })).status, "REVOKED");
  assert.deepEqual(Object.keys(calls[1].auditPayload), ["actor_fingerprint"]);
});

test("Auth0 provisioning adapter fails closed on incomplete real configuration", () => {
  for (const config of [
    {},
    { issuer: ISSUER, managementApiBaseUrl: "http://auth.example/api/v2/", connection: "email" },
    { issuer: ISSUER, managementApiBaseUrl: "https://auth.example/api/v2/", connection: " email " }
  ]) {
    assert.throws(
      () => new Auth0ProvisioningAdapter({ config, accessTokenProvider: async () => "token" }),
      ProvisioningConfigurationError
    );
  }
});

test("Auth0 provisioning reconciles one exact existing user and never exposes tokens in errors", async () => {
  const requests = [];
  const adapter = new Auth0ProvisioningAdapter({
    config: {
      issuer: ISSUER,
      managementApiBaseUrl: "https://pilot.au.auth0.com/api/v2/",
      connection: "email"
    },
    accessTokenProvider: async () => "management-token-secret",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify([auth0EmailUser()]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(await adapter.provisionIdentity({
    normalizedEmail: "invited@example.test",
    operationId: "20000000-0000-4000-8000-000000000002"
  }), { issuer: ISSUER, subject: "email|provisioned", reconciled: true });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /users-by-email\?email=invited%40example\.test$/);
  assert.equal(new Headers(requests[0].options.headers).get("authorization"), "Bearer management-token-secret");

  const failing = new Auth0ProvisioningAdapter({
    config: {
      issuer: ISSUER,
      managementApiBaseUrl: "https://pilot.au.auth0.com/api/v2/",
      connection: "email"
    },
    accessTokenProvider: async () => "management-token-secret",
    fetchImpl: async () => new Response("provider-private-detail", { status: 503 })
  });
  await assert.rejects(
    failing.provisionIdentity({
      normalizedEmail: "invited@example.test",
      operationId: "20000000-0000-4000-8000-000000000002"
    }),
    error => error?.code === "IDENTITY_PROVISIONING_UNAVAILABLE"
      && !/token|private|email@example/.test(error.message)
  );
});

test("Auth0 provisioning rejects malformed provider subjects before identity binding", async () => {
  const adapter = new Auth0ProvisioningAdapter({
    config: {
      issuer: ISSUER,
      managementApiBaseUrl: "https://pilot.au.auth0.com/api/v2/",
      connection: "email"
    },
    accessTokenProvider: async () => "management-token-secret",
    fetchImpl: async () => new Response(JSON.stringify([auth0EmailUser({
      user_id: "email|invited\nspoofed"
    })]), { status: 200, headers: { "content-type": "application/json" } })
  });

  await assert.rejects(adapter.provisionIdentity({
    normalizedEmail: "invited@example.test",
    operationId: "20000000-0000-4000-8000-000000000002"
  }), error => error?.code === "IDENTITY_PROVISIONING_UNAVAILABLE");
});

test("Auth0 provisioning proves the exact configured connection on lookup, create, and conflict reconciliation", async () => {
  const malformedUsers = [
    auth0EmailUser({ identities: undefined }),
    auth0EmailUser({ identities: [{ connection: "other-email", provider: "email", user_id: "provisioned" }] }),
    auth0EmailUser({ identities: [
      { connection: "email", provider: "email", user_id: "provisioned" },
      { connection: "email", provider: "email", user_id: "provisioned" }
    ] }),
    auth0EmailUser({
      user_id: "sms|provisioned",
      identities: [{ connection: "email", provider: "sms", user_id: "provisioned" }]
    }),
    auth0EmailUser({ identities: [{ connection: "email", provider: "email", user_id: "different" }] })
  ];

  for (const providerPath of ["lookup", "create", "conflict"]) {
    for (const malformed of malformedUsers) {
      let call = 0;
      const adapter = new Auth0ProvisioningAdapter({
        config: {
          issuer: ISSUER,
          managementApiBaseUrl: "https://pilot.au.auth0.com/api/v2/",
          connection: "email"
        },
        accessTokenProvider: async () => "management-token-secret",
        fetchImpl: async () => {
          call += 1;
          if (providerPath === "lookup") {
            return new Response(JSON.stringify([malformed]), { status: 200 });
          }
          if (call === 1) return new Response("[]", { status: 200 });
          if (providerPath === "create") {
            return new Response(JSON.stringify(malformed), { status: 201 });
          }
          if (call === 2) return new Response(null, { status: 409 });
          return new Response(JSON.stringify([malformed]), { status: 200 });
        }
      });

      await assert.rejects(adapter.provisionIdentity({
        normalizedEmail: "invited@example.test",
        operationId: "20000000-0000-4000-8000-000000000002"
      }), error => error?.code === "IDENTITY_PROVISIONING_UNAVAILABLE");
    }
  }
});

test("Auth0 provisioning accepts the exact configured connection on every reconciliation path", async () => {
  for (const providerPath of ["lookup", "create", "conflict"]) {
    let call = 0;
    const adapter = new Auth0ProvisioningAdapter({
      config: {
        issuer: ISSUER,
        managementApiBaseUrl: "https://pilot.au.auth0.com/api/v2/",
        connection: "email"
      },
      accessTokenProvider: async () => "management-token-secret",
      fetchImpl: async () => {
        call += 1;
        if (providerPath === "lookup") {
          return new Response(JSON.stringify([auth0EmailUser()]), { status: 200 });
        }
        if (call === 1) return new Response("[]", { status: 200 });
        if (providerPath === "create") {
          return new Response(JSON.stringify(auth0EmailUser()), { status: 201 });
        }
        if (call === 2) return new Response(null, { status: 409 });
        return new Response(JSON.stringify([auth0EmailUser()]), { status: 200 });
      }
    });

    assert.deepEqual(await adapter.provisionIdentity({
      normalizedEmail: "invited@example.test",
      operationId: "20000000-0000-4000-8000-000000000002"
    }), {
      issuer: ISSUER,
      subject: "email|provisioned",
      reconciled: providerPath !== "create"
    });
  }
});

test("provisioned invitation records exact issuer+subject atomically before it becomes usable and reconciles retries", async () => {
  const events = [];
  let recordCalls = 0;
  const service = new IdentityOperationsService({
    repository: {
      async preflightProvisionedInvitation(input) {
        events.push(["preflight", input]);
        return { status: "AUTHORIZED", tenantId: input.tenantId };
      },
      async createProvisionedInvitation(input) {
        events.push(["record", input]);
        recordCalls += 1;
        return {
          status: recordCalls === 1 ? "CREATED" : "RECONCILED",
          invitationId: input.operationId
        };
      }
    },
    provisioner: {
      async provisionIdentity(input) {
        events.push(["provider", input]);
        return { issuer: ISSUER, subject: "email|provisioned", reconciled: true };
      }
    },
    randomBytes: size => Buffer.alloc(size, 9)
  });
  const input = {
    operationId: "20000000-0000-4000-8000-000000000002",
    tenantId: TENANT_ID,
    actor: { issuer: ISSUER, subject: "auth0|owner" },
    email: "Invited@Example.Test",
    role: "MEMBER",
    expiresAt: "2026-09-21T00:00:00.000Z",
    apply: true,
    confirmation: "CREATE_PROVISIONED_INVITATION"
  };

  const created = await service.createProvisionedInvitation(input);
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(events[0][0], "preflight");
  assert.equal(events[1][0], "provider");
  assert.equal(events[2][0], "record");
  assert.equal(events[2][1].expectedIssuer, ISSUER);
  assert.equal(events[2][1].expectedSubject, "email|provisioned");
  assert.equal(events[2][1].status, "PENDING");
  assert.equal(JSON.stringify(events[2][1]).includes(created.token), false);

  const replay = await service.createProvisionedInvitation(input);
  assert.equal(replay.status, "RECONCILED");
});

test("provisioned invitation denies before provider access when exact operator authority preflight fails", async () => {
  let providerCalls = 0;
  let recordCalls = 0;
  const service = new IdentityOperationsService({
    repository: {
      async preflightProvisionedInvitation() {
        throw new IdentityOperationError();
      },
      async createProvisionedInvitation() { recordCalls += 1; }
    },
    provisioner: {
      async provisionIdentity() { providerCalls += 1; }
    }
  });

  await assert.rejects(service.createProvisionedInvitation({
    operationId: "20000000-0000-4000-8000-000000000002",
    tenantId: TENANT_ID,
    actor: { issuer: ISSUER, subject: "auth0|owner" },
    email: "invited@example.test",
    role: "MEMBER",
    expiresAt: "2099-09-21T00:00:00.000Z",
    apply: true,
    confirmation: "CREATE_PROVISIONED_INVITATION"
  }), denied);
  assert.equal(providerCalls, 0);
  assert.equal(recordCalls, 0);
});
