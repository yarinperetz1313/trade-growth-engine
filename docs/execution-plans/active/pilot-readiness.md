# Pilot Readiness

## Outcome
- **PR-0 is COMPLETE.** The Pilot architecture and production-operation contracts are now canonical, linkable, and protected by the harness before any Pilot implementation or provisioning begins.
- **PR-1 is NOT STARTED and is next.** It will implement the approved persistence and tenant-isolation slice only after the vendor/provisioning gates below are resolved.
- Explicit non-goals: provisioning cloud, DNS, Auth0, SMTP, or Cloudflare; migrations; dependency changes; and PR-1–PR-7/product behavior.

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
| Compatibility | JSON remains local/test compatible. Production cutover is append-only migrations plus one-way, verified legacy snapshot cutover; no dual write. | PR-1 design/implementation boundary. |

## Auth0 magic-link delivery gate (before PR-4)

**PR-4 is blocked** until the product owner records a delivery, UX, and security decision that validates all of the following:

1. The selected Auth0 AU plan supports passwordless magic links.
2. The selected flow is **Classic Login with same-browser/device completion**, or the product owner separately approves a tenant setting or alternative.
3. Mobile and email-client behavior, callback and redirect allowlists, and phishing/resend/session protections are validated.
4. A deterministic E2E acceptance test proves the selected path.

If magic-link UX is rejected, PR-4 stops for an explicit product decision. There is no implicit OTP fallback and no assumed cross-browser tenant configuration.

## Slices
- [x] **PR-0 — foundation contract:** active plan, canonical architecture and operations documents, project-state/harness alignment, and one deterministic pilot-contract harness gate.
- [ ] **PR-1 — NOT STARTED (next):** implement production persistence and tenant isolation from the approved contracts; do not start until unresolved gates are cleared.
- [ ] **PR-2–PR-7 — NOT STARTED:** remain outside this work unit and are not approved for implementation here.

## Verification
| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Harness | `npm run test:harness` | **Placeholder before execution:** pass. **Executed:** pass; the pilot-contract gate checked only this plan and its two canonical documents. |
| Focused | `node --test test/engineering-harness.test.js` | **Placeholder before execution:** pass. **Executed:** pass; existing focused harness-suite coverage exercised the gate. |
| Syntax | Node syntax checks for the edited harness script | **Placeholder before execution:** pass. **Executed:** pass. |
| Hygiene | `git diff --check` | **Placeholder before execution:** no whitespace errors. **Executed:** pass. |
| Full gate when required | `npm run verify` | Not run: explicitly out of scope; no product, migration, browser, or build change was made. |

## Review and handoff
- Implementer self-check: **COMPLETE** — PR-0 changes are documentation and a narrowly-scoped deterministic harness invariant only; no provisioning, migrations, dependencies, or product behavior.
- Fresh reviewer findings/resolution: **Placeholder** — requires an independent reviewer after this work unit; no finding is pre-claimed.
- Final-review evidence: **Placeholder** — reviewer must confirm links, exact facts, non-goals, and executed commands against the diff.
- Unresolved vendor/provisioning gates: static host/privacy posture, transactional SMTP, production domain/registrar, Auth0 AU plan and required features, the Auth0 magic-link delivery gate before PR-4, and privacy/DPA review. See the [production gate](../../operations/PILOT_PRODUCTION_GATE.md).
- Debt/follow-up: PR-1 is explicitly next and **NOT STARTED**; reverify every vendor statement before provisioning.
