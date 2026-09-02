# Trade Growth Engine Map

## Start here
Trade Growth Engine is a local-first CRM with deterministic deal intelligence and durable, human-controlled revenue actions.

- API launcher: `src/index.js`; reusable server entry: `src/app/index.js`; Express composition: `src/app/server.js`.
- API router: `src/api/index.js` mounts health, prospects, leads, qualification, opportunities, tasks, revenue intelligence, and revenue actions without a parent path prefix.
- Web entry: `web/main.jsx`; API client: `web/lib/api.js`.
- Domain/persistence: `src/{prospects,leads,opportunities,pipeline,sales,revenueActions,revenueLeakCases}`, `src/services/localStore.js`.
- Deterministic intelligence: `src/intelligence/dealIntelligence.js`; action mutations: `src/api/intelligenceActions.js`.

## Canonical references
- Engineering workflow and gates: [`docs/ENGINEERING_HARNESS.md`](docs/ENGINEERING_HARNESS.md)
- Current verified scope: [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md)
- Architecture: [`docs/architecture/OVERALL_ARCHITECTURE.md`](docs/architecture/OVERALL_ARCHITECTURE.md)
- API semantics: [`docs/architecture/API_ACTION_SEMANTICS.md`](docs/architecture/API_ACTION_SEMANTICS.md)
- Revenue-action lifecycle: [`docs/architecture/REVENUE_ACTION_EXECUTION.md`](docs/architecture/REVENUE_ACTION_EXECUTION.md)
- Revenue-leak case foundation: [`docs/architecture/REVENUE_LEAK_CASE.md`](docs/architecture/REVENUE_LEAK_CASE.md)

## Scoped instructions
This file is the default. The nearest `AGENTS.md` overrides it for files in its directory: `test/`, `web/`, `src/api/`, and `src/intelligence/`.

## Safety and verification
- Preserve unknown data, deterministic intelligence, JSON persistence, and explicit human-controlled external-action boundaries.
- Run browser E2E only with `npm run test:e2e`; its wrapper creates, seeds, and removes a managed temporary store. Never point tests at `data/*.json`.
- Use the smallest verification level that proves the change; `npm run verify` remains the full gate. Report commands actually run and their outcomes.
- On interruption: read the active plan (if any), inspect `git status` and the diff, then resume from recorded evidence—never reset or overwrite existing work.
