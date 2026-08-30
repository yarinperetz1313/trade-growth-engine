"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AuthorizationError,
  PERMISSIONS,
  assertPermission,
  assertTenantResource,
  authorizeSensitiveMembershipAction,
  resolveTenantContext,
  runWithTenantContext
} = require("../src/auth/authorization");

const IDENTITY = Object.freeze({
  issuer: "https://pilot.au.auth0.com/",
  subject: "auth0|member-1"
});

function membership(overrides = {}) {
  return {
    tenantId: "10000000-0000-4000-8000-000000000001",
    issuer: IDENTITY.issuer,
    subject: IDENTITY.subject,
    role: "MEMBER",
    status: "ACTIVE",
    ...overrides
  };
}

test("membership resolution derives one immutable TenantContext from issuer and subject", async () => {
  const calls = [];
  const membershipRepository = {
    async findActiveMembershipsByIdentity(identity) {
      calls.push(identity);
      return [membership()];
    }
  };

  const context = await resolveTenantContext({
    identity: IDENTITY,
    membershipRepository,
    untrustedRequest: {
      tenantId: "attacker-tenant",
      role: "OWNER",
      email: "attacker@example.test",
      headers: { "x-tenant-id": "attacker-tenant" }
    }
  });

  assert.deepEqual(calls, [IDENTITY]);
  assert.deepEqual(context, {
    tenantId: membership().tenantId,
    issuer: IDENTITY.issuer,
    subject: IDENTITY.subject,
    role: "MEMBER"
  });
  assert.equal(Object.isFrozen(context), true);
  assert.throws(() => {
    context.role = "OWNER";
  }, TypeError);
});

test("missing, inactive, mismatched, and ambiguous memberships fail closed identically", async () => {
  const membershipSets = [
    [],
    [membership({ status: "SUSPENDED" })],
    [membership({ issuer: "https://wrong.example/" })],
    [membership({ subject: "auth0|other" })],
    [membership(), membership({ tenantId: "20000000-0000-4000-8000-000000000002" })]
  ];

  for (const memberships of membershipSets) {
    await assert.rejects(
      resolveTenantContext({
        identity: IDENTITY,
        membershipRepository: {
          async findActiveMembershipsByIdentity() {
            return memberships;
          }
        }
      }),
      error =>
        error instanceof AuthorizationError
        && error.code === "ACCESS_DENIED"
        && error.message === "Access is denied."
    );
  }
});

test("OWNER, ADMIN, and MEMBER use one canonical permission matrix", async () => {
  const allowed = {
    OWNER: Object.values(PERMISSIONS),
    ADMIN: [
      PERMISSIONS.CRM_READ,
      PERMISSIONS.CRM_WRITE,
      PERMISSIONS.OPERATIONAL_ADMIN
    ],
    MEMBER: [PERMISSIONS.CRM_READ, PERMISSIONS.CRM_WRITE]
  };

  for (const role of ["OWNER", "ADMIN", "MEMBER"]) {
    const context = await resolveTenantContext({
      identity: IDENTITY,
      membershipRepository: {
        async findActiveMembershipsByIdentity() {
          return [membership({ role })];
        }
      }
    });
    for (const permission of Object.values(PERMISSIONS)) {
      if (allowed[role].includes(permission)) {
        assert.doesNotThrow(() => assertPermission(context, permission));
      } else {
        assert.throws(
          () => assertPermission(context, permission),
          AuthorizationError,
          `${role} must not receive ${permission}`
        );
      }
    }
  }
});

test("cross-tenant and nonexistent resources share the same non-oracle denial", async () => {
  const context = await resolveTenantContext({
    identity: IDENTITY,
    membershipRepository: {
      async findActiveMembershipsByIdentity() {
        return [membership()];
      }
    }
  });

  for (const resource of [null, { tenantId: "other-tenant", id: "known" }]) {
    assert.throws(
      () => assertTenantResource(context, resource),
      error =>
        error instanceof AuthorizationError
        && error.code === "RESOURCE_UNAVAILABLE"
        && error.message === "The requested resource is unavailable."
    );
  }
});

test("sensitive membership actions require an injected reauthentication/MFA-ready policy", async () => {
  const owner = await resolveTenantContext({
    identity: IDENTITY,
    membershipRepository: {
      async findActiveMembershipsByIdentity() {
        return [membership({ role: "OWNER" })];
      }
    }
  });
  const calls = [];

  await authorizeSensitiveMembershipAction({
    tenantContext: owner,
    action: "INVITATION_CREATE",
    assurance: { reauthenticatedAt: "2026-08-30T01:00:00.000Z", amr: ["mfa"] },
    sensitiveActionPolicy: {
      async assertSatisfied(input) {
        calls.push(input);
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "INVITATION_CREATE");

  await assert.rejects(
    authorizeSensitiveMembershipAction({
      tenantContext: owner,
      action: "INVITATION_CREATE",
      assurance: {},
      sensitiveActionPolicy: null
    }),
    AuthorizationError
  );
});

test("the PR-3 transaction seam accepts only trusted TenantContext", async () => {
  const context = await resolveTenantContext({
    identity: IDENTITY,
    membershipRepository: {
      async findActiveMembershipsByIdentity() {
        return [membership({ role: "ADMIN" })];
      }
    }
  });
  const calls = [];
  const value = await runWithTenantContext({
    tenantContext: context,
    transactionRunner: {
      async run(trustedContext, work) {
        calls.push(trustedContext);
        return work({ marker: "transaction" });
      }
    },
    work: transaction => transaction.marker
  });

  assert.equal(value, "transaction");
  assert.deepEqual(calls, [context]);
  await assert.rejects(
    runWithTenantContext({
      tenantContext: { ...context, role: "OWNER" },
      transactionRunner: { async run() {} },
      work: async () => {}
    }),
    AuthorizationError
  );
});
