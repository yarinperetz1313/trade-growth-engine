const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
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
        detached: process.platform !== "win32",
        env: poisonedEnvironment,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const childResult = await collectChildResult(child, {
      ownsProcessGroup: process.platform !== "win32"
    });

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
    const unrelatedListenerPath = path.join(
      coordinatorDirectory,
      "unrelated-listener.log"
    );
    fs.writeFileSync(unrelatedListenerPath, "");
    let resources;
    let child;

    try {
      const childEnvironment = {
        ...process.env,
        TGE_HARNESS_TEST_CONTRACT_PATH: "src/auth/authentication.js",
        TGE_HARNESS_TEST_SIGNAL_MANIFEST_PATH: manifestPath,
        TGE_HARNESS_TEST_UNRELATED_SIGNAL_LISTENER_PATH: unrelatedListenerPath
      };
      delete childEnvironment.NODE_TEST_CONTEXT;
      child = spawn(
        process.execPath,
        ["test/engineering-harness.test.js"],
        {
          cwd: repositoryRoot,
          detached: process.platform !== "win32",
          env: childEnvironment,
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      const childResultPromise = collectChildResult(child, {
        ownsProcessGroup: process.platform !== "win32",
        timeoutMs: 1_500
      });

      await waitForFile(manifestPath);
      resources = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      assert.equal(fs.existsSync(resources.fixtureRoot), true);
      assert.equal(fs.existsSync(resources.markerDirectory), true);

      assert.equal(child.kill(signal), true, `failed to send ${signal}`);
      const childResult = await childResultPromise;

      if (process.platform === "win32") {
        assert.ok(
          childResult.code !== null || childResult.signal !== null,
          childResult.stderr || childResult.stdout || "child did not terminate"
        );
      } else {
        assert.equal(childResult.code, null, childResult.stderr || childResult.stdout);
        assert.equal(childResult.signal, signal, childResult.stderr || childResult.stdout);
      }
      assert.equal(fs.existsSync(resources.fixtureRoot), false, "fixture repository leaked");
      assert.equal(fs.existsSync(resources.markerDirectory), false, "marker directory leaked");
      const unrelatedListenerInvocations = fs
        .readFileSync(unrelatedListenerPath, "utf8")
        .split("\n")
        .filter(Boolean);
      assert.ok(
        unrelatedListenerInvocations.length <= 1,
        `unrelated signal listener ran ${unrelatedListenerInvocations.length} times`
      );
      assert.ok(
        unrelatedListenerInvocations.every(invocation => invocation === signal),
        `unrelated listener observed an unexpected signal: ${unrelatedListenerInvocations}`
      );
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

test("timed-out harness subprocess cleans owned resources and terminates its descendant", async () => {
  const coordinatorDirectory = createOwnedTempDirectory("tge-harness-timeout-");
  const manifestPath = path.join(coordinatorDirectory, "resources.json");
  const readinessWaitingPath = path.join(
    coordinatorDirectory,
    "readiness-waiting"
  );
  let resources;
  let child;
  let childRejectionAssertion;
  let timeoutArmed = false;

  try {
    const childEnvironment = {
      ...process.env,
      TGE_HARNESS_TEST_CONTRACT_PATH: "src/auth/authentication.js",
      TGE_HARNESS_TEST_READINESS_RELEASE_FD: "3",
      TGE_HARNESS_TEST_READINESS_WAITING_PATH: readinessWaitingPath,
      TGE_HARNESS_TEST_SIGNAL_MANIFEST_PATH: manifestPath,
      TGE_HARNESS_TEST_TIMEOUT_DESCENDANT: "1"
    };
    delete childEnvironment.NODE_TEST_CONTEXT;
    child = spawn(process.execPath, ["test/engineering-harness.test.js"], {
      cwd: repositoryRoot,
      detached: process.platform !== "win32",
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe", "pipe"]
    });
    let startTimeout;
    const timeoutStartPromise = new Promise(resolve => {
      startTimeout = resolve;
    });
    const childResultPromise = collectChildResult(child, {
      ownsProcessGroup: process.platform !== "win32",
      onTimeoutArmed() {
        timeoutArmed = true;
      },
      timeoutStartPromise,
      timeoutMs: 500
    });
    childRejectionAssertion = assert.rejects(
      childResultPromise,
      /timed out waiting for harness test child to exit/
    );
    void childRejectionAssertion.catch(() => {});

    await waitForFile(readinessWaitingPath);
    assert.equal(
      timeoutArmed,
      false,
      "the fixture timeout was armed before explicit readiness"
    );
    child.stdio[3].end("release\n");
    await waitForFile(manifestPath);
    resources = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    await waitForFile(resources.descendantHeartbeatPath);
    startTimeout();
    await childRejectionAssertion;
    const heartbeatSize = fs.statSync(resources.descendantHeartbeatPath).size;
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.deepEqual(
      {
        descendantAlive:
          fs.statSync(resources.descendantHeartbeatPath).size > heartbeatSize,
        fixtureExists: fs.existsSync(resources.fixtureRoot),
        markerExists: fs.existsSync(resources.markerDirectory)
      },
      {
        descendantAlive: false,
        fixtureExists: false,
        markerExists: false
      }
    );
  } finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        signalOwnedChild(child, "SIGKILL", process.platform !== "win32");
      }
      if (childRejectionAssertion) {
        await childRejectionAssertion.catch(() => {});
      }
      if (resources?.descendantPid) {
        try {
          process.kill(resources.descendantPid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH" && error.code !== "EPERM") {
            throw error;
          }
        }
      }
    } finally {
      try {
        if (resources) {
          fs.rmSync(resources.fixtureRoot, { recursive: true, force: true });
          fs.rmSync(resources.markerDirectory, { recursive: true, force: true });
        }
      } finally {
        cleanupOwnedDirectory(coordinatorDirectory);
      }
    }
  }
});

test("EPERM never proves that an owned process group terminated", async () => {
  const child = createFakeChild(424_242);
  const permissionDenied = Object.assign(new Error("operation not permitted"), {
    code: "EPERM"
  });

  await assert.rejects(
    collectChildResult(child, {
      ownsProcessGroup: true,
      processKill() {
        throw permissionDenied;
      },
      terminationGraceMs: 5,
      terminationRecoveryMs: 20,
      timeoutMs: 1
    }),
    /timed out waiting for harness test child process tree to terminate/
  );
});

test("Windows timeout owns the full process tree and escalates before settling", async () => {
  const child = createFakeChild(515_151);
  let ownedDescendantAlive = true;
  const taskkillCalls = [];

  await assert.rejects(
    collectChildResult(child, {
      ownsProcessGroup: false,
      platform: "win32",
      spawnProcess(command, args, options) {
        taskkillCalls.push({ command, args, options });
        const taskkill = new EventEmitter();
        const forced = args.includes("/F");
        setImmediate(() => {
          taskkill.emit("close", forced ? 0 : 1, null);
          if (forced) {
            ownedDescendantAlive = false;
            child.exitCode = 1;
            child.emit("close", 1, null);
          }
        });
        return taskkill;
      },
      terminationGraceMs: 10,
      terminationRecoveryMs: 100,
      timeoutMs: 1
    }),
    /timed out waiting for harness test child to exit/
  );

  assert.deepEqual(
    taskkillCalls.map(({ command, args, options }) => ({ command, args, options })),
    [
      {
        command: "taskkill.exe",
        args: ["/PID", "515151", "/T"],
        options: { shell: false, stdio: "ignore", windowsHide: true }
      },
      {
        command: "taskkill.exe",
        args: ["/PID", "515151", "/T", "/F"],
        options: { shell: false, stdio: "ignore", windowsHide: true }
      }
    ]
  );
  assert.equal(ownedDescendantAlive, false, "owned descendant survived tree kill");
  assert.equal(child.killCalls.length, 0, "direct-child signalling bypassed tree ownership");
});

test("Windows tree termination failure exhausts recovery without reporting cleanup success", async () => {
  const child = createFakeChild(616_161);

  await assert.rejects(
    collectChildResult(child, {
      ownsProcessGroup: false,
      platform: "win32",
      spawnProcess() {
        const taskkill = new EventEmitter();
        setImmediate(() => taskkill.emit("close", 1, null));
        return taskkill;
      },
      terminationGraceMs: 5,
      terminationRecoveryMs: 20,
      timeoutMs: 1
    }),
    /timed out waiting for harness test child process tree to terminate/
  );
});

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
      detached: process.platform !== "win32",
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const childResultPromise = collectChildResult(child, {
    ownsProcessGroup: process.platform !== "win32"
  });

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

function collectChildResult(
  child,
  {
    onTimeoutArmed = () => {},
    ownsProcessGroup = false,
    platform = process.platform,
    processKill = process.kill,
    spawnProcess = spawn,
    terminationGraceMs = 500,
    terminationRecoveryMs = 1_000,
    timeoutStartPromise,
    timeoutMs = 20_000
  } = {}
) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let childClosed = false;
    let recoveryTimer;
    let settled = false;
    let timedOut = false;
    let timeout;
    let timeoutArmed = false;
    const armTimeout = () => {
      if (settled || timeoutArmed) {
        return;
      }
      timeoutArmed = true;
      onTimeoutArmed();
      timeout = setTimeout(handleTimeout, timeoutMs);
    };

    function handleTimeout() {
      timedOut = true;
      const forceKillAt = Date.now() + terminationGraceMs;
      const recoveryDeadline = forceKillAt + terminationRecoveryMs;
      let forceKillSent = false;
      let treeTerminationConfirmed = false;
      const usesWindowsTreeKill = platform === "win32" && !ownsProcessGroup;

      if (usesWindowsTreeKill) {
        runWindowsTreeKill(false);
      } else {
        signalOwnedChild(child, "SIGTERM", ownsProcessGroup, processKill);
      }

      const recover = () => {
        if (
          (usesWindowsTreeKill && treeTerminationConfirmed && childClosed) ||
          (ownsProcessGroup &&
            !isOwnedChildAlive(child, ownsProcessGroup, processKill))
        ) {
          settle(
            reject,
            new Error("timed out waiting for harness test child to exit")
          );
          return;
        }

        if (!forceKillSent && Date.now() >= forceKillAt) {
          forceKillSent = true;
          if (usesWindowsTreeKill) {
            runWindowsTreeKill(true);
          } else {
            signalOwnedChild(child, "SIGKILL", ownsProcessGroup, processKill);
          }
        }

        if (Date.now() >= recoveryDeadline) {
          settle(
            reject,
            new Error(
              "timed out waiting for harness test child process tree to terminate"
            )
          );
          return;
        }

        recoveryTimer = setTimeout(recover, 10);
      };

      function runWindowsTreeKill(force) {
        let taskkill;
        try {
          taskkill = spawnProcess(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
            { shell: false, stdio: "ignore", windowsHide: true }
          );
        } catch {
          return;
        }

        taskkill.once("error", () => {
          // A failed tree-kill attempt is retried with force or fails closed.
        });
        taskkill.once("close", code => {
          if (code === 0) {
            treeTerminationConfirmed = true;
          }
        });
      }

      recover();
    }

    if (timeoutStartPromise) {
      void timeoutStartPromise.then(armTimeout, error => settle(reject, error));
    } else {
      armTimeout();
    }

    function settle(settler, value) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearTimeout(recoveryTimer);
      settler(value);
    }

    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.once("error", error => {
      if (!timedOut) {
        settle(reject, error);
      }
    });
    child.once("close", (code, signal) => {
      childClosed = true;
      if (!timedOut) {
        settle(resolve, { code, signal, stdout, stderr });
      }
    });
  });
}

function signalOwnedChild(child, signal, ownsProcessGroup, processKill = process.kill) {
  try {
    if (ownsProcessGroup) {
      processKill(-child.pid, signal);
      return true;
    }
    return child.kill(signal);
  } catch (error) {
    if (error.code === "ESRCH") {
      return false;
    }
    if (error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function isOwnedChildAlive(child, ownsProcessGroup, processKill = process.kill) {
  try {
    processKill(ownsProcessGroup ? -child.pid : child.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") {
      return false;
    }
    if (error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function createFakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.kill = signal => {
    child.killCalls.push(signal);
    return true;
  };
  return child;
}
