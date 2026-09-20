import fs from "node:fs";
import path from "node:path";

export class PilotBuildArtifactError extends Error {
  constructor() {
    super("Pilot browser build artifact is invalid.");
    this.name = "PilotBuildArtifactError";
    this.code = "PILOT_BUILD_ARTIFACT_INVALID";
  }
}

export function validatePilotBuildArtifact(outputDirectory, apiUrl) {
  let files;
  try {
    files = listFiles(outputDirectory);
  } catch {
    throw new PilotBuildArtifactError();
  }
  if (files.length === 0 || !files.some(file => path.basename(file) === "index.html")) {
    throw new PilotBuildArtifactError();
  }
  let combined = "";
  for (const file of files) {
    if (/\.(?:css|html|js|json|map)$/i.test(file)) {
      combined += fs.readFileSync(file, "utf8");
    }
  }
  if (!combined.includes(apiUrl) || /http:\/\/localhost:3000/i.test(combined)) {
    throw new PilotBuildArtifactError();
  }
  if (files.some(file => /(?:^|\/)\.env(?:\.|$)/.test(file))) {
    throw new PilotBuildArtifactError();
  }
  return Object.freeze({ fileCount: files.length, apiUrlPresent: true });
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(resolved));
    else if (entry.isFile()) files.push(resolved);
  }
  return files;
}
