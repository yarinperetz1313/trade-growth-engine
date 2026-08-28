# Overall Architecture

Trade Growth Engine is a local-first sales intelligence application.

## Runtime
- Browser: Vite + React from `web/main.jsx`.
- API: Express from `src/app/server.js`.
- API composition: `src/api/index.js` mounts feature routers.
- Persistence: JSON collection files through `src/services/localStore.js`.

## Main verticals
- Prospects and qualification create source CRM evidence.
- Opportunities and pipeline calculate stage, probability, value, and weighted value.
- Deal intelligence reads persisted opportunity, prospect, activity, and task state to produce deterministic health and next-best-action guidance.
- Intelligence actions mutate CRM state and return refreshed state to close the loop.

## Boundary rule
Keep intelligence deterministic unless a module explicitly performs AI/web research. Do not blend speculative market analysis into CRM health scoring.
