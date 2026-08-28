# Test Notes

Integration tests use Node's built-in test runner and isolated `LOCAL_STORE_DIR`. Browser E2E uses Playwright with temporary seeded JSON stores. Tests must never read or mutate developer `data/*.json`.
