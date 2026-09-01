const assert = require("node:assert/strict");
const test = require("node:test");

const {
  bridgeAuthTenantContext,
  createApp
} = require("../src/app/server");
const {
  createAuthRuntime,
  validateAuthRuntimeConfig
} = require("../src/auth/runtime");
const {
  InMemoryAuthRepository
} = require("../src/auth/inMemoryAuthRepository");
const {
  InvitationService
} = require("../src/auth/invitations");
const {
  resolveTenantContext
} = require("../src/auth/authorization");
const {
  requireTenantContext: requirePersistenceTenantContext
} = require("../src/persistence/tenantContext");

const ISSUER = "https://pilot.au.auth0.com/";
const TENANT_ID = "10000000-0000-4000-8000-000000000001";

function createFixture({ withInvitations = false } = {}) {
  const repository = new InMemoryAuthRepository({
    memberships: [{
      tenantId: TENANT_ID,
      issuer: ISSUER,
      subject: "auth0|owner",
      role: "OWNER",
      status: "ACTIVE"
    }]
  });
  const invitationService = withInvitations
    ? new InvitationService({
      repository,
      sensitiveActionPolicy: { async assertSatisfied() {} },
      provisioningPolicy: { async assertServerOperation() {} }
    })
    : null;
  const runtime = createAuthRuntime({
    config: {
      issuer: ISSUER,
      audience: "https://api.tradegrowth.example",
      jwksUri: `${ISSUER}.well-known/jwks.json`,
      clientId: "public-spa-client-id",
      allowedOrigins: ["https://app.example.test"],
      callbackUrls: ["https://app.example.test/auth/callback"],
      logoutUrls: ["https://app.example.test/signed-out"]
    },
    tokenVerifier: {
      async verify(token) {
        if (token === "owner-token") {
          return Object.freeze({ issuer: ISSUER, subject: "auth0|owner" });
        }
        if (token === "uninvited-token") {
          return Object.freeze({ issuer: ISSUER, subject: "auth0|uninvited" });
        }
        if (token === "invited-token") {
          return Object.freeze({ issuer: ISSUER, subject: "auth0|invited" });
        }
        throw new Error("sensitive verifier detail");
      }
    },
    membershipRepository: repository,
    invitationService,
    assuranceResolver: async () => ({ amr: ["mfa"] })
  });
  return {
    app: createApp({ authRuntime: runtime }),
    authRuntime: runtime,
    repository,
    invitationService
  };
}

async function withServer(app, work) {
  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await work(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return {
    status: response.status,
    headers: response.headers,
    data: await response.json()
  };
}

test("auth-enabled API rejects missing/malformed tokens without leaking verifier details", async () => {
  const { app } = createFixture();
  await withServer(app, async baseUrl => {
    for (const authorization of [undefined, "Basic bad", "Bearer invalid-token"]) {
      const result = await request(baseUrl, "/api/auth/context", {
        headers: authorization ? { authorization } : undefined
      });
      assert.equal(result.status, 401);
      assert.deepEqual(result.data, {
        ok: false,
        error: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required."
      });
      assert.doesNotMatch(JSON.stringify(result.data), /sensitive|token/i);
    }
  });
});

test("valid but uninvited identity receives no TenantContext", async () => {
  const { app } = createFixture();
  await withServer(app, async baseUrl => {
    const result = await request(baseUrl, "/api/auth/context", {
      headers: { authorization: "Bearer uninvited-token" }
    });
    assert.equal(result.status, 403);
    assert.deepEqual(result.data, {
      ok: false,
      error: "ACCESS_DENIED",
      message: "Access is denied."
    });
  });
});

test("auth mode fails closed when the PR-3 persistence boundary is absent", async () => {
  const fixture = createFixture();
  for (const persistence of [undefined, { adapter: "json" }]) {
    const app = persistence
      ? createApp({ authRuntime: fixture.authRuntime, persistence })
      : fixture.app;
    await withServer(app, async baseUrl => {
      const result = await request(baseUrl, "/api/opportunities", {
        headers: { authorization: "Bearer owner-token" }
      });
      assert.equal(result.status, 503);
      assert.deepEqual(result.data, {
        ok: false,
        error: "TENANT_PERSISTENCE_UNAVAILABLE",
        message: "Tenant-scoped persistence is unavailable."
      });
    });
  }
});

test("auth mode bridges its trusted context into PostgreSQL persistence", async () => {
  const fixture = createFixture();
  let receivedContext;
  const persistence = {
    adapter: "postgres",
    forTenant(context) {
      receivedContext = requirePersistenceTenantContext(context);
      return {
        prospects: { async list() { return []; } },
        opportunities: { async list() { return []; } },
        tasks: { async list() { return []; } },
        activities: { async list() { return []; } },
        revenueActions: { async list() { return []; } },
        async transaction(work) { return work(this); }
      };
    }
  };
  const app = createApp({ authRuntime: fixture.authRuntime, persistence });

  await withServer(app, async baseUrl => {
    const result = await request(baseUrl, "/api/opportunities", {
      headers: {
        authorization: "Bearer owner-token",
        "x-tenant-id": "attacker"
      }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { ok: true, data: [], count: 0 });
    assert.deepEqual(receivedContext, {
      tenantId: TENANT_ID,
      subjectId: "auth0|owner"
    });
    assert.equal(Object.isFrozen(receivedContext), true);
  });
});

test("the server bridge preserves independent auth and persistence context brands", async () => {
  const repository = new InMemoryAuthRepository({
    memberships: [{
      tenantId: TENANT_ID,
      issuer: ISSUER,
      subject: "auth0|owner",
      role: "OWNER",
      status: "ACTIVE"
    }]
  });
  const authContext = await resolveTenantContext({
    identity: { issuer: ISSUER, subject: "auth0|owner" },
    membershipRepository: repository
  });

  assert.throws(
    () => requirePersistenceTenantContext(authContext),
    /trusted server-created TenantContext/
  );
  assert.throws(
    () => bridgeAuthTenantContext({
      tenantId: TENANT_ID,
      issuer: ISSUER,
      subject: "auth0|owner",
      role: "OWNER"
    }),
    /Access is denied/
  );

  const persistenceContext = bridgeAuthTenantContext(authContext);
  assert.equal(requirePersistenceTenantContext(persistenceContext), persistenceContext);
  assert.deepEqual(persistenceContext, {
    tenantId: TENANT_ID,
    subjectId: "auth0|owner"
  });
});

test("server-derived context ignores client tenant, role, email, and custom-claim inputs", async () => {
  const { app } = createFixture();
  await withServer(app, async baseUrl => {
    const result = await request(
      baseUrl,
      "/api/auth/context?tenantId=attacker&role=OWNER&email=attacker@example.test",
      {
        headers: {
          authorization: "Bearer owner-token",
          "x-tenant-id": "attacker",
          "x-role": "MEMBER"
        }
      }
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, {
      ok: true,
      tenantContext: {
        tenantId: TENANT_ID,
        issuer: ISSUER,
        subject: "auth0|owner",
        role: "OWNER"
      }
    });
  });
});

test("public SPA configuration exposes no secret and keeps exact URL allowlists", async () => {
  const { app } = createFixture();
  await withServer(app, async baseUrl => {
    const result = await request(baseUrl, "/api/auth/config", {
      headers: { origin: "https://app.example.test" }
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.data, {
      issuer: ISSUER,
      audience: "https://api.tradegrowth.example",
      clientId: "public-spa-client-id",
      callbackUrls: ["https://app.example.test/auth/callback"],
      logoutUrls: ["https://app.example.test/signed-out"]
    });
    assert.equal(result.headers.get("access-control-allow-origin"), "https://app.example.test");
    assert.doesNotMatch(JSON.stringify(result.data), /secret|management|otp|token/i);

    const denied = await request(baseUrl, "/api/auth/config", {
      headers: { origin: "https://evil.example" }
    });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  });
});

test("Auth0 browser URL configuration rejects wildcards, HTTP, and credentials", () => {
  const base = {
    issuer: ISSUER,
    audience: "https://api.tradegrowth.example",
    jwksUri: `${ISSUER}.well-known/jwks.json`,
    clientId: "public-spa-client-id",
    allowedOrigins: ["https://app.example.test"],
    callbackUrls: ["https://app.example.test/auth/callback"],
    logoutUrls: ["https://app.example.test/signed-out"]
  };
  for (const override of [
    { allowedOrigins: ["https://*.example.test"] },
    { allowedOrigins: ["http://app.example.test"] },
    { callbackUrls: ["https://user@app.example.test/auth/callback"] },
    { logoutUrls: ["javascript:alert(1)"] }
  ]) {
    assert.throws(
      () => validateAuthRuntimeConfig({ ...base, ...override }),
      /Auth0/
    );
  }
});

test("assisted invitation routes require explicit begin and activate only the provisioned identity", async () => {
  const fixture = createFixture({ withInvitations: true });
  const ownerContext = await resolveTenantContext({
    identity: { issuer: ISSUER, subject: "auth0|owner" },
    membershipRepository: fixture.repository
  });

  await withServer(fixture.app, async baseUrl => {
    const created = await request(baseUrl, "/api/auth/invitations", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email: "invited@example.test",
        role: "MEMBER",
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      })
    });
    assert.equal(created.status, 201);
    const { token, invitation } = created.data;

    await fixture.invitationService.recordProvisionedIdentity({
      tenantContext: ownerContext,
      invitationId: invitation.id,
      identity: { issuer: ISSUER, subject: "auth0|invited" },
      provisioningContext: { jobId: "server-job" }
    });

    const passiveLanding = await request(
      baseUrl,
      "/api/auth/invitations/begin"
    );
    assert.equal(passiveLanding.status, 401);

    const openRedirect = await request(
      baseUrl,
      "/api/auth/invitations/begin",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitationToken: token,
          redirectUri: "https://evil.example/callback"
        })
      }
    );
    assert.equal(openRedirect.status, 404);

    const begin = await request(
      baseUrl,
      "/api/auth/invitations/begin",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitationToken: token,
          redirectUri: "https://app.example.test/auth/callback"
        })
      }
    );
    assert.equal(begin.status, 200);
    assert.equal(
      begin.data.authorization.redirectUri,
      "https://app.example.test/auth/callback"
    );

    const accepted = await request(
      baseUrl,
      "/api/auth/invitations/accept",
      {
        method: "POST",
        headers: {
          authorization: "Bearer invited-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ invitationToken: token })
      }
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.tenantContext.tenantId, TENANT_ID);
    assert.equal(accepted.data.tenantContext.role, "MEMBER");
  });
});
