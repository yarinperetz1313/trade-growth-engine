const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");

test("harness contract-removal failures never expose mutated tracked source to another process", async () => {
  const authenticationPath = path.join(
    repositoryRoot,
    "src",
    "auth",
    "authentication.js"
  );
  const originalTrackedBytes = snapshotTrackedFiles();
  const markerDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "tge-harness-race-")
  );
  const readyPath = path.join(markerDirectory, "mutation-ready");
  const releasePath = path.join(markerDirectory, "mutation-release");
  const childEnvironment = {
    ...process.env,
    TGE_HARNESS_TEST_CONTRACT_PATH: "src/auth/authentication.js",
    TGE_HARNESS_TEST_MUTATION_READY_PATH: readyPath,
    TGE_HARNESS_TEST_MUTATION_RELEASE_PATH: releasePath
  };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    [
      "--test",
      "--test-name-pattern=engineering harness gate rejects removal",
      "test/engineering-harness.test.js"
    ],
    {
      cwd: repositoryRoot,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const childResultPromise = collectChildResult(child);

  try {
    const earlyChildResult = await Promise.race([
      waitForFile(readyPath).then(() => null),
      childResultPromise
    ]);
    assert.equal(
      earlyChildResult,
      null,
      earlyChildResult
        ? earlyChildResult.stderr || earlyChildResult.stdout || earlyChildResult.signal
        : "mutation observer did not become ready"
    );
    const observedTrackedBytes = snapshotTrackedFiles();
    const parseResult = spawnSync(process.execPath, ["--check", authenticationPath], {
      cwd: repositoryRoot,
      encoding: "utf8"
    });

    fs.writeFileSync(releasePath, "release\n");
    const childResult = await childResultPromise;
    const restoredTrackedBytes = snapshotTrackedFiles();

    assert.equal(
      childResult.code,
      0,
      childResult.stderr || childResult.stdout || childResult.signal
    );
    assert.equal(parseResult.status, 0, parseResult.stderr || parseResult.stdout);
    assert.deepEqual(
      observedTrackedBytes,
      originalTrackedBytes,
      "a concurrent process observed changed tracked-source bytes while the harness failed"
    );
    assert.deepEqual(
      restoredTrackedBytes,
      originalTrackedBytes,
      "the contract-removal failure did not preserve all tracked-source bytes"
    );
  } finally {
    fs.writeFileSync(releasePath, "release\n");
    await childResultPromise.catch(() => {});
    fs.rmSync(markerDirectory, { recursive: true, force: true });
  }
});

function snapshotTrackedFiles() {
  const trackedResult = spawnSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  assert.equal(
    trackedResult.status,
    0,
    trackedResult.stderr || trackedResult.stdout
  );

  return Object.fromEntries(
    trackedResult.stdout
      .split("\0")
      .filter(Boolean)
      .map(relativePath => [
        relativePath,
        createHash("sha256")
          .update(fs.readFileSync(path.join(repositoryRoot, relativePath)))
          .digest("hex")
      ])
  );
}

async function waitForFile(filePath) {
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(filePath)) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${path.basename(filePath)}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function collectChildResult(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
