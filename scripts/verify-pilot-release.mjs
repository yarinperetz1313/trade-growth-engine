import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { validatePilotBuildConfig } from "./pilot-build-config.mjs";
import { validatePilotContainerContract } from "./pilot-container-contract.mjs";
import { loadAndValidatePilotDeployment } from "./pilot-deployment-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  validatePilotBuildConfig(process.env);
  validatePilotContainerContract(root);
  const deployment = loadAndValidatePilotDeployment(
    path.join(root, "deploy", "gcp", "pilot-deployment.template.json")
  );
  const build = spawnSync(process.execPath, [
    path.join(root, "scripts", "build-pilot.mjs")
  ], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  if (build.error || build.signal || build.status !== 0) {
    throw new Error("pilot build failed");
  }
  console.log(JSON.stringify({
    status: "verified",
    nodeImage: "node:22.22.0-bookworm-slim",
    region: deployment.region,
    databaseVersion: deployment.databaseVersion,
    databaseEdition: deployment.databaseEdition,
    databaseTier: deployment.databaseTier,
    retainedBackups: deployment.backup.retainedBackups
  }));
} catch {
  console.error("PILOT_RELEASE_VERIFICATION_FAILED");
  process.exitCode = 1;
}
