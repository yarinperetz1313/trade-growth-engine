const assert = require("node:assert/strict");
const test = require("node:test");

const {
  InMemoryAuthRepository
} = require("../src/auth/inMemoryAuthRepository");
const {
  InvitationError,
  InvitationService
} = require("../src/auth/invitations");
const {
  resolveTenantContext
} = require("../src/auth/authorization");

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const ISSUER = "https://pilot.au.auth0.com/";
const OWNER_IDENTITY = Object.freeze({ issuer: ISSUER, subject: "auth0|owner" });
const MEMBER_IDENTITY = Object.freeze({ issuer: ISSUER, subject: "auth0|invited" });
const NOW = new Date("2026-08-30T01:00:00.000Z");

async function createFixture() {
  const clock = { value: new Date(NOW) };
  const repository = new InMemoryAuthRepository({
    memberships: [{
      tenantId: TENANT_ID,
      issuer: ISSUER,
      subject: OWNER_IDENTITY.subject,
      role: "OWNER",
      status: "ACTIVE"
    }]
  });
  const ownerContext = await resolveTenantContext({
    identity: OWNER_IDENTITY,
    membershipRepository: repository
  });
  const provisioningCalls = [];
  const service = new InvitationService({
    repository,
    now: () => new Date(clock.value),
    randomBytes: size => Buffer.alloc(size, 7),
    sensitiveActionPolicy: {
      async assertSatisfied() {}
    },
    provisioningPolicy: {
      async assertServerOperation(input) {
        provisioningCalls.push(input);
      }
    }
  });

  return { repository, ownerContext, service, provisioningCalls, clock };
}

async function createProvisionedInvitation(fixture, overrides = {}) {
  const created = await fixture.service.create({
    tenantContext: fixture.ownerContext,
    email: "  Invited.User@Example.COM  ",
    role: "MEMBER",
    expiresAt: new Date(NOW.getTime() + 60_000),
    assurance: { amr: ["mfa"] },
    ...overrides
  });

  await fixture.service.recordProvisionedIdentity({
    tenantContext: fixture.ownerContext,
    invitationId: created.invitation.id,
    identity: MEMBER_IDENTITY,
    provisioningContext: { jobId: "provision-1" }
  });

  return created;
}

function unavailable(error) {
  return error instanceof InvitationError
    && error.code === "INVITATION_UNAVAILABLE"
    && error.message === "The invitation is unavailable.";
}

test("OWNER creates a hashed, expiring invitation and receives the token only once", async () => {
  const fixture = await createFixture();
  const created = await fixture.service.create({
    tenantContext: fixture.ownerContext,
    email: "  Invited.User@Example.COM  ",
    role: "ADMIN",
    expiresAt: new Date(NOW.getTime() + 60_000),
    assurance: { amr: ["mfa"] }
  });

  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.invitation.normalizedEmail, "invited.user@example.com");
  assert.equal(created.invitation.role, "ADMIN");
  assert.equal(created.invitation.status, "PENDING");
  assert.equal(created.invitation.tokenHash.length, 64);
  assert.equal(JSON.stringify(fixture.repository.snapshot()).includes(created.token), false);
  assert.equal(
    fixture.repository.snapshot().auditEvents.at(-1).eventType,
    "INVITATION_CREATED"
  );
});

test("non-OWNER roles cannot administer invitations", async () => {
  const fixture = await createFixture();
  const memberContext = await resolveTenantContext({
    identity: MEMBER_IDENTITY,
    membershipRepository: {
      async findActiveMembershipsByIdentity() {
        return [{
          tenantId: TENANT_ID,
          ...MEMBER_IDENTITY,
          role: "MEMBER",
          status: "ACTIVE"
        }];
      }
    }
  });

  await assert.rejects(
    fixture.service.create({
      tenantContext: memberContext,
      email: "new@example.test",
      role: "MEMBER",
      expiresAt: new Date(NOW.getTime() + 60_000),
      assurance: {}
    }),
    /Access is denied/
  );
});

test("server-only provisioning records the exact expected issuer and subject", async () => {
  const fixture = await createFixture();
  const created = await createProvisionedInvitation(fixture);
  const stored = fixture.repository.snapshot().invitations[0];

  assert.equal(fixture.provisioningCalls.length, 1);
  assert.equal(stored.expectedIssuer, MEMBER_IDENTITY.issuer);
  assert.equal(stored.expectedSubject, MEMBER_IDENTITY.subject);
  assert.equal(stored.status, "PENDING");
  assert.equal(
    fixture.repository.snapshot().auditEvents.at(-1).eventType,
    "INVITATION_IDENTITY_PROVISIONED"
  );
  assert.equal(created.invitation.expectedSubject, null);
});

test("invitation begin requires an explicit action and accepts only exact redirect allowlists", async () => {
  const fixture = await createFixture();
  const created = await createProvisionedInvitation(fixture);

  const result = await fixture.service.begin({
    token: created.token,
    redirectUri: "https://app.example.test/auth/callback",
    allowedRedirectUris: ["https://app.example.test/auth/callback"]
  });

  assert.deepEqual(result, {
    ready: true,
    redirectUri: "https://app.example.test/auth/callback"
  });

  await assert.rejects(
    fixture.service.begin({
      token: created.token,
      redirectUri: "https://evil.example/callback",
      allowedRedirectUris: ["https://app.example.test/auth/callback"]
    }),
    unavailable
  );
});

test("consume atomically activates membership, consumes once, and writes audit evidence", async () => {
  const fixture = await createFixture();
  const created = await createProvisionedInvitation(fixture);
  const context = await fixture.service.consume({
    token: created.token,
    identity: MEMBER_IDENTITY
  });

  assert.deepEqual(context, {
    tenantId: TENANT_ID,
    issuer: ISSUER,
    subject: MEMBER_IDENTITY.subject,
    role: "MEMBER"
  });
  assert.equal(Object.isFrozen(context), true);

  const snapshot = fixture.repository.snapshot();
  assert.equal(snapshot.invitations[0].status, "CONSUMED");
  assert.equal(snapshot.invitations[0].consumedAt, NOW.toISOString());
  assert.ok(snapshot.memberships.some(item =>
    item.tenantId === TENANT_ID
    && item.issuer === ISSUER
    && item.subject === MEMBER_IDENTITY.subject
    && item.status === "ACTIVE"
  ));
  assert.deepEqual(
    snapshot.auditEvents.slice(-2).map(event => event.eventType),
    ["MEMBERSHIP_ACTIVATED", "INVITATION_CONSUMED"]
  );

  await assert.rejects(
    fixture.service.consume({ token: created.token, identity: MEMBER_IDENTITY }),
    unavailable
  );
  assert.equal(fixture.repository.snapshot().memberships.length, 2);
});

test("expired, revoked, and identity-mismatched invitations fail with the same generic response", async () => {
  const expiredFixture = await createFixture();
  const expired = await createProvisionedInvitation(expiredFixture);
  expiredFixture.clock.value = new Date(NOW.getTime() + 60_001);
  await assert.rejects(
    expiredFixture.service.consume({ token: expired.token, identity: MEMBER_IDENTITY }),
    unavailable
  );

  const revokedFixture = await createFixture();
  const revoked = await createProvisionedInvitation(revokedFixture);
  await revokedFixture.service.revoke({
    tenantContext: revokedFixture.ownerContext,
    invitationId: revoked.invitation.id,
    assurance: { amr: ["mfa"] }
  });
  await assert.rejects(
    revokedFixture.service.consume({ token: revoked.token, identity: MEMBER_IDENTITY }),
    unavailable
  );

  const mismatchFixture = await createFixture();
  const mismatch = await createProvisionedInvitation(mismatchFixture);
  await assert.rejects(
    mismatchFixture.service.consume({
      token: mismatch.token,
      identity: { issuer: ISSUER, subject: "auth0|attacker" }
    }),
    unavailable
  );
  assert.equal(mismatchFixture.repository.snapshot().invitations[0].status, "PENDING");
  assert.equal(mismatchFixture.repository.snapshot().memberships.length, 1);
});

test("provisioning and revocation mutations are idempotent but conflicting replays fail", async () => {
  const fixture = await createFixture();
  const created = await createProvisionedInvitation(fixture);

  await fixture.service.recordProvisionedIdentity({
    tenantContext: fixture.ownerContext,
    invitationId: created.invitation.id,
    identity: MEMBER_IDENTITY,
    provisioningContext: { jobId: "retry" }
  });
  await fixture.service.revoke({
    tenantContext: fixture.ownerContext,
    invitationId: created.invitation.id,
    assurance: { amr: ["mfa"] }
  });
  await fixture.service.revoke({
    tenantContext: fixture.ownerContext,
    invitationId: created.invitation.id,
    assurance: { amr: ["mfa"] }
  });

  await assert.rejects(
    fixture.service.recordProvisionedIdentity({
      tenantContext: fixture.ownerContext,
      invitationId: created.invitation.id,
      identity: { issuer: ISSUER, subject: "auth0|different" },
      provisioningContext: { jobId: "conflict" }
    }),
    unavailable
  );
});
