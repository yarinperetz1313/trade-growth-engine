# External Pilot Offboarding Operator

## Outcome
- Problem and intended observable result: an assisted-pilot operator can safely
  dry-run, request, inspect, hand off maintenance, and collect an actor-bound
  privacy-minimized receipt without direct row edits or engineering-only SQL.
- Explicit non-goals: canonical CRM deletion, provider/Auth0 mutation, backup or
  log deletion, a generic admin UI, a new schema/migration, and any change to
  the public API step-up boundary or maintenance processor authority.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Request authority | Apply composes the existing service/repository/function; the function performs final exact tenant/issuer/subject active-OWNER revalidation | PostgreSQL race and stale-owner tests |
| Connection authority | `TGE_OFFBOARDING_OPERATOR_DATABASE_URL` is mandatory with no generic/runtime fallback; maintenance stays on its separate existing DSN/command | Unit configuration test and runbook |
| Login authority | Preflight validates `session_user`, requires it to equal `current_user`, and rejects every transitive role except `tge_runtime`, including predefined server/file roles | Real PostgreSQL role-switch and `pg_write_server_files` regressions |
| Safety | Request defaults to dry-run; apply requires `OFFBOARD_ACCESS_AND_RAW_EVIDENCE`; terminal and actor mismatch fail closed | Unit and PostgreSQL tests |
| Request ownership | Apply reports accepted only after an authoritative actor-bound re-read; distinct OWNER races produce one acceptance and one mismatch while same-actor replay remains idempotent | Synchronized real PostgreSQL OWNER-race regression |
| Unknown outcome | A lost COMMIT acknowledgement returns a non-retryable reconciliation result and directs the same actor to status; definitive denial remains distinct | Unit classification and real committed-unacknowledged PostgreSQL regression |
| Product truth | Receipt reports counts/classes only and labels canonical/legal/provider/log/export/backup work as retained, unknown, or external | Receipt unit/PostgreSQL tests |
| Compatibility | No migration or existing API/maintenance/deployment/provider file changes | Diff/migration identity checks |
| Recovery | Pending/retryable requests hand off to `npm run maintenance:cleanup`; repeated failure stops for evidence-led investigation | Runbook |

## Slices
- [x] Red-first workflow/parser/configuration tests and operator workflow.
- [x] Dedicated PostgreSQL adapter and repository-native CLI/package command.
- [x] Real PostgreSQL 16.15 request race, final revalidation, maintenance,
  receipt, scrub/retention, and tenant-isolation evidence.
- [x] Runbook and project-state handoff.
- [x] Review remediation cycle 1: authenticated-login authority, actor-owned
  request acceptance, and unknown transaction reconciliation.

## Verification
| Level | Command or inspection | Evidence |
| --- | --- | --- |
| Product RED | `node --test test/offboarding-operator.test.js` before implementation | **0/8**, missing operator workflow |
| Focused unit | `node --test test/offboarding-operator.test.js` | **PASS 9/9** |
| Focused database | `TGE_TEST_DATABASE_URL=... node --test --test-concurrency=1 test/database/offboarding-operator.test.js` on PostgreSQL 16.15 | **PASS 3/3** |
| Cycle-1 RED | New unit and PostgreSQL adversarial regressions on `5bd70a2` | unit **10/12**; PostgreSQL **3/6**, with all three review roots reproduced |
| Cycle-1 focused GREEN | Unit operator; operator PostgreSQL; offboarding/expiry PostgreSQL | **12/12**; **6/6**; combined PostgreSQL **26/26** |
| Cycle-1 complete integration | `npm run test:integration` | initial unrelated loopback socket close at **503/504**; unchanged focused spec **19/19**; complete rerun **504/504** |
| Cycle-1 complete PostgreSQL | `TGE_TEST_DATABASE_URL=... npm run test:db` on PostgreSQL 16.15 | **97/97** |
| Cycle-1 harness/build | `npm run test:harness`; `npm run build` | **PASS**; Vite transformed 35 modules with the existing chunk warning |
| Affected integration | `npm run test:integration` | **PASS 501/501** |
| Complete database | `TGE_TEST_DATABASE_URL=... npm run test:db` on PostgreSQL 16.15 | **PASS 94/94** |
| Harness/build | `npm run test:harness`; `npm run build` | **PASS**; Vite transformed 35 modules with the existing chunk warning |
| Migration identity | `git diff --exit-code 44ebebb8… -- database/migrations`; SHA-256 inspection for migrations `001`–`016` | **PASS**, no migration changes |

## Review and handoff
- Implementer self-check: focused/full affected gates, diff check, migration
  identity, output minimization, and generated-artifact checks pass.
- Fresh reviewer findings: `OFFBOARD-LOGIN-AUTHORITY`,
  `OFFBOARD-ACTOR-REPLAY-RACE`, and `OFFBOARD-UNKNOWN-OUTCOME` were reproduced
  and remediated in Policy V2 cycle 1/3.
- Final-review evidence: pending fresh review of the cycle-1 checkpoint.
- Debt/follow-up: provider user disable/delete, canonical/legal retention,
  logs/exports, backup expiry/restore reconciliation, provider credentials, and
  real customer action remain explicit human/external gates.
