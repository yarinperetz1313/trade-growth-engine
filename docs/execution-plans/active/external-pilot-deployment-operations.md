# External Pilot One — Deployment and Operations Foundation

## Outcome
- Problem and intended observable result: provide a credential-independent, reviewable release artifact and sanitized Melbourne deployment contract for one assisted pilot, plus bounded maintenance execution that fails visibly when operator attention is required.
- Explicit non-goals: provider provisioning or mutation, credentials, live backup/restore proof, identity/domain behavior, canonical tenant-data deletion, new product flows, and any change to money, RLS, tenant, RevenueAction, import, or detector semantics.

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Safety or data boundary | Deployment files are inert templates validated locally; no command in the release gate calls a cloud API. Secrets are references only. | Issue #43 and `docs/operations/PILOT_PRODUCTION_GATE.md` |
| Compatibility | The release image starts the existing PostgreSQL/Auth0 Pilot API. Local JSON and ordinary browser build commands remain available. | `docs/architecture/SECURE_PILOT_RUNTIME.md` |
| Rollback / recovery | Deploy only immutable image digests; retain a prior Cloud Run revision and perform provider rollback manually after health/readiness checks. Database restore remains a rehearsed human gate. | Operations runbook in this slice |

## Slices
- [x] Red-first contracts for container, inert deployment manifest, deterministic release validation, and bounded maintenance drain.
- [x] Implement the container/manifest/validators, cleanup policy, runbooks, and package/harness wiring.
- [x] Run focused tests, production Pilot build/release gate, integration/harness verification, diff hygiene, and record exact evidence.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Harness | `npm run test:harness` | **PASS.** Repository invariants and documentation links pass. |
| Focused | `node --test test/pilot-deployment-operations.test.js test/raw-import-expiry-migration.test.js test/pilot-runtime.test.js` | **PASS 36/36.** Container/deployment/release/maintenance, CI release enforcement, migration ordering, and Pilot runtime contracts pass without credentials. Initial deployment/maintenance RED was 0/6; the lock, explicit-edition/tier, and CI-enforcement regressions were separately RED before their fixes. |
| Build/release | `TGE_PUBLIC_API_URL=https://api.example.test VITE_API_URL=https://api.example.test npm run verify:pilot-release` | **PASS.** Clean 35-module Vite artifact contains the exact API origin; pinned container, Melbourne PostgreSQL 16 Enterprise `db-custom-1-3840`, 14-backup, identity, secret-reference, and scheduler contracts validate. Existing >500 kB chunk warning remains non-blocking. |
| Affected integration | `npm run verify:fast` | **PASS 500/500** plus harness. |
| Production dependency audit | `npm audit --omit=dev --json` | **PASS: 0 known vulnerabilities** after lockfile-only `qs` 6.15.3 → 6.16.0 correction. |
| Diff/artifact hygiene | `git diff --check`; `git diff 44ebebb -- src database web`; status inspection | **PASS:** no product/runtime/auth/domain/migration/browser source change; generated `dist/` remains ignored. |

## Review and handoff
- Implementation checkpoint: `aded1a83fac101a7a34f0fc7b769dac6aa99eaf0`.
- Implementer self-check: scope, secret/reference separation, fail-closed provider defaults, maintenance exit semantics, and changed-file boundaries reviewed; no in-scope blocking finding remains.
- Fresh reviewer findings/resolution: coordinator-owned after this checkpoint.
- Final-review evidence: pending independent review of the pinned checkpoint.
- Debt/follow-up: Docker is unavailable on the host, so the CI-enforced real image build was not executed locally; no `TGE_TEST_DATABASE_URL` is configured, so the PostgreSQL concurrency suite was not rerun. Live provider verification, cost/SLA approval, secrets/IAM provisioning, AU backup/restore rehearsal, alert-channel wiring, privacy/DPA and retention decisions, and real customer data remain external gates.
