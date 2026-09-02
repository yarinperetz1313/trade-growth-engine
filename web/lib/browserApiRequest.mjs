let accessTokenProvider = null;

export function registerBrowserAccessTokenProvider(provider) {
  if (typeof provider !== "function") {
    throw authorityError("BROWSER_AUTHORITY_INVALID");
  }
  accessTokenProvider = provider;
  return () => {
    if (accessTokenProvider === provider) accessTokenProvider = null;
  };
}

export function createBrowserApiRequest({
  apiBase,
  fetchImpl = fetch,
  getAccessToken
}) {
  if (typeof apiBase !== "string" || !apiBase || typeof fetchImpl !== "function") {
    throw new TypeError("A browser API base URL and fetch implementation are required.");
  }
  if (getAccessToken !== undefined && typeof getAccessToken !== "function") {
    throw authorityError("BROWSER_AUTHORITY_INVALID");
  }

  return async function request(path, options = {}) {
    const { headers: suppliedHeaders, ...fetchOptions } = options;
    const headers = new Headers(suppliedHeaders || {});
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    if (isProtectedApiPath(path)) {
      if (headers.has("Authorization")) {
        throw authorityError("BROWSER_AUTHORITY_INVALID");
      }
      const provider = getAccessToken === undefined
        ? accessTokenProvider
        : getAccessToken;
      if (provider) {
        headers.set("Authorization", `Bearer ${await safeAccessToken(provider)}`);
      }
    }

    const response = await fetchImpl(`${apiBase}${path}`, {
      ...fetchOptions,
      headers
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok || body?.ok === false) {
      const error = new Error(
        body?.message || body?.error || `Request failed: ${response.status}`
      );
      error.name = "ApiError";
      error.status = response.status;
      error.code = body?.error || null;
      error.details = body?.details;
      throw error;
    }
    return body;
  };
}

function isProtectedApiPath(path) {
  return typeof path === "string"
    && path.startsWith("/api/")
    && path !== "/api/auth/config";
}

async function safeAccessToken(provider) {
  let token;
  try {
    token = await provider();
  } catch {
    throw authorityError("BROWSER_AUTH_UNAVAILABLE");
  }
  if (typeof token !== "string" || !token || /\s/.test(token)) {
    throw authorityError("BROWSER_AUTH_UNAVAILABLE");
  }
  return token;
}

function authorityError(code) {
  const error = new Error(code === "BROWSER_AUTHORITY_INVALID"
    ? "Caller-supplied browser authority is not allowed."
    : "Browser authentication is unavailable.");
  error.name = "BrowserAuthenticationError";
  error.code = code;
  error.status = null;
  return error;
}
