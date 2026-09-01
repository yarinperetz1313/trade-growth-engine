"use strict";

class AuthenticationError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationError";
    this.code = "AUTHENTICATION_REQUIRED";
    this.status = 401;
  }
}

function extractBearerToken(header) {
  if (typeof header !== "string") {
    throw new AuthenticationError();
  }

  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) {
    throw new AuthenticationError();
  }

  return match[1];
}

function validateAuth0Boundary({ issuer, audience, jwksUri }) {
  let issuerUrl;
  let jwksUrl;

  try {
    issuerUrl = new URL(issuer);
    jwksUrl = new URL(jwksUri);
  } catch {
    throw new Error("Auth0 issuer and JWKS URI must be absolute URLs.");
  }

  if (
    issuerUrl.protocol !== "https:"
    || issuerUrl.username
    || issuerUrl.password
    || issuerUrl.search
    || issuerUrl.hash
    || !issuer.endsWith("/")
    || issuerUrl.href !== issuer
  ) {
    throw new Error("Auth0 issuer must be an exact HTTPS URL ending in '/'.");
  }

  if (typeof audience !== "string" || audience.trim() !== audience || !audience) {
    throw new Error("Auth0 audience must be a non-empty exact value.");
  }

  const expectedJwksUri = new URL(".well-known/jwks.json", issuerUrl).href;
  if (
    jwksUrl.protocol !== "https:"
    || jwksUrl.origin !== issuerUrl.origin
    || jwksUrl.href !== expectedJwksUri
  ) {
    throw new Error("Auth0 JWKS URI must be the issuer's exact well-known JWKS URL.");
  }
}

function audienceMatches(actual, expected) {
  if (typeof actual === "string") {
    return actual === expected;
  }

  return Array.isArray(actual)
    && actual.length > 0
    && actual.every(value => typeof value === "string")
    && actual.includes(expected);
}

class Auth0TokenVerifier {
  constructor({ issuer, audience, jwksUri, verifyJwt, now = () => new Date() }) {
    validateAuth0Boundary({ issuer, audience, jwksUri });
    this.issuer = issuer;
    this.audience = audience;
    this.jwksUri = jwksUri;
    this.verifyJwt = verifyJwt || createJoseVerifier(jwksUri);
    this.now = now;
  }

  async verify(token) {
    try {
      if (typeof token !== "string" || !token) {
        throw new Error("missing token");
      }

      const options = {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub"],
        jwksUri: this.jwksUri
      };
      const verification = await this.verifyJwt(token, options);
      const { payload, protectedHeader } = verification || {};
      const nowSeconds = Math.floor(this.now().getTime() / 1000);

      if (
        protectedHeader?.alg !== "RS256"
        || payload?.iss !== this.issuer
        || !audienceMatches(payload?.aud, this.audience)
        || typeof payload?.sub !== "string"
        || payload.sub.trim() === ""
        || !Number.isFinite(payload?.iat)
        || !Number.isFinite(payload?.exp)
        || payload.iat > nowSeconds + 60
        || (
          payload.nbf !== undefined
          && (!Number.isFinite(payload.nbf) || payload.nbf > nowSeconds)
        )
        || payload.exp <= nowSeconds
      ) {
        throw new Error("invalid claims");
      }

      return Object.freeze({
        issuer: payload.iss,
        subject: payload.sub
      });
    } catch {
      throw new AuthenticationError();
    }
  }
}

function createJoseVerifier(jwksUri) {
  let verifierPromise;

  return async (token, options) => {
    if (!verifierPromise) {
      verifierPromise = import("jose").then(({ createRemoteJWKSet, jwtVerify }) => {
        const jwks = createRemoteJWKSet(new URL(jwksUri));
        return value => jwtVerify(value, jwks, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: options.algorithms,
          requiredClaims: options.requiredClaims
        });
      });
    }

    const verify = await verifierPromise;
    return verify(token);
  };
}

module.exports = {
  Auth0TokenVerifier,
  AuthenticationError,
  extractBearerToken,
  validateAuth0Boundary
};
