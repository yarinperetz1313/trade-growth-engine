import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { validatePilotBuildConfig } from "./pilot-build-config.mjs";

try {
  validatePilotBuildConfig(process.env);
} catch {
  console.error("PILOT_BUILD_CONFIGURATION_INVALID");
  process.exitCode = 1;
}

if (!process.exitCode) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const vite = path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vite, "build"], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit"
  });
  child.once("error", () => {
    console.error("PILOT_BUILD_FAILED");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}
