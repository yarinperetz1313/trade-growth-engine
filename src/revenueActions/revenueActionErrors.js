function manualConfirmationRequired() {
  return {
    code: "MANUAL_CONFIRMATION_REQUIRED",
    message: "Communication execution requires explicit manual confirmation.",
    statusCode: 400,
    details: {
      field: "executionMode",
      required: "MANUAL_CONFIRMED"
    }
  };
}

function revenueActionRecoveryRequired(id, opportunityId) {
  return {
    code: "REVENUE_ACTION_RECOVERY_REQUIRED",
    message: "An interrupted revenue action has linked CRM effects and must be recovered before current advice can be materialized.",
    statusCode: 409,
    details: { id, opportunityId }
  };
}

function revenueActionEffectConflict(id, reason) {
  return {
    code: "REVENUE_ACTION_EFFECT_CONFLICT",
    message: "Linked CRM effects do not match this revenue action and cannot be reconciled.",
    statusCode: 409,
    details: { id, reason }
  };
}

function toFailure(descriptor) {
  return {
    ok: false,
    error: descriptor.code,
    message: descriptor.message,
    statusCode: descriptor.statusCode,
    details: descriptor.details
  };
}

module.exports = {
  manualConfirmationRequired,
  revenueActionEffectConflict,
  revenueActionRecoveryRequired,
  toFailure
};
