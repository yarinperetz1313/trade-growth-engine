const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  cleanupOwnedDirectory,
  createOwnedTempDirectory,
  isolatedGitEnvironment
} = require("./helpers/harnessTestIsolation");

const repositoryRoot = path.resolve(__dirname, "..");

test("owned harness cleanup is idempotent, removes handlers, and preserves unrelated environment", () => {
  const originalSigintListeners = process.listenerCount("SIGINT");
  const originalSigtermListeners = process.listenerCount("SIGTERM");
  const directory = createOwnedTempDirectory("tge-harness-lifecycle-");
  const environment = isolatedGitEnvironment({
    GIT_INDEX_FILE: "/caller/index",
    TGE_HARNESS_UNRELATED_SENTINEL: "preserved"
  });

  assert.equal(process.listenerCount("SIGINT"), originalSigintListeners + 1);
  assert.equal(process.listenerCount("SIGTERM"), originalSigtermListeners + 1);
  assert.equal(environment.GIT_INDEX_FILE, undefined);
  assert.equal(environment.TGE_HARNESS_UNRELATED_SENTINEL, "preserved");

  cleanupOwnedDirectory(directory);
  cleanupOwnedDirectory(directory);

  assert.equal(fs.existsSync(directory), false);
  assert.equal(process.listenerCount("SIGINT"), originalSigintListeners);
  assert.equal(process.listenerCount("SIGTERM"), originalSigtermListeners);
});

test("ambient Git-control variables cannot redirect harness fixture, checker, or hash operations", async () => {
  const originalTrackedBytes = snapshotTrackedFiles(cleanGitEnvironment());
  const originalLiveIndexBytes = snapshotGitIndex(cleanGitEnvironment());
  const callerRoot = createOwnedTempDirectory("tge-harness-caller-");

  try {
    runGitChecked(["init", "--quiet"], callerRoot, cleanGitEnvironment());
    fs.writeFileSync(path.join(callerRoot, "caller-only.txt"), "caller\n");
    runGitChecked(["add", "--", "caller-only.txt"], callerRoot, cleanGitEnvironment());
    const callerIndexPath = gitPath("index", callerRoot, cleanGitEnvironment());
    const originalCallerIndexBytes = fs.readFileSync(callerIndexPath);
    const callerGitDirectory = path.join(callerRoot, ".git");
    const poisonedEnvironment = {
      ...process.env,
      GIT_DIR: callerGitDirectory,
      GIT_WORK_TREE: callerRoot,
      GIT_COMMON_DIR: callerGitDirectory,
      GIT_INDEX_FILE: callerIndexPath,
      GIT_OBJECT_DIRECTORY: path.join(callerGitDirectory, "objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(callerGitDirectory, "objects"),
      GIT_CEILING_DIRECTORIES: path.dirname(repositoryRoot),
      GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.worktree",
      GIT_CONFIG_VALUE_0: callerRoot,
      GIT_NAMESPACE: "caller-controlled"
    };
    delete poisonedEnvironment.NODE_TEST_CONTEXT;

    const child = spawn(
      process.execPath,
      [
        "--test",
        "--test-name-pattern=harness contract-removal failures never expose",
        "test/engineering-harness-isolation.test.js"
      ],
      {
        cwd: repositoryRoot,
        env: poisonedEnvironment,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const childResult = await collectChildResult(child);

    assert.equal(
      childResult.code,
      0,
      childResult.stderr || childResult.stdout || childResult.signal
    );
    assert.deepEqual(
      fs.readFileSync(callerIndexPath),
      originalCallerIndexBytes,
      "harness helpers changed the caller-controlled index"
    );
    assert.deepEqual(
      snapshotGitIndex(cleanGitEnvironment()),
      originalLiveIndexBytes,
      "harness helpers changed the live index"
    );
    assert.deepEqual(
      snapshotTrackedFiles(cleanGitEnvironment()),
      originalTrackedBytes,
      "harness helpers changed live tracked bytes"
    );
  } finally {
    cleanupOwnedDirectory(callerRoot);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} removes owned harness fixture and marker resources without changing live Git state`, async () => {
    const originalTrackedBytes = snapshotTrackedFiles(cleanGitEnvironment());
    const originalLiveIndexBytes = snapshotGitIndex(cleanGitEnvironment());
    const coordinatorDirectory = createOwnedTempDirectory("tge-harness-signal-");
    const manifestPath = path.join(coordinatorDirectory, "resources.json");
    let resources;
    let child;

    try {
      const childEnvironment = {
        ...process.env,
        TGE_HARNESS_TEST_CONTRACT_PATH: "src/auth/authentication.js",
        TGE_HARNESS_TEST_SIGNAL_MANIFEST_PATH: manifestPath
      };
      delete childEnvironment.NODE_TEST_CONTEXT;
      child = spawn(
        process.execPath,
        ["test/engineering-harness.test.js"],
        {
          cwd: repositoryRoot,
          env: childEnvironment,
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      const childResultPromise = collectChildResult(child);

      await waitForFile(manifestPath);
      resources = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      assert.equal(fs.existsSync(resources.fixtureRoot), true);
      assert.equal(fs.existsSync(resources.markerDirectory), true);

      assert.equal(child.kill(signal), true, `failed to send ${signal}`);
      const childResult = await childResultPromise;

      assert.equal(childResult.code, null, childResult.stderr || childResult.stdout);
      assert.equal(childResult.signal, signal, childResult.stderr || childResult.stdout);
      assert.equal(fs.existsSync(resources.fixtureRoot), false, "fixture repository leaked");
      assert.equal(fs.existsSync(resources.markerDirectory), false, "marker directory leaked");
      assert.deepEqual(
        snapshotGitIndex(cleanGitEnvironment()),
        originalLiveIndexBytes,
        `${signal} changed the live index`
      );
      assert.deepEqual(
        snapshotTrackedFiles(cleanGitEnvironment()),
        originalTrackedBytes,
        `${signal} changed live tracked bytes`
      );
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      if (resources) {
        fs.rmSync(resources.fixtureRoot, { recursive: true, force: true });
        fs.rmSync(resources.markerDirectory, { recursive: true, force: true });
      }
      cleanupOwnedDirectory(coordinatorDirectory);
    }
  });
}

test("harness contract-removal failures never expose mutated tracked source to another process", async () => {
  const authenticationPath = path.join(
    repositoryRoot,
    "src",
    "auth",
    "authentication.js"
  );
  const originalTrackedBytes = snapshotTrackedFiles();
  const markerDirectory = createOwnedTempDirectory("tge-harness-race-");
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
    cleanupOwnedDirectory(markerDirectory);
  }
});

function snapshotTrackedFiles(environment = isolatedGitEnvironment()) {
  const trackedResult = spawnSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment
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

function snapshotGitIndex(environment) {
  return fs.readFileSync(gitPath("index", repositoryRoot, environment));
}

function gitPath(pathspec, root, environment) {
  const result = spawnSync("git", ["rev-parse", "--git-path", pathspec], {
    cwd: root,
    encoding: "utf8",
    env: environment
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return path.resolve(root, result.stdout.trim());
}

function runGitChecked(args, root, environment) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: environment
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function cleanGitEnvironment() {
  return isolatedGitEnvironment();
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
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timed out waiting for harness test child to exit"));
    }, 20_000);

    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
