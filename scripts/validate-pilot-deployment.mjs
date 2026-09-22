import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadAndValidatePilotDeployment } from "./pilot-deployment-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const result = loadAndValidatePilotDeployment(
    path.join(root, "deploy", "gcp", "pilot-deployment.template.json")
  );
  console.log(JSON.stringify({
    status: "valid",
    region: result.region,
    databaseVersion: result.databaseVersion,
    databaseEdition: result.databaseEdition,
    databaseTier: result.databaseTier,
    retainedBackups: result.backup.retainedBackups,
    secretReferences: result.secretReferences.length
  }));
} catch {
  console.error("PILOT_DEPLOYMENT_CONFIGURATION_INVALID");
  process.exitCode = 1;
}
