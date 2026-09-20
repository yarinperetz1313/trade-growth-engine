"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cli = import("../scripts/run-identity-operator.mjs");

function inviteEnvironment(outputFile) {
  return {
    TGE_IDENTITY_OPERATOR_DATABASE_URL: "postgresql://operator@db.example.test/tge",
    TGE_IDENTITY_TENANT_ID: "10000000-0000-4000-8000-000000000001",
    TGE_IDENTITY_OPERATION_ID: "20000000-0000-4000-8000-000000000002",
    TGE_IDENTITY_ACTOR_ISSUER: "https://pilot.au.auth0.com/",
    TGE_IDENTITY_ACTOR_SUBJECT: "auth0|owner",
    TGE_IDENTITY_INVITEE_EMAIL: "invited@example.test",
    TGE_IDENTITY_INVITEE_ROLE: "MEMBER",
    TGE_IDENTITY_INVITATION_EXPIRES_AT: "2099-01-01T00:00:00.000Z",
    TGE_IDENTITY_INVITATION_OUTPUT_FILE: outputFile,
    TGE_PUBLIC_APP_URL: "https://app.example.test",
    TGE_AUTH0_ISSUER: "https://pilot.au.auth0.com/",
    TGE_AUTH0_MANAGEMENT_API_URL: "https://pilot.au.auth0.com/api/v2/",
    TGE_AUTH0_EMAIL_CONNECTION: "email",
    TGE_AUTH0_MANAGEMENT_TOKEN: "management-token-secret"
  };
}

test("identity operator requires an exact command and explicit apply confirmation", async () => {
  const { parseOperatorArguments } = await cli;
  assert.deepEqual(parseOperatorArguments(["bootstrap"]), {
    command: "bootstrap",
    apply: false,
    confirmation: null
  });
  assert.deepEqual(parseOperatorArguments([
    "revoke",
    "--apply",
    "--confirm=REVOKE_MEMBERSHIP"
  ]), {
    command: "revoke",
    apply: true,
    confirmation: "REVOKE_MEMBERSHIP"
  });
  assert.deepEqual(parseOperatorArguments([
    "revoke-invitation",
    "--apply",
    "--confirm=REVOKE_INVITATION"
  ]), {
    command: "revoke-invitation",
    apply: true,
    confirmation: "REVOKE_INVITATION"
  });
  for (const args of [
    [],
    ["unknown"],
    ["bootstrap", "--apply"],
    ["invite", "--confirm=CREATE_PROVISIONED_INVITATION"],
    ["revoke", "--force"]
  ]) assert.throws(() => parseOperatorArguments(args));
});

test("operator source emits only privacy-minimized status and writes invitation capability to an exclusive file", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../scripts/run-identity-operator.mjs"),
    "utf8"
  );
  assert.match(source, /open\(file, "wx", 0o600\)/);
  assert.match(source, /invitation_output_written/);
  assert.doesNotMatch(source, /logger\.log\([^\n]*(token|email|subject|databaseUrl)/i);
  assert.doesNotMatch(source, /process\.env\.DATABASE_URL/);
});

test("capability output is exclusively reserved at 0600 before the token is committed", async () => {
  const { reserveInvitationFile } = await cli;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tge-identity-reserve-"));
  const outputFile = path.join(directory, "invitation.json");
  try {
    const reservation = await reserveInvitationFile({ file: outputFile });
    const reserved = fs.statSync(outputFile);
    assert.equal(reserved.mode & 0o777, 0o600);
    assert.equal(reserved.size, 0);
    await reservation.commit({
      publicAppUrl: "https://app.example.test",
      token: "a".repeat(43)
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(outputFile, "utf8")), {
      invitationUrl: `https://app.example.test/#/invite?token=${"a".repeat(43)}`
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invitation dry-run validates configuration without database or provider calls", async () => {
  const { runIdentityOperator } = await cli;
  let providerCalls = 0;
  let poolConnects = 0;
  const output = [];
  class FakePool {
    async connect() { poolConnects += 1; throw new Error("must not connect"); }
    async end() {}
  }
  const evidence = await runIdentityOperator({
    argv: ["invite"],
    Pool: FakePool,
    fetchImpl: async () => { providerCalls += 1; throw new Error("must not fetch"); },
    logger: { log(value) { output.push(JSON.parse(value)); } },
    env: inviteEnvironment("/tmp/operator-invitation.json")
  });
  assert.equal(evidence.status, "WOULD_PROVISION");
  assert.equal(providerCalls, 0);
  assert.equal(poolConnects, 0);
  assert.deepEqual(output, [evidence]);
});

test("invitation apply rejects missing, invalid, or existing output before database or provider access", async () => {
  const { runIdentityOperator } = await cli;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tge-identity-output-"));
  const existing = path.join(directory, "existing.json");
  fs.writeFileSync(existing, "keep", { mode: 0o600 });
  let poolConstructions = 0;
  let providerCalls = 0;
  class FakePool {
    constructor() { poolConstructions += 1; }
    async connect() { throw new Error("database must not be reached"); }
    async end() {}
  }
  try {
    for (const mutate of [
      env => { delete env.TGE_IDENTITY_INVITATION_OUTPUT_FILE; },
      env => { env.TGE_IDENTITY_INVITATION_OUTPUT_FILE = "relative.json"; },
      env => { env.TGE_IDENTITY_INVITATION_OUTPUT_FILE = existing; },
      env => { delete env.TGE_AUTH0_MANAGEMENT_TOKEN; },
      env => { env.TGE_IDENTITY_INVITEE_ROLE = "OWNER"; }
    ]) {
      const env = inviteEnvironment(path.join(directory, "unused.json"));
      mutate(env);
      await assert.rejects(runIdentityOperator({
        argv: ["invite", "--apply", "--confirm=CREATE_PROVISIONED_INVITATION"],
        env,
        Pool: FakePool,
        logger: { log() { assert.fail("failed operation must not log success"); } },
        fetchImpl: async () => { providerCalls += 1; throw new Error("provider must not be reached"); }
      }));
    }
    assert.equal(poolConstructions, 0);
    assert.equal(providerCalls, 0);
    assert.equal(fs.readFileSync(existing, "utf8"), "keep");
    assert.equal(fs.existsSync(path.join(directory, "unused.json")), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("denied database authority releases the reserved capability file before provider access", async () => {
  const { runIdentityOperator } = await cli;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tge-identity-authority-"));
  const outputFile = path.join(directory, "invitation.json");
  let providerCalls = 0;
  class FakePool {
    async connect() {
      return {
        async query(text) {
          if (/rolsuper/.test(text)) return { rows: [{ authorized: false }] };
          return { rows: [] };
        },
        release() {}
      };
    }
    async end() {}
  }
  try {
    await assert.rejects(runIdentityOperator({
      argv: ["invite", "--apply", "--confirm=CREATE_PROVISIONED_INVITATION"],
      env: inviteEnvironment(outputFile),
      Pool: FakePool,
      logger: { log() { assert.fail("failed operation must not log success"); } },
      fetchImpl: async () => { providerCalls += 1; throw new Error("provider must not be reached"); }
    }), error => error?.code === "IDENTITY_OPERATION_DENIED");
    assert.equal(providerCalls, 0);
    assert.equal(fs.existsSync(outputFile), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
