# Pilot Readiness

## Outcome

- **PR-0 through PR-2 are COMPLETE.** PR-2's PostgreSQL 16.15 authority remains [GitHub Actions run 33304131266](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33304131266): harness, 68 integration tests, 11 database tests, 7 Chromium E2E tests, and the production build passed.
- **PR-3 and PR-4 are integrated in code, complete, and merged through [PR #16](https://github.com/yarinperetz1313/trade-growth-engine/pull/16) at `b0a8e36`.** PR #16 closed [Issue #2](https://github.com/yarinperetz1313/trade-growth-engine/issues/2) and [Issue #5](https://github.com/yarinperetz1313/trade-growth-engine/issues/5). Tenant-aware PostgreSQL repositories and transactional RevenueAction execution consume PR-4 membership authority through a server-only bridge between independently branded contexts. The old magic-link blocker is removed.
- **Combined verification is COMPLETE at `9fe7cea`.** [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) passed the engineering harness, 129 integration tests, 44 PostgreSQL 16.15 database tests, 7 managed Chromium tests, and the production build. Fresh combined review found no P0, P1, or P3 findings; its only P2 was stale status text corrected in this record.
- **PR-5A implements the bounded CSV contract, immutable staging, and preview only.** PR-5B/5C/5D, import commit, JSON cutover, deployment, and production provisioning remain out of scope.

The canonical architecture is the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md), with the identity path detailed in [Authentication and TenantContext](../../architecture/AUTHENTICATION_AND_TENANT_CONTEXT.md). Provisioning and release evidence live in the [production gate](../../operations/PILOT_PRODUCTION_GATE.md).

## Locked baselines

| Area | Contract |
| --- | --- |
| Current product | Local JSON remains the local runtime/test persistence authority. Deterministic intelligence and manual RevenueAction approval are unchanged. |
| Database foundation | PostgreSQL 16.15 uses append-only migrations. `001` remains 2,752 bytes with SHA-256 `d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62`; PR-3 owns unchanged migrations `005`–`009`; PR-4 follows with `010_auth_membership_and_invitations.sql`. |
| Identity | Auth0 AU, New Universal Login, passwordless email OTP, Authorization Code Flow with PKCE. No Classic Login, magic links, Auth0 Organizations invitations, or public signup. |
| Authorization | TGE resolves exactly one active membership by `(issuer, subject)`, derives immutable `TenantContext`, and applies centralized OWNER/ADMIN/MEMBER policy. Client tenant, email, role, headers, query values, and JWT custom claims are never authority. |
| Isolation | Server authorization, explicit tenant repository predicates, and forced PostgreSQL RLS remain separate required layers. Transaction-local GUCs are trusted server inputs only after membership resolution. |
| Invitations | OWNER-only assisted invitations are expiring, revocable, single-use, hashed at rest, identity-bound after server provisioning, and atomically consumed with membership/audit evidence. Sensitive changes cross a reauthentication/MFA-ready injected policy. |
| Combined runtime | The server validates the auth context, mints a separate PR-3 persistence context from tenant ID and subject, and injects it into tenant-scoped PostgreSQL routers/transactions. Auth mode returns `503 TENANT_PERSISTENCE_UNAVAILABLE` without the adapter/bridge. JSON remains the default local/test adapter; no cutover is claimed. |
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

PR-3 migrations `005`–`009` remain byte-identical. PR-4 migration `010` keeps migrations `001`–`009` unchanged. It adds issuer and lifecycle status to memberships, changes membership identity to `(tenant_id, identity_issuer, subject_id)`, adds invitation storage/RLS, adds identity/request context functions, and exposes only narrow runtime functions for invitation availability and atomic consumption. PR-2's non-bypass runtime role, forced RLS, immutable audit history, global `PUBLIC EXECUTE` revocation, and legacy-`public` quarantine remain intact.

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
- [x] **PR-3 — persistence implemented and integrated; completed through merged PR #16.**
- [x] **PR-4 — auth implemented and integrated; completed through merged PR #16.**
- [x] **PR-5A — CSV contract, parser limits, immutable staging, and preview.**
- [ ] **PR-5B–PR-7 — not started and outside this work unit.**

## Verification

| Level | Command/evidence | Current result |
| --- | --- | --- |
| PR-5A full local gate | `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run verify` against an isolated PostgreSQL 16.15 cluster | **PASS:** harness; integration **142/142**; database **45/45**; managed Chromium **14/14**; production build. The temporary database cluster was removed after verification. |
| Focused combined auth + persistence | `OPENSSL_CONF=/dev/null node --test test/authentication.test.js test/authorization.test.js test/invitations.test.js test/auth-api.test.js test/browser-auth-contract.test.js test/postgres-auth-repository.test.js test/postgres-persistence.test.js test/revenue-actions-api.test.js` | **PASS: 79/79.** This includes the trusted-context bridge and fail-closed adapter boundary. |
| Integration | [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) at `9fe7cea` | **PASS: 129/129.** |
| Real PostgreSQL 16.15 | [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) at `9fe7cea` | **PASS: 44/44.** |
| Harness, build, managed E2E | [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) at `9fe7cea` | **PASS:** engineering harness and production build green; managed Chromium **7/7**. |
| Real Auth0 AU + SMTP OTP | Production gate | **DEPLOYMENT-GATED:** local seams are not external provider proof. |
| Hygiene and review | `git diff --check`, migration body hashes, fresh combined review | **PASS:** PR-3 migrations `005`–`009` and renamed PR-4 migration `010` are byte-identical to their reviewed branch bodies; no stale `005_auth_membership_and_invitations.sql` reference remains. Review found no P0/P1/P3; its only P2 was this now-corrected status evidence. |

## Remaining gates

- Auth0 AU plan/tenant, domain, transactional SMTP, SPF/DKIM/DMARC, privacy/DPA, and real OTP E2E evidence remain required before external invitations.
- Local JSON remains authoritative until an explicit cutover. Production Auth0 AU, SMTP/domain, provisioning, and real OTP evidence remain gated.
