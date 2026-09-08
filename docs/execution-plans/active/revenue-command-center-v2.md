# Revenue Command Center V2 and safe case-to-action handoff

## Outcome
- Problem and intended observable result: make the bounded, deterministic
  RevenueLeakCase operating queue the primary Revenue Command Center experience,
  preserving its server order and value truth while letting a human create and
  snapshot-link exactly one compatible existing RevenueAction before continuing
  preparation, approval, and execution in Opportunity Command Center.
- Explicit non-goals: PR 3 onboarding or pilot instrumentation; Quote Recovery,
  attribution, more detectors, connectors, scheduling, autonomous outbound, bulk
  execution, AI ranking, cross-currency aggregation, redesign of PR #28 ordering,
  production provisioning, migrations, and unrelated UI/infrastructure work.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Existing execution authority | Compose `RevenueAction` materialization and the existing RevenueLeakCase snapshot link. Do not add preparation, approval, execution, or effect behavior to the case domain or portfolio UI. | `REVENUE_ACTION_EXECUTION.md`; `web/AGENTS.md`; existing action service/repository |
| Handoff compatibility | An unlinked active `STALLED_OPPORTUNITY` case must still reproduce its stored semantic identity from current canonical evidence. Detector v1 records recovery intent `FOLLOW_UP`, but its required “no next action” facts deterministically select the existing deal-intelligence `CREATE_TASK` adapter before any later follow-up. That one closed pairing is allowed; any other current action type or stale case is rejected before linking. | `stalledOpportunityDetector.js`; `dealIntelligence.js` recommendation precedence; Issue #8 immutable case contract |
| Idempotency and recovery | A linked case is reconciled first from durable case/action identity and returned as a replay. An unlinked retry reuses RevenueAction's existing active semantic identity and then replays/repairs the one-time case link. Browser ambiguous outcomes always reload authoritative queue truth before controls unlock and never automatically repeat the POST. | Existing RevenueAction materialization uniqueness/recovery; existing case one-time link; browser leak mutation pattern |
| PostgreSQL atomicity | Load/lock current case and canonical opportunity evidence, validate, materialize the existing action, and link it through scoped repositories in one trusted tenant transaction. Cross-tenant/missing case, opportunity, and action relationships remain generic/non-oracular. | PR-3 transaction scope, forced RLS, explicit tenant predicates, composite case/action FK |
| JSON atomicity | Use the existing local RevenueAction materializer, then the existing case link. A retry repairs an action-only partial write by semantic reuse; no multi-file atomicity or concurrent-writer claim is made. If evidence changes between partial steps, the durable unlinked action can remain history and the stale case is rejected. | `JSON_PERSISTENCE.md`; local single-process adapter contract |
| Queue/browser truth | Validate the complete versioned queue envelope before render; retain server entry order and filter only by authoritative lifecycle, value kind, and source fields. Owner filtering is omitted because the queue publishes no owner. Missing business context is shown as unavailable, not fabricated. | PR #28 queue projection and API contract |
| Portfolio scan | Keep scan explicit and user-triggered. Its returned summary is the only source for suppressed/excluded counts; the UI does not infer these from active cases. Ambiguous scan results trigger a queue reconciliation, not an automatic scan retry. | `REVENUE_LEAK_CASE.md`; scan completeness contract |
| Product truth | Use “potential revenue at risk,” “known value,” “unknown value,” “why TGE surfaced this,” and “approval required” only where accurate. A newly materialized `RECOMMENDED` action is not called prepared. No recovery, expectation, probability, attribution, autonomy, completeness, or cross-currency claim is inferred. | Product Truth tests and canonical deterministic contracts |
| Rollback / recovery | No migration. Reverting the endpoint and browser consumer leaves existing immutable cases/actions and links valid. Move this plan to completed only after all gates and clean checkpoints. | Existing schema contains the complete link and action identity |

## Risks
- A materializer can supersede incompatible active actions. PostgreSQL mismatch
  failures must roll back; JSON compatibility is prevalidated from the unchanged
  current detector facts before calling the authority.
- A transaction commit may succeed while its response is lost. Browser recovery
  must accept only a strict queue response that confirms the exact case/action
  relationship; otherwise it must present an unresolved state and require a new
  explicit human attempt.
- Queue projection permits absent opportunity/business context. Navigation and
  handoff controls must fail closed without turning that into an empty queue.
- Hash-route unmounts and overlapping refresh/scan/handoff requests must not let
  late responses replace newer queue or opportunity state.

## Slices
- [ ] Critical handoff contract: red API/service/PostgreSQL tests for active/stale,
  compatible/incompatible, same-opportunity/tenant, idempotent replay, JSON partial
  recovery, transaction rollback/outcome-unknown, restart, and audit identity;
  compose existing authority to green and checkpoint.
- [ ] Command Center V2: red browser-contract/E2E tests for strict queue truth,
  unchanged ordering, filters, evidence disclosure, loading/empty/partial/error,
  explicit scan summaries, route races, ambiguous handoff reconciliation,
  keyboard/a11y, and ~390 px layout; implement to green and checkpoint.
- [ ] Integration/docs/remediation: update canonical contracts/current state,
  run affected domain/API/database/browser suites, self-review complete diff,
  remediate findings, run full Verify once, record final evidence, complete plan,
  checkpoint, and prove clean worktree.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Preflight | branch/HEAD/origin/status plus instructions and merged PR #28 inspection | Exact pinned `79f51d4`; clean; contracts reconstructed from source |
| Handoff red/green | `node --test test/revenue-leak-action-handoff.test.js test/revenue-leak-cases-api.test.js` | New endpoint/service contracts fail before implementation, then pass |
| Browser contract red/green | `node --test test/revenue-command-center-v2-browser-contract.test.js test/revenue-leak-browser-contract.test.js` | Strict queue/handoff validation and source constraints fail, then pass |
| Affected integration | Focused RevenueLeakCase, RevenueAction, auth, persistence, intelligence, and browser-contract Node suites; then `npm run verify:fast` | Deterministic and compatibility boundaries remain green |
| Database | Disposable PostgreSQL 16 with `TGE_TEST_DATABASE_URL`, then `npm run test:db` | Atomic handoff, rollback, concurrency, RLS/non-oracular isolation, replay pass |
| Browser | `npm run test:e2e` only | Managed Chromium covers primary queue and failure/recovery/mobile/a11y flows |
| Full | `npm run verify` once near delivery | Harness, integration, PostgreSQL, managed Chromium, and build all pass |
| Final | `git diff --check`; self-review; `git status --short --branch` | No unresolved finding, clean committed candidate |

## Evidence log
- Preflight: pinned PR 2 worktree, branch `feat/revenue-command-center-v2`,
  `HEAD` and `origin/main` both
  `79f51d4183a365e0aea56c77ef6a5413005c352c`, clean.
- Planning harness red: `npm run test:harness` correctly rejected the first plan
  draft because it contained a developer-machine absolute path. The path was
  removed; no executable or product code was involved.
- Shared `orch-pipeline` engine referenced by `orch-add-feature` is absent at its
  documented path. The approved research -> plan -> red-first TDD -> implementation
  -> review -> checkpoint sequence is therefore being executed explicitly without
  delegation, as requested.
- Red evidence: pending.
- Green evidence: pending.

## Checkpoints
- Planning checkpoint: pending.
- Handoff checkpoint: pending.
- Browser checkpoint: pending.
- Final integration/docs checkpoint: pending.

## Review and handoff
- Implementer self-check: pending security, transaction/concurrency, JSON recovery,
  product-truth, API-shape, accessibility, scope, and actual complete-diff review.
- Fresh reviewer findings/resolution: direct fresh-context self-review only; the
  mission prohibits delegation.
- Final-review evidence: pending.
- Debt/follow-up: PR 3 onboarding/pilot instrumentation remains explicitly
  unstarted.
