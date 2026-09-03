import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const storePrefix = "tge-e2e-";
const markerFile = ".tge-e2e-store.json";

export function getE2eStoreStateFile() {
  if (process.env.TGE_E2E_STORE_STATE_FILE) {
    return process.env.TGE_E2E_STORE_STATE_FILE;
  }

  let hash = 5381;
  for (const char of process.cwd()) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }

  return path.join(
    os.tmpdir(),
    `tge-e2e-store-state-${(hash >>> 0).toString(16)}.json`
  );
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(getE2eStoreStateFile(), "utf8"));
  } catch {
    return { storeDirs: [] };
  }
}

function writeState(storeDirs) {
  const uniqueStoreDirs = [...new Set(storeDirs)];
  const filePath = getE2eStoreStateFile();

  if (uniqueStoreDirs.length === 0) {
    fs.rmSync(filePath, { force: true });
    return;
  }

  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ storeDirs: uniqueStoreDirs }, null, 2)}\n`
  );
}

function registerE2eStore(storeDir) {
  const state = readState();
  writeState([...(state.storeDirs || []), storeDir]);
  process.env.TGE_E2E_STORE_STATE_FILE = getE2eStoreStateFile();
}

export function createE2eStore() {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), storePrefix));

  fs.writeFileSync(
    path.join(storeDir, markerFile),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        cwd: process.cwd(),
        pid: process.pid
      },
      null,
      2
    )}\n`
  );

  registerE2eStore(storeDir);

  return storeDir;
}

export function assertManagedE2eStore(storeDir) {
  if (!storeDir) {
    return false;
  }

  const resolvedStoreDir = path.resolve(storeDir);
  const tempRoot = path.resolve(os.tmpdir());
  const relativeToTemp = path.relative(tempRoot, resolvedStoreDir);
  const markerPath = path.join(resolvedStoreDir, markerFile);

  if (
    !relativeToTemp ||
    relativeToTemp.startsWith("..") ||
    path.isAbsolute(relativeToTemp) ||
    !path.basename(resolvedStoreDir).startsWith(storePrefix) ||
    !fs.existsSync(markerPath)
  ) {
    return false;
  }

  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return marker.cwd === process.cwd();
  } catch {
    return false;
  }
}

export function cleanupE2eStore(storeDir) {
  if (!assertManagedE2eStore(storeDir)) {
    return false;
  }

  fs.rmSync(storeDir, {
    recursive: true,
    force: true
  });

  return true;
}

export function writeCollection(storeDir, name, data) {
  fs.writeFileSync(
    path.join(storeDir, `${name}.json`),
    `${JSON.stringify(data, null, 2)}\n`
  );
}

export function seedE2eStore(storeDir) {
  const now = new Date().toISOString();

  writeCollection(storeDir, "prospects", [
    {
      id: "e2e-prospect-command",
      business_name: "E2E Command Plumbing",
      website: "https://example.test/e2e-command-plumbing",
      service: "Commercial Plumbing",
      location: "Melbourne",
      source: "e2e-seed",
      qualification_score: 86,
      qualification_status: "HIGH"
    },
    {
      id: "e2e-prospect-unconverted",
      business_name: "E2E Unconverted Roofing",
      website: "https://example.test/e2e-unconverted-roofing",
      service: "Commercial Roofing",
      location: "Geelong",
      source: "e2e-seed",
      qualification_score: 78,
      qualification_status: "HIGH"
    }
  ]);

  writeCollection(storeDir, "opportunities", [
    {
      id: "e2e-opp-revenue",
      created_at: now,
      updated_at: now,
      business_name: "E2E Revenue Electrical",
      service: "Commercial Electrical",
      location: "Melbourne",
      stage: "QUALIFIED",
      priority: "HIGH",
      qualification_score: 84,
      value: 21000,
      probability: 0.2,
      weighted_value: 4200,
      next_action: "Begin qualified outreach"
    },
    {
      id: "e2e-opp-command",
      created_at: now,
      updated_at: now,
      prospect_id: "e2e-prospect-command",
      business_name: "E2E Command Plumbing",
      service: "Commercial Plumbing",
      location: "Melbourne",
      stage: "QUALIFIED",
      priority: "HIGH",
      qualification_score: 86,
      value: 15000,
      probability: 0.2,
      weighted_value: 3000,
      next_action: "Begin qualified outreach"
    },
    {
      id: "e2e-opp-execution",
      created_at: now,
      updated_at: now,
      business_name: "E2E Execution Electrical",
      contact_name: "Morgan Lee",
      service: "Commercial Electrical",
      location: "Melbourne",
      stage: "PROPOSAL",
      priority: "HIGH",
      qualification_score: 88,
      value: 42000,
      probability: 0.75,
      weighted_value: 31500,
      next_action: "Follow up on proposal"
    },
    {
      id: "e2e-opp-execution-failure",
      created_at: now,
      updated_at: now,
      business_name: "E2E Failure Electrical",
      contact_name: "Taylor Reed",
      service: "Commercial Electrical",
      location: "Melbourne",
      stage: "PROPOSAL",
      priority: "HIGH",
      qualification_score: 88,
      value: 36000,
      probability: 0.75,
      weighted_value: 27000,
      next_action: "Follow up on proposal"
    }
  ]);

  writeCollection(storeDir, "activities", [
    {
      id: "e2e-revenue-activity-created",
      created_at: now,
      updated_at: now,
      opportunity_id: "e2e-opp-revenue",
      type: "OPPORTUNITY_CREATED",
      description: "Seeded revenue opportunity activity",
      metadata: {
        source: "e2e-seed"
      }
    },
    {
      id: "e2e-activity-created",
      created_at: now,
      updated_at: now,
      prospect_id: "e2e-prospect-command",
      opportunity_id: "e2e-opp-command",
      type: "OPPORTUNITY_CREATED",
      description: "Opportunity created from prospect qualification",
      metadata: {
        source: "e2e-seed"
      }
    },
    {
      id: "e2e-execution-activity-created",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      opportunity_id: "e2e-opp-execution",
      type: "OPPORTUNITY_CREATED",
      description: "Seeded stale execution opportunity",
      metadata: {
        source: "e2e-seed"
      }
    },
    {
      id: "e2e-execution-failure-activity-created",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      opportunity_id: "e2e-opp-execution-failure",
      type: "OPPORTUNITY_CREATED",
      description: "Seeded independent failure-path opportunity",
      metadata: {
        source: "e2e-seed"
      }
    }
  ]);

  writeCollection(storeDir, "tasks", []);
  writeCollection(storeDir, "revenue_actions", []);
  writeCollection(storeDir, "revenue_leak_cases", []);
}

export function cleanupPlaywrightStore(config) {
  const outputDir = config?.config?.outputDir;
  const fallbackStoreDir =
    outputDir && path.basename(outputDir) === "test-results"
      ? path.dirname(outputDir)
      : undefined;

  const state = readState();
  const candidates = [
    ...(state.storeDirs || []),
    process.env.TGE_E2E_STORE_DIR,
    fallbackStoreDir
  ].filter(Boolean);

  const remainingStoreDirs = [];

  for (const storeDir of [...new Set(candidates)]) {
    if (!cleanupE2eStore(storeDir) && fs.existsSync(storeDir)) {
      remainingStoreDirs.push(storeDir);
    }
  }

  writeState(remainingStoreDirs.filter(assertManagedE2eStore));
}
