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

## Review and handoff
- Implementer self-check: complete; no migration, runtime grant, money, import, RevenueAction, provider-call-in-test, public signup, Organizations, tenant switching, local-storage authority, or application step-up expansion.
- Fresh reviewer findings/resolution: Astra review of `6a050bd225e8f58b522955f2b028556c63a16c56` found three P2 roots. Remediation cycle 1/3 binds every Auth0 success to the exact passwordless-email connection and subject, recognizes authenticated invitation landings before membership resolution, and reserves capability output plus proves database/OWNER authority before provider access. The same pass distinguishes consumed callbacks with missing app state.
- Remediation RED evidence on reviewed HEAD `6a050bd`: focused regressions were **17/24**, failing provider-connection, preflight-order/output-reservation, and missing-callback-state expectations; the overlaid managed Chromium identity specification was **4/6**, failing authenticated invitation precedence and missing-state recovery.
- Remediation GREEN evidence: focused security/auth/operator tests **68/68**; PostgreSQL identity/offboarding **23/23**; managed Chromium identity **6/6**. Final full gate passes: harness; integration **520/520**; PostgreSQL **94/94**; managed Chromium **90/90**; production build **36 modules** with the existing chunk warning.
- Final-review evidence: pending fresh Astra review of the remediation checkpoint.
- Debt/follow-up: live Auth0 AU, Universal Login/SMTP/OTP, provider credentials/configuration, privacy/legal/customer identity, and production operator credential approval remain external gates.
