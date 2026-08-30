# Pilot Readiness

## Outcome

- **PR-0 through PR-2 are COMPLETE.** PR-2's PostgreSQL 16.15 authority remains [GitHub Actions run 33304131266](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33304131266): harness, 68 integration tests, 11 database tests, 7 Chromium E2E tests, and the production build passed.
- **PR-3 is unavailable/not implemented.** Production CRM repositories and transactional RevenueAction persistence remain outside this branch. PR-4 exposes a narrow `TenantContext` transaction port without redesigning that boundary.
- **PR-4 code is implemented pending final CI/review evidence.** It follows GitHub Issue #5's accepted Auth0 Australia New Universal Login + email OTP + Authorization Code Flow with PKCE decision. The old magic-link blocker is removed.
- **PR-5 and later are NOT STARTED.** Import execution, JSON cutover, deployment, and production provisioning remain out of scope.

The canonical architecture is the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md), with the identity path detailed in [Authentication and TenantContext](../../architecture/AUTHENTICATION_AND_TENANT_CONTEXT.md). Provisioning and release evidence live in the [production gate](../../operations/PILOT_PRODUCTION_GATE.md).

## Locked baselines

| Area | Contract |
| --- | --- |
| Current product | Local JSON remains the local runtime/test persistence authority. Deterministic intelligence and manual RevenueAction approval are unchanged. |
| Database foundation | PostgreSQL 16.15 uses append-only migrations. `001` remains 2,752 bytes with SHA-256 `d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62`; PR-4 appends `005_auth_membership_and_invitations.sql`. |
| Identity | Auth0 AU, New Universal Login, passwordless email OTP, Authorization Code Flow with PKCE. No Classic Login, magic links, Auth0 Organizations invitations, or public signup. |
| Authorization | TGE resolves exactly one active membership by `(issuer, subject)`, derives immutable `TenantContext`, and applies centralized OWNER/ADMIN/MEMBER policy. Client tenant, email, role, headers, query values, and JWT custom claims are never authority. |
| Isolation | Server authorization, explicit tenant repository predicates, and forced PostgreSQL RLS remain separate required layers. Transaction-local GUCs are trusted server inputs only after membership resolution. |
| Invitations | OWNER-only assisted invitations are expiring, revocable, single-use, hashed at rest, identity-bound after server provisioning, and atomically consumed with membership/audit evidence. Sensitive changes cross a reauthentication/MFA-ready injected policy. |
| PR-3 seam | `PostgresAuthRepository.run(TenantContext, work)` sets issuer, subject, and tenant transaction-locally. Auth mode returns `503 TENANT_PERSISTENCE_UNAVAILABLE` for business APIs until an explicit tenant-persistence boundary is supplied; no production CRM repository or cutover is claimed. |
| Provisioning | Real Auth0 AU tenant/plan, custom domain, SMTP, sender authentication, callback/logout/origin configuration, and external OTP E2E remain deployment gates. |

## PR-4 implementation

### Server boundary

- `Auth0TokenVerifier` pins one exact HTTPS issuer, audience, issuer JWKS endpoint, RS256, expiry, issued-at, and subject requirements. Failures are generic and never log token/verifier detail.
- `resolveTenantContext` accepts only server repository results. Missing, inactive, mismatched, or ambiguous membership fails closed.
- The role matrix is one testable policy. OWNER alone receives invitation/member security permissions; ADMIN and MEMBER cannot acquire them through request input.
- Cross-tenant and nonexistent resources share a non-oracle denial contract.

### Assisted invitation boundary

1. An authenticated OWNER crosses the sensitive-action policy and creates an `ADMIN` or `MEMBER` invitation.
2. The raw 256-bit token is returned once; only SHA-256 is stored.
3. A server-only provisioning policy records the exact expected Auth0 `(issuer, subject)`.
4. A POST landing action validates the exact callback allowlist before browser authentication begins.
5. Auth0 SPA SDK handles state and PKCE; the API independently validates the resulting bearer token.
6. PostgreSQL locks the pending invitation, rejects expiry/revocation/replay/mismatch/ambiguity generically, activates membership, consumes the invitation, and appends audit evidence in one transaction.

### Append-only database change

Migration `005` keeps migrations `001`–`004` unchanged. It adds issuer and lifecycle status to memberships, changes membership identity to `(tenant_id, identity_issuer, subject_id)`, adds invitation storage/RLS, adds identity/request context functions, and exposes only narrow runtime functions for invitation availability and atomic consumption. PR-2's non-bypass runtime role, forced RLS, immutable audit history, global `PUBLIC EXECUTE` revocation, and legacy-`public` quarantine remain intact.

## Deployment-gated Auth0 acceptance

The real flow is not locally provable without external credentials. A dedicated AU non-production Auth0 tenant and test SMTP/email-capture provider must:

1. record the test start before triggering Universal Login email OTP;
2. retrieve only the newest matching message created after the start;
3. submit the latest OTP and prove earlier/replayed OTP rejection;
4. prove invited membership succeeds and provisioned-but-uninvited identity receives no `TenantContext`;
5. prove exact callback, logout, and origin allowlists; and
6. remove generated users, invitations, and messages.

No local mock or deterministic seam may be reported as real Auth0/SMTP proof.

## Slices

- [x] **PR-0 — foundation contract.**
- [x] **PR-1 — legacy compatibility characterization.**
- [x] **PR-2 — schema/security foundation with real PostgreSQL CI proof.**
- [ ] **PR-3 — unavailable/not implemented.**
- [x] **PR-4 — code and deterministic contracts implemented; final GitHub `verify`/review pending before merge.**
- [ ] **PR-5–PR-7 — not started and outside this work unit.**

## Verification

| Level | Command/evidence | Current result |
| --- | --- | --- |
| Focused auth | `node --test test/authentication.test.js test/authorization.test.js test/invitations.test.js test/auth-api.test.js test/browser-auth-contract.test.js test/postgres-auth-repository.test.js test/database-migrations-static.test.js` | **PASS: 35/35** after syntax checks for the new server modules. |
| Integration | `OPENSSL_CONF=/dev/null npm run test:integration` | **PASS: 97/97.** |
| Harness | `OPENSSL_CONF=/dev/null npm run test:harness` | **PASS.** |
| Database | `npm run test:db` | **BLOCKED LOCALLY:** the command correctly failed because `TGE_TEST_DATABASE_URL` is absent and this host has no Docker/PostgreSQL endpoint. GitHub `verify` is required before merge. |
| Browser | `npm run test:e2e` | **PASS: 7/7** against the managed temporary local store. Real Auth0/email flow remains deployment-gated. |
| Build | `OPENSSL_CONF=/dev/null npm run build` | **PASS:** 21 modules transformed. |
| Hygiene | `git diff --check` | **PASS.** |

## Remaining gates

- Fresh-context auth/security review and GitHub Actions `verify` must be green before merge.
- Auth0 AU plan/tenant, domain, transactional SMTP, SPF/DKIM/DMARC, privacy/DPA, and real OTP E2E evidence remain required before external invitations.
- PR-3 production CRM repositories must consume the trusted transaction seam before production data access; local JSON remains authoritative until an explicit cutover.
