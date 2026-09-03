# Deterministic stalled-opportunity detector

## Outcome
- Problem and intended observable result: evaluate one tenant-visible canonical
  opportunity with a versioned deterministic rule, return one of five explicit
  evidence outcomes, and reconcile only credible `STALLED_OPPORTUNITY` detections
  through the existing RevenueLeakCase foundation.
- Explicit non-goals: browser UI, scheduling or import hooks, extra leak types,
  RevenueAction execution changes, autonomous outreach, outcome attribution,
  recovered-revenue claims, retention/deletion, or persistence-schema changes.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Eligibility | A supported active-stage opportunity is a leak only at or after 14 exact 24-hour days from its latest canonical activity (falling back to opportunity creation) and only when neither a meaningful opportunity `next_action` nor an `OPEN`/`IN_PROGRESS` task exists. `WON`/`LOST`, recent evidence, and a present next action are distinct no-leak reasons. | Issue #8 determinism/evidence invariants; existing opportunity, task, activity, and deal-intelligence contracts |
| Freshness and minimum evidence | Canonical timestamps must be valid and non-future. The newest canonical opportunity/task/activity observation may be at most 90 exact 24-hour days old; older evidence is too stale to authorize a case. A recognized stage and a valid activity-or-creation baseline are required. Boundaries are inclusive for 14-day staleness and 90-day source freshness. | Conservative first-credible-leak policy; `DETERMINISTIC_CONTRACTS.md`; Issue #8 immutable evidence requirement |
| Data Health | Missing minimum evidence is not a leak. Malformed stage, timestamps, next-action/task state, or commercial evidence is an explicit Data Health suppression. Future or over-age canonical observations are a separate stale/untrustworthy-source outcome. Reason codes are a closed detector-versioned set. | Import/Data Health fail-closed conventions; canonical schemas |
| Commercial truth | `KNOWN` is emitted only from a non-negative canonical number/decimal string plus a valid canonical three-letter currency. Zero stays known zero. Missing/null/blank/recognized unknown values, or a valid amount without currency, remain `UNKNOWN`; malformed or unrepresentable supplied value/currency suppresses detection. No probability, expected value, recovery, or attribution is produced. | RevenueLeakCase economics contract; numeric import evidence contract |
| Identity and reconciliation | Detector ID/version and a stable fingerprint of only conclusion-relevant canonical evidence form the source version. Run time is excluded from semantic evidence. Only the existing case builder/repositories perform case identity, duplicate replay, supersession, lifecycle, and persistence. | Merged PR #25 foundation |
| Tenant and persistence | The API accepts only an opportunity ID and an empty body. JSON rejects non-local tenant contexts before reading tenantless collections. PostgreSQL loads and reconciles inside one trusted tenant transaction; cross-tenant and missing IDs share `REVENUE_LEAK_SOURCE_UNAVAILABLE`. No migration is needed. | Trusted `TenantContext`, JSON compatibility, PostgreSQL RLS/repository contracts |
| Recovery | Non-leak/suppressed outcomes never mutate case history. Repeated detected evidence reuses the active or latest matching terminal case; changed detected evidence follows foundation supersession and never rewrites a predecessor. | RevenueLeakCase lifecycle/reconciliation contract |

## Slices
- [x] Red detector contract tests: five outcomes, closed reason-code set, exact
  freshness/staleness/no-next-action boundaries, deterministic ordering/version,
  and lossless known/unknown value semantics.
- [x] Red service/API tests: bounded request, JSON tenant isolation, stable replay,
  snooze/dismiss history, and material-evidence supersession.
- [x] Pure detector and existing-service/API integration, without new lifecycle,
  scheduler, UI, or migration.
- [x] Real PostgreSQL detector/reconciliation coverage proving tenant isolation,
  atomic scoped loading/reconciliation, duplicate replay, and supersession.
- [x] Durable architecture/current-state/API documentation and final review.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Red-first | `node --test test/stalled-opportunity-detector.test.js test/revenue-leak-cases-api.test.js` | New focused contracts fail before detector implementation. |
| Focused | Same command after each coherent slice | Detector, JSON service, and HTTP seam pass. |
| Affected | RevenueLeakCase, intelligence, import, RevenueAction, API, persistence, and migration-static suites | Existing deterministic/persistence contracts remain green. |
| Database | `TGE_TEST_DATABASE_URL=... npm run test:db` | Real PostgreSQL proves tenant-scoped detector reconciliation. |
| Delivery | `npm run verify:fast`, `npm run build`, `git diff --check`, complete `origin/main..HEAD` review | Non-browser delivery gates and hygiene pass; browser gate remains coordinator-owned because no browser code changes. |

## Review and handoff
- Red evidence: before detector implementation,
  `node --test test/stalled-opportunity-detector.test.js test/revenue-leak-cases-api.test.js`
  exited 1 because the detector module did not exist. The API file also exposed
  the clean-worktree environment's missing `express` dependency; `npm ci`
  restored the pinned dependencies before the green run.
- Focused green evidence: detector/API **16/16**; detector plus the existing
  foundation **40/40**. The affected RevenueLeakCase, intelligence, import,
  RevenueAction, persistence, API, and migration-static selection passed
  **180/180** assertions.
- Delivery evidence: `npm run verify:fast` passed the harness and integration
  suite (**263/263** assertions); `npm run build` transformed 28 modules and
  completed successfully; `git diff --check` passed.
- Real persistence evidence: a fresh native PostgreSQL 16.15 cluster ran
  `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55442/postgres npm run test:db`;
  **56/56** tests passed, including atomic tenant-scoped detector reconciliation.
  The disposable cluster was stopped and removed afterward.
- Implementer self-check found and resolved five boundary gaps before final
  delivery: the PostgreSQL source opportunity now locks before dependent reads;
  child reads are ordered on the transaction's single checked-out client;
  duplicate canonical activity/task IDs and reversed timestamp order now
  suppress; task completion evidence must agree with task status. Regression
  contracts cover each correction. A final red-first review contract also proved
  that valid but conclusion-irrelevant historical labels/due dates changed the
  fingerprint; the source version is now derived only from the recorded why-now
  evidence, so those edits replay while actual evidence changes supersede.
  Complete `origin/main..HEAD` inspection found
  no remaining P0-P3 issue and confirmed migrations `001`-`012` are unchanged.
- Fresh reviewer findings/resolution: one-engineer direct self-review required; no
  delegated reviewer under this work-unit constraint.
- Checkpoint: `872adbe feat(leaks): detect stalled opportunities`; final
  documentation and self-review checkpoint recorded separately after this plan.
- Browser E2E was not run: no browser code changed and the requested delivery
  boundary leaves that gate coordinator-owned.
- Debt/follow-up: scheduler/import hook, browser recovery, additional leak types,
  outcome attribution, and recovered-revenue reporting remain out of scope.
