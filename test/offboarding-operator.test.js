"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const TENANT = "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e";
const ACTOR = Object.freeze({
  tenantId: TENANT,
  issuer: "https://pilot.au.auth0.com/",
  subject: "auth0|named-owner"
});

function loadOperator() {
  return require("../src/tenantOffboarding/operatorWorkflow");
}

function fixture({ status = null, role = "OWNER", ambiguous = false } = {}) {
  const calls = [];
  const workflow = loadOperator().createOffboardingOperatorWorkflow({
    authority: {
      async resolveActiveOwner(input) {
        calls.push(["resolveActiveOwner", input]);
        if (ambiguous) {
          throw new Error("ambiguous provider detail");
        }
        if (role !== "OWNER") {
          return { ...input, role };
        }
        return { ...input, role: "OWNER", authorizationContext: {}, persistenceContext: {} };
      }
    },
    requestService: {
      async request(input) {
        calls.push(["request", input]);
        return status || {
          requestId: "request-a",
          state: "PENDING",
          scope: "ACCESS_AND_RAW_EVIDENCE_ONLY",
          retryable: false,
          requestedAt: "2026-09-20T00:00:00.000Z"
        };
      }
    },
    receiptRepository: {
      async read(input) {
        calls.push(["read", input]);
        return status;
      }
    }
  });
  return { calls, workflow };
}

test("request defaults to a zero-side-effect dry run", async () => {
  const { calls, workflow } = fixture();

  const result = await workflow.request({ ...ACTOR, apply: false });

  assert.deepEqual(result, {
    code: "OFFBOARDING_REQUEST_DRY_RUN_READY",
    mode: "DRY_RUN",
    state: "NOT_REQUESTED",
    scope: "ACCESS_AND_RAW_EVIDENCE_ONLY",
    databaseWritesPerformed: false,
    offboardingEffectsApplied: false,
    nextAction: {
      code: "EXPLICIT_APPLY_REQUIRED",
      runbook: "docs/runbooks/external-pilot-offboarding.md"
    }
  });
  assert.deepEqual(calls.map(([name]) => name), ["read", "resolveActiveOwner"]);
});

test("apply requires the exact confirmation and delegates to the authoritative service", async () => {
  const { calls, workflow } = fixture();

  await assert.rejects(
    workflow.request({ ...ACTOR, apply: true, confirmation: "yes" }),
    error => error.code === "OFFBOARDING_CONFIRMATION_REQUIRED"
  );
  assert.equal(calls.length, 0);

  const result = await workflow.request({
    ...ACTOR,
    apply: true,
    confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
  });
  assert.equal(result.code, "OFFBOARDING_REQUEST_ACCEPTED");
  assert.equal(result.state, "PENDING");
  assert.equal(result.requestMutationAttempted, true);
  assert.equal(result.offboardingEffectsApplied, false);
  assert.equal(result.nextAction.command, "npm run maintenance:cleanup");
  assert.deepEqual(calls.map(([name]) => name), [
    "read", "resolveActiveOwner", "request"
  ]);
  assert.deepEqual(calls[2][1].input, {
    confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
  });
});

test("request fails closed for cross-tenant, ambiguous, non-owner, and terminal states", async () => {
  for (const setup of [
    { ambiguous: true, code: "OFFBOARDING_OWNER_UNAVAILABLE" },
    { role: "ADMIN", code: "OFFBOARDING_OWNER_UNAVAILABLE" },
    {
      status: {
        state: "OFFBOARDED_ACCESS_REVOKED",
        scope: "ACCESS_AND_RAW_EVIDENCE_ONLY"
      },
      code: "OFFBOARDING_REQUEST_TERMINAL"
    }
  ]) {
    const { workflow } = fixture(setup);
    await assert.rejects(
      workflow.request({ ...ACTOR, apply: false }),
      error => error.code === setup.code && !/provider detail/.test(error.message)
    );
  }
});

test("pending apply replay remains idempotent through the authoritative service", async () => {
  const pending = {
    requestId: "request-existing",
    state: "PENDING",
    scope: "ACCESS_AND_RAW_EVIDENCE_ONLY",
    retryable: false,
    requestedAt: "2026-09-20T00:00:00.000Z"
  };
  const { calls, workflow } = fixture({ status: pending });
  const result = await workflow.request({
    ...ACTOR,
    apply: true,
    confirmation: "OFFBOARD_ACCESS_AND_RAW_EVIDENCE"
  });

  assert.equal(result.requestId, undefined);
  assert.equal(result.state, "PENDING");
  assert.equal(calls.filter(([name]) => name === "request").length, 1);
});

test("receipt reports only lifecycle, evidence counts, and retention classes", async () => {
  const { workflow } = fixture({
    status: {
      state: "OFFBOARDED_ACCESS_REVOKED",
      scope: "ACCESS_AND_RAW_EVIDENCE_ONLY",
      retryable: false,
      requestedAt: "2026-09-20T00:00:00.000Z",
      completedAt: "2026-09-20T00:01:00.000Z",
      attemptCount: 1,
      deletionEvidence: {
        rawImportBatchesScrubbed: 2,
        rawImportRowsScrubbed: 4,
        membershipsRevoked: 1,
        invitationsDeleted: 1,
        canonicalRecordsRetained: 3,
        auditEventsRetained: 2,
        pilotEvidenceEventsRetained: 1,
        externalActionsPerformed: false
      },
      inventory: {
        canonicalCrmCount: 3,
        identityMapCount: 1,
        auditEvidenceCount: 2,
        pilotEvidenceCount: 1,
        activeMembershipCount: 0,
        invitationCount: 0,
        rawImportRowsRemaining: 0,
        rawImportBatchesWithSensitiveMetadata: 0
      }
    }
  });

  const result = await workflow.receipt(ACTOR);
  assert.equal(result.code, "OFFBOARDING_RECEIPT_COMPLETE");
  assert.equal(result.deletionEvidence.immutableEvidenceCount, 1);
  assert.deepEqual(result.retentionInventory.canonicalCrm, {
    status: "RETAINED_CANONICAL_POLICY_PENDING",
    count: 3
  });
  assert.equal(result.retentionInventory.providerIdentity.status, "EXTERNAL_ACTION_REQUIRED");
  assert.equal(result.retentionInventory.backups.status, "UNKNOWN_EXTERNAL_POLICY");
  assert.equal(result.retentionInventory.logs.status, "UNKNOWN_EXTERNAL_POLICY");
  assert.equal(result.retentionInventory.exports.status, "UNKNOWN_EXTERNAL_POLICY");
  assert.equal(result.policyBoundary.canonicalDeletion, "NOT_PERFORMED");
  assert.equal(result.policyBoundary.backupExpiryAndRestoreReconciliation, "EXTERNAL_ACTION_REQUIRED");

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    TENANT,
    ACTOR.issuer,
    ACTOR.subject,
    "named-owner",
    "email",
    "filename",
    "dsn",
    "token"
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});

test("inspect and receipt fail closed when no actor-bound request exists", async () => {
  const { workflow } = fixture();
  await assert.rejects(
    workflow.inspect(ACTOR),
    error => error.code === "OFFBOARDING_REQUEST_UNAVAILABLE"
  );
  await assert.rejects(
    workflow.receipt(ACTOR),
    error => error.code === "OFFBOARDING_REQUEST_UNAVAILABLE"
  );
});

test("an existing request for another named actor fails closed", async () => {
  const calls = [];
  const workflow = loadOperator().createOffboardingOperatorWorkflow({
    authority: {
      async resolveActiveOwner() {
        calls.push("owner");
        return { ...ACTOR, role: "OWNER" };
      }
    },
    requestService: { async request() { calls.push("request"); } },
    receiptRepository: {
      async read() { return { actorMismatch: true }; }
    }
  });
  await assert.rejects(
    workflow.request({ ...ACTOR, apply: false }),
    error => error.code === "OFFBOARDING_REQUEST_ACTOR_MISMATCH"
  );
  await assert.rejects(
    workflow.receipt(ACTOR),
    error => error.code === "OFFBOARDING_REQUEST_UNAVAILABLE"
  );
  assert.deepEqual(calls, []);
});

test("CLI parser requires exact target identity and defaults request to dry-run", () => {
  const { parseOperatorArguments } = loadOperator();
  const parsed = parseOperatorArguments([
    "request",
    "--tenant", TENANT,
    "--issuer", ACTOR.issuer,
    "--subject", ACTOR.subject
  ]);
  assert.deepEqual(parsed, {
    command: "request",
    tenantId: TENANT,
    issuer: ACTOR.issuer,
    subject: ACTOR.subject,
    apply: false
  });

  for (const args of [
    ["request", "--tenant", TENANT, "--issuer", ACTOR.issuer],
    ["request", "--tenant", "not-a-uuid", "--issuer", ACTOR.issuer, "--subject", ACTOR.subject],
    ["delete", "--tenant", TENANT, "--issuer", ACTOR.issuer, "--subject", ACTOR.subject],
    ["request", "--tenant", TENANT, "--issuer", ACTOR.issuer, "--subject", ACTOR.subject, "--apply"]
  ]) {
    assert.throws(
      () => parseOperatorArguments(args),
      error => error.code === "OFFBOARDING_OPERATOR_INPUT_INVALID"
        || error.code === "OFFBOARDING_CONFIRMATION_REQUIRED"
    );
  }
});

test("operator configuration accepts only the dedicated DSN", () => {
  const { readOperatorConfiguration } = loadOperator();
  assert.throws(
    () => readOperatorConfiguration({ DATABASE_URL: "postgres://generic" }),
    error => error.code === "OFFBOARDING_OPERATOR_CONFIGURATION_INVALID"
  );
  assert.deepEqual(
    readOperatorConfiguration({
      TGE_OFFBOARDING_OPERATOR_DATABASE_URL: "postgres://dedicated"
    }),
    { connectionString: "postgres://dedicated" }
  );
});
