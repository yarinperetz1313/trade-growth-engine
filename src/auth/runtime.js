"use strict";

const express = require("express");
const {
  AuthenticationError,
  extractBearerToken,
  validateAuth0Boundary
} = require("./authentication");
const {
  AuthorizationError,
  resolveTenantContext
} = require("./authorization");
const {
  InvitationError
} = require("./invitations");

function validateExactUrl(value, label, { originOnly = false } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || (originOnly && parsed.href !== `${parsed.origin}/`)
  ) {
    throw new Error(`${label} must be an exact HTTPS URL.`);
  }
  return originOnly ? parsed.origin : parsed.href;
}

function validateAuthRuntimeConfig(config) {
  validateAuth0Boundary(config);
  if (
    typeof config.clientId !== "string"
    || !config.clientId
    || config.clientId.trim() !== config.clientId
  ) {
    throw new Error("Auth0 SPA client ID is required.");
  }
  for (const [name, values, options] of [
    ["Auth0 allowed origin", config.allowedOrigins, { originOnly: true }],
    ["Auth0 callback URL", config.callbackUrls],
    ["Auth0 logout URL", config.logoutUrls]
  ]) {
    if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) {
      throw new Error(`${name} allowlist must contain unique exact values.`);
    }
    for (const value of values) {
      validateExactUrl(value, name, options);
      if (value.includes("*")) {
        throw new Error(`${name} allowlist must not contain wildcards.`);
      }
    }
  }
  return Object.freeze({
    ...config,
    allowedOrigins: Object.freeze([...config.allowedOrigins]),
    callbackUrls: Object.freeze([...config.callbackUrls]),
    logoutUrls: Object.freeze([...config.logoutUrls])
  });
}

function publicConfig(config) {
  return {
    issuer: config.issuer,
    audience: config.audience,
    clientId: config.clientId,
    callbackUrls: [...config.callbackUrls],
    logoutUrls: [...config.logoutUrls]
  };
}

function sendKnownError(res, error) {
  if (
    error instanceof AuthenticationError
    || error instanceof AuthorizationError
    || error instanceof InvitationError
  ) {
    res.status(error.status).json({
      ok: false,
      error: error.code,
      message: error.message
    });
    return true;
  }
  return false;
}

function createAuthRuntime({
  config: rawConfig,
  tokenVerifier,
  membershipRepository,
  invitationService = null,
  assuranceResolver = () => null,
  businessRequestBoundary = null
}) {
  const config = validateAuthRuntimeConfig(rawConfig);
  if (!tokenVerifier?.verify || !membershipRepository?.findActiveMembershipsByIdentity) {
    throw new Error("Auth runtime requires token and membership verification ports.");
  }

  async function authenticateIdentity(req, res, next) {
    try {
      const token = extractBearerToken(req.headers.authorization);
      req.authIdentity = await tokenVerifier.verify(token);
      next();
    } catch (error) {
      sendKnownError(
        res,
        error instanceof AuthenticationError ? error : new AuthenticationError()
      );
    }
  }

  async function deriveTenantContext(req, res, next) {
    try {
      req.tenantContext = await resolveTenantContext({
        identity: req.authIdentity,
        membershipRepository
      });
      next();
    } catch (error) {
      sendKnownError(
        res,
        error instanceof AuthorizationError ? error : new AuthorizationError()
      );
    }
  }

  const publicRouter = express.Router();
  publicRouter.get("/config", (req, res) => {
    res.json(publicConfig(config));
  });

  if (invitationService) {
    publicRouter.post("/invitations/begin", async (req, res) => {
      try {
        const result = await invitationService.begin({
          token: req.body?.invitationToken,
          redirectUri: req.body?.redirectUri,
          allowedRedirectUris: config.callbackUrls
        });
        res.json({
          ok: true,
          authorization: {
            ...publicConfig(config),
            redirectUri: result.redirectUri
          }
        });
      } catch (error) {
        if (!sendKnownError(res, error)) {
          sendKnownError(res, new InvitationError());
        }
      }
    });

    publicRouter.post(
      "/invitations/accept",
      authenticateIdentity,
      async (req, res) => {
        try {
          const tenantContext = await invitationService.consume({
            token: req.body?.invitationToken,
            identity: req.authIdentity
          });
          res.json({ ok: true, tenantContext });
        } catch (error) {
          if (!sendKnownError(res, error)) {
            sendKnownError(res, new InvitationError());
          }
        }
      }
    );
  }

  const protectedRouter = express.Router();
  protectedRouter.get("/context", (req, res) => {
    res.json({ ok: true, tenantContext: req.tenantContext });
  });

  if (invitationService) {
    protectedRouter.post("/invitations", async (req, res) => {
      try {
        const created = await invitationService.create({
          tenantContext: req.tenantContext,
          email: req.body?.email,
          role: req.body?.role,
          expiresAt: req.body?.expiresAt,
          assurance: await assuranceResolver(req)
        });
        res.status(201).json({
          ok: true,
          token: created.token,
          invitation: {
            id: created.invitation.id,
            tenantId: created.invitation.tenantId,
            normalizedEmail: created.invitation.normalizedEmail,
            role: created.invitation.role,
            status: created.invitation.status,
            expiresAt: created.invitation.expiresAt
          }
        });
      } catch (error) {
        if (!sendKnownError(res, error)) {
          sendKnownError(res, new InvitationError());
        }
      }
    });

    protectedRouter.post("/invitations/:id/revoke", async (req, res) => {
      try {
        const invitation = await invitationService.revoke({
          tenantContext: req.tenantContext,
          invitationId: req.params.id,
          assurance: await assuranceResolver(req)
        });
        res.json({
          ok: true,
          invitation: {
            id: invitation.id,
            status: invitation.status,
            revokedAt: invitation.revokedAt
          }
        });
      } catch (error) {
        if (!sendKnownError(res, error)) {
          sendKnownError(res, new InvitationError());
        }
      }
    });
  }

  async function requireTenantPersistence(req, res, next) {
    if (typeof businessRequestBoundary !== "function") {
      return res.status(503).json({
        ok: false,
        error: "TENANT_PERSISTENCE_UNAVAILABLE",
        message: "Tenant-scoped persistence is unavailable."
      });
    }
    return businessRequestBoundary(req, res, next);
  }

  return Object.freeze({
    config,
    corsOptions: {
      origin(origin, callback) {
        callback(null, !origin || config.allowedOrigins.includes(origin));
      },
      credentials: false
    },
    publicRouter,
    protectedRouter,
    authenticateIdentity,
    deriveTenantContext,
    requireTenantPersistence
  });
}

module.exports = {
  createAuthRuntime,
  validateAuthRuntimeConfig
};
