"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const flow = import("../web/lib/identityFlow.mjs");

test("invitation landing validates a bounded fragment token and begins only after explicit action", async () => {
  const { invitationFromLocation, beginInvitation } = await flow;
  assert.deepEqual(invitationFromLocation({ hash: "#/invite?token=" + "a".repeat(43) }), {
    token: "a".repeat(43)
  });
  assert.equal(invitationFromLocation({ hash: "#/invite?token=bad%20token" }), null);
  const calls = [];
  const auth = {
    async loginWithInvitation(token) { calls.push(["redirect", token]); }
  };
  await beginInvitation({
    apiBase: "https://api.example.test",
    auth,
    callbackUrl: "https://app.example.test/auth/callback",
    fetchImpl: async (url, options) => {
      calls.push([url, JSON.parse(options.body)]);
      return new Response(JSON.stringify({ ok: true, authorization: { redirectUri: "https://app.example.test/auth/callback" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    token: "a".repeat(43)
  });
  assert.equal(calls[0][0], "https://api.example.test/api/auth/invitations/begin");
  assert.deepEqual(calls[1], ["redirect", "a".repeat(43)]);
});

test("callback accepts the bounded appState invitation before entering the authenticated app", async () => {
  const { resolveIdentityState } = await flow;
  const calls = [];
  const state = await resolveIdentityState({
    apiBase: "https://api.example.test",
    auth: {
      takeCallbackState() {
        return { invitationToken: "b".repeat(43), returnRoute: "opportunities" };
      },
      async isAuthenticated() { return true; }
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(url.endsWith("/accept")
        ? { ok: true, tenantContext: { role: "MEMBER" } }
        : { ok: true, tenantContext: { role: "MEMBER" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    getAccessToken: async () => "access-token"
  });
  assert.equal(state.kind, "AUTHENTICATED");
  assert.equal(calls[0].url.endsWith("/api/auth/invitations/accept"), true);
  assert.equal(calls[1].url.endsWith("/api/auth/context"), true);
  assert.equal(new Headers(calls[0].options.headers).get("authorization"), "Bearer access-token");
});

test("returning login/logout and uninvited, expired, replayed, wrong-user, and interrupted paths stay explicit", async () => {
  const { loginReturningUser, logoutUser, resolveIdentityState } = await flow;
  const calls = [];
  const auth = {
    async login(returnRoute) { calls.push(["login", returnRoute]); },
    async logout() { calls.push(["logout"]); },
    takeCallbackState() { return null; },
    async isAuthenticated() { return false; }
  };
  await loginReturningUser(auth, "imports");
  await logoutUser(auth);
  assert.deepEqual(calls, [["login", "imports"], ["logout"]]);
  assert.deepEqual(await resolveIdentityState({ auth }), { kind: "SIGNED_OUT" });

  for (const status of [403, 404]) {
    const result = await resolveIdentityState({
      apiBase: "https://api.example.test",
      auth: {
        takeCallbackState() { return { invitationToken: "c".repeat(43) }; },
        async isAuthenticated() { return true; }
      },
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: status === 403 ? "ACCESS_DENIED" : "INVITATION_UNAVAILABLE",
        message: "generic"
      }), { status, headers: { "content-type": "application/json" } }),
      getAccessToken: async () => "access-token"
    });
    assert.equal(result.kind, "INVITATION_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(result), /generic|access-token|cccc/);
  }

  assert.deepEqual(await resolveIdentityState({
    auth: {
      takeCallbackState() { return { invitationToken: "bad" }; },
      async isAuthenticated() { return true; }
    }
  }), { kind: "INTERRUPTED", recovery: "RESTART_INVITATION" });
});
