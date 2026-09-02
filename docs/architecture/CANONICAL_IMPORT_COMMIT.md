# Controlled canonical import commit

PR-5C adds the explicit, PostgreSQL-only commit boundary for reviewed PR-5B
mapping selections. It writes canonical `prospects`, `opportunities`, `tasks`,
or `activities`; reconciles source identity through `tge.import_id_map`; records
truthful row and audit outcomes; and transitions exactly one batch from
`PREVIEWED` to `COMMITTED` in one tenant transaction. RevenueActions, retention
deletion, XLSX, connectors, and JSON cutover remain out of scope. PR-5D now
drives this endpoint through the separate
[browser CSV import workflow](BROWSER_IMPORT_WORKFLOW.md).

## HTTP contract

An authenticated `OWNER` or `ADMIN` may call:

- `POST /api/import-batches/:batchId/commit`
- `GET /api/import-batches/:batchId/commit`

POST accepts exactly a bounded source-system namespace, an idempotency key, the
reviewed source-identity column, and reviewed canonical selections:

```json
{
  "sourceSystem": "pilot-crm",
  "idempotencyKey": "operator-attempt-1",
  "sourceIdentitySelection": { "sourceColumn": "external_id" },
  "selections": [
    { "targetField": "id", "sourceColumn": "record_id", "selectedType": "TEXT" },
    { "targetField": "business_name", "sourceColumn": "company", "selectedType": "TEXT" }
  ]
}
```

Tenant, subject, role, canonical records, outcome counts, fingerprints, and
timestamps are never accepted as caller authority. The service rebuilds the
mapping and row validation from every locked immutable staging record; the
PR-5B response sample limit is not a commit-validation limit. Omitted
fields are explicitly unmapped; draft automatic suggestions are not silently
accepted. Cross-tenant and nonexistent batches remain the same generic `404`.

GET returns a committed result for acknowledgement-loss reconciliation. POST
with the same idempotency key and materially identical reviewed request returns
the stored result without another canonical row, ID map, outcome transition, or
audit event. Selection array order is not material. Reusing the key with a
materially different request, or retrying a committed batch with a different
key, returns a deterministic conflict.

Fingerprints cover the complete server-normalized target vector, so an omitted
optional selection and the same explicit `sourceColumn: null` selection are the
same reviewed request. Supplied target fields outside that vector remain in the
input fingerprint instead of being discarded. They cannot reconcile against a
committed valid request and return the same bounded already-committed conflict
as any other materially changed replay.

## Atomicity and identity

The public repository opens one tenant transaction, locks the batch and all
staged rows through narrow security-definer functions, and rebuilds the commit
plan before any canonical write. Sorted tenant/source and tenant/target
advisory locks serialize different batches that race on the same identity.
Migration `011_canonical_import_commit.sql` extends the existing ID map with:

- bounded `source_system` and exact `source_record_id`;
- canonical payload SHA-256 and commit idempotency key; and
- partial tenant-global uniqueness for source identity and each supported
  typed canonical target.

Parser-classified unknown identity literals (`unknown`, `n/a`, `na`, and
`not known`, including case and outer-space variants) are unavailable
identities, never tenant-global source IDs. Prospect dedupe keys join the
deterministic advisory-lock order. Canonical and ID-map inserts also run behind
a transaction savepoint so PostgreSQL uniqueness/TOCTOU races become bounded
import conflicts without retaining any earlier row from the attempt.

Within a batch, the first source-ordered row is materialized. Only a repeat with
the same source identity, exact raw cells, and canonical payload is
`EXACT_DUPLICATE`; different raw evidence or canonical payload is a conflict.
Across batches, an existing source map reconciles only when its payload
fingerprint and typed target ID match. An unmapped existing canonical ID,
missing canonical relationship, mismatched map, or one target requested by
multiple source identities blocks the whole commit. No existing CRM record is
merged or overwritten. Blank optional relationship evidence materializes as an
absent canonical relationship, while its exact blank cell remains in immutable
staging evidence. Canonical FK violations that still occur during a
materialization race are savepoint-normalized to bounded relationship conflicts;
raw PostgreSQL `23503` details never form the import outcome.

## Lifecycle, evidence, and outcomes

Runtime retains no broad `UPDATE` or `DELETE` grant on import tables. Migration
`011` exposes only narrow batch/row locks, row outcome recording, failed or
conflicted attempt recording, and `PREVIEWED → COMMITTED` finalization.
Finalization verifies row counts, legal dispositions, and authoritative ID-map
evidence before changing the batch status.

Commit attempts against `STAGED`, `READY`, `FAILED`, or `EXPIRED` batches do
not broaden lifecycle transitions. They retain their status, store a bounded
conflict summary through a narrow security-definer function, and append one
`IMPORT_COMMIT_CONFLICTED` event without raw cells. A mismatched attempt against
an already committed batch appends bounded evidence without rewriting the
committed summary or timestamp.

Successful results report `committed`, `skipped`, `conflicted`, and `failed`
counts that reconcile to every staged row. Conflicted or validation-failed
attempts keep the batch `PREVIEWED`, keep staging rows `PENDING`, write no
canonical record or ID map, and append a bounded audit event. Audit payloads
contain identities, hashes, and outcome codes—not copied raw cell values.
Database or injected failures roll back canonical rows, maps, row outcomes,
audit events, and lifecycle mutation together.

Exact staged `raw_payload` and its hash are never rewritten. Decimal
classification and range checks avoid JavaScript `Number` conversion before
fingerprinting and persistence. Migration `011` constrains the five canonical
commercial numeric columns to `NUMERIC(20,6)` after a fail-closed preflight that
refuses lossy existing values. Exact accepted strings, including the maximum
`99999999999999.999999`, are retained in canonical import metadata and survive
repository readback and ordinary unrelated updates. Values with more than 14
integer digits or more than six effective fractional digits fail as bounded row
validation before canonical SQL; their exact cells remain staged. Stored import
provenance is preserved during metadata patches, while numeric evidence is
retired only when its logical field value changes.

Known numeric zero stays numeric zero, every parser-recognized unknown literal
becomes canonical `unknown`, and missing, blank, null, unknown, and nonnumeric
states are never invented as zero. Unrepresentable optional unknown values
remain in immutable staging evidence rather than being invented in canonical
columns.

Migration 011 checks and security-definer functions reject missing hashes,
outcomes, and request/input fingerprints explicitly; PostgreSQL `NULL` cannot
pass these boundaries through three-valued logic.

If PostgreSQL does not acknowledge `COMMIT`, the API returns
`POSTGRES_TRANSACTION_OUTCOME_UNKNOWN` with only the batch ID. The caller must
use GET reconciliation before deciding whether another POST is appropriate.
