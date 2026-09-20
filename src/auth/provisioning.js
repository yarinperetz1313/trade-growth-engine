"use strict";

class ProvisioningConfigurationError extends Error {
  constructor() {
    super("Identity provisioning configuration is invalid.");
    this.name = "ProvisioningConfigurationError";
    this.code = "IDENTITY_PROVISIONING_CONFIGURATION_INVALID";
  }
}

class IdentityProvisioningError extends Error {
  constructor() {
    super("Identity provisioning is unavailable.");
    this.name = "IdentityProvisioningError";
    this.code = "IDENTITY_PROVISIONING_UNAVAILABLE";
    this.status = 503;
  }
}

function invalidConfig() {
  throw new ProvisioningConfigurationError();
}

function validateConfig(config) {
  let issuer;
  let management;
  try {
    issuer = new URL(config?.issuer);
    management = new URL(config?.managementApiBaseUrl);
  } catch {
    invalidConfig();
  }
  if (
    issuer.protocol !== "https:"
    || issuer.href !== config.issuer
    || !issuer.href.endsWith("/")
    || management.protocol !== "https:"
    || management.href !== config.managementApiBaseUrl
    || management.origin !== issuer.origin
    || management.pathname !== "/api/v2/"
    || management.search
    || management.hash
    || typeof config.connection !== "string"
    || !config.connection
    || config.connection.trim() !== config.connection
    || config.connection.length > 128
  ) invalidConfig();
  return Object.freeze({
    issuer: issuer.href,
    managementApiBaseUrl: management.href,
    connection: config.connection
  });
}

function exactProvisionedUser(value, normalizedEmail, issuer) {
  if (
    !value
    || typeof value.user_id !== "string"
    || !value.user_id
    || value.user_id.length > 512
    || value.user_id.trim() !== value.user_id
    || /[\u0000-\u001f\u007f]/.test(value.user_id)
    || typeof value.email !== "string"
    || value.email.normalize("NFKC").trim().toLowerCase() !== normalizedEmail
  ) throw new IdentityProvisioningError();
  return Object.freeze({ issuer, subject: value.user_id });
}

class Auth0ProvisioningAdapter {
  constructor({ config, accessTokenProvider, fetchImpl = fetch }) {
    this.config = validateConfig(config);
    if (
      typeof accessTokenProvider !== "function"
      || typeof fetchImpl !== "function"
    ) invalidConfig();
    this.accessTokenProvider = accessTokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async provisionIdentity({ normalizedEmail, operationId }) {
    if (
      typeof normalizedEmail !== "string"
      || normalizedEmail !== normalizedEmail.trim().toLowerCase()
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      || typeof operationId !== "string"
      || !/^[0-9a-f-]{36}$/.test(operationId)
    ) throw new IdentityProvisioningError();

    try {
      const existing = await this.lookup(normalizedEmail);
      if (existing.length === 1) {
        return Object.freeze({
          ...exactProvisionedUser(existing[0], normalizedEmail, this.config.issuer),
          reconciled: true
        });
      }
      if (existing.length !== 0) throw new IdentityProvisioningError();

      const created = await this.request("users", {
        method: "POST",
        body: JSON.stringify({
          connection: this.config.connection,
          email: normalizedEmail,
          email_verified: false,
          app_metadata: { tge_invitation_operation_id: operationId }
        })
      });
      if (created.response.status === 409) {
        const reconciled = await this.lookup(normalizedEmail);
        if (reconciled.length !== 1) throw new IdentityProvisioningError();
        return Object.freeze({
          ...exactProvisionedUser(reconciled[0], normalizedEmail, this.config.issuer),
          reconciled: true
        });
      }
      if (!created.response.ok) throw new IdentityProvisioningError();
      return Object.freeze({
        ...exactProvisionedUser(created.body, normalizedEmail, this.config.issuer),
        reconciled: false
      });
    } catch (error) {
      if (error instanceof IdentityProvisioningError) throw error;
      throw new IdentityProvisioningError();
    }
  }

  async lookup(normalizedEmail) {
    const result = await this.request(
      `users-by-email?email=${encodeURIComponent(normalizedEmail)}`,
      { method: "GET" }
    );
    if (!result.response.ok || !Array.isArray(result.body)) {
      throw new IdentityProvisioningError();
    }
    return result.body;
  }

  async request(path, options) {
    const token = await this.accessTokenProvider();
    if (typeof token !== "string" || !token || /\s/.test(token)) {
      throw new IdentityProvisioningError();
    }
    const response = await this.fetchImpl(
      new URL(path, this.config.managementApiBaseUrl).href,
      {
        ...options,
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {})
        }
      }
    );
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { response, body };
  }
}

module.exports = {
  Auth0ProvisioningAdapter,
  IdentityProvisioningError,
  ProvisioningConfigurationError
};
