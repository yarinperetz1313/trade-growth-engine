"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const repositoryRoot = path.resolve(__dirname, "..");
const packageJson = require("../package.json");
const command = path.join(
  repositoryRoot,
  "scripts",
  "run-assisted-pilot-acceptance.mjs"
);
const runbook = path.join(
  repositoryRoot,
  "docs",
  "operations",
  "ASSISTED_PILOT_ACCEPTANCE.md"
);

test("package exposes one repository-native assisted Pilot acceptance command", () => {
  assert.equal(
    packageJson.scripts["acceptance:pilot"],
    "node scripts/run-assisted-pilot-acceptance.mjs"
  );
  assert.equal(fs.statSync(command).isFile(), true);
});

for (const [name, value] of [
  ["missing", undefined],
  ["non-loopback", "postgresql://operator@example.com/production"]
]) {
  test(`acceptance command fails closed for ${name} database configuration`, () => {
    const env = { ...process.env };
    delete env.TGE_ACCEPTANCE_DATABASE_URL;
    if (value !== undefined) env.TGE_ACCEPTANCE_DATABASE_URL = value;

    const result = spawnSync(process.execPath, [command], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "ASSISTED_PILOT_ACCEPTANCE_CONFIGURATION_INVALID\n"
    );
  });
}

test("operator runbook preserves the executable journey and external-proof exclusions", () => {
  const content = fs.readFileSync(runbook, "utf8");

  for (const required of [
    "npm run acceptance:pilot",
    "PostgreSQL 16.15",
    "LOCAL_DETERMINISTIC_NOT_AUTH0_OR_SMTP",
    "CSV preview",
    "Data Health",
    "explicit canonical commit",
    "stalled-opportunity scan",
    "operating queue",
    "RevenueAction",
    "prepare",
    "approve",
    "external_send_performed",
    "Auth0 AU",
    "SMTP/OTP",
    "backup/restore",
    "privacy/vendor",
    "canonical tenant-data deletion"
  ]) {
    assert.match(content, new RegExp(escapeRegExp(required)), required);
  }
});

test("acceptance lifecycle emits a closed minimized proof and cleans success", async () => {
  const {
    runAssistedPilotAcceptance
  } = await import(`${pathToFileURL(command).href}?success-contract`);
  const calls = [];
  const proof = await runAssistedPilotAcceptance({
    env: {
      TGE_ACCEPTANCE_DATABASE_URL:
        "postgresql://operator:super-secret@127.0.0.1:55439/postgres"
    },
    provision: async resources => {
      calls.push("provision");
      resources.databaseName = "tge_acceptance_private_database";
      resources.runtimeRole = "tge_acceptance_private_role";
      resources.runtimePassword = "runtime-private-password";
      resources.runtimeUrl =
        "postgresql://tge_acceptance_private_role:runtime-private-password@127.0.0.1/private";
      return { postgresVersion: "16.15" };
    },
    journey: async () => {
      calls.push("journey");
      return completeJourneyEvidence({
        tenantId: "private-tenant-id",
        token: "private-bearer-token",
        filename: "private-customer.csv"
      });
    },
    cleanup: async () => {
      calls.push("cleanup");
      return {
        database: "REMOVED",
        runtime_login: "REMOVED",
        migration_roles: "REMOVED"
      };
    }
  });

  assert.deepEqual(calls, ["provision", "journey", "cleanup"]);
  assert.deepEqual(Object.keys(proof), [
    "status",
    "postgresql_version",
    "gates",
    "external_proof_exclusions",
    "cleanup"
  ]);
  assert.deepEqual(Object.keys(proof.gates), [
    "initial_readiness",
    "secure_readiness",
    "authentication",
    "membership_authority",
    "forged_client_tenant",
    "second_tenant_isolation",
    "import",
    "detector",
    "queue",
    "action"
  ]);
  assert.deepEqual(proof.gates.import, {
    preview_rows: 1,
    valid_rows: 1,
    blocking_rows: 0,
    committed_rows: 1,
    authoritative_currency: "AUD"
  });
  assert.deepEqual(proof.gates.action, {
    status: "EXECUTED",
    execution_mode: "SYSTEM_INTERNAL",
    effect_type: "INTERNAL_TASK",
    durable_case_id: true,
    durable_action_id: true,
    durable_task_id: true,
    durable_activity_id: true,
    external_send_performed: false
  });
  assert.deepEqual(proof.cleanup, {
    database: "REMOVED",
    runtime_login: "REMOVED",
    migration_roles: "REMOVED"
  });
  const serialized = JSON.stringify(proof);
  for (const prohibited of [
    "super-secret",
    "runtime-private-password",
    "private-tenant-id",
    "private-bearer-token",
    "private-customer.csv",
    "tge_acceptance_private_database",
    "tge_acceptance_private_role",
    "postgresql://"
  ]) {
    assert.equal(serialized.includes(prohibited), false, prohibited);
  }
});

test("acceptance lifecycle cleans provisioned resources after a journey failure", async () => {
  const {
    AcceptanceRunError,
    runAssistedPilotAcceptance
  } = await import(`${pathToFileURL(command).href}?failure-contract`);
  const calls = [];

  await assert.rejects(
    runAssistedPilotAcceptance({
      env: {
        TGE_ACCEPTANCE_DATABASE_URL:
          "postgresql://operator@127.0.0.1:55439/postgres"
      },
      provision: async resources => {
        calls.push("provision");
        resources.databaseName = "tge_acceptance_failure_database";
        resources.runtimeRole = "tge_acceptance_failure_role";
        return { postgresVersion: "16.15" };
      },
      journey: async () => {
        calls.push("journey");
        throw new Error("private customer failure detail");
      },
      cleanup: async () => {
        calls.push("cleanup");
        return {
          database: "REMOVED",
          runtime_login: "REMOVED",
          migration_roles: "REMOVED"
        };
      }
    }),
    error => {
      assert.equal(error instanceof AcceptanceRunError, true);
      assert.equal(error.code, "ASSISTED_PILOT_ACCEPTANCE_FAILED");
      assert.deepEqual(error.cleanup, {
        database: "REMOVED",
        runtime_login: "REMOVED",
        migration_roles: "REMOVED"
      });
      assert.equal(JSON.stringify(error).includes("private customer"), false);
      return true;
    }
  );
  assert.deepEqual(calls, ["provision", "journey", "cleanup"]);
});

test("cleanup never mutates pre-existing TGE roles when fresh-server preflight rejects", async () => {
  const {
    cleanupAcceptanceResources
  } = await import(`${pathToFileURL(command).href}?existing-server-guard`);
  const statements = [];
  const result = await cleanupAcceptanceResources({
    cleanServerVerified: false,
    databaseName: null,
    runtimeRole: null,
    runtime: null,
    runtimePool: null,
    databaseClient: null,
    operatorClient: {
      async query(statement) {
        statements.push(statement);
        return { rows: [] };
      },
      async end() {}
    },
    operatorUser: "acceptance_operator"
  });

  assert.deepEqual(statements, []);
  assert.deepEqual(result, {
    database: "REMOVED",
    runtime_login: "REMOVED",
    migration_roles: "REMOVED"
  });
});

function completeJourneyEvidence(extra = {}) {
  return {
    ...extra,
    initialReadiness: "NOT_READY",
    secureReadiness: "READY",
    authentication: "LOCAL_DETERMINISTIC_NOT_AUTH0_OR_SMTP",
    membershipAuthority: "VERIFIED",
    forgedClientTenant: "REJECTED",
    secondTenantIsolation: "VERIFIED",
    previewRows: 1,
    validRows: 1,
    blockingRows: 0,
    committedRows: 1,
    authoritativeCurrency: "AUD",
    evaluatedCount: 1,
    detectedCount: 1,
    queueCount: 1,
    rankedFirst: true,
    actionStatus: "EXECUTED",
    executionMode: "SYSTEM_INTERNAL",
    effectType: "INTERNAL_TASK",
    durableCaseId: true,
    durableActionId: true,
    durableTaskId: true,
    durableActivityId: true,
    externalSendPerformed: false
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
