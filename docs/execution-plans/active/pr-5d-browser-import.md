# PR-5D browser import workflow

## Outcome

- Problem and intended observable result: add the contract-mocked browser CSV upload → preview → deterministic mapping review/change → Data Health → explicit confirmation → canonical commit → result workflow for the existing PR-5A/5B/5C HTTP contracts.
- Explicit non-goals: no full-stack PostgreSQL/Auth0 Playwright composition, retention/deletion implementation, server-contract redesign, XLSX/connectors/generic ETL, JSON cutover, or follow-on Issue #13 work.

## Boundaries and decisions

| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Safety or data boundary | Browser requests contain only the existing bounded import fields. Exact staged cell evidence is presented without coercing missing, blank, zero, unknown, or nonnumeric states. | PR-5A/5B/5C architecture contracts and contract-mocked browser assertions. |
| Compatibility | Use `web/lib/api.js`, hash navigation, existing styling, and managed serial Playwright. PostgreSQL suites remain authoritative for persistence/auth/tenant/atomicity behavior. | Repository `AGENTS.md`, `web/AGENTS.md`, and `test/AGENTS.md`. |
| Retry / recovery | Outcome-unknown responses reconcile through the matching GET before a repeated POST; commit retry reuses the same reviewed request and idempotency key. Conflict and authorization remain distinct terminal UI states. | Existing import HTTP contracts and browser request capture. |
| Retention / deletion | Acceptance and implementation are explicitly deferred to a separate reviewed follow-up; PR-5D makes no completion claim. | Canonical project-truth documentation update. |

## Slices

- [x] Contract-mocked Playwright fixtures and workflow/state assertions.
- [x] Browser API client and import workspace implementing the bounded workflow.
- [x] Adversarial evidence, mapping-change, Data Health, confirmation, conflict, authorization, retry/reconciliation, empty, loading, error, and success coverage.
- [ ] Project-truth documentation, progressive verification, base-diff self-review, and clean checkpoint commits.

## Verification

| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Harness | `npm run test:harness` | **PASS:** engineering harness. |
| Focused browser | `npm run test:e2e -- --grep "uploads adversarial CSV evidence"` | **ENVIRONMENT-BLOCKED before discovery:** the managed Vite server cannot bind its fixed localhost port in this sandbox (`listen EPERM`). The same boundary blocks every listener-based integration/E2E command; escalation is outside this mission. |
| Focused import domain | `node --test test/import-csv.test.js test/import-mapping.test.js`; selected non-listener import commit/staging tests | **PASS:** 18/18 parser/mapping, 15/15 commit domain/service, and 4/4 staging/auth/analysis tests. |
| Affected combined import suite | `node --test test/import-csv.test.js test/import-mapping.test.js test/import-staging.test.js test/import-commit.test.js` | **PARTIAL:** 37 passed; 11 listener-based route tests were environment-blocked by `listen EPERM`, with no assertion failures. |
| Database | Existing PR-5C PostgreSQL suites | Not rerun: PR-5D changes no server, repository, migration, auth, tenant, commit, retry, reconciliation, or audit contract. Those suites remain authoritative. |
| Build | `npm run build` | **PASS:** Vite 8.2.2, 23 modules transformed. |
| Review | `git diff --check`, `git diff b529bb6...HEAD`, and worktree status | `git diff --check` passed. Base-diff review and checkpoint status pending. |

## Review and handoff

- Implementer self-check: pending.
- Fresh reviewer findings/resolution: pending independent fresh-context review after local handoff.
- Final-review evidence: pending.
- Debt/follow-up: raw-evidence retention/deletion acceptance and implementation remain a separate reviewed follow-up.
