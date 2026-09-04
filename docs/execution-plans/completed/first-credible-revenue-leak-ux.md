# First credible revenue leak UX

## Outcome
- Problem and intended observable result: give an authenticated user an explicit,
  per-opportunity browser workflow for the existing versioned stalled-opportunity
  detector and durable RevenueLeakCase history. The UI must distinguish all five
  detector outcomes, preserve exact commercial-value classifications, explain
  immutable why-now evidence and source freshness, and expose only server-permitted
  case transitions and one-time RevenueAction linkage.
- Explicit non-goals: new detectors or server lifecycle, scheduling/import hooks,
  persistence or migration changes, Command Center V2, Quote Recovery, outcome or
  attribution claims, autonomous messaging, RevenueAction execution changes,
  retention/deletion, production provisioning, or unrelated redesign.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Product surface | Add a bounded RevenueLeakCase panel to the existing Opportunity Command Center. Portfolio rows continue to navigate into that surface and hash routing remains unchanged. | `web/AGENTS.md`; existing Opportunity/Revenue Command Centers |
| Detector truth | Detection remains an explicit button press. Present the five server outcomes and closed reason-code explanations without collapsing insufficient, stale, Data Health, unauthorized, persistence error, or no-history into “no leak.” | `REVENUE_LEAK_CASE.md`; `DETERMINISTIC_CONTRACTS.md` |
| Evidence and economics | Render only response/case evidence, detector/source version and observation time. Label economics “potential revenue at risk” and preserve known positive, known zero, unknown, and not applicable without numeric coercion. | RevenueLeakCase merged contract; Issue #8 |
| Lifecycle | Fetch opportunity-filtered case history from the API on entry/revisit. Show OPEN, SNOOZED, DISMISSED, and SUPERSEDED audit history. Offer snooze only from OPEN, resume only from SNOOZED, and dismiss only from active states; every mutation requires a human reason and snooze supplies a future server-validated wake time. | Existing repository/service transition contract |
| RevenueAction | Point into the existing Opportunity Command Center execution section. If an existing same-opportunity RevenueAction is available, offer only the existing one-time link endpoint. Do not prepare, approve, execute, or imply external sending from the case panel. | `REVENUE_ACTION_EXECUTION.md`; same-opportunity link contract |
| Auth and failures | All calls use `web/lib/api.js` and therefore the existing fresh bearer-token seam. Distinguish 401/403 from persistence/API failures and guard new asynchronous state against responses for a previously selected opportunity. | `browserApiRequest.mjs`; browser auth contract |
| Compatibility / recovery | No server/domain/schema changes. Reloading the hash route re-fetches API-backed case state. Removal of the panel/client wrappers reverts the UI without modifying durable case records. | Existing API and JSON/PostgreSQL persistence contracts |

## Acceptance
- An authorized user can explicitly run detection for the current opportunity.
- All five detector outcomes and every closed version-1 reason are truthful and
  testable; suppression is never presented as no leak.
- Immutable evidence plus source observation/version is visible when supplied,
  with explicit unavailable/stale/suppressed wording when it is not.
- Known positive, known zero, unknown, and not-applicable potential revenue at
  risk render distinctly and never become recovered revenue.
- Durable history, audit, snooze/resume/dismiss eligibility, one-time action link,
  unauthorized, persistence failure, refresh/revisit, mobile fit, and stale async
  response handling are covered proportionately.

## Slices
- [x] Red focused browser-contract tests for outcome/reason presentation, exact
  value classifications, lifecycle eligibility, auth/error distinctions, and
  API-client surface.
- [x] Browser API wrappers and Opportunity Command Center RevenueLeakCase panel,
  including explicit detection, durable history/evidence, bounded lifecycle, and
  RevenueAction handoff/linkage.
- [x] Managed Playwright coverage for real API-backed detect/link/lifecycle reload,
  mocked five-outcome/error/terminal-history states, hash navigation, and mobile fit.
- [x] Progressive validation, complete diff self-review, plan evidence update,
  repository checkpoint commit, and clean-worktree handoff.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Red-first | `node --test test/revenue-leak-browser-contract.test.js` | First run: 0/5 passed because the contract module/panel did not exist. Self-review regression addition: 5/6 passed until malformed-success response validation was implemented. |
| Focused | `node --test test/revenue-leak-browser-contract.test.js` | 6/6 passed: outcomes/reasons, exact values, lifecycle, auth/error, malformed-success rejection, and bounded client ownership. |
| Relevant server/API | Focused existing API, repository, detector, service, and temp-store Node selection | 86/86 passed outside the restricted sandbox. No server, domain, persistence, or migration file changed. |
| Managed browser | `npm run test:e2e -- --grep "revenue leak"`; `npm run verify:browser` | Final focused run 5/5 passed. Full managed browser gate passed harness plus 37/37 tests. It covers real API-backed detection/link/transitions/reload, five outcomes, failure classes, terminal history/value classes, stale-response rejection, hash navigation, and 390px viewport fit. |
| Near checkpoint | `npm run verify:fast`; `npm run build`; `git diff --check` | Harness plus 271/271 integration tests passed outside the restricted sandbox; Vite 8.2.2 built 30 modules; diff whitespace check passed. Full `npm run verify` remained coordinator-owned and was not run. |

### Independent-review remediation checkpoint

- Red P1 evidence: `node --test test/revenue-leak-browser-contract.test.js`
  passed 5/6 and failed the malformed-success regression with
  `ERR_ASSERTION: Missing expected exception` at the newly added nested-evidence
  assertion. The browser contract now validates the complete version-1 evidence
  shape for successful detector results and persisted case facts, including
  canonical timestamps and their relationships, non-empty versions, exact
  thresholds, stage/reason semantics, boolean next-action presence, source/value
  consistency, sorted task-id arrays, and commercial-basis shapes.
- Red P2 evidence: managed
  `npm run test:e2e -- --grep "delayed RevenueAction history"` passed 0/1;
  after changing the hash route, the old response rendered
  `STALE ACTION MUST NOT RENDER` twice (`Expected: 0`, `Received: 2`). RevenueAction
  list state is now cleared and guarded by opportunity, request, and generation;
  both Command Center selection and case-panel linkage independently require the
  current `opportunity_id`.
- Remediation green evidence: focused browser contracts passed 6/6; the affected
  detector, RevenueLeakCase API, RevenueAction API, and managed-store selection
  passed 44/44; focused managed revenue-leak/stale-action E2E passed 6/6;
  `npm run verify:fast` passed the harness and 271/271 integration tests;
  Vite 8.2.2 built 30 modules; `git diff --check` passed. The first affected-test
  attempt inside the restricted sandbox produced `listen EPERM` for listener-based
  tests; the identical approved run passed 44/44. No full browser or database suite
  was rerun because the bounded browser/client remediation did not justify those
  coordinator-owned gates.

The first sandboxed browser/fast-gate attempts failed because the managed sandbox
denied localhost listeners (and one temporary Git-index fixture). The same commands
passed under the approved execution profile. One focused browser rerun exposed a
test-visible lifecycle settling race; lifecycle inputs and actions now serialize
while a transition reconciles, and the final focused run passed 5/5.

## Review and handoff
- Implementer self-check: complete against the full worktree diff. The UI says
  potential revenue at risk, preserves exact decimal strings and known-zero versus
  unknown/not-applicable truth, renders only contract evidence, rejects malformed
  success envelopes, uses the existing bearer-token client, and adds no caller
  authority. Opportunity-generation/request guards prevent stale history or mutation
  responses from crossing hash-route changes. Server-permitted lifecycle actions
  require human reasons; transitions are serialized; snooze computes a future wake
  timestamp at invocation. Durable history reloads from the API. The panel cannot
  create/transition a RevenueAction and says nothing is sent from case review.
- Fresh reviewer findings/resolution: direct self-review found and fixed mobile
  overflow from the existing action form, malformed 2xx responses collapsing toward
  empty state, stale prior evaluation after a failed recheck, variable audit-grid
  placement, and lifecycle-input settling during consecutive transitions. No open
  P0-P3 finding remains.
- Independent reviewer BLOCK resolution: the shallow nested-evidence acceptance
  and cross-opportunity late RevenueAction list application now have red-first
  regressions and bounded fixes. Remediation self-review covered
  `origin/main...HEAD`; no open P0-P3 finding remains and no server, domain,
  persistence, schema, migration, scheduler, or import file changed.
- Final-review evidence: branch/base preflight matched `3173d4bad1541ed83dce60f33cc636ec490f2640`;
  no server/domain/persistence/migration file or unrelated product surface changed;
  managed browser, integration, build, and diff-hygiene evidence is green.
- Debt/follow-up: expected non-goals remain scheduler/import hooks,
  additional detectors, attribution/outcomes, retention/deletion, and production
  provisioning. Database verification was not run because this slice changes no
  database contract or migration; the coordinator-owned full verification remains
  intentionally outstanding.

### Sole bounded durable-review remediation

- Red temporal/audit evidence: the focused browser contract passed 6/7 and the
  new malformed-evidence regression failed with `Missing expected exception`.
  Cases could admit a stalled threshold after detection, a source outside the
  exact 90-day window, future detection/source evidence, missing audit time,
  reversed audit chronology, and a nested object that React could not render.
- Red route evidence: the managed route-race regression observed the previous
  opportunity name render after the hash and current opportunity had changed.
  Opportunity intelligence now requires matching opportunity, request, and
  generation identity; the leak panel is route-keyed and independently guards
  detector, history, transition, and link responses by opportunity generation.
- Red ambiguous-write evidence: after a committed snooze whose response was
  lost, the old UI re-enabled without an authoritative reload. Snooze, resume,
  dismiss, and RevenueAction-link failures with a network, malformed-success,
  server, or outcome-unknown result now reload and validate durable history before
  controls re-enable. No mutation is retried automatically.
- The remediation remains browser/client-only. It changes no server, domain,
  persistence, schema, migration, authorization, tenant, or RevenueAction execution
  boundary.
- Green evidence: focused browser contracts passed 7/7; the affected browser,
  detector, RevenueLeakCase, RevenueAction, and managed-store selection passed
  82/82; the complete affected managed Chromium file passed 8/8; `verify:fast`
  passed the harness and 272/272 integration tests; `verify:browser` passed the
  harness and 40/40 managed Chromium tests; Vite 8.2.2 built 30 modules; and
  `git diff --check` passed. Listener-based tests required the approved execution
  profile after the restricted sandbox returned `listen EPERM`; no database gate
  was run because no database boundary changed.

### Fresh final-review P1 remediation checkpoint

- Temporal/408 red evidence: the focused browser contract passed 5/7. HTTP 408
  returned `false` from the ambiguous-mutation classifier, and the exact stalled
  boundary admitted a contradictory `RECENT_MEANINGFUL_ACTIVITY` result with
  `Missing expected exception`. The contract now also rejects
  `NEXT_ACTION_PRESENT` before the stalled boundary, using detector response
  receipt time or durable case detection time as the applicable evaluation time.
- Route-mutation red evidence: the managed RevenueAction race rendered
  `LATE REVENUE ACTION MUTATION MUST NOT RENDER` after route B was selected. The
  isolated intelligence-mutation race made three route-A intelligence loads where
  only the initial load was permitted, proving the stale update callback/reselection
  loop ran after navigation. Separate opportunity, generation, and mutation-request
  identities now gate intelligence actions and every RevenueAction mutation before
  returned opportunity state or `onOpportunityUpdated` can be applied.
- HTTP 408 browser red evidence: the lifecycle/link scenario remained `OPEN` after
  a committed snooze returned 408 instead of reconciling to authoritative
  `SNOOZED` history. HTTP 408 now follows the existing unknown-outcome path for
  lifecycle and link writes; controls stay locked during the authoritative history
  reload and no write is retried automatically.
- Green evidence: focused browser contracts passed 7/7; affected detector,
  intelligence API, RevenueAction API, RevenueLeakCase API, browser-contract, and
  managed-store tests passed 64/64; the three targeted managed Chromium regressions
  passed 3/3; the complete affected Opportunity Command Center and revenue-leak
  browser specs passed 17/17; the single `verify:fast` passed the harness and
  272/272 integration tests; and Vite 8.2.2 built 30 modules. The first sandboxed
  E2E attempt exited before its web server started and the first affected Node run
  hit `listen EPERM`; the identical approved runs passed. No server, domain,
  persistence, schema, migration, auth, CI, or GitHub file changed, and no database
  gate was run for this browser/client-only remediation. `git diff --check` and
  the aggregate `origin/main` scope review passed with no open P0-P3 finding.
