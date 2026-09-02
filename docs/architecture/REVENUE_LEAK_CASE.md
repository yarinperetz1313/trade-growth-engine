# RevenueLeakCase foundation

## Purpose and bounded scope

`RevenueLeakCase` is the durable commercial-case boundary between deterministic
leak evidence and later human-controlled recovery work. It is not an
opportunity, task, prediction, message, recovered-revenue claim, or replacement
for `RevenueAction`.

This foundation supports only `STALLED_OPPORTUNITY`. It provides a contract and
reconciliation boundary; it does not run a detector, schedule detection after
imports, add a browser surface, recover a quote, or calculate attribution.

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
- `POST /api/revenue-leak-cases/:id/{snooze,resume,dismiss}`
- `POST /api/revenue-leak-cases/:id/link-revenue-action`

The reconciliation endpoint is the bounded ingestion seam for future
deterministic detector output; its presence is not evidence that a detector or
scheduler exists.
