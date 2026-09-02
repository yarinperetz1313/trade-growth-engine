const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const apiRequests = import("../web/lib/browserApiRequest.mjs");

test("browser auth seam uses Auth0 PKCE SDK with memory-only token storage", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "web/lib/auth.js"),
    "utf8"
  );
  const apiSource = fs.readFileSync(
    path.join(repositoryRoot, "web/lib/api.js"),
    "utf8"
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
  );

  assert.match(packageJson.dependencies["@auth0/auth0-spa-js"], /^\^2\./);
  assert.match(source, /createAuth0Client/);
  assert.match(source, /cacheLocation:\s*"memory"/);
  assert.match(source, /useRefreshTokens:\s*false/);
  assert.match(source, /authorizationParams:\s*\{/);
  assert.match(source, /redirect_uri:/);
  assert.match(source, /logoutParams:\s*\{/);
  assert.match(source, /logoutParams:\s*\{\s*returnTo/);
  assert.match(source, /registerBrowserAccessTokenProvider/);
  assert.match(apiSource, /createBrowserApiRequest/);
  const mainSource = fs.readFileSync(
    path.join(repositoryRoot, "web/main.jsx"),
    "utf8"
  );
  assert.match(mainSource, /if \(import\.meta\.env\.PROD\)/);
  assert.match(mainSource, /await initializeBrowserAuth\(\{ apiBase: API_BASE \}\)/);
  assert.ok(
    mainSource.indexOf("await initializeBrowserAuth")
      < mainSource.indexOf("root.render(<App />)")
  );
  assert.doesNotMatch(source, /localStorage|clientSecret|managementApi|otp/i);
});

test("production auth bootstrap uses the configured API origin before protected requests", async () => {
  const { initializeBrowserAuth } = await import("../web/lib/auth.js");
  const calls = [];
  const auth = {
    async handleCallback() {
      calls.push("callback");
    }
  };
  const result = await initializeBrowserAuth({
    apiBase: "https://api.example.test",
    location: {
      origin: "https://app.example.test",
      pathname: "/auth/callback"
    },
    fetchImpl: async url => {
      calls.push(url);
      return new Response(JSON.stringify({
        audience: "https://api.example.test",
        callbackUrls: ["https://app.example.test/auth/callback"],
        clientId: "public-client",
        issuer: "https://tenant.au.auth0.com/",
        logoutUrls: ["https://app.example.test/signed-out"]
      }), { status: 200 });
    },
    createAuth: async options => {
      calls.push(options);
      return auth;
    }
  });

  assert.equal(result, auth);
  assert.equal(calls[0], "https://api.example.test/api/auth/config");
  assert.deepEqual(calls[1], {
    callbackUrl: "https://app.example.test/auth/callback",
    config: {
      audience: "https://api.example.test",
      callbackUrls: ["https://app.example.test/auth/callback"],
      clientId: "public-client",
      issuer: "https://tenant.au.auth0.com/",
      logoutUrls: ["https://app.example.test/signed-out"]
    },
    logoutUrl: "https://app.example.test/signed-out"
  });
  assert.equal(calls[2], "callback");
});

test("auth bootstrap fails closed unless local mode explicitly permits a missing route", async () => {
  const { initializeBrowserAuth } = await import("../web/lib/auth.js");
  const location = { origin: "http://127.0.0.1:5174", pathname: "/" };
  assert.equal(await initializeBrowserAuth({
    allowMissingConfig: true,
    location,
    fetchImpl: async () => new Response(null, { status: 404 }),
    createAuth: async () => assert.fail("404 must not initialize Auth0")
  }), null);
  await assert.rejects(
    initializeBrowserAuth({
      location,
      fetchImpl: async () => new Response(null, { status: 404 }),
      createAuth: async () => assert.fail("missing production config must fail closed")
    }),
    error => error?.status === 404
  );
  await assert.rejects(
    initializeBrowserAuth({
      location,
      fetchImpl: async () => new Response(null, { status: 503 }),
      createAuth: async () => assert.fail("unavailable config must fail closed")
    }),
    error => error?.status === 503
      && error.message === "Authentication configuration is unavailable."
  );
});

test("protected browser API requests obtain a fresh Auth0 bearer token without caller authority", async () => {
  const {
    createBrowserApiRequest,
    registerBrowserAccessTokenProvider
  } = await apiRequests;
  const requests = [];
  let tokenCalls = 0;
  const unregister = registerBrowserAccessTokenProvider(
    async () => `token-${++tokenCalls}`
  );
  const request = createBrowserApiRequest({
    apiBase: "https://api.example.test",
    fetchImpl: async (url, options) => {
      requests.push({
        body: options.body,
        headers: Object.fromEntries(new Headers(options.headers)),
        url
      });
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      });
    }
  });

  await request("/api/import-batches/preview", {
    method: "POST",
    body: JSON.stringify({ upload: "evidence" }),
    headers: { "X-Request-Evidence": "bounded" }
  });
  await request("/api/import-batches/batch-1/commit");

  assert.equal(tokenCalls, 2);
  assert.equal(requests[0].headers.authorization, "Bearer token-1");
  assert.equal(requests[1].headers.authorization, "Bearer token-2");
  assert.equal(requests[0].headers["x-request-evidence"], "bounded");
  assert.doesNotMatch(requests[0].url, /token-/);
  assert.doesNotMatch(requests[0].body, /token-/);
  unregister();
});

test("public browser requests omit bearer tokens and protected requests fail closed on invalid authority", async () => {
  const { createBrowserApiRequest } = await apiRequests;
  const requests = [];
  let tokenCalls = 0;
  const request = createBrowserApiRequest({
    apiBase: "https://api.example.test",
    fetchImpl: async (url, options) => {
      requests.push({ headers: new Headers(options.headers), url });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    getAccessToken: async () => {
      tokenCalls += 1;
      return "test-token";
    }
  });

  await request("/health");
  assert.equal(tokenCalls, 0);
  assert.equal(requests[0].headers.has("Authorization"), false);

  await assert.rejects(
    request("/api/prospects", { headers: { Authorization: "Bearer caller-token" } }),
    error => error?.code === "BROWSER_AUTHORITY_INVALID"
      && !error.message.includes("caller-token")
  );
  assert.equal(requests.length, 1);

  const invalidTokenRequest = createBrowserApiRequest({
    apiBase: "https://api.example.test",
    fetchImpl: async () => assert.fail("fetch must not run with an invalid token"),
    getAccessToken: async () => "bad token\nsecret"
  });
  await assert.rejects(
    invalidTokenRequest("/api/import-batches/preview"),
    error => error?.code === "BROWSER_AUTH_UNAVAILABLE"
      && !error.message.includes("bad token")
  );
});
