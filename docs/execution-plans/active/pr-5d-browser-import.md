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
- [x] Project-truth documentation, progressive verification, base-diff self-review, and rebased implementation checkpoint `f594ed8`.
- [x] Fresh-review remediation at rebased checkpoint `5a743f3`: fail-closed 2xx import response contracts, GET-before-repeated-POST recovery, reconciliation request coalescing, complete source identity gating, and visible bounded 422 row evidence.
- [x] Final-review remediation: just-in-time Auth0 bearer delivery without caller-authored authority, complete mapping/source-identity/timestamp evidence, mandatory reconciliation after ambiguous mutation POST responses, fail-closed coherent response envelopes, frozen retries, generation-guarded reset/pending state, and browser-side rejection before reading files above the server limit.
- [x] Residual-review remediation: leave outcome-unknown recovery when a post-404 repeated preview or commit receives a definitive 4xx, and reconcile preview/analysis success metrics against exact returned evidence without rejecting contract-permitted unsupported targets or inventing evidence beyond the 100-row sample.

## Verification

| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Smallest remediation tests | `node --test test/browser-auth-contract.test.js test/import-browser-contracts.test.js` | **PASS: 18/18.** Production Auth0 bootstrap, fresh bearer acquisition and authority rejection, bounded/coherent preview-analysis-commit envelopes, redistributed value-kind and contradictory Data Health rejection, the 100-row evidence boundary, ambiguous-POST classification, operation-generation invalidation, and the pre-read file-size boundary fail closed. |
| Affected import/browser tests | `node --test test/browser-auth-contract.test.js test/import-browser-contracts.test.js test/import-csv.test.js test/import-staging.test.js test/import-mapping.test.js test/import-commit.test.js test/import-repository.test.js` | **PASS: 78/78** with the HTTP contract tests permitted to use temporary loopback listeners. |
| Targeted PR-5D browser | `npm run test:e2e -- test/e2e/import-workflow.spec.js` | **PASS: 18/18** through the managed temporary-store wrapper, including GET → retry → definitive-4xx recovery for preview and commit, evidence rendering, ambiguous outcome reconciliation, oversized-file rejection, identical retry, and late-response reset races. |
| Full managed browser | `npm run test:e2e` | **PASS: 32/32** through the managed temporary-store wrapper. |
| Fast verification | `npm run verify:fast` | **PASS:** engineering harness and integration **209/209** with the HTTP contract tests permitted to use temporary loopback listeners. |
| Database | Existing PR-5C PostgreSQL suites | Not rerun: PR-5D changes no server authentication/authorization, repository, migration, tenant, commit, retry, reconciliation, or audit contract. Those suites remain authoritative. |
| Build | `npm run build` | **PASS:** Vite 8.2.2, 28 modules transformed. |
| Review | `git diff --check`, remediation diff inspection, and worktree status | **PASS before checkpoint:** combined scope and security reviews found no remaining code blocker; final commit hashes and clean status are reported in the handoff. |

## Review and handoff

- Implementer self-check: bounded remediation only; no server authentication/authorization, tenant, persistence, migration, connector, or retention/deletion contract changed.
- Fresh reviewer findings/resolution: all seven bounded findings have regression coverage and scoped fixes; the three unexpected test/fixture artifacts were inspected, corrected where needed, and adopted as durable coverage.
- Final-review evidence: focused contracts, affected import/browser tests, targeted and full managed Playwright, the full fast gate, and the production build are green.
- Debt/follow-up: raw-evidence retention/deletion acceptance and implementation remain a separate reviewed follow-up.
