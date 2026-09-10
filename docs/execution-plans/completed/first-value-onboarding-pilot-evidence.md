# First-value onboarding bridge and privacy-minimized pilot evidence

## Outcome

- Problem and intended observable result: after an explicit canonical CSV commit,
  an authorized operator can retain the concrete import Data Health result,
  continue into Revenue Command Center V2, explicitly run the existing bounded
  stalled-opportunity portfolio scan, understand every closed detector outcome,
  inspect the first server-ranked credible imported-customer case, provide one
  bounded structured feedback fact, and continue through the existing
  human-controlled RevenueAction lifecycle. The journey and its minimum pilot
  evidence remain durable, tenant-scoped, retry-safe, and privacy-minimized.
- Gate 1: the coordinator's current instruction approves this exact PR-3 slice.
  GitHub push, PR, CI, merge, and issue mutations remain coordinator-owned.
- Explicit non-goals: Quote Recovery; recovered/influenced revenue or attribution;
  more detectors; native connectors; scheduled/automatic scans; bulk execution;
  autonomous outbound; AI ranking; generic analytics/workflow automation; an
  onboarding questionnaire; raw-evidence retention/deletion; deployment,
  provisioning, or unrelated infrastructure/refactoring.

## Settled minimal contract

| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Evidence authority | Add one dedicated `pilot_evidence_events` authority rather than stretching the generic import/security audit log. It accepts only the eight approved event types and five approved feedback codes, uses explicit bounded non-content columns, and grants runtime only read/insert. | Issues #9/#14; migration and repository regressions |
| Event set | `IMPORT_COMMITTED`, `PORTFOLIO_SCAN_COMPLETED`, `FIRST_CREDIBLE_CASE_SURFACED`, `CASE_INSPECTED`, `REVENUE_ACTION_MATERIALIZED_LINKED`, `ACTION_APPROVED`, `ACTION_EXECUTED`, and `OPERATOR_FEEDBACK`. No generic event endpoint or caller-authored event name/payload exists. | User-approved closed contract |
| Authority | Tenant, actor, and occurrence time come only from trusted server `TenantContext` and server clock. Canonical transition observers derive IDs, status, counts, source class, and value/effect enums from durable import/case/action truth. The browser may only request strict empty-body case inspection/surfacing or one closed feedback enum. | Auth/TenantContext, import, RevenueLeakCase, RevenueAction contracts |
| Privacy | Evidence stores no CSV cells, filenames, names, email/phone, business/opportunity titles, descriptions, case evidence text, message/draft content, free-form feedback, or request bodies. PostgreSQL checks and application validation reject unknown fields, unknown enums, invalid counts, and incoherent event-column combinations. Tests use sentinels to prove customer content is absent. | Privacy threat model below |
| Provenance | Canonical import metadata is the only `IMPORTED_CUSTOMER` proof. Explicit sample/demo metadata is labelled `SAMPLE_DEMO`; other canonical records are labelled `EXISTING_CUSTOMER`. Queue order is unchanged and provenance is visible. First-credible/action pilot milestones require imported-customer provenance, so sample/demo cases cannot satisfy them or contribute to imported-customer evidence. | Existing import provenance; PR-2 queue ordering |
| Import bridge | A successful commit records a bounded coverage/quality snapshot derived from the already-reviewed all-row Data Health result. The committed screen keeps coverage and quality distinct and links directly to the existing Command Center. Durable evidence status permits refresh/restart recovery without persisting raw cells in browser storage. | PR-5B/5C/5D contracts |
| Scan truth | The existing explicit 100-opportunity scan remains manual and server-timed. Its closed response and UI show eligible leak, eligible no-leak, insufficient evidence, stale/untrustworthy source, and Data Health suppression counts/reasons, plus no-opportunity/no-leak next steps. Detector types, thresholds, ordering, and scheduling do not change. | Issue #9 PR-1 and detector v1 |
| Case and action flow | Browser surface/inspection evidence is recorded only after strict queue/case validation. Handoff records materialized-and-linked only after the existing composed authority succeeds. Approval/execution evidence observes existing canonical statuses/effects; it never prepares, approves, executes, sends, or attributes work. | RevenueLeakCase and RevenueAction architecture |
| Semantic idempotency | Unique semantic identity is tenant + event meaning: one import fact per batch, the first completed scan and first surfaced credible case per tenant, one inspection/feedback per case, and one linked/approved/executed fact per canonical action relationship. Same input replays the durable event; conflicting feedback is rejected rather than rewritten. | Dedicated domain/repository contract |
| PostgreSQL recovery | Transition observers run inside the existing trusted tenant transaction wherever the canonical mutation already has one. Forced RLS, explicit tenant predicates, insert-time actor checks, unique semantic keys, and no update/delete permission preserve atomic durable truth. Outcome-unknown callers reconcile through read-only evidence status before a new explicit mutation. | PR-3 transaction and migration contracts |
| JSON recovery | JSON remains local-only, single-process, and cross-file non-atomic. Canonical mutation occurs first, then an atomic replacement of the evidence collection. Explicit retry/reconciliation re-reads canonical truth and semantically reuses the same event; no cross-file transaction claim is made. | JSON compatibility contract |
| Browser concurrency | Route/request generations reject stale import, queue, inspection, feedback, and action responses. Unconfirmed writes lock the relevant control, read durable canonical/evidence status, and never blindly repeat the mutation. | Existing PR-5D and Command Center V2 recovery patterns |
| Rollback | Migration `013` is append-only; migrations `001`-`012` remain byte-identical. Reverting application consumers leaves append-only bounded evidence intact and does not alter import/case/action histories. | Migration runner and checksum gate |

## Privacy threat model

- A malicious or buggy browser may add tenant IDs, event names, unknown fields,
  free text, oversized identifiers, negative/unsafe counts, or customer content.
  Thin routes reject the request before persistence; there is no generic event
  ingestion boundary.
- A compromised request cannot select a tenant or actor. The service uses only
  the server-authenticated context, and PostgreSQL RLS plus an insert guard match
  row tenant/actor to transaction-local trusted context.
- A canonical record may contain customer content in display fields, evidence,
  metadata, prepared communications, or effects. Event builders use allowlisted
  scalar IDs/enums/counts only and never spread/source-clone canonical objects.
- Sample/demo data may look credible. Provenance is derived from canonical import
  metadata or an explicit sample marker, rendered visibly, and sample/demo cases
  are ineligible for first-value/action evidence.
- Lost acknowledgements may prompt retries. Durable semantic uniqueness and
  status reconciliation prevent duplicate events, cases, actions, and effects;
  JSON retains its honest cross-file limitation.
- Application errors must not echo or log request bodies/customer content.
  Pilot-evidence errors are stable codes with bounded field details only.

## Slices

- [x] Plan checkpoint: record the contract, baseline migration hashes, exact
  preflight, and intended red/green gates before production edits.
- [x] Evidence foundation: red domain/API/static/database regressions, append-only
  migration `013`, closed event builders, JSON/PostgreSQL repositories, tenant
  service/status API, strict privacy rejection, isolation, and semantic replay.
- [x] Canonical observers: red/green import commit + Data Health snapshot, scan +
  first credible imported-case surfacing, case inspection/feedback, action link,
  approval, and execution observers, including ambiguous outcomes and JSON repair.
- [x] Browser bridge: red/green strict contracts and managed E2E for post-commit
  continuation, refresh/restart recovery, all scan outcomes/empty states,
  unchanged server-ranked first case, immutable evidence, provenance labels,
  inspection/feedback, action continuation, stale responses, 390 px, and keyboard
  critical interactions.
- [x] Integration and delivery: affected Node/PostgreSQL/E2E gates, one near-final
  full Verify against disposable PostgreSQL 16.15, production build, migration
  checksum comparison, privacy grep/review, complete diff self-review, canonical
  docs/plan evidence, clean checkpoints, and clean worktree proof.

## Verification

| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Preflight | worktree/branch/HEAD/origin/merge-base/status; instructions, plans, issues, architecture, code/tests | Exact pinned `3f0ed74`; clean; no product-decision blocker |
| Foundation red/green | Focused pilot-evidence domain/API/static migration tests | Missing contract fails first; closed schema, privacy, auth, idempotency pass |
| Canonical observers red/green | Focused import, scan/case, RevenueAction, persistence tests | Canonical transition observation and retry/recovery pass without duplicate authority |
| Browser red/green | Focused browser contracts; `npm run test:e2e -- <managed specs>` | Desktop, 390 px, keyboard, refresh, stale/ambiguous response journey passes |
| Database | Disposable PostgreSQL 16.15 via `npm run test:db` | Migration, RLS, tenant isolation, append-only guards, atomic observers, concurrency pass |
| Delivery | `npm run verify:fast`; `npm run build`; one `npm run verify`; `git diff --check` | Report only exact executed outcomes; remove verified temporary resources |

## Evidence log

- Preflight on 2026-09-09: exact worktree and branch
  `feat/first-value-onboarding-pilot-evidence`; `HEAD`, `origin/main`, and
  merge-base all `3f0ed74a2bf2a0ba8bebff5c07ba0ea816063873`; worktree clean.
- The `orch-add-feature` skill was read. Its referenced shared `orch-pipeline`
  file is absent, matching the coordinator's instruction; the approved direct
  research -> plan -> red-first TDD -> review -> gated-checkpoint fallback is in
  use without delegation.
- Governing Issues #9/#14 were read from GitHub. Issue #9's approved comment fixes
  this as milestone slice 3 after the merged scan/queue and Command Center slices;
  Issue #14 supplies the Data Health, resumability, sample exclusion, first-value,
  and privacy-minimized instrumentation requirements.
- Baseline SHA-256 values were recorded for all prior migrations. Relevant tail:
  `010` `fcb19ddba6c2d5bc654af0c3a3172505675dd5c4160876d717b51943b2863e03`,
  `011` `df50ee0697bb7849b3575f9f5aef40673855ec77a4ebcfcd0cf0d8d5e59ca04b`,
  `012` `0ec9ffaf16987d84b319b6dc579edea86bbedcd3cff65f8b9d881f9c4dbba6d8`.
- Planning checkpoint: `7359158` (`docs: plan first-value pilot evidence`).
- Foundation red: `node --test test/pilot-evidence.test.js
  test/database-migrations-static.test.js` failed on the absent domain and
  migration; the API test then failed on the absent router after dependencies
  were installed; `test/pilot-evidence-service.test.js` failed on the absent
  service. A sandbox-only `listen EPERM` was separately distinguished from the
  product red and passed with loopback permission.
- Foundation green: focused domain/service/static tests pass 22/22; the focused
  API test passes 1/1; `npm run test:harness` passes; `git diff --check` passes.
- PostgreSQL 16.15 foundation: Docker was unavailable, so an isolated native
  16.15 cluster at `/private/tmp/tge-pr3-pg16.FroN2U` on port 55439 was used.
  The first migration run exposed and fixed a migration-013 parser ambiguity;
  the first database contract exposed and fixed insufficient check-function
  privileges. `TGE_TEST_DATABASE_URL=postgresql://yarinperetz@127.0.0.1:55439/tge_test
  node --test test/database/postgres-foundation.test.js` then passed 63/63,
  including the new RLS/actor/strict-schema/append-only/idempotency regression.
- Migration 013 current SHA-256 is
  `66bd51d63dd3246ca70a919d156a75a303a32add216ff29fb3f97235c8611192`.
  Rechecked migrations 010-012 still exactly match their recorded baselines.
- A first affected integration run passed 316/317 and found one eager JSON-store
  capability assumption in an existing ordering fixture. The repository now
  defers write-capability validation until an evidence append; the focused
  regression passes. The complete integration suite will rerun at the next
  progressive gate.
- Canonical-observer reds proved the intended boundaries before implementation:
  import plans lacked a bounded Data Health evidence snapshot; committed imports
  emitted no evidence; scan completion had no observer and later valid scans
  conflicted with the tenant milestone; queue entries lacked provenance and a
  lower-ranked case could be surfaced; action link/approval/execution produced no
  evidence.
- Canonical-observer green: `node --test test/import-commit.test.js
  test/import-repository.test.js test/pilot-evidence.test.js
  test/pilot-evidence-service.test.js test/revenue-leak-operating-queue.test.js
  test/revenue-leak-operating-queue-browser.test.js
  test/revenue-leak-action-handoff.test.js test/postgres-persistence.test.js`
  passed 96/96. The complete PostgreSQL contract gate,
  `TGE_TEST_DATABASE_URL=postgresql://yarinperetz@127.0.0.1:55439/tge_test
  npm run test:db`, passed 63/63 against the isolated PostgreSQL 16.15 cluster.
  Replays repair missing JSON observations, PostgreSQL observers share canonical
  transactions, imported provenance is derived from committed import metadata,
  sample/demo and existing records cannot satisfy first-value milestones, and
  the existing queue order remains unchanged.
- Recovery preflight adopted the pinned worktree at `76fbdca` with only the
  three expected browser-test-tail paths dirty. The initial focused browser-tail
  run passed 6/15 and failed 9/15: three missing strict-contract module failures,
  one missing exact inspected-case status projection, and five queue-contract
  failures for the new provenance field. No completed checkpoint was rewritten.
- Strict browser/API recovery green: exact status and mutation envelopes reject
  unknown fields and caller authority; status exposes bounded exact surfaced,
  inspected-case, and linked-action identifiers; queue validation accepts only
  the three closed provenance labels. The adopted focused set passed 15/15 and
  the real HTTP pilot API boundary passed 1/1, including rejection of query
  tenant authority and non-empty/unknown mutation bodies.
- Browser bridge red/green: the source contract first failed because committed
  Data Health/continuation were absent. The managed journey then exposed two
  test-expectation issues (rendered whitespace and multiple live regions), which
  were narrowed without weakening the product contract. The final journey
  restores committed Data Health, requires an explicit scan, explains all five
  outcome classes and their returned closed reasons plus no-opportunity/no-leak
  states, preserves server queue order and provenance, excludes sample/demo from
  first-value evidence, inspects the first imported case, records closed
  feedback, reconciles exact ambiguous writes, survives reload, and continues
  through the existing Opportunity Command Center. Exact-head affected managed
  Chromium passed 27/27, including desktop, 390 px, keyboard, refresh/restart,
  stale-response, and ambiguous-write cases.
- Defect-first review found and fixed three in-scope integrity gaps. First,
  malformed persisted JSON evidence could be returned and status projections
  retained the oldest 100 identifiers while feedback was unbounded; the product
  red was 9/11 and the corrected domain/service set is 11/11. Second, the local
  action observer bypassed that fail-closed validation; its isolated product red
  failed 0/1 and the affected JSON handoff/domain/service set passed 27/27.
  Third, the browser accepted parseable non-canonical mutation timestamps. The
  first attempted red revealed shared mutable test facts masking later cases;
  after isolating the fixture the real product red was 3/4, and the corrected
  browser contract set passed 13/13. That checkpoint conclusion was superseded
  by the later fresh-review block and remediation recorded below.
- Privacy review: the production pilot domain exposes only the recorded exact
  allowlisted fact keys. A case-insensitive grep across `src/pilotEvidence`, the
  pilot API, and migration `013` found none of the prohibited customer-content
  field names; the only request-body references are the empty-body checks and
  exact one-field `feedback_code` contract. Corrupted JSON sentinel regressions
  prove reads and local observations fail with stable non-content errors.
- Migration checksum proof: `010`
  `fcb19ddba6c2d5bc654af0c3a3172505675dd5c4160876d717b51943b2863e03`,
  `011` `df50ee0697bb7849b3575f9f5aef40673855ec77a4ebcfcd0cf0d8d5e59ca04b`,
  and `012` `0ec9ffaf16987d84b319b6dc579edea86bbedcd3cff65f8b9d881f9c4dbba6d8`
  remain byte-identical to the merge base. Migration `013` is
  `66bd51d63dd3246ca70a919d156a75a303a32add216ff29fb3f97235c8611192`.
- Near-delivery `npm run verify` at application checkpoint `2f1d0a3` passed:
  harness, integration 330/330, PostgreSQL 16.15 63/63, managed Chromium 51/51,
  and production build (31 modules, 97 ms). The final `74525d4` change affected
  only browser response validation/tests; exact-head `npm run verify:fast`
  passed harness plus integration 330/330, affected managed Chromium passed
  27/27, and `npm run build` passed (31 modules, 97 ms). PostgreSQL was not
  redundantly rerun after that browser-only change.
- Fresh review of candidate `00f6d8d` blocked on exactly three findings. The
  red-first remediation added regressions before production edits. `node --test
  test/pilot-evidence.test.js` passed 7/13 and failed the intended 6/13: both
  invalid timestamp-counter bounds, both corrupted persisted-JSON reads,
  semantic flat/nested fact equality, and reordered repository replay. The
  elevated focused handoff run passed 16/18 and failed only the intended JSON
  execution-observer lifecycle and reordered local-observer replays; an initial
  sandboxed run also had two unrelated `listen EPERM` failures.
- Remediation keeps pilot observation outside the JSON execution-effect failure
  catch. An observation failure after finalization now leaves the canonical
  action and its single task/activity effect `EXECUTED`; after evidence repair,
  exact replay appends one missing event and creates no duplicate action effect.
  A separate regression proves genuine effect failure still persists `FAILED`
  with `EXECUTION_EFFECT_FAILED`. PostgreSQL observation remains unchanged and
  inside its existing tenant transaction.
- Server validation now applies the existing `total_count` upper bound to both
  `created_at_invalid_count` and `updated_at_invalid_count`, matching migration
  013 and browser validation. Corrupted local JSON carrying either incoherent
  value fails closed on read. JSON repository and local action-observer replay
  compare facts with Node lossless recursive structured equality, matching the
  PostgreSQL repository behavior: flat or nested key order is ignored, arrays
  and values are not normalized, genuine conflicts remain conflicts, and exact
  closed schema validation is unchanged.
- Green remediation evidence: focused pilot evidence passed 13/13; focused
  handoff passed 19/19; the final affected RevenueAction/pilot-evidence/JSON/API/
  browser-contract set passed 70/70; exact-head `npm run verify:fast` passed the
  harness and all 339 integration assertions. No PostgreSQL production/schema
  code changed and the regression is JSON-only, so real PostgreSQL was not
  rerun. No web production code changed; browser contract coverage ran, while
  managed E2E and the production build were not rerun.
- Environment notes: sandboxed process/listener probes returned permission
  errors, so explicitly approved elevated localhost checks/runners were used.
  The existing isolated native PostgreSQL 16.15 cluster was reachable on port
  55439; Docker remained unnecessary. Vite reports the existing non-fatal
  greater-than-500 kB chunk advisory. GitHub delivery was intentionally not run.
- A later bounded final review of candidate `75b8c98` blocked on migration 013's
  PostgreSQL three-valued check semantics. The table check accepted SQL `NULL`,
  and `source_collection` plus `action_status` also fell through nullable
  PL/pgSQL `IF` predicates to `TRUE`. Regressions were added before migration
  edits for JSON `null` in `source_collection`, `value_kind`, `feedback_code`,
  `action_status`, and `execution_effect_type` through direct runtime-authorized
  inserts with the existing tenant, actor, and RLS context.
- Final database remediation red: the focused static migration test failed 0/1.
  The focused real-PostgreSQL test failed 0/1 with all five inserts returning no
  SQLSTATE and all five malformed rows persisted. The first correction run
  proved the table-level `IS TRUE` boundary rejected three cases but still
  allowed the two PL/pgSQL fallthroughs (`source_collection` and
  `action_status`), persisting two rows.
- Final database remediation green: migration 013 now requires its validation
  result `IS TRUE` and makes the two nullable `IF` predicates explicitly
  fail-closed. The focused static test passed 1/1; the focused PostgreSQL test
  passed 1/1 with SQLSTATE `23514` for all five inserts and zero persisted rows;
  the affected PostgreSQL 16.15 contract passed 64/64. Valid event creation and
  semantic replay, forced RLS, tenant/actor guards, append-only grants, and the
  checksum-ledger runner remained green. Browser E2E, build, and full Verify were
  intentionally not rerun for this migration-only correction.
- Migration 013 SHA-256 after the final database remediation is
  `b27c7d6c69990f459b1e51c0d902d55f6a1f44fbf17accb69459b2c26465f6a8`.
  Migrations 001-012 remain byte-identical to merge-base `3f0ed74`. The migration
  static/runner set passed 19/19, the bounded prohibited-content grep passed,
  `npm run test:harness` passed, and `git diff --check` passed. Attribution,
  disposable PostgreSQL/dependency cleanup, and clean-status proof are recorded
  at the local checkpoint handoff.

## Review and handoff

- Implementer self-check: the complete base diff was reread defect-first after
  the bounded remediation, including production persistence, API,
  lifecycle/observer, browser state/recovery, migration, and tests. The 47-file
  scope inventory, observer/catch and fact-comparison call sites, timestamp-count
  coherence, privacy/outbound boundaries, tests, and documentation disclosed no
  further in-scope correction.
- Fresh-review status: the coordinator-supplied independent reviews produced the
  earlier three findings and the later migration-013 fail-closed finding above.
  This work stops after their local remediation and self-review; the coordinator
  owns any next independent review and delivery.
- Final remediation evidence: exact-head fast verification, diff checks,
  migration/privacy checks, attribution, and clean repository proof are recorded
  before the single local fix checkpoint.
- Debt/follow-up: only the explicit non-goals above; do not begin them in this PR.
