import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFile("package.json"));
const failures = [];
const documentedFiles = [
  "AGENTS.md",
  "test/AGENTS.md",
  "docs/ENGINEERING_HARNESS.md",
  "docs/PROJECT_STATE.md",
  "docs/execution-plans/README.md",
  "docs/execution-plans/TEMPLATE.md"
];

for (const filePath of documentedFiles) {
  validateDocumentation(filePath);
}

const trackedFiles = listTrackedFiles();
validateNoTrackedRuntimeOutput(trackedFiles);
validateNoMachinePaths(listMachinePathCheckFiles(trackedFiles));
validateOfflineIntelligence();
validateE2eContract();
validateDatabaseFoundationContract();
validatePilotReadinessContract();

if (failures.length > 0) {
  console.error("Engineering harness check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Engineering harness check passed.");
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function validateDocumentation(relativePath) {
  const contents = readFile(relativePath);
  const sourceDir = path.dirname(path.join(rootDir, relativePath));
  const linkPattern = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const commandPattern = /`npm run ([\w:-]+)(?:\s[^`]*)?`/g;

  for (const match of contents.matchAll(linkPattern)) {
    const target = match[1].replace(/^<|>$/g, "").split(/[?#]/, 1)[0];
    if (!target || target.startsWith("/") || /^[a-z][a-z+.-]*:/i.test(target)) {
      continue;
    }

    const resolvedTarget = path.resolve(sourceDir, target);
    if (!resolvedTarget.startsWith(`${rootDir}${path.sep}`) && resolvedTarget !== rootDir) {
      failures.push(`${relativePath} links outside the repository: ${target}`);
    } else if (!fs.existsSync(resolvedTarget)) {
      failures.push(`${relativePath} has a missing local link: ${target}`);
    }
  }

  for (const match of contents.matchAll(commandPattern)) {
    const scriptName = match[1];
    if (!packageJson.scripts[scriptName]) {
      failures.push(`${relativePath} references missing npm script: ${scriptName}`);
    }
  }
}

function listTrackedFiles() {
  return listGitFiles(["ls-files", "-z"]);
}

function listMachinePathCheckFiles(trackedFiles) {
  const untrackedFiles = listGitFiles([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z"
  ]);

  return [...new Set([...trackedFiles, ...untrackedFiles])].filter(filePath =>
    /\.(?:[cm]?js|json|md|ya?ml)$/.test(filePath)
  );
}

function listGitFiles(args) {
  const output = execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8"
  });
  return output.split("\0").filter(Boolean);
}

function validateNoTrackedRuntimeOutput(trackedFiles) {
  const runtimePrefixes = [
    "data/",
    "test-results/",
    "playwright-report/",
    "blob-report/",
    "artifacts/",
    "test-artifacts/"
  ];
  const offenders = trackedFiles.filter(filePath =>
    runtimePrefixes.some(prefix => filePath.startsWith(prefix))
  );

  if (offenders.length > 0) {
    failures.push(`tracked runtime/generated output: ${offenders.join(", ")}`);
  }
}

function validateNoMachinePaths(filesToCheck) {
  const machinePath = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/;

  for (const filePath of filesToCheck) {
    if (machinePath.test(readFile(filePath))) {
      failures.push(`developer-machine absolute path found in ${filePath}`);
    }
  }
}

function validateOfflineIntelligence() {
  const intelligenceDir = path.join(rootDir, "src/intelligence");
  const sourceFiles = fs
    .readdirSync(intelligenceDir)
    .filter(fileName => fileName.endsWith(".js"))
    .map(fileName => path.join("src/intelligence", fileName));
  const webDependency = /(?:from\s*["'](?:axios|openai|http|https|node:http|node:https)["']|require\(\s*["'](?:axios|openai|http|https|node:http|node:https)["']\s*\)|\bfetch\s*\()/;

  for (const filePath of sourceFiles) {
    if (webDependency.test(readFile(filePath))) {
      failures.push(`deterministic intelligence must not use web access: ${filePath}`);
    }
  }
}

function validateE2eContract() {
  const runner = readFile("scripts/run-e2e.mjs");
  const playwrightConfig = readFile("playwright.config.mjs");
  const lifecycle = readFile("test/e2e/tempStoreLifecycle.mjs");
  const workflow = readFile(".github/workflows/verify.yml");

  requireText(runner, "createE2eStore()", "E2E runner must create a managed store");
  requireText(runner, "seedE2eStore(storeDir)", "E2E runner must seed its managed store");
  requireText(runner, "cleanupOnce()", "E2E runner must clean its managed store");
  requireText(
    playwrightConfig,
    "LOCAL_STORE_DIR: storeDir",
    "Playwright must inject the managed store as LOCAL_STORE_DIR"
  );
  requireText(
    playwrightConfig,
    "fullyParallel: false",
    "Playwright must remain serial for fixed-port E2E"
  );
  requireText(playwrightConfig, "workers: 1", "Playwright must use one worker");
  requireText(
    playwrightConfig,
    "TGE_E2E_ARTIFACT_DIR",
    "Playwright must support a CI failure-evidence directory"
  );
  requireText(
    workflow,
    "actions/upload-artifact@v4",
    "CI must upload Playwright failure evidence"
  );
  requireText(
    lifecycle,
    'writeCollection(storeDir, "revenue_actions", [])',
    "E2E seed must include empty revenue_actions"
  );
}

function validateDatabaseFoundationContract() {
  const workflow = readFile(".github/workflows/verify.yml");
  const compose = readFile("compose.test.yml");
  const runner = readFile("scripts/migrate-db.mjs");
  const runnerPolicy = readFile("scripts/migration-runner-policy.mjs");
  const databaseTest = readFile("test/database/postgres-foundation.test.js");
  const initialMigration = readFile("database/migrations/001_initial_schema.sql");
  const tenantMigration = readFile("database/migrations/002_tenant_domain_schema.sql");
  const securityMigration = readFile("database/migrations/003_roles_rls_and_grants.sql");
  const functionDefaultsMigration = readFile(
    "database/migrations/004_global_function_default_privileges.sql"
  );
  const taskStatusMigration = readFile(
    "database/migrations/005_task_in_progress_status.sql"
  );
  const runtimeIntegrityMigration = readFile(
    "database/migrations/006_runtime_revenue_action_integrity.sql"
  );
  const migrationFiles = fs
    .readdirSync(path.join(rootDir, "database", "migrations"))
    .filter(fileName => /^\d{3}_[a-z0-9_]+\.sql$/.test(fileName))
    .sort();

  requireText(
    packageJson.scripts.verify,
    "npm run test:db",
    "Full verification must include the real PostgreSQL database gate"
  );
  requireText(
    packageJson.scripts["test:db"] || "",
    "test/database/*.test.js",
    "test:db must use the built-in Node runner for database tests"
  );
  requireText(
    packageJson.scripts["db:migrate"] || "",
    "scripts/migrate-db.mjs",
    "db:migrate must use the append-only migration runner"
  );
  requireText(
    workflow,
    "image: postgres:16.15",
    "CI must pin the PostgreSQL 16.15 service image"
  );
  requireText(
    workflow,
    "TGE_TEST_DATABASE_URL:",
    "CI must provide the isolated database-test URL"
  );
  requireText(
    compose,
    "image: postgres:16.15",
    "Local database tests must use the same pinned PostgreSQL image as CI"
  );
  requireText(
    runner,
    "checksum drift",
    "Migration runner must refuse checksum drift"
  );
  requireText(
    runner,
    "schema_migrations",
    "Migration runner must maintain a migration ledger"
  );
  requireText(
    runnerPolicy,
    "Audited baseline required: migration 001 is unapplied",
    "Migration runner must refuse an implicit 001 baseline"
  );
  requireText(
    runnerPolicy,
    "set local role ${role}",
    "Post-bootstrap migrations must execute under the owner role"
  );
  requireText(
    tenantMigration,
    "set local role tge_owner",
    "Migration 002 must create application objects under tge_owner"
  );
  requireText(
    securityMigration,
    "set local role tge_owner",
    "Migration 003 must execute under tge_owner"
  );
  requireText(
    functionDefaultsMigration,
    "alter default privileges for role tge_owner",
    "Migration 004 must secure tge_owner function defaults"
  );
  requireText(
    functionDefaultsMigration,
    "revoke execute on functions from public",
    "Migration 004 must revoke PUBLIC execute from future functions"
  );
  requireText(
    taskStatusMigration,
    "'IN_PROGRESS'",
    "Migration 005 must preserve the existing IN_PROGRESS task status"
  );
  requireText(
    databaseTest,
    "TGE_TEST_DATABASE_URL",
    "Database tests must require an explicit real PostgreSQL URL"
  );

  if (
    createHash("sha256").update(initialMigration).digest("hex")
    !== "d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62"
  ) {
    failures.push("database migration 001 must remain byte-for-byte unchanged");
  }

  if (
    JSON.stringify(migrationFiles)
    !== JSON.stringify([
      "001_initial_schema.sql",
      "002_tenant_domain_schema.sql",
      "003_roles_rls_and_grants.sql",
      "004_global_function_default_privileges.sql",
      "005_task_in_progress_status.sql",
      "006_runtime_revenue_action_integrity.sql"
    ])
  ) {
    failures.push(
      `Pilot migration sequence drift: ${migrationFiles.join(", ")}`
    );
  }

  requireText(
    runtimeIntegrityMigration,
    "RevenueAction audit history is append-only.",
    "Migration 006 must protect append-only RevenueAction audit history"
  );
  requireText(
    runtimeIntegrityMigration,
    "current_payload jsonb",
    "Migration 006 must separate mutable record shape from legacy evidence"
  );
  requireText(
    runtimeIntegrityMigration,
    "live_ordinal bigint",
    "Migration 006 must persist deterministic live insertion order"
  );
  if (/security\s+definer/i.test(runtimeIntegrityMigration)) {
    failures.push("Migration 006 must not add SECURITY DEFINER functions");
  }
}

function validatePilotReadinessContract() {
  const planPath = "docs/execution-plans/active/pilot-readiness.md";
  const executionPlansIndexPath = "docs/execution-plans/README.md";
  const foundationPath = "docs/architecture/PILOT_READINESS_FOUNDATION.md";
  const productionGatePath = "docs/operations/PILOT_PRODUCTION_GATE.md";
  const plan = readFile(planPath);
  const executionPlansIndex = readFile(executionPlansIndexPath);
  const foundation = readFile(foundationPath);
  const productionGate = readFile(productionGatePath);

  requireText(
    executionPlansIndex,
    "[\`active/pilot-readiness.md\`](active/pilot-readiness.md)",
    "Execution-plan index must link the active Pilot Readiness plan"
  );
  requireText(
    executionPlansIndex,
    "PR-0 is COMPLETE",
    "Execution-plan index must mark Pilot PR-0 complete"
  );
  requireText(
    executionPlansIndex,
    "PR-1 is COMPLETE",
    "Execution-plan index must mark Pilot PR-1 complete"
  );
  requireText(
    executionPlansIndex,
    "PR-2 is COMPLETE",
    "Execution-plan index must mark Pilot PR-2 complete"
  );
  requireText(
    executionPlansIndex,
    "PR-3 is NEXT and NOT STARTED",
    "Execution-plan index must mark Pilot PR-3 next and not started"
  );
  requireText(
    plan,
    "[foundation](../../architecture/PILOT_READINESS_FOUNDATION.md)",
    "Pilot plan must link the canonical readiness foundation"
  );
  requireText(
    plan,
    "[production gate](../../operations/PILOT_PRODUCTION_GATE.md)",
    "Pilot plan must link the canonical production gate"
  );
  requireText(plan, "PR-0 is COMPLETE", "Pilot plan must mark PR-0 complete");
  requireText(
    plan,
    "PR-1 is COMPLETE",
    "Pilot plan must mark PR-1 complete"
  );
  requireText(
    plan,
    "PR-2 — COMPLETE",
    "Pilot plan must mark PR-2 complete"
  );
  requireText(
    plan,
    "PR-3 — NEXT, NOT STARTED",
    "Pilot plan must mark PR-3 next and not started"
  );

  const canonicalDocuments = {
    foundation: { path: foundationPath, contents: foundation },
    productionGate: { path: productionGatePath, contents: productionGate }
  };

  const pilotReadinessRules = [
    {
      name: "Melbourne Cloud Run and Cloud SQL topology",
      document: "foundation",
      requirements: [
        "Cloud Run + Cloud SQL PostgreSQL in australia-southeast2 (Melbourne)",
        "Sydney is allowed only as a written, approved exception."
      ]
    },
    {
      name: "Auth0 AU identity with TGE-owned authorization",
      document: "foundation",
      requirements: [
        "Auth0 Australia (AU) provides magic-link **identity**",
        "TGE remains the authorization authority."
      ]
    },
    {
      name: "server-resolved TenantContext",
      document: "foundation",
      requirements: [
        "resolves `TenantContext` from server-side membership",
        "never accepts a client-supplied tenant ID as authority"
      ]
    },
    {
      name: "tenant roles and layered isolation",
      document: "foundation",
      requirements: [
        "| OWNER |",
        "| ADMIN |",
        "| MEMBER |",
        "PostgreSQL RLS is applied transaction-locally",
        "runtime database role is nonprivileged",
        "server-only migration/operations role",
        "Server authorization, RLS, and cross-tenant negative tests are all required"
      ]
    },
    {
      name: "Cloud Run and Cloud SQL production persistence target",
      document: "foundation",
      requirements: ["**Supabase is not the production Pilot target.**"]
    },
    {
      name: "append-only one-way JSON cutover without dual write",
      document: "foundation",
      requirements: [
        "append-only migrations",
        "one-way, verified legacy JSON snapshot cutover",
        "there is no dual write"
      ]
    },
    {
      name: "staged tenant-scoped import safety",
      document: "foundation",
      requirements: [
        "Imports are tenant-scoped and staged: CSV/XLSX upload → preview → explicit commit.",
        "Exact duplicates are skipped",
        "ambiguous records require explicit user resolution",
        "never merge into or overwrite existing CRM data implicitly"
      ]
    },
    {
      name: "audit and import retention",
      document: "foundation",
      requirements: ["12 months", "raw files for **7 days**, then delete them"]
    },
    {
      name: "Melbourne backup and tenant-recovery objectives",
      document: "foundation",
      requirements: [
        "Australian **regional** Cloud SQL backup location explicitly",
        "14 daily backups",
        "RPO <= 24 hours",
        "RTO <= 4 business hours",
        "full database into a temporary Australian instance, logically exporting the affected tenant, and restoring that export"
      ]
    },
    {
      name: "vendor and provisioning gates",
      document: "productionGate",
      requirements: [
        "Cloudflare Pages is recommended, subject to static-host vendor/privacy approval.",
        "approve the production domain/registrar",
        "custom transactional SMTP, SPF, DKIM, and DMARC",
        "confirm AU tenancy, selected plan, magic-link/custom-domain capabilities",
        "complete privacy/DPA review for every selected vendor"
      ]
    },
    {
      name: "Auth0 magic-link pre-PR-4 blocker",
      document: "foundation",
      requirements: [
        "**PR-4 is blocked**",
        "Auth0 AU plan supports passwordless magic links",
        "Classic Login with same-browser/device completion",
        "mobile/email-client behavior",
        "callback/redirect allowlists",
        "phishing/resend/session protections",
        "deterministic E2E acceptance test",
        "There is no implicit OTP fallback."
      ]
    }
  ];

  for (const rule of pilotReadinessRules) {
    const document = canonicalDocuments[rule.document];
    for (const expected of rule.requirements) {
      requireText(
        document.contents,
        expected,
        `Pilot Readiness contract drift (${rule.name}): ${document.path} must retain ${JSON.stringify(expected)}`
      );
    }
  }
}

function requireText(contents, expected, message) {
  if (!contents.includes(expected)) {
    failures.push(message);
  }
}
