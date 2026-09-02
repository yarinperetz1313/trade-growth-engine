# PR-5B deterministic import mapping and Data Health

## Outcome
- Problem and intended observable result: enrich the existing tenant-authorized
  CSV staging preview with deterministic, exact-name-first, non-authoritative column
  proposals; explicit review selections; row-level validation; and reconciled
  Data Health metrics over all immutable staged rows.
- Explicit non-goals: canonical CRM reads or writes, ID-map reconciliation,
  import commit/lifecycle mutation, browser UI, XLSX, connectors, AI mapping,
  fuzzy matching, and RevenueAction import behavior.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Safety or data boundary | Analyze only the authorized tenant's existing import batch and immutable staging records. Keep cross-tenant and nonexistent behavior identical. | Issue #13; `IMPORT_STAGING_PREVIEW.md`; service and repository tests |
| Mapping authority | Alias precedence is exact canonical name, then ordered aliases. Ambiguous target/source matches remain conflicts. Every proposal is `DRAFT`, non-authoritative, and unaccepted; explicit selections may be previewed but are not persisted or accepted. | Focused deterministic mapping tests and HTTP contract tests |
| Canonical compatibility | Required fields and types mirror PR-3 mapper inputs and migration `002`; supported targets are prospects, opportunities, tasks, and activities. `revenue_actions` remains outside PR-5B. | `src/persistence/postgres/mappers.js`; migration `002_tenant_domain_schema.sql` |
| Evidence semantics | Validation references source ordinal/row and exact raw cells; it never rewrites evidence or collapses missing/null/blank/unknown/zero/nonnumeric. | Focused validation fixtures and immutable-evidence assertions |
| Reconciliation | Data Health scans every staged row. Response rows, per-field sample values, and per-field issue detail are capped. | 101+ row regression test and PostgreSQL contract test |
| Rollback / recovery | No migration or stored evidence mutation is introduced. Revert local PR-5B commits to restore PR-5A behavior. | Git history |

## Slices
- [x] Contract/TDD slice: add focused tests for alias precedence, conflicts,
  explicit draft selections, types, value-state validation, duplicates, and
  reconciled metrics.
- [x] Integration slice: wire analysis through the existing service/API and
  tenant-scoped staging repository without canonical access.
- [x] Documentation/review slice: update canonical import/status truth, run
  gates, review the diff, and record exact evidence.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Focused | `node --test test/import-mapping.test.js test/import-staging.test.js test/import-repository.test.js` | Mapping, validation, API, isolation, and repository regressions pass |
| Fast | `npm run verify:fast` | Harness and all Node integration tests pass |
| Database | `npm run test:db` when a configured PostgreSQL 16.15 test service is available | Tenant-scoped full-evidence read and no canonical mutation pass |
| Full gate when required | `npm run verify` | Full local harness, integration, DB, managed E2E, and build pass |
| Static | `git diff --check`; final `git status --short --branch` | Clean patch and clean checkpointed worktree |

## Review and handoff
- Implementer self-check: contract/core mapping and validation pass
  `node --test test/import-mapping.test.js` (6/6). The preserved red baseline
  failed with `MODULE_NOT_FOUND` for `src/imports/importMapping.js` before the
  implementation was added. Integration then passed
  `node --test test/import-mapping.test.js test/import-staging.test.js
  test/import-repository.test.js test/import-csv.test.js` (23/23), including
  tenant-safe full-evidence reads and unchanged bounded PR-5A previews. The
  final affected suite passed 25/25 after zero-row target evidence and
  fail-closed selection coverage were added. `npm run verify:fast` passed the
  harness and all 155 integration tests. `npm run build` passed with 22 modules
  transformed. The real database gate was not runnable: the documented Docker
  path is unavailable (`docker: command not found`) and
  `TGE_TEST_DATABASE_URL` is not configured.
- Fresh reviewer findings/resolution: resolved required-unmapped rows being
  counted valid, non-exact/null/unsupported-target selections being accepted,
  a stale Pilot plan status, capped-detail wording, unsupported-target wording,
  and synthesized raw evidence for unmapped targets. Regression coverage now
  keeps required mapping state blocking and separate from immutable cell
  evidence. The final review reported no other findings.
- Final-review evidence: focused mapping 8/8; affected imports 25/25; harness
  plus integration 155/155; production build passed; `git diff --check`
  passed before the final checkpoint.
- Debt/follow-up: PR-5C owns accepted mapping persistence, controlled commit,
  ID-map/canonical conflict reconciliation, and lifecycle transitions; PR-5D
  owns browser mapping UI and E2E.
