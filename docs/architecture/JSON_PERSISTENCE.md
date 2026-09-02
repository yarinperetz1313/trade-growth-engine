# JSON Persistence Architecture

`src/services/localStore.js` is the current persistence boundary.

## Behavior
- Default directory: `data/` under the current working directory.
- Test override: `LOCAL_STORE_DIR`.
- Collection mapping: each collection is stored as `<collection>.json`.
- Missing collections are initialized as empty arrays.
- Writes replace the full JSON file.

## Current strengths
- Simple local development.
- Easy deterministic test seeding.
- No external service required for integration and E2E tests.

## Current limits
- No transaction boundary across collections.
- No locking for concurrent writers or multi-process use.
- No tenant isolation model.
- No schema migration runner.
- No backup/restore workflow beyond file copies.

Tests and harnesses must use `LOCAL_STORE_DIR` so developer data remains untouched.

The executable legacy compatibility baseline and PR-2 persistence handoff are canonical in [Legacy JSON Compatibility Contract](LEGACY_JSON_COMPATIBILITY.md).

## RevenueAction collections
`revenue_actions.json` is a first-class local collection accessed only through `src/revenueActions/revenueActionRepository.js`. Its cross-collection effects (task/activity/opportunity/action) are not transactional. The execution service therefore writes `EXECUTING` plus the approved execution mode before side effects and reconciles only task/activity records whose structured action, opportunity, effect, and state metadata match exactly. Partial-effect staleness checks exclude only those exact own effects. This reduces duplicate risk but does not make JSON storage safe for concurrent multi-process writers; the future persistence migration must replace this with transactional repository operations and database constraints.

## RevenueLeakCase collection

`revenue_leak_cases.json` retains immutable detection snapshots, canonical
identity, lifecycle audit, supersession links, and optional RevenueAction
identity. Unlike the older tenantless local CRM collections, each case carries
the fixed local tenant ID and every repository call requires its branded local
`TenantContext`. A changed reconciliation replaces the single case collection
once with both the terminal predecessor update and new case. This preserves
local/test operation but does not make JSON multi-process or cross-collection
transactional; PostgreSQL remains the production tenant-isolation authority.
