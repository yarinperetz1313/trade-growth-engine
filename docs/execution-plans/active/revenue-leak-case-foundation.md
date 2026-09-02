# RevenueLeakCase foundation

## Outcome
- Problem and intended observable result: establish the tenant-safe, durable
  `RevenueLeakCase` contract approved by Issue #8 for the first future
  `STALLED_OPPORTUNITY` detector, without implementing detection, scheduling,
  recovery UI, execution, or attribution.
- Explicit non-goals: detector execution, browser surfaces, Quote Recovery,
  recovered-revenue attribution, autonomous outreach, extra leak types,
  retention/deletion, production operations, or a replacement RevenueAction
  lifecycle.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Tenant and source integrity | Every service/repository/API operation consumes a server-created persistence `TenantContext`; PostgreSQL uses explicit tenant predicates, forced RLS, and same-tenant composite opportunity/action relationships. Cross-tenant and missing identifiers share non-oracular failures. | Issue #8; `AUTHENTICATION_AND_TENANT_CONTEXT.md`; migrations `002`–`010` |
| Identity and reconciliation | A detector/source series has at most one active `OPEN`/`SNOOZED` case. Identical canonical evidence, detector version, economics, and recommendation return that case; material change creates a new case and marks the prior active case `SUPERSEDED` without rewriting its snapshot. | Issue #8 invariants 2, 3, and 10 |
| Commercial semantics | `KNOWN` requires a finite, bounded non-negative decimal amount and ISO-like uppercase currency; `UNKNOWN` and `NOT_APPLICABLE` require both amount and currency to be absent. No recovered-value field exists in this foundation. | Issue #8 economics and attribution invariants |
| Lifecycle and audit | Only `OPEN`, `SNOOZED`, `DISMISSED`, and `SUPERSEDED` are implemented. Snooze/dismiss require human reasons; resume is explicit; action linkage is one-time/idempotent and snapshots the existing RevenueAction fingerprint. Detection evidence and terminal history are immutable. | Issue #8 lifecycle; existing RevenueAction contract |
| Local compatibility | The new JSON collection is tenant-tagged and context-scoped while existing tenantless JSON CRM collections remain unchanged. The default local API uses one fixed server-created local tenant context. | `JSON_PERSISTENCE.md`; mission compatibility requirement |
| Migration safety | Append migration `012`; do not edit migrations `001`–`011`. Runtime receives no delete capability, RLS is forced, immutable fields/lifecycle audit are guarded by database constraints/triggers, and RevenueAction linkage is same-tenant/same-opportunity. | Migration runner/checksum policy and existing PostgreSQL conventions |
| Rollback / recovery | Code can stop exposing the new boundary without altering prior migrations; the schema remains append-only. Case histories are retained and never destructively repaired. | Repository migration policy |

## Slices
- [ ] Red contract tests: canonical identity, value semantics, deep immutable
  evidence, lifecycle/linkage, idempotency, and tenant isolation.
- [ ] Domain and tenant-scoped JSON repository/service/API slice, green under
  focused integration tests.
- [ ] Append-only PostgreSQL schema/repository slice with real-database RLS,
  relationship, concurrency, and history tests.
- [ ] Durable architecture/current-state documentation and stale roadmap wording
  reconciliation, followed by progressive gates and final self-review.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Red-first | `node --test test/revenue-leak-cases.test.js` | New tests fail before implementation for missing contract modules. |
| Focused | `node --test test/revenue-leak-cases.test.js test/revenue-leak-cases-api.test.js` | Domain, local adapter, service, API, and tenant-negative cases pass. |
| Affected | Focused auth, persistence, RevenueAction, API, migration-static suites | Existing trusted-context, action, local compatibility, and append-only contracts remain green. |
| Database | `TGE_TEST_DATABASE_URL=... npm run test:db` | Real PostgreSQL 16.15 proves migration, RLS, tenant relationships, immutable evidence, reconciliation, and action linkage. |
| Full gate | `npm run verify` and `git diff --check` | Harness, integration, database, managed E2E, build, and whitespace checks pass near delivery. |

## Review and handoff
- Implementer self-check: pending.
- Fresh reviewer findings/resolution: one-engineer mission; perform a fresh-pass
  self-review of the actual diff instead of delegating.
- Final-review evidence: pending.
- Debt/follow-up: detector execution, UI/recovery workflows, and conservative
  outcome attribution remain explicitly outside this foundation.
