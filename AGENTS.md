# Trade Growth Engine Map

## Product
Trade Growth Engine is a local-first CRM and deterministic deal-intelligence app for trade-service growth operations. It turns prospects into opportunities, actions, tasks, activity, pipeline metrics, and browser-verifiable UI state.

## Actual entry points
- API server: `src/index.js` -> `src/app/index.js` -> `src/app/server.js`.
- API routes: `src/api/index.js` mounts health, prospects, leads, qualification, opportunities, and tasks.
- Web app: `web/main.jsx` rendered by Vite from `index.html`.
- API client: `web/lib/api.js` uses `VITE_API_URL` or `http://localhost:3000`.

## Where things live
- CRM/domain flows: `src/prospects`, `src/leads`, `src/opportunities`, `src/pipeline`, `src/sales`.
- API layer: `src/api`.
- Persistence: `src/services/localStore.js` and `data/*.json`.
- Deterministic intelligence: `src/intelligence/dealIntelligence.js` plus action mutations in `src/api/intelligenceActions.js`.
- Durable execution: `src/revenueActions` with routes in `src/api/revenueActions.js`; see `docs/architecture/REVENUE_ACTION_EXECUTION.md`.
- UI: `web/main.jsx`, `web/components`, `web/hooks`, `web/lib`.
- Tests: `test/*.test.js` for API/integration, `test/e2e/*.spec.js` for browser E2E.

## Commands
- `npm test` — existing Node test runner behavior.
- `npm run test:integration` — API/integration tests.
- `npm run test:e2e` — Playwright browser E2E.
- `npm run build` — production Vite build.
- `npm run verify` — integration + E2E + production build.
- `npm run server` — Express API.
- `npm run dev` — Vite dev server.

On this host, Node/npm may need `OPENSSL_CONF=/dev/null` because `/System/Library/OpenSSL/openssl.cnf` is not readable in the sandbox.

## Deterministic invariants
- Unknown data stays unknown: do not convert missing value, contact, service, location, website, or next action into invented facts.
- `health.status` is a deterministic CRM health assessment, not close probability.
- Stage probability drives weighted pipeline value; it is separate from intelligence health.
- Intelligence actions must be explicit, validated, duplicate-safe, and must refresh opportunity, activity, task, and pipeline state.
- Browser E2E must use an isolated temporary `LOCAL_STORE_DIR`; never mutate `data/*.json` developer data.

## Verification evidence requirement
Report exact commands and outcomes. Do not claim success if integration tests, E2E browser setup, or build were not actually run.

## Do not break
- Existing 13 API integration tests.
- Closed-loop Opportunity Command Center behavior.
- Local JSON persistence fallback and `LOCAL_STORE_DIR` isolation.
- Existing developer data under `data/*.json`.
- Current deterministic intelligence semantics.

## Deeper docs
- `docs/PROJECT_STATE.md`
- `docs/architecture/OVERALL_ARCHITECTURE.md`
- `docs/architecture/CLOSED_LOOP_LIFECYCLE.md`
- `docs/architecture/API_ACTION_SEMANTICS.md`
- `docs/architecture/DETERMINISTIC_CONTRACTS.md`
- `docs/architecture/JSON_PERSISTENCE.md`
- `docs/architecture/FUTURE_PERSISTENCE_MIGRATION_PLAN.md`
