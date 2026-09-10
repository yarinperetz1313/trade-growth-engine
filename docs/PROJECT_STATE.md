# Project State

_Last locally audited on 2026-09-11. This document is a current-state snapshot; CI outcomes require the corresponding GitHub Actions run._

Assisted Pilot Safety Gate V1 Slice 2 now implements the PostgreSQL-only
[raw-import expiry and tenant offboarding
contract](architecture/PILOT_READINESS_FOUNDATION.md#import-safety-retention-and-deletion). Append-only
migration `015_raw_import_expiry_tenant_offboarding.sql` makes database time the
authority for the exact 168-elapsed-hour raw deadline, denies expired staged
rows, adds retry/concurrency-safe targetless cleanup through a distinct
processor-only `tge_maintenance` role with no owner/migrator path, and records
immutable privacy-minimized evidence. The Pilot API
adds tenant-authorized cleanup status plus an active-OWNER and
reauthentication/MFA-gated offboarding request. Offboarding atomically scrubs raw
imports, removes tenant invitation records, and revokes memberships; its truthful
success state is `OFFBOARDED_ACCESS_REVOKED` with scope
`ACCESS_AND_RAW_EVIDENCE_ONLY`. Canonical CRM, ID-map reconciliation, audit, and
Pilot evidence remain intact. Local JSON compatibility and human-controlled
external-action boundaries are unchanged.

The bounded independent High-review remediation adds a terminal tenant write
barrier ordered before offboarding batch discovery, rejects direct runtime
staging inserts into expired, cleaned, committed, failed, and otherwise
non-writable batches, preserves all existing tenant metadata while setting only
`metadata.offboarding_state`, and requires exact tenant/issuer/subject equality
at the server sensitive-action boundary. Offboarding still minimizes only tenant
`slug` and `name`, and does not broaden deletion into canonical or immutable
evidence.

Slice 2 followed red-first delivery. The initial new migration contract was
**1/6**, service/API was **0/4**, and meaningful PostgreSQL behavior was **0/6**
before migration `015` and the new boundaries existed. Focused green evidence
was static/service **45/45**, harness/isolation **14/14**, final
auth/persistence/offboarding **44/44**, and PostgreSQL expiry/offboarding
**7/7**. The final full local gate against disposable PostgreSQL 16.15 passed
the engineering harness, integration **378/378**, database **74/74**, managed
Chromium **51/51**, and the Vite 8.2.2 production build of 31 modules. Migrations
`001`–`014` remain byte-identical and `git diff --check` passed. This does not
prove provider provisioning, production scheduling/credentials/monitoring,
external destructive actions, or a legal basis for canonical CRM deletion.

The six-finding High-review remediation was also delivered red-first. Before
the remediation, the new migration assertions were **6/9**, the offboarding
service assertions were **4/5**, and the disposable-PostgreSQL behavior was
**6/10**: the maintenance authority was still the migrator, the deadline used a
calendar-day interval, terminal/staging write guards and the overlap lock were
absent, tenant metadata was replaced, and a wrong subject was accepted. The
remediated focused static/service tests are **14/14**, the affected
auth/import/persistence set is **69/69**, and the focused PostgreSQL suite is
**11/11**. The proportional final gate passed the engineering harness plus
integration **381/381**, the complete PostgreSQL suite **78/78**, the
harness/migration-static pair **22/22**, `git diff --check`, and the unchanged
SHA-256 values for migrations `001`–`014`. Browser E2E and the production build
were not repeated because this bounded remediation changes no browser or web
production source.

Post-merge [GitHub Verify run 34440327842](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/34440327842)
failed integration at **349 passed / 7 failed** because an engineering-harness
negative self-test rewrote tracked repository files in place during parallel
`node:test` execution. Its temporary replacement of the Auth0
`algorithms: ["RS256"]` contract with unquoted test text made seven concurrent
Pilot-runtime test files load syntactically invalid JavaScript; this was a test
isolation race, not a runtime assertion failure. The bounded remediation runs
every harness-negative mutation in a disposable copied repository with an
independent Git index. A synchronized process regression reproduced the exact
`SyntaxError: Unexpected identifier 'BY'` before the fix and now requires the
live authentication source to parse and every live tracked-file hash to remain
unchanged while the isolated real harness fails closed. Assisted Pilot Safety
At that remediation checkpoint, Gate V1 Slice 2 remained unstarted. Local
remediation evidence was focused
harness/isolation **6/6**, five parallel harness-plus-Pilot stress iterations
at **20/20 each** (**100/100** aggregate), and repeated `npm run verify:fast`
with the engineering harness plus integration **357/357**. An earlier fast-gate
attempt had one transient public-config `fetch failed` result (**356/357**); the
exact file immediately passed **10/10**, and the complete repeated gate passed.
These results do not add database, managed-browser, provider, or delivery
evidence.

A fresh post-merge review then found that harness helpers still inherited
ambient Git controls and that fixture/marker cleanup relied on JavaScript
`finally` blocks. Red regressions were **0/1** when a caller-controlled
repository/index redirected the synchronized fixture/checker/hash path and
**0/1** each for `SIGINT` and `SIGTERM`, with the test-owned fixture repository
left behind. The bounded follow-up strips every `GIT_*` variable only at Git and
checker subprocess boundaries, preserves unrelated test environment, and uses
one owned, idempotent temporary-directory lifecycle whose handlers are removed
after normal cleanup and which re-raises both signals after cleanup. The three
red regressions are now **3/3**, both complete harness files are **10/10**, five
parallel harness-plus-Pilot-runtime stress iterations are **24/24** each
(**120/120** aggregate), and `npm run verify:fast` passed the engineering
harness plus integration **361/361**. No runtime, auth, database, browser,
dependency, workflow, or Slice 2 behavior changed, and no broader evidence is
added.

The final bounded review found two additional P3 harness lifecycle defects:
parent timeout killed only the direct child and could orphan its descendant and
owned directories, while re-raising a signal with unrelated listeners still
installed could invoke them twice and suppress default termination. Red-first
subprocess evidence was **0/3**: both `SIGINT` and `SIGTERM` children timed out,
and the timeout case retained its fixture, marker, and live descendant. The
test-only remediation gives every collected child a dedicated process group,
uses bounded `SIGTERM` cleanup followed by group `SIGKILL` recovery, and removes
remaining listeners before the one signal re-raise. Focused regressions are
**3/3**, the complete harness/isolation pair is **11/11**, and five parallel
harness-plus-Pilot-runtime stress iterations are **25/25** each (**125/125**
aggregate). `npm run verify:fast` passed the engineering harness plus integration
**362/362**. No runtime, product, database, browser, dependency, workflow, or
Slice 2 behavior changed, and no broader evidence is added.

## Current verified shape
Trade Growth Engine is a Vite React + Express local-first CRM. `src/index.js` starts the server, `src/api/` exposes thin structured HTTP boundaries, and `web/main.jsx` provides hash-routed UI. Local JSON persistence flows through `src/services/localStore.js`; tests and E2E use isolated stores. The [Legacy JSON Compatibility Contract](architecture/LEGACY_JSON_COMPATIBILITY.md) and deterministic fixtures characterize that adapter for the future persistence cutover.

Assisted Pilot Safety Gate V1 PR-1 adds the first explicit supported
production-like API bootstrap at `src/pilot/index.js`, exposed as
`npm run server:pilot` and `npm start`. It validates the complete Pilot
configuration before pool/listener creation, always composes Auth0 verification,
membership-derived authorization, the independently branded persistence
`TenantContext`, and all current PostgreSQL business repositories, and has no
JSON or unauthenticated fallback. Migration
`014_secure_pilot_runtime_readiness.sql` provides a narrow invoker-rights probe
for the nonprivileged runtime role. `/health/live` (and compatibility `/health`)
proves only listening; `/health/ready` proves the local database, exact migration,
role, required-schema, and membership lookup path. All other APIs except public
browser Auth0 configuration return `SECURE_RUNTIME_NOT_READY` until that probe
succeeds, then retain normal bearer/membership/tenant enforcement.

Local full verification at reviewed implementation checkpoint `2ec4bfd` passed the
engineering harness, integration **351/351**, real PostgreSQL 16.15 **66/66**,
managed Chromium **51/51**, and the production build. The separately validated
Pilot browser build embedded the exact HTTPS public API origin. This evidence is
local only: it does not prove live Auth0/JWKS, Universal Login/SMTP/OTP,
provisioning, Australian hosting, backup/restore, privacy approval, or deferred
raw-evidence retention/deletion, and no GitHub delivery or external operation was
performed.

A fresh High security review of candidate `e6aa122` blocked on three bounded
findings: migration 014 accepted privileged dual-role logins, the owned pool had
no safe idle-client error listener, and timed-out readiness work could overlap or
mutate state after close. Remediation checkpoint `1718556` makes `tge_runtime`
the only allowed direct/transitive role membership, invalidates readiness on an
owned pool error while logging only a stable code, and gives timed-out probes one
non-overlapping owned lifecycle that close freezes and boundedly drains before
bounded pool shutdown. Product-red evidence was **0/1** for each finding. Green
evidence is migration static **17/17**, focused runtime/auth **23/23**, real
PostgreSQL 16.15 **67/67**, fast integration **355/355** plus harness, and a
Vite 8.2.2 production build of 31 modules in 453 ms. Migrations 001–013 remain
byte-identical. The disposable database was stopped and removed; no browser
behavior changed, so managed Chromium was not rerun. No provider or delivery
claim is added.

A final bounded startup-logging review found that the Pilot entrypoint's quiet
dotenv load was followed by a non-quiet shared config load through the eager
server import graph. The shared load is now quiet without changing local JSON
configuration behavior. A real invalid-startup subprocess regression replaces
the prior source-text check and proves empty stdout plus exactly
`PILOT_RUNTIME_START_FAILED` on stderr, with no dependency-controlled dotenv or
provider/loading metadata.
Focused Pilot/auth passed **24/24**, local JSON compatibility passed **5/5**,
the engineering harness and integration suite passed **356/356**, and the
Vite 8.2.2 production build completed 31 modules in 389 ms. Database and managed
Chromium gates were not rerun because this changed no schema,
auth/tenancy/readiness, or browser behavior.

Pilot PR-2 is **complete** and adds a PostgreSQL foundation without changing that runtime authority: append-only migrations `001`–`004`, an audited-baseline/owner-role checksum runner, the tenant-scoped `tge` schema, forced RLS and least-privilege group roles, reciprocal RevenueAction effect constraints, immutable typed import/audit evidence, and a real-PostgreSQL test gate. Final remediation was append-only: migrations `001`–`003` remained unchanged.

Commit `8f1b373` fixed PostgreSQL role-creation parameter typing with explicit text casts. CI run `33303061173` then executed all 11 database tests (8 passed, 3 failed), revealing one function-default ACL schema defect and one import negative-fixture defect. Commit `d54d6f1` added `004_global_function_default_privileges.sql`, globally revoked future `tge_owner` function `PUBLIC EXECUTE`, re-protected existing functions, isolated SQLSTATE `23503` missing-source coverage from `23505` duplicate-target coverage, and advanced harness/static/real-database expectations. [GitHub Actions run 33304131266](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33304131266) on `d54d6f1` succeeded: harness passed; integration 68/68; PostgreSQL 16.15 database 11/11; Chromium E2E 7/7; production build passed with 21 modules transformed in 102 ms.

PR-3 and PR-4 are complete and merged through [PR #16](https://github.com/yarinperetz1313/trade-growth-engine/pull/16) at `b0a8e36`, which closed [Issue #2](https://github.com/yarinperetz1313/trade-growth-engine/issues/2) and [Issue #5](https://github.com/yarinperetz1313/trade-growth-engine/issues/5). PR-3 supplies tenant-aware PostgreSQL repositories, transaction-scoped persistence, and transactional RevenueAction execution while preserving JSON as the default local/test adapter and preserving unknown JSON-compatible values. Its migrations remain append-only and unchanged at `005`–`009`. PR-4 adds exact Auth0 validation, active-membership authorization, immutable auth `TenantContext`, centralized role policy, assisted invitations, browser PKCE boundaries, and the renumbered append-only migration `010_auth_membership_and_invitations.sql`.

The server validates the independently branded PR-4 auth context, mints a separate trusted PR-3 persistence context from its tenant ID, identity issuer, and subject, and injects it into the PostgreSQL routers and transactions. Auth-enabled business APIs still return `503 TENANT_PERSISTENCE_UNAVAILABLE` when the PostgreSQL adapter/bridge is absent. Production cleanup scheduling/credentials, canonical tenant-data deletion, production provisioning, and JSON cutover do not exist yet. A provisioned Auth0 AU tenant, SMTP/domain evidence, and real external-email OTP E2E remain release gates.

Pilot Readiness PR-5A supplies the bounded CSV-only import contract, parser,
OWNER/ADMIN staging service, tenant-scoped PostgreSQL batch/staging/audit
repository, and a read-only 100-row preview. PR-5B adds deterministic exact-name
then ordered-alias draft mapping, preview-only user selections, row-level
validation, and all-staged-row Data Health through the same authorization,
repository, and transaction boundaries. PR-5C adds an explicit OWNER/ADMIN
canonical commit and reconciliation API for reviewed selections. One tenant
transaction locks immutable evidence, deterministically commits or skips every
row, reconciles the existing ID map, appends bounded audit evidence, and
transitions only `PREVIEWED` to `COMMITTED`. Migration `011` adds global source
identity and typed-target uniqueness plus narrow lifecycle functions without
broad import mutation grants. All three slices preserve exact raw cells and
distinct unknown value states before the later seven-day expiry and perform no
external actions. XLSX and JSON cutover remain later Issue #13 work.

PR-5D adds the hash-routed browser CSV import workspace over those existing
contracts: upload, bounded raw-evidence preview, deterministic mapping review
and change, all-row Data Health, explicit confirmation, canonical commit, and
result. Contract-mocked managed Playwright fixtures cover loading, empty,
general error, unauthorized, conflict, outcome-unknown reconciliation/retry,
success, and adversarial unknown/blank/zero/nonnumeric evidence. Existing
PostgreSQL suites remain authoritative for server persistence, auth, tenant
isolation, commit, retry, reconciliation, and audit behavior. Slice 2's separate
raw-expiry contract adds no browser behavior and does not alter PR-5D's evidence.

PR-5D final-review remediation gates production Auth0 callback consumption on a
structurally complete OAuth code/state response, scrubs the consumed callback URL
before rendering, and fails closed on malformed callbacks or cleanup failure. Its
analysis boundary now requires each collection's exact canonical mapping and
Data Health metadata—including prospect-only contactability—before UI review or
confirmation, while retaining unsupported-target and 100-row evidence bounds.

PR-5C fresh-review remediation additionally makes parser-unknown identities
non-authoritative, keeps unsafe and underflowing decimal staging evidence lossless,
hashes the complete reviewed-selection vector, fails closed on PostgreSQL
`NULL`, normalizes canonical/dedupe uniqueness races into atomic conflicts, and
audits illegal lifecycle attempts without allowing new transitions or raw-cell
leaks.

PR-5C bounded final-review remediation additionally preserves exact imported
commercial and mapped numeric evidence across ordinary PostgreSQL opportunity
updates, returns malformed commit requests as the stable
`IMPORT_COMMIT_REQUEST_INVALID` API contract, and rejects PostgreSQL numeric
overflow or lossy-underflow literals as bounded row-level validation before any
canonical insert. The final remediation below supersedes that earlier generic
numeric envelope.

PR-5C bounded final-review remediation now aligns the canonical commercial
schema and application boundary on `NUMERIC(20,6)`: the exact maximum
`99999999999999.999999` succeeds, while adjacent overflow and excess effective
fractional scale fail before canonical SQL without rewriting staged cells.
Migration `011` alone applies the new typmods and fails closed rather than
rounding incompatible existing canonical values. Blank optional relationship
cells materialize as absent/SQL `NULL`, and defensive savepoint handling turns
any remaining canonical FK `23503` into bounded relationship conflict evidence.
Committed replay fingerprints retain unknown supplied target fields, so only a
materially identical valid request reconciles; changed or invalid vectors
conflict deterministically.

PR-5C final two-finding remediation gives every representable decimal spelling
one exact, non-`Number` canonical interpretation for materialization, payload
fingerprints, and cross-batch reconciliation while retaining the original raw
cell and numeric evidence. Commit-time absent or reused reviewed columns,
including source identity, now return the existing
`IMPORT_COMMIT_REQUEST_INVALID` public API contract instead of the draft-mapping
selection error.

The approved Issue #8 foundation adds `src/revenueLeakCases/`, thin
RevenueLeakCase APIs, local JSON compatibility, and append-only migration
`012_revenue_leak_case_foundation.sql`. Only `STALLED_OPPORTUNITY` is supported.
Cases retain immutable evidence and explicit `KNOWN`/`UNKNOWN`/`NOT_APPLICABLE`
commercial semantics, reconcile one active tenant/source/detector series
deterministically, preserve superseded/terminal audit history, and may snapshot-
link one same-opportunity RevenueAction without changing its lifecycle or
effects. No detector, schedule, post-import hook, browser UI, Quote Recovery,
outcome ledger, recovered-revenue calculation, or attribution exists in that
foundation checkpoint.

The completed bounded Issue #8 follow-on adds detector `stalled-opportunity` version `1`
and an explicit per-opportunity API seam. It produces five distinct outcomes and
creates a case only when a recognized active-stage opportunity is at least 14
exact elapsed days beyond its canonical activity/creation baseline, has no
meaningful opportunity next action or active task, and has canonical source
evidence no more than 90 exact elapsed days old. Missing evidence, stale/future
source observations, and Data Health suppressions remain non-case outcomes.
Known value—including zero—requires a lossless amount and authoritative currency;
valid missing value/currency remains unknown. PostgreSQL loads and reconciles under
one tenant transaction; JSON fails closed for non-local tenants. The slice adds no
migration, scheduler, import hook, UI, RevenueAction execution, recovery claim, or
attribution.

The first credible revenue-leak UX consumes those existing APIs in the Opportunity
Command Center. An authenticated user explicitly runs the detector, sees all five
outcomes and their stable reasons, reviews immutable why-now/source evidence and
potential revenue at risk, reloads durable OPEN/SNOOZED/DISMISSED/SUPERSEDED
history, and supplies audited human reasons for permitted transitions. The panel
can snapshot-link one existing same-opportunity RevenueAction and points to the
existing execution workflow; it does not prepare, approve, execute, send, recover,
or attribute anything. No server/domain/persistence contract or migration changes.

The bounded browser remediation validates complete temporal and audit chronology
before rendering, including non-future evidence and the detector's exact 90-day
source window. Request identity isolates intelligence, detector, case, and
lifecycle state across hash-route changes. Lifecycle and RevenueAction-link writes
with an unconfirmed response are never retried automatically; authoritative
durable case history must reload before the write controls re-enable.

The approved Issue #9 PR-1 operating-loop slice adds an explicit authenticated
tenant-wide stalled-opportunity scan and a read-only active RevenueLeakCase
operating queue. Both are server-capped at 100 and fail rather than report a
partial portfolio as complete. PostgreSQL candidate locking, evaluation, and
reconciliation share one trusted tenant transaction; JSON preserves its
local-only/single-process limits and applies detected scan results in one case
collection replacement. Scan summaries retain all five version-1 outcomes and
closed reasons, including read-only suppression/no-leak results, semantic replay,
and evidence supersession. Queue value truth separates known positive, known zero,
unknown, and not applicable, groups exact totals by currency, and publishes
deterministic ordering without FX, probability, expected/recovered revenue, or
attribution. No migration, scheduler, import hook, new leak type, browser V2,
RevenueAction materialization/execution change, or analytics event is included.

The Issue #9 PR-2 local candidate makes that RevenueLeakCase operating queue the
primary Revenue Command Center surface without changing PR #28 ordering. The
browser validates complete queue and scan envelopes, retains server order, keeps
known positive/zero/unknown/not-applicable values and currencies distinct, shows
immutable “why TGE surfaced this” evidence, and handles stale async responses and
unconfirmed mutations by reconciling durable queue truth. A new empty-command
case handoff revalidates current canonical evidence, composes the existing
RevenueAction materializer with the existing immutable same-opportunity link,
and continues preparation, approval, and execution only in Opportunity Command
Center. PostgreSQL performs that composition in one tenant transaction; JSON
uses semantic reuse plus an explicit retry to repair an action-only partial
write and makes no cross-file atomicity claim. The queue publishes the immutable
historical opportunity identity separately from nullable current opportunity and
business context. If the current opportunity join is absent, the browser keeps
the case and historical identity visible but exposes no Create recovery action,
Open opportunity, or Continue control; valid current context retains those
controls. The strict browser contract rejects fabricated or mismatched context.
The candidate adds no migration, scheduler, autonomous send, new detector,
attribution, recovered-revenue claim, PR-3 onboarding, or pilot instrumentation.

The first independent PR-2 review found three backend issues, remediated at
`ba0ba15`: JSON compatibility is checked before RevenueAction mutation,
PostgreSQL scan/handoff share opportunity-before-case lock order, and a fresh
server link timestamp cannot predate action creation. Exact-head local full
verification at `ba0ba15` passed harness, integration **304/304**, PostgreSQL
**62/62**, managed Chromium **48/48**, and production build. A second independent
review then found the missing-current-context P2 above and stale evidence P3.
Preserved product-red evidence was **22/24** focused and **5/6** managed PR2
Chromium; the six-file remediation is green at **24/24** focused and **6/6**
managed PR2 Chromium. On the documentation-inclusive final candidate,
`npm run verify:fast` passed harness and integration **307/307**, and the
production build passed with **30 modules transformed in 106 ms**. PostgreSQL
was not rerun because this final remediation changes only the pure queue
projection, browser validation/rendering, tests, and documentation; exact
`ba0ba15` database evidence remains **62/62**. A duplicate full Verify was not
run. These are local results, not merge, CI, recovered-revenue, external-action,
or PR-3 evidence.

Fresh PR-2 final-review remediation preserves exact same-currency portfolio
totals when the bounded sum exceeds one case's `NUMERIC(20,6)` envelope: the
browser formats the canonical aggregate decimal string directly and never uses
floating point or combines currencies. The strict queue boundary now rejects
unknown response and queue fields, projects the current opportunity's canonical
prospect identity so any displayed business must match it, and rejects a handoff
whose recorded link time predates the RevenueAction's creation. Product-red
browser-contract evidence was **5/9** with exactly those four adversarial checks
failing; the corrected contract is **9/9**, the focused queue/API/handoff/browser
set is **48/48**, and managed PR-2 Chromium is **7/7**. Near-delivery
`npm run verify:fast` passed the harness and integration **308/308**, and the
production build passed with **30 modules transformed in 398 ms**. PostgreSQL and
full Verify were not rerun because no transaction, repository, migration, or
persistence behavior changed. These remain local candidate results, not CI or
merge evidence.

The approved Issue #9/#14 PR-3 local candidate now completes the bounded
first-value bridge without adding analytics or changing detector/action
authority. A committed canonical import retains privacy-minimized Data Health;
the operator explicitly continues to the existing Revenue Command Center scan,
sees every closed outcome/reason and truthful empty state, then inspects the
first server-ranked imported-customer case, records one closed feedback code,
and continues through the existing case-to-RevenueAction and Opportunity
Command Center controls. Queue ordering remains server-authored, and imported,
existing, and sample/demo provenance are visibly distinct; sample/demo cannot
satisfy first-value milestones.

Migration `013_privacy_minimized_pilot_evidence.sql` adds a closed eight-event,
five-feedback-code append-only evidence authority with exact JSON facts, forced
RLS, tenant/actor insert guards, and runtime select/insert only. Browser writes
cannot provide tenant, actor, time, event name, free text, or evidence payloads.
Status exposes only bounded aggregate import facts and exact case/action IDs for
lost-acknowledgement reconciliation. PostgreSQL observers share canonical
transactions; JSON remains explicitly cross-file non-atomic and fails closed on
malformed persisted evidence. No raw cells, filenames, customer identity/contact
content, case evidence, draft/message content, recovered revenue, or attribution
is recorded.

Local verification for this candidate passed harness/integration **330/330**,
PostgreSQL 16.15 **63/63**, complete managed Chromium **51/51**, and production
build. After the final browser-only canonical-timestamp contract remediation,
exact-head harness/integration remained **330/330**, affected managed Chromium
passed **27/27**, and the production build passed. Migration `010`-`012`
checksums remain unchanged and `013` is recorded in the completed plan. These
are local results only: no push, PR, CI, merge, or issue mutation has occurred.

A later fresh review of candidate `00f6d8d` blocked on three bounded defects,
now corrected locally. JSON RevenueAction execution observes pilot evidence only
after the effect/finalization failure boundary: an observation error can surface
after canonical `EXECUTED` truth, but cannot rewrite the completed action or its
effects to `FAILED`; an exact replay repairs the missing event without duplicate
effects. Genuine execution-effect errors still persist `FAILED` with
`EXECUTION_EFFECT_FAILED`. Server validation now rejects either nullable invalid
timestamp counter above `total_count`, matching migration and browser checks,
including fail-closed reads of corrupted JSON evidence. JSON idempotency uses
lossless recursive structured equality, so object-key order is irrelevant while
different values and the exact closed fact schemas remain conflicts/errors.
Focused remediation passed **70/70** affected RevenueAction, pilot-evidence,
JSON, API, and browser-contract tests. Exact-head fast-gate evidence and final
hygiene are recorded in the completed plan; PostgreSQL, managed browser E2E, and
the production build were not rerun because their production boundaries did not
change. This remains a local candidate with no GitHub delivery.

A subsequent bounded final review of candidate `75b8c98` found that migration
`013` could admit exact-key evidence whose closed enum value was JSON `null`
because PostgreSQL checks accept SQL `NULL`; nullable PL/pgSQL predicates also
allowed `source_collection` and `action_status` to fall through to `TRUE`.
Migration `013` now requires the validator result `IS TRUE` and explicitly
fails closed on those two predicates. Real PostgreSQL regressions cover null
`source_collection`, `value_kind`, `feedback_code`, `action_status`, and
`execution_effect_type`: all five direct runtime-authorized inserts fail with
SQLSTATE `23514` and persist no row. The affected PostgreSQL 16.15 contract
passes **64/64**; the new migration checksum is
`b27c7d6c69990f459b1e51c0d902d55f6a1f44fbf17accb69459b2c26465f6a8`, and
migrations `001`-`012` remain byte-identical to merge-base `3f0ed74`. Browser,
build, full Verify, and GitHub delivery were intentionally not run for this
migration-only remediation.

Deterministic deal intelligence remains the source of opportunity recommendations. Read-only revenue intelligence aggregates that output. Phase 2 adds `src/revenueActions/`: a durable `revenue_actions.json` domain record with immutable recommendation snapshots, evidence, lifecycle audit, approval state, prepared execution, and CRM result links. The Opportunity Command Center is the detailed execution surface; the Revenue Command Center navigates into it and refreshes after mutations.

The Product Truth audit/fix work unit is complete: [PR #17](https://github.com/yarinperetz1313/trade-growth-engine/pull/17) merged at `5231838` and closed [Issue #7](https://github.com/yarinperetz1313/trade-growth-engine/issues/7). This did not provision Auth0, SMTP, production persistence, import execution, or cutover, and it did not begin Pilot Readiness PR-5 or later slices.

## Phase and CI baseline
The existing Phase 2 Opportunity Execution Engine remains unchanged by the
RevenueLeakCase foundation. Its combined PR-3/PR-4 state at `9fe7cea` is verified
by [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854): engineering harness, integration **129/129**, PostgreSQL 16.15 database **44/44**, managed Chromium **7/7**, and the production build passed. Fresh combined review found no P0, P1, or P3 findings; its only P2 was stale verification status corrected in the canonical records. That historical CI run does not prove the later PR-5 or RevenueLeakCase changes, provisioned Auth0 AU, or SMTP behavior.

## Execution lifecycle
`RECOMMENDED → PREPARED → APPROVED → EXECUTING → EXECUTED`, with `REJECTED`, `CANCELLED`, and recoverable `FAILED`. Server-side fingerprint checks supersede stale actions. Communication is deterministic email-draft preparation plus explicit manual confirmation, never external sending. Internal-task execution creates or reuses one linked open task and one linked activity.

## Verification
Follow [`ENGINEERING_HARNESS.md`](ENGINEERING_HARNESS.md) for verification levels and evidence. `npm run verify` is the full harness, integration, real-database, managed-E2E, and production-build gate; report only commands actually executed and their outcomes.

## Do not break
- Unknown evidence stays unknown. The existing revenue portfolio continues to
  treat zero as unknown under its own read-model contract; the leak detector
  preserves an explicitly recorded zero plus currency as `KNOWN` zero under the
  RevenueLeakCase contract. Neither path turns missing evidence into known `$0`.
- Health is not close probability.
- Deal/revenue intelligence remains deterministic and read-only.
- External communication needs explicit human approval and confirmation; Phase 2 never sends it.
- RevenueAction idempotency remains semantic and recovery-oriented. PostgreSQL mode encloses the closed loop in one tenant transaction; JSON mode remains the compatible non-transactional local default.
- RevenueLeakCase evidence and terminal history remain immutable; unknown value
  never becomes zero, potential value never becomes recovered revenue, and only
  RevenueAction owns execution/effect semantics.
- Tenant custom GUCs are trusted server-only transaction inputs, not API authorization; RLS does not replace PR-4 membership checks.
- Legacy operational IDs remain text inside `(tenant_id, id)` keys; unknown commercial evidence and source ordinal/timestamps must survive cutover.
- Developer `data/*.json` must never be touched by tests/E2E.

## Milestone status
- Active plan: [**Pilot Readiness**](execution-plans/active/pilot-readiness.md).
  The [**RevenueLeakCase foundation**](execution-plans/completed/revenue-leak-case-foundation.md)
  and [**deterministic stalled-opportunity detector**](execution-plans/completed/stalled-opportunity-detector.md)
  are complete in their bounded Issue #8 slices. The completed
  [**Revenue leak portfolio scan and operating queue**](execution-plans/completed/revenue-leak-operating-queue.md)
  records Issue #9 PR-1 implementation and verification evidence.
- Pilot Readiness **PR-0 is complete**: its architecture, operations, and harness consistency contracts are documented. This does **not** mean production infrastructure, authentication, authorization, tenancy, backups, imports, or deployment have been provisioned or implemented.
- **PR-1 is complete**: it characterized legacy JSON compatibility, including deterministic fixtures, observable ordering/value semantics, RevenueAction lifecycle/effect links, and the migration manifest/handoff. It did not implement production persistence or tenancy.
- **PR-2 is complete**: schema/security/migrations `001`–`004`, tests, and CI are present, and GitHub Actions run `33304131266` passed the full PostgreSQL 16.15 gate. This completion does not imply production repositories, Auth0 middleware, provisioning, import execution, or JSON cutover. Vendor decisions still gate provisioning and release.
- **PR-3 and PR-4 are complete and merged through PR #16 at `b0a8e36`**: tenant-aware PostgreSQL repositories and transactional RevenueAction persistence consume the membership-derived auth boundary through a server-only trusted-context bridge. The underlying combined state at `9fe7cea` is verified by [GitHub Actions Verify run 33493292854](https://github.com/yarinperetz1313/trade-growth-engine/actions/runs/33493292854), which passed the complete combined gate. Real Auth0 AU/SMTP acceptance remains deployment-gated; that combined PR-3/PR-4 verification did not cover the later PR-5 work summarized below.
- **The Product Truth audit/fix work unit is complete through PR #17 at `5231838`**, and Issue #7 is closed. Its repository-backed UI corrections and managed Product Truth coverage do not establish external-provider, provisioning, import, or cutover evidence.
- **PR-5A implements CSV contract, limits, immutable staging, and bounded preview; PR-5B implements draft mapping, validation, and Data Health analysis; PR-5C implements controlled atomic canonical commit and ID-map reconciliation; PR-5D implements the contract-mocked browser workflow and adversarial state coverage.** Slice 2 now implements the separate seven-day raw-evidence expiry/cleanup contract; cutover and production provisioning remain unimplemented.
- **Assisted Pilot Safety Gate V1 PR-1 is complete as a local checkpoint:** the
  fail-closed Pilot entrypoint, migration `014` readiness contract, protected
  startup gate, PostgreSQL-only authenticated composition, portable commands,
  validated browser API origin, strict runtime-only role-membership allowlist,
  normalized pool-error boundary, and bounded non-overlapping shutdown are
  implemented and proportionally verified. Slice 2 extends the expected schema
  to migration `015`; provider provisioning and later milestone slices remain
  unstarted.
- **Issue #8 RevenueLeakCase foundation implements the bounded domain,
  JSON/PostgreSQL repositories, tenant-bound API, migration `012`, and focused
  contract/database evidence for `STALLED_OPPORTUNITY`. The current follow-on
  slices implement explicit deterministic detector execution, case reconciliation,
  and the authorized-user Opportunity Command Center review/lifecycle UI without
  another migration.** Scheduling, autonomous recovery, additional leak types, and
  attribution remain unimplemented.
- **Issue #9 PR-1 implements the explicit bounded tenant portfolio scan and the
  deterministic truthful active-case operating-queue server contract without a
  migration. PR-2 is a local checkpoint candidate: Command Center V2 consumes
  that server-ordered queue and offers the safe composed case-to-action handoff
  without duplicating RevenueAction execution authority, while missing current
  opportunity context fails closed. PR-3 is a completed local candidate for the
  post-import first-value bridge and closed privacy-minimized pilot evidence.**
  GitHub delivery and later Quote Recovery/attribution work remain merge-gated
  and unstarted.
