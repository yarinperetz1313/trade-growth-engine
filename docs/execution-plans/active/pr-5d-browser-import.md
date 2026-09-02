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

## Verification

| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Smallest remediation tests | `node --test test/import-browser-contracts.test.js` | **PASS: 4/4.** Malformed/negative/semantically invalid success envelopes, wrong-batch results, incomplete source identity, and 404-only retry proof fail closed. |
| Targeted PR-5D browser | `npm run test:e2e -- test/e2e/import-workflow.spec.js` | **PASS on coordinator host: 12/12.** Covers the complete workflow plus malformed success envelopes, non-404 reconciliation failure, identity-coverage blocking, bounded 422 evidence, and 404-only identical commit retry. ACP remained unable to bind localhost, so the required browser evidence was produced at the coordinator layer. |
| Full managed browser | `npm run test:e2e` | **PASS on coordinator host: 26/26.** The complete managed Chromium suite passed after remediation. |
| Fast verification | `npm run verify:fast` | **PASS on approved host boundary:** engineering harness and integration **196/196**. The initial ACP run was environment-blocked by listener `EPERM` and one temporary Git-index write denial; the unchanged command then passed outside those sandbox restrictions. |
| Database | Existing PR-5C PostgreSQL suites | Not rerun: PR-5D changes no server, repository, migration, auth, tenant, commit, retry, reconciliation, or audit contract. Those suites remain authoritative. |
| Build | `npm run build` | **PASS:** Vite 8.2.2, 24 modules transformed. |
| Review | `git diff --check`, remediation diff inspection, and worktree status | **PASS:** remediation diff inspected against the four fresh-review findings and whitespace check passed; the resulting checkpoint hash is reported in the handoff. |

## Review and handoff

- Implementer self-check: bounded remediation only; no server, persistence, migration, auth, connector, or retention/deletion behavior changed.
- Fresh reviewer findings/resolution: all four findings have regression coverage and bounded fixes; host-side managed Playwright remains the only unexecuted verification evidence.
- Final-review evidence: pure response/recovery tests, full fast gate, build, diff inspection, targeted browser **12/12**, and full managed browser **26/26** are green. The branch was then rebased cleanly onto `origin/main` at `f7b2666` before push/review.
- Debt/follow-up: raw-evidence retention/deletion acceptance and implementation remain a separate reviewed follow-up.
