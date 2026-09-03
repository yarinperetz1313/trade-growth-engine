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
- Final-review evidence: branch/base preflight matched `3173d4bad1541ed83dce60f33cc636ec490f2640`;
  no server/domain/persistence/migration file or unrelated product surface changed;
  managed browser, integration, build, and diff-hygiene evidence is green.
- Debt/follow-up: expected non-goals remain scheduler/import hooks,
  additional detectors, attribution/outcomes, retention/deletion, and production
  provisioning. Database verification was not run because this slice changes no
  database contract or migration; the coordinator-owned full verification remains
  intentionally outstanding.
