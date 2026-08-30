import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertManagedE2eStore } from "./test/e2e/tempStoreLifecycle.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url))
);
const artifactRoot = path.join(repositoryRoot, "test-artifacts");
const apiPort = 3100;
const webPort = 5174;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const storeDir = process.env.TGE_E2E_STORE_DIR;
const artifactDir = process.env.TGE_E2E_ARTIFACT_DIR;

if (!assertManagedE2eStore(storeDir)) {
  throw new Error(
    "Playwright E2E requires a managed TGE_E2E_STORE_DIR. Run npm run test:e2e."
  );
}

const viteCacheDir = path.join(storeDir, "vite-cache");
const outputDir = artifactDir
  ? resolveRunArtifactDir(resolveArtifactRoot(artifactDir))
  : path.join(storeDir, "test-results");

process.env.VITE_API_URL = apiBaseUrl;
process.env.OPENSSL_CONF = process.env.OPENSSL_CONF || "/dev/null";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir,
  use: {
    baseURL: webBaseUrl,
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "node src/index.js",
      url: `${apiBaseUrl}/health`,
      env: {
        ...process.env,
        PORT: String(apiPort),
        LOCAL_STORE_DIR: storeDir,
        OPENSSL_CONF: process.env.OPENSSL_CONF || "/dev/null"
      },
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${webPort}`,
      url: webBaseUrl,
      env: {
        ...process.env,
        VITE_API_URL: apiBaseUrl,
        VITE_CACHE_DIR: viteCacheDir,
        OPENSSL_CONF: process.env.OPENSSL_CONF || "/dev/null"
      },
      reuseExistingServer: false,
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium"
      }
    }
  ]
});

function resolveArtifactRoot(configuredDir) {
  if (path.isAbsolute(configuredDir)) {
    throw new Error(
      "TGE_E2E_ARTIFACT_DIR must be a repository-relative path inside test-artifacts/ (for example test-artifacts/e2e)."
    );
  }

  const resolvedDir = path.resolve(repositoryRoot, configuredDir);
  const relativeToArtifactRoot = path.relative(artifactRoot, resolvedDir);

  if (
    !relativeToArtifactRoot ||
    relativeToArtifactRoot.startsWith("..") ||
    path.isAbsolute(relativeToArtifactRoot)
  ) {
    throw new Error(
      "TGE_E2E_ARTIFACT_DIR must resolve inside test-artifacts/ (for example test-artifacts/e2e)."
    );
  }

  return resolvedDir;
}

function resolveRunArtifactDir(rootDir) {
  return path.join(rootDir, safePathSegment(getRunIdentity()));
}

function getRunIdentity() {
  if (process.env.GITHUB_RUN_ID) {
    return [
      "github",
      process.env.GITHUB_RUN_ID,
      process.env.GITHUB_RUN_ATTEMPT || "1"
    ].join("-");
  }

  if (process.env.TGE_E2E_INVOCATION_ID) {
    return process.env.TGE_E2E_INVOCATION_ID;
  }

  return ["local", process.pid, Date.now()].join("-");
}

function safePathSegment(value) {
  const segment = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!segment || segment === "." || segment === "..") {
    throw new Error("E2E artifact run identity must contain a safe path segment.");
  }

  return segment;
}
