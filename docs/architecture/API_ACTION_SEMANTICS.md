# API and Action Semantics

## Core routes
- `GET /health` reports service/configuration status.
- `GET /api/opportunities` lists opportunities.
- `GET /api/pipeline/metrics` returns pipeline totals.
- `GET /api/opportunities/:id/intelligence` returns deterministic opportunity intelligence.
- `POST /api/opportunities/:id/intelligence/contact` adds a validated decision-maker name.
- `POST /api/opportunities/:id/intelligence/value` sets a positive numeric opportunity value.
- `POST /api/opportunities/:id/intelligence/follow-up` creates a follow-up task/activity.
- `POST /api/opportunities/:id/intelligence/task` creates the explicit next-best-action task.
- `GET /api/opportunities/:id/activities` returns persisted activity for the opportunity.
- `GET /api/tasks/opportunity/:opportunityId` returns persisted opportunity tasks.

## Mutation contract
Actions must validate request bodies, reject malformed input with structured 400 responses, avoid duplicate open tasks/activities for equivalent actions, and return refreshed opportunity, intelligence, state, and pipeline metrics.

## Semantics to preserve
`probability` is stage-derived pipeline probability. It is not `health.status`, `score.overall`, or close certainty.
