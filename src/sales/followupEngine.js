const {
  getNextOutreachStep,
  stopOutreach
} = require("./outreachEngine");

function getFollowupAction(
  plan,
  now = new Date()
) {
  if (
    !plan ||
    plan.stopped
  ) {
    return {
      action: "STOP",
      reason:
        plan?.stopReason ||
        "PLAN_STOPPED"
    };
  }

  const next =
    getNextOutreachStep(
      plan
    );

  if (!next) {
    return {
      action: "COMPLETE",
      reason:
        "SEQUENCE_COMPLETE"
    };
  }

  const created =
    new Date(
      plan.createdAt
    );

  const due =
    new Date(created);

  due.setDate(
    due.getDate() +
      next.delayDays
  );

  if (
    now < due
  ) {
    return {
      action: "WAIT",
      nextStep: next.step,
      dueAt:
        due.toISOString()
    };
  }

  return {
    action: "SEND",
    step: next
  };
}

function stopForReply(
  plan,
  replyType
) {
  return stopOutreach(
    plan,
    `REPLY_${replyType}`
  );
}

module.exports = {
  getFollowupAction,
  stopForReply
};
