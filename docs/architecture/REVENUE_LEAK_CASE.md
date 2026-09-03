# RevenueLeakCase and stalled-opportunity detector

## Purpose and bounded scope

`RevenueLeakCase` is the durable commercial-case boundary between deterministic
leak evidence and later human-controlled recovery work. It is not an
opportunity, task, prediction, message, recovered-revenue claim, or replacement
for `RevenueAction`.

This boundary supports only `STALLED_OPPORTUNITY`. It includes one explicit,
per-opportunity detector invocation and the existing reconciliation contract.
It does not schedule detection, hook detection to imports, add a browser surface,
recover a quote, or calculate attribution.

## Detection contract

A reconciliation request contains:

- one canonical TGE opportunity source with observation time and version;
- detector ID and version, stable reason code, and `OBSERVED`, `DERIVED`, or
  `MIXED` evidence classification;
- a non-empty immutable JSON facts snapshot and explicit supersession condition;
- commercial value classified as `KNOWN`, `UNKNOWN`, or `NOT_APPLICABLE`;
- a semantic recommended-action type, without preparing or executing it.

Generated case time, ID, and actor are server-derived and excluded from semantic
identity. Unknown request fields, caller-authored tenant/lifecycle fields,
unsupported leak types, future source observations, non-JSON evidence, and
incoherent value data fail validation.

`KNOWN` value uses a lossless canonical decimal string within PostgreSQL
`NUMERIC(20,6)` and an uppercase three-letter currency. A known zero remains
explicitly known. `UNKNOWN` and `NOT_APPLICABLE` require both amount and currency
to be null, so neither can become a numeric zero. This foundation has no
recovered-value, influenced-value, outcome, or attribution field.

## Deterministic `STALLED_OPPORTUNITY` rule

Detector identity is `stalled-opportunity` version `1`. One invocation reads only
the tenant-visible canonical opportunity and its canonical activities and tasks.
PostgreSQL locks the opportunity before reading child evidence and reconciles in
the same trusted tenant transaction. JSON rejects non-local tenant contexts before
reading its tenantless local collections; it retains the documented single-process,
non-transactional adapter limitation.

The rule is deliberately conservative:

- recognized active stages are `NEW`, `QUALIFIED`, `CONTACTED`, `REPLIED`,
  `MEETING`, and `PROPOSAL`; `WON` and `LOST` are no-leak terminal stages;
- the meaningful-activity baseline is the latest canonical activity `created_at`,
  or the opportunity `created_at` when no activity exists;
- the opportunity is stale at or after exactly 14 elapsed 24-hour days from that
  baseline;
- a next action exists when `opportunity.next_action` is nonblank and is not one
  of `unknown`, `n/a`, `na`, or `not known`, or when a canonical task is `OPEN`
  or `IN_PROGRESS`;
- a case is detected only when an active-stage opportunity is stale and has no
  next action; the stable reason is `STALE_WITHOUT_NEXT_ACTION`;
- the newest canonical created/updated/completed observation across the
  opportunity, relevant activities, and relevant tasks must be no more than
  exactly 90 elapsed 24-hour days old. One millisecond older is stale source
  evidence. Canonical source timestamps may not be in the future.

The minimum evaluable evidence is a canonical opportunity ID, a recognized stage,
and a valid activity-or-opportunity-creation baseline. Supplied timestamps must be
valid and coherently ordered. Task/activity identity must be unique in the loaded
snapshot; task status and completion evidence must be coherent. Malformed supplied
next-action, timestamp, task/activity, stage, commercial-value, or currency evidence
is a Data Health suppression rather than a leak.

Evaluation has five disjoint outcomes with a closed version-1 reason-code set:

| Outcome | Reason codes |
| --- | --- |
| `ELIGIBLE_LEAK_DETECTED` | `STALE_WITHOUT_NEXT_ACTION` |
| `ELIGIBLE_NO_LEAK` | `OPPORTUNITY_CLOSED`, `RECENT_MEANINGFUL_ACTIVITY`, `NEXT_ACTION_PRESENT` |
| `INSUFFICIENT_EVIDENCE` | `OPPORTUNITY_STAGE_MISSING`, `MEANINGFUL_ACTIVITY_BASELINE_MISSING` |
| `STALE_OR_UNTRUSTWORTHY_SOURCE` | `CANONICAL_TIMESTAMP_IN_FUTURE`, `CANONICAL_SOURCE_TOO_OLD` |
| `DATA_HEALTH_SUPPRESSED` | `OPPORTUNITY_EVIDENCE_INVALID`, `OPPORTUNITY_STAGE_UNRECOGNIZED`, `CANONICAL_TIMESTAMP_INVALID`, `NEXT_ACTION_EVIDENCE_INVALID`, `TASK_STATUS_UNRECOGNIZED`, `TASK_EVIDENCE_INVALID`, `ACTIVITY_EVIDENCE_INVALID`, `COMMERCIAL_VALUE_INVALID`, `COMMERCIAL_CURRENCY_INVALID` |

When evidence has multiple defects, evaluation is deterministic: opportunity/stage
minimums precede collection shape, task/activity and timestamp health, next-action
and commercial health, future-source checks, baseline sufficiency, source age, then
closed/recent/next-action/leak eligibility.

The source version hashes only normalized, conclusion-relevant canonical evidence.
Collection order is normalized before deriving that evidence; historical labels
or due dates that cannot affect the conclusion are excluded. Evaluation and
case-generation times are also excluded. A detected replay therefore retains the
same semantic identity as time passes; a materially changed canonical snapshot
follows foundation supersession. Non-leak, insufficient, stale-source, and Data
Health outcomes do not mutate historical cases.

Potential value is not recovered revenue. `KNOWN` requires a non-negative lossless
`NUMERIC(20,6)`-representable opportunity value and a three-letter opportunity
currency. Known zero remains `KNOWN` zero. Missing, null, blank, recognized-unknown
value evidence—or a valid amount without currency—remains `UNKNOWN`. Malformed or
unrepresentable supplied value/currency evidence suppresses detection. The detector
never uses opportunity probability or invents expected revenue.

## Identity and reconciliation

`series_key` hashes the leak type, canonical source, and detector identity.
`evidence_fingerprint` hashes the canonical evidence snapshot. `semantic_key`
adds detector version, reason, evidence fingerprint, commercial value,
recommendation, due time, and supersession condition.

PostgreSQL takes a transaction-scoped advisory lock for the tenant and series,
and both adapters apply these rules:

1. The same active semantic identity returns the existing case.
2. With no active case, replaying the latest terminal semantic identity returns
   that terminal history and does not silently reopen it.
3. Materially changed evidence creates a new `OPEN` case. An active predecessor
   becomes `SUPERSEDED`, points to the replacement, and retains its original
   evidence. A terminal predecessor remains terminal and is referenced only by
   the new case's `supersedes_case_id`.

There is at most one active (`OPEN` or `SNOOZED`) case in a tenant/source/detector
series. Generated timestamps never change semantic identity.

## Lifecycle and audit

The deliberately small lifecycle is:

- `OPEN -> SNOOZED -> OPEN`, with a future wake time and a human reason for both
  snooze and resume;
- `OPEN|SNOOZED -> DISMISSED`, with a human reason;
- `OPEN|SNOOZED -> SUPERSEDED`, performed only by deterministic reconciliation
  when canonical evidence changes.

Each mutation appends one actor/time/reason audit entry. Detection fields,
evidence, economics, identity, predecessor linkage, and creation time are
immutable. `DISMISSED` and `SUPERSEDED` are terminal. Runtime cannot delete case
rows, rewrite audit prefixes, mutate evidence, or smuggle multiple transitions
through one update.

## RevenueAction relationship

An active case may be linked once to an existing RevenueAction for the same
tenant and opportunity. Replaying the same link is idempotent; relinking to a
different action is rejected. The case snapshots the action's immutable
`basis_fingerprint` and current lifecycle status at link time. PostgreSQL checks
those snapshot values against the referenced row and enforces a composite
same-tenant/same-opportunity foreign key.

Linking does not materialize, prepare, approve, reject, cancel, execute, recover,
or attribute the RevenueAction. All task/activity effects and human-controlled
external-action rules remain exclusively in the existing RevenueAction domain.

## Tenant and adapter boundaries

Every service, repository, and HTTP operation requires a branded server-created
persistence `TenantContext`. Missing and cross-tenant case IDs share the same
not-found response; unavailable source/action relationships are likewise
non-oracular.

PostgreSQL combines explicit tenant predicates, transaction-local context,
forced RLS, composite foreign keys, partial unique indexes, and runtime history
triggers. RLS supplements membership authorization; request fields never select
a tenant.

Local JSON remains the default development/test adapter. Its new
`revenue_leak_cases.json` collection stores tenant-tagged case records and accepts
only the fixed server-created local tenant context. Existing tenantless local CRM
collections are unchanged; local JSON remains single-process and
non-transactional, while reconciliation writes its case-history changes in one
collection replacement.

## API

- `GET /api/revenue-leak-cases`
- `GET /api/revenue-leak-cases/:id`
- `POST /api/revenue-leak-cases/reconcile`
- `POST /api/opportunities/:id/revenue-leak-cases/detect-stalled`
- `POST /api/revenue-leak-cases/:id/{snooze,resume,dismiss}`
- `POST /api/revenue-leak-cases/:id/link-revenue-action`

The detector endpoint accepts only an empty object, derives time and evidence on
the server, and returns one of the five outcomes. Only a detected outcome enters
the existing reconciliation path. Neither endpoint schedules work or executes an
external action.
