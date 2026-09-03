# Project State

_Last locally audited on 2026-09-02. This document is a current-state snapshot; CI outcomes require the corresponding GitHub Actions run._

## Current verified shape
Trade Growth Engine is a Vite React + Express local-first CRM. `src/index.js` starts the server, `src/api/` exposes thin structured HTTP boundaries, and `web/main.jsx` provides hash-routed UI. Local JSON persistence flows through `src/services/localStore.js`; tests and E2E use isolated stores. The [Legacy JSON Compatibility Contract](architecture/LEGACY_JSON_COMPATIBILITY.md) and deterministic fixtures characterize that adapter for the future persistence cutover.

Pilot PR-2 is **complete** and adds a PostgreSQL foundation without changing that runtime authority: append-only migrations `001`–`004`, an audited-baseline/owner-role checksum runner, the tenant-scoped `tge` schema, forced RLS and least-privilege group roles, reciprocal RevenueAction effect constraints, immutable typed import/audit evidence, and a real-PostgreSQL test gate. Final remediation was append-only: migrations `001`–`003` remained unchanged.

Commit `8f1b373` fixed PostgreSQL role-creation parameter typing with explicit text casts. CI run `33303061173` then executed all 11 database tests (8 passed, 3 failed), revealing one function-default ACL schema defect and one import negative-fixture defect. Commit `d54d6f1` added `004_global_function_default_privileges.sql`, globally revoked future `tge_owner` function `PUBLIC EXECUTE`, re-protected existing functions, isolated SQLSTATE `23503` missing-source coverage from `23505` duplicate-target coverage, and advanced harness/static/real-database expectations. [GitHub Actions run 33304131266](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33304131266) on `d54d6f1` succeeded: harness passed; integration 68/68; PostgreSQL 16.15 database 11/11; Chromium E2E 7/7; production build passed with 21 modules transformed in 102 ms.

PR-3 and PR-4 are complete and merged through [PR #16](https://github.com/yarinperetz1313/trade-growth-engine/pull/16) at `b0a8e36`, which closed [Issue #2](https://github.com/yarinperetz1313/trade-growth-engine/issues/2) and [Issue #5](https://github.com/yarinperetz1313/trade-growth-engine/issues/5). PR-3 supplies tenant-aware PostgreSQL repositories, transaction-scoped persistence, and transactional RevenueAction execution while preserving JSON as the default local/test adapter and preserving unknown JSON-compatible values. Its migrations remain append-only and unchanged at `005`–`009`. PR-4 adds exact Auth0 validation, active-membership authorization, immutable auth `TenantContext`, centralized role policy, assisted invitations, browser PKCE boundaries, and the renumbered append-only migration `010_auth_membership_and_invitations.sql`.

The server validates the independently branded PR-4 auth context, mints a separate trusted PR-3 persistence context from only its tenant ID and subject, and injects it into the PostgreSQL routers and transactions. Auth-enabled business APIs still return `503 TENANT_PERSISTENCE_UNAVAILABLE` when the PostgreSQL adapter/bridge is absent. Production provisioning, import retention deletion, and JSON cutover do not exist yet. A provisioned Auth0 AU tenant, SMTP/domain evidence, and real external-email OTP E2E remain release gates.

Pilot Readiness PR-5A supplies the bounded CSV-only import contract, parser,
OWNER/ADMIN staging service, tenant-scoped PostgreSQL batch/staging/audit
repository, and a read-only 100-row preview. PR-5B adds deterministic exact-name
then ordered-alias draft mapping, preview-only user selections, row-level
validation, and all-staged-row Data Health through the same authorization,
repository, and transaction boundaries. PR-5C adds an explicit OWNER/ADMIN
canonical commit and reconciliation API for reviewed selections. One tenant
transaction locks immutable evidence, deterministically commits or skips every
row, reconciles the existing ID map, appends bounded audit evidence, and
transitions only `PREVIEWED` to `COMMITTED`. Migration `011` adds global source
identity and typed-target uniqueness plus narrow lifecycle functions without
broad import mutation grants. All three slices preserve exact raw cells and
distinct unknown value states and perform no external actions. XLSX, controlled
retention deletion, and JSON cutover remain later Issue #13 work.

PR-5D adds the hash-routed browser CSV import workspace over those existing
contracts: upload, bounded raw-evidence preview, deterministic mapping review
and change, all-row Data Health, explicit confirmation, canonical commit, and
result. Contract-mocked managed Playwright fixtures cover loading, empty,
general error, unauthorized, conflict, outcome-unknown reconciliation/retry,
success, and adversarial unknown/blank/zero/nonnumeric evidence. Existing
PostgreSQL suites remain authoritative for server persistence, auth, tenant
isolation, commit, retry, reconciliation, and audit behavior. Raw-evidence
retention/deletion acceptance and implementation are **DEFERRED to a separate
reviewed follow-up**; PR-5D does not claim them complete.

PR-5D final-review remediation gates production Auth0 callback consumption on a
structurally complete OAuth code/state response, scrubs the consumed callback URL
before rendering, and fails closed on malformed callbacks or cleanup failure. Its
analysis boundary now requires each collection's exact canonical mapping and
Data Health metadata—including prospect-only contactability—before UI review or
confirmation, while retaining unsupported-target and 100-row evidence bounds.

PR-5C fresh-review remediation additionally makes parser-unknown identities
non-authoritative, keeps unsafe and underflowing decimal staging evidence lossless,
hashes the complete reviewed-selection vector, fails closed on PostgreSQL
`NULL`, normalizes canonical/dedupe uniqueness races into atomic conflicts, and
audits illegal lifecycle attempts without allowing new transitions or raw-cell
leaks.

PR-5C bounded final-review remediation additionally preserves exact imported
commercial and mapped numeric evidence across ordinary PostgreSQL opportunity
updates, returns malformed commit requests as the stable
`IMPORT_COMMIT_REQUEST_INVALID` API contract, and rejects PostgreSQL numeric
overflow or lossy-underflow literals as bounded row-level validation before any
canonical insert. The final remediation below supersedes that earlier generic
numeric envelope.

PR-5C bounded final-review remediation now aligns the canonical commercial
schema and application boundary on `NUMERIC(20,6)`: the exact maximum
`99999999999999.999999` succeeds, while adjacent overflow and excess effective
fractional scale fail before canonical SQL without rewriting staged cells.
Migration `011` alone applies the new typmods and fails closed rather than
rounding incompatible existing canonical values. Blank optional relationship
cells materialize as absent/SQL `NULL`, and defensive savepoint handling turns
any remaining canonical FK `23503` into bounded relationship conflict evidence.
Committed replay fingerprints retain unknown supplied target fields, so only a
materially identical valid request reconciles; changed or invalid vectors
conflict deterministically.

PR-5C final two-finding remediation gives every representable decimal spelling
one exact, non-`Number` canonical interpretation for materialization, payload
fingerprints, and cross-batch reconciliation while retaining the original raw
cell and numeric evidence. Commit-time absent or reused reviewed columns,
including source identity, now return the existing
`IMPORT_COMMIT_REQUEST_INVALID` public API contract instead of the draft-mapping
selection error.

The approved Issue #8 foundation adds `src/revenueLeakCases/`, thin
RevenueLeakCase APIs, local JSON compatibility, and append-only migration
`012_revenue_leak_case_foundation.sql`. Only `STALLED_OPPORTUNITY` is supported.
Cases retain immutable evidence and explicit `KNOWN`/`UNKNOWN`/`NOT_APPLICABLE`
commercial semantics, reconcile one active tenant/source/detector series
deterministically, preserve superseded/terminal audit history, and may snapshot-
link one same-opportunity RevenueAction without changing its lifecycle or
effects. No detector, schedule, post-import hook, browser UI, Quote Recovery,
outcome ledger, recovered-revenue calculation, or attribution exists.

Deterministic deal intelligence remains the source of opportunity recommendations. Read-only revenue intelligence aggregates that output. Phase 2 adds `src/revenueActions/`: a durable `revenue_actions.json` domain record with immutable recommendation snapshots, evidence, lifecycle audit, approval state, prepared execution, and CRM result links. The Opportunity Command Center is the detailed execution surface; the Revenue Command Center navigates into it and refreshes after mutations.

The Product Truth audit/fix work unit is complete: [PR #17](https://github.com/yarinperetz1313/trade-growth-engine/pull/17) merged at `5231838` and closed [Issue #7](https://github.com/yarinperetz1313/trade-growth-engine/issues/7). This did not provision Auth0, SMTP, production persistence, import execution, or cutover, and it did not begin Pilot Readiness PR-5 or later slices.

## Phase and CI baseline
The existing Phase 2 Opportunity Execution Engine remains unchanged by the
RevenueLeakCase foundation. Its combined PR-3/PR-4 state at `9fe7cea` is verified
by [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854): engineering harness, integration **129/129**, PostgreSQL 16.15 database **44/44**, managed Chromium **7/7**, and the production build passed. Fresh combined review found no P0, P1, or P3 findings; its only P2 was stale verification status corrected in the canonical records. That historical CI run does not prove the later PR-5 or RevenueLeakCase changes, provisioned Auth0 AU, or SMTP behavior.

## Execution lifecycle
`RECOMMENDED → PREPARED → APPROVED → EXECUTING → EXECUTED`, with `REJECTED`, `CANCELLED`, and recoverable `FAILED`. Server-side fingerprint checks supersede stale actions. Communication is deterministic email-draft preparation plus explicit manual confirmation, never external sending. Internal-task execution creates or reuses one linked open task and one linked activity.

## Verification
Follow [`ENGINEERING_HARNESS.md`](ENGINEERING_HARNESS.md) for verification levels and evidence. `npm run verify` is the full harness, integration, real-database, managed-E2E, and production-build gate; report only commands actually executed and their outcomes.

## Do not break
- Unknown evidence stays unknown; unknown/zero commercial value is not known `$0`.
- Health is not close probability.
- Deal/revenue intelligence remains deterministic and read-only.
- External communication needs explicit human approval and confirmation; Phase 2 never sends it.
- RevenueAction idempotency remains semantic and recovery-oriented. PostgreSQL mode encloses the closed loop in one tenant transaction; JSON mode remains the compatible non-transactional local default.
- RevenueLeakCase evidence and terminal history remain immutable; unknown value
  never becomes zero, potential value never becomes recovered revenue, and only
  RevenueAction owns execution/effect semantics.
- Tenant custom GUCs are trusted server-only transaction inputs, not API authorization; RLS does not replace PR-4 membership checks.
- Legacy operational IDs remain text inside `(tenant_id, id)` keys; unknown commercial evidence and source ordinal/timestamps must survive cutover.
- Developer `data/*.json` must never be touched by tests/E2E.

## Milestone status
- Active plan: [**Pilot Readiness**](execution-plans/active/pilot-readiness.md).
  The [**RevenueLeakCase foundation**](execution-plans/completed/revenue-leak-case-foundation.md)
  is complete in its bounded Issue #8 slice.
- Pilot Readiness **PR-0 is complete**: its architecture, operations, and harness consistency contracts are documented. This does **not** mean production infrastructure, authentication, authorization, tenancy, backups, imports, or deployment have been provisioned or implemented.
- **PR-1 is complete**: it characterized legacy JSON compatibility, including deterministic fixtures, observable ordering/value semantics, RevenueAction lifecycle/effect links, and the migration manifest/handoff. It did not implement production persistence or tenancy.
- **PR-2 is complete**: schema/security/migrations `001`–`004`, tests, and CI are present, and GitHub Actions run `33304131266` passed the full PostgreSQL 16.15 gate. This completion does not imply production repositories, Auth0 middleware, provisioning, import execution, or JSON cutover. Vendor decisions still gate provisioning and release.
- **PR-3 and PR-4 are complete and merged through PR #16 at `b0a8e36`**: tenant-aware PostgreSQL repositories and transactional RevenueAction persistence consume the membership-derived auth boundary through a server-only trusted-context bridge. The underlying combined state at `9fe7cea` is verified by [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854), which passed the complete combined gate. Real Auth0 AU/SMTP acceptance remains deployment-gated; that combined PR-3/PR-4 verification did not cover the later PR-5 work summarized below.
- **The Product Truth audit/fix work unit is complete through PR #17 at `5231838`**, and Issue #7 is closed. Its repository-backed UI corrections and managed Product Truth coverage do not establish external-provider, provisioning, import, or cutover evidence.
- **PR-5A implements CSV contract, limits, immutable staging, and bounded preview; PR-5B implements draft mapping, validation, and Data Health analysis; PR-5C implements controlled atomic canonical commit and ID-map reconciliation; PR-5D implements the contract-mocked browser workflow and adversarial state coverage.** Raw-evidence retention/deletion acceptance is explicitly deferred to a separate reviewed follow-up; cutover and production provisioning remain unimplemented.
- **Issue #8 RevenueLeakCase foundation implements the bounded domain,
  JSON/PostgreSQL repositories, tenant-bound API, migration `012`, and focused
  contract/database evidence for `STALLED_OPPORTUNITY`.** Detector execution,
  browser recovery workflows, and attribution remain unimplemented.
