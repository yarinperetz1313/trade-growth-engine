const {
  getLiveConfig,
  assertLiveAllowed
} = require("./liveConfig");

const {
  runProspectDiscovery
} = require("../prospects/prospectOrchestrator");

async function runLiveDiscovery({
  service,
  location,
  target,
  experimentId,
  argv = process.argv
}) {
  const config =
    getLiveConfig(argv);

  if (!config.live) {
    return {
      success: true,
      mode: "OFFLINE",
      live: false,
      prospects: [],
      message:
        "Live discovery is disabled. Use --live to explicitly enable it."
    };
  }

  assertLiveAllowed(
    config
  );

  if (!service) {
    throw new Error(
      "service is required."
    );
  }

  if (!location) {
    throw new Error(
      "location is required."
    );
  }

  const requestedTarget =
    target || config.target;

  if (
    requestedTarget >
    config.maxTarget
  ) {
    throw new Error(
      `Target cannot exceed ${config.maxTarget}.`
    );
  }

  console.log(
    "\n=========================================="
  );

  console.log(
    "          LIVE DISCOVERY MODE"
  );

  console.log(
    "=========================================="
  );

  console.log(
    `Service: ${service}`
  );

  console.log(
    `Location: ${location}`
  );

  console.log(
    `Target: ${requestedTarget}`
  );

  console.log(
    `Experiment: ${experimentId || "auto"}`
  );

  console.log(
    "LIVE API REQUEST: ENABLED\n"
  );

  const result =
    await runProspectDiscovery({
      service,
      location,
      targetCount:
        requestedTarget,
      experimentId,
      offline: false
    });

  if (!result) {
    throw new Error(
      "Discovery returned no result."
    );
  }

  return {
    ...result,

    mode: "LIVE",

    live: true,

    requestedTarget
  };
}

module.exports = {
  runLiveDiscovery
};
