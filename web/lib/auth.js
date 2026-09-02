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
  const auth = await createAuth({ config, callbackUrl, logoutUrl });
  if (`${location.origin}${location.pathname}` === callbackUrl) {
    await auth.handleCallback();
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
