import { expect, test } from "@playwright/test";

const apiBaseUrl = process.env.VITE_API_URL || "http://127.0.0.1:3100";
const webOrigin = "http://127.0.0.1:5174";
const invitationToken = "a".repeat(43);

async function installAuth(page, state = {}) {
  await page.addInitScript(initial => {
    const runtime = {
      authenticated: initial.authenticated === true,
      callbackAppState: initial.callbackAppState ?? null,
      callbackReady: false,
      calls: []
    };
    globalThis.__TGE_AUTH_E2E_STATE__ = runtime;
    globalThis.__TGE_AUTH_E2E_CLIENT_FACTORY__ = async ({ callbackUrl }) => ({
      callbackUrl,
      async getAccessToken() { return "e2e-access-token"; },
      async handleCallback() {
        runtime.calls.push("callback");
        runtime.callbackReady = true;
        runtime.authenticated = initial.callbackAuthenticated !== false;
        return { appState: runtime.callbackAppState };
      },
      async isAuthenticated() { return runtime.authenticated; },
      async login(returnRoute) { runtime.calls.push(["login", returnRoute]); },
      async loginWithInvitation(token) { runtime.calls.push(["invitation", token]); },
      async logout() { runtime.calls.push("logout"); },
      takeCallbackState() {
        if (!runtime.callbackReady) return null;
        runtime.callbackReady = false;
        return runtime.callbackAppState ?? { callbackConsumed: true };
      }
    });
  }, state);

  await page.route(`${apiBaseUrl}/api/auth/config`, route => route.fulfill({
    contentType: "application/json",
    status: 200,
    body: JSON.stringify({
      audience: apiBaseUrl,
      callbackUrls: [`${webOrigin}/auth/callback`],
      clientId: "e2e-public-client",
      issuer: "https://pilot.au.auth0.com/",
      logoutUrls: [`${webOrigin}/signed-out`]
    })
  }));
}

test("invitation landing requires an explicit begin before Auth0 redirect", async ({ page }) => {
  await installAuth(page);
  let beginCalls = 0;
  await page.route(`${apiBaseUrl}/api/auth/invitations/begin`, async route => {
    beginCalls += 1;
    expect(await route.request().postDataJSON()).toEqual({
      invitationToken,
      redirectUri: `${webOrigin}/auth/callback`
    });
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        ok: true,
        authorization: { redirectUri: `${webOrigin}/auth/callback` }
      })
    });
  });

  await page.goto(`/#/invite?token=${invitationToken}`);
  await expect(page.getByRole("heading", { name: "Your Trade Growth invitation" })).toBeVisible();
  expect(beginCalls).toBe(0);
  await page.getByRole("button", { name: "Continue to secure sign in" }).click();
  await expect.poll(() => beginCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => globalThis.__TGE_AUTH_E2E_STATE__.calls)).toEqual([
    ["invitation", invitationToken]
  ]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test("an authenticated but unactivated invitee sees the invitation before membership resolution", async ({ page }) => {
  await installAuth(page, { authenticated: true });
  let beginCalls = 0;
  let contextCalls = 0;
  await page.route(`${apiBaseUrl}/api/auth/context`, route => {
    contextCalls += 1;
    return route.abort();
  });
  await page.route(`${apiBaseUrl}/api/auth/invitations/begin`, route => {
    beginCalls += 1;
    return route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        ok: true,
        authorization: { redirectUri: `${webOrigin}/auth/callback` }
      })
    });
  });

  await page.goto(`/#/invite?token=${invitationToken}`);
  await expect(page.getByRole("heading", { name: "Your Trade Growth invitation" })).toBeVisible();
  expect(contextCalls).toBe(0);
  expect(beginCalls).toBe(0);
  expect(await page.evaluate(() => globalThis.__TGE_AUTH_E2E_STATE__.calls)).toEqual([]);

  await page.getByRole("button", { name: "Continue to secure sign in" }).click();
  await expect.poll(() => beginCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => globalThis.__TGE_AUTH_E2E_STATE__.calls)).toEqual([
    ["invitation", invitationToken]
  ]);
  expect(contextCalls).toBe(0);
});

test("callback accepts invitation then enters the app; returning login and logout stay explicit", async ({ page }) => {
  await installAuth(page, {
    callbackAppState: { invitationToken, returnRoute: "opportunities" }
  });
  const sequence = [];
  await page.route(`${apiBaseUrl}/api/auth/invitations/accept`, async route => {
    sequence.push("accept");
    expect(route.request().headers().authorization).toBe("Bearer e2e-access-token");
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ ok: true, tenantContext: { role: "MEMBER" } })
    });
  });
  await page.route(`${apiBaseUrl}/api/auth/context`, route => {
    sequence.push("context");
    return route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ ok: true, tenantContext: { role: "MEMBER" } })
    });
  });

  await page.goto("/auth/callback?code=bounded-code&state=bounded-state");
  await expect(page.getByTestId("app-main")).toBeVisible();
  expect(sequence).toEqual(["accept", "context"]);
  await expect(page).not.toHaveURL(/code=|state=/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__TGE_AUTH_E2E_STATE__.calls)).toEqual([
    "callback",
    "logout"
  ]);

  const returning = await page.context().newPage();
  await installAuth(returning);
  await returning.goto("/");
  await expect(returning.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await returning.getByRole("button", { name: "Continue to sign in" }).click();
  await expect.poll(() => returning.evaluate(() => globalThis.__TGE_AUTH_E2E_STATE__.calls)).toEqual([
    ["login", "opportunities"]
  ]);
});

test("wrong-user, expired, or replayed invitation callback stays generic and recoverable", async ({ page }) => {
  await installAuth(page, {
    callbackAppState: { invitationToken, returnRoute: "opportunities" }
  });
  await page.route(`${apiBaseUrl}/api/auth/invitations/accept`, route => route.fulfill({
    contentType: "application/json",
    status: 404,
    body: JSON.stringify({
      ok: false,
      error: "INVITATION_UNAVAILABLE",
      message: "The invitation is unavailable."
    })
  }));

  await page.goto("/auth/callback?code=bounded-code&state=bounded-state");
  await expect(page.getByRole("heading", { name: "Access is unavailable" })).toBeVisible();
  await expect(page.getByText(/expired, already used, revoked, or prepared for another identity/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out and try again" }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__TGE_AUTH_E2E_STATE__.calls)).toEqual([
    "callback",
    "logout"
  ]);
  await expect(page.locator("body")).not.toContainText(invitationToken);
});

test("malformed callback appState reports interrupted recovery without accepting", async ({ page }) => {
  await installAuth(page, {
    callbackAppState: { invitationToken: "malformed", tenantId: "client-tenant" }
  });
  let acceptCalls = 0;
  await page.route(`${apiBaseUrl}/api/auth/invitations/accept`, route => {
    acceptCalls += 1;
    return route.abort();
  });

  await page.goto("/auth/callback?code=bounded-code&state=bounded-state");
  await expect(page.getByRole("heading", { name: "Sign-in was interrupted" })).toBeVisible();
  await expect(page.getByText(/original invitation link/)).toBeVisible();
  expect(acceptCalls).toBe(0);
  await expect(page.locator("body")).not.toContainText("client-tenant");
});

test("a consumed callback with missing appState reports truthful interrupted recovery", async ({ page }) => {
  await installAuth(page, { callbackAppState: null });
  let contextCalls = 0;
  await page.route(`${apiBaseUrl}/api/auth/context`, route => {
    contextCalls += 1;
    return route.abort();
  });

  await page.goto("/auth/callback?code=bounded-code&state=bounded-state");
  await expect(page.getByRole("heading", { name: "Sign-in was interrupted" })).toBeVisible();
  await expect(page.getByText(/return to sign in and try again/i)).toBeVisible();
  expect(contextCalls).toBe(0);
});
