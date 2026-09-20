#!/usr/bin/env node

import { lstat, open, unlink } from "node:fs/promises";
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
  reserveInvitation = reserveInvitationFile
} = {}) {
  const args = parseOperatorArguments(argv);
  const databaseUrl = exactPostgresUrl(required(env, "TGE_IDENTITY_OPERATOR_DATABASE_URL"));
  const common = {
    tenantId: required(env, "TGE_IDENTITY_TENANT_ID"),
    apply: args.apply,
    confirmation: args.confirmation
  };

  if (args.command === "invite") {
    validateInviteEnvironment(env, { apply: args.apply });
    const input = invitationInput(env, common);
    const publicAppUrl = exactHttpsOrigin(required(env, "TGE_PUBLIC_APP_URL"));
    const outputFile = validateInvitationOutputPath(
      required(env, "TGE_IDENTITY_INVITATION_OUTPUT_FILE")
    );
    const config = {
      issuer: required(env, "TGE_AUTH0_ISSUER"),
      managementApiBaseUrl: required(env, "TGE_AUTH0_MANAGEMENT_API_URL"),
      connection: required(env, "TGE_AUTH0_EMAIL_CONNECTION")
    };
    const managementToken = args.apply
      ? required(env, "TGE_AUTH0_MANAGEMENT_TOKEN")
      : "dry-run-token";
    const provisioner = new Auth0ProvisioningAdapter({
      config,
      accessTokenProvider: async () => managementToken,
      fetchImpl
    });
    const plan = new IdentityOperationsService({ repository: {} })
      .planProvisionedInvitation(input);

    if (!args.apply) {
      return emitEvidence({ args, result: plan, logger, invitationOutputWritten: false });
    }

    let reservation;
    let pool;
    try {
      reservation = await reserveInvitation({ file: outputFile });
      pool = new Pool({
        connectionString: databaseUrl,
        application_name: "tge-identity-operator",
        max: 1
      });
      const repository = new PostgresIdentityOperatorRepository({ pool });
      const service = new IdentityOperationsService({ repository, provisioner });
      const result = await service.createProvisionedInvitation(input);
      if (result.token) {
        await reservation.commit({ publicAppUrl, token: result.token });
      } else {
        await reservation.abort();
      }
      return emitEvidence({
        args,
        result,
        logger,
        invitationOutputWritten: Boolean(result.token)
      });
    } catch (error) {
      try {
        await reservation?.abort();
      } catch {
        throw operatorError("INVITATION_OUTPUT_CLEANUP_FAILED");
      }
      throw error;
    } finally {
      await pool?.end().catch(() => {});
    }
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "tge-identity-operator",
    max: 1
  });
  try {
    const repository = new PostgresIdentityOperatorRepository({ pool });
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
    } else {
      throw operatorError("COMMAND_INVALID");
    }
    return emitEvidence({ args, result, logger, invitationOutputWritten: false });
  } finally {
    await pool.end().catch(() => {});
  }
}

function emitEvidence({ args, result, logger, invitationOutputWritten }) {
  const evidence = {
    ok: true,
    operation: args.command,
    mode: args.apply ? "apply" : "dry-run",
    status: result.status,
    invitation_output_written: invitationOutputWritten
  };
  logger.log(JSON.stringify(evidence));
  return evidence;
}

function validateInviteEnvironment(env, { apply }) {
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
  if (apply) required(env, "TGE_AUTH0_MANAGEMENT_TOKEN");
}

export async function reserveInvitationFile({ file }) {
  validateInvitationOutputPath(file);
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
  } catch {
    throw operatorError("INVITATION_OUTPUT_UNAVAILABLE");
  }
  let reserved;
  let closed = false;
  try {
    await handle.chmod(0o600);
    reserved = await handle.stat();
    if (!reserved.isFile() || reserved.nlink !== 1 || (reserved.mode & 0o777) !== 0o600) {
      throw operatorError("INVITATION_OUTPUT_INVALID");
    }
  } catch (error) {
    await handle.close();
    try {
      await removeExactReservation(file, reserved);
    } catch {
      throw operatorError("INVITATION_OUTPUT_CLEANUP_FAILED");
    }
    throw error;
  }

  const close = async () => {
    if (!closed) {
      closed = true;
      await handle.close();
    }
  };
  return Object.freeze({
    async commit({ publicAppUrl, token }) {
      if (closed) throw operatorError("INVITATION_OUTPUT_INVALID");
      await assertExactReservation(file, reserved);
      const invitationUrl = `${publicAppUrl}/#/invite?token=${encodeURIComponent(token)}`;
      await handle.writeFile(`${JSON.stringify({ invitationUrl })}\n`, { encoding: "utf8" });
      await handle.sync();
      await assertExactReservation(file, reserved);
      await close();
    },
    async abort() {
      await close();
      await removeExactReservation(file, reserved);
    }
  });
}

async function assertExactReservation(file, reserved) {
  const current = await lstat(file);
  if (
    !reserved
    || !current.isFile()
    || current.isSymbolicLink()
    || current.dev !== reserved.dev
    || current.ino !== reserved.ino
    || current.nlink !== 1
    || (current.mode & 0o777) !== 0o600
  ) throw operatorError("INVITATION_OUTPUT_INVALID");
}

async function removeExactReservation(file, reserved) {
  if (!reserved) return;
  let current;
  try {
    current = await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (
    current.isFile()
    && !current.isSymbolicLink()
    && current.dev === reserved.dev
    && current.ino === reserved.ino
  ) await unlink(file);
}

function invitationInput(env, common) {
  return {
    ...common,
    operationId: required(env, "TGE_IDENTITY_OPERATION_ID"),
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
