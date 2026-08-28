const {
  buildOutreachDraft
} = require("./outreachPersonalizer");

function createOutreachPlan({
  lead,
  sequence = null
}) {
  const steps =
    sequence || [
      {
        step: 1,
        delayDays: 0,
        purpose: "initial"
      },
      {
        step: 2,
        delayDays: 3,
        purpose: "followup"
      },
      {
        step: 3,
        delayDays: 7,
        purpose: "value"
      },
      {
        step: 4,
        delayDays: 14,
        purpose: "breakup"
      }
    ];

  return {
    leadId:
      lead.id || null,

    createdAt:
      new Date().toISOString(),

    status: "DRAFT",

    currentStep: 0,

    stopped: false,

    stopReason: null,

    steps: steps.map(
      step => ({
        ...step,

        status:
          "PENDING",

        draft:
          buildOutreachDraft({
            lead
          })
      })
    )
  };
}

function getNextOutreachStep(
  plan
) {
  if (
    !plan ||
    plan.stopped
  ) {
    return null;
  }

  return (
    plan.steps.find(
      step =>
        step.status ===
        "PENDING"
    ) || null
  );
}

function markOutreachSent(
  plan,
  stepNumber,
  metadata = {}
) {
  const step =
    plan.steps.find(
      item =>
        item.step ===
        stepNumber
    );

  if (!step) {
    throw new Error(
      `Outreach step ${stepNumber} does not exist.`
    );
  }

  step.status = "SENT";

  step.sentAt =
    new Date().toISOString();

  step.metadata =
    metadata;

  plan.currentStep =
    stepNumber;

  return plan;
}

function stopOutreach(
  plan,
  reason
) {
  plan.stopped = true;

  plan.stopReason =
    reason ||
    "MANUAL_STOP";

  plan.status = "STOPPED";

  return plan;
}

module.exports = {
  createOutreachPlan,
  getNextOutreachStep,
  markOutreachSent,
  stopOutreach
};
