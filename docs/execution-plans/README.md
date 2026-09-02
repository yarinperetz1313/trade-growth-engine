# Execution Plans

## Active plan

- [`active/pilot-readiness.md`](active/pilot-readiness.md) — **PR-0 through PR-2 are COMPLETE; PR-3 and PR-4 are integrated in code and complete; PR-5A through PR-5D are implemented in their bounded slices. Raw-evidence retention/deletion acceptance is explicitly deferred to a separate reviewed follow-up; PR-6–PR-7 remain unstarted.**
- [`active/pr-5d-browser-import.md`](active/pr-5d-browser-import.md) — **PR-5D browser import workflow is in progress using contract-mocked managed Playwright; retention/deletion remains explicitly deferred.**

## When to create a plan
Create a plan before work that spans sessions, changes a safety boundary, has multiple dependent slices, or needs reviewable verification evidence. Use [`TEMPLATE.md`](TEMPLATE.md), place in-progress plans in `active/`, and move completed plans to `completed/` with final evidence and follow-ups.

A plan is a decision and evidence record, not a backlog copy. Small, self-contained fixes can proceed without one when their verification is obvious.
