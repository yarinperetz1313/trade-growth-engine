# Execution Plans

## Active plan

- [`active/pilot-readiness.md`](active/pilot-readiness.md) — **PR-0 through PR-2 are COMPLETE; PR-3 and PR-4 are integrated in code and complete; PR-5A through PR-5D are complete in their bounded slices. Raw-evidence retention/deletion acceptance remains a separate reviewed follow-up.**

## Completed plans

- [`completed/pr-5b-import-mapping.md`](completed/pr-5b-import-mapping.md)
- [`completed/pr-5c-canonical-import-commit.md`](completed/pr-5c-canonical-import-commit.md)
- [`completed/pr-5d-browser-import.md`](completed/pr-5d-browser-import.md)
- [`completed/first-credible-revenue-leak-ux.md`](completed/first-credible-revenue-leak-ux.md) — **Issue #8 browser slice adds explicit detector review, durable case lifecycle/history, and bounded existing-RevenueAction linkage without server or persistence changes.**
- [`completed/revenue-leak-case-foundation.md`](completed/revenue-leak-case-foundation.md) — **Issue #8 foundation is complete; its historical scope excluded the later detector/UI/recovery/attribution consumers.**
- [`completed/stalled-opportunity-detector.md`](completed/stalled-opportunity-detector.md) — **Issue #8 follow-on implements the versioned detector and tenant-safe reconciliation without scheduling, UI, execution, or attribution.**

## When to create a plan
Create a plan before work that spans sessions, changes a safety boundary, has multiple dependent slices, or needs reviewable verification evidence. Use [`TEMPLATE.md`](TEMPLATE.md), place in-progress plans in `active/`, and move completed plans to `completed/` with final evidence and follow-ups.

A plan is a decision and evidence record, not a backlog copy. Small, self-contained fixes can proceed without one when their verification is obvious.
