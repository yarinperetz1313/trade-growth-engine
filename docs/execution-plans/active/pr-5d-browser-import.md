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
- [x] Project-truth documentation, progressive verification, base-diff self-review, and initial clean checkpoint `45555e842d5a083fb1aede0e623895fad959ba07`.
- [x] Fresh-review remediation: fail-closed 2xx import response contracts, GET-before-repeated-POST recovery, reconciliation request coalescing, complete source identity gating, and visible bounded 422 row evidence.

## Verification

| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Smallest remediation tests | `node --test test/import-browser-contracts.test.js` | **PASS: 4/4.** Malformed/negative/semantically invalid success envelopes, wrong-batch results, incomplete source identity, and 404-only retry proof fail closed. |
| Targeted PR-5D browser | `DEBUG=pw:webserver npm run test:e2e -- --grep "fails closed on invalid successful preview\|keeps preview outcome unknown\|blocks confirmation when source identity\|preserves row-level validation evidence\|retries a commit only after GET 404"` | **ACP ENVIRONMENT-BLOCKED before discovery:** the managed server availability check failed with exact error `connect EPERM 127.0.0.1:3100 - Local (0.0.0.0:0)` and the configured web server exited early. |
| Full managed browser | `DEBUG=pw:webserver npm run test:e2e` | **ACP ENVIRONMENT-BLOCKED before discovery:** the same exact `connect EPERM 127.0.0.1:3100 - Local (0.0.0.0:0)` boundary. Coordinator-owned host-side Playwright rerun remains required. |
| Fast verification | `npm run verify:fast` | **PASS on approved host boundary:** engineering harness and integration **196/196**. The initial ACP run was environment-blocked by listener `EPERM` and one temporary Git-index write denial; the unchanged command then passed outside those sandbox restrictions. |
| Database | Existing PR-5C PostgreSQL suites | Not rerun: PR-5D changes no server, repository, migration, auth, tenant, commit, retry, reconciliation, or audit contract. Those suites remain authoritative. |
| Build | `npm run build` | **PASS:** Vite 8.2.2, 24 modules transformed. |
| Review | `git diff --check`, remediation diff inspection, and worktree status | **PASS:** remediation diff inspected against the four fresh-review findings and whitespace check passed; the resulting checkpoint hash is reported in the handoff. |

## Review and handoff

- Implementer self-check: bounded remediation only; no server, persistence, migration, auth, connector, or retention/deletion behavior changed.
- Fresh reviewer findings/resolution: all four findings have regression coverage and bounded fixes; host-side managed Playwright remains the only unexecuted verification evidence.
- Final-review evidence: pure response/recovery tests, full fast gate, build, and diff inspection are green; targeted and full browser discovery are ACP-blocked as recorded above.
- Debt/follow-up: raw-evidence retention/deletion acceptance and implementation remain a separate reviewed follow-up.
