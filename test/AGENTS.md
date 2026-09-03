# Test Notes

Follow the repository workflow in [`../docs/ENGINEERING_HARNESS.md`](../docs/ENGINEERING_HARNESS.md).

- Integration tests use Node's built-in runner and isolated `LOCAL_STORE_DIR` stores.
- Run browser E2E only through `npm run test:e2e`. The wrapper creates and seeds `TGE_E2E_STORE_DIR`; Playwright passes it to the API as `LOCAL_STORE_DIR`; the wrapper removes it on success, failure, and supported parent-process exits.
- Direct Playwright invocation is intentionally rejected. Tests must never read or mutate developer `data/*.json`.
- E2E seed data includes empty `tasks`, `revenue_actions`, and `revenue_leak_cases` collections; preserve that isolation when adding scenarios.
