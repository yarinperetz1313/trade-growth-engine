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

function requireText(contents, expected, message) {
  if (!contents.includes(expected)) {
    failures.push(message);
  }
}
