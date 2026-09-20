"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const cli = import("../scripts/run-identity-operator.mjs");

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
    env: {
      TGE_IDENTITY_OPERATOR_DATABASE_URL: "postgresql://operator@db.example.test/tge",
      TGE_IDENTITY_TENANT_ID: "10000000-0000-4000-8000-000000000001",
      TGE_IDENTITY_OPERATION_ID: "20000000-0000-4000-8000-000000000002",
      TGE_IDENTITY_ACTOR_ISSUER: "https://pilot.au.auth0.com/",
      TGE_IDENTITY_ACTOR_SUBJECT: "auth0|owner",
      TGE_IDENTITY_INVITEE_EMAIL: "invited@example.test",
      TGE_IDENTITY_INVITEE_ROLE: "MEMBER",
      TGE_IDENTITY_INVITATION_EXPIRES_AT: "2099-01-01T00:00:00.000Z",
      TGE_IDENTITY_INVITATION_OUTPUT_FILE: "/tmp/operator-invitation.json",
      TGE_PUBLIC_APP_URL: "https://app.example.test",
      TGE_AUTH0_ISSUER: "https://pilot.au.auth0.com/",
      TGE_AUTH0_MANAGEMENT_API_URL: "https://pilot.au.auth0.com/api/v2/",
      TGE_AUTH0_EMAIL_CONNECTION: "email"
    }
  });
  assert.equal(evidence.status, "WOULD_PROVISION");
  assert.equal(providerCalls, 0);
  assert.equal(poolConnects, 0);
  assert.deepEqual(output, [evidence]);
});
