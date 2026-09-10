# Pilot Readiness

## Outcome

- **PR-0 through PR-2 are COMPLETE.** PR-2's PostgreSQL 16.15 authority remains [GitHub Actions run 33304131266](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33304131266): harness, 68 integration tests, 11 database tests, 7 Chromium E2E tests, and the production build passed.
- **PR-3 and PR-4 are integrated in code, complete, and merged through [PR #16](https://github.com/yarinperetz1313/trade-growth-engine/pull/16) at `b0a8e36`.** PR #16 closed [Issue #2](https://github.com/yarinperetz1313/trade-growth-engine/issues/2) and [Issue #5](https://github.com/yarinperetz1313/trade-growth-engine/issues/5). Tenant-aware PostgreSQL repositories and transactional RevenueAction execution consume PR-4 membership authority through a server-only bridge between independently branded contexts. The old magic-link blocker is removed.
- **Combined verification is COMPLETE at `9fe7cea`.** [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) passed the engineering harness, 129 integration tests, 44 PostgreSQL 16.15 database tests, 7 managed Chromium tests, and the production build. Fresh combined review found no P0, P1, or P3 findings; its only P2 was stale status text corrected in this record.
- **PR-5A implements bounded CSV staging/preview; PR-5B implements draft mapping, validation, and Data Health; PR-5C implements controlled atomic canonical commit and existing-ID-map reconciliation; PR-5D implements the contract-mocked browser workflow and adversarial browser states.** Raw-evidence retention/deletion acceptance and implementation are explicitly deferred to a separate reviewed follow-up. JSON cutover, deployment, and production provisioning remain out of scope.
- **TGE Assisted Pilot Safety Gate V1 PR-1 is COMPLETE as a verified local checkpoint from pinned base `e5e8f5fc432caa52b879bfa92a56bd6946ae89f9`.** The explicit secure pilot runtime/readiness bootstrap described in [Secure Pilot Runtime](../../architecture/SECURE_PILOT_RUNTIME.md) was initially implemented through `e6aa122`; the bounded three-finding security remediation is checkpointed at `1718556`, followed by the final bounded startup-logging remediation recorded below. GitHub delivery, external provisioning, retention deletion, currency, and later milestone slices remain out of scope.

The canonical architecture is the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md), with the identity path detailed in [Authentication and TenantContext](../../architecture/AUTHENTICATION_AND_TENANT_CONTEXT.md). Provisioning and release evidence live in the [production gate](../../operations/PILOT_PRODUCTION_GATE.md).

## Locked baselines

| Area | Contract |
| --- | --- |
| Current product | Local JSON remains the local runtime/test persistence authority. Deterministic intelligence and manual RevenueAction approval are unchanged. |
| Database foundation | PostgreSQL 16.15 uses append-only migrations. `001` remains 2,752 bytes with SHA-256 `d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62`; PR-3 owns unchanged migrations `005`–`009`; PR-4 follows with `010_auth_membership_and_invitations.sql`; PR-5C appends `011_canonical_import_commit.sql`; Issue #8 appends `012_revenue_leak_case_foundation.sql`; pilot evidence appends `013_privacy_minimized_pilot_evidence.sql`; this slice appends `014_secure_pilot_runtime_readiness.sql`. |
| Identity | Auth0 AU, New Universal Login, passwordless email OTP, Authorization Code Flow with PKCE. No Classic Login, magic links, Auth0 Organizations invitations, or public signup. |
| Authorization | TGE resolves exactly one active membership by `(issuer, subject)`, derives immutable `TenantContext`, and applies centralized OWNER/ADMIN/MEMBER policy. Client tenant, email, role, headers, query values, and JWT custom claims are never authority. |
| Isolation | Server authorization, explicit tenant repository predicates, and forced PostgreSQL RLS remain separate required layers. Transaction-local GUCs are trusted server inputs only after membership resolution. |
| Invitations | OWNER-only assisted invitations are expiring, revocable, single-use, hashed at rest, identity-bound after server provisioning, and atomically consumed with membership/audit evidence. Sensitive changes cross a reauthentication/MFA-ready injected policy. |
| Combined runtime | The server validates the auth context, mints a separate PR-3 persistence context from tenant ID and subject, and injects it into tenant-scoped PostgreSQL routers/transactions. Auth mode returns `503 TENANT_PERSISTENCE_UNAVAILABLE` without the adapter/bridge. JSON remains the default local/test adapter; no cutover is claimed. |
| Provisioning | Real Auth0 AU tenant/plan, custom domain, SMTP, sender authentication, callback/logout/origin configuration, and external OTP E2E remain deployment gates. |
| Secure pilot runtime | Local `server` remains JSON-compatible. Only `server:pilot`/`start` is supported for Pilot: exact validated configuration, Auth0 plus membership authorization, least-privilege PostgreSQL only, separate liveness/readiness, pre-readiness request gating, bounded probes/retries, and owned graceful shutdown. Readiness proves local wiring/database/migration usability only. |

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
- [x] **PR-5B — draft mapping, validation, and Data Health analysis.**
- [x] **PR-5C — controlled atomic canonical commit and ID-map reconciliation.**
- [x] **PR-5D — contract-mocked browser upload, preview, mapping, Data Health, confirmation, commit, result, and adversarial state coverage.**
- [ ] **Raw-evidence retention/deletion acceptance remains a separately reviewed
  follow-up.** The earlier generic PR-6/PR-7 labels were planning placeholders,
  not concrete unmerged code or dependencies, and are no longer used as roadmap
  authority.
- [x] **Assisted Pilot Safety Gate V1 PR-1 — secure pilot runtime and readiness.**
  The explicit fail-closed bootstrap, append-only readiness probe, protected
  request gate, portable commands, exact configuration validation, graceful
  cleanup, and authenticated PostgreSQL import/operating-loop evidence are
  complete. Providers were not provisioned and PR-2 was not started.

### Assisted Pilot Safety Gate V1 PR-1 execution decisions

| Area | Decision | Acceptance evidence |
| --- | --- | --- |
| Entrypoints | Preserve `npm run server` for local JSON compatibility. Add `npm run server:pilot` and `npm start` as the only Pilot bootstrap; it has no adapter flag or fallback. | Startup/config regressions and package contract |
| Configuration | Require bounded port, `TGE_RUNTIME_DATABASE_URL`, exact HTTPS public app/API URLs, and exact Auth0 issuer/audience/client/callback/logout values before listen. Derive exact issuer JWKS. Never use the migration/operator URL as runtime fallback. | Missing/invalid matrix; no-secret error assertions |
| Composition | One owned pool feeds persistence, `PostgresAuthRepository`, invitation service, Auth0 verifier/runtime, the branded auth-to-persistence bridge, and every current PostgreSQL business router. Sensitive invitation administration/provisioning remains denied without later injected policies. | Component tests plus authenticated real-PostgreSQL HTTP journey |
| Health gate | `/health/live` and `/health` are liveness only. `/health/ready` requires configured auth plus the bounded runtime-role/schema/membership-path probe. Except for health and `/api/auth/config`, APIs return `SECURE_RUNTIME_NOT_READY` until ready. | Listening/not-ready/ready and dependency-failure regressions |
| Database proof | Append one migration exposing only a bounded runtime readiness result; verify the login is non-superuser/non-`BYPASSRLS` and has no direct or transitive role membership beyond `tge_runtime`, plus current marker/schema and membership lookup. Runtime cannot read the migration ledger and never runs migrations. | Static and PostgreSQL 16 tests, including privileged dual-role rejection |
| Browser | Keep separate static hosting. A pilot build validates exact HTTPS `VITE_API_URL === TGE_PUBLIC_API_URL`; browser Auth0 config still comes from `/api/auth/config` and existing memory-only PKCE/bearer paths remain authoritative. | Browser/build configuration contract; managed Chromium only if browser behavior changes |
| Cleanup | The runtime owns its readiness loop, HTTP listener, and created pool; signals and explicit close freeze readiness closed, stop new probes, boundedly await in-flight work, and release resources exactly once with bounded HTTP and pool drains. Owned pool errors invalidate readiness through a stable-code-only handler. | Pool-error, timeout/single-flight, shutdown/idempotency, and post-close immutability regressions |
| Explicit limits | Ready is not live Auth0/JWKS/SMTP/OTP, provisioning, region, backup/restore, privacy, or retention-deletion proof. No secrets, DSNs, tokens, raw cells, tenant/customer data, or cross-tenant existence appear in normalized errors. | Response/log assertions and final gate statement |

## Verification

| Level | Command/evidence | Recorded result |
| --- | --- | --- |
| PR-1 product-red | `node --test test/pilot-runtime.test.js`; `node --test test/database-migrations-static.test.js`; later focused `bootstrap releases` and `package scripts` name patterns | **EXPECTED FAIL:** initial runtime **0/9** because the Pilot modules/scripts did not exist; initial migration contract **14/16** because migration `014` did not exist; the added pre-listener composition-cleanup regression failed **0/1** because the owned pool was not released. The later source-text packaging assertion checked only the entrypoint's quiet dotenv call and did not prove process output. |
| PR-1 focused runtime/auth | `node --test test/pilot-runtime.test.js test/auth-api.test.js` | **PASS: 20/20.** Covers exact fail-closed configuration, no runtime-DSN/JSON/unauthenticated fallback, listening versus readiness, bounded dependency failures, membership denial, normalized errors, and idempotent owned-resource cleanup. |
| PR-1 Pilot browser build | `TGE_PUBLIC_API_URL=https://api.example.test VITE_API_URL=https://api.example.test npm run build:pilot`; artifact checks for the configured origin and absence of `localhost:3000` | **PASS:** Vite 8.2.2 built 31 modules; the artifact contains only the requested API origin. Existing >500 kB chunk warning remains non-blocking. |
| PR-1 real PostgreSQL 16.15 focused gate | `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:db` against a disposable Homebrew PostgreSQL 16.15 cluster | **PASS: 66/66.** Proves migration/role readiness, migration-ledger denial, authenticated membership-derived tenant authority through CSV preview → mapping/Data Health → commit → scan/Command Center, forged identity rejection, and cross-tenant isolation. Cluster stopped and removed. |
| PR-1 full local gate at `2ec4bfd` | `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run verify` against a fresh disposable Homebrew PostgreSQL 16.15 cluster | **PASS:** harness; integration **351/351**; database **66/66**; managed Chromium **51/51**; production build (Vite 8.2.2, 31 modules). Cluster stopped and removed. This is local evidence, not GitHub CI or provider proof. |
| Slice 1 security-red at `e6aa122` | Three focused `node --test --test-name-pattern=...` commands for migration membership, owned-pool error, and readiness lifecycle | **EXPECTED FAIL: 0/1 each.** Migration 014 lacked a role-membership deny contract; an unhandled pool `error` rethrew sensitive provider detail; timed-out readiness work was cleared and close ended the pool before the probe settled. |
| Slice 1 focused green at `1718556` | `node --test test/database-migrations-static.test.js`; `node --test test/pilot-runtime.test.js test/auth-api.test.js` | **PASS:** migration static **17/17**; runtime/auth **23/23**. Covers the runtime-only membership allowlist, normalized pool errors, in-flight close ordering, timeout single-flight, no post-close readiness mutation, idempotency, and bounded pool shutdown. |
| Slice 1 PostgreSQL 16.15 at `1718556` | `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:db` against a fresh disposable Homebrew PostgreSQL 16.15 cluster | **PASS: 67/67.** The least-privilege login succeeds; added membership in `tge_owner`, `tge_migrator`, or a custom role with schema `CREATE` authority fails readiness. Migration-ledger denial and the existing authenticated tenant journey remain green. Cluster stopped and removed. |
| Slice 1 proportional gate at `1718556` | `npm run verify:fast`; `npm run build`; `git diff --check`; migration 001–013 hash comparison | **PASS:** harness; integration **355/355**; Vite 8.2.2 production build **31 modules** in 453 ms; clean diff check; migrations 001–013 byte-identical. Managed Chromium was not rerun because no browser behavior changed; no independent final review was performed per the bounded stop condition. |
| Slice 1 final startup-logging remediation | At `1ff1070`, focused `node --test --test-name-pattern='invalid pilot startup emits only its stable failure line' test/pilot-runtime.test.js`; then the same command after making the shared dotenv load quiet; `node --test test/pilot-runtime.test.js test/auth-api.test.js`; `node --test test/legacy-json-compatibility.test.js`; `npm run verify:fast`; `npm run build`; `git diff --check` | **EXPECTED RED: 0/1** because the real subprocess wrote dotenv promotional/loading metadata to stdout. **GREEN:** subprocess **1/1** with empty stdout and exactly `PILOT_RUNTIME_START_FAILED` on stderr; Pilot/auth **24/24**; local JSON compatibility **5/5**; harness plus integration **356/356**; Vite 8.2.2 build **31 modules** in 389 ms; clean diff check. The obsolete source-text assertion was removed. Database and managed Chromium gates were not rerun because no schema, auth/tenancy/readiness, or browser behavior changed. |
| PR-5A initial full local gate at `178409c` | `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run verify` against an isolated PostgreSQL 16.15 cluster | **PASS:** harness; integration **142/142**; database **45/45**; managed Chromium **14/14**; production build. The temporary database cluster was removed after verification. This is historical evidence for that checkpoint. |
| PR-5A bounded review-fix checkpoint (parent `dc5e3c9`) | `npm run verify:fast` on the code and tests recorded by this document's checkpoint | **PASS:** harness; integration **144/144**. Database, managed Chromium, and production build were not rerun for this bounded transport-error fix. |
| PR-5C controlled canonical commit | `npm run verify:fast`; `TGE_TEST_DATABASE_URL=postgresql://127.0.0.1:55433/postgres npm run test:db` against disposable PostgreSQL 16.15; `npm run build` | **PASS:** harness; integration **174/174**; database **47/47**; production build (Vite 8.2.2, 22 modules). Browser E2E was intentionally not run because PR-5D/browser flow is outside this slice. The disposable cluster was stopped and removed. |
| Focused combined auth + persistence | `OPENSSL_CONF=/dev/null node --test test/authentication.test.js test/authorization.test.js test/invitations.test.js test/auth-api.test.js test/browser-auth-contract.test.js test/postgres-auth-repository.test.js test/postgres-persistence.test.js test/revenue-actions-api.test.js` | **PASS: 79/79.** This includes the trusted-context bridge and fail-closed adapter boundary. |
| Integration | [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) at `9fe7cea` | **PASS: 129/129.** |
| Real PostgreSQL 16.15 | [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) at `9fe7cea` | **PASS: 44/44.** |
| Harness, build, managed E2E | [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) at `9fe7cea` | **PASS:** engineering harness and production build green; managed Chromium **7/7**. |
| Real Auth0 AU + SMTP OTP | Production gate | **DEPLOYMENT-GATED:** local seams are not external provider proof. |
| Hygiene and review | `git diff --check`, migration body hashes, fresh combined review | **PASS:** PR-3 migrations `005`–`009` and renamed PR-4 migration `010` are byte-identical to their reviewed branch bodies; no stale `005_auth_membership_and_invitations.sql` reference remains. Review found no P0/P1/P3; its only P2 was this now-corrected status evidence. |

## Remaining gates

- Auth0 AU plan/tenant, domain, transactional SMTP, SPF/DKIM/DMARC, privacy/DPA, and real OTP E2E evidence remain required before external invitations.
- Local JSON remains supported only by the explicit local compatibility entrypoint;
  the Pilot entrypoint cannot select or fall back to it. Production Auth0 AU,
  SMTP/domain, provisioning, region, backup/restore, privacy, retention deletion,
  and real OTP evidence remain gated.
