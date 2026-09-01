const {
  requireTenantContext
} = require("../tenantContext");

class PostgresTransactionOutcomeUnknownError extends Error {
  constructor(cause, attemptedResult) {
    super(
      "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
      { cause }
    );
    this.name = "PostgresTransactionOutcomeUnknownError";
    this.code = "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN";
    this.outcome = "UNKNOWN";
    this.outcomeUnknown = true;
    this.retryable = false;
    this.attemptedResult = attemptedResult;
    const attemptedId = findAttemptedId(attemptedResult);
    this.attemptedId = attemptedId;
    this.attemptedIds = attemptedId ? [attemptedId] : [];
    this.details = attemptedId ? { attemptedId } : {};
  }
}

function findAttemptedId(result) {
  if (!result || typeof result !== "object") return null;
  if (typeof result.id === "string" && result.id.length > 0) return result.id;
  if (
    result.data &&
    typeof result.data.id === "string" &&
    result.data.id.length > 0
  ) {
    return result.data.id;
  }
  if (
    result.record &&
    typeof result.record.id === "string" &&
    result.record.id.length > 0
  ) {
    return result.record.id;
  }
  if (
    result.batch &&
    typeof result.batch.id === "string" &&
    result.batch.id.length > 0
  ) {
    return result.batch.id;
  }
  if (
    result.failedAction &&
    typeof result.failedAction.id === "string" &&
    result.failedAction.id.length > 0
  ) {
    return result.failedAction.id;
  }
  return null;
}

function attachSecondaryError(primary, property, secondary) {
  if (!Object.hasOwn(primary, property)) {
    Object.defineProperty(primary, property, {
      configurable: true,
      enumerable: false,
      value: secondary
    });
  }
}

async function reportCleanupError(handler, error, metadata) {
  if (typeof handler !== "function") return;
  try {
    await handler(error, metadata);
  } catch {
    // Cleanup reporting cannot replace a result PostgreSQL confirmed committed.
  }
}

async function withTenantTransaction(
  pool,
  context,
  operation,
  { onCleanupError } = {}
) {
  const trustedContext = requireTenantContext(context);

  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("PostgreSQL persistence requires an injected pool.");
  }
  if (typeof operation !== "function") {
    throw new TypeError("A tenant transaction operation is required.");
  }
  if (onCleanupError !== undefined && typeof onCleanupError !== "function") {
    throw new TypeError("onCleanupError must be a function when provided.");
  }

  const client = await pool.connect();
  let transactionStarted = false;
  let commitAttempted = false;
  let primaryError;
  let committed = false;
  let discardError;
  let attemptedResult;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT tge.set_request_context($1::uuid, $2::text)",
      [trustedContext.tenantId, trustedContext.subjectId]
    );

    attemptedResult = await operation({
      client,
      context: trustedContext,
      tenantId: trustedContext.tenantId,
      subjectId: trustedContext.subjectId
    });

    commitAttempted = true;
    try {
      await client.query("COMMIT");
    } catch (cause) {
      transactionStarted = false;
      discardError = cause;
      throw new PostgresTransactionOutcomeUnknownError(cause, attemptedResult);
    }
    transactionStarted = false;
    committed = true;
    return attemptedResult;
  } catch (error) {
    primaryError = error;
    if (transactionStarted && !commitAttempted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        discardError = rollbackError;
        attachSecondaryError(error, "rollbackError", rollbackError);
      }
    }
    throw error;
  } finally {
    try {
      await client.release(discardError);
    } catch (releaseError) {
      if (primaryError) {
        attachSecondaryError(primaryError, "releaseError", releaseError);
      } else if (committed) {
        await reportCleanupError(onCleanupError, releaseError, {
          committed: true,
          attemptedResult
        });
      } else {
        throw releaseError;
      }
    }
  }
}

module.exports = {
  PostgresTransactionOutcomeUnknownError,
  withTenantTransaction
};
