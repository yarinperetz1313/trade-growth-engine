# Revenue leak portfolio scan and operating queue

## Outcome
- Problem and intended observable result: add one explicit authenticated,
  tenant-wide `STALLED_OPPORTUNITY` scan command and one deterministic read-only
  operating-queue projection over active RevenueLeakCases, canonical business
  context, and linked RevenueAction status.
- Explicit non-goals: scheduler or import hook, Command Center V2, case-to-action
  materialization, onboarding/analytics, Quote Recovery, another detector or leak
  type, outcome/attribution/recovered-revenue claims, autonomous or bulk action
  execution, connectors, provisioning, retention work, and schema migrations.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Explicit command | Add one empty-body POST command. It derives tenant, detector, thresholds, evidence, and evaluation time exclusively on the server and evaluates every admitted canonical opportunity through stalled-opportunity detector version 1. | Approved Issue #9 PR-1 sequence; existing per-opportunity detector/API contract |
| Bounded completeness | The server-owned cap is 100 opportunities per scan and 100 active cases per queue read. Repository enumeration reports total truth; over-cap requests fail before reconciliation/projection and report evaluated, unevaluated, overflow, invalid, and excluded counts. A partial result is never labelled complete. | Existing 100-row bounded-preview convention; Data Health full-set mismatch contract |
| Outcome truth | Successful scans return one result per opportunity plus closed outcome/reason summaries. Detected results distinguish created, replayed, and evidence-superseding reconciliation; every non-detected result stays read-only. | `stalledOpportunityDetector.js`; RevenueLeakCase semantic identity/reconciliation |
| Transaction and tenant safety | PostgreSQL enumerates, locks candidates in stable opportunity-ID order, evaluates, and reconciles in one trusted tenant transaction with explicit predicates, forced RLS, and existing per-series advisory locks. JSON rejects non-local tenant contexts and applies the detected batch through one case-collection replacement while retaining its single-process/non-transactional-file limitation. | TenantContext, repository transaction, RevenueLeakCase adapter contracts |
| Queue truth | Project active `OPEN`/`SNOOZED` cases only. Preserve case evidence and commercial classifications; join only bounded canonical opportunity/business identity and the linked action's immutable snapshot/current status. Do not expose contact fields or raw unrelated customer content. | Approved Issue #9 “Needs you now”; Issue #8 linkage/value contracts |
| Money and ordering | Aggregate exact known amounts by currency, count known-positive and known-zero separately, and retain UNKNOWN/NOT_APPLICABLE counts. Order by attention state, then value-evidence tier; known positive amounts compare only inside the same alphabetical currency group, followed by leak age and case ID as the stable final tie-breaker. No FX, probability, expected value, recovery, or attribution. | Issue #9 ordering/unknown requirements; deterministic and numeric-evidence contracts |
| Migration / recovery | No migration: existing tables contain all required source, context, commercial, lifecycle, and action-link fields. Code/API removal reverts the feature without rewriting case history. | Migration `012`; repository/schema inspection |

## Slices
- [x] Red focused contracts for cap/failure summaries, all five outcomes and
  reasons, replay/supersession, malformed/stale evidence, queue value truth,
  mixed currencies, ordering, tie-breaking, and read-only context.
- [x] Implement the pure scan summary and operating-queue projection contracts.
- [x] Implement JSON and PostgreSQL bounded repository enumeration/batch seams,
  tenant service orchestration, and thin structured APIs.
- [x] Add real PostgreSQL tenant-isolation, transaction, repeated/concurrent scan,
  and queue-context coverage without a migration.
- [x] Update canonical architecture/API/current-state documentation, run
  progressive gates, self-review `origin/main..HEAD`, and create clean checkpoints.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Red-first | `node --test test/revenue-leak-operating-queue.test.js test/revenue-leak-cases-api.test.js` | New contracts fail before production implementation; exact failure recorded below. |
| Focused | Same command after implementation | Domain, JSON service, and API contracts pass. |
| Affected | RevenueLeakCase, detector, intelligence, RevenueAction, persistence, API, auth, and migration-static suites | Existing deterministic, tenant, execution, and schema boundaries remain green. |
| Database | `TGE_TEST_DATABASE_URL=... npm run test:db` against PostgreSQL 16.15 | RLS, explicit tenant predicates, atomic scans, concurrency, replay/supersession, and queue joins pass. |
| Delivery | `npm run verify:fast`; `npm run build`; justified repository-wide gate; `git diff --check` | Report only commands actually executed. |

## Evidence log
- Preflight: branch `feat/revenue-leak-operating-queue`; `HEAD` and
  `origin/main` both `fa4da7fae0cb4b26718ea8652c6b20fc64d786ff`;
  worktree clean.
- Red evidence: after `npm ci` restored the pinned clean-worktree dependencies,
  `node --test test/revenue-leak-operating-queue.test.js test/revenue-leak-cases-api.test.js`
  ran outside the restricted listener sandbox and exited 1 with **7/10 passing**.
  The new domain test failed because `revenueLeakOperatingQueue` did not exist;
  the new scan route returned the Express HTML 404 and the new queue route
  returned 404. All seven pre-existing RevenueLeakCase API tests passed. The
  preceding sandbox attempt also exited 1 with `listen EPERM` and is environment
  evidence, not product-red evidence.
- Review-red evidence: a focused regression run exited 1 with **13/15 passing**.
  It proved that sub-second detection-time differences collapsed into the case-ID
  tie-breaker. The accompanying absent-body exploration was withdrawn after
  confirming that Express and the established per-opportunity detector normalize
  an absent POST body as the same empty command; non-empty bodies and all query
  parameters remain rejected.
- Green evidence:
  - focused queue/API contracts: **15/15 passed**;
  - affected detector/case/API/intelligence/PostgreSQL-persistence selection:
    **91/91 passed**;
  - `TGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55442/postgres npm run test:db`
    against native PostgreSQL **16.15**: **57/57 passed**, including concurrent
    replay, tenant isolation, evidence supersession, over-cap refusal, exact queue
    projection, and injected mid-batch rollback; the final database run also
    passed **57/57** after adding the rollback assertion;
  - `npm run verify:fast`: engineering harness passed and **281/281 tests passed**;
  - `npm run build`: Vite production build passed (the existing >500 kB chunk
    advisory remains non-blocking);
  - `npm run verify`: the strict harness → integration → PostgreSQL → managed E2E
    → build chain reached its successful final build, exited, dropped its managed
    test database, and left no managed E2E store; tool output retention truncated
    the verbose log. This ran before the final pure age-comparator correction;
    the final focused, 281-test fast gate, build, syntax checks, and diff check all
    ran after that correction without rerunning the browser suite;
  - changed JavaScript syntax checks and `git diff --check`: passed.

## Review and handoff
- Implementer self-check: reviewed tenant derivation and predicates, count/set
  completeness, transaction boundaries and locks, replay/supersession semantics,
  non-detected read-only behavior, decimal/currency truth, queue join integrity,
  public fields, and every explicit non-goal. The review corrected queue age
  ordering to use full recorded millisecond precision while keeping case ID as the
  final tie-breaker.
- Fresh reviewer findings/resolution: not delegated because the mission requires
  one sole primary engineer and prohibits subagents. Direct fresh-context review
  also found the existing JSON action-link validator incorrectly required current
  action status to equal its immutable link-time snapshot; it now accepts valid
  lifecycle evolution while still requiring exact action/opportunity/fingerprint
  identity and a recognized current status.
- Final-review evidence: no migration, web/browser implementation, scheduler,
  import hook, detector/leak type, action materialization/execution, analytics,
  recovery, or attribution code was added. The changed-file set is confined to
  the PR-1 server/domain/persistence contract, tests, and canonical documentation.
- Debt/follow-up: PR 2 Command Center V2 and safe case-to-RevenueAction handoff,
  then PR 3 onboarding/evidence, remain coordinator-gated and unstarted.
