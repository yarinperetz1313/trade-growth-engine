# Deterministic import mapping and Data Health

PR-5B adds preview-only mapping, validation, and Data Health analysis over the
immutable CSV staging evidence established by PR-5A. It does not accept or
persist mappings, mutate import lifecycle state, reconcile source IDs, or read
or write canonical CRM records. Those boundaries remain with PR-5C. Browser UI
remains with PR-5D.

## HTTP contract

An authenticated `OWNER` or `ADMIN` may call:

- `POST /api/import-batches/:batchId/analysis`

The body is either `{}` for deterministic proposals or contains only a
`selections` array. Each selection names a supported target field, an exact
source header or `null`, and one selected type: `TEXT`, `NUMBER`, `TIMESTAMP`,
or `STATUS`. Selections affect only that response. Every supported mapping
proposal remains `DRAFT`, `authoritative: false`, and `accepted: false`;
unsupported staged targets return `UNSUPPORTED_TARGET` and remain unaccepted.

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

## Validation and evidence

Row validation reads source-ordered staging records and returns at most 100 row
samples. Each sampled row retains its exact raw payload, hash, source ordinal,
and source row number. Issues reference the target/source field and exact cell
evidence: column ordinal, presence, raw value, and parser value kind.

The analysis preserves `MISSING`, `BLANK`, `NULL`, `UNKNOWN`, `KNOWN_ZERO`,
`NUMERIC`, and `NONNUMERIC`. It flags required-value, timestamp, exact-row,
source-ID, and nonnumeric/unknown conditions without coercing source evidence.
Known zero remains valid numeric evidence.

## Data Health reconciliation

Unlike the bounded row and field samples, metrics scan every staged row. The
response reports total and valid rows, rows with blocking errors,
duplicate/conflict count, commercially important missing counts,
unknown/unmapped fields and columns, timestamp coverage, source-ID coverage,
and prospect contactability across email, phone, or website. Percentages are
deterministic and rounded to two decimal places.

Analysis uses only `SELECT` on `import_batches` and
`import_staging_records`. It adds no migration, grant, lifecycle mutation,
canonical access, external action, or persisted mapping state.
