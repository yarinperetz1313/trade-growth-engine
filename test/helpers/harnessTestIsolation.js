const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ownedDirectories = new Set();
const handledSignals = ["SIGINT", "SIGTERM"];
const signalHandlers = new Map(
  handledSignals.map(signal => [signal, () => handleSignal(signal)])
);
let handlersInstalled = false;
let handlingSignal = false;

function isolatedGitEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides };

  for (const key of Object.keys(environment)) {
    if (/^GIT_/i.test(key)) {
      delete environment[key];
    }
  }

  return environment;
}

function createOwnedTempDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  ownedDirectories.add(directory);
  installSignalHandlers();
  return directory;
}

function cleanupOwnedDirectory(directory) {
  if (!ownedDirectories.has(directory)) {
    return;
  }

  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } finally {
    ownedDirectories.delete(directory);
    if (ownedDirectories.size === 0) {
      removeSignalHandlers();
    }
  }
}

function installSignalHandlers() {
  if (handlersInstalled) {
    return;
  }

  for (const [signal, handler] of signalHandlers) {
    process.on(signal, handler);
  }
  handlersInstalled = true;
}

function removeSignalHandlers() {
  if (!handlersInstalled) {
    return;
  }

  for (const [signal, handler] of signalHandlers) {
    process.removeListener(signal, handler);
  }
  handlersInstalled = false;
}

function handleSignal(signal) {
  if (handlingSignal) {
    return;
  }
  handlingSignal = true;

  try {
    for (const directory of [...ownedDirectories].reverse()) {
      try {
        cleanupOwnedDirectory(directory);
      } catch {
        // Cleanup failure must not replace or delay the terminating signal.
      }
    }
  } finally {
    removeSignalHandlers();
    handlingSignal = false;
    process.kill(process.pid, signal);
  }
}

module.exports = {
  cleanupOwnedDirectory,
  createOwnedTempDirectory,
  isolatedGitEnvironment
};
