const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RETURN_ROUTES = new Set(["opportunities", "imports"]);

export function invitationFromLocation(location = globalThis.location) {
  const hash = typeof location?.hash === "string" ? location.hash : "";
  const match = /^#\/invite(?:\?(.*))?$/.exec(hash);
  if (!match) return null;
  const params = new URLSearchParams(match[1] || "");
  const values = params.getAll("token");
  return values.length === 1 && INVITATION_TOKEN.test(values[0])
    ? Object.freeze({ token: values[0] })
    : null;
}

export async function beginInvitation({
  apiBase,
  auth,
  callbackUrl,
  fetchImpl = fetch,
  token
}) {
  if (!INVITATION_TOKEN.test(token) || typeof auth?.loginWithInvitation !== "function") {
    throw flowError("INVITATION_UNAVAILABLE");
  }
  const response = await fetchImpl(`${apiBase}/api/auth/invitations/begin`, {
    method: "POST",
    credentials: "omit",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ invitationToken: token, redirectUri: callbackUrl })
  });
  const body = await safeJson(response);
  if (!response.ok || body?.authorization?.redirectUri !== callbackUrl) {
    throw flowError("INVITATION_UNAVAILABLE");
  }
  await auth.loginWithInvitation(token);
}

export async function resolveIdentityState({
  apiBase = "",
  auth,
  fetchImpl = fetch,
  getAccessToken
} = {}) {
  if (!auth) return Object.freeze({ kind: "SIGNED_OUT" });
  const callbackState = auth.takeCallbackState?.() || null;
  if (callbackState && (
    typeof callbackState !== "object"
    || callbackState.invitationToken !== undefined
      && !INVITATION_TOKEN.test(callbackState.invitationToken)
  )) {
    return Object.freeze({ kind: "INTERRUPTED", recovery: "RESTART_INVITATION" });
  }

  let authenticated;
  try {
    authenticated = await auth.isAuthenticated();
  } catch {
    return Object.freeze({ kind: "AUTH_UNAVAILABLE" });
  }
  if (!authenticated) {
    return callbackState
      ? Object.freeze({ kind: "INTERRUPTED", recovery: "SIGN_IN_AGAIN" })
      : Object.freeze({ kind: "SIGNED_OUT" });
  }

  try {
    const tokenProvider = getAccessToken || (() => auth.getAccessToken());
    if (callbackState?.invitationToken) {
      await protectedRequest({
        apiBase,
        fetchImpl,
        getAccessToken: tokenProvider,
        path: "/api/auth/invitations/accept",
        method: "POST",
        body: { invitationToken: callbackState.invitationToken }
      });
    }
    const context = await protectedRequest({
      apiBase,
      fetchImpl,
      getAccessToken: tokenProvider,
      path: "/api/auth/context",
      method: "GET"
    });
    return Object.freeze({
      kind: "AUTHENTICATED",
      role: context?.tenantContext?.role || null,
      returnRoute: RETURN_ROUTES.has(callbackState?.returnRoute)
        ? callbackState.returnRoute
        : "opportunities"
    });
  } catch (error) {
    if ([403, 404].includes(error?.status)) {
      return Object.freeze({ kind: "INVITATION_UNAVAILABLE" });
    }
    return Object.freeze({ kind: "AUTH_UNAVAILABLE" });
  }
}

export function loginReturningUser(auth, returnRoute = "opportunities") {
  if (typeof auth?.login !== "function") throw flowError("AUTH_UNAVAILABLE");
  return auth.login(RETURN_ROUTES.has(returnRoute) ? returnRoute : "opportunities");
}

export function logoutUser(auth) {
  if (typeof auth?.logout !== "function") throw flowError("AUTH_UNAVAILABLE");
  return auth.logout();
}

async function protectedRequest({
  apiBase,
  fetchImpl,
  getAccessToken,
  path,
  method,
  body
}) {
  let token;
  try {
    token = await getAccessToken();
  } catch {
    throw flowError("AUTH_UNAVAILABLE");
  }
  if (typeof token !== "string" || !token || /\s/.test(token)) {
    throw flowError("AUTH_UNAVAILABLE");
  }
  const response = await fetchImpl(`${apiBase}${path}`, {
    method,
    credentials: "omit",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const responseBody = await safeJson(response);
  if (!response.ok || responseBody?.ok === false) {
    const error = flowError("AUTH_UNAVAILABLE");
    error.status = response.status;
    throw error;
  }
  return responseBody;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function flowError(code) {
  const error = new Error(code === "INVITATION_UNAVAILABLE"
    ? "The invitation is unavailable."
    : "Authentication is unavailable.");
  error.code = code;
  return error;
}
