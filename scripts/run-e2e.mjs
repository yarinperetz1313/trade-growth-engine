import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import {
  cleanupPlaywrightStore,
  createE2eStore,
  getE2eStoreStateFile,
  seedE2eStore
} from "../test/e2e/tempStoreLifecycle.mjs";

const defaultChildCommand = process.execPath;
const defaultChildArgs = [
  "node_modules/@playwright/test/cli.js",
  "test",
  ...process.argv.slice(2)
];

export async function runE2e(options = {}) {
  const {
    childCommand = defaultChildCommand,
    childArgs = defaultChildArgs,
    cwd = process.cwd(),
    env = process.env,
    stdio = "inherit"
  } = options;

  const storeDir = createE2eStore();
  seedE2eStore(storeDir);

  const childEnv = {
    ...env,
    TGE_E2E_STORE_DIR: storeDir,
    TGE_E2E_STORE_STATE_FILE: getE2eStoreStateFile(),
    OPENSSL_CONF: env.OPENSSL_CONF || "/dev/null"
  };

  let cleaned = false;
  const cleanupOnce = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    cleanupPlaywrightStore({
      config: {
        outputDir: path.join(storeDir, "test-results")
      }
    });
  };

  const removeParentHandlers = installParentCleanupHandlers(cleanupOnce);

  try {
    const child = spawn(childCommand, childArgs, {
      cwd,
      env: childEnv,
      stdio
    });

    const exitResult = once(child, "exit");
    const errorResult = once(child, "error").then(([error]) => {
      throw error;
    });
    const [code, signal] = await Promise.race([exitResult, errorResult]);

    return {
      code: typeof code === "number" ? code : signalToExitCode(signal),
      signal,
      storeDir
    };
  } finally {
    cleanupOnce();
    removeParentHandlers();
  }
}

function signalToExitCode(signal) {
  if (!signal) {
    return 1;
  }

  const signals = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGBUS: 7,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGUSR1: 10,
    SIGSEGV: 11,
    SIGUSR2: 12,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15
  };

  return 128 + (signals[signal] || 0);
}

function installParentCleanupHandlers(cleanup) {
  const handleExit = () => cleanup();
  const handleSignal = signal => {
    cleanup();
    process.exit(signalToExitCode(signal));
  };
  const handleUncaughtException = error => {
    cleanup();
    throw error;
  };
  const handleUnhandledRejection = reason => {
    cleanup();
    throw reason;
  };

  process.once("exit", handleExit);
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  process.once("uncaughtException", handleUncaughtException);
  process.once("unhandledRejection", handleUnhandledRejection);

  return () => {
    process.off("exit", handleExit);
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    process.off("uncaughtException", handleUncaughtException);
    process.off("unhandledRejection", handleUnhandledRejection);
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runE2e();
  process.exitCode = result.code;
}
