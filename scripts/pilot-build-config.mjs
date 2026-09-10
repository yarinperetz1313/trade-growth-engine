export class PilotBuildConfigurationError extends Error {
  constructor() {
    super("Pilot browser build configuration is invalid.");
    this.name = "PilotBuildConfigurationError";
    this.code = "PILOT_BUILD_CONFIGURATION_INVALID";
  }
}

function exactHttpsOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && !value.includes("*")
    && parsed.protocol === "https:"
    && !parsed.username
    && !parsed.password
    && !parsed.hash
    && value === parsed.origin;
}

export function validatePilotBuildConfig(env = process.env) {
  if (
    !exactHttpsOrigin(env.TGE_PUBLIC_API_URL)
    || !exactHttpsOrigin(env.VITE_API_URL)
    || env.VITE_API_URL !== env.TGE_PUBLIC_API_URL
  ) throw new PilotBuildConfigurationError();
  return Object.freeze({ apiUrl: env.VITE_API_URL });
}
