# Secure Pilot Runtime

This contract defines the first supported production-like application bootstrap.
It composes the already-implemented Auth0, membership, PostgreSQL, import, and
Revenue Command Center boundaries without changing their domain semantics. It
does not provision a provider, migrate data, add retention deletion, or certify
external Auth0/SMTP behavior.

## Entrypoints and modes

| Entrypoint | Supported use | Persistence and authorization |
| --- | --- | --- |
| `npm run server` | Local development and compatibility tests | Existing local JSON and unauthenticated behavior |
| `npm run server:pilot` / `npm start` | Pilot and production-like API runtime | Always Auth0 plus membership-derived tenant authorization plus PostgreSQL; no adapter selection or fallback |

Pilot startup validates its complete configuration before opening a listener.
It accepts only a bounded TCP port, a PostgreSQL runtime connection URL, an
exact HTTPS public application origin, an exact HTTPS public API origin, and
exact Auth0 issuer, audience, public SPA client ID, callback URL, and logout URL.
The callback and logout URLs must belong to the public application origin. The
issuer must end in `/`; the JWKS URL is derived as the issuer's exact
`.well-known/jwks.json` endpoint. Empty, whitespace-padded, credential-bearing,
fragmented, wildcard, HTTP, or structurally inconsistent values fail startup.

`TGE_RUNTIME_DATABASE_URL` is exclusively the least-privilege application login.
The migration runner retains its separate `TGE_DATABASE_URL` operator contract;
pilot startup never runs migrations and never accepts that operator URL as a
runtime fallback. Neither URL, tokens, raw import cells, nor provider details are
logged or returned by runtime errors.

## Composition and ownership

The pilot bootstrap constructs dependencies in this order:

1. validate immutable pilot configuration;
2. create one owned bounded PostgreSQL pool;
3. create PostgreSQL repositories and the transaction bridge;
4. create `PostgresAuthRepository` for exact issuer/subject membership lookup;
5. create the existing invitation service with sensitive membership mutation
   and server provisioning denied until dedicated policies are injected in a
   later approved deployment slice;
6. create `Auth0TokenVerifier` and the Auth0 runtime;
7. compose the existing auth-to-persistence `TenantContext` bridge, tenant-bound
   core, import, RevenueAction, RevenueLeakCase, and pilot-evidence APIs; and
8. open the HTTP listener and begin bounded secure-dependency probes.

The API validates the bearer identity and resolves exactly one active membership
before minting the separately branded persistence context. Request body, query,
header, email, role, and custom-claim tenant values are never authority.
PostgreSQL custom GUCs are populated only from that server-created context and
remain defense in depth, not API authorization.

All pilot business routes use the already-established PostgreSQL repositories.
That includes CSV preview, mapping, all-row Data Health, canonical commit,
opportunity intelligence, RevenueAction, RevenueLeakCase scan/queue/handoff, and
privacy-minimized pilot evidence. Local JSON routers are never mounted by the
pilot entrypoint.

## Liveness, secure readiness, and request gating

Pilot health is public and has two meanings:

- `GET /health/live` proves only that this process is listening. It returns 200
  even while secure dependencies are unusable.
- `GET /health/ready` returns 200 only after the complete local secure dependency
  probe succeeds; otherwise it returns bounded 503 state without exception,
  DSN, token, identity, tenant, or customer details.
- `GET /health` is the compatibility alias for liveness and explicitly reports
  that readiness must be checked separately.

Before readiness, only liveness, readiness, and the public browser Auth0
configuration endpoint are reachable. Invitation and business APIs return the
same bounded `SECURE_RUNTIME_NOT_READY` response without attempting partial
work. Once ready, every business API still crosses normal authentication,
membership authorization, tenant predicates, transactions, and forced RLS.

The readiness probe is bounded by configured timeouts and proves:

- the process constructed the exact Auth0 verifier configuration (not that the
  external issuer, Universal Login, SMTP, or OTP delivery is live);
- the database connection uses a non-superuser, non-`BYPASSRLS` login that is a
  member of `tge_runtime`;
- the append-only secure-runtime migration marker and required runtime schema
  objects are installed; and
- the membership repository can execute its exact issuer/subject lookup path
  under the runtime role without acquiring tenant authority.

An append-only migration exposes only the bounded readiness result needed by the
runtime role. It does not grant access to the migration ledger. Failed probes
keep readiness false and are retried at a bounded interval. Runtime logs emit
only stable event/error codes.

## Browser and packaging

The browser remains a separately deployable Vite artifact, as established by the
Pilot foundation. A pilot build must use the dedicated build command and provide
an exact HTTPS `VITE_API_URL` equal to `TGE_PUBLIC_API_URL`; the ordinary local
build remains available for compatibility. At runtime the browser loads public
Auth0 SDK configuration from that API, retains tokens in memory, and sends a
fresh bearer on the existing complete import and Command Center requests. No
browser-supplied tenant identity is introduced.

`npm start` starts only the supported pilot API bootstrap and works with a
portable Node package install. Cloud vendor infrastructure, secret creation,
database migration execution, static-host provisioning, and identity
provisioning remain operator prerequisites.

## Shutdown and limitations

The bootstrap owns the HTTP server, readiness timer, and pool it creates.
`SIGTERM` and `SIGINT` stop readiness work, stop accepting requests, bound the
HTTP drain, and end the pool exactly once. Injected test resources remain
explicitly owned according to their injected cleanup port.

A ready response is local runtime evidence only. It does not prove Auth0 AU
tenant/plan location, real JWKS reachability before a bearer is verified, email
OTP/SMTP delivery, custom-domain configuration, invitation provisioning,
backup/restore, Australian cloud placement, privacy approval, or the deferred
raw-evidence retention/deletion policy. Those remain release gates in the
[Pilot Production Gate](../operations/PILOT_PRODUCTION_GATE.md).
