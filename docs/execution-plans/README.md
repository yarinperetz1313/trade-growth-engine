# Execution Plans

## Active plan

- [`active/external-pilot-deployment-operations.md`](active/external-pilot-deployment-operations.md) — **Issue #43 deployment/operations foundation from exact base `44ebebb`: inert Melbourne templates, deterministic release validation, and bounded maintenance execution only.**
- [`active/pilot-zero-business-first-presentation.md`](active/pilot-zero-business-first-presentation.md) — **Issue #39's approved browser-only presentation pass starts from exact clean `origin/main` `c6cb6a7`; product implementation begins only after its clean planning checkpoint.**

## Completed plans

- [`completed/guided-first-credible-leak-pilot-v1.md`](completed/guided-first-credible-leak-pilot-v1.md) — **Issue #14's three slices are complete through merged PRs #36/#37/#38 and successful post-merge Verify runs, ending at exact `origin/main` `c6cb6a7`.**
- [`completed/pilot-readiness.md`](completed/pilot-readiness.md) — **Pilot Readiness and the Assisted Pilot Safety Gate V1 are complete historical evidence. External provider, infrastructure, legal/privacy, backup/restore, and canonical tenant-data deletion gates remain explicit rather than implied.**
- [`completed/first-value-onboarding-pilot-evidence.md`](completed/first-value-onboarding-pilot-evidence.md) — **Issue #9/#14 PR-3 completes the post-import first-value bridge and closed, tenant-scoped, privacy-minimized pilot-evidence contract as a local candidate; GitHub delivery remains coordinator-owned.**
- [`completed/revenue-command-center-v2.md`](completed/revenue-command-center-v2.md) — **Issue #9 PR-2 makes the server-ordered RevenueLeakCase queue the primary Command Center and composes a tenant-safe, retry-safe handoff into the existing human-controlled RevenueAction lifecycle.**
- [`completed/revenue-leak-operating-queue.md`](completed/revenue-leak-operating-queue.md) — **Issue #9 PR-1 implements the explicit bounded tenant-wide stalled-opportunity scan and truthful active RevenueLeakCase operating queue; its historical checkpoint excluded the later Command Center/action-handoff and onboarding/evidence work.**
- [`completed/pr-5b-import-mapping.md`](completed/pr-5b-import-mapping.md)
- [`completed/pr-5c-canonical-import-commit.md`](completed/pr-5c-canonical-import-commit.md)
- [`completed/pr-5d-browser-import.md`](completed/pr-5d-browser-import.md)
- [`completed/first-credible-revenue-leak-ux.md`](completed/first-credible-revenue-leak-ux.md) — **Issue #8 browser slice adds explicit detector review, durable case lifecycle/history, and bounded existing-RevenueAction linkage without server or persistence changes.**
- [`completed/revenue-leak-case-foundation.md`](completed/revenue-leak-case-foundation.md) — **Issue #8 foundation is complete; its historical scope excluded the later detector/UI/recovery/attribution consumers.**
- [`completed/stalled-opportunity-detector.md`](completed/stalled-opportunity-detector.md) — **Issue #8 follow-on implements the versioned detector and tenant-safe reconciliation without scheduling, UI, execution, or attribution.**

## When to create a plan
Create a plan before work that spans sessions, changes a safety boundary, has multiple dependent slices, or needs reviewable verification evidence. Use [`TEMPLATE.md`](TEMPLATE.md), place in-progress plans in `active/`, and move completed plans to `completed/` with final evidence and follow-ups.

A plan is a decision and evidence record, not a backlog copy. Small, self-contained fixes can proceed without one when their verification is obvious.
