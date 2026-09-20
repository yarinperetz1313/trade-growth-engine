"use strict";

const CONFIRMATION = "OFFBOARD_ACCESS_AND_RAW_EVIDENCE";
const RUNBOOK = "docs/runbooks/external-pilot-offboarding.md";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMANDS = new Set(["inspect", "status", "request", "receipt", "inventory"]);

class OffboardingOperatorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OffboardingOperatorError";
    this.code = code;
  }
}

function createOffboardingOperatorWorkflow({
  authority,
  requestService,
  receiptRepository
} = {}) {
  if (
    typeof authority?.resolveActiveOwner !== "function"
    || typeof requestService?.request !== "function"
    || typeof receiptRepository?.read !== "function"
  ) {
    throw new TypeError("Offboarding operator ports are required.");
  }

  async function request(input) {
    const target = validateTarget(input);
    const apply = input?.apply === true;
    if (apply && input?.confirmation !== CONFIRMATION) {
      throw operatorError(
        "OFFBOARDING_CONFIRMATION_REQUIRED",
        "The exact offboarding confirmation phrase is required."
      );
    }
    if (!apply && input?.confirmation !== undefined) {
      throw operatorError(
        "OFFBOARDING_OPERATOR_INPUT_INVALID",
        "Confirmation is accepted only with explicit apply."
      );
    }

    const existing = await readReceipt(receiptRepository, target);
    if (existing?.actorMismatch === true) {
      throw operatorError(
        "OFFBOARDING_REQUEST_ACTOR_MISMATCH",
        "The offboarding request belongs to a different named actor."
      );
    }
    if (existing?.state === "OFFBOARDED_ACCESS_REVOKED") {
      throw operatorError(
        "OFFBOARDING_REQUEST_TERMINAL",
        "The tenant offboarding request is terminal."
      );
    }

    const owner = await resolveOwner(authority, target);
    if (!apply) {
      return {
        code: existing
          ? "OFFBOARDING_REQUEST_DRY_RUN_EXISTING"
          : "OFFBOARDING_REQUEST_DRY_RUN_READY",
        mode: "DRY_RUN",
        state: existing?.state || "NOT_REQUESTED",
        scope: existing?.scope || "ACCESS_AND_RAW_EVIDENCE_ONLY",
        databaseWritesPerformed: false,
        offboardingEffectsApplied: false,
        nextAction: existing
          ? nextAction(existing)
          : { code: "EXPLICIT_APPLY_REQUIRED", runbook: RUNBOOK }
      };
    }

    try {
      await requestService.request({
        authorizationContext: owner.authorizationContext,
        persistenceContext: owner.persistenceContext,
        input: { confirmation: CONFIRMATION }
      });
    } catch (error) {
      if (isUnknownTransactionOutcome(error)) {
        return reconciliationRequiredResult();
      }
      throw operatorError(
        "OFFBOARDING_REQUEST_DENIED",
        "The offboarding request was denied."
      );
    }

    const authoritative = await readReceipt(receiptRepository, target);
    if (authoritative?.actorMismatch === true) {
      throw operatorError(
        "OFFBOARDING_REQUEST_ACTOR_MISMATCH",
        "The offboarding request belongs to a different named actor."
      );
    }
    if (!authoritative) return reconciliationRequiredResult();

    return {
      code: "OFFBOARDING_REQUEST_ACCEPTED",
      mode: "APPLY",
      state: authoritative.state,
      scope: authoritative.scope,
      retryable: authoritative.retryable === true,
      requestedAt: authoritative.requestedAt,
      requestMutationAttempted: true,
      offboardingEffectsApplied: false,
      nextAction: nextAction(authoritative)
    };
  }

  async function inspect(input) {
    const status = await requireReceipt(receiptRepository, validateTarget(input));
    return lifecycleResult(status);
  }

  async function receipt(input) {
    const status = await requireReceipt(receiptRepository, validateTarget(input));
    const lifecycle = lifecycleResult(status);
    const evidence = status.deletionEvidence || {};
    const inventory = status.inventory || {};
    return {
      ...lifecycle,
      code: status.state === "OFFBOARDED_ACCESS_REVOKED"
        ? "OFFBOARDING_RECEIPT_COMPLETE"
        : "OFFBOARDING_RECEIPT_PENDING",
      deletionEvidence: {
        status: evidenceStatus(status),
        immutableEvidenceCount: knownCount(status.attemptCount),
        rawImportBatchesScrubbed: knownCount(evidence.rawImportBatchesScrubbed),
        rawImportRowsScrubbed: knownCount(evidence.rawImportRowsScrubbed),
        membershipsRevoked: knownCount(evidence.membershipsRevoked),
        invitationsDeleted: knownCount(evidence.invitationsDeleted),
        externalActionsPerformed: evidence.externalActionsPerformed === true
      },
      retentionInventory: {
        rawImportEvidence: {
          status: status.state === "OFFBOARDED_ACCESS_REVOKED"
            && knownCount(inventory.rawImportRowsRemaining) === 0
            && knownCount(inventory.rawImportBatchesWithSensitiveMetadata) === 0
            ? "SCRUBBED"
            : "PENDING_OR_UNKNOWN",
          remainingRawRows: knownCount(inventory.rawImportRowsRemaining),
          batchesWithSensitiveMetadata: knownCount(
            inventory.rawImportBatchesWithSensitiveMetadata
          )
        },
        databaseAccess: {
          status: status.state === "OFFBOARDED_ACCESS_REVOKED"
            && knownCount(inventory.activeMembershipCount) === 0
            && knownCount(inventory.invitationCount) === 0
            ? "REVOKED"
            : "PENDING_OR_UNKNOWN",
          activeMembershipCount: knownCount(inventory.activeMembershipCount),
          invitationCount: knownCount(inventory.invitationCount)
        },
        canonicalCrm: retained(
          "RETAINED_CANONICAL_POLICY_PENDING",
          inventory.canonicalCrmCount ?? evidence.canonicalRecordsRetained
        ),
        identityMaps: retained(
          "RETAINED_RECONCILIATION_EVIDENCE",
          inventory.identityMapCount
        ),
        auditEvidence: retained(
          "RETAINED_LEGAL_POLICY_PENDING",
          inventory.auditEvidenceCount ?? evidence.auditEventsRetained
        ),
        pilotEvidence: retained(
          "RETAINED_LEGAL_POLICY_PENDING",
          inventory.pilotEvidenceCount ?? evidence.pilotEvidenceEventsRetained
        ),
        providerIdentity: { status: "EXTERNAL_ACTION_REQUIRED" },
        logs: { status: "UNKNOWN_EXTERNAL_POLICY" },
        exports: { status: "UNKNOWN_EXTERNAL_POLICY" },
        backups: { status: "UNKNOWN_EXTERNAL_POLICY" }
      },
      policyBoundary: {
        canonicalDeletion: "NOT_PERFORMED",
        canonicalAndLegalRetentionDecision: "EXTERNAL_ACTION_REQUIRED",
        providerUserDisableOrDelete: "EXTERNAL_ACTION_REQUIRED",
        backupExpiryAndRestoreReconciliation: "EXTERNAL_ACTION_REQUIRED"
      }
    };
  }

  return Object.freeze({ inspect, receipt, request });
}

function lifecycleResult(status) {
  return {
    code: `OFFBOARDING_STATUS_${status.state}`,
    state: status.state,
    scope: status.scope,
    retryable: status.retryable === true,
    requestedAt: status.requestedAt,
    ...(status.completedAt ? { completedAt: status.completedAt } : {}),
    nextAction: nextAction(status)
  };
}

function nextAction(status) {
  if (status.state === "PENDING" || status.state === "FAILED") {
    return {
      code: status.state === "FAILED"
        ? "RUN_RETRYABLE_MAINTENANCE"
        : "RUN_MAINTENANCE",
      command: "npm run maintenance:cleanup",
      runbook: RUNBOOK
    };
  }
  if (status.state === "IN_PROGRESS") {
    return { code: "WAIT_FOR_MAINTENANCE_RESULT", runbook: RUNBOOK };
  }
  return { code: "COMPLETE_EXTERNAL_RETENTION_ACTIONS", runbook: RUNBOOK };
}

function isUnknownTransactionOutcome(error) {
  return error?.code === "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN"
    && error?.outcomeUnknown === true;
}

function reconciliationRequiredResult() {
  return {
    code: "OFFBOARDING_REQUEST_RECONCILIATION_REQUIRED",
    mode: "APPLY",
    state: "UNKNOWN",
    scope: "ACCESS_AND_RAW_EVIDENCE_ONLY",
    retryable: false,
    requestMutationAttempted: true,
    outcomeConfirmed: false,
    offboardingEffectsApplied: false,
    nextAction: {
      code: "CHECK_REQUEST_STATUS",
      operatorCommand: "status",
      runbook: RUNBOOK
    }
  };
}

function evidenceStatus(status) {
  if (status.state === "OFFBOARDED_ACCESS_REVOKED") return "SUCCEEDED";
  if (status.state === "FAILED") return "FAILED";
  return "NOT_YET_RECORDED";
}

function retained(status, count) {
  return { status, count: knownCount(count) };
}

function knownCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function resolveOwner(authority, target) {
  let resolved;
  try {
    resolved = await authority.resolveActiveOwner(target);
  } catch (error) {
    if (error?.code === "OFFBOARDING_OPERATOR_CONFIGURATION_INVALID") {
      throw operatorError(
        error.code,
        "The dedicated offboarding operator database configuration is invalid."
      );
    }
    throw operatorError(
      "OFFBOARDING_OWNER_UNAVAILABLE",
      "The exact active OWNER actor is unavailable."
    );
  }
  if (
    resolved?.role !== "OWNER"
    || resolved.tenantId !== target.tenantId
    || resolved.issuer !== target.issuer
    || resolved.subject !== target.subject
  ) {
    throw operatorError(
      "OFFBOARDING_OWNER_UNAVAILABLE",
      "The exact active OWNER actor is unavailable."
    );
  }
  return resolved;
}

async function requireReceipt(repository, target) {
  const result = await readReceipt(repository, target);
  if (!result || result.actorMismatch === true) {
    throw operatorError(
      "OFFBOARDING_REQUEST_UNAVAILABLE",
      "The actor-bound offboarding request is unavailable."
    );
  }
  return result;
}

async function readReceipt(repository, target) {
  try {
    return await repository.read(target);
  } catch (error) {
    if (error?.code === "OFFBOARDING_OPERATOR_CONFIGURATION_INVALID") {
      throw operatorError(
        error.code,
        "The dedicated offboarding operator database configuration is invalid."
      );
    }
    throw operatorError(
      "OFFBOARDING_STATUS_UNAVAILABLE",
      "The offboarding status is unavailable."
    );
  }
}

function validateTarget(input) {
  const tenantId = typeof input?.tenantId === "string"
    ? input.tenantId.trim().toLowerCase()
    : "";
  const issuer = typeof input?.issuer === "string" ? input.issuer.trim() : "";
  const subject = typeof input?.subject === "string" ? input.subject.trim() : "";
  if (!UUID.test(tenantId) || !issuer || !subject) {
    throw operatorError(
      "OFFBOARDING_OPERATOR_INPUT_INVALID",
      "Exact tenant UUID, issuer, and subject are required."
    );
  }
  return Object.freeze({ tenantId, issuer, subject });
}

function parseOperatorArguments(argv) {
  if (!Array.isArray(argv) || !COMMANDS.has(argv[0])) {
    throw operatorError(
      "OFFBOARDING_OPERATOR_INPUT_INVALID",
      "A supported offboarding operator command is required."
    );
  }
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--apply") {
      if (options.apply === true) invalidArguments();
      options.apply = true;
      continue;
    }
    if (!["--tenant", "--issuer", "--subject", "--confirm"].includes(name)) {
      invalidArguments();
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || Object.hasOwn(options, name)) {
      invalidArguments();
    }
    options[name] = value;
    index += 1;
  }
  const target = validateTarget({
    tenantId: options["--tenant"],
    issuer: options["--issuer"],
    subject: options["--subject"]
  });
  const apply = options.apply === true;
  const confirmation = options["--confirm"];
  if (command !== "request" && (apply || confirmation !== undefined)) {
    invalidArguments();
  }
  if (command === "request" && apply && confirmation !== CONFIRMATION) {
    throw operatorError(
      "OFFBOARDING_CONFIRMATION_REQUIRED",
      "The exact offboarding confirmation phrase is required."
    );
  }
  if (command === "request" && !apply && confirmation !== undefined) {
    invalidArguments();
  }
  return {
    command,
    ...target,
    ...(command === "request" ? {
      apply,
      ...(confirmation ? { confirmation } : {})
    } : {})
  };
}

function readOperatorConfiguration(environment) {
  const connectionString = environment?.TGE_OFFBOARDING_OPERATOR_DATABASE_URL;
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    throw operatorError(
      "OFFBOARDING_OPERATOR_CONFIGURATION_INVALID",
      "The dedicated offboarding operator database configuration is required."
    );
  }
  return { connectionString };
}

function invalidArguments() {
  throw operatorError(
    "OFFBOARDING_OPERATOR_INPUT_INVALID",
    "The offboarding operator arguments are invalid."
  );
}

function operatorError(code, message) {
  return new OffboardingOperatorError(code, message);
}

module.exports = {
  CONFIRMATION,
  OffboardingOperatorError,
  createOffboardingOperatorWorkflow,
  parseOperatorArguments,
  readOperatorConfiguration
};
