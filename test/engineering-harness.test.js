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
