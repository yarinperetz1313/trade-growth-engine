const RAW_SUCCESS_STATES = new Set(["SUCCEEDED"]);
const OFFBOARDING_SUCCESS_STATES = new Set(["OFFBOARDED_ACCESS_REVOKED"]);

function positiveInteger(value, maximum) {
  return Number.isInteger(value) && value >= 1 && value <= maximum;
}

function newSummary() {
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    retryable: 0,
    backlogStatus: "unchecked",
    oldestProcessed: null
  };
}

function sanitizeOldest(row, stateField) {
  return {
    state: String(row?.[stateField] || "UNKNOWN"),
    retryable: row?.retryable === true,
    attemptCount: Number.isInteger(row?.attempt_count) ? row.attempt_count : null
  };
}

function consume(summary, rows, { batchLimit, stateField, successStates }) {
  if (!Array.isArray(rows) || rows.length > batchLimit) {
    throw new Error("Maintenance batch result is invalid.");
  }
  if (summary.oldestProcessed === null && rows.length > 0) {
    summary.oldestProcessed = sanitizeOldest(rows[0], stateField);
  }
  summary.processed += rows.length;
  for (const row of rows) {
    if (successStates.has(row?.[stateField])) summary.succeeded += 1;
    else summary.failed += 1;
    if (row?.retryable === true) summary.retryable += 1;
  }
  summary.backlogStatus = rows.some(row => (
    row?.retryable === true || !successStates.has(row?.[stateField])
  ))
    ? "retryable_or_failed"
    : rows.length < batchLimit ? "none_observed" : "remaining_or_locked";
}

export async function drainMaintenanceWork({
  batchLimit = 25,
  maxRounds = 8,
  runRawImportBatch,
  runTenantOffboardingBatch
}) {
  if (
    !positiveInteger(batchLimit, 100)
    || !positiveInteger(maxRounds, 100)
    || typeof runRawImportBatch !== "function"
    || typeof runTenantOffboardingBatch !== "function"
  ) throw new Error("Maintenance drain configuration is invalid.");

  const rawImportCleanup = newSummary();
  const tenantOffboarding = newSummary();
  let rawDrained = false;
  let offboardingDrained = false;
  let rounds = 0;

  while (rounds < maxRounds && (!rawDrained || !offboardingDrained)) {
    rounds += 1;
    if (!rawDrained) {
      const rows = await runRawImportBatch(batchLimit);
      consume(rawImportCleanup, rows, {
        batchLimit,
        stateField: "cleanup_state",
        successStates: RAW_SUCCESS_STATES
      });
      rawDrained = rows.length < batchLimit;
    }
    if (!offboardingDrained) {
      const rows = await runTenantOffboardingBatch(batchLimit);
      consume(tenantOffboarding, rows, {
        batchLimit,
        stateField: "state",
        successStates: OFFBOARDING_SUCCESS_STATES
      });
      offboardingDrained = rows.length < batchLimit;
    }
    if (
      rawImportCleanup.failed > 0
      || rawImportCleanup.retryable > 0
      || tenantOffboarding.failed > 0
      || tenantOffboarding.retryable > 0
    ) break;
  }

  const actionRequired = rawImportCleanup.failed > 0
    || rawImportCleanup.retryable > 0
    || tenantOffboarding.failed > 0
    || tenantOffboarding.retryable > 0;
  const backlogRemaining = !rawDrained || !offboardingDrained;
  return {
    status: actionRequired
      ? "action_required"
      : backlogRemaining ? "backlog_remaining" : "drained",
    exitCode: actionRequired ? 2 : backlogRemaining ? 3 : 0,
    rounds,
    rawImportCleanup,
    tenantOffboarding
  };
}
