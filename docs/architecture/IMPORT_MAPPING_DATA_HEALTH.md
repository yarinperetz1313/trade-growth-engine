# Deterministic import mapping and Data Health

PR-5B adds preview-only mapping, validation, and Data Health analysis over the
immutable CSV staging evidence established by PR-5A. It does not itself accept
or persist mappings, mutate import lifecycle state, reconcile source IDs, or
read or write canonical CRM records. PR-5C's separate
[controlled canonical import commit](CANONICAL_IMPORT_COMMIT.md) consumes an
explicit reviewed selection request and rebuilds this validation from locked
staging evidence. Browser UI remains with PR-5D.

## HTTP contract

An authenticated `OWNER` or `ADMIN` may call:

- `POST /api/import-batches/:batchId/analysis`

The body is either `{}` for deterministic proposals or contains only a
`selections` array and/or one `sourceIdentitySelection`. Each target selection
names a supported target field, an exact source header or `null`, and one
selected type: `TEXT`, `NUMBER`, `TIMESTAMP`, or `STATUS`. The separate source
identity selection names an exact source header or `null`; it is never the
canonical target ID or the synthetic staging-row locator. Selections affect
only that response. Every supported mapping proposal remains `DRAFT`,
`authoritative: false`, and `accepted: false`; unsupported staged targets
return `UNSUPPORTED_TARGET` and remain unaccepted.

The service reuses the PR-5A operational-admin permission, independently
branded tenant contexts, generic `IMPORT_BATCH_UNAVAILABLE` response, and
tenant transaction boundary. Cross-tenant and nonexistent IDs are
indistinguishable. Invalid selections return
`IMPORT_MAPPING_SELECTION_INVALID`; no raw evidence is added to the normalized
error response.

## Deterministic mapping

Supported targets mirror the existing PostgreSQL mapper inputs for
`prospects`, `opportunities`, `tasks`, and `activities`. Staged
`revenue_actions` are explicitly unsupported in PR-5B.

For each target field, mapping checks a case-normalized exact canonical field
name first, then its declared alias list in order. Alias comparison normalizes
separator punctuation only. It performs no fuzzy matching and invokes no AI.
Multiple matches at the same precedence or reuse of one source column are
explicit conflicts, never silent winners.

Every field response includes the source column and ordinal, target field,
bounded raw sample values with source ordinal/row, inferred/declared/selected
type, required/optional metadata, non-authoritative suggestion state, and
bounded validation issues. Unmapped source columns and target fields remain
explicit.

Source identity is proposed and reviewable as a separate mapping role. It uses
exact `source_id` first, then ordered aliases, and may reuse the same raw column
as canonical target `id` because those are distinct roles. Its coverage and
duplicate checks always read the selected raw cell evidence, never
`import_staging_records.source_id`, whose PR-5A value is only a synthetic row
locator. `inferredType` describes the source samples independently;
`declaredType` continues to describe the canonical target field.

## Validation and evidence

Row validation reads source-ordered staging records and returns at most 100 row
samples. Each sampled row retains its exact raw payload, hash, source ordinal,
and source row number. Issues reference the target/source field and exact cell
evidence: column ordinal, presence, raw value, and parser value kind.

The analysis preserves `MISSING`, `BLANK`, `NULL`, `UNKNOWN`, `KNOWN_ZERO`,
`NUMERIC`, and `NONNUMERIC`. It flags required-value, strict calendar-valid
timestamp, exact-row, source-ID, and nonnumeric/unknown conditions without
coercing source evidence. It also enforces nonblank required values,
non-negative numeric commercial value, the canonical probability range, and
task status/completion-timestamp consistency. Every parser-recognized mapped
numeric is also checked losslessly against PostgreSQL `numeric`'s integer-digit
and fractional-scale limits; literals that PostgreSQL would overflow or round
are blocking row errors before canonical SQL. Known zero remains valid numeric
evidence, including probability zero. A draft `selectedType` cannot bypass the
separately declared canonical target type or its validation constraints.

## Data Health reconciliation

Unlike the bounded row and field samples, metrics scan every staged row. The
response reports total and valid rows, rows with blocking errors,
duplicate/conflict count, commercially important missing counts,
unknown/unmapped fields and columns, timestamp coverage, source-ID coverage,
and prospect contactability across email, phone, or website. Percentages are
deterministic and rounded to two decimal places. Analysis fails closed when the
batch preview summary's `rowCount` differs from the fetched source-ordered
staging records, so a partial staged set cannot be reported as full Data Health.

Analysis uses only `SELECT` on `import_batches` and
`import_staging_records`. It adds no migration, grant, lifecycle mutation,
canonical access, external action, or persisted mapping state.
