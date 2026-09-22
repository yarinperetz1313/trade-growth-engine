import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { validatePilotBuildArtifact } from "./pilot-build-artifact.mjs";
import { validatePilotBuildConfig } from "./pilot-build-config.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const outputDirectory = path.join(repositoryRoot, "dist");

let config;
try {
  config = validatePilotBuildConfig(process.env);
} catch {
  console.error("PILOT_BUILD_CONFIGURATION_INVALID");
  process.exitCode = 1;
}

if (config) {
  try {
    fs.rmSync(path.join(repositoryRoot, "dist"), { recursive: true, force: true });
    const code = await runViteBuild();
    if (code !== 0) throw new Error("build failed");
    validatePilotBuildArtifact(outputDirectory, config.apiUrl);
  } catch {
    console.error("PILOT_BUILD_FAILED");
    process.exitCode = 1;
  }
}

function runViteBuild() {
  const vite = path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vite, "build"], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}
