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
| Safety | Request defaults to dry-run; apply requires `OFFBOARD_ACCESS_AND_RAW_EVIDENCE`; terminal and actor mismatch fail closed | Unit and PostgreSQL tests |
| Product truth | Receipt reports counts/classes only and labels canonical/legal/provider/log/export/backup work as retained, unknown, or external | Receipt unit/PostgreSQL tests |
| Compatibility | No migration or existing API/maintenance/deployment/provider file changes | Diff/migration identity checks |
| Recovery | Pending/retryable requests hand off to `npm run maintenance:cleanup`; repeated failure stops for evidence-led investigation | Runbook |

## Slices
- [x] Red-first workflow/parser/configuration tests and operator workflow.
- [x] Dedicated PostgreSQL adapter and repository-native CLI/package command.
- [x] Real PostgreSQL 16.15 request race, final revalidation, maintenance,
  receipt, scrub/retention, and tenant-isolation evidence.
- [x] Runbook and project-state handoff.

## Verification
| Level | Command or inspection | Evidence |
| --- | --- | --- |
| Product RED | `node --test test/offboarding-operator.test.js` before implementation | **0/8**, missing operator workflow |
| Focused unit | `node --test test/offboarding-operator.test.js` | **PASS 9/9** |
| Focused database | `TGE_TEST_DATABASE_URL=... node --test --test-concurrency=1 test/database/offboarding-operator.test.js` on PostgreSQL 16.15 | **PASS 3/3** |
| Affected integration | `npm run test:integration` | **PASS 501/501** |
| Complete database | `TGE_TEST_DATABASE_URL=... npm run test:db` on PostgreSQL 16.15 | **PASS 94/94** |
| Harness/build | `npm run test:harness`; `npm run build` | **PASS**; Vite transformed 35 modules with the existing chunk warning |
| Migration identity | `git diff --exit-code 44ebebb8… -- database/migrations`; SHA-256 inspection for migrations `001`–`016` | **PASS**, no migration changes |

## Review and handoff
- Implementer self-check: focused/full affected gates, diff check, migration
  identity, output minimization, and generated-artifact checks pass.
- Fresh reviewer findings/resolution: coordinator-owned after checkpoint.
- Final-review evidence: pending.
- Debt/follow-up: provider user disable/delete, canonical/legal retention,
  logs/exports, backup expiry/restore reconciliation, provider credentials, and
  real customer action remain explicit human/external gates.
