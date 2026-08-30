# Project State

_Last locally audited on 2026-08-30. This document is a current-state snapshot; CI outcomes require the corresponding GitHub Actions run._

## Current verified shape
Trade Growth Engine is a Vite React + Express local-first CRM. `src/index.js` starts the server, `src/api/` exposes thin structured HTTP boundaries, and `web/main.jsx` provides hash-routed UI. Local JSON persistence flows through `src/services/localStore.js`; tests and E2E use isolated stores. The [Legacy JSON Compatibility Contract](architecture/LEGACY_JSON_COMPATIBILITY.md) and deterministic fixtures characterize that adapter for the future persistence cutover.

Pilot PR-2 adds a PostgreSQL foundation without changing that runtime authority: append-only migrations `001`–`003`, an audited-baseline/owner-role checksum runner, the tenant-scoped `tge` schema, forced RLS and least-privilege group roles, reciprocal RevenueAction effect constraints, immutable typed import/audit evidence, and a real-PostgreSQL test gate. The first CI database run exposed SQLSTATE `42501` because migration `002` selected `tge_owner` before creating the schema; the local remediation now creates the schema as the migration administrator with owner `tge_owner`, then selects that owner before application objects, without granting database-wide `CREATE`. Production repositories, Auth0 authorization, controlled import transitions/deletion, import execution, and JSON cutover do not exist yet. Final database verification remains pending until the remediated `npm run test:db` passes against PostgreSQL 16.15.

Deterministic deal intelligence remains the source of opportunity recommendations. Read-only revenue intelligence aggregates that output. Phase 2 adds `src/revenueActions/`: a durable `revenue_actions.json` domain record with immutable recommendation snapshots, evidence, lifecycle audit, approval state, prepared execution, and CRM result links. The Opportunity Command Center is the detailed execution surface; the Revenue Command Center navigates into it and refreshes after mutations.

## Phase and CI baseline
Phase 2 Opportunity Execution Engine is **locked**: PR-2 does not extend its product behavior. The checked-in Ubuntu workflow runs `npm run verify` with PostgreSQL 16.15 and Chromium, but workflow presence is not a successful run. The latest database result failed all 11 tests in shared migration setup before the local migration-role remediation; a clean CI rerun remains the database/browser authority.

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
- **PR-2 implementation and CI remediation are present; final database verification is pending**: schema/security/migrations/tests/CI plus the migration `002` privilege-order correction and safe diagnostics are present, but this host lacks real PostgreSQL rerun evidence. Vendor decisions still gate provisioning, not the schema work already authorized.
- **PR-3 is next after the PR-2 database gate**: production repositories and transactional RevenueAction persistence. **PR-4 remains separately blocked** on identity/membership and magic-link product decisions.
