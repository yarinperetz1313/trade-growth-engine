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
- [ ] Browser bridge: red/green strict contracts and managed E2E for post-commit
  continuation, refresh/restart recovery, all scan outcomes/empty states,
  unchanged server-ranked first case, immutable evidence, provenance labels,
  inspection/feedback, action continuation, stale responses, 390 px, and keyboard
  critical interactions.
- [ ] Integration and delivery: affected Node/PostgreSQL/E2E gates, one near-final
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

## Review and handoff

- Implementer self-check: pending complete base-diff review.
- Fresh-review readiness: sole-engineer constraint forbids delegation; perform a
  separate defect-first reread of `origin/main...HEAD` after final gates and
  record findings/resolution here.
- Final-review evidence: pending.
- Debt/follow-up: only the explicit non-goals above; do not begin them in this PR.
