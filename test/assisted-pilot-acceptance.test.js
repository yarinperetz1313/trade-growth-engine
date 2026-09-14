"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
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

test("competing role ownership after preflight is never revoked or dropped", async () => {
  const module = await import(`${pathToFileURL(command).href}?competing-role-owner`);
  assert.equal(typeof module.provisionAcceptanceResources, "function");

  const statements = [];
  let competingRolesPresent = false;
  const operatorClient = {
    async connect() {},
    async end() {},
    async query(statement) {
      statements.push(statement);
      if (/pg_try_advisory_lock/i.test(statement)) {
        return { rows: [{ acquired: true }] };
      }
      if (/current_setting\('server_version_num'\)/i.test(statement)) {
        return { rows: [{ version_number: "160015", operator: "acceptance_operator" }] };
      }
      if (/from pg_database/i.test(statement)) return { rows: [] };
      if (/from pg_roles where rolname = any/i.test(statement)) {
        return competingRolesPresent
          ? { rows: [
              { rolname: "tge_owner", ownership_marker: "another-run" },
              { rolname: "tge_migrator", ownership_marker: "another-run" },
              { rolname: "tge_runtime", ownership_marker: "another-run" },
              { rolname: "tge_maintenance", ownership_marker: "another-run" }
            ] }
          : { rows: [] };
      }
      if (/^create role tge_owner /i.test(statement)) {
        competingRolesPresent = true;
        const error = new Error("duplicate role");
        error.code = "42710";
        throw error;
      }
      return { rows: [] };
    }
  };
  class MockClient {
    constructor() {
      return operatorClient;
    }
  }

  await assert.rejects(
    module.runAssistedPilotAcceptance({
      env: {
        TGE_ACCEPTANCE_DATABASE_URL:
          "postgresql://operator@127.0.0.1:55439/postgres"
      },
      provision: resources => module.provisionAcceptanceResources(resources, {
        postgres: { Client: MockClient, Pool: class {} },
        migrate: async () => {}
      })
    }),
    error => error instanceof module.AcceptanceRunError
  );

  assert.equal(
    statements.some(statement => /^(?:revoke|drop role)/i.test(statement.trim())),
    false
  );
});

test("competing acceptance invocation is rejected before clean-server preflight", async () => {
  const module = await import(`${pathToFileURL(command).href}?competing-invocation`);
  assert.equal(typeof module.provisionAcceptanceResources, "function");

  const statements = [];
  const operatorClient = {
    async connect() {},
    async end() {},
    async query(statement) {
      statements.push(statement);
      if (/pg_try_advisory_lock/i.test(statement)) {
        return { rows: [{ acquired: false }] };
      }
      throw new Error("preflight must not run without exclusive ownership");
    }
  };
  class MockClient {
    constructor() {
      return operatorClient;
    }
  }

  await assert.rejects(
    module.runAssistedPilotAcceptance({
      env: {
        TGE_ACCEPTANCE_DATABASE_URL:
          "postgresql://operator@127.0.0.1:55439/postgres"
      },
      provision: resources => module.provisionAcceptanceResources(resources, {
        postgres: { Client: MockClient, Pool: class {} },
        migrate: async () => {}
      })
    }),
    error => error instanceof module.AcceptanceRunError
  );

  assert.equal(statements.length, 1);
  assert.match(statements[0], /pg_try_advisory_lock/i);
});

test("cleanup refuses to mutate a migration role whose ownership marker changed", async () => {
  const {
    cleanupAcceptanceResources
  } = await import(`${pathToFileURL(command).href}?changed-role-owner`);
  const statements = [];
  const result = await cleanupAcceptanceResources({
    operatorUrl: "postgresql://operator@127.0.0.1:55439/postgres",
    databaseName: null,
    runtimeRole: null,
    runtime: null,
    runtimePool: null,
    databaseClient: null,
    operatorUser: "acceptance_operator",
    acceptanceLockHeld: true,
    migrationRoleOwnershipToken: "this-run",
    operatorClient: {
      async query(statement) {
        statements.push(statement);
        if (/shobj_description/i.test(statement)) {
          return {
            rows: [
              { rolname: "tge_owner", ownership_marker: "this-run" },
              { rolname: "tge_migrator", ownership_marker: "this-run" },
              { rolname: "tge_runtime", ownership_marker: "another-run" },
              { rolname: "tge_maintenance", ownership_marker: "this-run" }
            ]
          };
        }
        return { rows: [] };
      },
      async end() {}
    }
  });

  assert.deepEqual(result, {
    database: "REMOVED",
    runtime_login: "REMOVED",
    migration_roles: "FAILED"
  });
  assert.equal(
    statements.some(statement => /^(?:revoke|drop role)/i.test(statement.trim())),
    false
  );
  assert.equal(statements.some(statement => /pg_advisory_unlock/i.test(statement)), true);
});

test("signal during role COMMIT drains provisioning before truthful cleanup", async () => {
  const module = await import(`${pathToFileURL(command).href}?signal-during-role-commit`);
  const signalTarget = new EventEmitter();
  signalTarget.pid = 12345;
  const killedSignals = [];
  signalTarget.kill = (pid, signal) => {
    assert.equal(pid, signalTarget.pid);
    killedSignals.push(signal);
  };

  const state = {
    databases: new Set(),
    roles: new Map(),
    runtimeRole: null
  };
  const statements = [];
  let journeyStarted = false;
  let committedSignalSent = false;
  const operatorClient = {
    async connect() {},
    async end() {},
    async query(statement, values = []) {
      const sql = String(statement).trim();
      statements.push(sql);
      if (/pg_try_advisory_lock/i.test(sql)) return { rows: [{ acquired: true }] };
      if (/current_setting\('server_version_num'\)/i.test(sql)) {
        return { rows: [{ version_number: "160015", operator: "acceptance_operator" }] };
      }
      if (/select datname from pg_database/i.test(sql)) {
        return { rows: [...state.databases].map(datname => ({ datname })) };
      }
      if (/from pg_roles\s+where rolname = any/i.test(sql)) {
        return {
          rows: [...state.roles].map(([rolname, ownership_marker]) => ({
            rolname,
            ownership_marker
          }))
        };
      }
      const fixedRole = sql.match(/^create role (tge_(?:owner|migrator|runtime|maintenance))\b/i);
      if (fixedRole) {
        state.roles.set(fixedRole[1], null);
        return { rows: [] };
      }
      if (/select format\('comment on role/i.test(sql)) {
        return { rows: [{ sql: `comment on role ${values[0]} is '${values[1]}'` }] };
      }
      const comment = sql.match(/^comment on role (tge_\w+) is '([^']+)'$/i);
      if (comment) {
        state.roles.set(comment[1], comment[2]);
        return { rows: [] };
      }
      if (/^commit$/i.test(sql) && !committedSignalSent) {
        committedSignalSent = true;
        signalTarget.emit("SIGTERM");
        await new Promise(resolve => setImmediate(resolve));
        return { rows: [] };
      }
      const createDatabase = sql.match(/^create database "([a-z0-9_]+)"$/i);
      if (createDatabase) {
        state.databases.add(createDatabase[1]);
        return { rows: [] };
      }
      const dropDatabase = sql.match(/^drop database if exists "([a-z0-9_]+)"$/i);
      if (dropDatabase) {
        state.databases.delete(dropDatabase[1]);
        return { rows: [] };
      }
      if (/select 1 from pg_database where datname/i.test(sql)) {
        return { rows: state.databases.has(values[0]) ? [{ "?column?": 1 }] : [] };
      }
      if (/select format\('create role %I login password/i.test(sql)) {
        return { rows: [{ sql: `create role ${values[0]} login` }] };
      }
      const runtimeRole = sql.match(/^create role (tge_acceptance_runtime_[a-z0-9]+) login$/i);
      if (runtimeRole) {
        state.runtimeRole = runtimeRole[1];
        return { rows: [] };
      }
      const dropRuntimeRole = sql.match(/^drop role if exists "(tge_acceptance_runtime_[a-z0-9]+)"$/i);
      if (dropRuntimeRole) {
        if (state.runtimeRole === dropRuntimeRole[1]) state.runtimeRole = null;
        return { rows: [] };
      }
      if (/select 1 from pg_roles where rolname = \$1/i.test(sql)) {
        return { rows: state.runtimeRole === values[0] ? [{ "?column?": 1 }] : [] };
      }
      const dropFixedRole = sql.match(/^drop role "(tge_\w+)"$/i);
      if (dropFixedRole) {
        state.roles.delete(dropFixedRole[1]);
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  class MockClient {
    constructor() {
      return operatorClient;
    }
  }

  let capturedError;
  try {
    await module.runAssistedPilotAcceptance({
      env: {
        TGE_ACCEPTANCE_DATABASE_URL:
          "postgresql://operator@127.0.0.1:55439/postgres"
      },
      signalTarget,
      provision: resources => module.provisionAcceptanceResources(resources, {
        postgres: { Client: MockClient, Pool: class {} },
        migrate: async () => {}
      }),
      journey: async () => {
        journeyStarted = true;
        return completeJourneyEvidence();
      }
    });
  } catch (error) {
    capturedError = error;
  }
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(capturedError instanceof module.AcceptanceRunError, true);
  assert.deepEqual(capturedError.cleanup, {
    database: "REMOVED",
    runtime_login: "REMOVED",
    migration_roles: "REMOVED"
  }, JSON.stringify({ state: {
    databases: [...state.databases],
    roles: [...state.roles],
    runtimeRole: state.runtimeRole
  }, statements }));
  assert.equal(journeyStarted, false);
  assert.deepEqual([...state.databases], []);
  assert.equal(state.runtimeRole, null);
  assert.deepEqual([...state.roles], []);
  assert.deepEqual(killedSignals, ["SIGTERM"]);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} cleans exactly once and then preserves signal termination`, async () => {
    const result = await runSignalLifecycleDiagnostic({ signal });
    try {
      assert.equal(result.code, null);
      assert.equal(result.signal, signal);
      assert.equal(fs.readFileSync(result.marker, "utf8"), "cleanup\n");
    } finally {
      fs.rmSync(result.fixtureRoot, { recursive: true, force: true });
    }
  });
}

test("stalled signal cleanup has a bounded forced-termination fallback", async () => {
  const result = await runSignalLifecycleDiagnostic({
    signal: "SIGTERM",
    stallCleanup: true,
    cleanupTimeoutMs: 50
  });
  try {
    assert.equal(result.code, null);
    assert.equal(result.signal, "SIGTERM");
    assert.equal(fs.readFileSync(result.marker, "utf8"), "cleanup\n");
  } finally {
    fs.rmSync(result.fixtureRoot, { recursive: true, force: true });
  }
});

for (const [name, firstSignal, repeatedSignal] of [
  ["repeated same signal", "SIGTERM", "SIGTERM"],
  ["mixed SIGINT/SIGTERM signals", "SIGINT", "SIGTERM"]
]) {
  test(`${name} cannot bypass cleanup before original signal termination`, async () => {
    const result = await runRepeatedSignalLifecycleDiagnostic({
      firstSignal,
      repeatedSignal
    });
    try {
      assert.equal(result.code, null);
      assert.equal(result.signal, firstSignal);
      assert.equal(
        fs.readFileSync(result.marker, "utf8"),
        "cleanup-started\ncleanup-complete\n"
      );
    } finally {
      fs.rmSync(result.fixtureRoot, { recursive: true, force: true });
    }
  });
}

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

async function runSignalLifecycleDiagnostic({
  signal,
  stallCleanup = false,
  cleanupTimeoutMs = 1000
}) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tge-acceptance-signal-"));
  const marker = path.join(fixtureRoot, "cleanup.txt");
  const moduleUrl = pathToFileURL(command).href;
  const source = `
    import fs from "node:fs";
    const marker = process.argv[1];
    const stallCleanup = process.argv[2] === "true";
    const cleanupTimeoutMs = Number(process.argv[3]);
    const { runAssistedPilotAcceptance } = await import(${JSON.stringify(moduleUrl)});
    void runAssistedPilotAcceptance({
      env: {
        TGE_ACCEPTANCE_DATABASE_URL:
          "postgresql://operator@127.0.0.1:55439/postgres"
      },
      signalTarget: process,
      signalCleanupTimeoutMs: cleanupTimeoutMs,
      provision: async resources => {
        resources.databaseName = "tge_acceptance_signal_database";
        process.stdout.write("READY\\n");
        return { postgresVersion: "16.15" };
      },
      journey: async () => new Promise(() => setInterval(() => {}, 1000)),
      cleanup: async () => {
        fs.appendFileSync(marker, "cleanup\\n");
        if (stallCleanup) await new Promise(() => {});
        return {
          database: "REMOVED",
          runtime_login: "REMOVED",
          migration_roles: "REMOVED"
        };
      }
    });
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", source, marker, String(stallCleanup), String(cleanupTimeoutMs)],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] }
  );

  try {
    await waitForReady(child);
    const exited = waitForExit(child, 5000);
    child.kill(signal);
    const outcome = await exited;
    return { ...outcome, marker, fixtureRoot };
  } catch (error) {
    child.kill("SIGKILL");
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    throw error;
  }
}

async function runRepeatedSignalLifecycleDiagnostic({ firstSignal, repeatedSignal }) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tge-acceptance-repeat-signal-"));
  const marker = path.join(fixtureRoot, "cleanup.txt");
  const moduleUrl = pathToFileURL(command).href;
  const source = `
    import fs from "node:fs";
    const marker = process.argv[1];
    const repeatedSignal = process.argv[2];
    const { runAssistedPilotAcceptance } = await import(${JSON.stringify(moduleUrl)});
    void runAssistedPilotAcceptance({
      env: {
        TGE_ACCEPTANCE_DATABASE_URL:
          "postgresql://operator@127.0.0.1:55439/postgres"
      },
      signalTarget: process,
      provision: async resources => {
        resources.databaseName = "tge_acceptance_repeated_signal_database";
        process.stdout.write("READY\\n");
        return { postgresVersion: "16.15" };
      },
      journey: async () => new Promise(() => setInterval(() => {}, 1000)),
      cleanup: async () => {
        fs.appendFileSync(marker, "cleanup-started\\n");
        process.prependOnceListener(repeatedSignal, () => {
          process.stdout.write("REPEATED_OBSERVED\\n");
          setImmediate(() => process.kill(process.pid, repeatedSignal));
        });
        process.stdout.write("CLEANUP_STARTED\\n");
        await new Promise(resolve => process.once("message", resolve));
        fs.appendFileSync(marker, "cleanup-complete\\n");
        return {
          database: "REMOVED",
          runtime_login: "REMOVED",
          migration_roles: "REMOVED"
        };
      }
    });
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", source, marker, repeatedSignal],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe", "ipc"] }
  );

  try {
    const output = collectOutput(child);
    await output.waitFor("READY\n");
    const exited = waitForExit(child, 5000);
    child.kill(firstSignal);
    await output.waitFor("CLEANUP_STARTED\n");
    child.kill(repeatedSignal);
    await output.waitFor("REPEATED_OBSERVED\n");
    if (child.connected) child.send("RELEASE");
    const outcome = await exited;
    return { ...outcome, marker, fixtureRoot };
  } catch (error) {
    child.kill("SIGKILL");
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    throw error;
  }
}

function collectOutput(child) {
  let stdout = "";
  const waiters = new Set();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    stdout += chunk;
    for (const waiter of waiters) {
      if (!stdout.includes(waiter.expected)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve();
    }
  });
  return {
    waitFor(expected) {
      if (stdout.includes(expected)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const waiter = { expected, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`signal fixture output timed out waiting for ${expected.trim()}`));
        }, 3000);
        waiters.add(waiter);
      });
    }
  };
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("signal fixture readiness timed out")), 3000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes("READY\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`signal fixture exited before ready: ${code ?? signal}`));
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("signal fixture exit timed out")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
