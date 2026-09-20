#!/usr/bin/env node

import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";

import identityOperations from "../src/auth/identityOperations.js";
import postgresOperator from "../src/auth/postgresIdentityOperatorRepository.js";
import provisioning from "../src/auth/provisioning.js";

const { IdentityOperationsService } = identityOperations;
const { PostgresIdentityOperatorRepository } = postgresOperator;
const { Auth0ProvisioningAdapter } = provisioning;

const CONFIRMATIONS = Object.freeze({
  bootstrap: "BOOTSTRAP_FIRST_TENANT",
  invite: "CREATE_PROVISIONED_INVITATION",
  "revoke-invitation": "REVOKE_INVITATION",
  revoke: "REVOKE_MEMBERSHIP"
});

export function parseOperatorArguments(argv) {
  const [command, ...flags] = argv;
  if (!Object.hasOwn(CONFIRMATIONS, command)) throw operatorError("COMMAND_INVALID");
  let apply = false;
  let confirmation = null;
  for (const flag of flags) {
    if (flag === "--apply") apply = true;
    else if (flag.startsWith("--confirm=")) confirmation = flag.slice(10);
    else throw operatorError("COMMAND_INVALID");
  }
  if (!apply && confirmation !== null) throw operatorError("COMMAND_INVALID");
  if (apply && confirmation !== CONFIRMATIONS[command]) {
    throw operatorError("CONFIRMATION_REQUIRED");
  }
  return Object.freeze({ command, apply, confirmation });
}

export async function runIdentityOperator({
  argv = process.argv.slice(2),
  env = process.env,
  logger = console,
  Pool = pg.Pool,
  fetchImpl = fetch,
  writeInvitation = writeInvitationFile
} = {}) {
  const args = parseOperatorArguments(argv);
  const databaseUrl = exactPostgresUrl(required(env, "TGE_IDENTITY_OPERATOR_DATABASE_URL"));
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "tge-identity-operator",
    max: 1
  });
  try {
    const repository = new PostgresIdentityOperatorRepository({ pool });
    const common = {
      tenantId: required(env, "TGE_IDENTITY_TENANT_ID"),
      apply: args.apply,
      confirmation: args.confirmation
    };
    let result;
    if (args.command === "bootstrap") {
      const service = new IdentityOperationsService({ repository });
      result = await service.bootstrapFirstTenant({
        ...common,
        slug: required(env, "TGE_IDENTITY_TENANT_SLUG"),
        name: required(env, "TGE_IDENTITY_TENANT_NAME"),
        issuer: required(env, "TGE_IDENTITY_ISSUER"),
        subject: required(env, "TGE_IDENTITY_SUBJECT")
      });
    } else if (args.command === "revoke") {
      const service = new IdentityOperationsService({ repository });
      result = await service.revokeMembership({
        ...common,
        actor: {
          issuer: required(env, "TGE_IDENTITY_ACTOR_ISSUER"),
          subject: required(env, "TGE_IDENTITY_ACTOR_SUBJECT")
        },
        target: {
          issuer: required(env, "TGE_IDENTITY_TARGET_ISSUER"),
          subject: required(env, "TGE_IDENTITY_TARGET_SUBJECT")
        }
      });
    } else if (args.command === "revoke-invitation") {
      const service = new IdentityOperationsService({ repository });
      result = await service.revokeInvitation({
        ...common,
        invitationId: required(env, "TGE_IDENTITY_INVITATION_ID"),
        actor: {
          issuer: required(env, "TGE_IDENTITY_ACTOR_ISSUER"),
          subject: required(env, "TGE_IDENTITY_ACTOR_SUBJECT")
        }
      });
    } else if (!args.apply) {
      validateInviteEnvironment(env);
      new Auth0ProvisioningAdapter({
        config: {
          issuer: required(env, "TGE_AUTH0_ISSUER"),
          managementApiBaseUrl: required(env, "TGE_AUTH0_MANAGEMENT_API_URL"),
          connection: required(env, "TGE_AUTH0_EMAIL_CONNECTION")
        },
        accessTokenProvider: async () => "dry-run-token",
        fetchImpl
      });
      exactHttpsOrigin(required(env, "TGE_PUBLIC_APP_URL"));
      validateInvitationOutputPath(required(env, "TGE_IDENTITY_INVITATION_OUTPUT_FILE"));
      result = new IdentityOperationsService({ repository })
        .planProvisionedInvitation(invitationInput(env, common));
    } else {
      const provisioner = new Auth0ProvisioningAdapter({
        config: {
          issuer: required(env, "TGE_AUTH0_ISSUER"),
          managementApiBaseUrl: required(env, "TGE_AUTH0_MANAGEMENT_API_URL"),
          connection: required(env, "TGE_AUTH0_EMAIL_CONNECTION")
        },
        accessTokenProvider: async () => required(env, "TGE_AUTH0_MANAGEMENT_TOKEN"),
        fetchImpl
      });
      const service = new IdentityOperationsService({ repository, provisioner });
      result = await service.createProvisionedInvitation(invitationInput(env, common));
      if (result.token) {
        await writeInvitation({
          file: required(env, "TGE_IDENTITY_INVITATION_OUTPUT_FILE"),
          publicAppUrl: exactHttpsOrigin(required(env, "TGE_PUBLIC_APP_URL")),
          token: result.token
        });
      }
    }

    const evidence = {
      ok: true,
      operation: args.command,
      mode: args.apply ? "apply" : "dry-run",
      status: result.status,
      invitation_output_written: Boolean(result.token)
    };
    logger.log(JSON.stringify(evidence));
    return evidence;
  } finally {
    await pool.end().catch(() => {});
  }
}

function validateInviteEnvironment(env) {
  for (const name of [
    "TGE_IDENTITY_TENANT_ID",
    "TGE_IDENTITY_OPERATION_ID",
    "TGE_IDENTITY_ACTOR_ISSUER",
    "TGE_IDENTITY_ACTOR_SUBJECT",
    "TGE_IDENTITY_INVITEE_EMAIL",
    "TGE_IDENTITY_INVITEE_ROLE",
    "TGE_IDENTITY_INVITATION_EXPIRES_AT",
    "TGE_IDENTITY_INVITATION_OUTPUT_FILE",
    "TGE_PUBLIC_APP_URL",
    "TGE_AUTH0_ISSUER",
    "TGE_AUTH0_MANAGEMENT_API_URL",
    "TGE_AUTH0_EMAIL_CONNECTION"
  ]) required(env, name);
}

async function writeInvitationFile({ file, publicAppUrl, token }) {
  validateInvitationOutputPath(file);
  const handle = await open(file, "wx", 0o600);
  try {
    const invitationUrl = `${publicAppUrl}/#/invite?token=${encodeURIComponent(token)}`;
    await handle.writeFile(`${JSON.stringify({ invitationUrl })}\n`, { encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

function invitationInput(env, common) {
  return {
    operationId: required(env, "TGE_IDENTITY_OPERATION_ID"),
    tenantId: common.tenantId,
    actor: {
      issuer: required(env, "TGE_IDENTITY_ACTOR_ISSUER"),
      subject: required(env, "TGE_IDENTITY_ACTOR_SUBJECT")
    },
    email: required(env, "TGE_IDENTITY_INVITEE_EMAIL"),
    role: required(env, "TGE_IDENTITY_INVITEE_ROLE"),
    expiresAt: required(env, "TGE_IDENTITY_INVITATION_EXPIRES_AT")
  };
}

function validateInvitationOutputPath(file) {
  if (typeof file !== "string" || !file.startsWith("/") || file.includes("\u0000")) {
    throw operatorError("INVITATION_OUTPUT_INVALID");
  }
  return file;
}

function required(env, name) {
  const value = env?.[name];
  if (
    typeof value !== "string"
    || !value
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw operatorError("CONFIGURATION_INVALID");
  return value;
}

function exactPostgresUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw operatorError("CONFIGURATION_INVALID"); }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.pathname.length < 2
    || parsed.href !== value
  ) throw operatorError("CONFIGURATION_INVALID");
  return value;
}

function exactHttpsOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw operatorError("CONFIGURATION_INVALID"); }
  if (parsed.protocol !== "https:" || parsed.origin !== value) {
    throw operatorError("CONFIGURATION_INVALID");
  }
  return parsed.origin;
}

function operatorError(code) {
  const error = new Error("Identity operator command failed.");
  error.code = code;
  return error;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIdentityOperator().catch(error => {
    const code = typeof error?.code === "string"
      ? error.code
      : "IDENTITY_OPERATOR_FAILED";
    console.error(`IDENTITY_OPERATOR_FAILED ${code}`);
    process.exitCode = 1;
  });
}
