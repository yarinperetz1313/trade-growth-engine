const assert = require("node:assert/strict");
const test = require("node:test");

const {
  Auth0TokenVerifier,
  AuthenticationError,
  extractBearerToken
} = require("../src/auth/authentication");

const ISSUER = "https://pilot.au.auth0.com/";
const AUDIENCE = "https://api.tradegrowth.example";
const JWKS_URI = `${ISSUER}.well-known/jwks.json`;
const NOW_SECONDS = 1_788_048_000;

function validVerification(overrides = {}) {
  return {
    protectedHeader: { alg: "RS256", typ: "JWT" },
    payload: {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "auth0|member-1",
      iat: NOW_SECONDS - 30,
      exp: NOW_SECONDS + 300,
      ...overrides
    }
  };
}

function createVerifier(verification = validVerification()) {
  const calls = [];
  const verifier = new Auth0TokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: JWKS_URI,
    now: () => new Date(NOW_SECONDS * 1000),
    verifyJwt: async (token, options) => {
      calls.push({ token, options });
      if (verification instanceof Error) {
        throw verification;
      }
      return verification;
    }
  });

  return { verifier, calls };
}

test("extractBearerToken accepts exactly one Bearer credential", () => {
  assert.equal(extractBearerToken("Bearer signed.jwt.value"), "signed.jwt.value");

  for (const header of [
    undefined,
    "",
    "Basic abc",
    "Bearer",
    "bearer token",
    "Bearer one two",
    ["Bearer one", "Bearer two"]
  ]) {
    assert.throws(() => extractBearerToken(header), AuthenticationError);
  }
});

test("Auth0TokenVerifier pins RS256, issuer, audience, JWKS, and required claims", async () => {
  const { verifier, calls } = createVerifier();
  const identity = await verifier.verify("signed.jwt.value");

  assert.deepEqual(identity, {
    issuer: ISSUER,
    subject: "auth0|member-1"
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, "signed.jwt.value");
  assert.deepEqual(calls[0].options, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub"],
    jwksUri: JWKS_URI
  });
});

test("Auth0TokenVerifier rejects malformed, expired, and mismatched tokens generically", async () => {
  const invalidVerifications = [
    new Error("signature details must not escape"),
    validVerification({ exp: NOW_SECONDS }),
    validVerification({ iss: "https://wrong.example/" }),
    validVerification({ aud: "https://wrong.example/api" }),
    validVerification({ sub: "" }),
    validVerification({ iat: undefined }),
    validVerification({ iat: NOW_SECONDS + 61 }),
    validVerification({ nbf: NOW_SECONDS + 1 }),
    {
      ...validVerification(),
      protectedHeader: { alg: "HS256" }
    }
  ];

  for (const verification of invalidVerifications) {
    const { verifier } = createVerifier(verification);
    await assert.rejects(
      verifier.verify("untrusted-token"),
      error =>
        error instanceof AuthenticationError
        && error.code === "AUTHENTICATION_REQUIRED"
        && error.message === "Authentication is required."
    );
  }
});

test("Auth0TokenVerifier rejects unsafe or inconsistent configuration", () => {
  for (const overrides of [
    { issuer: "http://pilot.au.auth0.com/" },
    { issuer: "https://pilot.au.auth0.com" },
    { issuer: "https://user@pilot.au.auth0.com/" },
    { audience: "" },
    { jwksUri: "https://other.example/.well-known/jwks.json" },
    { jwksUri: "https://pilot.au.auth0.com/keys" }
  ]) {
    assert.throws(
      () => new Auth0TokenVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        jwksUri: JWKS_URI,
        verifyJwt: async () => validVerification(),
        ...overrides
      }),
      /Auth0/
    );
  }
});
