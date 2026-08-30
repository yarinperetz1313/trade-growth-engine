# Project State

_Last locally audited on 2026-08-30. This document is a current-state snapshot; CI outcomes require the corresponding GitHub Actions run._

## Current verified shape
Trade Growth Engine is a Vite React + Express local-first CRM. `src/index.js` starts the server, `src/api/` exposes thin structured HTTP boundaries, and `web/main.jsx` provides hash-routed UI. Local JSON persistence flows through `src/services/localStore.js`; tests and E2E use isolated stores.

Deterministic deal intelligence remains the source of opportunity recommendations. Read-only revenue intelligence aggregates that output. Phase 2 adds `src/revenueActions/`: a durable `revenue_actions.json` domain record with immutable recommendation snapshots, evidence, lifecycle audit, approval state, prepared execution, and CRM result links. The Opportunity Command Center is the detailed execution surface; the Revenue Command Center navigates into it and refreshes after mutations.

## Phase and CI baseline
Phase 2 Opportunity Execution Engine is **locked**: this engineering-harness upgrade does not extend its product behavior. The checked-in Ubuntu workflow runs `npm run verify`, including Chromium setup, but no successful Phase 2 browser CI result is available in this checkout. Local Chromium may abort before page creation on this host, so the actual GitHub Actions run remains browser authority.

## Execution lifecycle
`RECOMMENDED → PREPARED → APPROVED → EXECUTING → EXECUTED`, with `REJECTED`, `CANCELLED`, and recoverable `FAILED`. Server-side fingerprint checks supersede stale actions. Communication is deterministic email-draft preparation plus explicit manual confirmation, never external sending. Internal-task execution creates or reuses one linked open task and one linked activity.

## Verification
Follow [`ENGINEERING_HARNESS.md`](ENGINEERING_HARNESS.md) for verification levels and evidence. `npm run verify` remains the full integration, managed E2E, and production-build gate; report only commands actually executed and their outcomes.

## Do not break
- Unknown evidence stays unknown; unknown/zero commercial value is not known `$0`.
- Health is not close probability.
- Deal/revenue intelligence remains deterministic and read-only.
- External communication needs explicit human approval and confirmation; Phase 2 never sends it.
- RevenueAction idempotency is semantic and recovery-oriented, not a substitute for future transactional persistence.
- Developer `data/*.json` must never be touched by tests/E2E.

## Milestone status
- Active plan: [**Pilot Readiness**](execution-plans/active/pilot-readiness.md).
- Pilot Readiness **PR-0 is complete**: its architecture, operations, and harness consistency contracts are documented. This does **not** mean production infrastructure, authentication, authorization, tenancy, backups, imports, or deployment have been provisioned or implemented.
- **PR-1 is next and not started**: production persistence and tenant isolation remain future work, gated by the unresolved vendor/provisioning decisions in the active plan.
