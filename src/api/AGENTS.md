# API Notes

Routes are Express routers mounted by `src/api/index.js`. Keep handlers thin: validate input, call domain/action functions, return structured JSON. Intelligence mutations must be explicit, duplicate-safe, and return refreshed opportunity/intelligence/pipeline state.

RevenueAction routes live in `revenueActions.js`; lifecycle and idempotency belong in `src/revenueActions`, never in route handlers.
