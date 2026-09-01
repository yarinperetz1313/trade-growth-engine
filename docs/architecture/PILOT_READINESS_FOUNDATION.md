# Pilot Readiness Foundation

The Pilot production target is **Cloud Run + Cloud SQL PostgreSQL in australia-southeast2 (Melbourne)**, with Auth0 Australia (AU) for identity. This is a future-state contract, not evidence that infrastructure or production capabilities exist. The execution status lives in the [active plan](../execution-plans/active/pilot-readiness.md); release/provisioning proof lives in the [Pilot Production Gate](../operations/PILOT_PRODUCTION_GATE.md).

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

Every production repository query is tenant-scoped. PostgreSQL RLS is applied transaction-locally, using the server-resolved tenant context. The runtime database role is nonprivileged; a narrowly scoped, server-only migration/operations role performs migrations and operational work. Server authorization, RLS, and cross-tenant negative tests are all required: none substitutes for another.

## Persistence and revenue-action continuity

Local JSON remains compatible for local development and tests. **Supabase is not the production Pilot target.** Production persistence uses append-only migrations and a one-way, verified legacy JSON snapshot cutover; there is no dual write. The cutover must verify counts, identifiers, required relationships, unknown-data preservation, and rollback evidence before the legacy snapshot becomes read-only historical evidence.

RevenueAction semantics remain deterministic and manually approved: no automated external sending, no client-side bypass of approval, and no change to recommendation/evidence meaning. The PR-3 PostgreSQL adapter makes the related mutations transactional without changing those contracts; JSON remains the default local/test adapter.

### PR-2 PostgreSQL foundation

PR-2 implements the schema/security foundation without switching runtime persistence. Migration `001` remains unchanged and quarantined in `public`; migration `002` bootstraps the non-login owner/migrator/runtime roles before creating `tge` objects as `tge_owner`, and migration `003` plus every later migration executes under that owner role. The runner refuses to infer an applied `001` from pre-existing legacy objects; an audited baseline is required instead. Legacy operational identifiers remain text IDs in `(tenant_id, id)` keys. Tenant relationships use composite foreign keys with `RESTRICT`, and imported records retain raw payload, source timestamps, and source ordinal.

Forced RLS reads transaction-local `app.tenant_id` and `app.subject_id`. These custom settings are trusted server-only inputs set only after PR-4 validates identity and membership and the server bridges the branded auth context into a separately branded PR-3 persistence context; they are not accepted API fields. RLS is defense in depth and does not replace repository predicates or PR-4 authorization. The runtime role is non-bypass and receives no access to the legacy `public` tables, migrations, role/schema administration, truncation, or mutation/deletion of import and audit evidence.

## Import safety, retention, and deletion

Imports are tenant-scoped and staged: CSV/XLSX upload → preview → explicit commit. Exact duplicates are skipped; ambiguous records require explicit user resolution; imports never merge into or overwrite existing CRM data implicitly. Every PR-2 ID-map row references its exact staging source and exactly one real tenant-owned prospect, opportunity, task, activity, or RevenueAction through a typed foreign key. Runtime may only select and insert batch, staging, ID-map, and audit evidence.

Controlled import status transitions and retention deletion are deliberately deferred. A later authorized slice must add them through a reviewed append-only migration and narrow function/repository boundary; unrestricted runtime `UPDATE` or `DELETE` is not an acceptable shortcut.

Validate MIME type, file signature, file size, row count, sheet count, cell count, decompression expansion, and parser resource limits before preview or commit. Treat spreadsheet formula-like values as data: neutralize formula injection on export/display paths and never evaluate formulas as executable content.

Store audit events and import metadata for **12 months**. Retain raw files for **7 days**, then delete them. Committed CRM data follows the tenant deletion policy rather than the raw-file retention policy; that policy must define its legal/contractual hold and deletion evidence before Pilot release.

## Configuration boundary

The environment contract names the public app URL, API URL, Auth0 domain/issuer/audience/callback/logout URLs, and operational service URLs. Cloudflare Pages is the static-host recommendation only, pending the vendor/privacy gate. Before external invitations, provision and verify a real domain, Auth0 custom domain, custom transactional SMTP, SPF, DKIM, and DMARC; keep authentication and marketing sending reputations separate.

## Implementation checklist

- [x] PR-1 characterized the legacy JSON compatibility contract without production changes; see [Legacy JSON Compatibility Contract](LEGACY_JSON_COMPATIBILITY.md).
- [x] PR-2 schema/security and its real PostgreSQL 16.15 final gate are recorded in the [active plan](../execution-plans/active/pilot-readiness.md).
- [x] PR-3 supplies tenant-aware PostgreSQL repositories and transactional RevenueAction mutations while JSON remains the default local/test adapter.
- [x] PR-4 implements exact Auth0 token validation, membership-backed immutable `TenantContext`, centralized role policy, assisted invitation contracts, and a server-only bridge into PR-3 persistence. Real Auth0/email acceptance remains deployment-gated.
- [ ] Every production tenant operation has server authorization, RLS, and a negative cross-tenant test.
- [ ] Restore and tenant extraction runbooks are proven under the [production gate](../operations/PILOT_PRODUCTION_GATE.md).
