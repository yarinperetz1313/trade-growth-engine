const DEFAULT_TARGET = 5;
const MAX_TARGET = 25;

function parseBoolean(value) {
  return [
    true,
    "true",
    "1",
    "yes",
    "on"
  ].includes(value);
}

function getLiveConfig(argv = process.argv) {
  const live =
    argv.includes("--live");

  const targetIndex =
    argv.indexOf("--target");

  const target =
    targetIndex !== -1
      ? Number(argv[targetIndex + 1])
      : DEFAULT_TARGET;

  if (
    !Number.isInteger(target) ||
    target < 1
  ) {
    throw new Error(
      "Target must be a positive integer."
    );
  }

  if (
    target > MAX_TARGET
  ) {
    throw new Error(
      `Live target cannot exceed ${MAX_TARGET} per run.`
    );
  }

  return {
    live,
    offline: !live,
    target,
    maxTarget: MAX_TARGET
  };
}

function assertLiveAllowed(config) {
  if (!config.live) {
    return {
      allowed: false,
      reason:
        "LIVE MODE NOT ENABLED"
    };
  }

  if (
    config.target >
    config.maxTarget
  ) {
    throw new Error(
      "Live target exceeds safety limit."
    );
  }

  if (
    !process.env.OPENAI_API_KEY
  ) {
    throw new Error(
      "LIVE MODE REQUESTED BUT OPENAI_API_KEY IS NOT LOADED."
    );
  }

  return {
    allowed: true,
    reason: "LIVE MODE EXPLICITLY ENABLED"
  };
}

module.exports = {
  DEFAULT_TARGET,
  MAX_TARGET,
  parseBoolean,
  getLiveConfig,
  assertLiveAllowed
};
