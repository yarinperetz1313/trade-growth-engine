# External Pilot One identity foundation

## Outcome
- Problem and intended observable result: make one assisted Pilot tenant operable from first OWNER bootstrap through provisioned invitation, browser authentication/acceptance, returning login/logout, and auditable individual membership revocation without live provider credentials.
- Explicit non-goals: public signup, Auth0 Organizations, tenant switching, browser tenant authority, token persistence, permissive application step-up policy, live Auth0/SMTP proof, provider provisioning, or changes to money/import/RevenueAction boundaries.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Operator authority | First-tenant bootstrap and membership revocation use an explicit dry-run/apply operator command with a privileged PostgreSQL connection; the Pilot runtime retains least privilege. | Focused unit and real PostgreSQL tests |
| Invitation administration | Application create/revoke/provision routes remain fail-closed under the existing unavailable step-up policy. Provider provisioning is a server-only injected port and operator coordinator. | Runtime/API tests |
| Browser authority | Auth0 PKCE memory cache plus fresh access tokens; invitation state is bounded callback `appState`; neither browser claims nor storage choose a tenant. | Unit contracts and managed Chromium |
| Recovery | Provider/user lookup and operation IDs reconcile retries; generic invitation failures do not disclose whether a user or invitation exists. | Focused tests |

## Slices
- [x] Operator bootstrap, provisioning coordinator, pending-invitation revocation, and individual membership revocation with red-first domain tests.
- [x] Browser invitation/login/callback/accept/logout state machine and managed Chromium journeys.
- [x] PostgreSQL transaction evidence, affected integration/build/harness, documentation, and clean implementation candidate.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Harness | `npm run test:harness` | PASS. Repository invariants remain intact. |
| Focused | identity/auth/runtime Node set | PASS 52/52; initial new-feature run was RED 0/4 before implementation. |
| Database | `npm run test:db` with disposable PostgreSQL 16.15 | PASS 94/94, including new bootstrap/invite/revocation transactions and existing RLS. |
| Browser | `npm run test:e2e` | PASS 88/88; identity-specific first login, return/logout, generic denial, and interrupted recovery 4/4. |
| Full gate when required | `TGE_TEST_DATABASE_URL=<disposable> npm run verify` | PASS: harness; integration 512/512; PostgreSQL 94/94; managed Chromium 88/88; production build 36 modules with existing chunk warning. |

### Reconciliation onto deployment/operations main

- Rebasing the two identity commits onto merged PR #44 main
  `0787520d899e488bd17543270c644b989a27d38b` produced no textual conflicts.
  `range-diff` preserves the hardening commit exactly; the foundation commit
  differs only in its `PROJECT_STATE` insertion context.
- Combined inspection confirms `identity:operator`,
  `validate:pilot-deployment`, `verify:pilot-release`, and
  `maintenance:cleanup` coexist; the Node 22 non-root image, Melbourne Cloud
  Run/Cloud SQL template, Docker CI contract, hardened maintenance behavior,
  and `qs` 6.16.0 lock correction remain inherited from main.
- A fixed invitation expiry dated 2026-09-21 became stale on the reconciliation
  date. The service correctly denied it; the test fixture now uses 2099 without
  changing production behavior. The exact regression is GREEN **11/11**.
- Reconciled verification passes focused combined contracts **72/72**,
  dependency-free integration **528/528**, PostgreSQL 16.15 **94/94**, managed
  identity Chromium **6/6**, the engineering harness, and the 36-module Pilot
  release build with the existing chunk warning.

## Review and handoff
- Implementer self-check: complete; no migration, runtime grant, money, import, RevenueAction, provider-call-in-test, public signup, Organizations, tenant switching, local-storage authority, or application step-up expansion.
- Fresh reviewer findings/resolution: Astra review of `6a050bd225e8f58b522955f2b028556c63a16c56` found three P2 roots. Remediation cycle 1/3 binds every Auth0 success to the exact passwordless-email connection and subject, recognizes authenticated invitation landings before membership resolution, and reserves capability output plus proves database/OWNER authority before provider access. The same pass distinguishes consumed callbacks with missing app state.
- Remediation RED evidence on reviewed HEAD `6a050bd`: focused regressions were **17/24**, failing provider-connection, preflight-order/output-reservation, and missing-callback-state expectations; the overlaid managed Chromium identity specification was **4/6**, failing authenticated invitation precedence and missing-state recovery.
- Remediation GREEN evidence: focused security/auth/operator tests **68/68**; PostgreSQL identity/offboarding **23/23**; managed Chromium identity **6/6**. Final full gate passes: harness; integration **520/520**; PostgreSQL **94/94**; managed Chromium **90/90**; production build **36 modules** with the existing chunk warning.
- Final-review evidence: the pre-reconciliation identity checkpoint was
  independently approved with no P0-P3; fresh review of the changed combined
  head remains coordinator-owned before delivery.
- Debt/follow-up: live Auth0 AU, Universal Login/SMTP/OTP, provider credentials/configuration, privacy/legal/customer identity, and production operator credential approval remain external gates.
