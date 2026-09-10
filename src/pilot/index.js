"use strict";

require("dotenv").config();

const { startPilotRuntime } = require("./runtime");

startPilotRuntime().catch(() => {
  console.error("PILOT_RUNTIME_START_FAILED");
  process.exitCode = 1;
});
