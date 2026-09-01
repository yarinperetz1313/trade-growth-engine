import {
  createAuth0Client
} from "@auth0/auth0-spa-js";

function exactAllowed(value, allowed, label) {
  if (!Array.isArray(allowed) || !allowed.includes(value)) {
    throw new Error(`${label} is not allowlisted.`);
  }
  return value;
}

export async function loadBrowserAuthConfig(fetchImpl = fetch) {
  const response = await fetchImpl("/api/auth/config", {
    credentials: "omit",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error("Authentication configuration is unavailable.");
  }
  return response.json();
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
