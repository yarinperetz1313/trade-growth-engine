# API and Action Semantics

## Core routes
- `GET /health` reports service/configuration status.
- `GET /api/opportunities` lists opportunities.
- `GET /api/pipeline/metrics` returns pipeline totals.
- `GET /api/intelligence/revenue` returns a read-only deterministic active-pipeline portfolio, classifications, attention totals, and ranked next-best actions.
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


## Revenue intelligence read model
Revenue intelligence is a GET-only portfolio projection. It excludes `WON` and `LOST` opportunities, returns an explicit `generated_at` timestamp, and never persists data. `value_semantics` declares that commercial value is known only when a positive finite value is recorded. Missing, `null`, zero, blank, and non-numeric values are unknown; unknown values are never presented as a known `$0`. Summary `known_count` and `unknown_count`, plus ranked-action `value.known`, preserve that distinction. This read model does not alter deal-intelligence scoring or the existing positive-value mutation rule. Attention is deduplicated by opportunity even when an opportunity is simultaneously stale, at risk, missing a next action, or has `VALUE_UNKNOWN`; a `STRONG` health status does not exempt an actionable gap.

## RevenueAction execution routes
- `POST /api/opportunities/:id/revenue-actions` materializes the current executable deterministic recommendation as a durable record. Closed opportunities are rejected.
- `GET /api/revenue-actions` and `GET /api/revenue-actions/:id` expose opportunity-level execution history.
- `POST /api/revenue-actions/:id/prepare` builds a deterministic draft or internal-task proposal only when the current recommendation fingerprint still matches.
- `POST /api/revenue-actions/:id/approve`, `/reject`, `/cancel`, and `/execute` enforce the lifecycle server-side.

Communication execution requires `executionMode: "MANUAL_CONFIRMED"`; it records human confirmation and never claims TGE sent a message. Internal execution creates one linked task or reuses only a task with matching structured deal-intelligence identity, then records one linked activity. Recovery validates approval, execution mode, opportunity, action/effect types, and record state; conflicting linked effects return `REVENUE_ACTION_EFFECT_CONFLICT`. Successful transitions return refreshed opportunity, pipeline, and revenue projections. Invalid JSON is `INVALID_JSON_BODY`; non-object bodies are `INVALID_REQUEST_BODY`; unexpected local-store failures are `REVENUE_ACTION_PERSISTENCE_UNAVAILABLE`.

## RevenueLeakCase and detector routes

- `GET /api/revenue-leak-cases` lists tenant-visible history with optional
  `opportunity_id` and lifecycle-state filters.
- `GET /api/revenue-leak-cases/:id` returns one tenant-visible case.
- `POST /api/revenue-leak-cases/reconcile` validates and deterministically
  reconciles a `STALLED_OPPORTUNITY` detection snapshot.
- `POST /api/opportunities/:id/revenue-leak-cases/detect-stalled` accepts only an
  empty object, loads tenant-visible canonical opportunity/activity/task evidence,
  returns one of the five versioned detector outcomes, and reconciles only
  `ELIGIBLE_LEAK_DETECTED` through the existing case service.
- `POST /api/revenue-leak-cases/:id/snooze`, `/resume`, and `/dismiss` apply the
  bounded audited human lifecycle.
- `POST /api/revenue-leak-cases/:id/link-revenue-action` links one existing
  same-opportunity RevenueAction without changing its lifecycle or effects.

Caller-authored tenant/lifecycle fields and unsupported leak types are rejected.
Cross-tenant and nonexistent case IDs use the same not-found response; unavailable
source/action relationships are also non-oracular. Detector thresholds, time,
tenant, evidence, economics, and lifecycle are never caller-authored. Detection
does not materialize or execute a RevenueAction and makes no recovery or
attribution claim.
