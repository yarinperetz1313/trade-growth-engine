# Pilot Readiness

## Outcome
- **PR-0 is COMPLETE.** The Pilot architecture and production-operation contracts are canonical and harness-protected.
- **PR-1 is COMPLETE.** Deterministic fixtures characterize the legacy JSON compatibility boundary.
- **PR-2 implementation and the narrow CI remediation are present; final database verification is PENDING.** The first PostgreSQL 16 CI run exposed migration `002` creating the `tge` schema after `SET LOCAL ROLE tge_owner`; PostgreSQL rejected that non-database-owner role with SQLSTATE `42501`, causing all 11 database tests to fail in their shared setup hook. Migration `002` now creates the schema as the migration administrator with owner `tge_owner`, then selects `tge_owner` before all application-schema objects. Safe migration diagnostics now retain SQLSTATE and migration metadata without exposing connection or SQL payloads. This host has no `TGE_TEST_DATABASE_URL`, so CI or another real PostgreSQL 16.15 host must re-run the database gate.
- The user explicitly authorized schema-only PR-2 work before vendor provisioning decisions. Those unresolved gates still block provisioning and release; they do not block append-only schema and test-harness work.
- Explicit PR-2 non-goals: production repositories, Auth0 middleware, onboarding UI, file upload/parsing, import commit execution, JSON cutover, deployment/provisioning, and PR-3–PR-7 behavior.

## Locked baselines and verified evidence
| Area | Locked baseline | Verified evidence / owner |
| --- | --- | --- |
| Current product | Local JSON remains the current runtime/local-test persistence authority; deterministic intelligence and manual RevenueAction approval are unchanged. | [`PROJECT_STATE.md`](../../PROJECT_STATE.md), [`LEGACY_JSON_COMPATIBILITY.md`](../../architecture/LEGACY_JSON_COMPATIBILITY.md), and unchanged integration fixtures. |
| Database foundation | PostgreSQL 16.15 uses append-only `001_initial_schema.sql`, `002_tenant_domain_schema.sql`, and `003_roles_rls_and_grants.sql`. `001` remains 2,752 bytes with SHA-256 `d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62`. | `scripts/migrate-db.mjs`, static tests, and the CI-required real-PostgreSQL suite. |
| Tenant identity | Tenant IDs are UUIDs; operational/source record IDs and Auth0 subjects are text. Tenant membership roles are exactly `OWNER`, `ADMIN`, and `MEMBER`. | Migration `002` constraints and database tests. |
| Isolation | Tenant-owned tables use explicit `tenant_id`, composite keys/FKs, `RESTRICT`, forced RLS, and a non-bypass runtime group role. Legacy `public` tables from `001` are quarantined from runtime. | Migration `003` plus non-superuser runtime tests. |
| Commercial evidence | Numeric value is nullable and paired with `KNOWN`, `ZERO`, `NULL`, `MISSING`, `BLANK`, `UNKNOWN_LITERAL`, or `NON_NUMERIC`; raw payload, source ordinal, and source timestamps remain reproducible. | Migration `002` and PR-1 fixture mapping tests. |
| Pilot topology | Cloud Run and Cloud SQL PostgreSQL use australia-southeast2 (Melbourne). Sydney is a written exception only. | Official Google links rechecked on 2026-08-30 in the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md); reverify before provisioning. |
| Identity and recovery | Auth0 Australia (AU); 14 daily backups retained; RPO <= 24 hours; RTO <= 4 business hours. | Contracts remain locked in the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md) and [production gate](../../operations/PILOT_PRODUCTION_GATE.md). |
| Import evidence | Raw files: 7 days; audit/import metadata: 12 months. PR-2 stores only batches, staging evidence, ID maps, and append-oriented audit records. | Migration `002`; no parser, upload, or commit service exists. |

## PR-2 implementation decisions
| Topic | Decision |
| --- | --- |
| Migration discipline | The runner discovers numbered SQL files, serializes with an advisory lock, applies each file and ledger row in one transaction, rejects missing/applied files and filename/checksum drift, and no-ops on rerun. It applies a clean `001` but refuses to infer or record `001` when any known baseline object already exists. Migration `002` bootstraps roles, creates the `tge` schema under the migration administrator with authorization assigned to `tge_owner`, then selects `tge_owner` before creating application objects; `003` and later files must run as `tge_owner`. |
| Production namespace | New tenant data lives in `tge`; historical tables created by `001` remain in `public` and receive no runtime schema/table access. |
| Source identity | Legacy operational IDs remain the row `id` as text inside `(tenant_id, id)` primary keys. No replacement UUID hides a source ID. |
| RevenueAction | Active uniqueness is exactly tenant + opportunity + action type + basis fingerprint for `RECOMMENDED`, `PREPARED`, `APPROVED`, `EXECUTING`, and `FAILED`. Terminal history can repeat. Deferred reciprocal composite FKs enforce tenant/opportunity effect ownership and at most one task/activity effect; application code remains authoritative for lifecycle semantics and authorization. |
| Request context | `app.tenant_id` and `app.subject_id` are transaction-local server inputs exposed through helper functions. They are trusted only after later server-side membership validation; they are never an API authority, and RLS does not replace PR-4 authorization. |
| Runtime privilege | Runtime can operate scoped CRM rows and insert/select import evidence, but cannot create schema objects, alter roles/policies/migrations, bypass RLS, truncate, access legacy `public` tables, or update/delete batches, staging rows, ID maps, or audit events. Controlled import transitions/deletion require a later append-only migration plus narrow function/repository boundary. |

## Auth0 magic-link delivery gate (before PR-4)

**PR-4 is blocked** until the product owner records a delivery, UX, and security decision that validates all of the following:

1. The selected Auth0 AU plan supports passwordless magic links.
2. The selected flow is **Classic Login with same-browser/device completion**, or the product owner separately approves a tenant setting or alternative.
3. Mobile and email-client behavior, callback and redirect allowlists, and phishing/resend/session protections are validated.
4. A deterministic E2E acceptance test proves the selected path.

There is no implicit OTP fallback and no assumed cross-browser tenant configuration.

## Slices
- [x] **PR-0 — foundation contract:** architecture, operations, project-state, and harness contracts.
- [x] **PR-1 — contract characterization:** deterministic legacy fixtures, compatibility tests, and migration handoff.
- [ ] **PR-2 — IMPLEMENTATION COMPLETE; FINAL DATABASE VERIFICATION PENDING:** schema/security/runner/tests/CI/docs are implemented; mark complete only after `npm run test:db` and the full final gate pass against real PostgreSQL 16.15.
- [ ] **PR-3 — NOT STARTED:** implement tenant-aware production repositories and transactional RevenueAction persistence; do not add Auth0 middleware here.
- [ ] **PR-4 — NOT STARTED/BLOCKED:** implement identity and server-side membership authorization only after the magic-link decision gate is resolved.
- [ ] **PR-5–PR-7 — NOT STARTED:** remain outside this work unit.

## Verification
| Level | Command or inspection | Evidence |
| --- | --- | --- |
| Targeted static/syntax | `node --check scripts/migration-error.mjs && node --check scripts/migrate-db.mjs && node --check test/database/postgres-foundation.test.js && node --test test/database-migrations-static.test.js test/database-migration-runner.test.js` | Executed after regression-first failures: pass (9/9 static/unit tests). |
| Integration | `OPENSSL_CONF=/dev/null npm run test:integration` | Executed: pass (67/67). |
| Harness | `OPENSSL_CONF=/dev/null npm run test:harness` | Executed: pass. |
| Build | `OPENSSL_CONF=/dev/null npm run build` | Executed: pass; 21 modules transformed. |
| Database | `npm run test:db` | Re-run pending: `TGE_TEST_DATABASE_URL` is unset on this host. The prior CI run failed all 11 tests during shared migration setup with SQLSTATE `42501`; the confirmed migration-role ordering defect and diagnostics gap are now remediated locally but require PostgreSQL 16.15 proof. |
| Browser discovery | `npm run test:e2e -- --list` | Not required: DB-gate insertion does not change Playwright discovery or the managed E2E runner. |
| Hygiene | `git diff --check` | Executed: pass. Migration `001` checksum also matches `HEAD`. |

## Review and handoff
- Implementer self-check: **COMPLETE FOR AVAILABLE LOCAL GATES** — static, integration, harness, build, and hygiene pass; scope excludes repositories/auth/UI/import execution/cutover/deployment. Real PostgreSQL remains the explicit blocker to PR-2 completion.
- Security review: **CONFIRMED FINDINGS AND CI MIGRATION DEFECT REMEDIATED IN CODE; REAL DATABASE RECHECK PENDING** — schema creation now remains under the migration administrator without granting database-wide `CREATE` to `tge_owner`; later application objects still run under `tge_owner`. Ownership/default privileges, audited baseline refusal, reciprocal effect links, typed ID maps, immutable runtime evidence, and safe migration diagnostics have regression coverage. Do not close this item until the real database gate passes.
- Final database review: **Placeholder** — requires a passing PostgreSQL 16.15 `npm run test:db`/CI run before PR-2 is marked complete.
- PR-3 handoff: build production repositories on `(tenant_id, id)` keys and transaction boundaries; preserve JSON compatibility until explicit cutover. Add any controlled import status or retention-deletion path only through a reviewed append-only migration and narrow function/repository API—never by restoring unrestricted runtime table mutation.
- PR-4 handoff: validate Auth0 identity, resolve membership server-side, then set transaction-local DB context. Client input and custom GUCs are not authorization evidence.
- Unresolved vendor/provisioning gates remain: static host/privacy posture, transactional SMTP, production domain/registrar, Auth0 AU plan/features, privacy/DPA review, backup/recovery proof, and release infrastructure.
