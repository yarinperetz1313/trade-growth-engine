# Engineering Harness

This is the operational contract for making Trade Growth Engine changes safely and reviewably. Pilot Readiness PR-0 documented future-state contracts without provisioning; later approved changes must keep their scope and evidence explicit.

## Quick path
1. Read the nearest `AGENTS.md` and the current-state/architecture reference for the affected boundary.
2. Use the smallest verification gate below; record the exact result.
3. For multi-session or risk-bearing work, create an [`execution plan`](execution-plans/README.md) before implementation.

## Authoritative sources

| Need | Source | Status |
| --- | --- | --- |
| Working rules and navigation | [`../AGENTS.md`](../AGENTS.md) and nearest scoped `AGENTS.md` | Authoritative instructions |
| Current product facts | [`PROJECT_STATE.md`](PROJECT_STATE.md) | Authoritative, time-stamped snapshot |
| Domain/API/persistence contracts | [`architecture/`](architecture/) | Authoritative technical contracts |
| Change intent and evidence | [`execution-plans/`](execution-plans/README.md) | Authoritative while active; completed plans are historical |
| CI result | GitHub Actions run for `.github/workflows/verify.yml` | Generated evidence; do not infer a pass from workflow presence |

Generated reports and local terminal output are evidence, not source-of-truth policy. Historical plans explain prior decisions but do not override current contracts.

## Verification ladder

| Level | Use for | Command | Gate |
| --- | --- | --- | --- |
| Harness | Docs/scripts/CI contract changes | `npm run test:harness` | Deterministic structural invariants |
| Fast | Most API/domain changes | `npm run verify:fast` | Harness plus Node integration suite |
| Database | Migrations, RLS, grants, PostgreSQL constraints | `npm run test:db` | Real PostgreSQL 16.15; requires `TGE_TEST_DATABASE_URL` |
| Browser | UI or browser-flow changes | `npm run verify:browser` | Harness plus managed serial E2E |
| Full | Cross-boundary/release-ready work | `npm run verify` | Harness, integration, database, E2E, production build |

`npm run verify` is not weakened: it runs harness → integration → real database → E2E → build. Use `OPENSSL_CONF=/dev/null` only when the host requires it; that is an environment constraint, not proof that browser E2E or PostgreSQL passed.

For local database verification, start the pinned disposable service with `docker compose -f compose.test.yml up -d`, export `TGE_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/tge_test`, run `npm run test:db`, then stop it with `docker compose -f compose.test.yml down`. The suite creates and drops an ephemeral database and a non-superuser login; use only a dedicated administrative test server. `npm run db:migrate` separately requires `TGE_DATABASE_URL` and never falls back to a production-looking generic variable.

### Mechanical invariant ownership

`npm run test:harness` runs `scripts/check-engineering-harness.mjs`. It validates only grounded, cheap rules:

- canonical documentation links and referenced `npm run` scripts resolve;
- runtime/generated stores are not tracked;
- executable/configuration and relevant untracked documentation have no developer-home absolute path;
- `src/intelligence/` has no web-client dependency or `fetch` call;
- E2E retains managed-store creation/seeding/cleanup, `LOCAL_STORE_DIR` injection, serial fixed-port configuration, and empty seeded `revenue_actions` and `revenue_leak_cases` collections.
- migration `001` retains its locked checksum; append-only migrations through RevenueLeakCase foundation `012` (after PR-3 `005`–`009`, PR-4 `010`, and PR-5C `011`), the checksum-ledger runner, audited-baseline refusal, post-bootstrap owner-role execution, pinned PostgreSQL 16.15 Compose/CI service, explicit database URL, and full-gate wiring remain present.
- the PR-4 Auth0 decision, issuer-bound membership, hashed assisted invitations, memory-only browser SDK configuration, and deployment-gated real OTP acceptance contract remain aligned across code and canonical docs.
- the active Pilot Readiness plan and its two canonical contracts agree on a small set of locked production facts; it does not scan historical plans or certify provisioned infrastructure.

The Node test suite executes this gate too, so a broken gate is itself a test failure. These checks intentionally do not enforce file-size, style, or speculative architecture rules.

## E2E and CI contract

Use only `npm run test:e2e`. It creates a marked temporary `TGE_E2E_STORE_DIR`, seeds deterministic collections (including `revenue_actions: []`), and removes that store after success, failure, signals, or supported parent errors. It never uses developer `data/*.json`.

Playwright is intentionally serial (`workers: 1`, `fullyParallel: false`) and uses fixed API/web ports. Do not run concurrent local E2E processes; they can collide on ports and shared runner state.

CI sets `TGE_TEST_DATABASE_URL` for its pinned PostgreSQL 16.15 service and `TGE_E2E_ARTIFACT_DIR=test-artifacts/e2e` for browser evidence. Playwright writes each run under a unique child of that repository-relative root; unsafe roots are rejected before Playwright can clear them. On failure, GitHub Actions uploads output/traces from the root; temporary CRM stores are still removed. Treat the CI run itself—not workflow presence—as database/browser authority.

## Plans, recovery, and parallel work

Create a plan using the [template](execution-plans/TEMPLATE.md) when work has multiple slices, a safety boundary, or handoff risk. Keep active plans in `execution-plans/active/`; move them to `completed/` only with final verification and unresolved debt recorded.

After interruption:

1. Read the nearest instructions and active plan.
2. Inspect `git status` and the current diff; preserve existing work.
3. Re-run the smallest gate that covers the last changed boundary.
4. Update the plan with evidence, remaining risk, and the next concrete action.

For parallel work, isolate writers in separate worktrees with disjoint file ownership. One implementer integrates shared files; never parallelize migrations, generated data, or E2E runs. Review the worktree/diff before handoff and remove temporary worktrees only after evidence is recorded.

## Review, security, and agent legibility

| Step | Required outcome |
| --- | --- |
| Implementer | Self-check scope, invariants, focused evidence, and plan updates |
| Reviewer | Fresh-context review against authoritative contracts and the diff |
| Final review | Confirm reviewer findings are resolved and report only executed verification |

Security boundaries are deliberately narrow: local JSON is a development persistence mechanism; deterministic intelligence is offline; external communication is prepared and manually confirmed, never sent by this application. PR-4 deterministic tests and the database gate verify code-level authentication, membership, invitation, and RLS contracts. They do **not** certify provisioned Auth0/SMTP behavior, secrets management, encryption, production multi-user isolation, transactional durability, or network hardening. Use the production gate instead of inferring external proof from local checks.

Agent legibility comes from concise maps, canonical links, active plans, and executable gates—not duplicated instruction dumps. No repository-local vendor skill is added: this upgrade is a small, repo-specific policy that belongs in portable Markdown. Add a project skill only if repeated, tool-independent execution guidance demonstrably reduces repetition; then keep it portable and link it here.

## Model routing and quality feedback

Route work by risk and evidence needs, not a vendor/model name: use lower-cost assistance for mechanical navigation and checks; reserve stronger reasoning for safety boundaries, design decisions, or adversarial review. Benchmark any routing change on a fixed representative set (documentation gate, deterministic domain change, E2E isolation, fresh review) and record quality findings, elapsed time, cost, and human rework before adopting it.

Each plan records debt and follow-ups. Failed gates and review findings become either a regression test/check, a contract clarification, or explicit accepted debt with an owner and revisit trigger. This keeps quality signals connected to future work without inflating every task into a process exercise.

## Known limitations

- The existing RevenueAction lifecycle and external-action boundary are not
  expanded by the RevenueLeakCase foundation.
- Pilot Readiness PR-3 persistence and PR-4 auth are integrated in code, complete, and merged through [PR #16](https://github.com/yarinperetz1313/trade-growth-engine/pull/16); JSON remains the local default and production Auth0/SMTP proof remains gated.
- Real Auth0 AU email-OTP E2E remains deployment-gated until tenant and SMTP/email-capture credentials are provisioned.
- Browser CI is configured locally; a green CI outcome cannot be established from this checkout alone.
- Fixed-port serial E2E limits safe local parallelism.
