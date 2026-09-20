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
- Fresh reviewer findings/resolution: pending coordinator-led Astra High review of the committed security boundary.
- Final-review evidence: pending.
- Debt/follow-up: live Auth0 AU, Universal Login/SMTP/OTP, provider credentials/configuration, privacy/legal/customer identity, and production operator credential approval remain external gates.
