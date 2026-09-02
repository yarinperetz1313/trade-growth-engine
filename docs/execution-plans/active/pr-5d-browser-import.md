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
- [x] Final-review remediation: bounded render-safe preview evidence, coherent non-authoritative analysis, staged-total/disposition-aware committed results, mandatory reconciliation after ambiguous mutation POST responses, frozen commit retry payloads, generation-guarded pending/reset state, and browser-side rejection before reading files above the server limit.

## Verification

| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Smallest remediation tests | `node --test test/import-browser-contracts.test.js` | **PASS: 12/12.** Bounded preview row/cell evidence, coherent draft analysis (including the real deterministic server shape), committed disposition/staged-total reconciliation, ambiguous-POST classification, operation-generation invalidation, and the pre-read file-size boundary fail closed. |
| Targeted PR-5D browser | `npm run test:e2e -- test/e2e/import-workflow.spec.js` | **BLOCKED in ACP before test execution:** Playwright health checks fail with `connect EPERM 127.0.0.1:3100 - Local (0.0.0.0:0)`. The updated spec contains **15** cases, including adversarial semantic payloads, mandatory reconciliation after invalid mutation success, identical commit retry, oversized-file rejection, and pending/reset races; coordinator host execution is required. |
| Full managed browser | `npm run test:e2e` | **NOT RUN in ACP after the same confirmed localhost blocker.** The managed suite now contains **29** cases and requires coordinator host execution. |
| Fast verification | `npm run verify:fast` | **PASS for the exact staged snapshot in a disposable repository:** engineering harness and integration **204/204**. One prior exact-tree run hit a transient HTTP/TLS socket collision in `intelligence-api.test.js`; its isolated **13/13** rerun and the unchanged full rerun passed. A current-worktree run separately exposed only an unrelated, unstaged auth-contract failure; the staged PR-5D snapshot excludes that concurrent work. |
| Database | Existing PR-5C PostgreSQL suites | Not rerun: PR-5D changes no server, repository, migration, auth, tenant, commit, retry, reconciliation, or audit contract. Those suites remain authoritative. |
| Build | `npm run build` | **PASS for the exact staged snapshot:** Vite 8.2.2, 25 modules transformed. |
| Review | `git diff --check`, remediation diff inspection, and worktree status | **PASS:** remediation diff inspected against the four fresh-review findings and whitespace check passed; the resulting checkpoint hash is reported in the handoff. |

## Review and handoff

- Implementer self-check: bounded remediation only; no server, persistence, migration, auth, connector, or retention/deletion behavior changed.
- Fresh reviewer findings/resolution: all four findings have regression coverage and bounded fixes; targeted and full host-side managed Playwright remain required because ACP cannot bind/connect to the managed localhost server.
- Final-review evidence: pure response/recovery/state tests and the full fast gate are green. Targeted and full managed browser execution remain coordinator-owned because ACP cannot connect to its managed localhost server; no current-pass browser success is claimed.
- Debt/follow-up: raw-evidence retention/deletion acceptance and implementation remain a separate reviewed follow-up.
