import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { assertManagedE2eStore } from "./test/e2e/tempStoreLifecycle.mjs";

const apiPort = 3100;
const webPort = 5174;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const storeDir = process.env.TGE_E2E_STORE_DIR;

if (!assertManagedE2eStore(storeDir)) {
  throw new Error(
    "Playwright E2E requires a managed TGE_E2E_STORE_DIR. Run npm run test:e2e."
  );
}

const viteCacheDir = path.join(storeDir, "vite-cache");

process.env.VITE_API_URL = apiBaseUrl;
process.env.OPENSSL_CONF = process.env.OPENSSL_CONF || "/dev/null";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: path.join(storeDir, "test-results"),
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
