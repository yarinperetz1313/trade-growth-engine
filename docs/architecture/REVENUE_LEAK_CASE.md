# RevenueLeakCase and stalled-opportunity detector

## Purpose and bounded scope

`RevenueLeakCase` is the durable commercial-case boundary between deterministic
leak evidence and later human-controlled recovery work. It is not an
opportunity, task, prediction, message, recovered-revenue claim, or replacement
for `RevenueAction`.

This boundary supports only `STALLED_OPPORTUNITY`. It includes explicit
per-opportunity and bounded tenant-portfolio detector invocations, the existing
reconciliation contract, a deterministic active-case operating-queue read
model, and an explicit browser consumer in the Opportunity Command Center. It
does not schedule detection, hook detection to imports, recover a quote, or
calculate attribution.

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
Collection order is normalized before deriving that evidence; activity display
labels or task due dates that cannot affect the conclusion are excluded.
Evaluation and case-generation times are also excluded. A detected replay retains the
same semantic identity as time passes; a materially changed canonical snapshot
follows foundation supersession. Non-leak, insufficient, stale-source, and Data
Health outcomes do not mutate historical cases.

Potential value is not recovered revenue. `KNOWN` requires a non-negative lossless
`NUMERIC(20,6)`-representable opportunity value and a three-letter opportunity
currency. Known zero remains `KNOWN` zero. Missing, null, blank, recognized-unknown
value evidence—or a valid amount without currency—remains `UNKNOWN`. Malformed or
unrepresentable supplied value/currency evidence suppresses detection. The detector
never uses opportunity probability or invents expected revenue.

## Explicit tenant-portfolio scan

An authenticated user may explicitly invoke one tenant-wide
`STALLED_OPPORTUNITY` scan. The command accepts no fields or query parameters,
derives one evaluation timestamp on the server, and admits at most **100**
tenant-visible canonical opportunities. It is never scheduled and is not called
by import staging, analysis, or commit.

PostgreSQL obtains the exact tenant candidate count and the stable ID-ordered
bounded candidate set in one statement, locks the admitted opportunity rows in
that order, and evaluates and reconciles them in the same trusted tenant
transaction. Every query retains an explicit tenant predicate in addition to
forced RLS. Existing per-series advisory locking remains the reconciliation
concurrency authority. A concurrent identical scan therefore creates at most
one case per semantic identity and reports the other as a replay; changed
detected evidence follows existing supersession.

JSON sorts its local opportunity collection by stable ID, rejects any non-local
tenant context, evaluates all admitted evidence, and applies all detected
reconciliations through one case-collection replacement. This narrows local
partial-write risk but does not turn JSON files into transactional or
cross-process persistence; the documented local-only, single-process limit
remains.

An over-cap portfolio is rejected before evaluation or case mutation with
`REVENUE_LEAK_SCAN_LIMIT_EXCEEDED`. The response declares `complete: false`, the
100-record limit, exact total/overflow/unevaluated counts, and zero evaluated,
invalid, and excluded records. Missing, duplicate, whitespace-padded, or
over-512-byte canonical opportunity IDs, an incomplete repository set, or invalid
enumeration truth similarly fail before mutation as
`REVENUE_LEAK_SCAN_SOURCE_INVALID`; identity is preserved exactly rather than
trimmed during admission, unaddressable records are counted as invalid, and every
candidate is counted as unevaluated. Detector-level malformed evidence is not
silently excluded: it is evaluated as the existing
`DATA_HEALTH_SUPPRESSED` outcome and summarized by its closed version-1 reason.

A successful response is complete and includes one bounded result per canonical
opportunity in ID order. Each result exposes only opportunity ID, outcome, stable
reason, reconciliation disposition (`READ_ONLY`, `CREATED`, `REPLAYED`, or
`SUPERSEDED`), case ID when detected, and predecessor ID when superseding. The
summary retains all five outcome classes and reason counts, plus detected,
created, replayed, and superseded counts. Closed opportunities are evaluated as
no-leak; no record is excluded. Non-detected outcomes never reconcile or mutate a
case. An unexpected or transaction-unknown failure never returns a successful
`complete: true` envelope.

## Active operating queue projection

The read-only operating queue projects only tenant-visible `OPEN` and `SNOOZED`
RevenueLeakCases. It is capped at **100 active cases**. The repository returns an
exact active-case count; over-cap state returns
`REVENUE_LEAK_QUEUE_LIMIT_EXCEEDED` with `complete: false`, total, projected-zero,
and omitted counts instead of truncating. A count/context mismatch or incoherent
joined identity returns `REVENUE_LEAK_QUEUE_INTEGRITY_CONFLICT`. Neither failure
is presented as a partial queue.

Each entry exposes bounded case identity, leak type, lifecycle state, stable
reason, detector identity/version, immutable source facts and evidence snapshot,
recommended action type, canonical opportunity/business identity when present,
and no contact fields. Potential value retains the case's exact `KNOWN`,
`UNKNOWN`, or `NOT_APPLICABLE` classification and adds a display/sort kind that
distinguishes `KNOWN_POSITIVE` from `KNOWN_ZERO`. Linked RevenueAction context is
limited to its ID, link-time fingerprint/status/time snapshot, and current status
when the exact same-tenant, same-opportunity, same-fingerprint row is safely
available. Status evolution does not rewrite the link-time snapshot or transfer
execution ownership to the case.

Portfolio value aggregates count known-positive, known-zero, unknown, and
not-applicable cases separately. Exact known-positive decimal amounts are summed
only inside three-letter currency groups. Known-zero counts are also grouped by
currency. There is no cross-currency total, exchange rate, probability, expected
value, recovered revenue, influenced revenue, or attribution.

Leak age is derived only from `detected_at` and the server projection time.
Urgency is derived only from recorded `due_at`, lifecycle state, and
`snoozed_until`. Ordering is deterministic and published in every response:

1. urgency tier: overdue, snooze wake due, open with no overdue deadline, then
   snoozed until a future time;
2. value-evidence tier: known positive, known zero, unknown, then not applicable;
3. for known-positive entries, alphabetical currency grouping and amount
   descending only within the same currency (amounts in different currencies are
   never compared);
4. older leak age first; and
5. case ID ascending as the stable final tie-breaker.

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

The explicit case handoff composes two existing authorities: current
RevenueAction materialization followed by that immutable link. Before an
unlinked handoff, the service re-evaluates current canonical opportunity,
activity, and task truth and requires the resulting case semantic key to match
the stored case. Detector version 1's `STALLED_OPPORTUNITY`/`FOLLOW_UP` recovery
intent has one closed compatibility mapping to deal intelligence's current
`CREATE_TASK` recommendation because the detector's authoritative condition is
an absent next action. Any other stale or incompatible recommendation fails
before linkage. A linked case instead reconciles the exact action ID,
opportunity, type, fingerprint, and durable status and returns it as a replay.

PostgreSQL performs validation, action materialization/reuse, and linkage in one
tenant transaction while locking the current case and opportunity evidence. A
concurrent or repeated request therefore returns the same relationship, and a
failure after materialization rolls the transaction back. JSON has no
cross-collection transaction: it materializes through the existing local
RevenueAction authority and then links the case. If the first write commits and
the response or link is lost, an explicit retry reuses the same active semantic
RevenueAction and repairs the link; it does not duplicate the action. This is a
recovery guarantee, not a multi-file atomicity or concurrent-writer guarantee.

Neither direct linkage nor the composed handoff prepares, approves, rejects,
cancels, executes, recovers revenue, or attributes the RevenueAction. All
task/activity effects and human-controlled external-action rules remain
exclusively in the existing RevenueAction domain.

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

## Browser experience

Revenue Command Center V2 makes the complete bounded active-case operating queue
the primary portfolio surface. It validates the queue envelope and deterministic
ordering before rendering, preserves server order, groups known totals only by
currency, keeps known zero/unknown/not-applicable distinct, and filters only
published lifecycle, value-kind, and source fields. It shows leak age, urgency,
canonical opportunity/business identity when available, linked RevenueAction
state, and the exact immutable “why TGE surfaced this” evidence. Missing context,
empty results, incomplete/integrity/limit failures, authorization, persistence,
generic API failures, and stale validated results remain distinct states.

The portfolio can explicitly scan and can request the composed case handoff, but
after any unconfirmed mutation it reloads the strict durable queue before write
controls re-enable and never repeats the POST automatically. A confirmed link
continues into Opportunity Command Center. That detailed surface remains the
authorized-user surface for one explicit stalled-opportunity check and API-backed
case history. It keeps all five detector
outcomes distinct, explains the stable reason code, and shows only the immutable
why-now facts, source observation/version, and commercial classification returned
by this contract. Known positive, known zero, unknown, and not-applicable values
are labelled as potential revenue at risk; none is a recovery claim.

The browser offers snooze, resume, and dismiss only for server-permitted states,
requires a human reason, and supplies a future wake time for snooze. It can link
one existing same-opportunity RevenueAction and navigate to the existing execution
panel, but it does not materialize, prepare, approve, or execute an action from the
case lifecycle. Refresh and hash-route revisit reload durable case history through
the API rather than browser storage.

Before rendering successful detector or case-history responses, the browser
fails closed on malformed versioned evidence, future or contradictory source and
detection timestamps, source age beyond the declared 90-day eligibility window,
and audit entries that do not reproduce the bounded lifecycle in chronological
order. A `RECENT_MEANINGFUL_ACTIVITY` result is valid only before the exact stalled
boundary; `NEXT_ACTION_PRESENT` is valid only at or after it. Detector response
receipt time, or durable case detection time when present, supplies that evaluation
boundary to browser validation.

Opportunity identity plus route/request generation prevents late intelligence or
RevenueAction mutations, detector responses, and history or action-list loads from
a prior hash route from applying returned opportunity state or invoking the parent
opportunity-update callback. If a snooze, resume, dismiss, or link write has an
unconfirmed outcome because its response was lost, malformed, HTTP 408, server-side,
or explicitly outcome-unknown, the browser reloads authoritative case history while
write controls remain locked. It never automatically retries those mutations.

## API

- `GET /api/revenue-leak-cases`
- `GET /api/revenue-leak-cases/:id`
- `POST /api/revenue-leak-cases/reconcile`
- `POST /api/opportunities/:id/revenue-leak-cases/detect-stalled`
- `POST /api/revenue-leak-cases/scan-stalled-opportunities`
- `GET /api/revenue-leak-cases/operating-queue`
- `POST /api/revenue-leak-cases/:id/revenue-action`
- `POST /api/revenue-leak-cases/:id/{snooze,resume,dismiss}`
- `POST /api/revenue-leak-cases/:id/link-revenue-action`

The detector endpoint accepts only an empty object, derives time and evidence on
the server, and returns one of the five outcomes. Only a detected outcome enters
the existing reconciliation path. Neither endpoint schedules work or executes an
external action.

The portfolio scan likewise accepts only an empty object and no query parameters.
The operating queue accepts no query parameters and performs no writes. Both use
the same authenticated, server-derived `TenantContext` boundary as the existing
case APIs.

The composed RevenueAction handoff also accepts only an empty object and no query
parameters. It returns `201` only when it creates the RevenueAction and `200` for
durable reuse/replay, with explicit action/link/reconciliation flags. Missing and
cross-tenant identities remain the same non-oracular not-found response.
