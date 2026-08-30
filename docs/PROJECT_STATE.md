# Project State

_Last verified for Opportunity Execution Engine Phase 2 on 2026-08-30._

## Current verified shape
Trade Growth Engine is a Vite React + Express local-first CRM. `src/index.js` starts the server, `src/api/` exposes thin structured HTTP boundaries, and `web/main.jsx` provides hash-routed UI. Local JSON persistence flows through `src/services/localStore.js`; tests and E2E use isolated `LOCAL_STORE_DIR` stores.

Deterministic deal intelligence remains the source of opportunity recommendations. Read-only revenue intelligence aggregates that output. Phase 2 adds `src/revenueActions/`: a durable `revenue_actions.json` domain record with immutable recommendation snapshots, evidence, lifecycle audit, approval state, prepared execution, and CRM result links. The Opportunity Command Center is the detailed execution surface; the Revenue Command Center navigates into it and refreshes after mutations.

## Execution lifecycle
`RECOMMENDED → PREPARED → APPROVED → EXECUTING → EXECUTED`, with `REJECTED`, `CANCELLED`, and recoverable `FAILED`. Server-side fingerprint checks supersede stale actions. Communication is deterministic email-draft preparation plus explicit manual confirmation, never external sending. Internal-task execution creates or reuses one linked open task and one linked activity.

## Commands
- `npm run test:integration` — Node isolated API/integration suite.
- `npm run test:e2e` — Playwright temporary-store browser suite.
- `npm run build` — production Vite build.
- `npm run verify` — integration, E2E, then build.

On this Codex host commands require `OPENSSL_CONF=/dev/null`; local Chromium may abort before page creation. Ubuntu GitHub Actions is the browser authority.

## Current test coverage
- Integration tests cover deterministic intelligence, revenue portfolio intelligence, lifecycle validation, snapshots, unknown evidence, stale/closed actions, approval/rejection, manual confirmation, internal task creation/reuse, linked-effect reconciliation, duplicate execution, and structured body errors.
- Seven isolated-store Playwright specs are defined for Command Center closed loops, Revenue Command Center navigation/refresh, manual communication lifecycle, and failure states preserving the prepared draft. Phase 2 browser execution remains pending on Ubuntu CI; local listing is not a green browser run.

## Do not break
- Unknown evidence stays unknown; unknown/zero commercial value is not known `$0`.
- Health is not close probability.
- Deal/revenue intelligence remains deterministic and read-only.
- External communication needs explicit human approval and confirmation; Phase 2 never sends it.
- RevenueAction idempotency is semantic and recovery-oriented, not a substitute for future transactional persistence.
- Developer `data/*.json` must never be touched by tests/E2E.

## Next recommended phase
Run the seven-spec browser suite in GitHub Actions after push and resolve any real browser failures before considering a narrowly scoped adapter/policy phase. Do not add external sending or a persistence migration without a dedicated design phase.
