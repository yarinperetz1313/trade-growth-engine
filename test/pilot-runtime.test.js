"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");

const VALID_ENV = Object.freeze({
  PORT: "3000",
  TGE_RUNTIME_DATABASE_URL: "postgresql://runtime:password@db.example.test:5432/tge",
  TGE_PUBLIC_APP_URL: "https://app.example.test",
  TGE_PUBLIC_API_URL: "https://api.example.test",
  TGE_AUTH0_ISSUER: "https://tenant.au.auth0.com/",
  TGE_AUTH0_AUDIENCE: "https://api.example.test",
  TGE_AUTH0_CLIENT_ID: "public-spa-client",
  TGE_AUTH0_CALLBACK_URL: "https://app.example.test/auth/callback",
  TGE_AUTH0_LOGOUT_URL: "https://app.example.test/signed-out"
});

function loadRuntime() {
  return require("../src/pilot/runtime");
}

function fakePool({
  membershipError = null,
  memberships = [],
  readinessError = null,
  readinessRow = {
    schema_version: "014",
    runtime_role_member: true,
    login_nonprivileged: true,
    required_relations_available: true
  }
} = {}) {
  const state = {
    ended: 0,
    membershipQueries: 0,
    readinessQueries: 0,
    released: 0
  };
  const pool = new EventEmitter();
  Object.assign(pool, {
    async connect() {
      return {
        async query(sql) {
          const normalized = String(sql).replace(/\s+/g, " ").trim();
          if (normalized.includes("tge.pilot_runtime_readiness")) {
            state.readinessQueries += 1;
            if (readinessError) throw readinessError;
            return { rows: [readinessRow] };
          }
          if (normalized.includes("from tge.tenant_memberships")) {
            state.membershipQueries += 1;
            if (membershipError) throw membershipError;
            return {
              rows: memberships.map(item => ({
                tenant_id: item.tenantId,
                identity_issuer: item.issuer,
                subject_id: item.subject,
                role: item.role,
                status: item.status
              }))
            };
          }
          return { rows: [] };
        },
        release() {
          state.released += 1;
        }
      };
    },
    async end() {
      state.ended += 1;
    }
  });
  return { pool, state };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function request(server, pathname, options = {}) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, options);
  return { status: response.status, data: await response.json() };
}

test("pilot configuration rejects every absent required value before bootstrap", () => {
  const { PilotConfigurationError, readPilotConfig } = loadRuntime();
  for (const name of Object.keys(VALID_ENV)) {
    const env = { ...VALID_ENV };
    delete env[name];
    assert.throws(
      () => readPilotConfig(env),
      error => error instanceof PilotConfigurationError
        && error.code === "PILOT_CONFIGURATION_INVALID"
        && error.invalidNames.includes(name)
        && !error.message.includes(VALID_ENV[name])
    );
  }
});

test("pilot configuration rejects unsafe URLs, ports, and operator-DSN fallback generically", () => {
  const { readPilotConfig } = loadRuntime();
  const invalid = [
    { PORT: "0" },
    { PORT: "65536" },
    { PORT: "3000.5" },
    { TGE_RUNTIME_DATABASE_URL: "https://db.example.test/tge" },
    { TGE_RUNTIME_DATABASE_URL: " postgresql://runtime:secret@db.example.test/tge" },
    { TGE_PUBLIC_APP_URL: "http://app.example.test" },
    { TGE_PUBLIC_APP_URL: "https://user@app.example.test" },
    { TGE_PUBLIC_API_URL: "https://api.example.test/path" },
    { TGE_AUTH0_ISSUER: "https://tenant.au.auth0.com" },
    { TGE_AUTH0_ISSUER: "https://*.auth0.com/" },
    { TGE_AUTH0_AUDIENCE: " audience" },
    { TGE_AUTH0_CLIENT_ID: "" },
    { TGE_AUTH0_CALLBACK_URL: "https://other.example.test/auth/callback" },
    { TGE_AUTH0_CALLBACK_URL: "https://app.example.test/auth/callback#token" },
    { TGE_AUTH0_LOGOUT_URL: "https://other.example.test/signed-out" }
  ];
  for (const override of invalid) {
    const value = Object.values(override)[0];
    assert.throws(
      () => readPilotConfig({ ...VALID_ENV, ...override }),
      error => error.code === "PILOT_CONFIGURATION_INVALID"
        && error.message === "Pilot runtime configuration is invalid."
        && (String(value).length === 0 || !error.message.includes(String(value)))
        && !JSON.stringify(error.invalidNames).includes("secret")
    );
  }

  assert.throws(
    () => readPilotConfig({
      ...VALID_ENV,
      TGE_RUNTIME_DATABASE_URL: undefined,
      TGE_DATABASE_URL: VALID_ENV.TGE_RUNTIME_DATABASE_URL
    }),
    error => error.invalidNames.includes("TGE_RUNTIME_DATABASE_URL")
  );
});

test("valid pilot configuration is exact, immutable, and derives only the issuer JWKS URL", () => {
  const { readPilotConfig } = loadRuntime();
  const config = readPilotConfig(VALID_ENV);
  assert.equal(Object.isFrozen(config), true);
  assert.deepEqual(config, {
    mode: "pilot",
    port: 3000,
    databaseUrl: VALID_ENV.TGE_RUNTIME_DATABASE_URL,
    publicAppUrl: VALID_ENV.TGE_PUBLIC_APP_URL,
    publicApiUrl: VALID_ENV.TGE_PUBLIC_API_URL,
    auth: {
      issuer: VALID_ENV.TGE_AUTH0_ISSUER,
      audience: VALID_ENV.TGE_AUTH0_AUDIENCE,
      jwksUri: "https://tenant.au.auth0.com/.well-known/jwks.json",
      clientId: VALID_ENV.TGE_AUTH0_CLIENT_ID,
      allowedOrigins: [VALID_ENV.TGE_PUBLIC_APP_URL],
      callbackUrls: [VALID_ENV.TGE_AUTH0_CALLBACK_URL],
      logoutUrls: [VALID_ENV.TGE_AUTH0_LOGOUT_URL]
    }
  });
  assert.equal(Object.isFrozen(config.auth), true);
});

test("invalid pilot configuration rejects before constructing a pool or listener", async () => {
  const { startPilotRuntime } = loadRuntime();
  let pools = 0;
  class PoolMustNotConstruct {
    constructor() {
      pools += 1;
    }
  }
  await assert.rejects(
    startPilotRuntime({ env: {}, PoolClass: PoolMustNotConstruct }),
    error => error.code === "PILOT_CONFIGURATION_INVALID"
  );
  assert.equal(pools, 0);
});

test("pilot bootstrap releases its owned pool when service composition fails", async () => {
  const { startPilotRuntime } = loadRuntime();
  const instances = [];
  class FailingCompositionPool {
    constructor() {
      this.connectReads = 0;
      this.ended = 0;
      instances.push(this);
    }

    get connect() {
      this.connectReads += 1;
      if (this.connectReads > 1) throw new Error("private bootstrap detail");
      return async () => { throw new Error("unused"); };
    }

    async end() {
      this.ended += 1;
    }
  }

  await assert.rejects(
    startPilotRuntime({
      env: VALID_ENV,
      PoolClass: FailingCompositionPool,
      logger: { info() {}, warn() {}, error() {} }
    }),
    /private bootstrap detail/
  );
  assert.equal(instances.length, 1);
  assert.equal(instances[0].ended, 1);
});

test("pilot liveness is separate from secure readiness and all non-config APIs fail closed", async () => {
  const { createPilotRuntime, readPilotConfig } = loadRuntime();
  const originalStore = process.env.LOCAL_STORE_DIR;
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "tge-pilot-no-json-"));
  process.env.LOCAL_STORE_DIR = store;
  const fixture = fakePool({ readinessError: new Error("postgresql://secret customer raw cell") });
  const logs = [];
  const runtime = createPilotRuntime({
    config: readPilotConfig(VALID_ENV),
    pool: fixture.pool,
    poolOwned: true,
    tokenVerifier: { async verify() { throw new Error("token detail"); } },
    logger: { info() {}, warn(code) { logs.push(code); }, error(code) { logs.push(code); } }
  });
  const server = await runtime.listen({ port: 0, autoProbe: false });
  try {
    const live = await request(server, "/health/live");
    assert.equal(live.status, 200);
    assert.equal(live.data.ok, true);
    assert.equal(live.data.status, "live");
    assert.equal(live.data.mode, "pilot");

    const compatibility = await request(server, "/health");
    assert.equal(compatibility.status, 200);
    assert.equal(compatibility.data.readiness, "/health/ready");

    const notReady = await request(server, "/health/ready");
    assert.equal(notReady.status, 503);
    assert.equal(notReady.data.error, "SECURE_RUNTIME_NOT_READY");
    assert.equal(notReady.data.checks.auth, "configured_not_externally_verified");

    const config = await request(server, "/api/auth/config");
    assert.equal(config.status, 200);
    assert.equal(config.data.clientId, VALID_ENV.TGE_AUTH0_CLIENT_ID);

    for (const pathname of [
      "/api/opportunities",
      "/api/import-batches/anything/analysis",
      "/api/revenue-leak-cases/operating-queue",
      "/api/auth/invitations/begin"
    ]) {
      const blocked = await request(server, pathname, {
        method: pathname.endsWith("begin") ? "POST" : "GET",
        headers: { authorization: "Bearer attacker", "x-tenant-id": "attacker" }
      });
      assert.equal(blocked.status, 503);
      assert.deepEqual(blocked.data, {
        ok: false,
        error: "SECURE_RUNTIME_NOT_READY",
        message: "The secure pilot runtime is not ready."
      });
    }

    await runtime.probeReadiness();
    const stillNotReady = await request(server, "/health/ready");
    assert.equal(stillNotReady.status, 503);
    assert.doesNotMatch(JSON.stringify(stillNotReady.data), /secret|customer|raw cell/i);
    assert.deepEqual(logs, ["PILOT_READINESS_CHECK_FAILED"]);
    assert.deepEqual(fs.readdirSync(store), []);
  } finally {
    await runtime.close();
    fs.rmSync(store, { recursive: true, force: true });
    if (originalStore === undefined) delete process.env.LOCAL_STORE_DIR;
    else process.env.LOCAL_STORE_DIR = originalStore;
  }
});

test("secure readiness requires the exact migration marker, runtime role, and membership lookup", async () => {
  const { createPilotRuntime, readPilotConfig } = loadRuntime();
  const fixture = fakePool();
  const runtime = createPilotRuntime({
    config: readPilotConfig(VALID_ENV),
    pool: fixture.pool,
    tokenVerifier: { async verify() { throw new Error("unused"); } },
    logger: { info() {}, warn() {}, error() {} }
  });

  await runtime.probeReadiness();
  assert.equal(runtime.readiness.snapshot().ready, true);
  assert.equal(fixture.state.readinessQueries, 1);
  assert.equal(fixture.state.membershipQueries, 1);

  for (const readinessRow of [
    { schema_version: "013", runtime_role_member: true, login_nonprivileged: true, required_relations_available: true },
    { schema_version: "014", runtime_role_member: false, login_nonprivileged: true, required_relations_available: true },
    { schema_version: "014", runtime_role_member: true, login_nonprivileged: false, required_relations_available: true },
    { schema_version: "014", runtime_role_member: true, login_nonprivileged: true, required_relations_available: false }
  ]) {
    const failedFixture = fakePool({ readinessRow });
    const failed = createPilotRuntime({
      config: readPilotConfig(VALID_ENV),
      pool: failedFixture.pool,
      tokenVerifier: { async verify() { throw new Error("unused"); } },
      logger: { info() {}, warn() {}, error() {} }
    });
    await failed.probeReadiness();
    assert.equal(failed.readiness.snapshot().ready, false);
    assert.equal(failedFixture.state.membershipQueries, 0);
  }

  const membershipFailure = fakePool({ membershipError: new Error("private identity") });
  const failed = createPilotRuntime({
    config: readPilotConfig(VALID_ENV),
    pool: membershipFailure.pool,
    tokenVerifier: { async verify() { throw new Error("unused"); } },
    logger: { info() {}, warn() {}, error() {} }
  });
  await failed.probeReadiness();
  assert.equal(failed.readiness.snapshot().ready, false);
});

test("owned pool errors fail readiness closed and expose only a normalized lifecycle code", async () => {
  const { createPilotRuntime, readPilotConfig } = loadRuntime();
  const fixture = fakePool();
  const logs = [];
  const runtime = createPilotRuntime({
    config: readPilotConfig(VALID_ENV),
    pool: fixture.pool,
    poolOwned: true,
    tokenVerifier: { async verify() { throw new Error("unused"); } },
    logger: {
      info(code) { logs.push(code); },
      warn(code) { logs.push(code); },
      error(code) { logs.push(code); }
    }
  });

  await runtime.probeReadiness();
  assert.equal(runtime.readiness.snapshot().ready, true);
  const sensitive = new Error(
    "postgresql://runtime:credential@provider.example/customer stack token"
  );
  sensitive.stack = "provider stack with customer content";
  assert.doesNotThrow(() => fixture.pool.emit("error", sensitive));
  assert.equal(runtime.readiness.snapshot().ready, false);
  assert.deepEqual(logs, ["PILOT_DATABASE_POOL_ERROR"]);
  assert.doesNotMatch(JSON.stringify(logs), /credential|provider|stack|token|customer/i);
  await runtime.close();
  assert.equal(fixture.pool.listenerCount("error"), 0);
});

test("readiness probes remain single-flight through timeout and cannot outlive close", async () => {
  const { createPilotRuntime, readPilotConfig } = loadRuntime();
  const gates = [];
  const events = [];
  const state = {
    activeReadinessQueries: 0,
    ended: 0,
    maximumReadinessQueries: 0,
    readinessQueries: 0
  };
  const pool = new EventEmitter();
  pool.connect = async () => ({
    async query(sql) {
      const normalized = String(sql?.text || sql).replace(/\s+/g, " ").trim();
      if (normalized.includes("tge.pilot_runtime_readiness")) {
        const gate = deferred();
        gates.push(gate);
        state.readinessQueries += 1;
        state.activeReadinessQueries += 1;
        state.maximumReadinessQueries = Math.max(
          state.maximumReadinessQueries,
          state.activeReadinessQueries
        );
        try {
          return await gate.promise;
        } finally {
          state.activeReadinessQueries -= 1;
          events.push("probe-settled");
        }
      }
      return { rows: [] };
    },
    release() {}
  });
  pool.end = async () => {
    state.ended += 1;
    events.push("pool-ended");
  };
  const runtime = createPilotRuntime({
    config: readPilotConfig(VALID_ENV),
    operationTimeoutMs: 5,
    pool,
    poolOwned: true,
    shutdownTimeoutMs: 100,
    tokenVerifier: { async verify() { throw new Error("unused"); } },
    logger: { info() {}, warn() {}, error() {} }
  });
  const keepAlive = setInterval(() => {}, 1000);

  try {
    await runtime.probeReadiness();
    await runtime.probeReadiness();
    const closing = runtime.close();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.ended, 0);
    for (const gate of gates) {
      gate.resolve({
        rows: [{
          schema_version: "014",
          runtime_role_member: true,
          login_nonprivileged: true,
          required_relations_available: true
        }]
      });
    }
    await closing;

    assert.equal(state.readinessQueries, 1);
    assert.equal(state.maximumReadinessQueries, 1);
    assert.deepEqual(events, ["probe-settled", "pool-ended"]);
    assert.equal(state.ended, 1);
    assert.equal(runtime.readiness.snapshot().ready, false);
    await runtime.probeReadiness();
    assert.equal(state.readinessQueries, 1);
    assert.equal(runtime.readiness.snapshot().ready, false);
  } finally {
    clearInterval(keepAlive);
    for (const gate of gates) gate.resolve({ rows: [] });
    await runtime.close();
  }
});

test("a ready pilot still requires membership-derived auth and never exposes an unauthenticated API", async () => {
  const { createPilotRuntime, readPilotConfig } = loadRuntime();
  const fixture = fakePool();
  const runtime = createPilotRuntime({
    config: readPilotConfig(VALID_ENV),
    pool: fixture.pool,
    tokenVerifier: { async verify() { return { issuer: VALID_ENV.TGE_AUTH0_ISSUER, subject: "auth0|unknown" }; } },
    logger: { info() {}, warn() {}, error() {} }
  });
  await runtime.probeReadiness();
  const server = await runtime.listen({ port: 0, autoProbe: false });
  try {
    assert.equal((await request(server, "/health/ready")).status, 200);
    const missing = await request(server, "/api/opportunities");
    assert.equal(missing.status, 401);
    assert.equal(missing.data.error, "AUTHENTICATION_REQUIRED");
    const uninvited = await request(server, "/api/opportunities", {
      headers: { authorization: "Bearer valid-but-uninvited" }
    });
    assert.equal(uninvited.status, 403);
    assert.equal(uninvited.data.error, "ACCESS_DENIED");
  } finally {
    await runtime.close();
  }
});

test("pilot shutdown is idempotent and releases an owned pool exactly once", async () => {
  const { createPilotRuntime, readPilotConfig } = loadRuntime();
  const fixture = fakePool();
  const runtime = createPilotRuntime({
    config: readPilotConfig(VALID_ENV),
    pool: fixture.pool,
    poolOwned: true,
    tokenVerifier: { async verify() { throw new Error("unused"); } },
    logger: { info() {}, warn() {}, error() {} }
  });
  const server = await runtime.listen({ port: 0, autoProbe: false });
  assert.equal(server.listening, true);
  await Promise.all([runtime.close(), runtime.close()]);
  assert.equal(server.listening, false);
  assert.equal(fixture.state.ended, 1);
});

test("owned pool shutdown is bounded and keeps normalized error handling when end times out", async () => {
  const { createPilotRuntime, readPilotConfig } = loadRuntime();
  const fixture = fakePool();
  const logs = [];
  fixture.pool.end = () => new Promise(() => {});
  const runtime = createPilotRuntime({
    config: readPilotConfig(VALID_ENV),
    pool: fixture.pool,
    poolOwned: true,
    shutdownTimeoutMs: 5,
    tokenVerifier: { async verify() { throw new Error("unused"); } },
    logger: {
      info() {},
      warn(code) { logs.push(code); },
      error(code) { logs.push(code); }
    }
  });
  const keepAlive = setInterval(() => {}, 1000);
  const startedAt = Date.now();
  try {
    await runtime.close();
  } finally {
    clearInterval(keepAlive);
  }
  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(logs, ["PILOT_DATABASE_SHUTDOWN_FAILED"]);
  assert.equal(fixture.pool.listenerCount("error"), 1);
  assert.doesNotThrow(() => fixture.pool.emit(
    "error",
    new Error("late provider credential stack")
  ));
  assert.deepEqual(logs, [
    "PILOT_DATABASE_SHUTDOWN_FAILED",
    "PILOT_DATABASE_POOL_ERROR"
  ]);
});

test("invalid pilot startup emits only its stable failure line", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "src", "pilot", "index.js")],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { NODE_ENV: "test" }
    }
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "PILOT_RUNTIME_START_FAILED\n");
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /dotenv|injected env|loading env|provider/i
  );
});

test("package scripts expose explicit local and pilot modes plus a validated pilot browser build", async () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
  );
  assert.equal(packageJson.scripts.server, "node src/index.js");
  assert.equal(packageJson.scripts["server:pilot"], "node src/pilot/index.js");
  assert.equal(packageJson.scripts.start, packageJson.scripts["server:pilot"]);
  assert.equal(packageJson.scripts["build:pilot"], "node scripts/build-pilot.mjs");

  const { validatePilotBuildConfig } = await import(
    "../scripts/pilot-build-config.mjs"
  );
  assert.deepEqual(validatePilotBuildConfig({
    TGE_PUBLIC_API_URL: "https://api.example.test",
    VITE_API_URL: "https://api.example.test"
  }), { apiUrl: "https://api.example.test" });
  for (const env of [
    {},
    { TGE_PUBLIC_API_URL: "https://api.example.test" },
    { TGE_PUBLIC_API_URL: "https://api.example.test", VITE_API_URL: "http://api.example.test" },
    { TGE_PUBLIC_API_URL: "https://api.example.test", VITE_API_URL: "https://other.example.test" }
  ]) {
    assert.throws(
      () => validatePilotBuildConfig(env),
      error => error.code === "PILOT_BUILD_CONFIGURATION_INVALID"
        && error.message === "Pilot browser build configuration is invalid."
    );
  }
});
