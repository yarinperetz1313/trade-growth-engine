# Overall Architecture

Trade Growth Engine is a local-first sales intelligence application.

## Runtime
- Browser: Vite + React from `web/main.jsx`.
- API: Express from `src/app/server.js`.
- API composition: `src/api/index.js` mounts feature routers.
- Persistence: JSON collection files remain the default local/test adapter; injected PostgreSQL repositories provide tenant-scoped production persistence.

## Pilot identity boundary

`src/auth/` validates Auth0 access tokens, resolves one active membership by `(issuer, subject)`, derives an immutable `TenantContext`, and applies the centralized OWNER/ADMIN/MEMBER policy. Assisted invitations persist only token hashes and require an exact provisioned identity match before atomic membership activation. The browser PKCE seam lives in `web/lib/auth.js`. Server composition validates the branded auth context, mints a separate branded persistence context, and injects it into PR-3 PostgreSQL routers/transactions. `PostgresAuthRepository.run(TenantContext, work)` applies the same runtime role and request-context assumptions for membership and invitation persistence. See [Authentication and TenantContext](AUTHENTICATION_AND_TENANT_CONTEXT.md).

## Main verticals
- Prospects and qualification create source CRM evidence.
- Opportunities and pipeline calculate stage, probability, value, and weighted value.
- Deal intelligence reads persisted opportunity, prospect, activity, and task state to produce deterministic health and next-best-action guidance.
- Intelligence actions mutate CRM state and return refreshed state to close the loop.
- RevenueLeakCase stores immutable, tenant-scoped leak evidence and deterministic
  reconciliation history before any future recovery consumer acts on it. The
  initial contract supports only `STALLED_OPPORTUNITY`; no detector or UI exists.

## Boundary rule
Keep intelligence deterministic unless a module explicitly performs AI/web research. Do not blend speculative market analysis into CRM health scoring.

## Opportunity Execution Engine
`src/revenueActions/` contains the durable execution domain and repository. `src/api/revenueActions.js` remains a thin Express boundary. It consumes deterministic opportunity intelligence and the read-only revenue snapshot, but does not change either scoring model. The Opportunity Command Center is the only detailed execution UI; the Revenue Command Center remains a projection/navigation surface.

## Revenue leak case foundation

`src/revenueLeakCases/` owns canonical detection identity, explicit commercial
value semantics, minimal audited lifecycle, JSON/PostgreSQL repositories, and
optional same-opportunity RevenueAction linkage. `src/api/revenueLeakCases.js`
is the thin tenant-bound HTTP seam. See [RevenueLeakCase foundation](REVENUE_LEAK_CASE.md).
