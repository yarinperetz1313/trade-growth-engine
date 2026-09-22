"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("pilot container is pinned, multi-stage, non-root, signal-safe, and secret-free", () => {
  const dockerfile = read("Dockerfile");
  const dockerignore = read(".dockerignore");

  assert.match(dockerfile, /^FROM node:22\.22\.0-bookworm-slim AS dependencies$/m);
  assert.match(dockerfile, /^FROM node:22\.22\.0-bookworm-slim AS runtime$/m);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^STOPSIGNAL SIGTERM$/m);
  assert.match(dockerfile, /^CMD \["node", "src\/pilot\/index\.js"\]$/m);
  assert.match(dockerfile, /\/health\/live/);
  assert.doesNotMatch(dockerfile, /(?:ARG|ENV)\s+.*(?:SECRET|PASSWORD|TOKEN|DATABASE_URL)/i);
  assert.match(dockerignore, /^\.env\*$/m);
  assert.match(dockerignore, /^data$/m);
  assert.match(dockerignore, /^dist$/m);
});

test("pilot production lock excludes the fixed qs denial-of-service ranges", () => {
  const packageLock = JSON.parse(read("package-lock.json"));
  assert.equal(packageLock.packages["node_modules/qs"].version, "6.16.0");
});

test("sanitized Melbourne manifest passes the credential-free deployment validator", async () => {
  const { loadAndValidatePilotDeployment } = await import(
    pathToFileURL(path.join(root, "scripts", "pilot-deployment-config.mjs"))
  );
  const result = loadAndValidatePilotDeployment(
    path.join(root, "deploy", "gcp", "pilot-deployment.template.json")
  );

  assert.equal(result.region, "australia-southeast2");
  assert.equal(result.databaseVersion, "POSTGRES_16");
  assert.equal(result.databaseEdition, "ENTERPRISE");
  assert.equal(result.databaseTier, "db-custom-1-3840");
  assert.equal(result.backup.retainedBackups, 14);
  assert.equal(result.backup.location, "australia-southeast2");
  assert.equal(result.service.ingress, "INGRESS_TRAFFIC_ALL");
  assert.equal(result.service.httpsOnly, true);
  assert.deepEqual(
    new Set(Object.values(result.identities)),
    new Set([
      "tge-pilot-runtime",
      "tge-pilot-migrator",
      "tge-pilot-maintenance",
      "tge-pilot-scheduler"
    ])
  );
  assert.ok(result.secretReferences.includes("TGE_RUNTIME_DATABASE_URL"));
  assert.ok(result.secretReferences.includes("TGE_DATABASE_URL"));
  assert.ok(result.secretReferences.includes("TGE_MAINTENANCE_DATABASE_URL"));
  assert.equal(result.scheduler.timeZone, "Australia/Melbourne");

  const raw = read("deploy/gcp/pilot-deployment.template.json");
  assert.doesNotMatch(raw, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(raw, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i);
});

test("deployment validator rejects topology drift, inline secrets, mutable images, and shared identities", async () => {
  const { validatePilotDeployment } = await import(
    pathToFileURL(path.join(root, "scripts", "pilot-deployment-config.mjs"))
  );
  const baseline = JSON.parse(read("deploy/gcp/pilot-deployment.template.json"));
  const invalid = [
    value => { value.region = "australia-southeast1"; },
    value => { delete value.cloudSql.settings.edition; },
    value => { value.cloudSql.settings.tier = "db-f1-micro"; },
    value => { value.cloudSql.settings.backupConfiguration.retainedBackups = 7; },
    value => { value.cloudRun.service.container.image = "example.test/tge:latest"; },
    value => { value.cloudRun.service.env.TGE_RUNTIME_DATABASE_URL = "postgresql://inline"; },
    value => { value.cloudRun.service.env.TGE_API_TOKEN = "inline"; },
    value => { value.identities.maintenance = value.identities.runtime; },
    value => { value.cloudScheduler.timeZone = "UTC"; }
  ];

  for (const mutate of invalid) {
    const candidate = structuredClone(baseline);
    mutate(candidate);
    assert.throws(
      () => validatePilotDeployment(candidate),
      error => error.code === "PILOT_DEPLOYMENT_CONFIGURATION_INVALID"
    );
  }
});

test("maintenance policy drains bounded rounds and reports only minimized status", async () => {
  const { drainMaintenanceWork } = await import(
    pathToFileURL(path.join(root, "scripts", "maintenance-cleanup-policy.mjs"))
  );
  const rawBatches = [
    Array.from({ length: 2 }, (_, index) => ({
      batch_id: `private-${index}`,
      cleanup_state: "SUCCEEDED",
      retryable: false,
      attempt_count: 1,
      failure_code: null
    })),
    []
  ];
  const offboardingBatches = [[], []];
  const result = await drainMaintenanceWork({
    batchLimit: 2,
    maxRounds: 3,
    runRawImportBatch: async () => rawBatches.shift(),
    runTenantOffboardingBatch: async () => offboardingBatches.shift()
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status, "drained");
  assert.equal(result.rawImportCleanup.processed, 2);
  assert.equal(result.rawImportCleanup.backlogStatus, "none_observed");
  assert.deepEqual(result.rawImportCleanup.oldestProcessed, {
    state: "SUCCEEDED",
    retryable: false,
    attemptCount: 1
  });
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test("maintenance policy exits nonzero for retryable failure and bounded remaining backlog", async () => {
  const { drainMaintenanceWork } = await import(
    pathToFileURL(path.join(root, "scripts", "maintenance-cleanup-policy.mjs"))
  );
  const retryable = await drainMaintenanceWork({
    batchLimit: 2,
    maxRounds: 2,
    runRawImportBatch: async () => [{
      batch_id: "private",
      cleanup_state: "FAILED",
      retryable: true,
      attempt_count: 2,
      failure_code: "RAW_IMPORT_CLEANUP_FAILED"
    }],
    runTenantOffboardingBatch: async () => []
  });
  assert.equal(retryable.exitCode, 2);
  assert.equal(retryable.status, "action_required");
  assert.equal(retryable.rawImportCleanup.retryable, 1);
  assert.equal(retryable.rawImportCleanup.backlogStatus, "retryable_or_failed");
  assert.doesNotMatch(JSON.stringify(retryable), /private|failure_code|RAW_IMPORT/i);

  let rawCalls = 0;
  const backlog = await drainMaintenanceWork({
    batchLimit: 1,
    maxRounds: 2,
    runRawImportBatch: async () => {
      rawCalls += 1;
      return [{ cleanup_state: "SUCCEEDED", retryable: false, attempt_count: 1 }];
    },
    runTenantOffboardingBatch: async () => []
  });
  assert.equal(rawCalls, 2);
  assert.equal(backlog.exitCode, 3);
  assert.equal(backlog.status, "backlog_remaining");
  assert.equal(backlog.rawImportCleanup.backlogStatus, "remaining_or_locked");
});

test("package exposes deterministic credential-free deployment and release gates", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(
    packageJson.scripts["validate:pilot-deployment"],
    "node scripts/validate-pilot-deployment.mjs"
  );
  assert.equal(
    packageJson.scripts["verify:pilot-release"],
    "node scripts/verify-pilot-release.mjs"
  );
  assert.match(read("scripts/build-pilot.mjs"), /rmSync\(.*dist/);
});

test("GitHub Verify enforces the pilot release contract and a real image build", () => {
  const workflow = read(".github/workflows/verify.yml");
  assert.match(workflow, /npm run verify:pilot-release/);
  assert.match(workflow, /TGE_PUBLIC_API_URL: https:\/\/api\.example\.test/);
  assert.match(workflow, /VITE_API_URL: https:\/\/api\.example\.test/);
  assert.match(workflow, /docker build --tag tge-pilot:verify \./);
});
