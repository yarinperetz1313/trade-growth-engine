import fs from "node:fs";
import path from "node:path";

export class PilotContainerContractError extends Error {
  constructor() {
    super("Pilot container contract is invalid.");
    this.name = "PilotContainerContractError";
    this.code = "PILOT_CONTAINER_CONTRACT_INVALID";
  }
}

export function validatePilotContainerContract(root) {
  let dockerfile;
  let dockerignore;
  let packageJson;
  let packageLock;
  try {
    dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
    dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
    packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  } catch {
    throw new PilotContainerContractError();
  }
  const requiredDockerfile = [
    "FROM node:22.22.0-bookworm-slim AS dependencies",
    "FROM node:22.22.0-bookworm-slim AS runtime",
    "npm ci --omit=dev --ignore-scripts",
    "USER node",
    "STOPSIGNAL SIGTERM",
    'CMD ["node", "src/pilot/index.js"]',
    "/health/live"
  ];
  const requiredIgnores = [".git", ".env*", "node_modules", "data", "dist", "test"];
  if (
    requiredDockerfile.some(value => !dockerfile.includes(value))
    || requiredIgnores.some(value => !dockerignore.split(/\r?\n/).includes(value))
    || /(?:ARG|ENV)\s+[^\n]*(?:SECRET|PASSWORD|TOKEN|DATABASE_URL)/i.test(dockerfile)
    || packageLock.lockfileVersion !== 3
    || packageLock.packages?.[""]?.name !== packageJson.name
    || packageLock.packages?.[""]?.version !== packageJson.version
  ) throw new PilotContainerContractError();
  return Object.freeze({ nodeImage: "node:22.22.0-bookworm-slim", user: "node" });
}
