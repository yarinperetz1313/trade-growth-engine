# Project State

_Last verified for Revenue Intelligence / Revenue Command Center Phase 1 on 2026-08-29._

## Current verified shape
Trade Growth Engine is an existing Vite React + Express application. The web UI lives under `web/`, the API under `src/api/`, and the server starts from `src/index.js` through `src/app/server.js`.

Persistence currently uses local JSON collections through `src/services/localStore.js`. The store path defaults to `data/`, and tests/E2E can isolate it with `LOCAL_STORE_DIR`.

The main closed-loop feature is the Opportunity Command Center. It loads opportunities, opens an exact opportunity via `#opportunities/:id`, fetches deterministic deal intelligence, performs action mutations, and refreshes UI state from API responses. The Opportunity Intelligence portfolio adds a read-only Revenue Command Center with active/weighted pipeline accounting, deterministic classifications, and links into that same Command Center.

## Verified commands
- `npm test` maps to `npm run test:integration`.
- `npm run test:integration` maps to `node --test test/*.test.js`.
- `npm run test:e2e` maps to `node scripts/run-e2e.mjs`.
- `npm run build` maps to `node node_modules/vite/bin/vite.js build`.
- `npm run server` maps to `node src/index.js`.
- `npm run dev` maps to `node node_modules/vite/bin/vite.js`.
- `npm run verify` maps to `npm run test:integration && npm run test:e2e && npm run build`.

## Current test coverage
- API/integration coverage is in `test/intelligence-api.test.js` and `test/revenue-intelligence-api.test.js`; `OPENSSL_CONF=/dev/null npm run test:integration` passes 24 tests.
- Browser E2E coverage is in `test/e2e/opportunity-command-center.spec.js`, including portfolio → Command Center → mutation → refreshed portfolio navigation. The local suite discovers 5 specs but Chromium aborts with `SIGABRT` before page creation, so the new flow is covered but not locally executed.

## Known environment constraint
In this Codex host, Node/npm fails unless `OPENSSL_CONF=/dev/null` is set because the sandbox cannot read `/System/Library/OpenSSL/openssl.cnf`. This is an execution environment constraint, not an application invariant.

This host also cannot launch Playwright Chromium: the browser process aborts before any E2E page interaction. That is a verified local-host failure, not a claim about application behavior. `.github/workflows/verify.yml` configures Ubuntu CI to install Chromium and run `npm run verify`; CI has not been run from this local task, and no CI execution result is claimed here.

## Not verified / not claimed
- Supabase-backed persistence is configured in code, but this harness does not verify a live Supabase database.
- OpenAI-backed analysis modules exist, but deterministic Opportunity Command Center intelligence does not require OpenAI.
- Repo-local Codex skills are not verified as supported in this app. Recommended workflow is to keep repository instructions in `AGENTS.md` and project docs, and use installed user/global skills when explicitly injected.
