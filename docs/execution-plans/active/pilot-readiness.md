# Pilot Readiness

## Outcome

- **PR-0 through PR-2 are COMPLETE.** PR-2's PostgreSQL 16.15 authority remains [GitHub Actions run 33304131266](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33304131266): harness, 68 integration tests, 11 database tests, 7 Chromium E2E tests, and the production build passed.
- **PR-3 and PR-4 are integrated in code, complete, and merged through [PR #16](https://github.com/yarinperetz1313/trade-growth-engine/pull/16) at `b0a8e36`.** PR #16 closed [Issue #2](https://github.com/yarinperetz1313/trade-growth-engine/issues/2) and [Issue #5](https://github.com/yarinperetz1313/trade-growth-engine/issues/5). Tenant-aware PostgreSQL repositories and transactional RevenueAction execution consume PR-4 membership authority through a server-only bridge between independently branded contexts. The old magic-link blocker is removed.
- **Combined verification is COMPLETE at `9fe7cea`.** [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854) passed the engineering harness, 129 integration tests, 44 PostgreSQL 16.15 database tests, 7 managed Chromium tests, and the production build. Fresh combined review found no P0, P1, or P3 findings; its only P2 was stale status text corrected in this record.
- **PR-5A implements bounded CSV staging/preview; PR-5B implements draft mapping, validation, and Data Health; PR-5C implements controlled atomic canonical commit and existing-ID-map reconciliation; PR-5D implements the contract-mocked browser workflow and adversarial browser states.** Slice 2 separately implements the reviewed raw-evidence retention/deletion boundary. JSON cutover, deployment, and production provisioning remain out of scope.
- **TGE Assisted Pilot Safety Gate V1 PR-1 is COMPLETE as a verified local checkpoint from pinned base `e5e8f5fc432caa52b879bfa92a56bd6946ae89f9`.** The explicit secure pilot runtime/readiness bootstrap described in [Secure Pilot Runtime](../../architecture/SECURE_PILOT_RUNTIME.md) was initially implemented through `e6aa122`; the bounded three-finding security remediation is checkpointed at `1718556`, followed by the final bounded startup-logging remediation recorded below. GitHub delivery, external provisioning, retention deletion, currency, and later milestone slices remain out of scope.
- **TGE Assisted Pilot Safety Gate V1 Slice 2 is COMPLETE as a locally verified checkpoint from exact base `873ae275590acbfe89cc0752f1774e40950d5ad0`.** Starting invariants were verified on 2026-09-10: the required `raw-import-expiry-offboarding` worktree and `feat/raw-import-expiry-offboarding` branch, HEAD/base/merge-base all `873ae275590acbfe89cc0752f1774e40950d5ad0`, ancestry `0 behind / 0 ahead`, empty normal and ignored/untracked status, and no `node_modules` or `dist`. The bounded slice implements database-authoritative seven-day raw-import expiry and narrow, staged tenant access/raw-evidence offboarding. It does not implement opportunity currency, provider provisioning, an operator runbook, or a legally unapproved canonical CRM deletion policy.
- **TGE Assisted Pilot Safety Gate V1 Slice 3 is COMPLETE as a locally verified checkpoint candidate from exact base `9dc155912be7df46c23b2aa30facddeda7b4baa8`; coordinator-led independent review, exact-head GitHub gates, and merge remain pending.** Starting invariants were verified on 2026-09-11: the required `authoritative-opportunity-currency` worktree and `feat/authoritative-opportunity-currency` branch, HEAD/local main/origin main/merge-base all at the required base, ancestry `0 behind / 0 ahead`, empty normal and ignored/untracked status, and no `node_modules` or `dist`. The approved slice is limited to one optional authoritative opportunity currency through local JSON compatibility, PostgreSQL persistence, CSV mapping/Data Health/canonical commit, deterministic leak-value consumption, and relevant browser presentation. Missing currency remains unknown; no default, inference, FX, tenant currency policy, analytics expansion, provider work, runbook acceptance, or later slice is included.

The canonical architecture is the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md), with the identity path detailed in [Authentication and TenantContext](../../architecture/AUTHENTICATION_AND_TENANT_CONTEXT.md). Provisioning and release evidence live in the [production gate](../../operations/PILOT_PRODUCTION_GATE.md).

## Locked baselines

| Area | Contract |
| --- | --- |
| Current product | Local JSON remains the local runtime/test persistence authority. Deterministic intelligence and manual RevenueAction approval are unchanged. |
| Database foundation | PostgreSQL 16.15 uses append-only migrations. `001` remains 2,752 bytes with SHA-256 `d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62`; PR-3 owns unchanged migrations `005`–`009`; PR-4 follows with `010_auth_membership_and_invitations.sql`; PR-5C appends `011_canonical_import_commit.sql`; Issue #8 appends `012_revenue_leak_case_foundation.sql`; pilot evidence appends `013_privacy_minimized_pilot_evidence.sql`; secure Pilot readiness appends `014_secure_pilot_runtime_readiness.sql`; Slice 2 appends `015_raw_import_expiry_tenant_offboarding.sql`; Slice 3 appends `016_authoritative_opportunity_currency.sql`. |
| Identity | Auth0 AU, New Universal Login, passwordless email OTP, Authorization Code Flow with PKCE. No Classic Login, magic links, Auth0 Organizations invitations, or public signup. |
| Authorization | TGE resolves exactly one active membership by `(issuer, subject)`, derives immutable `TenantContext`, and applies centralized OWNER/ADMIN/MEMBER policy. Client tenant, email, role, headers, query values, and JWT custom claims are never authority. |
| Isolation | Server authorization, explicit tenant repository predicates, and forced PostgreSQL RLS remain separate required layers. Transaction-local GUCs are trusted server inputs only after membership resolution. |
| Invitations | OWNER-only assisted invitations are expiring, revocable, single-use, hashed at rest, identity-bound after server provisioning, and atomically consumed with membership/audit evidence. Sensitive changes cross a reauthentication/MFA-ready injected policy. |
| Combined runtime | The server validates the auth context, mints a separate PR-3 persistence context from tenant ID, identity issuer, and subject, and injects it into tenant-scoped PostgreSQL routers/transactions. Auth mode returns `503 TENANT_PERSISTENCE_UNAVAILABLE` without the adapter/bridge. JSON remains the default local/test adapter; no cutover is claimed. |
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

## Assisted Pilot Safety Gate V1 Slice 3 bounded plan

### Grounded currency boundary

- `opportunity.currency` is the single optional authoritative field. A supplied value is valid only as an exact uppercase three-letter ASCII code matching `^[A-Z]{3}$`; no locale, tenant, amount, prospect, other row, browser state, or formatter supplies or normalizes it. Missing or explicit null remains unknown. Malformed, padded, lowercase, non-string, or otherwise non-lossless supplied currency fails closed at mapping or persistence boundaries.
- Amount and currency are independent evidence. A valid amount without currency remains commercially unknown for RevenueLeakCase; currency without a valid amount does not create known commercial value. Known zero still requires authoritative currency. No probability, expected value, recovered value, cross-currency total, or FX behavior is added.
- Local JSON remains the local authority and retains unknown JSON-compatible fields. Existing records without `currency` remain readable without adding a fabricated property. PostgreSQL remains tenant-scoped and append-only; existing rows gain nullable unknown currency only, with no JSON cutover or dual write.

### Direct `orch-add-feature` fallback

1. Add genuinely new RED tests for exact valid/missing/null/invalid currency; JSON backward compatibility and unknown-field preservation; PostgreSQL mapper/round-trip/update behavior; CSV proposal, row validation, Data Health, canonical materialization, fingerprints, exact duplicate replay and evidence minimization; detector known/unknown/suppression semantics; browser response-vector validation, mapping flow, and non-default presentation; migration/RLS/least-privilege/tenant-isolation behavior.
2. Append only `016_authoritative_opportunity_currency.sql`, adding a nullable constrained opportunity currency column without changing migrations `001`–`015`, grants, RLS, tenant predicates, decimal columns, or canonical-commit transaction/lock behavior. Advance only the schema/readiness/harness assertions required by the append-only migration.
3. Implement one shared server-side currency contract across opportunity PostgreSQL mappers and CSV mapping/commit. Carry exact authoritative currency through canonical payload fingerprints, import provenance, repository reads and ordinary updates while preserving unknown payload fields and absent JSON shape. Make the detector consume only that persisted field and reject noncanonical evidence rather than normalizing it.
4. Extend the strict browser import contract and fixtures with the complete optional currency field. Remove AUD-specific opportunity-entry/presentation fallbacks; render an explicit currency only when the opportunity supplies a canonical code, otherwise present the recorded amount without inventing a unit. Do not redesign portfolio/pipeline analytics or introduce cross-currency aggregation.
5. Turn focused tests GREEN without weakening validation, authorization, RLS, least privilege, audit/evidence minimization, timeouts, or production gates. Self-review the actual diff for scope, information leakage, replay identity, unknown preservation, and migration immutability.
6. Run focused integration and browser-contract tests, migration static tests, real PostgreSQL 16.15 tests, engineering harness, `git diff --check`, `npm run verify:fast`, production build, managed Chromium, and full `npm run verify` against a fresh disposable PostgreSQL 16.15 service when available. Record exact results here and in `docs/PROJECT_STATE.md`; remove services, dependencies, `dist`, and test artifacts; confirm clean ignored/untracked status; then create the authorized checkpoint commit without GitHub or main-branch actions.

### Slice 3 starting migration integrity evidence

Before edits, migrations `001`–`015` were byte-identical to base `9dc155912be7df46c23b2aa30facddeda7b4baa8`. Their SHA-256 values are, in order: `d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62`, `a95f94263c5a1dd1a246a3be905e7f27bd5f4222ba871c137cf90fa2faf17c1c`, `311a02a67deb09ad44b2782f90c2ff3c67d6a537ca9b9ed1f116cafd37a149a8`, `ad9633daf1dd791c8889c79745d8741bace24e0827b76d3fec59d6d73371aa2d`, `2e9bc0029cbfdc03828de7784aa19014de3f7e988cc8f5668bcacd729e206a66`, `f110d2f7937c6133ed1785df05be8c3ca725add7d207a6d94b8a27610b3bca6f`, `514d12b74519405b28e76960244483880f01092b30bcac650a97f247469f4dc6`, `7e4f8b74df1ecc496fa6c7ac8b55169d3e7db7efccdcf3f1f7d0ad37aa95cd72`, `f248d2d5a7363331cd4f4732551a62f9ac28f3315ad5e9777ded1547657d3736`, `fcb19ddba6c2d5bc654af0c3a3172505675dd5c4160876d717b51943b2863e03`, `df50ee0697bb7849b3575f9f5aef40673855ec77a4ebcfcd0cf0d8d5e59ca04b`, `0ec9ffaf16987d84b319b6dc579edea86bbedcd3cff65f8b9d881f9c4dbba6d8`, `b27c7d6c69990f459b1e51c0d902d55f6a1f44fbf17accb69459b2c26465f6a8`, `699cb9c1e7fc4319f71cf7e98e99934706f9f75a8f0f00ae9c22ff90c5c9ea10`, and `1f33b8656dbd2c3a05adc9a540412efcac41a8540673bee0e52e510b0e40fcd5`.

### Slice 3 initial RED evidence

The dependency-free focused command `node --test test/opportunity-currency.test.js test/import-mapping.test.js test/stalled-opportunity-detector.test.js test/import-browser-contracts.test.js test/database-migrations-static.test.js` was **EXPECTED RED: 55 passed / 9 failed** on unchanged product code. The failures prove that migration `016` does not exist, PostgreSQL mapping does not carry or validate currency, deterministic import and the strict browser vector omit currency, and the detector still normalizes lowercase/padded currency instead of requiring exact authoritative evidence. The browser formatter regression was **1/2**, exposing the hard-coded AUD result `$1,251` instead of explicit or unknown currency truth. After installing the locked dependencies, focused canonical-commit currency tests were **0/2** because currency was not a supported reviewed target, and the local HTTP value-action regression was **0/1** because the action dropped explicit `AUD`. A focused disposable-PostgreSQL 16.15 repository contract was **0/1** with SQLSTATE `42703` because the authoritative column did not exist. Sandbox/listener setup failures were excluded from product RED evidence.

### Slice 3 implementation and progressive GREEN evidence

The shared exact currency contract now validates local JSON writes,
PostgreSQL mappers/repositories and local/PostgreSQL value mutations. Migration
`016` adds the nullable constrained column, promotes only exact valid legacy
payload evidence, and advances runtime readiness. Its cross-tenant backfill uses
a transaction-scoped `tge_owner` policy because forced RLS correctly hides rows
without tenant context; the policy is dropped before commit and rolls back with
the whole migration on invalid legacy evidence. Runtime grants and forced RLS
remain unchanged. CSV mapping/Data Health, canonical materialization and
fingerprints, replay/reconciliation, detector classification, browser response
contracts, opportunity entry, and presentation now carry only explicit currency.

Focused product tests are GREEN, including the three real PostgreSQL currency
contracts for backward upgrade/rollback, repository/core mutation and RLS, and
canonical import/replay. The standalone engineering harness passes. The full
integration suite passes **404/404**, the complete PostgreSQL 16.15 database gate
passes **90/90**, and managed Chromium passes **51/51** after an initial
currency-aware browser expectation run of **48/51**. Migration `016` SHA-256 is
`232fa715c2d2062186b0027d429119fe3e18fb110b03b63214f378eb3fe910d6`;
migrations `001`–`015` retain the exact starting hashes above. `git diff --check`
passes. The full sequential `npm run verify` gate passes the harness, integration
**404/404**, PostgreSQL 16.15 **90/90**, managed Chromium **51/51**, and the Vite
8.2.2 production build (**31 modules**). Its first permitted attempt encountered
a transient PostgreSQL catalog setup race (`tuple concurrently updated`) in
unchanged migration `002`; no test process remained, and the unchanged retry
passed completely. These are local implementation results only: no provider, production,
deployment, external OTP, later-slice acceptance, GitHub gate, or independent
review is claimed.

### Slice 3 bounded fresh-review remediation

The five bounded review findings are closed without expanding Slice 3. An
unversioned pre-currency opportunity commit now reconciles only after exact
legacy input/request fingerprints and the tenant, opportunity collection,
source system/hash, headers, reviewed columns, staged raw hashes, row outcomes,
and canonical hashes all agree. New commits record
`CANONICAL_IMPORT_V2_CURRENCY`; mapped currency, an unknown explicit version,
or any material replay change fails closed. Migration `016` now validates and
constrains exactly three uppercase ASCII bytes independently of collation.
Persisted present currency—including the empty string—is invalid unless it is
exact canonical ASCII, producing `COMMERCIAL_CURRENCY_INVALID` under Data
Health suppression; absent/null stays unknown and blank CSV cells remain
omitted. Dashboard priority and Biggest Opportunity cards, pipeline deal
cards, and Revenue Command Center ranked actions retain exact authoritative
currency and decimal evidence. In-place opportunity-id navigation clears the
unsaved currency draft.

Fresh regression evidence was RED before the fixes: the dependency-free review
set was **44/49** with one failure for each finding, the exact Revenue Command
Center projection was **0/1**, and managed Chromium was **0/2** for route state
and opportunity presentation. After the bounded fixes, the combined focused
set passed **59/59**, the affected integration set passed **134/134**, focused
managed Chromium passed **2/2**, and the migration-focused disposable
PostgreSQL 16.15 test passed **1/1**. The single complete `npm run verify`
passed the harness, integration **408/408**, PostgreSQL 16.15 **90/90**,
managed Chromium **53/53**, and the Vite 8.2.2 production build (**31
modules**). `git diff --check` passes. Migration `016` SHA-256 is
`ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3`;
migrations `001`–`015` remain byte-identical to base
`9dc155912be7df46c23b2aa30facddeda7b4baa8`.

### Slice 3 Recovery Checkpoint 1 — legacy replay identity anchoring

This recovery checkpoint closes only the P2 legacy replay identity defect. An
unversioned opportunity commit can no longer take the current-version
fingerprint shortcut. The compatibility branch reconstructs the canonical plan
from tenant/batch-scoped locked staging rows, validates the persisted CSV
preview/header and upload fingerprint, and reconciles every
source record, target, disposition, raw hash, canonical hash, result-row
identity, and summary against the authoritative committed ID map. A changed raw
payload with a recomputed adjacent staging hash therefore conflicts when the
committed ID-map raw evidence remains unchanged. Current
`CANONICAL_IMPORT_V2_CURRENCY` replay remains an exact fingerprint match;
unknown explicit versions remain closed. No migration, schema, currency
default/inference, FX, ranking, browser, or later-slice behavior changed.

The focused command
`node --test --test-name-pattern='pre-currency opportunity commit' test/import-repository.test.js`
was expected RED **0/8**: the parent and all seven subtests showed that tampered
staging `source_system`, `source_record_id`, `target_id`, stored-result source or
target identity, recomputed adjacent raw hash, and ID-map raw hash all returned
`COMMITTED`. After the fix, the focused current/legacy replay command passed
**9/9**, the complete import repository file passed **22/22**, and the directly
affected `test/import-repository.test.js`, `test/import-commit.test.js`, and
`test/import-staging.test.js` set passed **56/56** using dependencies installed
only in a disposable external directory. `test/import-mapping.test.js` passed
**14/14**, `test/database-migrations-static.test.js` passed **19/19**, the
standalone engineering harness passed, and `git diff --check` passed. No
PostgreSQL service was running and no schema changed, so no PostgreSQL suite was
started for this checkpoint. Migrations `001`–`015` are byte-identical to parent
`d42346ec6a026c7d142f16584f86290db14dd52f`; unchanged migration `016` remains
SHA-256 `ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3`.

### Slice 3 Recovery Checkpoint 2 — exact decimal ranking

This checkpoint changes only monetary ranking and RevenueAction basis evidence.
Browser and server comparators convert representable `NUMERIC(20,6)` literals
to exact scaled integers, preserve the original amount, apply stable ID ties,
and compare amounts only inside an authoritative currency group. Dashboard
Biggest Opportunity reports no inferred winner across multiple currencies.
Revenue intelligence deterministically groups canonical currencies, puts
missing currency after canonical evidence without comparing its amount, and
then applies the existing probability/action/ID fallbacks. RevenueAction basis
evidence retains exact amount plus optional authoritative currency, so exact
decimal or currency changes produce different fingerprints while legacy
number/no-currency fingerprints remain stable. Known-positive, zero, unknown,
invalid, and missing-currency inputs retain their existing domain-specific
classification semantics. The RevenueLeakCase operating queue now consumes the
shared exact server comparator with no contract change. No replay, persistence,
schema, migration, FX, default, inference, or later-slice behavior is added.

The focused `node --test test/exact-decimal-ranking.test.js` regression was
expected RED **0/4** at exact parent `67e2c10`: dashboard exact/cross-currency
selection was absent, revenue-action ranking reversed amounts separated by one
millionth beyond safe JavaScript integer precision, and RevenueAction evidence
rounded the amount and omitted currency. The implemented regression passes
**4/4**; the directly affected integration set passes **53/53**. Final evidence
is `npm run verify:fast` with harness and integration **420/420**, managed
Chromium **53/53**, Vite 8.2.2 production build **31 modules**, migration
integrity, and `git diff --check`. No PostgreSQL suite or full `npm run verify`
was run because no persistence or schema changed. Migrations `001`–`015` remain
byte-identical to base and unchanged `016` remains SHA-256
`ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3`.

## Assisted Pilot Safety Gate V1 Slice 2 bounded plan

### Grounded policy boundary

- The database timestamp on `tge.import_batches.created_at` is the only raw-evidence age authority. Runtime-supplied timestamps are ignored for the exact 168-elapsed-hour deadline; cleanup selects due work from database time and never accepts a tenant ID, batch ID, deletion target, role, or clock as authority.
- Raw staged payloads and raw-derived preview/upload metadata may be destroyed after seven exact elapsed days. Committed canonical CRM rows, source reconciliation needed by those rows, `tge.audit_events` retained for the existing 12-month contract, and immutable Pilot evidence are outside raw cleanup.
- Tenant offboarding in this slice is an explicit OWNER plus sensitive-action request followed by a separate least-privilege maintenance execution. It revokes database memberships, removes the tenant's assisted-invitation records, and destroys the tenant's raw import evidence. It preserves canonical CRM and required immutable audit evidence and reports that preservation truthfully; it is not a full tenant-data deletion claim.
- A future decision to delete or time-limit canonical committed CRM is still blocked on the separately approved legal/contractual tenant-retention policy. This slice does not guess that policy.

### Direct `orch-add-feature` fallback

1. Add genuinely new RED tests covering exact seven-day timing and database authority, due/pending visibility, runtime denial, tenant isolation/non-oracle behavior, canonical and immutable-audit preservation, minimized evidence, retry/concurrency/failure recovery, OWNER/sensitive-action authorization, and truthful offboarding state.
2. Append migration `015` only. Create a distinct non-login, processor-only `tge_maintenance` authority with no owner/migrator membership; add database-authored import lifecycle fields, immutable minimized cleanup/offboarding evidence, targetless `SKIP LOCKED` maintenance functions, RLS and grants that do not expand `tge_runtime` deletion authority, and readiness/schema assertions. Migrations `001`–`014` remain byte-identical to the starting hashes.
3. Add thin tenant-offboarding API/domain composition plus a targetless maintenance command. Keep JSON compatibility unchanged and preserve the Pilot auth/membership/TenantContext bridge and manual external-action boundary.
4. Turn focused tests GREEN, perform a security-focused self-review, then run the engineering harness, import/auth/offboarding integration tests, migration static checks, real PostgreSQL 16.15 database tests, `npm run verify:fast`, production build, `git diff --check`, and full `npm run verify` when the fresh disposable PostgreSQL service is available. Managed Chromium is required only if browser behavior changes.
5. Record exact RED/GREEN/full evidence and remaining external/legal gates here and in `docs/PROJECT_STATE.md`, remove all temporary services/dependencies/artifacts, verify a clean ignored/untracked state with no `node_modules` or `dist`, and create the authorized clean checkpoint commit without pushing or opening a PR.

### Starting migration integrity evidence

Migrations `001`–`014` were inspected before edits. Their starting SHA-256 values are respectively `d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62`, `a95f94263c5a1dd1a246a3be905e7f27bd5f4222ba871c137cf90fa2faf17c1c`, `311a02a67deb09ad44b2782f90c2ff3c67d6a537ca9b9ed1f116cafd37a149a8`, `ad9633daf1dd791c8889c79745d8741bace24e0827b76d3fec59d6d73371aa2d`, `2e9bc0029cbfdc03828de7784aa19014de3f7e988cc8f5668bcacd729e206a66`, `f110d2f7937c6133ed1785df05be8c3ca725add7d207a6d94b8a27610b3bca6f`, `514d12b74519405b28e76960244483880f01092b30bcac650a97f247469f4dc6`, `7e4f8b74df1ecc496fa6c7ac8b55169d3e7db7efccdcf3f1f7d0ad37aa95cd72`, `f248d2d5a7363331cd4f4732551a62f9ac28f3315ad5e9777ded1547657d3736`, `fcb19ddba6c2d5bc654af0c3a3172505675dd5c4160876d717b51943b2863e03`, `df50ee0697bb7849b3575f9f5aef40673855ec77a4ebcfcd0cf0d8d5e59ca04b`, `0ec9ffaf16987d84b319b6dc579edea86bbedcd3cff65f8b9d881f9c4dbba6d8`, `b27c7d6c69990f459b1e51c0d902d55f6a1f44fbf17accb69459b2c26465f6a8`, and `699cb9c1e7fc4319f71cf7e98e99934706f9f75a8f0f00ae9c22ff90c5c9ea10`.

### Independent High-review bounded remediation

The unpublished Slice 2 migration is corrected in place for exactly six review
findings: processor-only maintenance credentials; timezone-independent 168-hour
expiry; an offboarding tenant lock ordered before batch discovery; database
guards for terminal tenants and non-writable/expired batches; preservation of
all unclassified tenant metadata; and exact subject as well as tenant/issuer
binding at the sensitive-action service boundary. The terminal lock ordering
serializes already-authorized import transactions before the success marker,
while canonical CRM, ID-map, audit, Pilot evidence, and retry/rollback truth
remain unchanged.

### Final bounded lock-order remediation

The final review found cleanup claimed an import batch before inserting evidence
whose tenant foreign key needed the parent row, while offboarding locked the
tenant before discovering its batches. A PostgreSQL advisory barrier plus
`pg_blocking_pids` regression establishes that exact overlap from database lock
state without timing sleeps. At `878c913`, cleanup returned `SUCCEEDED` while
offboarding returned retryable `FAILED`. Migration `015` now locks one eligible
tenant before each targetless `SKIP LOCKED` batch claim, requires the internal
scrub to repeat tenant-before-batch order, and gives canonical import a tenant
share lock before its batch update lock. This preserves retry semantics,
cross-tenant progress, staging/import serialization, and processor-only
authority. Both overlapping processors now complete successfully with truthful
evidence and preserved canonical, audit, and Pilot data; all six earlier review
findings remain closed.

### Final bounded terminal-access remediation

A later High review found that assisted-invitation creation did not serialize
with the terminal tenant marker and that migration `010` consumption did not
recheck terminal tenant state. It also found that generic PostgreSQL preview and
analysis batch reads omitted the computed cleanup-due column while their mapper
invented `false`. New advisory-lock and `pg_blocking_pids` regressions prove the
creation and consumption overlaps without timing-only sleeps. Migration `015`
now adds a no-target, active-OWNER-bound runtime tenant lock for creation and
replaces the consumption function with terminal-aware tenant-before-invitation
locking; migrations `001`–`014` remain unchanged. The affected generic batch
reads use the same database-time due expression as dedicated status, while an
actually absent due value remains unknown.

### Bounded staging/maintenance concurrency remediation

The final fresh High review at `5ac47b4` reproduced two remaining concurrency
defects. A runtime staging insert could read a writable batch without locking
it, wait behind canonical finalization at the later foreign-key lock, and commit
a `PENDING` row after the batch became `COMMITTED`. The trigger now locks the
active tenant first and the batch second, then validates the locked batch state.
Two concurrent production maintenance command processes could also retain raw
cleanup tenant locks while each began request-first offboarding and form a
two-tenant deadlock. The command now commits cleanup before opening the
offboarding transaction. Advisory barriers plus `pg_blocking_pids` prove both
overlaps from database lock state without timing sleeps, while the processor
functions remain targetless and least-privileged and all prior Slice 2
serialization, retention, isolation, metadata, evidence, and retry invariants
remain unchanged.

### Bounded final security/migration remediation

The fresh High review at `1da7a3d` found two remaining database defects. First,
the migration-011 `record_import_commit_lifecycle_conflict` SECURITY DEFINER
grant allowed direct runtime SQL to restore arbitrary `conflict_summary` JSON
after raw cleanup or terminal offboarding. Migration `015` now replaces that
function with the established tenant-before-child lock order, a terminal tenant
barrier, exact tenant/issuer/subject and active OWNER/ADMIN membership checks,
unexpired `PENDING`/`FAILED` raw-cleanup state, nonterminal lifecycle states,
and closed summary keys. Direct coverage reassesses all six runtime-executable
migration-011 import helpers after cleanup and offboarding; none can restore
conflict, commit, staging, or sensitive raw metadata. The local legacy
repository path resolves its exact canonical `urn:tge:legacy` issuer while the
Pilot path remains explicitly issuer-bound. ACLs are reasserted so only
`tge_runtime`, not PUBLIC, maintenance, or migrator, receives this helper grant.

Second, the equality constraint in migration `015` could reject a shorter
deadline valid under schema 014. The upgrade now preserves every shorter
promise, shortens only any legacy calendar-day deadline beyond 168 elapsed
hours, and installs a 168-hour maximum constraint. The runtime insert trigger
continues to ignore caller time and author exactly 168 elapsed hours from
database time. A disposable 001–014 database fixture proves a valid 24-hour
deadline survives the `015` upgrade unchanged while canonical CRM, audit, Pilot
evidence, and ledger state remain present.

The exact final remediation commands were:

```text
TGE_TEST_DATABASE_URL=postgresql://yarinperetz@127.0.0.1:55432/postgres node --test --test-name-pattern='migration 015 upgrades schema-014 shorter retention|runtime import helpers cannot restore conflict' test/database/raw-import-expiry-offboarding.test.js
node --test test/raw-import-expiry-migration.test.js
node --test test/raw-import-expiry-migration.test.js test/raw-import-expiry-offboarding.test.js test/import-repository.test.js test/import-commit.test.js test/import-staging.test.js test/postgres-persistence.test.js test/postgres-auth-repository.test.js test/invitations.test.js test/auth-api.test.js
TGE_TEST_DATABASE_URL=postgresql://yarinperetz@127.0.0.1:55432/postgres node --test test/database/raw-import-expiry-offboarding.test.js
TGE_TEST_DATABASE_URL=postgresql://yarinperetz@127.0.0.1:55432/postgres npm run test:db
TGE_TEST_DATABASE_URL=postgresql://yarinperetz@127.0.0.1:55432/postgres node --test --test-name-pattern='illegal import lifecycle commit attempts' test/database/postgres-foundation.test.js
npm run verify:fast
npm run test:harness
git diff --exit-code origin/main -- ':(glob)database/migrations/00[1-9]_*.sql' ':(glob)database/migrations/01[0-4]_*.sql'
shasum -a 256 database/migrations/015_raw_import_expiry_tenant_offboarding.sql
git diff --check
git diff origin/main --check
```

The named PostgreSQL command was RED **0/2** on unchanged production SQL and
GREEN **2/2** after the correction. The remaining outcomes were respectively
**14/14**, **115/115**, **20/20**, initial **86/87**, isolated **1/1**,
corrected **87/87**, harness plus integration **389/389**, standalone harness
PASS, migrations `001`–`014` byte-identical, migration `015` SHA-256
`1f33b8656dbd2c3a05adc9a540412efcac41a8540673bee0e52e510b0e40fcd5`,
and both diff checks clean. The focused command's first sandboxed attempt was
**91 passed / 24 failed** solely because every listener received `EPERM`; its
unchanged permitted rerun produced the authoritative **115/115** result.

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
- [x] **Assisted Pilot Safety Gate V1 Slice 2 implements raw-evidence expiry and
  access/raw-evidence tenant offboarding.** Full canonical tenant-data deletion
  remains blocked on the approved legal/contractual retention decision; the
  earlier generic PR-6/PR-7 labels remain non-authoritative placeholders.
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
| Slice 2 product/database RED | New raw-import migration/service tests; then `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/database/raw-import-expiry-offboarding.test.js` against disposable PostgreSQL 16.15 | **EXPECTED RED:** migration contract **1/6** (only the unchanged-history assertion passed), service/API **0/4**, and meaningful PostgreSQL behavior **0/6** because migration `015`, expiry fields/processors, and the offboarding boundary did not exist and expired staged rows remained visible. Sandbox/listener setup failures were excluded from product RED evidence. |
| Slice 2 focused GREEN and review fixes | Focused migration/import/offboarding suites; `node --test test/engineering-harness.test.js test/database-migrations-static.test.js`; focused auth/persistence/offboarding suites; repeated real PostgreSQL `test/database/raw-import-expiry-offboarding.test.js` | **PASS:** initial focused static/service **45/45**; harness/isolation **14/14**; final focused auth/persistence/offboarding **44/44**; final PostgreSQL expiry/offboarding **7/7**. Security self-review additionally found and fixed the dropped identity issuer in the auth-to-persistence bridge, made failure evidence immutable and minimized, proved atomic rollback/recovery, and proved exactly one winner under concurrent offboarding workers. |
| Slice 2 full local gate | `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run verify` against a fresh disposable Homebrew PostgreSQL 16.15 cluster; repeated `npm run test:integration`; `git diff --check`; SHA-256 comparison of migrations `001`–`014` | **PASS:** engineering harness; integration **378/378**; database **74/74**; managed Chromium **51/51**; Vite 8.2.2 production build **31 modules** in 97 ms with only the existing chunk-size warning; clean diff check; migrations `001`–`014` byte-identical. This is local evidence only. The disposable cluster, `node_modules`, `dist`, and test logs were removed before checkpoint. |
| Slice 2 High-review remediation RED | `node --test test/raw-import-expiry-migration.test.js`; `node --test test/raw-import-expiry-offboarding.test.js`; `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test test/database/raw-import-expiry-offboarding.test.js` against disposable PostgreSQL 16.15 | **EXPECTED RED:** migration contract **6/9** because no distinct maintenance authority, exact elapsed-hour expression, or terminal/staging guards existed; service **4/5** because wrong-subject authorization was accepted; PostgreSQL behavior **6/10** because DST deadlines, non-writable staging denial, metadata preservation, and overlapping-import serialization were absent. Sandbox/listener and fixture-setup failures were excluded from product RED evidence. |
| Slice 2 High-review focused GREEN | `node --test test/raw-import-expiry-migration.test.js test/raw-import-expiry-offboarding.test.js`; affected auth/import/persistence suites; focused PostgreSQL expiry/offboarding suite; `node --test test/engineering-harness.test.js test/database-migrations-static.test.js` | **PASS:** static/service **14/14**; affected auth/import/persistence **69/69**; focused PostgreSQL **11/11**; harness/migration-static **22/22**. This proves the processor-only maintenance ACL, exact 168-hour DST behavior, database staging guards, terminal lock ordering, preserved unrelated metadata, and exact tenant/issuer/subject binding. |
| Slice 2 High-review proportional final gate | `npm run verify:fast`; `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:db`; `npm run test:harness`; `git diff --check`; SHA-256 comparison of migrations `001`–`014` | **PASS:** engineering harness plus integration **381/381**; complete PostgreSQL **78/78**; final harness; clean diff check; migrations `001`–`014` byte-identical. Browser E2E and the production build were intentionally not repeated because the bounded remediation changes no browser or web production source. The disposable cluster, `node_modules`, and any generated artifacts are removed before checkpoint. |
| Slice 2 final lock-order remediation | Focused state-synchronized cleanup/offboarding regression before and after the migration correction; `node --test test/raw-import-expiry-migration.test.js test/raw-import-expiry-offboarding.test.js`; affected auth/import/persistence files; complete affected PostgreSQL file; `npm run verify:fast`; `npm run test:db`; `npm run test:harness`; migration hash/diff proof; `git diff --check` | **EXPECTED RED: 0/1** at `878c913`: cleanup returned `SUCCEEDED` but offboarding returned `FAILED` under the proven overlap. **PASS:** focused regression **1/1**; migration/service **15/15**; affected auth/import/persistence **85/85**; affected PostgreSQL **12/12**; engineering harness plus integration **382/382**; complete PostgreSQL **79/79**; final harness; migrations `001`–`014` byte-identical; clean diff check. Browser E2E and production build were intentionally not repeated because no browser or web-production code changed. The disposable cluster, dependencies, and generated artifacts are removed before checkpoint. |
| Slice 2 final terminal-access remediation | New repository/migration RED; state-synchronized invitation creation/offboarding and invitation consumption/offboarding PostgreSQL races; focused auth/import/persistence and complete affected PostgreSQL file; `npm run verify:fast`; `npm run test:db`; `npm run test:harness`; migration hash/diff proof; `git diff --check` | **EXPECTED RED at `9d91861`:** repository/migration **22/25** because generic due truth was absent/rewritten and consumption had no tenant lock; PostgreSQL **0/2** because offboarding did not wait, one invitation survived terminal state, and residual invitation consumption recreated one active membership. **PASS:** focused auth/import/migration **36/36**; affected auth/import/persistence **89/89**; affected PostgreSQL 16.15 **15/15**; engineering harness plus integration **386/386**; complete PostgreSQL **82/82**; final harness; clean diff check; migrations `001`–`014` byte-identical to `origin/main`. Browser E2E and production build were intentionally not repeated because no browser or web-production source changed. |
| Slice 2 staging/maintenance concurrency remediation | State-synchronized staging/canonical-finalization regression and two-worker/two-tenant regression running `scripts/run-maintenance-cleanup.mjs`; focused migration/service and affected auth/import/persistence files; complete affected PostgreSQL file; `npm run verify:fast`; `npm run test:db`; final harness, migration hash, and diff checks | **EXPECTED RED at `5ac47b4`: 0/1 each.** Staging was proven queued behind canonical finalization but resolved instead of rejecting the now-`COMMITTED` batch; the forced production-command overlap exited with `MAINTENANCE_CLEANUP_FAILED`. **PASS:** focused races **1/1** each; migration/service **17/17**; affected auth/import/persistence **147/147**; affected PostgreSQL 16.15 **17/17**; engineering harness plus integration **387/387**; complete PostgreSQL **84/84**; standalone harness and harness/migration-static **22/22**; clean diff check; migrations `001`–`014` byte-identical. Browser E2E and production build were intentionally not run because no browser or web-production source changed. |
| Slice 2 final database invitation-guard remediation | Least-privilege runtime direct SQL after terminal offboarding; state-synchronized direct insert/offboarding overlap; focused invitation/auth/migration tests; complete affected PostgreSQL file; `npm run verify:fast`; `npm run test:db`; final harness, migration hash, artifact, ancestry, and diff checks | **EXPECTED RED at `97b6f4c`: 0/1 each.** The terminal barrier returned `false` but direct runtime SQL inserted one `PENDING` terminal invitation; under the forced overlap offboarding did not wait and the direct insert survived terminal state. **PASS:** direct denial and overlap **1/1** each; focused invitation/auth/migration **61/61**; affected PostgreSQL 16.15 **18/18**; engineering harness plus integration **388/388**; complete PostgreSQL **85/85**. Migration `015` alone adds the trigger-enforced active-OWNER/terminal tenant-before-child barrier while retaining repository behavior and the existing runtime table grant. Migrations `001`–`014` remain byte-identical. Browser E2E and production build were intentionally not run because no browser or web-production source changed. |
| Slice 2 bounded final security/migration remediation | Named PostgreSQL upgrade/helper regressions before and after the migration correction; `node --test test/raw-import-expiry-migration.test.js`; focused import/auth/persistence files; complete affected PostgreSQL file; `npm run test:db`; isolated failing DB contract; corrected `npm run test:db`; `npm run verify:fast`; `npm run test:harness`; migration hashes and final hygiene | **EXPECTED RED at `1da7a3d`: 0/2.** Migration `015` rolled back with `23514` on a schema-014-valid 24-hour deadline, and direct runtime lifecycle conflict SQL succeeded instead of rejecting. **PASS:** identical regressions **2/2**; migration static **14/14**; focused import/auth/persistence **115/115**; affected PostgreSQL 16.15 **20/20**. The first full DB run was **86/87** because the established legacy fixture lacked explicit issuer context at the new exact-context guard. Resolving that path to its canonical issuer passed the isolated contract **1/1**; the now-terminal `EXPIRED` expectation was also removed, and the complete DB suite then passed **87/87**. Engineering harness plus integration passed **389/389**; the standalone final harness also passed. Migration `015` SHA-256 is `1f33b8656dbd2c3a05adc9a540412efcac41a8540673bee0e52e510b0e40fcd5`; migrations `001`–`014` remain byte-identical. Browser E2E and production build were intentionally not run because no browser or product source changed. |
| Slice 3 full local gate | `TGE_TEST_DATABASE_URL=postgresql://yarinperetz@127.0.0.1:55432/postgres npm run verify` against a disposable Homebrew PostgreSQL 16.15 cluster; `git diff --check`; SHA-256/base comparison of migrations `001`–`015` | **PASS:** engineering harness; integration **404/404**; database **90/90**; managed Chromium **51/51**; Vite 8.2.2 production build **31 modules** with only the existing chunk-size warning; clean diff check; migrations `001`–`015` byte-identical. The first listener-permitted full attempt hit a transient `tuple concurrently updated` catalog race in unchanged migration `002`; the unchanged retry passed completely. This is local evidence only; cleanup and checkpoint are performed after the recorded gate. |
| Slice 3 Recovery Checkpoint 1 | Focused legacy replay tamper RED/GREEN; complete import repository; directly affected import commit/staging reconciliation; import mapping; migration-static; standalone harness; migration hashes; `git diff --check` | **EXPECTED RED: 0/8** across seven independently exposed identity/raw tamper vectors. **PASS:** focused current/legacy replay **9/9**; repository **22/22**; affected import/reconciliation **56/56**; mapping **14/14**; migration-static **19/19**; harness and diff check. No PostgreSQL service/suite, full Verify, browser, or build was run. Migrations `001`–`015` are byte-identical to `d42346e`; unchanged `016` is `ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3`. |
| Slice 3 Recovery Checkpoint 2 | Focused exact-decimal ranking RED/GREEN; directly affected intelligence/action/queue integration; `npm run verify:fast`; managed browser; production build; migration hashes; `git diff --check` | **EXPECTED RED at `67e2c10`: 0/4.** **PASS:** focused **4/4**; affected integration **53/53**; engineering harness plus integration **420/420**; managed Chromium **53/53**; Vite 8.2.2 build **31 modules**; unchanged migration proof and clean diff check. No PostgreSQL suite or full Verify was run because persistence and schema are unchanged. |
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
