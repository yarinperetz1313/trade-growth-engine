# Project State

_Last locally audited on 2026-09-14. This document is a current-state snapshot; CI outcomes require the corresponding GitHub Actions run._

Guided First Credible Leak Pilot V1 is the active approved milestone under
GitHub Issue #14. Its three slices are sequential: guided CSV intake and
server-truth resumability first; operational Data Health and detector
eligibility only after Slice 1 merges; and the coherent first-value operating
journey only after Slice 2 merges. CSV remains the supported pilot ingestion
mechanism, detector execution remains an explicit user action, and templates
must remain inert and clearly labelled. Native connectors, additional
detectors, attribution/ROI, autonomous outbound, AI ranking, generic automation,
scheduling, and broad CRM replacement are out of scope. The 15-minute, 2/3
completion, and 4/5 trust targets are measurement hypotheses, not customer
evidence or shipped claims.

Slice 1 merged through PR #36 as
`0666e974ac0e007b8c0ead3ebef3b101f4688017`; post-merge Verify run
`34830965722` succeeded. Slice 2 merged through PR #37 as exact `origin/main`
`3c1a3423c7ac03def96047783ca0f3f4b1f68f74`; post-merge Verify run
`34836937086` succeeded. Slice 3 is now active from that exact clean base on
`feat/first-credible-revenue-moment-v1`. It may compose the existing guided
import/resume, server-authoritative readiness, explicit detector scan,
RevenueLeakCase queue/lifecycle/evidence, Pilot evidence, and RevenueAction
handoff into one first-value operating journey. Explicit operator action remains
the only operation that may run the detector and reconcile RevenueLeakCases.
Existing authoritative truth is sufficient; no schema, migration, new detector,
autonomous outbound, or unsupported commercial-result persistence is authorized.
The completed Pilot Readiness plan remains historical evidence and is not active
authority.

The local Slice 3 implementation candidate now composes the supported committed-
import continuation, server-authoritative Operational Data Health, explicit
tenant-wide detector scan, deterministic RevenueLeakCase queue, immutable case
evidence and human lifecycle decisions, privacy-minimized Pilot evidence, and
the existing RevenueAction workflow into one DATA → TRUTH → MONEY → PROBLEM →
WHY → ACTION journey. Revenue leaks is the bounded portfolio destination; the
strongest server-ordered non-sample customer case is visually primary without
client re-ranking. Exact known amounts remain grouped by authoritative currency,
known zero and unknown remain distinct, and no FX, attribution, recovered-
revenue, causality, autonomous scan, outbound, schema, or persistence claim was
added. Focused TDD was RED **0/4** and GREEN **4/4**; the affected browser
contracts pass **43/43**, complete integration passes **472/472**, and complete
managed Chromium passes **65/65**, including the 390px first-value and
RevenueAction lifecycle journey. The production build and engineering harness
pass with only the existing chunk-size warning. Migrations `001`-`016` remain
byte-identical; no PostgreSQL/RLS boundary changed, so the merged Slice 2
PostgreSQL **1/1** evidence was not repeated. Independent review and GitHub
delivery remain coordinator-owned next gates.

The first Slice 3 review identified two browser freshness races, now corrected
without changing server, detector, persistence, tenancy, or RevenueAction
authority. An unresolved Snooze/Dismiss outcome owns an independent,
ref-backed mutation gate; an ordinary queue read that began earlier cannot
release it, and only tenant-authorized opportunity case-history reconciliation
can do so. Confirmed scan outcomes are separated from current active-case
truth: while the corresponding durable queue read is pending or unavailable,
the browser withholds active-case counts and all monetary summaries rather than
presenting cached pre-scan values as current. A later successful queue read
restores exact currency-grouped money and current counts. Focused RED was
**4/5** for the missing withheld-result contract and synchronized Chromium was
RED **0/2** for both races; GREEN is **5/5** and **2/2**. The affected Node
contracts pass **49/49**, affected managed Chromium passes **23/23**, and the
engineering harness and production build pass. Migrations `001`-`016` remain
unchanged. Fresh independent review remains the next gate.

The merged Slice 2 implementation exposes a tenant-bound,
read-only stalled-opportunity eligibility projection before scan. It uses the
same portfolio admission and version-1 detector evaluator as the existing
explicit scan, but it does not reconcile cases or append Pilot evidence. The
closed response reports total tenant-visible canonical opportunities,
assessable and unassessable counts, exact exclusion-reason counts, and known
positive / known zero / unknown / not-assessed commercial-value coverage
without monetary aggregation or FX. The browser strictly validates that
server projection, fails closed on contradictory counts or promoted records,
and presents business-first Operational Data Health with inspectable reason
codes, supported next actions, a dataset-completeness disclaimer, and a scan
button enabled only for server-validated ready or partial states. Empty,
not-ready, partial, ready, over-limit, unauthorized, and unavailable states
remain distinct. No schema, migration, additional detector, automatic scan,
external action, or Slice 3 behavior is included.

The first Slice 2 review remediation closes three projection and browser-
validation defects without changing detector decisions. Dataset monetary
coverage now invokes the detector's shared canonical exact-money normalizer
directly from each opportunity, so known positive and known zero remain known
when unrelated stage or freshness evidence prevents detection; malformed money
is explicitly not assessed rather than relabeled unknown. Display-only
opportunity names are projected only when already trimmed and within the
browser's 255-byte UTF-8 contract; padded, empty, malformed, or oversized
legacy names fall back to the opportunity ID without changing canonical facts
or eligibility. The browser rejects complete portfolios above the declared
100-record limit, blocked portfolios that do not exceed it, and every
non-string currency value. Focused RED passed **6/10**, with exactly the four
expected regression groups failing; GREEN passes **10/10**. The affected
detector/service/API/browser/monetary set passes **51/51**, complete integration
passes **468/468**, and focused managed Chromium passes **2/2**. The harness,
syntax, migration byte identity, diff hygiene, and artifact cleanup pass. The
existing exact-head PostgreSQL tenant/RLS evidence remains **1/1** because this
remediation changes no repository, tenancy, schema, migration, or scan-mutation
boundary.

The merged Slice 1 implementation now guides the import workspace and
source label, derives explicit commit-supported versus preview-
only capability for all five displayed collections from the browser's canonical
mapping contract, and offers header-only inert CSV templates plus field guidance
for prospects, opportunities, tasks, and activities. A bounded batch reference
is kept in the hash route; reload and in-app navigation re-read committed truth
first, then tenant-authorized staged preview and regenerated deterministic
analysis. No browser storage or client tenant authority is used. Missing,
malformed, expired, or temporarily unavailable durable state blocks progression
with an explicit recovery action. Unconfirmed mapping edits are truthfully not
claimed as persisted.

Focused TDD was RED **0/5** before the guidance/resume modules and UI existed and
GREEN **5/5** after implementation. The affected dependency-free browser,
mapping, pilot-evidence, monetary, and engineering-harness set passes **49/49**.
Managed Chromium passes **22/22** across the new desktop/390px guided and resume
coverage plus the complete existing import workflow. The new smoke coverage
exposed and closed one route-key remount race so a newly created preview or
in-app resume performs one reconciliation path rather than duplicate server
reads. That Slice 1 scope merged through PR #36 after independent approval; no
schema, migration, connector, detector, case/action, session-result,
external-send, or later-slice change was included.

The bounded Slice 1 review remediation now distinguishes retained import-batch
lifecycle truth from transport failure before validating unavailable raw rows.
A coherent tenant-authorized preview envelope with database-computed cleanup
due state produces an explicit expired or cleaned terminal result and directs
the operator to start a new import; malformed envelopes, mismatched batch IDs,
and 401/403 non-oracle responses remain fail-closed. The intake panel also uses
neutral workspace wording rather than asserting authentication without
membership evidence. Focused lifecycle/presentation contracts were RED with
**5/7** passing before the fix and are GREEN **7/7**. The affected browser,
authentication, import, mapping, repository, staging, and Pilot evidence set
passes **82/82**; managed Chromium guided intake passes **6/6**, including real
expired/cleaned response shapes, access denial, and the 390px resume path, and
the complete existing import workflow passes **18/18**. The engineering
harness, syntax, migration byte identity, and diff hygiene pass. No backend,
persistence, schema, migration, connector, detector, or later-slice behavior
changed.

The bounded Slice 1 second-review remediation now recognizes the exact
migration-015 minimized shapes after raw-evidence cleanup. A cleaned,
non-committed preview retains only bounded batch/collection/count lifecycle
facts and produces the existing terminal cleaned explanation with new-import
guidance and no ineffective retry. A cleaned committed result retains its
authoritative nonzero outcome summary and continues to the Revenue Command
Center even though deleted per-row evidence is no longer returned. Exact batch
matching, cleanup-state coherence, non-oracle denial, request generations,
committed-result precedence, and strict validation of still-available raw rows
remain unchanged. Focused RED was **6/8** with exactly the two minimized shapes
failing; GREEN is **8/8**. The affected authenticated import/mapping/repository/
staging/Pilot browser-contract set passes **79/79**. Managed Chromium passes
guided intake **7/7** and the existing import workflow **18/18**. Syntax,
engineering harness, migration `001`-`016` byte identity, diff hygiene, and
artifact cleanup pass. No backend, persistence, schema, migration, connector,
detector, or later-slice behavior changed.

The bounded Slice 1 third-review remediation aligns the guided source-system
field with the existing canonical commit namespace contract. The browser now
calls the value a source-system namespace, gives the accepted
`quarterly-crm-export` example and exact character guidance, reports invalid
human labels such as `Quarterly CRM export` inline, and blocks forward preview
or commit actions while a non-empty invalid value is present. The value is
submitted exactly as entered; the browser does not trim, slugify, or otherwise
rewrite source identity. The focused regression exercises the real
`validateCanonicalCommitInput()` boundary and was RED **8/9** before the
browser validator existed, then GREEN **9/9**. Its blank, 128/129-character,
leading-character, forbidden-character, and accepted namespace matrix agrees
with the server contract. The directly affected import/commit/mapping/
repository/staging/Pilot browser-contract set passes **100/100**. Managed
Chromium guided intake passes **7/7**, including accessible inline validation
without 390px overflow, and the existing import workflow remains **18/18**.
The engineering harness, syntax, migration byte identity, aggregate diff
hygiene, and artifact cleanup pass. No server validation, persistence, schema,
migration, connector, detector, or later-slice behavior changed.

Assisted Pilot Safety Gate V1 Slice 4 now adds one repository-native,
production-like local acceptance command and the assisted-pilot operator
runbook. The command accepts only an explicit loopback test-server URL, requires
exact PostgreSQL `server_version_num = 160015`, refuses an existing application
database/server role footprint, creates a random database and least-privilege
runtime login, applies the unchanged append-only migrations, executes the
supported secure Pilot composition, and removes the database, runtime login,
and migration roles on success or failure.

The bounded first-review remediation closes two acceptance-runner lifecycle
defects without changing product, schema, migrations, APIs, or browser behavior.
One PostgreSQL session advisory lock is acquired before the clean-server
preflight and held through cleanup. The runner atomically creates and marks the
four fixed migration roles with a per-run ownership value; cleanup verifies the
complete marker set before revoking or dropping anything, so a competing owner
cannot be deleted. `SIGINT` and `SIGTERM` share one idempotent cleanup promise,
then re-raise the original signal after cleanup or a bounded ten-second fallback.
Deterministic mocked-transport and subprocess regressions were RED **0/5** at
`694a4b4` and GREEN **5/5** after correction; the complete focused acceptance
file is **13/13**, including an additional changed-marker fail-closed guard. The
engineering harness passes, migration/static contracts
pass **19/19**, and one fresh production-like acceptance command against
PostgreSQL 16.15 passes the existing journey with cleanup `REMOVED` for the
database, runtime login, and migration roles. Independent post-command SQL
reports **0** user databases and **0** `tge_*` roles. The disposable cluster and
dependency link were removed; broader verification evidence is recorded in the
active plan.

The bounded second-review remediation closes the remaining two signal races at
the acceptance-runner boundary. One shared lifecycle state records the first
termination signal and cleanup start, prevents later provisioning and journey
phases, and makes cleanup wait for in-flight provisioning to reach a known
settled state. Role ownership is published immediately after the role
transaction COMMIT, before interruption can stop provisioning, so cleanup
cannot skip committed roles and then report a false removal. Both `SIGINT` and
`SIGTERM` handlers remain installed throughout cleanup or the explicit bounded
fallback; repeated same or mixed signals are absorbed before the original
signal is re-raised. The synchronized role-COMMIT regression was RED **0/1** and
the repeated/mixed subprocess group was RED **0/2** at `7dc77fe`; both groups
are GREEN **3/3**, and the complete focused acceptance file is **16/16**.
Migration/static contracts remain **19/19** and the engineering harness passes.
A fresh PostgreSQL 16.15 acceptance retained the closed journey proof and
reported cleanup `REMOVED`; independent SQL again found **0** user databases
and **0** `tge_*` roles. This adds no provider, external-send, production,
backup/restore, deletion, product, schema, API, or browser evidence.

Focused contracts were RED **0/6** before the runner/runbook existed and are
GREEN **7/7**, including the self-review guard that rejected pre-existing TGE
roles are never touched. One final `npm --silent run acceptance:pilot` run against fresh
Homebrew PostgreSQL 16.15 passed not-ready gating, local secure readiness, the
explicit `LOCAL_DETERMINISTIC_NOT_AUTH0_OR_SMTP` verifier, membership-derived
tenant authority, forged client-tenant rejection, negative second-tenant
isolation, one-row CSV preview / mapping / Data Health / canonical commit with
exact `AUD`, stalled scan, server-ranked queue, case-to-RevenueAction handoff,
prepare, approve, and internal task execution. Durable case/action/task/activity
identities reloaded and no external send occurred. The closed proof contains no
DSN, credentials, tokens, tenant/customer IDs, raw cells, filename, draft, or
contact data and explicitly excludes Auth0 AU/JWKS/SMTP/OTP, AU infrastructure,
backup/restore, production maintenance, privacy/vendor approval, and canonical
tenant-data deletion. Cleanup reported all temporary database resources removed;
direct SQL confirmed **0** user databases and **0** `tge_*` roles remained.
Affected auth/import/detector/queue/case/action tests pass **226/226** and the
engineering harness passes. No product/domain behavior, schema, migration,
browser feature, provider, deployment, external action, backup/restore claim,
canonical deletion policy, GitHub result, or release evidence is added.

The 2026-09-13 native Astra remediation checkpoint corrects four additional
Slice 3 P2 findings: malformed currency type coercion, browser rejection of
equivalent redundant-zero decimal spellings, global stripping of unrelated
collections' currency compatibility fields, and individual weighted displays
that inferred lossy money or ignored unknown base evidence. The new four-test
regression is RED **0/4** on `520da22` and GREEN **4/4** after correction.
Checkpoint `0b35013` preserved the focused fix before broader verification.
Affected integration passed **54/54**, and final gate components passed
integration **432/432**, PostgreSQL 16.15 **91/91**, managed Chromium **54/54**,
and production build (**31 modules**). The single monolithic full-gate attempt
stopped at an unchanged migration-role bootstrap race and two stale database
summary assertions; after narrowly correcting those assertions, only the
remaining component gates were run. It is not reported as a successful
monolithic `npm run verify`. Migrations are unchanged. Fresh independent
approval remains pending; no GitHub delivery or later slice is implied.
Detailed failure, correction, and benchmark evidence is in the active plan.

The 2026-09-13 GPT-5.6 Sol / High recovery adopted those two clean native
checkpoints without rewriting their historical authorship. Independent Sol
checks passed the four-finding regression **4/4**, the directly affected
currency/monetary/persistence set **73/73**, a fresh PostgreSQL 16.15
compatibility boundary **3/3**, and `verify:fast` with integration **432/432**.
The earlier exact-content PostgreSQL **91/91**, managed Chromium **54/54**, and
production-build evidence was not repeated. Fresh independent Astra review and
GitHub delivery remain pending.

Assisted Pilot Safety Gate V1 Slice 3 now implements the optional
[authoritative opportunity currency](architecture/AUTHORITATIVE_OPPORTUNITY_CURRENCY.md)
contract locally. Exact uppercase three-letter codes flow through backward-safe
JSON writes, append-only PostgreSQL migration `016`, reviewed CSV mapping/Data
Health, atomic canonical commit and replay, opportunity APIs, deterministic
RevenueLeakCase value classification, and browser import/opportunity surfaces.
Missing/null currency remains unknown; malformed, padded, or lowercase supplied
evidence fails closed. Amount and currency remain independent. There is no
currency default, locale/tenant inference, silent normalization, FX conversion,
probability/expected-value behavior, JSON cutover, or dual write.

The migration preserves forced RLS and existing runtime grants. A temporary
owner-only migration policy permits the all-tenant preflight/backfill and is
dropped in the same transaction; malformed legacy evidence rolls every change
back. Exact valid current/legacy JSON currency is promoted, missing/null remains
SQL `NULL`, and compatibility payloads and unknown fields are preserved. Local
evidence includes one complete local `npm run verify`: engineering harness,
integration **408/408**, real PostgreSQL 16.15 **90/90**, managed Chromium
**53/53**, and the Vite 8.2.2 production build (**31 modules**), plus
`git diff --check`.
Migration `016` SHA-256 is
`ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3`;
migrations `001`–`015` remain byte-identical to base. This does not prove
provider provisioning, production/deployment behavior, GitHub gates, external
acceptance, or coordinator-led independent review.

The bounded Slice 3 fresh-review remediation preserves exact replay across the
currency-vector upgrade only for unversioned, materially identical legacy
opportunity commits. It rechecks legacy request/input fingerprints, tenant,
collection, source, headers, mapping, and staged/canonical row evidence; new
commits are currency-versioned and unknown explicit versions fail closed.
Migration `016` now enforces exact uppercase ASCII bytes independently of
collation. Empty or otherwise invalid persisted currency produces Data Health
suppression while only absent/null stays unknown. Opportunity-specific
dashboard, Biggest Opportunity, pipeline, and Revenue Command Center displays
retain authoritative currency and exact decimal strings, and an in-place
opportunity route change clears unsaved currency input. Remediation evidence is
focused integration **134/134**, focused PostgreSQL **1/1**, focused managed
Chromium **2/2**, and one complete local `npm run verify`: harness, integration
**408/408**, PostgreSQL 16.15 **90/90**, Chromium **53/53**, and the production
build (**31 modules**).

Slice 3 Recovery Checkpoint 1 closes the remaining legacy replay identity
anchoring defect without beginning decimal ranking. Every unversioned legacy
opportunity replay now reconstructs canonical row identity from the locked
staging payload and reconciles tenant, batch, upload fingerprint,
headers, row counts, source system/record, target, disposition, raw hash,
canonical hash, stored result, and committed ID-map evidence before returning a
stored result. Tampered adjacent hashes or result identity cannot mask changed
raw/request evidence. Current `CANONICAL_IMPORT_V2_CURRENCY` fingerprints retain
their strict exact-match path and unknown explicit versions still fail closed.
Focused RED was **0/8** (the parent plus seven independently exposed tamper
vectors); GREEN is focused **9/9**, the complete repository file **22/22**, the
directly affected import/reconciliation set **56/56**, import mapping **14/14**,
and migration-static **19/19**, with the standalone engineering harness and
`git diff --check` passing. Migration `016` remains unchanged at SHA-256
`ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3`, and
migrations `001`–`015` remain byte-identical to checkpoint parent `d42346e`.

Slice 3 Recovery Checkpoint 2 closes only the exact-decimal ranking defect.
Dashboard Biggest Opportunity and equal-score priority ordering now compare
authoritative same-currency `NUMERIC(20,6)` values as exact scaled integers,
with stable opportunity-ID ties; Biggest Opportunity declines to infer a result
when more than one authoritative currency is present. Revenue intelligence uses
the same exact server-side representation within deterministic currency groups
and never compares monetary magnitude across currencies. RevenueAction factual
evidence and basis fingerprints retain the original exact amount and optional
authoritative currency, so a one-millionth amount change or currency change can
supersede stale action evidence without collapsing through JavaScript numbers.
Known positive, known zero, unknown, invalid, and missing-currency inputs retain
their existing domain-specific classification semantics, and the
RevenueLeakCase queue reuses the shared exact comparator without changing its
ordering contract.

The new focused regression was expected RED **0/4** at `67e2c10`: the dashboard
selector did not exist, exact revenue-action ranking reversed a pair separated
by one millionth beyond safe JavaScript integer precision, and RevenueAction
evidence rounded the amount and omitted currency. GREEN is focused **4/4** and
the directly affected integration set **53/53**. The final proportional gate
passed the engineering harness plus integration **420/420**, managed Chromium
**53/53**, the Vite 8.2.2 production build (**31 modules**), migration integrity,
and `git diff --check`. No persistence, schema, replay, or migration changed, so
no PostgreSQL suite or full `npm run verify` was run. Migration `016` remains
SHA-256 `ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3`;
migrations `001`–`015` remain byte-identical to base.

The bounded Slice 3 monetary-truth remediation closes the final two review
findings without expanding the slice. Revenue intelligence and opportunity
pipeline metrics now accumulate positive `NUMERIC(20,6)`-representable amounts
as exact scaled integers inside authoritative currency groups only. Their
retained scalar fields contain an exact decimal string only for one complete
currency group, return `null` for mixed currencies or withheld known amounts,
and remain `0` when no positive amount is known. Alphabetical
`totals_by_currency` and explicit withheld counts expose the complete truth.
Dashboard, Pipeline, and Revenue Command Center render those groups without a
unitless combined amount, default currency, or FX. Existing JSON records without
currency remain readable and their positive amounts are counted but withheld.
Pipeline client-side reduction exists and follows the same exact grouped/withheld
contract as the authoritative summaries, including the requirement that weighted
money is unknown when its base amount is unknown.

RevenueAction factual evidence now retains a present malformed persisted
currency verbatim with `currency_valid: false`; absent/null retains the legacy
missing-currency basis shape and exact canonical currency retains its existing
shape. Empty, lowercase, other malformed, missing/null, and canonical evidence
therefore cannot collapse to the same basis fingerprint, while exact amount text
and the existing positive/zero/unknown semantics remain unchanged. Focused RED
at exact parent `17f0a049b7edab17344c7bf1571746748a954fb6` was **0/4** and
focused GREEN is **4/4**. The directly affected integration set passes
**76/76**, the complete integration suite passes **424/424**, managed Chromium
passes **53/53**, and the Vite 8.2.2 production build completes with **31
modules**. Final fast/harness and repository-integrity evidence is recorded in
the active plan. No replay identity, persistence, schema, migration,
RevenueAction approval/external-send boundary, GitHub state, or Slice 4 behavior
changed.

The Slice 3 FINAL bounded monetary-consistency remediation makes weighted
pipeline evidence depend on a known positive base value in both authoritative
backend projections and the Pipeline browser reducer. Biggest Opportunity now
withholds its claim when any otherwise known positive amount lacks canonical
currency. Browser knownness and individual-value formatting use exact scaled
integer parsing for plain, signed, and exponent `NUMERIC(20,6)` spellings, reject
out-of-scale/out-of-precision values, and retain exact aggregate display beyond
one row's numeric envelope. The completion record and regression now accurately
state that Pipeline client-side reduction exists under the same exact grouped/
withheld contract. Focused RED was **0/4** at
`0443906812347e77d2b418c700caabcb9a039d70`; focused GREEN is **4/4**,
the affected intelligence/opportunity/action/browser-contract set is **83/83**,
replay identity is **22/22**, migration-static is **19/19**, managed Chromium is
**53/53**, the Vite 8.2.2 production build is **31 modules**, and `verify:fast`
passes the harness plus integration **428/428**. PostgreSQL was not run because
persistence and schema are unchanged. Final standalone harness,
migration-static **19/19**, unchanged-migration, diff, and artifact checks pass.

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

The final bounded lock-order remediation closes the cleanup/offboarding
inversion found at `878c913`. A state-synchronized PostgreSQL regression paused
cleanup after its batch claim and proved offboarding was queued behind it before
releasing the barrier; starting code deterministically returned cleanup
`SUCCEEDED` but offboarding `FAILED`. Migration `015` now makes tenant row
acquisition precede cleanup, scrub, and canonical-import batch locks while
retaining targetless `SKIP LOCKED` selection and processor-only authority.
Focused migration/service tests pass **15/15**, affected auth/import/persistence
tests pass **85/85**, and the complete affected PostgreSQL file passes
**12/12** with both operations successful, no failed evidence, no raw evidence
after offboarding, preserved canonical/audit/Pilot truth, and no cross-tenant
leakage. The proportional gates pass the engineering harness plus integration
**382/382** and the complete PostgreSQL suite **79/79**. Migrations `001`–`014`
remain byte-identical and `git diff --check` passes. The six prior High-review
findings remain closed. Browser E2E and the production build were not repeated
because no browser or web-production code changed.

The final bounded terminal-access remediation closes two later review findings.
Invitation creation now revalidates the exact active OWNER identity through a
no-target runtime function and holds the tenant row before inserting its child;
invitation consumption takes the same terminal-aware tenant lock before locking
the invitation or activating membership. A terminal tenant therefore cannot
retain a concurrently created invitation or regain membership from residual
invitation evidence. PostgreSQL preview and analysis batch reads also compute
`rawCleanup.due` from database time exactly like the dedicated cleanup status;
an absent value is no longer rewritten as `false`. At starting checkpoint
`9d91861`, the new repository/migration assertions were **22/25** and the two
state-synchronized PostgreSQL invitation races were **0/2**: offboarding did not
wait, one invitation survived terminal state, and consumption recreated one
active membership. The remediated focused auth/import/migration set passes
**36/36**, affected auth/import/persistence passes **89/89**, the complete
affected PostgreSQL file passes **15/15**, the engineering harness plus
integration passes **386/386**, and the complete PostgreSQL suite passes
**82/82** on PostgreSQL 16.15. The standalone harness and `git diff --check`
pass, and migrations `001`–`014` remain byte-identical to `origin/main`.
Browser E2E and production build were intentionally not repeated because no
browser or web-production source changed.

The bounded staging/maintenance concurrency remediation closes the final two
fresh High-review findings at `5ac47b4`. A state-synchronized canonical commit
regression proved a runtime staging insert could validate `PREVIEWED`, wait
behind canonical finalization, and then persist a `PENDING` row after the batch
became `COMMITTED`. The staging guard now takes the established tenant lock and
then locks and revalidates the batch row, retaining tenant-before-child ordering
and the existing trigger-only least-privilege boundary. A second regression
runs two actual production maintenance commands across two tenants, using
advisory barriers and `pg_blocking_pids` to reproduce the cleanup-lock retention
cycle without timing sleeps. The command now commits cleanup before beginning
offboarding, so each processor retains its existing targetless database
authority while no cleanup tenant locks cross into offboarding. Product RED was
**0/1** for each finding. Focused GREEN is **1/1** each; migration/service is
**17/17**; affected auth/import/persistence is **147/147**; the complete affected
PostgreSQL 16.15 file is **17/17**; the engineering harness plus integration is
**387/387**; and the complete PostgreSQL suite is **84/84**. The standalone
harness and harness/migration-static pair **22/22** pass, `git diff --check` is
clean, and migrations `001`–`014` retain their exact starting SHA-256 values.
All previously closed Slice 2 invariants remain covered. Browser E2E and
production build were not run because no browser or web-production source
changed.

The final bounded database invitation-guard remediation closes the remaining
fresh P1 at `97b6f4c`. The least-privilege runtime login could call the terminal
barrier and receive `false`, then bypass the repository and directly insert a
`PENDING` invitation for that terminal tenant. A migration-015-only trigger now
validates the inserted tenant and creator against trusted request context and
requires the existing active-OWNER, terminal-aware shared tenant lock before
the child insert. Starting direct-runtime and state-synchronized overlap
regressions were each **0/1**: direct SQL left one terminal invitation, and
offboarding did not wait for an overlapping direct insert. Both are now
**1/1**. Focused auth/invitation/migration tests pass **61/61**, the affected
PostgreSQL 16.15 file passes **18/18**, the engineering harness plus integration
passes **388/388**, and the complete PostgreSQL suite passes **85/85**.
Migrations `001`–`014` remain byte-identical and the runtime role retains only
its existing narrow table privileges; the trigger function is not directly
executable by runtime, migrator, or maintenance roles. Browser E2E and the
production build were not run because no browser or web-production source
changed.

The bounded final security/migration remediation closes the two fresh findings
at `1da7a3d` and supersedes the preceding Slice 2 “final review” wording. The
runtime-executable migration-011 import helpers were reassessed directly under
the least-privilege login. Migration `015` now replaces the only reintroduction
path, `record_import_commit_lifecycle_conflict`, with a tenant-before-batch
terminal lock, exact tenant/issuer/subject and active OWNER/ADMIN membership
checks, unexpired/non-cleaned lifecycle predicates, and closed conflict-summary
keys. Cleaned/EXPIRED batches and terminal-offboarded tenants cannot restore
`conflict_summary`, commit metadata, staged metadata, or an arbitrary sensitive
marker through any of the six still-executable SECURITY DEFINER import helpers.
The established `urn:tge:legacy` trusted context remains exact for local
repository compatibility; Pilot traffic retains its explicit issuer authority.

Migration `015` also replaces the schema-014 calendar-day ceiling with an
elapsed-time maximum of 168 hours. Existing shorter deadlines are unchanged;
only a legacy deadline longer than 168 elapsed hours is shortened to that cap,
and the runtime insert trigger still authors exactly 168 hours from database
time. A real 001–014 upgrade fixture with a 24-hour deadline applies `015`
without lengthening it and retains its canonical CRM, audit, Pilot evidence,
and migration-ledger truth. The identical PostgreSQL RED regressions were
**0/2** at the starting migration and GREEN **2/2** after correction. Static
migration checks pass **14/14**, focused import/auth/persistence checks pass
**115/115**, and the complete affected PostgreSQL 16.15 file passes **20/20**.
The first complete database run exposed the legacy fixture's absent explicit
issuer context at **86/87**. Resolving that path to its canonical legacy issuer
passed the isolated contract **1/1**; the now-terminal `EXPIRED` expectation was
also removed, and the corrected complete database suite passes **87/87**.
`npm run verify:fast` passes the engineering harness plus integration
**389/389**, and the standalone final harness passes. Migrations `001`–`014` remain
byte-identical and migration `015` is
`1f33b8656dbd2c3a05adc9a540412efcac41a8540673bee0e52e510b0e40fcd5`.
Browser E2E and production build were not run because no browser or product
source changed.

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
- Active plan: [**Guided First Credible Leak Pilot V1**](execution-plans/active/guided-first-credible-leak-pilot-v1.md).
  Slices 1 and 2 are merged; Slice 3 has reached a clean local implementation
  candidate, completed one bounded review remediation, and awaits fresh
  independent review. The completed
  [**Pilot Readiness**](execution-plans/completed/pilot-readiness.md) record is
  historical evidence, not an active backlog.
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
