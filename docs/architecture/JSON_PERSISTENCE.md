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
