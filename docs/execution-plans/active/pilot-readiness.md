# Pilot Readiness

## Outcome
- **PR-0 is COMPLETE.** The Pilot architecture and production-operation contracts are now canonical, linkable, and protected by the harness before any Pilot implementation or provisioning begins.
- **PR-1 is COMPLETE.** It characterizes the legacy JSON compatibility contract, fixtures, and observable behavior; it does not implement production persistence or tenant isolation.
- **PR-2 is next.** It will implement the approved production persistence and tenant-isolation slice only after the vendor/provisioning gates below are resolved.
- Explicit non-goals: provisioning cloud, DNS, Auth0, SMTP, or Cloudflare; migrations; dependency changes; and PR-2–PR-7/product behavior.

## Locked baselines and verified evidence
| Area | Locked baseline | Verified evidence / owner |
| --- | --- | --- |
| Current product | Local JSON is the current local/test persistence authority; deterministic intelligence and manual RevenueAction approval remain unchanged. | [`PROJECT_STATE.md`](../../PROJECT_STATE.md), [`JSON_PERSISTENCE.md`](../../architecture/JSON_PERSISTENCE.md), and [`REVENUE_ACTION_EXECUTION.md`](../../architecture/REVENUE_ACTION_EXECUTION.md) reviewed in PR-0. |
| Pilot topology | Cloud Run and Cloud SQL PostgreSQL use australia-southeast2 (Melbourne). Sydney is a written exception only. | Official Google links rechecked on 2026-08-30 in the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md); reverify before provisioning. |
| Identity and recovery | Auth0 Australia (AU); 14 daily backups retained; RPO <= 24 hours; RTO <= 4 business hours. | Contracts locked in the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md) and [production gate](../../operations/PILOT_PRODUCTION_GATE.md). |
| Import evidence | Raw files: 7 days; audit metadata: 12 months. | Retention and deletion rules are locked in the [foundation](../../architecture/PILOT_READINESS_FOUNDATION.md). |

## Boundaries and decisions
| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Architecture | Canonical architecture contract is [`PILOT_READINESS_FOUNDATION.md`](../../architecture/PILOT_READINESS_FOUNDATION.md). It defines the future production target, tenant isolation, persistence cutover, import safety, identity, and retained product invariants. | PR-0 deliverable; operator owns future implementation handoff. |
| Operations | Canonical pre-provisioning/release contract is [`PILOT_PRODUCTION_GATE.md`](../../operations/PILOT_PRODUCTION_GATE.md). It defines vendor gates, configuration proof, recovery checkpoints, and sign-off. | PR-0 deliverable; founder/operator role is transferable. |
| Safety and recovery | No default Cloud SQL backup location; use an Australian regional location with 14 daily retained backups. Tenant recovery is a full database restore to a temporary AU instance, followed by a logical tenant export/restore. | PR-0 decision; no native tenant restore is claimed. |
| Compatibility | JSON remains local/test compatible. Production cutover is append-only migrations plus one-way, verified legacy snapshot cutover; no dual write. | PR-1 characterization: [`LEGACY_JSON_COMPATIBILITY.md`](../../architecture/LEGACY_JSON_COMPATIBILITY.md); PR-2 implementation boundary. |

## Auth0 magic-link delivery gate (before PR-4)

**PR-4 is blocked** until the product owner records a delivery, UX, and security decision that validates all of the following:

1. The selected Auth0 AU plan supports passwordless magic links.
2. The selected flow is **Classic Login with same-browser/device completion**, or the product owner separately approves a tenant setting or alternative.
3. Mobile and email-client behavior, callback and redirect allowlists, and phishing/resend/session protections are validated.
4. A deterministic E2E acceptance test proves the selected path.

If magic-link UX is rejected, PR-4 stops for an explicit product decision. There is no implicit OTP fallback and no assumed cross-browser tenant configuration.

## Slices
- [x] **PR-0 — foundation contract:** active plan, canonical architecture and operations documents, project-state/harness alignment, and one deterministic pilot-contract harness gate.
- [x] **PR-1 — contract characterization:** deterministic legacy JSON fixtures, compatibility tests, migration manifest, and PR-2 handoff. No production persistence, tenancy, migration, provisioning, dependency, UI, or product behavior was implemented.
- [ ] **PR-2 — NOT STARTED (next):** implement tenant-scoped transactional production persistence from the approved contracts; do not start until unresolved gates are cleared.
- [ ] **PR-3–PR-7 — NOT STARTED:** remain outside this work unit and are not approved for implementation here.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Focused characterization | `node --test test/legacy-json-compatibility.test.js` | Executed: pass (5/5); isolated local-store, value/analytics, ordering, and RevenueAction scenarios. |
| Integration | `OPENSSL_CONF=/dev/null npm run test:integration` | Executed: pass (56/56). |
| Harness | `OPENSSL_CONF=/dev/null npm run test:harness` | Executed: pass; the plan/index contract now requires PR-1 complete and PR-2 next. |
| Hygiene | `git diff --check` | Executed: pass; no whitespace errors. |
| Build | `npm run build` | Not run: no package, bundler, or production UI change requires it; PR-1 adds fixtures, tests, documentation, and harness-plan assertions only. |

## Review and handoff
- Implementer self-check: **COMPLETE** — PR-1 adds characterization fixtures/tests, compatibility documentation, and plan-state harness assertions only; no provisioning, migrations, dependencies, tenant runtime, UI, or product behavior.
- Fresh reviewer findings/resolution: **Placeholder** — requires an independent reviewer after this work unit; no finding is pre-claimed.
- Final-review evidence: **Placeholder** — reviewer must confirm links, exact facts, non-goals, and executed commands against the diff.
- Unresolved vendor/provisioning gates: static host/privacy posture, transactional SMTP, production domain/registrar, Auth0 AU plan and required features, the Auth0 magic-link delivery gate before PR-4, and privacy/DPA review. See the [production gate](../../operations/PILOT_PRODUCTION_GATE.md).
- Debt/follow-up: PR-2 is explicitly next and **NOT STARTED**; reverify every vendor statement before provisioning.
