import fs from "node:fs";

export class PilotDeploymentConfigurationError extends Error {
  constructor() {
    super("Pilot deployment configuration is invalid.");
    this.name = "PilotDeploymentConfigurationError";
    this.code = "PILOT_DEPLOYMENT_CONFIGURATION_INVALID";
  }
}

const invalid = () => {
  throw new PilotDeploymentConfigurationError();
};

const isObject = value => value !== null
  && typeof value === "object"
  && !Array.isArray(value);

function requireValue(condition) {
  if (!condition) invalid();
}

function requireSecretReference(env, name) {
  const value = env?.[name];
  requireValue(isObject(value));
  requireValue(typeof value.secretRef === "string" && /^[a-z][a-z0-9-]+$/.test(value.secretRef));
  requireValue(value.version === "pinned-version");
  requireValue(Object.keys(value).sort().join(",") === "secretRef,version");
}

function requireImageReference(value) {
  requireValue(
    value === "${MELBOURNE_IMAGE_URI_BY_DIGEST}"
    || /^australia-southeast2-docker\.pkg\.dev\/[a-z][a-z0-9-]+\/[a-z0-9-]+\/trade-growth-engine@sha256:[a-f0-9]{64}$/.test(value)
  );
}

function requireExactKeys(value, keys) {
  requireValue(isObject(value));
  requireValue(Object.keys(value).sort().join(",") === [...keys].sort().join(","));
}

export function validatePilotDeployment(config) {
  requireValue(isObject(config));
  const serialized = JSON.stringify(config);
  requireValue(!/(?:postgres|postgresql):\/\//i.test(serialized));
  requireValue(!/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i.test(serialized));
  requireValue(!/AIza[0-9A-Za-z_-]{20,}/.test(serialized));
  requireValue(config.schemaVersion === 1 && config.templateOnly === true);
  requireValue(config.region === "australia-southeast2");

  const identities = config.identities;
  requireValue(isObject(identities));
  requireValue(Object.keys(identities).sort().join(",") === "maintenance,migrator,runtime,scheduler");
  requireValue(new Set(Object.values(identities)).size === 4);
  requireValue(identities.runtime === "tge-pilot-runtime");
  requireValue(identities.migrator === "tge-pilot-migrator");
  requireValue(identities.maintenance === "tge-pilot-maintenance");
  requireValue(identities.scheduler === "tge-pilot-scheduler");

  requireValue(config.artifact?.mutableTagsAllowed === false);
  requireImageReference(config.artifact?.image);

  const cloudSql = config.cloudSql;
  requireValue(cloudSql?.databaseVersion === "POSTGRES_16");
  requireValue(cloudSql?.region === config.region);
  requireValue(cloudSql?.deletionProtection === true);
  requireValue(cloudSql?.settings?.edition === "ENTERPRISE");
  requireValue(cloudSql?.settings?.tier === "db-custom-1-3840");
  requireValue(!/^db-(?:f1-micro|g1-small)$/.test(cloudSql?.settings?.tier));
  requireValue(cloudSql?.settings?.authorizedNetworks?.length === 0);
  requireValue(cloudSql?.settings?.sslMode === "ENCRYPTED_ONLY");
  requireValue(cloudSql?.settings?.availabilityType === "ZONAL");
  const backup = cloudSql?.settings?.backupConfiguration;
  requireValue(backup?.enabled === true);
  requireValue(backup?.location === config.region);
  requireValue(backup?.retainedBackups === 14);
  requireValue(backup?.pointInTimeRecoveryEnabled === true);
  requireValue(backup?.startTimeUtc === "15:00");

  const service = config.cloudRun?.service;
  requireValue(service?.region === config.region);
  requireValue(service?.serviceAccountRef === "runtime");
  requireValue(service?.ingress === "INGRESS_TRAFFIC_ALL");
  requireValue(service?.httpsOnly === true);
  requireValue(service?.allowUnauthenticated === true);
  requireValue(service?.releaseTrafficPolicy === "NO_TRAFFIC_UNTIL_READY");
  requireValue(service?.cloudSqlInstanceRef === cloudSql.name);
  requireImageReference(service?.container?.image);
  requireValue(service?.container?.port === 8080);
  requireValue(JSON.stringify(service?.container?.command) === '["node","src/pilot/index.js"]');
  requireExactKeys(service?.env, [
    "NODE_ENV",
    "TGE_PUBLIC_APP_URL",
    "TGE_PUBLIC_API_URL",
    "TGE_AUTH0_ISSUER",
    "TGE_AUTH0_AUDIENCE",
    "TGE_AUTH0_CLIENT_ID",
    "TGE_AUTH0_CALLBACK_URL",
    "TGE_AUTH0_LOGOUT_URL",
    "TGE_RUNTIME_DATABASE_URL"
  ]);
  requireValue(service.env.NODE_ENV === "production");
  for (const name of [
    "TGE_PUBLIC_APP_URL",
    "TGE_PUBLIC_API_URL",
    "TGE_AUTH0_ISSUER",
    "TGE_AUTH0_AUDIENCE",
    "TGE_AUTH0_CLIENT_ID",
    "TGE_AUTH0_CALLBACK_URL",
    "TGE_AUTH0_LOGOUT_URL"
  ]) requireValue(service.env[name] === `\${${name}}`);
  requireSecretReference(service?.env, "TGE_RUNTIME_DATABASE_URL");
  requireValue(service?.probes?.startup?.path === "/health/live");
  requireValue(service?.probes?.liveness?.path === "/health/live");
  requireValue(service?.probes?.releaseReadiness?.path === "/health/ready");
  requireValue(service?.probes?.releaseReadiness?.expectedStatus === 200);

  const migrator = config.cloudRun?.jobs?.migrator;
  requireValue(migrator?.region === config.region);
  requireValue(migrator?.serviceAccountRef === "migrator");
  requireValue(migrator?.cloudSqlInstanceRef === cloudSql.name);
  requireImageReference(migrator?.container?.image);
  requireValue(JSON.stringify(migrator?.container?.command) === '["node","scripts/migrate-db.mjs"]');
  requireExactKeys(migrator?.env, ["TGE_DATABASE_URL"]);
  requireSecretReference(migrator?.env, "TGE_DATABASE_URL");
  requireValue(migrator?.maxRetries === 0);

  const maintenance = config.cloudRun?.jobs?.maintenance;
  requireValue(maintenance?.region === config.region);
  requireValue(maintenance?.serviceAccountRef === "maintenance");
  requireValue(maintenance?.cloudSqlInstanceRef === cloudSql.name);
  requireImageReference(maintenance?.container?.image);
  requireValue(JSON.stringify(maintenance?.container?.command) === '["node","scripts/run-maintenance-cleanup.mjs"]');
  requireExactKeys(maintenance?.env, [
    "TGE_MAINTENANCE_DATABASE_URL",
    "TGE_MAINTENANCE_BATCH_LIMIT",
    "TGE_MAINTENANCE_MAX_ROUNDS"
  ]);
  requireSecretReference(maintenance?.env, "TGE_MAINTENANCE_DATABASE_URL");
  requireValue(maintenance.env.TGE_MAINTENANCE_BATCH_LIMIT === "25");
  requireValue(maintenance.env.TGE_MAINTENANCE_MAX_ROUNDS === "8");
  requireValue(maintenance?.maxRetries === 0);

  const scheduler = config.cloudScheduler;
  requireValue(scheduler?.region === config.region);
  requireValue(scheduler?.schedule === "*/15 * * * *");
  requireValue(scheduler?.timeZone === "Australia/Melbourne");
  requireValue(scheduler?.httpMethod === "POST");
  requireValue(scheduler?.target === `cloud-run-v2-job:${maintenance.name}:run`);
  requireValue(scheduler?.oauthServiceAccountRef === "scheduler");

  const diagnostics = config.operations?.structuredDiagnostics;
  requireValue(diagnostics?.forbiddenFields?.includes("tenantId"));
  requireValue(diagnostics?.forbiddenFields?.includes("token"));
  const alertCodes = new Set(config.operations?.alerts?.map(alert => alert.code));
  for (const code of [
    "PILOT_READINESS_UNAVAILABLE",
    "PILOT_API_5XX",
    "PILOT_MAINTENANCE_ACTION_REQUIRED",
    "PILOT_BACKUP_STALE"
  ]) requireValue(alertCodes.has(code));

  return Object.freeze({
    region: config.region,
    databaseVersion: cloudSql.databaseVersion,
    databaseEdition: cloudSql.settings.edition,
    databaseTier: cloudSql.settings.tier,
    backup: Object.freeze({
      location: backup.location,
      retainedBackups: backup.retainedBackups
    }),
    service: Object.freeze({
      ingress: service.ingress,
      httpsOnly: service.httpsOnly
    }),
    identities: Object.freeze({ ...identities }),
    secretReferences: Object.freeze([
      "TGE_RUNTIME_DATABASE_URL",
      "TGE_DATABASE_URL",
      "TGE_MAINTENANCE_DATABASE_URL"
    ]),
    scheduler: Object.freeze({ timeZone: scheduler.timeZone })
  });
}

export function loadAndValidatePilotDeployment(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    invalid();
  }
  return validatePilotDeployment(parsed);
}
