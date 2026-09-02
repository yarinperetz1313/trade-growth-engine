import {
  createAuth0Client
} from "@auth0/auth0-spa-js";
import {
  registerBrowserAccessTokenProvider
} from "./browserApiRequest.mjs";

function exactAllowed(value, allowed, label) {
  if (!Array.isArray(allowed) || !allowed.includes(value)) {
    throw new Error(`${label} is not allowlisted.`);
  }
  return value;
}

export async function loadBrowserAuthConfig(fetchImpl = fetch, apiBase = "") {
  const response = await fetchImpl(`${apiBase}/api/auth/config`, {
    credentials: "omit",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const error = new Error("Authentication configuration is unavailable.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function initializeBrowserAuth({
  apiBase = "",
  allowMissingConfig = false,
  fetchImpl = fetch,
  history = globalThis.window?.history,
  location = window.location,
  createAuth = createBrowserAuth
} = {}) {
  let config;
  try {
    config = await loadBrowserAuthConfig(fetchImpl, apiBase);
  } catch (error) {
    if (allowMissingConfig && error?.status === 404) return null;
    throw error;
  }

  const callbackUrl = allowedUrlForOrigin(
    config.callbackUrls,
    location.origin,
    "Authentication callback"
  );
  const logoutUrl = allowedUrlForOrigin(
    config.logoutUrls,
    location.origin,
    "Logout return URL"
  );
  const callbackState = browserAuthCallbackState(location, callbackUrl);
  if (callbackState === "INVALID") {
    throw browserAuthCallbackError();
  }
  const auth = await createAuth({ config, callbackUrl, logoutUrl });
  if (callbackState === "READY") {
    await auth.handleCallback();
    clearConsumedCallbackUrl(location, history);
  }
  return auth;
}

export async function createBrowserAuth({
  config,
  callbackUrl,
  logoutUrl
}) {
  const redirectUri = exactAllowed(
    callbackUrl,
    config.callbackUrls,
    "Authentication callback"
  );
  const returnTo = exactAllowed(
    logoutUrl,
    config.logoutUrls,
    "Logout return URL"
  );
  const client = await createAuth0Client({
    domain: new URL(config.issuer).host,
    clientId: config.clientId,
    cacheLocation: "memory",
    useRefreshTokens: false,
    authorizationParams: {
      audience: config.audience,
      redirect_uri: redirectUri
    }
  });
  registerBrowserAccessTokenProvider(() => client.getTokenSilently());

  return Object.freeze({
    loginWithInvitation(invitationToken) {
      return client.loginWithRedirect({
        authorizationParams: { redirect_uri: redirectUri },
        appState: { invitationToken }
      });
    },
    handleCallback() {
      return client.handleRedirectCallback();
    },
    logout() {
      return client.logout({
        logoutParams: { returnTo }
      });
    },
    getAccessToken() {
      return client.getTokenSilently();
    }
  });
}

function allowedUrlForOrigin(urls, origin, label) {
  const url = Array.isArray(urls)
    ? urls.find(candidate => {
        try {
          return new URL(candidate).origin === origin;
        } catch {
          return false;
        }
      })
    : null;
  if (!url) throw new Error(`${label} is not allowlisted for this origin.`);
  return url;
}

function browserAuthCallbackState(location, callbackUrl) {
  let expected;
  try {
    expected = new URL(callbackUrl);
  } catch {
    return "INVALID";
  }
  if (
    location?.origin !== expected.origin
    || location?.pathname !== expected.pathname
  ) return "NONE";

  const params = new URLSearchParams(
    typeof location.search === "string" ? location.search : ""
  );
  const codes = params.getAll("code");
  const states = params.getAll("state");
  const hasOAuthError = ["error", "error_description", "error_uri"]
    .some(name => params.has(name));
  const hasOAuthResponse = codes.length > 0
    || states.length > 0
    || hasOAuthError;
  if (!hasOAuthResponse) return "NONE";
  return codes.length === 1
    && states.length === 1
    && validOAuthCallbackValue(codes[0])
    && validOAuthCallbackValue(states[0])
    && !hasOAuthError
    ? "READY"
    : "INVALID";
}

function validOAuthCallbackValue(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && new TextEncoder().encode(value).byteLength <= 4096
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function clearConsumedCallbackUrl(location, history) {
  if (!history || typeof history.replaceState !== "function") {
    throw browserAuthCallbackError();
  }
  try {
    history.replaceState(history.state ?? null, "", location.pathname);
  } catch {
    throw browserAuthCallbackError();
  }
}

function browserAuthCallbackError() {
  const error = new Error("The authentication callback is invalid or could not be consumed safely.");
  error.code = "BROWSER_AUTH_CALLBACK_INVALID";
  return error;
}
