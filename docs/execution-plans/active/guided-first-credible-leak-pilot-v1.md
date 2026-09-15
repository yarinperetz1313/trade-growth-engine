# Guided First Credible Leak Pilot V1

## Outcome

- Problem: TGE's secure import, deterministic leak detection, case review, and
  human-controlled action capabilities are individually credible, but a pilot
  operator still needs product knowledge to supply the right CSV and reconnect
  the end-to-end path after interruption.
- Intended observable result: a small or medium B2B operator with an ordinary
  CRM/spreadsheet export can follow a truthful CSV-first setup and reach either
  one evidence-backed stalled-opportunity case or an exact actionable
  insufficient-evidence result in a guided session.
- Pilot hypotheses to measure, not validated claims: Time to First Credible Leak
  at most 15 minutes, at least 2/3 operator completion, and at least 4/5
  first-case trust.
- Explicit non-goals: Quote Recovery, additional detectors, native CRM
  connectors, connector frameworks, attribution/ROI claims, autonomous
  outbound, AI ranking, generic workflow automation, scheduling/dispatch, broad
  CRM replacement, and any silent state-mutating detector run.

## Authority and starting state

- GitHub Issue #14 was approved by the repository owner on 2026-09-14 as this
  exact three-slice milestone. Slice 2 depends on merged Slice 1; Slice 3 depends on merged Slice 2.
  Both prerequisite merges are now complete, satisfying Slice 3's dependency
  gate.
- Slice 1 merged through PR #36 as `0666e974ac0e007b8c0ead3ebef3b101f4688017`.
  Post-merge Verify run `34830965722` succeeded. Slice 2 merged through PR #37
  as `3c1a3423c7ac03def96047783ca0f3f4b1f68f74`; post-merge Verify run
  `34836937086` succeeded. Slice 3 starts from that exact clean `origin/main` on
  isolated branch `feat/first-credible-revenue-moment-v1` and worktree
  `first-credible-revenue-moment-v1`; preflight was clean, including ignored
  files, and the branch was 0 behind / 0 ahead.
- The completed Pilot Readiness record moved to
  `../completed/pilot-readiness.md`; its evidence is preserved and is not active
  authorization for additional infrastructure, retention, or provider work.
- Migrations `001`-`016` are the immutable Slice 3 baseline. Their SHA-256
  values are recorded below; no schema or migration is authorized unless
  existing durable server truth is first shown insufficient and an independent
  architecture review establishes the need.

## Boundaries and decisions

| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Pilot customer | Small/medium B2B businesses with an existing sales pipeline and ordinary CRM/spreadsheet exports. | Issue #14 owner approval |
| Ingestion | CSV is the only supported pilot ingestion mechanism; templates are inert downloads and never auto-upload or import. | Issue #14 owner approval |
| Tenant/business context | Use authenticated membership/tenant context and persisted import/source facts. The browser never invents a business name or supplies tenant authority. | Secure Pilot and import contracts |
| Resume authority | Derive the current step from existing server-returned batch/import/Pilot evidence truth. Browser-only progress cannot authorize or imply a completed step. | Import and Pilot evidence APIs |
| Detection | Stalled-opportunity execution remains an explicit user action. Slice 3 composes but does not invoke, change, or schedule it automatically. | Issue #14 owner approval |
| Product truth | Preserve known/zero/unknown and authoritative currency distinctions, immutable import/case evidence, sample exclusion, and explicit insufficient-evidence states. | Repository architecture and Issue #14 |
| Recovery | Existing request generations and ambiguous-outcome reconciliation remain authoritative. Stale, malformed, or unknown durable state fails visibly with a useful retry/restart action. | Browser import contracts |
| Compatibility | Preserve existing upload, preview, mapping, Data Health, confirmation, and commit APIs. No connector abstraction or new persistence. | Slice 1 scope |

## Dependency sequence

- [x] **Slice 1 — Guided intake and resumable setup.** Guided business/source
  context; downloadable CSV templates and field guidance; explicit
  commit-supported versus preview-only collection capabilities; and server-
  truth-derived resumability. No detector, case/action, operational eligibility,
  session-result, persistence, schema, or migration changes.
- [x] **Slice 2 — Operational Data Health and eligibility.** After Slice 1 is
  merged, add post-commit operational Data Health, inspectable stalled-
  opportunity eligibility, exact missing/stale/invalid/suppressed reasons,
  actionable remediation, and truthful dataset coverage. No additional
  detectors.
- [x] **Slice 3 — First-value operating journey (local implementation candidate;
  independent review pending).** With Slice 2 merged, make
  explicit scan the clear post-commit continuation, provide a credible case or
  actionable no-case explanation, cohere inspection/feedback/RevenueAction
  handoff, make the case queue the effective operating home, complete 390px
  journey usability, and expose a privacy-minimized pilot-session result.

## Slice 3 bounded implementation plan

1. Characterize the committed-import continuation, strict readiness and scan
   envelopes, deterministic operating queue, case evidence/lifecycle, Pilot
   status, and RevenueAction command-center contracts. Reuse them without new
   persistence, tenant authority, detector decisions, or monetary inference.
2. Add focused RED browser-contract and composition tests for the absent
   DATA → TRUTH → MONEY → PROBLEM → WHY → ACTION journey, including credible,
   no-case, partial, unknown-money, multiple-currency, stale/reconciled, and
   action-existing/cannot-proceed states.
3. Implement the smallest business-first browser composition: post-commit
   readiness continuation; explicit scan; truthful result summary and
   deterministic hero; inspectable evidence/limitations; Take Action, Snooze,
   and Dismiss continuity; and bounded queue navigation clarity.
4. Derive any displayed pilot-session result only from the existing strict,
   privacy-minimized Pilot status. Treat missing or unavailable evidence as
   unknown, never as adoption or customer proof.
5. Verify focused contracts, the affected integration set, managed desktop and
   390px journeys, then harness/build/migration/diff/artifact hygiene near the
   clean implementation checkpoint. Stop before independent review or GitHub
   delivery.

## Acceptance evidence required for Slice 3

- A committed supported import continues directly to Operational Data Health;
  no scan occurs until the operator explicitly invokes it.
- Scan results reconcile credible, no-case, partial, stale/suppressed,
  unavailable, and reconciled states without promoting unassessable records.
- Exact known monetary significance is grouped by authoritative currency;
  unknown and known-zero remain distinct and currencies are never converted or
  summed together.
- The strongest server-ranked active case is visually primary, while immutable
  evidence, provenance, reason codes, timestamps, source lineage, lifecycle,
  and limitations remain inspectable.
- Take Action enters the existing RevenueAction materialization and command-
  center lifecycle; Snooze and Dismiss use existing audited case transitions.
  Ambiguous writes reconcile through existing read authorities, and no outbound
  or bulk autonomous execution occurs.
- A first-time authorized operator can complete the supported journey at desktop
  and 390px, including action preparation, required approval, and safe internal
  or manual execution, or receives an exact useful next step when progression is
  unsupported.

## Slice 2 bounded implementation plan

1. Reuse detector version 1 as the single eligibility authority. Add a
   tenant-scoped, read-only projection that evaluates the same canonical
   opportunity/activity/task evidence without reconciling cases, and returns a
   closed, versioned dataset and record contract.
2. Add RED domain/API/browser contracts for all-eligible, partial, no-eligible,
   empty, over-limit, malformed-source, unavailable, and cross-tenant states.
   Require reason totals to reconcile exactly and preserve known-positive,
   known-zero, and unknown monetary counts without aggregation or FX.
3. Present operational Data Health before the explicit scan using business
   language, inspectable reason codes and evidence, and supported next actions.
   The browser consumes the strict server projection and never recomputes
   eligibility. The scan remains an explicit mutation.
4. Connect Slice 1's committed-import continuation to this readiness surface,
   then verify focused domain/API contracts, affected integration, tenant/RLS
   behavior where touched, and managed desktop/390px journeys.
5. Checkpoint the coherent implementation and stop for independent review. Run
   build/harness and broader delivery gates only near readiness. Do not add a
   schema/migration, another detector, or Slice 3 behavior.

## Acceptance evidence required for Slice 2

- Total tenant-visible opportunities, assessable and non-assessable counts, and
  closed reason counts reconcile to the exact server-returned record set.
- The projection and later explicit scan use the same versioned evaluator and
  cannot disagree for the same canonical evidence and evaluation timestamp.
- Missing, invalid, stale, suppressed, empty, over-limit, and unavailable states
  remain explicit and provide only supported next steps.
- Commercial-value coverage keeps known positive, known zero, and unknown
  distinct and performs no monetary aggregation or currency inference.
- Tenant authority is server-derived; browser input cannot select a tenant or
  promote an unvalidated response to eligibility.
- Desktop and 390px journeys make the explicit scan the obvious next step only
  when the validated readiness state supports it.

## Slice 1 bounded implementation plan

1. Characterize every collection currently presented by the Import UI against
   preview and canonical-commit repository support. Add RED browser-contract
   tests for truthful capability labels, inert downloadable templates, and
   practical field guidance for commit-supported collections.
2. Characterize existing authenticated tenant/session, import batch, preview,
   analysis, commit, and Pilot evidence responses. Add RED tests for a guided
   supported path and reload/navigation recovery derived only from server facts,
   including stale/unknown/error states.
3. Implement the smallest coherent browser/API-client composition. Reuse the
   current import APIs and persisted facts; do not add a server write merely to
   track UI steps. Keep templates clearly marked as templates/sample structure,
   with no automatic upload/import and no eligibility as first-value evidence.
4. Verify the smallest focused tests, then the affected import/browser-contract
   set. Use the managed browser wrapper only for focused desktop/390px visible
   smoke evidence. Run the engineering harness and diff/artifact/migration
   hygiene near the final implementation checkpoint.
5. Stop at a clean local implementation checkpoint for independent review. Do
   not push, open a PR, start GitHub CI, run the expensive full PostgreSQL/build/
   repository Verify delivery gates, or begin Slice 2/3.

## Acceptance evidence required for Slice 1

- Every displayed collection is labeled from repository truth as canonical
  commit-supported or preview-only.
- The operator can download a clearly labeled CSV template/field guide for each
  commit-supported collection without automatic upload/import.
- A supported guided path enters the existing upload/preview/mapping/Data
  Health/confirmation flow without changing those authority contracts.
- Reload/navigation resumes to the truthful server-derived step. Unknown,
  malformed, expired, or stale server state is never promoted to progress and
  exposes a useful next action.
- No sample/real mixing, unknown-to-zero/currency inference, client tenant
  authority, detector execution, external send, connector, or Slice 2/3 behavior
  is introduced.
- Focused desktop and 390px smoke coverage passes.

## Verification

| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Preflight | branch/HEAD/origin/merge-base/status/worktrees; instructions; Issue #14; current plans/code/tests | Exact `3c1a342`; clean; Slice 1/2 merged; authoritative scope available |
| RED | `node --test test/first-credible-revenue-moment.test.js` before product edits | **0/4**: absent journey composition and result authority |
| GREEN | Same focused file, then affected import/readiness/queue/Pilot browser contracts | **4/4**, then **43/43** |
| Integration | `npm run test:integration` | **472/472** without backend or persistence changes |
| Visible journey | `npm run test:e2e` through the managed wrapper | **65/65**, including desktop and 390px first-value paths without developer data |
| Proportional gate | `npm run build`; `npm run test:harness`; migration byte comparison; `git diff --check`; artifact scan | Build/harness/hygiene pass; migrations `001`-`016` unchanged |

## Migration baseline

```text
001 d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62
002 a95f94263c5a1dd1a246a3be905e7f27bd5f4222ba871c137cf90fa2faf17c1c
003 311a02a67deb09ad44b2782f90c2ff3c67d6a537ca9b9ed1f116cafd37a149a8
004 ad9633daf1dd791c8889c79745d8741bace24e0827b76d3fec59d6d73371aa2d
005 2e9bc0029cbfdc03828de7784aa19014de3f7e988cc8f5668bcacd729e206a66
006 f110d2f7937c6133ed1785df05be8c3ca725add7d207a6d94b8a27610b3bca6f
007 514d12b74519405b28e76960244483880f01092b30bcac650a97f247469f4dc6
008 7e4f8b74df1ecc496fa6c7ac8b55169d3e7db7efccdcf3f1f7d0ad37aa95cd72
009 f248d2d5a7363331cd4f4732551a62f9ac28f3315ad5e9777ded1547657d3736
010 fcb19ddba6c2d5bc654af0c3a3172505675dd5c4160876d717b51943b2863e03
011 df50ee0697bb7849b3575f9f5aef40673855ec77a4ebcfcd0cf0d8d5e59ca04b
012 0ec9ffaf16987d84b319b6dc579edea86bbedcd3cff65f8b9d881f9c4dbba6d8
013 b27c7d6c69990f459b1e51c0d902d55f6a1f44fbf17accb69459b2c26465f6a8
014 699cb9c1e7fc4319f71cf7e98e99934706f9f75a8f0f00ae9c22ff90c5c9ea10
015 1f33b8656dbd2c3a05adc9a540412efcac41a8540673bee0e52e510b0e40fcd5
016 ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3
```

## Evidence log

- 2026-09-14 planning preflight: exact worktree and branch; `HEAD`,
  `origin/main`, and merge-base all `ea22ce9cb06498f6f6c59ee5642d6ede2e7cea35`;
  0 behind / 0 ahead; tracked, untracked, and ignored status clean.
- Repository, scoped web/test instructions, Project State, execution-plan index,
  completed Pilot Readiness evidence, completed first-value evidence, and live
  Issue #14 approval were inspected before the plan was changed.
- Clean planning checkpoint: `d15f453dc1fb82d7aa16271709838353878a8fae`
  (`docs: activate guided first leak milestone plan`). The engineering harness
  passed before product implementation began.
- Research confirmed that all five displayed collections can be staged and
  previewed; the canonical browser mapping/commit contract supports prospects,
  opportunities, tasks, and activities, while `revenue_actions` is explicitly
  `UNSUPPORTED_TARGET`. Existing tenant-authorized GET-by-batch preview/commit,
  deterministic analysis, and Pilot latest-committed evidence are sufficient
  when paired with a bounded route batch pointer. No new persistence or list
  authority is needed.
- TDD RED: `node --test test/guided-import-intake.test.js` failed expected
  **0/5** because the capability/template and resume modules were absent and the
  browser lacked the guided/resume composition.
- Focused GREEN: the identical command passes **5/5**. The inert header-only
  templates are derived from the exact canonical browser target definitions;
  unsupported collections cannot produce a template; opportunity guidance
  preserves exact optional currency and missing-value truth; malformed or
  authority-bearing route queries fail closed.
- Affected integration/browser contracts pass **49/49** across guided intake,
  import response/mapping, Pilot status, monetary-plan compatibility, and the
  engineering harness. The existing Node module-type warning is unchanged and
  non-fatal.
- Managed Chromium passes **22/22** for the new focused guided/resume spec plus
  the complete existing import workflow. The new scenarios cover desktop
  guidance, every capability class, inert template contents, the supported
  upload-to-mapping path, staged and committed reload/navigation recovery,
  malformed/unknown/expired state, interrupted-preview batch-pointer recovery,
  one reconciliation path, 390px no-overflow, and no automatic preview mutation
  during resume.
- The first expanded resume smoke run exposed a duplicate GET caused by changing
  the component key both before and during hash navigation. The route lifecycle
  now separates remembered import links from external hash-change versions; the
  focused rerun passed **3/3**. A fourth interrupted-preview recovery scenario
  was then added; final affected Chromium passes **22/22**.
- Production changes are limited to browser guidance, route/resume composition,
  styles, and one read-only projection of the existing browser target contract.
  No backend/domain/persistence/schema/migration, connector, detector,
  case/action journey, session-result, external-send, or later-slice behavior
  changed.
- Fresh independent review found that real expired or cleaned PostgreSQL
  preview reads retain tenant-authorized batch lifecycle metadata in an HTTP
  200 response while raw staging rows are unavailable. The browser previously
  rejected that entire response as `IMPORT_RESPONSE_INVALID`, called the state
  temporary, and offered an ineffective retry. It also unconditionally called
  the import surface an authenticated workspace without membership evidence.
- Bounded remediation added the two regression groups before product edits.
  RED was **5/7** in the focused file: the lifecycle result remained generic and
  the unsupported authentication assertion remained present. GREEN is **7/7**.
  Lifecycle classification now requires an exact batch match, bounded coherent
  preview metadata, a valid server timestamp, database-computed `due: true`, a
  coherent cleanup state, and no visible raw rows. `SUCCEEDED` is reported as
  cleaned; other due lifecycle states are reported as expired. Both are
  terminal restart-new-import paths with no retry button. Other malformed
  response shapes remain `IMPORT_RESPONSE_INVALID`; 401/403 and cross-tenant
  absence retain the existing non-oracle behavior.
- The affected authenticated browser/import/mapping/repository/staging/Pilot
  suite passes **82/82**. A first dependency-free run passed **67** assertions
  and could not start six dependency-backed cases; the complete rerun used a
  lockfile-identical cache and passed. Managed Chromium initially passed
  **5/6**, with the sole failure being the prior positive-path assertion for the
  deliberately removed authentication wording; after updating that assertion,
  the focused guided/resume file passes **6/6**. It covers desktop guidance,
  390px resume/navigation, interrupted preview, unknown/malformed links,
  retained expired/cleaned lifecycle envelopes, and denied import access.
  The complete existing managed Chromium import workflow also passes **18/18**.
- Engineering harness, Node syntax, migration `001`-`016` byte identity,
  aggregate diff hygiene, and artifact cleanup pass. No PostgreSQL suite, full
  Verify, or build was run because the authoritative server lifecycle contract,
  persistence, schema, and migrations are unchanged.
- A second fresh review found that migration `015` intentionally minimizes a
  cleaned preview summary to retained collection/count lifecycle facts and a
  cleaned committed result to its authoritative summary with no per-row raw
  evidence. Both successful tenant-authorized responses were still rejected by
  the browser's raw-evidence validators and surfaced as retryable temporary
  failures.
- Exact migration-015 response fixtures were added before product edits.
  Focused RED was **6/8**, with exactly the minimized preview and committed
  result regressions failing. The contract boundary now recognizes only the
  coherent `rawEvidenceAvailable: false` cleanup shapes before the original
  strict raw-row validation. Cleaned non-committed state remains a terminal
  start-new-import path with no retry; cleaned committed truth retains its
  nonzero summary and Revenue Command Center continuation. Focused GREEN is
  **8/8**. Contradictory availability, lifecycle, count, extra-header, and
  cross-batch shapes remain `IMPORT_RESPONSE_INVALID`.
- The affected authenticated import/mapping/repository/staging/Pilot browser-
  contract set passes **79/79**. Managed Chromium guided intake passes **7/7**,
  including committed-result precedence without a preview read, and the
  complete existing import workflow passes **18/18**. Node syntax, the
  engineering harness, migration `001`-`016` byte identity, aggregate diff
  hygiene, and artifact cleanup pass. No PostgreSQL suite, production build,
  full Verify, backend, persistence, schema, migration, connector, detector, or
  later-slice work was run or changed.
- A third fresh review found one P2 contract mismatch: the guided source-system
  field accepted a human-readable label with spaces through setup even though
  the unchanged canonical commit contract accepts only the stable namespace
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. The existing guided browser scenario
  itself supplied `Quarterly CRM export`, which the real
  `validateCanonicalCommitInput()` correctly rejected.
- The source-namespace regression was added before product edits and exercises
  the real canonical validator. Focused RED was **8/9**, with only the missing
  browser namespace contract failing. GREEN is **9/9**. The browser now labels
  the field as a namespace, shows `quarterly-crm-export` as an accepted example,
  provides precise inline guidance, blocks preview when a supplied value is
  invalid, blocks commit until the value is valid, and submits the exact value
  without trimming or normalization. The boundary matrix covers blank,
  128/129-character, invalid leading/forbidden characters, and accepted
  punctuation against both browser and real server validators.
- The directly affected guided/import/commit/mapping/repository/staging/Pilot
  Node set passes **100/100**. Managed Chromium guided intake passes **7/7**,
  including invalid-label handling and no overflow at 390px; the complete
  existing import workflow passes **18/18**. The engineering harness, module
  syntax, migration `001`-`016` byte identity, aggregate diff hygiene, and
  artifact cleanup pass. No backend, server validator, persistence, schema,
  migration, connector, detector, Slice 2, or Slice 3 behavior changed.
- Slice 2 TDD RED was **0/6** before the read-only eligibility service,
  endpoint, strict browser contract, and Operational Data Health composition
  existed. Focused GREEN is **6/6**. The projection shares the existing
  bounded portfolio admission and exact detector evaluator with explicit scan,
  closes every detector outcome into one eligibility classification and one
  supported next-step code, reconciles counts to records, and never writes a
  case or Pilot evidence event.
- A final adversarial ordering check exposed that locale-aware server sorting
  was not the same contract as the browser's exact string ordering for mixed
  punctuation/case opportunity IDs. The shared portfolio loader now uses an
  exact code-unit comparator for both readiness and scan. The added regression
  passes **1/1** and the focused readiness file passes **7/7**.
- The affected detector, case, queue, API, browser, mapping, and import Node
  contracts pass **103/103**. The API accepts no caller query/tenant authority
  and exposes no mutation route. Browser validation rejects promoted records,
  contradictory outcome/reason/next-step pairs, unreconciled totals, malformed
  exact money, future evaluation time, and unknown global blockers.
- A focused PostgreSQL 16.15 contract passes **1/1** inside the existing
  portfolio scan boundary. It proves tenant A readiness cannot reveal tenant B,
  the GET path creates no RevenueLeakCase, the subsequent explicit scan retains
  concurrency-safe reconciliation, and a 101-record portfolio is blocked with
  every value recorded as not assessed rather than inferred unknown.
- Managed Chromium passes **18/18** across the new Operational Data Health
  journey, Slice 1 guided intake, first-value continuation, and the existing
  Revenue Command Center. The new desktop/390px coverage proves partial,
  empty, no-eligible, all-eligible, and unavailable states; reconciled reason
  distribution and record details; known-zero/unknown distinctions; no page
  overflow; and zero scan POSTs until the operator activates the explicit scan.
- Complete integration passes **465/465**, the engineering harness and module
  syntax pass, and the Vite 8.2.2 production build succeeds with **33 modules**
  and only the existing chunk-size warning. Slice 2 changes no schema or
  migration; migrations `001`-`016` remain the exact baseline above. Generated
  dependency/build/browser/database artifacts were removed before checkpoint.
- Fresh independent review returned three P2 findings: detector early-exit
  fallbacks were being misreported as unknown canonical money, display-only
  opportunity names had divergent server/browser whitespace and UTF-8 bounds,
  and browser validation admitted complete over-limit portfolios plus array-
  coerced currencies. Deterministic regressions were added before product
  changes. RED passed **6/10**, with the existing money expectation plus the
  three new contract groups failing.
- The readiness projection now reuses the detector's canonical commercial-
  value normalizer independently of detector outcome. Known positive, known
  zero, unknown, and malformed/not-assessed evidence remain distinct without
  changing any detector decision. Presentation names are nullable unless they
  are already trimmed and at most 255 UTF-8 bytes, so padded or oversized
  legacy text cannot invalidate the whole response or rewrite canonical facts.
  The browser now enforces `complete => total <= limit`,
  `blocked => total > limit`, and string-typed canonical currency. GREEN passes
  **10/10**.
- The affected detector, service, API, browser-contract, queue, and monetary
  set passes **51/51**. Complete integration passes **468/468** after using a
  real temporary lockfile-identical dependency link for ESM and child-process
  resolution; the preceding `NODE_PATH` run passed the harness and 461 product
  assertions but had seven dependency-resolution setup failures. Focused
  managed Chromium passes **2/2**, including the visible not-assessed count at
  390px and no automatic scan. The harness, syntax, migration byte identity,
  diff hygiene, and artifact cleanup pass. PostgreSQL was not repeated because
  the existing exact-head tenant/RLS contract is **1/1** and this remediation
  changes no repository, tenant, schema, migration, or mutation boundary.
- Slice 3 planning preflight confirmed `HEAD`, `origin/main`, and merge-base at
  exact `3c1a3423c7ac03def96047783ca0f3f4b1f68f74`, with the isolated branch and
  worktree clean and 0 ahead / 0 behind. Live Issue #14, merged PR #37, its
  successful post-merge Verify run `34836937086`, repository/scoped
  instructions, architecture, existing worktrees, and active task ownership
  were inspected. Clean planning checkpoint `118c315` activated this contract.
- Slice 3 TDD RED was **0/4** before the result-composition helper and journey
  controls existed; the identical focused command is GREEN **4/4**. The
  affected guided import, readiness, queue, case, Pilot evidence, and browser
  contracts pass **43/43**. Complete integration passes **472/472**.
- The browser now makes committed import continue to server-assessed
  Operational Data Health with no automatic scan; presents the explicit scan
  as the operator-owned next step; separates credible/no-leak/evidence-
  limitation/reconciled outcomes; and shows exact active-case money grouped by
  authoritative currency while preserving known zero, unknown, and not-
  applicable states. The first server-ordered non-sample customer case is the
  visual hero; technical provenance, immutable evidence, reason codes,
  timestamps, source lineage, and limitations remain inspectable.
- TAKE ACTION composes the existing idempotent case-to-RevenueAction handoff
  and continues only in Opportunity Command Center. SNOOZE and DISMISS use the
  existing audited RevenueLeakCase transitions; unconfirmed responses reconcile
  exact durable opportunity case history before another mutation is allowed.
  Missing live opportunity context blocks action creation/navigation but does
  not hide the immutable historical case identity or supported case decisions.
  No bulk/autonomous mutation or outbound execution was added.
- Complete managed Chromium passes **65/65**. It covers resumed committed
  import, readiness, explicit scan, credible and no-credible results, partial
  eligibility, unknown money, multiple currencies, stale/suppressed reasons,
  superseded scan reconciliation, existing/cannot-proceed action states,
  ambiguous case lifecycle recovery, TAKE ACTION through prepare/required
  approval/safe internal execution, and no horizontal overflow at 390px.
  Production build succeeds with **34 modules** and only the existing >500 kB
  chunk warning; the engineering harness passes. Migrations `001`-`016` match
  the recorded SHA-256 baseline. No database, repository, tenant, RLS, schema,
  migration, detector, or server authority changed, so the merged Slice 2
  PostgreSQL **1/1** evidence was not repeated.
- The first independent Slice 3 review returned two P2 browser-state findings.
  A delayed ordinary queue refresh could clear the shared reconciliation block
  after an ambiguous Snooze/Dismiss response and failed durable case-history
  read. Separately, a successful scan followed by a pending or failed queue
  refresh could label cached pre-scan active-case counts and money as current.
- Both synchronized regressions were added before product changes. The focused
  scan-result contract was RED **4/5**, failing only because current queue truth
  could not be withheld. Managed Chromium was RED **0/2**: the delayed refresh
  re-enabled TAKE ACTION, and the pending refresh displayed cached zero current
  cases and an empty monetary summary.
- The lifecycle repair makes unresolved case-history reconciliation a separate
  ref-backed mutation gate. Generic queue reads no longer release the shared
  reconciliation block; an already-running refresh checks the authoritative
  pending-case ref before clearing anything. TAKE ACTION, SNOOZE, DISMISS,
  explicit scan, and queue refresh remain disabled until a successful exact
  opportunity case-history reconciliation resolves the attempt.
- Scan outcomes and queue freshness are now distinct. Confirmed detector counts
  and reconciliation dispositions remain visible while the post-scan queue read
  is pending or unavailable, but current active-case counts and every monetary
  summary are `null`/withheld. A successful corresponding or explicit recovery
  queue read marks them current and restores exact currency-grouped values.
  GREEN is **5/5** focused and **2/2** synchronized Chromium. The affected
  detector/readiness/queue/Pilot/monetary browser contracts pass **49/49** and
  affected managed Chromium passes **23/23** across the complete first-value,
  Operational Data Health, product-truth, and Revenue Command Center journeys.
  The engineering harness and production build pass. Migrations `001`-`016`
  remain unchanged; no PostgreSQL gate was repeated because no server,
  persistence, tenant/RLS, schema, migration, or mutation authority changed.
- The fresh post-remediation review confirmed the original lifecycle lock and
  initial post-scan refresh findings closed, then found two remaining browser
  composition defects. Later successful lifecycle writes or ambiguous scans
  could fail their durable queue read while retaining `CURRENT` on the prior
  active-case counts and exact money. Queue-to-opportunity and back hash
  navigation could also retain the prior page title because the parent `page`
  state remained `opportunities` throughout.
- The additionally authorized remediation added three deterministic managed-
  browser regressions before production edits. In the combined RED run, the
  route-title and successful-lifecycle scenarios failed their intended
  assertions. The ambiguous-scan scenario first exposed an ambiguous test
  selector; after narrowing it to the exact mutation alert, it failed the
  intended stale-money assertion. All three product regressions are GREEN
  **3/3**.
- Queue freshness now has an independent generation. Scan, handoff, and case
  lifecycle mutations invalidate current presentation before mutation; only a
  matching-generation durable queue read restores `CURRENT`. A reconciliation
  failure advances that generation, so a read begun earlier cannot republish
  stale counts or money. `queueState !== READY` is an additional fail-closed
  rendering boundary. Confirmed scan outcomes remain visible while current
  active-case counts and every monetary summary are withheld, and explicit
  recovery restores exact currency-grouped truth.
- The application tracks the exact hash route as reactive state in addition to
  the bounded top-level page. The title therefore follows queue → Opportunity
  Action → queue/back navigation, including at 390px, without changing the
  existing route or Opportunity Command Center authority.
- The affected Node contracts pass **54/54**. Managed Chromium passes **35/35**
  across the first-value, Operational Data Health, Opportunity Command Center,
  product-truth, and Revenue Command Center journeys. The production build
  passes with **34 modules** and only the existing chunk-size warning; the
  engineering harness, syntax, migration byte identity, aggregate diff hygiene,
  and artifact cleanup pass. No backend, persistence, tenant/RLS, detector,
  schema, migration, or RevenueAction authority changed, so PostgreSQL was not
  repeated. Fresh independent review of the new pinned checkpoint is the next
  gate.
- That review confirmed the preceding findings closed and reproduced one
  remaining P2: an ordinary refresh launched while Dismiss was unresolved could
  return pre-dismiss queue data and temporarily certify the old active case and
  `AUD 42,000.5` as current before the owned post-write refresh completed.
- The new deterministic browser regression was RED **0/1** with exactly that
  false-current presentation. Queue reads now carry an explicit mutation epoch
  and only the owning post-mutation/reconciliation read may publish within an
  active mutation. Mutation start also invalidates every older request, so a
  technically completing stale response cannot regain queue-state ownership.
  The shared boundary applies to explicit scan, Snooze/Dismiss, case-history
  reconciliation, and RevenueAction linkage without changing server authority.
- The regression is GREEN **1/1** and the complete Revenue Command Center spec
  passes **15/15**. Complete Node integration passes **473/473**, the remaining
  affected first-value Chromium set passes **21/21**, and the production build
  passes with **34 modules** and only the existing chunk-size warning. No
  PostgreSQL/RLS gate was repeated because the repair changes no backend,
  repository, tenant, persistence, schema, migration, detector, or
  RevenueAction authority. Harness, migration byte identity, diff hygiene, and
  artifact cleanup pass; fresh independent review is the remaining checkpoint
  gate.
- That review confirmed the shared mutation epoch across scan, Snooze/Dismiss,
  reconciliation, and RevenueAction handoff, then found one no-scan presentation
  bypass: a revisited queue rendered its cached monetary aggregate while a
  confirmed Dismiss awaited or failed its owned post-write refresh. The exact
  deterministic Chromium regression was RED **0/1**, retaining `AUD 42,000.5 / 1
  case` as current during the pending refresh.
- Queue economic freshness is now independent of local scan-summary existence.
  Mutation start invalidates the prior economic snapshot unconditionally, and
  both aggregate-rendering paths use one `CURRENT` gate. Pending, failed, or
  ambiguous reconciliation withholds counts and money without inferring zero;
  only an authorized successful durable queue read restores exact current
  aggregates. A definitive 409 mutation rejection restores the unchanged
  authoritative pre-write snapshot and has its own regression.
- The no-scan regression is GREEN **1/1** and the definitive-rejection companion
  is GREEN **1/1**. The complete Revenue Command Center Chromium specification
  passes **17/17**, including scan/no-scan freshness, normal refresh,
  known-zero/unknown/multiple-currency presentation, stale-read ownership,
  ambiguous recovery, Snooze/Dismiss, and RevenueAction handoff. Focused
  first-value/browser/queue/money contracts pass **31/31**; complete Node
  integration passes **473/473**; complete managed Chromium passes **73/73**;
  the production build and engineering harness pass. Migrations `001`-`016`
  remain byte-identical, and no backend or PostgreSQL/RLS boundary changed.

## Review and handoff

- Implementer self-check: the complete Slice 1 diff was reread defect-first for
  capability drift, template/sample mixing, route authority, tenant isolation,
  stale response handling, duplicate resume reads, explicit mutation control,
  accessibility, and mobile overflow. No additional in-scope defect was found.
- Fresh reviewer findings/resolution: the first review returned one P2 retained
  expired/cleaned lifecycle classification defect and one P3 unsupported
  authentication presentation defect. Both were remediated at the browser
  contract/UI boundary. The second review returned one P2 migration-015
  minimized-response classification defect covering preview and committed
  results; it is remediated at the same browser-contract boundary. The third
  review returned one P2 guided source-system namespace mismatch; it is
  remediated without changing or normalizing the server identity contract. One
  final independent review approved the resulting head with no P0-P3 findings,
  and Slice 1 later merged through PR #36.
- Slice 2 fresh review findings above are remediated at the shared monetary
  projection, nullable presentation, and strict browser-contract boundaries.
  A new independent review of the resulting pinned checkpoint is the next
  gate.
- Slice 2 implementer self-check: the complete diff was reread defect-first for
  detector-rule drift, count reconciliation, false readiness, unknown-to-zero
  money, cross-currency aggregation, caller tenant authority, hidden scan
  mutation, unsupported remediation promises, stale request races, 390px
  overflow, and schema drift. Focused, affected, PostgreSQL, browser, harness,
  build, migration, and artifact evidence is recorded above. Fresh independent
  review remains the next gate.
- Slice 3 implementer self-check: the complete diff was reread defect-first for
  client re-ranking, sample proof, implicit scan, false no-leak completeness,
  FX/cross-currency or unknown-to-zero inference, stale/malformed authority,
  duplicate ambiguous writes, action-lifecycle ownership, unavailable current
  opportunity context, autonomous outbound, mobile overflow, and schema drift.
  One edge case was corrected before checkpoint: historical cases now reconcile
  Snooze/Dismiss through their immutable historical opportunity identity even
  when current action/navigation context is absent. No remaining in-scope
  defect was found. Fresh independent review of the pinned checkpoint is the
  next gate.
- Slice 3 first-review findings are remediated at the browser lifecycle and
  queue-freshness boundaries. The exact delayed-refresh lifecycle interleaving
  remains blocked until successful history reconciliation, and delayed/failed/
  recovered post-scan reads prove cached money is never promoted to current.
  The following fresh review found the later-mutation freshness and reactive
  title gaps described above; both are now covered by RED-first browser
  regressions and the generation-aware/reactive-route remediation. Fresh
  independent review of the new pinned checkpoint is the next gate.
- Debt/follow-up: no new product debt was introduced. The existing production
  bundle-size warning remains visible; broad information architecture,
  connectors, additional detectors, attribution/ROI, recovered-revenue claims,
  autonomous execution, and the next milestone remain out of scope.
