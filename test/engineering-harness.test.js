const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");

test("engineering harness gate passes for the repository contract", () => {
  const result = runHarness();

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("engineering harness gate rejects removal of every Pilot Readiness contract rule", () => {
  const contractRemovals = [
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
      expected: "PR-0 is COMPLETE",
      error: /Pilot plan must mark PR-0 complete/
    },
    {
      relativePath: "docs/execution-plans/active/pilot-readiness.md",
      expected: "PR-1 is NOT STARTED and is next",
      error: /Pilot plan must name PR-1 as next and not started/
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
      expected: "**PR-4 is blocked**",
      error: /Auth0 magic-link pre-PR-4 blocker/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "mobile/email-client behavior",
      error: /Auth0 magic-link pre-PR-4 blocker/
    },
    {
      relativePath: "docs/architecture/PILOT_READINESS_FOUNDATION.md",
      expected: "callback/redirect allowlists",
      error: /Auth0 magic-link pre-PR-4 blocker/
    }
  ];

  for (const contractRemoval of contractRemovals) {
    const filePath = path.join(repositoryRoot, contractRemoval.relativePath);
    const originalContents = fs.readFileSync(filePath, "utf8");

    try {
      fs.writeFileSync(
        filePath,
        originalContents.replaceAll(contractRemoval.expected, "REMOVED BY TEST")
      );

      const result = runHarness();

      assert.notEqual(result.status, 0, contractRemoval.relativePath);
      assert.match(result.stderr, contractRemoval.error);
    } finally {
      fs.writeFileSync(filePath, originalContents);
    }
  }
});

test("engineering harness gate rejects an untracked machine path", () => {
  const fixturePath = path.join(
    repositoryRoot,
    "test",
    ".tmp-untracked-machine-path.mjs"
  );

  const machinePath = ["", "Users", "example", "project"].join("/");
  fs.writeFileSync(
    fixturePath,
    `export const developerPath = ${JSON.stringify(machinePath)};\n`
  );

  try {
    const result = runHarness();

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /developer-machine absolute path found in test\/\.tmp-untracked-machine-path\.mjs/
    );
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
});

test("engineering harness gate rejects tracked CI artifact output", () => {
  const artifactsDirectory = path.join(repositoryRoot, "test-artifacts");
  const artifactsDirectoryExisted = fs.existsSync(artifactsDirectory);
  const temporaryIndexDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tge-harness-index-")
  );
  const temporaryIndexPath = path.join(temporaryIndexDir, "index");
  const gitIndexPath = gitPath("index");
  const artifactFileName = `.tmp-harness-fixture-${randomUUID()}.txt`;
  const artifactPath = path.join(artifactsDirectory, artifactFileName);
  const artifactRelativePath = path.posix.join(
    "test-artifacts",
    artifactFileName
  );

  try {
    fs.mkdirSync(artifactsDirectory, { recursive: true });
    fs.writeFileSync(artifactPath, "fixture\n");
    fs.copyFileSync(gitIndexPath, temporaryIndexPath);

    const addResult = runGit(
      ["add", "--force", "--", artifactRelativePath],
      { GIT_INDEX_FILE: temporaryIndexPath }
    );
    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);

    const result = runHarness({ GIT_INDEX_FILE: temporaryIndexPath });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /tracked runtime\/generated output: test-artifacts\/.tmp-harness-fixture-[^.]+\.txt/
    );
  } finally {
    fs.rmSync(artifactPath, { force: true });
    if (!artifactsDirectoryExisted) {
      fs.rmSync(artifactsDirectory, { recursive: true, force: true });
    }
    fs.rmSync(temporaryIndexDir, { recursive: true, force: true });
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

function runHarness(env = {}) {
  return spawnSync(process.execPath, ["scripts/check-engineering-harness.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function gitPath(pathspec) {
  const result = runGit(["rev-parse", "--git-path", pathspec]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return path.resolve(repositoryRoot, result.stdout.trim());
}

function runGit(args, env = {}) {
  return spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}
