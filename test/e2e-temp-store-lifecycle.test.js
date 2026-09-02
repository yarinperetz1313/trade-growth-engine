const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function listTgeE2eDirs() {
  return new Set(
    fs
      .readdirSync(os.tmpdir(), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith("tge-e2e-"))
      .map(entry => path.join(os.tmpdir(), entry.name))
  );
}

test("E2E temp-store lifecycle cleans only managed tge-e2e stores", async () => {
  const {
    assertManagedE2eStore,
    cleanupE2eStore,
    cleanupPlaywrightStore,
    createE2eStore,
    seedE2eStore,
    writeCollection
  } = await import("./e2e/tempStoreLifecycle.mjs");

  const previousStateFile = process.env.TGE_E2E_STORE_STATE_FILE;
  const stateFile = path.join(
    os.tmpdir(),
    `tge-e2e-store-state-test-${process.pid}-${Date.now()}.json`
  );
  process.env.TGE_E2E_STORE_STATE_FILE = stateFile;

  try {
    const firstStoreDir = createE2eStore();
    const secondStoreDir = createE2eStore();
    seedE2eStore(firstStoreDir);

    assert.equal(assertManagedE2eStore(firstStoreDir), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(firstStoreDir, "opportunities.json"), "utf8")).length, 4);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(firstStoreDir, "tasks.json"), "utf8")), []);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(firstStoreDir, "revenue_actions.json"), "utf8")), []);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(firstStoreDir, "revenue_leak_cases.json"), "utf8")), []);
    assert.equal(cleanupE2eStore(firstStoreDir), true);
    assert.equal(fs.existsSync(firstStoreDir), false);

    const unmanagedDir = fs.mkdtempSync(path.join(os.tmpdir(), "tge-e2e-"));
    try {
      assert.equal(cleanupE2eStore(unmanagedDir), false);
      assert.equal(fs.existsSync(unmanagedDir), true);
    } finally {
      fs.rmSync(unmanagedDir, { recursive: true, force: true });
    }

    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "tge-e2e-artifacts-"));
    try {
      const artifactOutputDir = path.join(artifactDir, "test-results");
      fs.mkdirSync(artifactOutputDir, { recursive: true });
      fs.writeFileSync(path.join(artifactOutputDir, "trace.zip"), "evidence");

      cleanupPlaywrightStore({
        config: {
          outputDir: artifactOutputDir
        }
      });

      assert.equal(fs.existsSync(secondStoreDir), false);
      assert.equal(fs.existsSync(path.join(artifactOutputDir, "trace.zip")), true);
      assert.equal(fs.existsSync(stateFile), false);
    } finally {
      fs.rmSync(artifactDir, { recursive: true, force: true });
    }
  } finally {
    if (previousStateFile) {
      process.env.TGE_E2E_STORE_STATE_FILE = previousStateFile;
    } else {
      delete process.env.TGE_E2E_STORE_STATE_FILE;
    }
  }
});

test("E2E parent runner removes its managed store after successful and failing children", async () => {
  const before = listTgeE2eDirs();
  const previousStateFile = process.env.TGE_E2E_STORE_STATE_FILE;
  const stateFile = path.join(
    os.tmpdir(),
    `tge-e2e-store-state-runner-test-${process.pid}-${Date.now()}.json`
  );
  process.env.TGE_E2E_STORE_STATE_FILE = stateFile;

  try {
    const { runE2e } = await import("../scripts/run-e2e.mjs");
    for (const expectedCode of [0, 7]) {
      const result = await runE2e({
        childCommand: process.execPath,
        childArgs: [
          "-e",
          `const fs=require('node:fs');const path=require('node:path');if(!process.env.TGE_E2E_STORE_DIR) process.exit(9);fs.mkdirSync(path.join(process.env.TGE_E2E_STORE_DIR,'test-results'),{recursive:true});fs.writeFileSync(path.join(process.env.TGE_E2E_STORE_DIR,'test-results','.last-run.json'),'{}');process.exit(${expectedCode});`
        ],
        env: {
          ...process.env,
          OPENSSL_CONF: "/dev/null"
        },
        stdio: "ignore"
      });

      assert.equal(result.code, expectedCode);
      assert.equal(fs.existsSync(result.storeDir), false);
    }

    assert.equal(fs.existsSync(stateFile), false);

    const after = listTgeE2eDirs();
    const newDirs = [...after].filter(dir => !before.has(dir));
    assert.deepEqual(newDirs, []);
  } finally {
    if (previousStateFile) {
      process.env.TGE_E2E_STORE_STATE_FILE = previousStateFile;
    } else {
      delete process.env.TGE_E2E_STORE_STATE_FILE;
    }
  }
});
