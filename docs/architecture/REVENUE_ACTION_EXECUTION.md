# Revenue Action Execution

## Purpose
A `RevenueAction` is the durable, human-controlled record that turns the current deterministic next-best action into inspectable work. It is not an email sender, workflow builder, or AI decision-maker.

## Contract
`revenue_actions.json` records `id`, `opportunity_id`, semantic `action_type`, `execution_type`, `risk_class`, `approval_requirement`, lifecycle `status`, priority/title/reason, immutable `recommendation_snapshot`, factual/derived `evidence`, `basis_fingerprint`, prepared execution, audit entries, timestamps, execution result, and linked CRM task/activity IDs.

Snapshots preserve the recommendation that existed at materialization. Current intelligence is recalculated separately and can supersede an active action; history is never rewritten to pretend the original recommendation did not exist.

## Lifecycle
Allowed transitions are server-side only:

- `RECOMMENDED → PREPARED → APPROVED → EXECUTING → EXECUTED`
- `PREPARED → REJECTED`
- `RECOMMENDED|PREPARED → CANCELLED`
- `EXECUTING → FAILED`; a user may explicitly retry `FAILED` execution.

Before preparation, approval, execution, or an idempotent replay of preparation/approval, TGE compares current deterministic evidence and recommendation semantics with the stored basis fingerprint. Changed evidence cancels the active action as `SUPERSEDED_AS_STALE` and returns `REVENUE_ACTION_STALE`. A materialized action whose opportunity becomes `WON` or `LOST` is cancelled with `SUPERSEDED_OPPORTUNITY_CLOSED` before the API returns `REVENUE_ACTION_OPPORTUNITY_CLOSED`. Invalid transitions never perform CRM effects.

## Adapters and safety
- `COMMUNICATION_DRAFT` deterministically prepares an email subject/body from recorded CRM evidence. Missing contact, value, service, or location is omitted. It never sends email. Execution requires `MANUAL_CONFIRMED`, records that a user confirmed completion, and explicitly reports `external_send_performed: false`.
- `INTERNAL_TASK` creates one open CRM task or reuses only an open deal-intelligence task carrying matching structured source, action-type, and normalized semantic metadata. Display-title equality alone never authorizes task reuse. Execution then records a linked activity that truthfully says whether the task was created or reused.

Both adapters require explicit human approval. Phase 2 has no Gmail, SMS, autonomous communication, payment, contract, pricing, destructive, or bulk-action adapter.

## Idempotency and JSON recovery
Materialization reuses only an active action with the same opportunity, semantic action type, and basis fingerprint. The fingerprint includes stable execution-relevant recommendation semantics—action type, priority, title, reason, task title—and factual CRM basis, while excluding generated timestamps. Executed/rejected/cancelled history never permanently prevents later recommendations.

Execution persists `EXECUTING` and the approved execution mode before effects. Recovery requires prior approval and the expected mode. Every linked task/activity must match the action ID, opportunity ID, semantic action type, expected effect type, and valid record state; conflicting or extra linked effects return `REVENUE_ACTION_EFFECT_CONFLICT` and cannot complete the action.

`EXECUTING` and `FAILED` retries reconcile complete exact effects before current-intelligence staleness checks. For an internal `CREATE_TASK` action, completion requires the exact linked task, exact linked activity, and the intended `opportunity.next_action` mutation; recovery applies any missing intended mutation before finalizing. When only the action's exact task exists, the staleness comparison excludes that own partial effect while still detecting external opportunity changes, then creates the missing activity without duplicating the task. This is recovery-oriented idempotency, **not a transaction**: JSON collections cannot provide atomic multi-file commits or cross-process uniqueness.

## API
- `GET /api/revenue-actions?opportunity_id=:id`
- `GET /api/revenue-actions/:id`
- `POST /api/opportunities/:id/revenue-actions`
- `POST /api/revenue-actions/:id/{prepare,approve,reject,cancel,execute}`

Successful transitions return the action plus refreshed opportunity intelligence, pipeline metrics, and revenue intelligence. Revenue-action routes use stable structured errors for invalid JSON/body, not found, invalid transitions, conflicting linked effects, stale actions, closed opportunities, and persistence unavailability.
