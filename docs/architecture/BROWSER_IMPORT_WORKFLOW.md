# Browser CSV import workflow

PR-5D adds the browser workflow over the existing PR-5A staging/preview,
PR-5B deterministic mapping/Data Health, and PR-5C canonical commit HTTP
contracts. It adds no browser authority and no new persistence behavior.

## Workflow and contract seam

An authenticated operator navigates to `#imports` and completes:

1. select a supported source collection and local CSV file;
2. create the immutable staged preview;
3. inspect exact bounded raw-cell evidence;
4. request deterministic draft mapping and all-row Data Health;
5. change mappings and recalculate Data Health when needed;
6. explicitly confirm the reviewed mapping, source system, and health result;
7. commit through the existing canonical endpoint; and
8. inspect committed, conflicted, validation-failed, or reconciled evidence.

The browser sends only the existing bounded request shapes. It never supplies
tenant, subject, role, canonical outcomes, fingerprints, or timestamps as
authority. Mapping suggestions remain visibly draft and non-authoritative until
the operator sends the explicit reviewed selection vector during commit.

Managed Playwright uses contract-mocked import endpoints for this UI slice.
The existing PostgreSQL integration/database/CI suites remain authoritative for
authentication, membership authorization, tenant isolation, transaction
atomicity, canonical persistence, idempotent retry, reconciliation, and audit
behavior. PR-5D does not add a second full-stack PostgreSQL/Auth0 browser stack.

## Evidence and states

The preview presents raw values alongside `MISSING`, `BLANK`, `NULL`,
`UNKNOWN`, `KNOWN_ZERO`, `NUMERIC`, and `NONNUMERIC` kinds. Missing and blank
use explanatory labels only for presentation; the API evidence is neither
trimmed nor rewritten. Known zero is not presented as unknown, and unknown or
nonnumeric evidence is not presented as zero.

The workflow distinguishes loading, zero-row empty, general error,
unauthorized, canonical conflict, outcome-unknown retry/reconciliation, and
success states. An unacknowledged preview or commit is reconciled through its
existing GET endpoint before a repeated POST. A repeated commit retains the
same reviewed payload and browser-generated idempotency key. After GET confirms
absence with `404`, a repeated POST that returns a definitive client error
leaves outcome-unknown recovery and returns to the corresponding upload or
confirmation error state; stale reconciliation controls are not retained.

Successful preview envelopes reconcile aggregate value-kind counts against the
exact returned cells. Successful analysis envelopes reconcile their returned
rows with the accepted preview evidence and derive provable Data Health
constraints for valid/blocking rows, duplicate conflicts, missing and unknown
values, source identity, timestamps, and contactability. Exact equality is
required when all rows or the preview aggregate provide complete evidence;
responses capped at 100 rows are checked against the tight bounds supported by
that sample. The browser also requires the complete ordered canonical field
vector for the declared collection, including each declared type and
required/optional state; the exact unmapped-source complement; the
collection-specific commercially important missing-count keys; and prospect-only
contactability over exactly email, phone, and website. Omitted, invented, or
contradictory success evidence fails closed before review or confirmation.
Explicitly unsupported `revenue_actions` retain their contract-defined
preview-only analysis shape and cannot be presented as a supported draft.

## Explicit deferral

Raw-evidence retention/deletion acceptance and its implementation are
**DEFERRED to a separate reviewed follow-up**. PR-5D does not prove seven-day
deletion, create a deletion lifecycle, change PostgreSQL grants, or claim that
the production retention gate is complete. XLSX, connectors, generic ETL,
JSON cutover, and full-stack external-provider browser acceptance also remain
outside this slice.
