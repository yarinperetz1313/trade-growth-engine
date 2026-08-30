# Project State

_Last locally audited on 2026-08-30. This document is a current-state snapshot; CI outcomes require the corresponding GitHub Actions run._

## Current verified shape
Trade Growth Engine is a Vite React + Express local-first CRM. `src/index.js` starts the server, `src/api/` exposes thin structured HTTP boundaries, and `web/main.jsx` provides hash-routed UI. Local JSON persistence flows through `src/services/localStore.js`; tests and E2E use isolated stores. The [Legacy JSON Compatibility Contract](architecture/LEGACY_JSON_COMPATIBILITY.md) and deterministic fixtures characterize that adapter for the future persistence cutover.

Pilot PR-2 is **complete** and adds a PostgreSQL foundation without changing that runtime authority: append-only migrations `001`–`004`, an audited-baseline/owner-role checksum runner, the tenant-scoped `tge` schema, forced RLS and least-privilege group roles, reciprocal RevenueAction effect constraints, immutable typed import/audit evidence, and a real-PostgreSQL test gate. Final remediation was append-only: migrations `001`–`003` remained unchanged.

Commit `8f1b373` fixed PostgreSQL role-creation parameter typing with explicit text casts. CI run `33303061173` then executed all 11 database tests (8 passed, 3 failed), revealing one function-default ACL schema defect and one import negative-fixture defect. Commit `d54d6f1` added `004_global_function_default_privileges.sql`, globally revoked future `tge_owner` function `PUBLIC EXECUTE`, re-protected existing functions, isolated SQLSTATE `23503` missing-source coverage from `23505` duplicate-target coverage, and advanced harness/static/real-database expectations. [GitHub Actions run 33304131266](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33304131266) on `d54d6f1` succeeded: harness passed; integration 68/68; PostgreSQL 16.15 database 11/11; Chromium E2E 7/7; production build passed with 21 modules transformed in 102 ms.

Available local pre-push checks also passed: targeted tests 10/10, integration 68/68, harness, production build with 21 modules transformed, syntax, and `git diff --check`. Local `npm run test:db` was not run because this host has no PostgreSQL endpoint; the successful CI run is the real-database proof. Production repositories, Auth0 middleware/authorization, provisioning, controlled import transitions/deletion, import execution, and JSON cutover do not exist yet.

Deterministic deal intelligence remains the source of opportunity recommendations. Read-only revenue intelligence aggregates that output. Phase 2 adds `src/revenueActions/`: a durable `revenue_actions.json` domain record with immutable recommendation snapshots, evidence, lifecycle audit, approval state, prepared execution, and CRM result links. The Opportunity Command Center is the detailed execution surface; the Revenue Command Center navigates into it and refreshes after mutations.

## Phase and CI baseline
Phase 2 Opportunity Execution Engine is **locked**: PR-2 does not extend its product behavior. The checked-in Ubuntu workflow runs `npm run verify` with PostgreSQL 16.15 and Chromium. [GitHub Actions run 33304131266](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33304131266) on `d54d6f1` is the successful database/browser authority and supersedes the earlier diagnostic result from run `33303061173`.

## Execution lifecycle
`RECOMMENDED → PREPARED → APPROVED → EXECUTING → EXECUTED`, with `REJECTED`, `CANCELLED`, and recoverable `FAILED`. Server-side fingerprint checks supersede stale actions. Communication is deterministic email-draft preparation plus explicit manual confirmation, never external sending. Internal-task execution creates or reuses one linked open task and one linked activity.

## Verification
Follow [`ENGINEERING_HARNESS.md`](ENGINEERING_HARNESS.md) for verification levels and evidence. `npm run verify` is the full harness, integration, real-database, managed-E2E, and production-build gate; report only commands actually executed and their outcomes.

## Do not break
- Unknown evidence stays unknown; unknown/zero commercial value is not known `$0`.
- Health is not close probability.
- Deal/revenue intelligence remains deterministic and read-only.
- External communication needs explicit human approval and confirmation; Phase 2 never sends it.
- RevenueAction idempotency is semantic and recovery-oriented, not a substitute for future transactional persistence.
- Tenant custom GUCs are trusted server-only transaction inputs, not API authorization; RLS does not replace PR-4 membership checks.
- Legacy operational IDs remain text inside `(tenant_id, id)` keys; unknown commercial evidence and source ordinal/timestamps must survive cutover.
- Developer `data/*.json` must never be touched by tests/E2E.

## Milestone status
- Active plan: [**Pilot Readiness**](execution-plans/active/pilot-readiness.md).
- Pilot Readiness **PR-0 is complete**: its architecture, operations, and harness consistency contracts are documented. This does **not** mean production infrastructure, authentication, authorization, tenancy, backups, imports, or deployment have been provisioned or implemented.
- **PR-1 is complete**: it characterized legacy JSON compatibility, including deterministic fixtures, observable ordering/value semantics, RevenueAction lifecycle/effect links, and the migration manifest/handoff. It did not implement production persistence or tenancy.
- **PR-2 is complete**: schema/security/migrations `001`–`004`, tests, and CI are present, and GitHub Actions run `33304131266` passed the full PostgreSQL 16.15 gate. This completion does not imply production repositories, Auth0 middleware, provisioning, import execution, or JSON cutover. Vendor decisions still gate provisioning and release.
- **PR-3 is NEXT but NOT STARTED**: production repositories and transactional RevenueAction persistence. **PR-4 is NOT STARTED/BLOCKED** on identity/membership and magic-link product decisions.
