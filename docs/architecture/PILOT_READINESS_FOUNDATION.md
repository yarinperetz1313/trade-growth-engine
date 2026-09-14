# Pilot Readiness Foundation

The Pilot production target is **Cloud Run + Cloud SQL PostgreSQL in australia-southeast2 (Melbourne)**, with Auth0 Australia (AU) for identity. This is a future-state contract, not evidence that infrastructure or production capabilities exist. Its completed implementation evidence lives in the [Pilot Readiness plan](../execution-plans/completed/pilot-readiness.md); release/provisioning proof lives in the [Pilot Production Gate](../operations/PILOT_PRODUCTION_GATE.md).

## Locked deployment and recovery baseline

| Topic | Contract |
| --- | --- |
| Runtime and data plane | Run the portable container on Cloud Run and Cloud SQL PostgreSQL in australia-southeast2 (Melbourne). Sydney is allowed only as a written, approved exception. The container must stay portable; it must not depend on a cloud-specific local filesystem or process topology. |
| Backup location and retention | Set an Australian **regional** Cloud SQL backup location explicitly; the provider default is not accepted. Retain **14 daily backups**. |
| Recovery objective | **RPO <= 24 hours** and **RTO <= 4 business hours**. Recovery is tested by restoring the full database into a temporary Australian instance, logically exporting the affected tenant, and restoring that export. This is not a claim of native tenant restore. |
| Operational ownership | The founder/operator owns the procedure now; the role, access, checklist, and evidence must be transferable before Pilot release. |

Google documents Cloud Run as regional and lists Melbourne as `australia-southeast2`; Cloud SQL documents selecting a regional backup location and configuring retained automated backups. Official sources: [Cloud Run locations](https://cloud.google.com/run/docs/locations) and [Cloud SQL PostgreSQL standard backups](https://cloud.google.com/sql/docs/postgres/backup-recovery/manage-standard-backups) — **verified 2026-08-30; reverify before provisioning**.

## Identity, authorization, and isolation

Auth0 Australia (AU) provides **identity** through New Universal Login and passwordless email OTP. The SPA uses Authorization Code Flow with PKCE. TGE remains the authorization authority. The server validates the exact issuer, audience, RS256/JWKS signature, expiry, issued-at time, and subject, then resolves `TenantContext` from server-side membership by `(issuer, subject)` and requires exactly one active result. It never accepts a client-supplied tenant ID as authority. The detailed boundary is [Authentication and TenantContext](AUTHENTICATION_AND_TENANT_CONTEXT.md).

The prior magic-link decision gate is resolved by GitHub Issue #5's accepted Pilot decision. Classic Login, magic links, cross-browser magic-link flags, Auth0 Organizations invitations, and public self-service signup are out of scope. Actual AU tenant/plan entitlement, custom domain, transactional SMTP, sender authentication, exact callback/logout/origin configuration, and the real OTP acceptance test remain deployment evidence under the [production gate](../operations/PILOT_PRODUCTION_GATE.md); they are not guessed in code.

| Role | Tenant authority |
| --- | --- |
| OWNER | Operate CRM and administer assisted invitations/membership behind a reauthentication/MFA-ready sensitive-action boundary. |
| ADMIN | Operate CRM and approved operational administration; cannot administer membership or assume ownership powers. |
| MEMBER | Perform ordinary CRM work; cannot administer tenant security or membership. |

Every production repository query is tenant-scoped. PostgreSQL RLS is applied transaction-locally, using the server-resolved tenant context. The runtime database role is nonprivileged. The server-only migration/operations role boundary is split: `tge_migrator` retains migration ownership authority, while distinct `tge_maintenance` credentials receive only database connection, `tge` schema usage, and the two targetless processors. Server authorization, RLS, and cross-tenant negative tests are all required: none substitutes for another.

## Persistence and revenue-action continuity

Local JSON remains compatible for local development and tests. **Supabase is not the production Pilot target.** Production persistence uses append-only migrations and a one-way, verified legacy JSON snapshot cutover; there is no dual write. The cutover must verify counts, identifiers, required relationships, unknown-data preservation, and rollback evidence before the legacy snapshot becomes read-only historical evidence.

RevenueAction semantics remain deterministic and manually approved: no automated external sending, no client-side bypass of approval, and no change to recommendation/evidence meaning. The PR-3 PostgreSQL adapter makes the related mutations transactional without changing those contracts; JSON remains the default local/test adapter.

### PR-2 PostgreSQL foundation

PR-2 implements the schema/security foundation without switching runtime persistence. Migration `001` remains unchanged and quarantined in `public`; migration `002` bootstraps the non-login owner/migrator/runtime roles before creating `tge` objects as `tge_owner`, and migration `003` plus later TGE object changes execute under that owner role. Unpublished migration `015` briefly returns to the migration login only to create/harden the cluster-wide `tge_maintenance` role and its database `CONNECT` grant, then restores `tge_owner` before every schema object, policy, and function change. The runner refuses to infer an applied `001` from pre-existing legacy objects; an audited baseline is required instead. Legacy operational identifiers remain text IDs in `(tenant_id, id)` keys. Tenant relationships use composite foreign keys with `RESTRICT`, and imported records retain raw payload, source timestamps, and source ordinal.

Forced RLS reads transaction-local `app.tenant_id`, `app.identity_issuer`, and `app.subject_id`. These custom settings are trusted server-only inputs set only after PR-4 validates identity and membership and the server bridges the branded auth context into a separately branded PR-3 persistence context; they are not accepted API fields. RLS is defense in depth and does not replace repository predicates or PR-4 authorization. The runtime role is non-bypass and receives no access to the legacy `public` tables, migrations, role/schema administration, truncation, or direct mutation/deletion of import and audit evidence.

## Import safety, retention, and deletion

The implemented PR-5A CSV staging/preview subset is specified in
[CSV import staging and preview](IMPORT_STAGING_PREVIEW.md). PR-5B's preview-only
analysis is specified in [deterministic import mapping and Data Health](IMPORT_MAPPING_DATA_HEALTH.md).
PR-5C's atomic commit and existing-ID-map reconciliation are specified in
[controlled canonical import commit](CANONICAL_IMPORT_COMMIT.md). PR-5D's
contract-mocked browser and adversarial evidence coverage is specified in the
[browser CSV import workflow](BROWSER_IMPORT_WORKFLOW.md). Assisted Pilot Safety
Gate V1 Slice 2 implements the separate raw-import expiry and tenant offboarding
contract below.

Imports are tenant-scoped and staged: CSV/XLSX upload → preview → explicit commit. Exact duplicates are skipped; ambiguous records require explicit user resolution; imports never merge into or overwrite existing CRM data implicitly. Every PR-2 ID-map row references its exact staging source and exactly one real tenant-owned prospect, opportunity, task, activity, or RevenueAction through a typed foreign key. Runtime may only select and insert batch, staging, ID-map, and audit evidence.

Assisted Pilot Safety Gate V1 Slice 3 adds the optional, exact per-opportunity
currency contract through append-only migration `016`, reviewed CSV mapping,
canonical commit/replay, repository/API boundaries, deterministic leak-value
classification, and browser presentation. Missing currency remains unknown and
there is no default or FX behavior. See
[Authoritative opportunity currency](AUTHORITATIVE_OPPORTUNITY_CURRENCY.md).

PR-5C adds only the narrow `PREVIEWED → COMMITTED` transition and row outcomes
needed for canonical commit through append-only migration `011`; runtime keeps
no unrestricted import `UPDATE` or `DELETE`. Migration `015` adds the exact
database-authored expiry, targetless cleanup, minimized evidence, and narrow
access/raw-evidence offboarding operations without broadening runtime authority.

Validate MIME type, file signature, file size, row count, sheet count, cell count, decompression expansion, and parser resource limits before preview or commit. Treat spreadsheet formula-like values as data: neutralize formula injection on export/display paths and never evaluate formulas as executable content.

Store audit events and import metadata for **12 months**. Raw staged evidence is
denied at an exact database-authored **7-day** deadline, defined as 168 elapsed
hours independent of session timezone or daylight-saving transitions, and then
physically scrubbed by retry-safe operations. Committed CRM data follows the tenant deletion
policy rather than raw retention. This slice preserves it; legal/contractual
approval is still required before any canonical tenant-data deletion.

Migration `015_raw_import_expiry_tenant_offboarding.sql` replaces every
runtime-supplied import creation, authorization, expiry, and metadata-retention
time with one database `clock_timestamp()`, an exact 168-elapsed-hour raw deadline, and
the existing twelve-month metadata horizon. At the deadline, forced RLS makes
staged raw rows unavailable to runtime preview, analysis, and canonical-commit
functions. Physical cleanup then moves through `PENDING`, `IN_PROGRESS`,
`SUCCEEDED`, or retryable `FAILED`. Tenant-authorized users can read the bounded
state at `GET /api/import-batches/:batchId/cleanup`.

PostgreSQL preview and analysis batch reads compute `rawCleanup.due` from the
same database clock expression as the dedicated cleanup status. Mapping code
preserves an absent due value as unknown instead of inventing `false`.

Only the distinct non-login `tge_maintenance` group can execute the targetless
cleanup processors. A maintenance login inherits that role directly and has no
membership or `SET ROLE` path to `tge_owner`, `tge_migrator`, or `tge_runtime`;
it receives database `CONNECT`, `tge` schema `USAGE`, and those two function
executions, but no TGE table or internal-function authority. The processors
accept a fixed result limit but no
tenant, batch, role, target, or clock, and claim database-selected work with
`FOR UPDATE SKIP LOCKED`. Cleanup removes staged raw payloads/conflict details,
source filename/storage location, and raw-derived batch metadata. It preserves
committed canonical CRM, ID-map reconciliation, audit history, Pilot evidence,
and the `COMMITTED` state. The runtime role receives no new direct import
`UPDATE` or `DELETE` grant.

Database trigger guards permit runtime staging inserts only while the parent
batch is `STAGED` or `PREVIEWED`, unexpired, and in writable cleanup state. They
reject expired, cleaned, committed, failed, and otherwise terminal/non-writable
batches even through the runtime's direct insert grant. Runtime batch and staging
inserts hold a shared tenant-row lock until transaction end. Offboarding takes
the conflicting tenant-row lock before discovering or scrubbing batches, so it
waits for already-authorized imports; an import that starts behind that lock sees
the terminal marker and fails. Consequently no raw evidence can commit after a
successful offboarding transaction or be reintroduced after cleanup.

Every runtime invitation insert crosses a database trigger that validates its
tenant and creator against trusted request context, revalidates the current
exact active OWNER through a no-target runtime function, and holds the same
shared tenant-row lock before the child insert. Invitation consumption also
takes a terminal-aware shared tenant lock before its invitation row lock or
membership activation. Offboarding's exclusive tenant lock therefore
serializes both paths, and direct SQL or residual invitation evidence cannot
recreate access after the terminal marker commits.

Tenant offboarding accepts exactly the confirmation
`OFFBOARD_ACCESS_AND_RAW_EVIDENCE`. Both server and database independently
require a trusted active OWNER; the server requires exact tenant, issuer, and
subject equality between its authorization and persistence contexts and additionally requires an injected
reauthentication/MFA-ready sensitive-action policy. Tenant, issuer, subject,
role, target, and request time come only from trusted context/database state.
ADMIN, MEMBER, forged, cross-tenant, and nonexistent cases use generic denial.

The request is idempotent. A separate targetless operations function atomically
scrubs outstanding raw imports, removes tenant invitation records, revokes database
memberships, and minimizes only the tenant `slug` and `name`. It preserves every
existing tenant `metadata` key and adds or replaces only
`metadata.offboarding_state` with `OFFBOARDED_ACCESS_REVOKED`. Crashes roll back; handled failures
are retryable. Success is deliberately `OFFBOARDED_ACCESS_REVOKED` with scope
`ACCESS_AND_RAW_EVIDENCE_ONLY`, not full tenant deletion. Canonical CRM and
required immutable evidence remain until an approved legal/contractual policy
authorizes anything broader.

Each handled cleanup/offboarding attempt appends immutable typed deletion
evidence retained for at least twelve months. It contains bounded counts,
SHA-256 resource references, stable states/failure codes, attempt numbers,
database times, retryability, and
`external_actions_performed: false`—never raw cells, uploaded content,
filenames, tokens, DSNs, contact details, or arbitrary customer payloads.
`npm run maintenance:cleanup` uses a separate
`TGE_MAINTENANCE_DATABASE_URL`, invokes both targetless processors with a fixed
bound without issuing `SET ROLE`, and prints aggregate states only. Scheduling, credential provisioning,
monitoring, alerting, production execution, and destructive provider actions
remain external gates.

## Configuration boundary

The environment contract names the public app URL, API URL, Auth0 domain/issuer/audience/callback/logout URLs, and operational service URLs. The explicit fail-closed bootstrap and its liveness/readiness limits are specified in [Secure Pilot Runtime](SECURE_PILOT_RUNTIME.md). Cloudflare Pages is the static-host recommendation only, pending the vendor/privacy gate. Before external invitations, provision and verify a real domain, Auth0 custom domain, custom transactional SMTP, SPF, DKIM, and DMARC; keep authentication and marketing sending reputations separate.

## Implementation checklist

- [x] PR-1 characterized the legacy JSON compatibility contract without production changes; see [Legacy JSON Compatibility Contract](LEGACY_JSON_COMPATIBILITY.md).
- [x] PR-2 schema/security and its real PostgreSQL 16.15 final gate are recorded in the [completed Pilot Readiness plan](../execution-plans/completed/pilot-readiness.md).
- [x] PR-3 supplies tenant-aware PostgreSQL repositories and transactional RevenueAction mutations while JSON remains the default local/test adapter.
- [x] PR-4 implements exact Auth0 token validation, membership-backed immutable `TenantContext`, centralized role policy, assisted invitation contracts, and a server-only bridge into PR-3 persistence. Real Auth0/email acceptance remains deployment-gated.
- [ ] Every production tenant operation has server authorization, RLS, and a negative cross-tenant test.
- [ ] Restore and tenant extraction runbooks are proven under the [production gate](../operations/PILOT_PRODUCTION_GATE.md).
