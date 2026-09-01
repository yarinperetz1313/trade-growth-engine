const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");

test("browser auth seam uses Auth0 PKCE SDK with memory-only token storage", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "web/lib/auth.js"),
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
  assert.doesNotMatch(source, /localStorage|clientSecret|managementApi|otp/i);
});
