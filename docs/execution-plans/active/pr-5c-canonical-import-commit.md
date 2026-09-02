# PR-5C controlled canonical import commit

## Outcome
- Problem and intended observable result: allow an authorized `OWNER` or
  `ADMIN` to explicitly commit one reviewed CSV import batch into canonical
  tenant-scoped PostgreSQL records in one transaction, with deterministic
  duplicate/conflict outcomes, retry reconciliation, ID-map evidence, and a
  truthful committed lifecycle state.
- Explicit non-goals: PR-5D browser UI/E2E, retention deletion, XLSX, fuzzy or
  AI mapping, connectors, RevenueAction imports, JSON cutover, production
  provisioning, and unrelated product expansion.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Tenant and role authority | Reuse membership-derived auth `TenantContext`, the independently branded persistence context, and `OPERATIONAL_ADMIN`; reject request/file tenant, owner, subject, and role fields. | Issue #13; PR-4 authorization; service/API acceptance tests |
| Transaction boundary | Lock and commit exactly one tenant/import batch through one public PostgreSQL repository transaction. Canonical insert, ID-map reconciliation, staging outcome, audit append, and final batch transition either commit together or roll back together. | Repository unit tests; failure injection; real PostgreSQL contract |
| Mapping authority | The commit request explicitly supplies the reviewed PR-5B selections, source identity selection, bounded source-system namespace, and idempotency key. The server rebuilds validation from immutable staging evidence; draft analysis output is never trusted as commit evidence. | Domain/service tests |
| Duplicate identity | Within a batch, the first source-ordered exact row is canonical and exact repeats are explicit duplicates. Existing source-system + source-ID maps reconcile only when the canonical payload fingerprint matches. A mismatched fingerprint, source identity mapped to multiple targets, canonical-ID collision, or unreliable/ambiguous identity blocks the whole commit; no silent merge or overwrite occurs. | Focused duplicate/conflict tests and database concurrency constraints |
| ID-map compatibility | Extend `tge.import_id_map` append-only with source-system/source-record identity and canonical payload fingerprint metadata; retain its existing tenant-composite staging and target foreign keys. Re-import reconciliation references the existing authoritative map instead of creating a parallel identity model. | Migration 011 static and PostgreSQL tests |
| Lifecycle and privileges | Add only narrow security-definer import commit functions required to record per-row outcomes and transition `PREVIEWED` to `COMMITTED`; grant runtime `EXECUTE`, not broad import-table `UPDATE`/`DELETE`. Failure before transaction commit leaves the batch non-committed. | Migration/RLS/ACL tests |
| Unknown values | Build canonical input only from exact cell evidence. Preserve missing/null/blank/unknown/known-zero/nonnumeric distinctions through existing mappers and retain immutable raw payload/hash unchanged. | Acceptance fixtures and raw-evidence assertions |
| Recovery | Same-batch retry with the same idempotency key returns the reconciled committed result without new canonical rows, maps, or audit events. A different key or materially different reviewed commit request conflicts deterministically. PostgreSQL commit-acknowledgement loss uses the existing outcome-unknown reconciliation contract. | Retry/API/transaction tests |

## Slices
- [x] Contract/TDD slice: add failing service/API/repository/static/database tests
  for authorization, accepted mapping input, deterministic duplicate/conflict
  policy, retry, reconciliation, raw value semantics, and rollback injection.
- [x] Migration/repository slice: append migration 011 with ID-map identity,
  concurrency protection, narrow lifecycle functions/ACLs, and implement the
  one-batch atomic repository boundary.
- [x] Service/API slice: rebuild reviewed mapping from staging, materialize
  canonical records deterministically, keep handlers thin, normalize conflict
  and unavailable responses, and expose explicit commit/reconciliation.
- [x] Documentation/review slice: update canonical import architecture and
  project/pilot truth, run the progressive verification ladder, resolve fresh
  implementation/security review, checkpoint commits, and stop before PR-5D.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Focused red/green | `node --test test/import-commit.test.js test/import-repository.test.js test/import-staging.test.js test/import-mapping.test.js` | New contract fails before implementation, then authorization/commit/retry/conflict/rollback tests pass |
| Static migration | `node --test test/database-migrations-static.test.js test/database-migration-runner.test.js` | Migration 011 is append-only and runtime retains no broad import mutation grants |
| Fast | `npm run verify:fast` | Harness and all Node integration tests pass |
| Database | `TGE_TEST_DATABASE_URL=... npm run test:db` against disposable PostgreSQL 16.15 when locally feasible | Real transaction, RLS, function ACL, isolation, concurrency/retry, and rollback evidence passes |
| Proportionate broader checks | `npm run build`; `npm run verify` only when the disposable database and managed browser prerequisites are available and proportionate | Production build and any actually executed broader gates pass |
| Hygiene | `git diff --check`; `git status --short --branch`; scoped diff review | No whitespace errors, unrelated changes, developer-data mutation, or uncheckpointed work |

## Review and handoff
- Implementer self-check: completed against the scoped diff, with particular
  review of transaction lock order, tenant/RLS boundaries, narrow function
  authority, raw-evidence handling, outcome reconciliation, and idempotency
  collisions. The review added strict nested reviewed-selection validation.
- Fresh reviewer findings/resolution: the original implementation did not run
  an independent fresh-context review. A subsequent six-finding review was
  remediated regression-first: parser-unknown identities now fail; decimal
  evidence is lossless; retry hashes use the complete normalized vector;
  migration/function `NULL` checks fail closed; canonical and dedupe uniqueness
  races become savepoint-backed conflicts; and illegal lifecycle attempts are
  bounded, audited conflicts without new transitions.
- Bounded final-review findings/resolution: three additional findings were
  reproduced and remediated regression-first. Generic PostgreSQL updates now
  retain matching exact import numerics and provenance without allowing stale
  evidence to mask a changed value; the imports route preserves
  `IMPORT_COMMIT_REQUEST_INVALID`; and every mapped numeric is checked against
  PostgreSQL's exact integer/scale envelope before materialization, with at most
  100 detailed failed-row outcomes while full summary counts still reconcile.
- Final-review evidence:
  - RED: `node --test test/import-commit.test.js` failed with
    `MODULE_NOT_FOUND`; follow-on service, repository, static migration, and API
    regressions failed for the absent commit boundary before implementation.
  - Focused GREEN: `node --test test/import-commit.test.js
    test/import-repository.test.js test/import-mapping.test.js
    test/database-migrations-static.test.js test/engineering-harness.test.js`
    passed **47/47**. A post-checkpoint regression first proved that invalid row
    101 could bypass the PR-5B 100-row response sample (`READY` instead of
    `FAILED`); commit planning now validates every staged row and that test is
    green. An earlier sandbox-only run had `EPERM` for loopback/temporary-Git
    operations, not product assertions, and its identical permitted rerun
    passed.
  - Remediation focused GREEN: `node --test test/import-commit.test.js
    test/import-repository.test.js test/import-staging.test.js
    test/import-mapping.test.js test/database-migrations-static.test.js
    test/database-migration-runner.test.js` passed **59/59** with permitted
    loopback binding. The initial regressions failed on the six reviewed paths
    before implementation; an earlier sandbox-only run's loopback `EPERM`
    failures were environmental and the permitted rerun was green.
  - Fast gate: `npm run verify:fast` passed the engineering harness and
    integration **178/178** after remediation.
  - Database: `TGE_TEST_DATABASE_URL=postgresql://127.0.0.1:55433/postgres npm
    run test:db` passed **51/51** against a disposable PostgreSQL **16.15**
    cluster during remediation, including exact numeric persistence/readback,
    unknown identity, `NULL` negatives, illegal lifecycle evidence, concurrent
    dedupe serialization, and a forced real constraint/TOCTOU collision. The
    final rerun passed **51/51**; the server was stopped and its test-only
    directory removed.
  - Build: `npm run build` passed with Vite **8.2.2**, **22** modules.
  - Bounded final-review focused GREEN: `node --test
    test/import-commit.test.js test/import-repository.test.js
    test/import-staging.test.js test/import-mapping.test.js
    test/postgres-persistence.test.js` passed **72/72**.
    The regression-first run had failed on exact decimal update readback and
    missing PostgreSQL numeric validation; loopback-only route tests initially
    hit sandbox `EPERM`, then passed with loopback permission.
  - Bounded final-review fast gate: `npm run verify:fast` passed the engineering
    harness and integration **182/182**.
  - Bounded final-review database gate:
    `TGE_TEST_DATABASE_URL=postgresql://127.0.0.1:55433/postgres npm run test:db`
    passed **52/52** against a disposable PostgreSQL **16.15** cluster. The
    cluster was stopped and its generated test directory removed.
  - Bounded final-review build: `npm run build` passed with Vite **8.2.2**,
    **22** modules.
  - Hygiene: `git diff --check` passed; migrations `001`–`011` were not edited.
- Debt/follow-up: PR-5D owns browser flow/adversarial browser coverage and final
  Issue #13 UI breadth. Production provisioning and JSON cutover remain gated.
