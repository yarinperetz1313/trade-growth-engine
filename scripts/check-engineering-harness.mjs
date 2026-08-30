import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
    "PR-2 — NOT STARTED (next)",
    "Pilot plan must name PR-2 as next and not started"
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
