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

Auth0 Australia (AU) provides magic-link **identity**; TGE remains the authorization authority. The server validates issuer, audience, signature/JWKS, expiry, and required claims, then resolves `TenantContext` from server-side membership. It never accepts a client-supplied tenant ID as authority. Auth0 documents Australia (AU) tenant locality and passwordless magic-link behavior: [Create tenants](https://auth0.com/docs/get-started/auth0-overview/create-tenants) and [Email magic links](https://auth0.com/docs/authenticate/passwordless/authentication-methods/email-magic-link) — **verified 2026-08-30; reverify plan/features before provisioning**.

### Auth0 magic-link delivery decision (before PR-4)

**PR-4 is blocked** pending a documented product-owner decision that validates: (1) the Auth0 AU plan supports passwordless magic links; (2) the flow is **Classic Login with same-browser/device completion**, or a tenant setting or alternative is separately approved; (3) mobile/email-client behavior, callback/redirect allowlists, and phishing/resend/session protections; and (4) a deterministic E2E acceptance test for the selected path. Do not assume cross-browser tenant configuration. If magic-link UX is rejected, PR-4 stops for an explicit product decision. There is no implicit OTP fallback.

| Role | Tenant authority |
| --- | --- |
| OWNER | Manage tenant membership and roles; approve high-impact tenant operations. |
| ADMIN | Operate tenant CRM and approved administration; cannot transfer ownership. |
| MEMBER | Operate only the tenant CRM permissions explicitly granted by server policy. |

Every production repository query is tenant-scoped. PostgreSQL RLS is applied transaction-locally, using the server-resolved tenant context. The runtime database role is nonprivileged; a narrowly scoped, server-only migration/operations role performs migrations and operational work. Server authorization, RLS, and cross-tenant negative tests are all required: none substitutes for another.

## Persistence and revenue-action continuity

Local JSON remains compatible for local development and tests. **Supabase is not the production Pilot target.** Production persistence uses append-only migrations and a one-way, verified legacy JSON snapshot cutover; there is no dual write. The cutover must verify counts, identifiers, required relationships, unknown-data preservation, and rollback evidence before the legacy snapshot becomes read-only historical evidence.

RevenueAction semantics remain deterministic and manually approved: no automated external sending, no client-side bypass of approval, and no change to recommendation/evidence meaning. The future database implementation makes the related mutations transactional without changing those contracts.

## Import safety, retention, and deletion

Imports are tenant-scoped and staged: CSV/XLSX upload → preview → explicit commit. Exact duplicates are skipped; ambiguous records require explicit user resolution; imports never merge into or overwrite existing CRM data implicitly.

Validate MIME type, file signature, file size, row count, sheet count, cell count, decompression expansion, and parser resource limits before preview or commit. Treat spreadsheet formula-like values as data: neutralize formula injection on export/display paths and never evaluate formulas as executable content.

Store audit events and import metadata for **12 months**. Retain raw files for **7 days**, then delete them. Committed CRM data follows the tenant deletion policy rather than the raw-file retention policy; that policy must define its legal/contractual hold and deletion evidence before Pilot release.

## Configuration boundary

The environment contract names the public app URL, API URL, Auth0 domain/issuer/audience/callback/logout URLs, and operational service URLs. Cloudflare Pages is the static-host recommendation only, pending the vendor/privacy gate. Before external invitations, provision and verify a real domain, Auth0 custom domain, custom transactional SMTP, SPF, DKIM, and DMARC; keep authentication and marketing sending reputations separate.

## Implementation checklist

- [x] PR-1 characterized the legacy JSON compatibility contract without production changes; see [Legacy JSON Compatibility Contract](LEGACY_JSON_COMPATIBILITY.md).
- [ ] PR-2 starts only after the [active plan](../execution-plans/active/pilot-readiness.md) gates are resolved.
- [ ] PR-4 starts only after the Auth0 magic-link delivery decision is documented and its deterministic E2E acceptance test is defined.
- [ ] Every production tenant operation has server authorization, RLS, and a negative cross-tenant test.
- [ ] Restore and tenant extraction runbooks are proven under the [production gate](../operations/PILOT_PRODUCTION_GATE.md).
