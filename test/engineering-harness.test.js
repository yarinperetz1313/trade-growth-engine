const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  cleanupOwnedDirectory,
  createOwnedTempDirectory,
  isolatedGitEnvironment
} = require("./helpers/harnessTestIsolation");

const repositoryRoot = path.resolve(__dirname, "..");

test("engineering harness gate passes for the repository contract", () => {
  const result = runHarness();

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("engineering harness gate rejects removal of every Pilot Readiness contract rule", async () => {
  let fixtureRoot;
  let signalMarkerDirectory;
  const contractRemovals = [
    {
      relativePath: "docs/execution-plans/README.md",
      expected: "PR-0 through PR-2 are COMPLETE",
      error: /Execution-plan index must mark Pilot PR-0 through PR-2 complete/
    },
    {
      relativePath: "docs/execution-plans/README.md",
      expected: "PR-3 and PR-4 are integrated in code",
      error: /Execution-plan index must mark Pilot PR-3 and PR-4 integrated/
    },
    {
      relativePath: "docs/execution-plans/active/pilot-readiness.md",
      expected: "[foundation](../../architecture/PILOT_READINESS_FOUNDATION.md)",
      error: /Pilot plan must link the canonical readiness foundation/
    },
    {
      relativePath: "docs/execution-plans/active/pilot-readiness.md",
      expected: "[production gate](../../operations/PILOT_PRODUCTION_GATE.md)",
      error: /Pilot plan must link the canonical production gate/
    },
    {
      relativePath: "docs/execution-plans/active/pilot-readiness.md",
      expected: "PR-0 through PR-2 are COMPLETE",
      error: /Pilot plan must mark PR-0 through PR-2 complete/
    },
    {
      relativePath: "docs/execution-plans/active/pilot-readiness.md",
      expected: "PR-3 — persistence implemented and integrated",
      error: /Pilot plan must mark PR-3 persistence integrated/
    },
    {
      relativePath: "docs/execution-plans/active/pilot-readiness.md",
      expected: "PR-4 — auth implemented and integrated",
      error: /Pilot plan must mark PR-4 auth integrated/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "Cloud Run + Cloud SQL PostgreSQL in australia-southeast2 (Melbourne)",
      error: /Melbourne Cloud Run and Cloud SQL topology/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "TGE remains the authorization authority.",
      error: /Auth0 AU identity with TGE-owned authorization/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "never accepts a client-supplied tenant ID as authority",
      error: /server-resolved TenantContext/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "Server authorization, RLS, and cross-tenant negative tests are all required",
      error: /tenant roles and layered isolation/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "**Supabase is not the production Pilot target.**",
      error: /Cloud Run and Cloud SQL production persistence target/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "there is no dual write",
      error: /append-only one-way JSON cutover without dual write/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "ambiguous records require explicit user resolution",
      error: /staged tenant-scoped import safety/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "Store audit events and import metadata for **12 months**.",
      error: /audit and import retention/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "RTO <= 4 business hours",
      error: /Melbourne backup and tenant-recovery objectives/
    },
    {
      relativePath: "docs/operations/PILOT_PRODUCTION_GATE.md",
      expected: "complete privacy/DPA review for every selected vendor",
      error: /vendor and provisioning gates/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "prior magic-link decision gate is resolved",
      error: /Auth0 email-OTP PR-4 decision and deployment gate/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "Classic Login, magic links",
      error: /Auth0 email-OTP PR-4 decision and deployment gate/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "exact callback/logout/origin configuration",
      error: /Auth0 email-OTP PR-4 decision and deployment gate/
    },
    {
      relativePath: "package.json",
      expected: "npm run test:db",
      error: /Full verification must include the real PostgreSQL database gate/
    },
    {
      relativePath: ".github/workflows/verify.yml",
      expected: "image: postgres:16.15",
      error: /CI must pin the PostgreSQL 16\.15 service image/
    },
    {
      relativePath: "database/migrations/001_initial_schema.sql",
      expected: "create extension if not exists pgcrypto;",
      error: /database migration 001 must remain byte-for-byte unchanged/
    },
    {
      relativePath: "src/auth/authentication.js",
      expected: 'algorithms: ["RS256"]',
      error: /Auth0 tokens must pin RS256/
    },
    {
      relativePath: "web/lib/auth.js",
      expected: 'cacheLocation: "memory"',
      error: /Browser token storage must remain memory-only/
    },
    {
      relativePath: "database/migrations/010_auth_membership_and_invitations.sql",
      expected: "create function tge.consume_assisted_invitation",
      error: /Migration 010 must provide atomic invitation consumption/
    },
    {
      relativePath: "database/migrations/011_canonical_import_commit.sql",
      expected: "create function tge.finalize_import_commit",
      error: /Migration 011 must provide narrow canonical import finalization/
    },
    {
      relativePath: "database/migrations/012_revenue_leak_case_foundation.sql",
      expected: "RevenueLeakCase detection evidence is immutable.",
      error: /Migration 012 must protect immutable RevenueLeakCase evidence/
    },
    {
      relativePath: "database/migrations/013_privacy_minimized_pilot_evidence.sql",
      expected: "Pilot evidence is append-only.",
      error: /Migration 013 must protect append-only pilot evidence/
    }
  ];
  const requestedContractPath =
    process.env.TGE_HARNESS_TEST_CONTRACT_PATH;
  const removalsToTest = requestedContractPath
    ? contractRemovals.filter(
        contractRemoval => contractRemoval.relativePath === requestedContractPath
      )
    : contractRemovals;

  if (requestedContractPath) {
    assert.equal(
      removalsToTest.length,
      1,
      `unknown harness contract fixture: ${requestedContractPath}`
    );
  }

  try {
    await waitForTestReadinessRelease();
    fixtureRoot = createHarnessFixture();
    const signalManifestPath =
      process.env.TGE_HARNESS_TEST_SIGNAL_MANIFEST_PATH;
    if (signalManifestPath) {
      signalMarkerDirectory = createOwnedTempDirectory("tge-harness-marker-");
      const unrelatedSignalListenerPath =
        process.env.TGE_HARNESS_TEST_UNRELATED_SIGNAL_LISTENER_PATH;
      if (unrelatedSignalListenerPath) {
        for (const signal of ["SIGINT", "SIGTERM"]) {
          process.on(signal, () => {
            fs.appendFileSync(unrelatedSignalListenerPath, `${signal}\n`);
          });
        }
      }
      const descendantHeartbeatPath = process.env.TGE_HARNESS_TEST_TIMEOUT_DESCENDANT
        ? `${signalManifestPath}.descendant-heartbeat`
        : null;
      const descendant = descendantHeartbeatPath
        ? spawn(
            process.execPath,
            [
              "--eval",
              'const fs = require("node:fs"); const heartbeat = process.argv[1]; fs.appendFileSync(heartbeat, "."); setInterval(() => fs.appendFileSync(heartbeat, "."), 20);',
              descendantHeartbeatPath
            ],
            { stdio: "ignore" }
          )
        : null;
      fs.writeFileSync(
        signalManifestPath,
        `${JSON.stringify({
          descendantHeartbeatPath,
          descendantPid: descendant?.pid,
          fixtureRoot,
          markerDirectory: signalMarkerDirectory
        })}\n`
      );
      await new Promise(() => {
        setInterval(() => {}, 1_000);
      });
    }

    for (const contractRemoval of removalsToTest) {
      const filePath = path.join(fixtureRoot, contractRemoval.relativePath);
      const originalContents = fs.readFileSync(filePath, "utf8");

      fs.writeFileSync(
        filePath,
        originalContents.replaceAll(contractRemoval.expected, "REMOVED BY TEST")
      );
      try {
        await waitForConcurrentMutationObserver(contractRemoval.relativePath);

        const result = runHarness({}, fixtureRoot);

        assert.notEqual(result.status, 0, contractRemoval.relativePath);
        assert.match(result.stderr, contractRemoval.error);
      } finally {
        fs.writeFileSync(filePath, originalContents);
      }
    }
  } finally {
    if (signalMarkerDirectory) {
      cleanupOwnedDirectory(signalMarkerDirectory);
    }
    if (fixtureRoot) {
      cleanupOwnedDirectory(fixtureRoot);
    }
  }
});

async function waitForTestReadinessRelease() {
  const releaseFd = process.env.TGE_HARNESS_TEST_READINESS_RELEASE_FD;
  const waitingPath = process.env.TGE_HARNESS_TEST_READINESS_WAITING_PATH;

  if (!releaseFd && !waitingPath) {
    return;
  }

  assert.ok(releaseFd && waitingPath, "readiness delay requires a pipe and marker");
  const descriptor = Number(releaseFd);
  assert.ok(
    Number.isInteger(descriptor) && descriptor >= 3,
    "readiness delay requires an inherited pipe descriptor"
  );
  fs.writeFileSync(waitingPath, "waiting\n");

  await new Promise((resolve, reject) => {
    const releaseStream = fs.createReadStream(null, {
      autoClose: true,
      fd: descriptor
    });
    const timeout = setTimeout(() => {
      releaseStream.destroy();
      reject(new Error("timed out waiting for test readiness release"));
    }, 5_000);

    releaseStream.once("data", () => {
      clearTimeout(timeout);
      releaseStream.destroy();
      resolve();
    });
    releaseStream.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function waitForConcurrentMutationObserver(relativePath) {
  const readyPath = process.env.TGE_HARNESS_TEST_MUTATION_READY_PATH;
  const releasePath = process.env.TGE_HARNESS_TEST_MUTATION_RELEASE_PATH;

  if (!readyPath && !releasePath) {
    return;
  }

  assert.ok(readyPath && releasePath, "mutation observer requires both marker paths");
  fs.writeFileSync(readyPath, `${relativePath}\n`);

  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(releasePath)) {
    assert.ok(Date.now() < deadline, "timed out waiting for mutation observer");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("engineering harness gate rejects an untracked machine path", () => {
  const fixtureRoot = createHarnessFixture();
  const fixturePath = path.join(
    fixtureRoot,
    "test",
    ".tmp-untracked-machine-path.mjs"
  );

  const machinePath = ["", "Users", "example", "project"].join("/");
  fs.writeFileSync(
    fixturePath,
    `export const developerPath = ${JSON.stringify(machinePath)};\n`
  );

  try {
    const result = runHarness({}, fixtureRoot);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /developer-machine absolute path found in test\/\.tmp-untracked-machine-path\.mjs/
    );
  } finally {
    cleanupOwnedDirectory(fixtureRoot);
  }
});

test("engineering harness gate rejects tracked CI artifact output", () => {
  const fixtureRoot = createHarnessFixture();
  const artifactsDirectory = path.join(fixtureRoot, "test-artifacts");
  const artifactFileName = `.tmp-harness-fixture-${randomUUID()}.txt`;
  const artifactPath = path.join(artifactsDirectory, artifactFileName);
  const artifactRelativePath = path.posix.join(
    "test-artifacts",
    artifactFileName
  );

  try {
    fs.mkdirSync(artifactsDirectory, { recursive: true });
    fs.writeFileSync(artifactPath, "fixture\n");

    const addResult = runGit(
      ["add", "--force", "--", artifactRelativePath],
      {},
      fixtureRoot
    );
    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);

    const result = runHarness({}, fixtureRoot);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /tracked runtime\/generated output: test-artifacts\/.tmp-harness-fixture-[^.]+\.txt/
    );
  } finally {
    cleanupOwnedDirectory(fixtureRoot);
  }
});

test("Playwright accepts safe artifact output and rejects unsafe output", async () => {
  const lifecycle = await import("./e2e/tempStoreLifecycle.mjs");
  const storeDir = lifecycle.createE2eStore();

  try {
    const safeResult = loadPlaywrightConfig(storeDir, "test-artifacts/e2e", {
      GITHUB_RUN_ID: "12345",
      GITHUB_RUN_ATTEMPT: "2"
    });
    assert.equal(safeResult.status, 0, safeResult.stderr || safeResult.stdout);
    assert.equal(
      path.relative(repositoryRoot, safeResult.stdout.trim()),
      path.join("test-artifacts", "e2e", "github-12345-2")
    );

    const unsafeArtifactRootResult = loadPlaywrightConfig(storeDir, "test-artifacts");

    assert.notEqual(unsafeArtifactRootResult.status, 0);
    assert.match(
      unsafeArtifactRootResult.stderr,
      /TGE_E2E_ARTIFACT_DIR must resolve inside test-artifacts\//
    );

    const unsafeResult = loadPlaywrightConfig(storeDir, "data");

    assert.notEqual(unsafeResult.status, 0);
    assert.match(
      unsafeResult.stderr,
      /TGE_E2E_ARTIFACT_DIR must resolve inside test-artifacts\//
    );
  } finally {
    lifecycle.cleanupE2eStore(storeDir);
  }
});

function loadPlaywrightConfig(storeDir, artifactDir, env = {}) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'const config = (await import("./playwright.config.mjs")).default; console.log(config.outputDir);'
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        TGE_E2E_STORE_DIR: storeDir,
        TGE_E2E_ARTIFACT_DIR: artifactDir
      }
    }
  );
}

function createHarnessFixture() {
  const fixtureRoot = createOwnedTempDirectory("tge-harness-fixture-");
  try {
    const trackedResult = runGit(["ls-files", "-z"]);
    assert.equal(
      trackedResult.status,
      0,
      trackedResult.stderr || trackedResult.stdout
    );

    for (const relativePath of trackedResult.stdout.split("\0").filter(Boolean)) {
      const sourcePath = path.join(repositoryRoot, relativePath);
      const fixturePath = path.join(fixtureRoot, relativePath);
      const sourceStat = fs.lstatSync(sourcePath);
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });

      if (sourceStat.isSymbolicLink()) {
        fs.symlinkSync(fs.readlinkSync(sourcePath), fixturePath);
      } else {
        fs.copyFileSync(sourcePath, fixturePath);
        fs.chmodSync(fixturePath, sourceStat.mode);
      }
    }

    const initResult = runGit(["init", "--quiet"], {}, fixtureRoot);
    assert.equal(initResult.status, 0, initResult.stderr || initResult.stdout);
    const addResult = runGit(["add", "--force", "--all"], {}, fixtureRoot);
    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);
    return fixtureRoot;
  } catch (error) {
    cleanupOwnedDirectory(fixtureRoot);
    throw error;
  }
}

function runHarness(env = {}, root = repositoryRoot) {
  return spawnSync(process.execPath, ["scripts/check-engineering-harness.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: isolatedGitEnvironment(env)
  });
}

function runGit(args, env = {}, root = repositoryRoot) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: isolatedGitEnvironment(env)
  });
}
