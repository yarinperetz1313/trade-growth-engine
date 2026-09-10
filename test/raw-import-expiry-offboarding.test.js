"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AuthorizationError,
  resolveTenantContext
} = require("../src/auth/authorization");
const {
  bridgeAuthTenantContext
} = require("../src/app/server");
const {
  createTenantContext: createPersistenceTenantContext
} = require("../src/persistence/tenantContext");

const TENANT_A = "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e";

function loadOffboarding() {
  return require("../src/tenantOffboarding/tenantOffboardingService");
}

async function authContext(role = "OWNER") {
  const identity = {
    issuer: "https://pilot.au.auth0.com/",
    subject: `auth0|${role.toLowerCase()}-a`
  };
  return resolveTenantContext({
    identity,
    membershipRepository: {
      async findActiveMembershipsByIdentity() {
        return [{
          tenantId: TENANT_A,
          issuer: identity.issuer,
          subject: identity.subject,
          role,
          status: "ACTIVE"
        }];
      }
    }
  });
}

function offboardingPersistence(result = {
  requestId: "offboarding-request-a",
  state: "PENDING",
  scope: "ACCESS_AND_RAW_EVIDENCE_ONLY",
  retryable: false,
  requestedAt: "2026-09-10T02:00:00.000Z"
}) {
  const calls = [];
  return {
    adapter: "postgres",
    calls,
    forTenant(context) {
      calls.push(["forTenant", context]);
      return {
        tenantOffboarding: {
          async request(input) {
            calls.push(["request", input]);
            return structuredClone(result);
          },
          async status() {
            calls.push(["status"]);
            return structuredClone(result);
          }
        }
      };
    }
  };
}

test("tenant offboarding request requires OWNER plus the sensitive-action boundary", async () => {
  const { createTenantOffboardingService } = loadOffboarding();
  const owner = await authContext("OWNER");
  const persistence = offboardingPersistence();
  const policyCalls = [];
  const service = createTenantOffboardingService({
    persistence,
    sensitiveActionPolicy: {
      async assertSatisfied(input) {
        policyCalls.push(input);
      }
    },
    assuranceResolver: async () => ({ amr: ["mfa"] })
  });

  const result = await service.request({
    authorizationContext: owner,
    persistenceContext: bridgeAuthTenantContext(owner),
    input: { confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE" },
    request: { marker: "request" }
  });

  assert.deepEqual(result, {
    requestId: "offboarding-request-a",
    state: "PENDING",
    scope: "ACCESS_AND_RAW_EVIDENCE_ONLY",
    retryable: false,
    requestedAt: "2026-09-10T02:00:00.000Z"
  });
  assert.equal(policyCalls.length, 1);
  assert.equal(policyCalls[0].action, "TENANT_OFFBOARDING_REQUEST");
  assert.deepEqual(persistence.calls.map(([name]) => name), [
    "forTenant", "request"
  ]);
  assert.deepEqual(persistence.calls[1][1], {
    confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
  });
});

test("tenant offboarding fails closed when no sensitive-action policy is injected", async () => {
  const { createTenantOffboardingService } = loadOffboarding();
  const owner = await authContext("OWNER");
  const persistence = offboardingPersistence();
  const service = createTenantOffboardingService({ persistence });

  await assert.rejects(
    service.request({
      authorizationContext: owner,
      persistenceContext: bridgeAuthTenantContext(owner),
      input: { confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE" }
    }),
    error => error instanceof AuthorizationError
      && error.code === "ACCESS_DENIED"
      && error.message === "Access is denied."
  );
  assert.equal(persistence.calls.length, 0);
});

test("ADMIN, MEMBER, and a forged persistence context receive the same denial", async () => {
  const { createTenantOffboardingService } = loadOffboarding();
  const service = createTenantOffboardingService({
    persistence: offboardingPersistence(),
    sensitiveActionPolicy: { async assertSatisfied() {} }
  });

  for (const role of ["ADMIN", "MEMBER"]) {
    const context = await authContext(role);
    await assert.rejects(
      service.request({
        authorizationContext: context,
        persistenceContext: bridgeAuthTenantContext(context),
        input: { confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE" }
      }),
      error => error instanceof AuthorizationError
        && error.code === "ACCESS_DENIED"
        && error.message === "Access is denied."
    );
  }

  const owner = await authContext("OWNER");
  const wrongIssuer = createPersistenceTenantContext({
    tenantId: owner.tenantId,
    identityIssuer: "https://other.au.auth0.com/",
    subjectId: owner.subject
  });
  await assert.rejects(
    service.request({
      authorizationContext: owner,
      persistenceContext: wrongIssuer,
      input: { confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE" }
    }),
    error => error instanceof AuthorizationError
      && error.code === "ACCESS_DENIED"
      && error.message === "Access is denied."
  );
  const wrongSubject = createPersistenceTenantContext({
    tenantId: owner.tenantId,
    identityIssuer: owner.issuer,
    subjectId: "auth0|different-owner"
  });
  await assert.rejects(
    service.request({
      authorizationContext: owner,
      persistenceContext: wrongSubject,
      input: { confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE" }
    }),
    error => error instanceof AuthorizationError
      && error.code === "ACCESS_DENIED"
      && error.message === "Access is denied."
  );
  await assert.rejects(
    service.request({
      authorizationContext: owner,
      persistenceContext: {
        tenantId: "b0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
        subjectId: owner.subject
      },
      input: { confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE" }
    }),
    error => error instanceof AuthorizationError
      && error.code === "ACCESS_DENIED"
      && error.message === "Access is denied."
  );
});

test("offboarding rejects caller-authored tenant, target, role, time, and unknown fields", async () => {
  const { TenantOffboardingError, createTenantOffboardingService } = loadOffboarding();
  const owner = await authContext("OWNER");
  const persistence = offboardingPersistence();
  const service = createTenantOffboardingService({
    persistence,
    sensitiveActionPolicy: { async assertSatisfied() {} }
  });

  for (const field of ["tenantId", "target", "role", "requestedAt", "now"]) {
    await assert.rejects(
      service.request({
        authorizationContext: owner,
        persistenceContext: bridgeAuthTenantContext(owner),
        input: {
          confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE",
          [field]: "attacker-authority"
        }
      }),
      error => error instanceof TenantOffboardingError
        && error.code === "TENANT_OFFBOARDING_REQUEST_INVALID"
    );
  }
  assert.equal(persistence.calls.length, 0);
});

test("offboarding status is tenant-bound, targetless, and privacy minimized", async () => {
  const { createTenantOffboardingService } = loadOffboarding();
  const owner = await authContext("OWNER");
  const persistence = offboardingPersistence({
    requestId: "offboarding-request-a",
    state: "OFFBOARDED_ACCESS_REVOKED",
    scope: "ACCESS_AND_RAW_EVIDENCE_ONLY",
    retryable: false,
    requestedAt: "2026-09-10T02:00:00.000Z",
    completedAt: "2026-09-10T02:01:00.000Z",
    deletionEvidence: {
      rawImportBatchesScrubbed: 2,
      rawImportRowsScrubbed: 4,
      membershipsRevoked: 1,
      invitationsDeleted: 1,
      canonicalRecordsRetained: 3,
      auditEventsRetained: 2,
      externalActionsPerformed: false
    }
  });
  const service = createTenantOffboardingService({
    persistence,
    sensitiveActionPolicy: { async assertSatisfied() {} }
  });

  const result = await service.status({
    authorizationContext: owner,
    persistenceContext: bridgeAuthTenantContext(owner)
  });

  assert.equal(result.state, "OFFBOARDED_ACCESS_REVOKED");
  assert.equal(result.deletionEvidence.canonicalRecordsRetained, 3);
  assert.equal(result.deletionEvidence.externalActionsPerformed, false);
  assert.deepEqual(persistence.calls.map(([name]) => name), [
    "forTenant", "status"
  ]);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "rawPayload", "contentBase64", "token", "dsn", "email", "subjectId"
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});
