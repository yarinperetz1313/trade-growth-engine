# CSV import staging and preview

PR-5A implements only the CSV contract, parser limits, immutable staging, and
preview boundary from Issue #13. It does not map or validate destination fields,
produce Data Health, write canonical CRM records, reconcile IDs, commit an
import, delete retained evidence, or provide a browser flow. XLSX is deferred.

## HTTP contract

An authenticated `OWNER` or `ADMIN` may call:

- `POST /api/import-batches/preview`
- `GET /api/import-batches/:batchId/preview`

POST accepts exactly:

```json
{
  "sourceCollection": "prospects",
  "upload": {
    "filename": "export.csv",
    "mediaType": "text/csv",
    "contentBase64": "..."
  }
}
```

`sourceCollection` must be one of the five collections already admitted by the
PR-2 staging table: `prospects`, `opportunities`, `activities`, `tasks`, or
`revenue_actions`. It declares the source dataset type; it is not a PR-5B column
mapping or authority. Unknown request/upload fields are rejected, including
tenant, role, subject, filesystem path, and alternate-format inputs.

Filename and reported media type are bounded, inert metadata. Neither selects a
parser, tenant, storage path, or execution mode. The exact decoded bytes are
always parsed as UTF-8 CSV; ZIP/XLSX signature bytes, invalid UTF-8, NUL, and
malformed CSV fail before staging. Formula-like cells remain strings and are
never evaluated.

Tenant and role come from the membership-derived, branded auth `TenantContext`.
The separately branded persistence context supplies the same tenant to the PR-3
transaction. Both contexts must agree. `MEMBER` is denied. Cross-tenant and
nonexistent batch IDs both return `404 IMPORT_BATCH_UNAVAILABLE`.

If PostgreSQL does not acknowledge the staging transaction's `COMMIT`, POST
returns HTTP `500` with the existing outcome-unknown convention:

```json
{
  "ok": false,
  "error": "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
  "message": "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
  "details": { "attemptedId": "server-generated-batch-id" }
}
```

Only the server-generated attempted batch ID crosses this boundary; the
attempted result and raw cells do not. The authorized caller reconciles with
`GET /api/import-batches/:batchId/preview` before retrying. That read keeps the
same role, tenant-isolation, and generic `IMPORT_BATCH_UNAVAILABLE` behavior.

## Deterministic parser limits

| Resource | Limit |
| --- | ---: |
| Decoded CSV bytes | 262,144 |
| Data rows, excluding the header | 1,000 |
| Header columns | 64 |
| UTF-8 bytes per header | 256 |
| UTF-8 bytes per cell | 4,096 |
| Rectangular cells, including synthesized missing cells | 32,000 |
| Canonical serialized staging payload | 2,516,582 bytes |
| Canonical serialized 100-row preview payload | 917,504 bytes |
| Rows returned in a preview response | 100 |
| UTF-8 bytes per filename or reported media type | 255 |

Limits are inclusive. Exceeding a byte/row/column/cell limit returns a stable
parser error with HTTP `413`; malformed encoding, headers, shape, quoting, or
signature returns HTTP `400`. Rows wider than the header fail. Short rows are
accepted so an absent trailing cell remains `MISSING` rather than becoming an
explicit blank.

CSV syntax supports commas, CRLF/LF record endings, quoted commas/newlines, and
doubled quotes. An initial UTF-8 BOM is ignored for parsing but remains part of
the exact-file SHA-256.

## Immutable evidence

One request atomically inserts a batch directly as `PREVIEWED`, every staging
row as `PENDING`, and one `IMPORT_PREVIEW_CREATED` audit event. This uses the
existing runtime `SELECT`/`INSERT` grants; it adds no import `UPDATE`/`DELETE`
grant or lifecycle function.

- Batch `source_sha256` hashes the exact decoded upload bytes.
- The batch keeps ordered headers once. Each row keeps zero-based
  `source_ordinal`, source row number, column ordinals, exact decoded cell
  strings, and a SHA-256 over recursively key-sorted canonical JSON so the hash
  remains recomputable after a PostgreSQL JSONB round trip.
- Synthetic `source_id` and idempotency evidence identify the CSV row and are
  explicitly marked as staging locators, never business identity or tenant
  authority.
- Cell states remain distinct: `MISSING`, `BLANK`, `NULL`, `UNKNOWN`,
  `KNOWN_ZERO`, `NUMERIC`, and `NONNUMERIC`. Raw strings are never trimmed or
  coerced in evidence.
- Preview summary counts reconcile to all staged rows even though responses are
  capped at the first 100 source-ordered rows.
- Raw object storage is not added in PR-5A (`raw_storage_key` remains null).
  Staging metadata records the existing seven-day raw-evidence horizon and
  twelve-month metadata/audit horizon.

The transaction never accesses prospects, opportunities, tasks, activities, or
RevenueActions and records `external_action_performed: false`. Canonical commit,
duplicate/conflict resolution, ID maps, and controlled retention deletion remain
later Issue #13 slices.
