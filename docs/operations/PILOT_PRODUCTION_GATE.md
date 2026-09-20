# Pilot Production Gate

Do not provision or invite external users until every applicable gate below has recorded evidence. This operations contract implements the [Pilot Readiness Foundation](../architecture/PILOT_READINESS_FOUNDATION.md); the [completed Pilot Readiness plan](../execution-plans/completed/pilot-readiness.md) retains the implementation evidence. Open production gates remain governed here rather than implying another active product slice.

## Release baseline to prove

| Gate | Required evidence |
| --- | --- |
| Australian topology | Cloud Run and Cloud SQL PostgreSQL are in australia-southeast2 (Melbourne); any Sydney use has a written exception. PostgreSQL 16 explicitly uses reviewed Enterprise/non-shared-core `db-custom-1-3840`, never a provider edition default or no-SLA shared-core tier. The deployable container passes portability checks. |
| Backup and recovery | Cloud SQL uses an explicit Australian regional backup location, not the provider default, with **14 daily backups**. Runbook evidence proves **RPO <= 24 hours** and **RTO <= 4 business hours**. |
| Tenant recovery | Restore the complete database to a temporary AU instance, then logically export and restore the selected tenant. Record checkpoints, timing, validation, cleanup, and owner. Do not represent this as native tenant restore. |
| Identity and tenancy | Auth0 Australia (AU) configuration is verified. The server validates issuer/audience/JWKS and resolves membership-backed `TenantContext`; OWNER/ADMIN/MEMBER policy, tenant-scoped repositories, transaction-local RLS, nonprivileged runtime role, migration-capable `tge_migrator`, processor-only `tge_maintenance`, and cross-tenant negative tests have reviewed evidence. |
| Imports and retention | Staged CSV/XLSX checks enforce limits and explicit ambiguity resolution; raw files: exactly **168 elapsed hours (7 days)** independent of timezone/DST; audit metadata: **12 months**; committed CRM data follows the approved tenant deletion policy. |
| Revenue actions | Deterministic recommendation/evidence, explicit manual approval, and no external automatic send remain intact while later database mutations become transactional. |

The [raw-import expiry and tenant offboarding
contract](../architecture/PILOT_READINESS_FOUNDATION.md#import-safety-retention-and-deletion) implements
the local database authority, exact 168-elapsed-hour denial, retry-safe physical scrub,
terminal tenant/import write barriers, and minimized deletion evidence. The
offboarding contract changes only tenant `slug`, `name`, and
`metadata.offboarding_state`; all other tenant metadata and canonical/audit
evidence are preserved. The repository now has a credential-independent,
validated template for separate runtime, migrator, maintenance, and scheduler
identities plus a bounded maintenance job, schedule, diagnostics, and alert
contracts in the [External Pilot Deployment and Operations
runbook](EXTERNAL_PILOT_DEPLOYMENT.md). Production IAM, scheduling, secrets,
alert delivery, and observed cleanup execution are not yet proven. Canonical
tenant-data deletion also remains blocked on approved
legal/contractual retention policy; access/raw-evidence offboarding must not be
represented as full tenant deletion.

The repository now contains the explicit fail-closed bootstrap described by the
[Secure Pilot Runtime](../architecture/SECURE_PILOT_RUNTIME.md). Its readiness
endpoint proves only local code, runtime-role database access, migration/schema,
and membership lookup usability. It does not close any provider, topology,
backup, privacy, production-maintenance, provisioning, or real Auth0/SMTP/OTP
gate below.

## Provisioning and vendor gates

- **Static hosting:** Cloudflare Pages is recommended, subject to static-host vendor/privacy approval.
- **Domain and email:** approve the production domain/registrar; configure Auth0 custom domain, custom transactional SMTP, SPF, DKIM, and DMARC; verify authentication and marketing reputation separation before external invites.
- **Auth0:** confirm the AU tenant and plan support New Universal Login passwordless email OTP, the production custom domain, sender constraints, and required features. Classic Login and magic links are not accepted Pilot fallbacks.
- **Auth0 OTP acceptance:** provision a dedicated AU non-production tenant and test SMTP/email-capture provider. Prove Authorization Code Flow with PKCE, exact callback/logout/origin allowlists, latest-message selection after the test start, earlier/replayed OTP rejection, invited membership activation, provisioned-but-uninvited denial, and complete cleanup. Until credentials and provider configuration exist, this remains a deployment gate; deterministic local seams are not real-flow evidence.
- **Privacy:** complete privacy/DPA review for every selected vendor and the tenant deletion policy.
- **Cloud locations:** reverify [Cloud Run locations](https://cloud.google.com/run/docs/locations) and [Cloud SQL PostgreSQL standard-backup location/retention controls](https://cloud.google.com/sql/docs/postgres/backup-recovery/manage-standard-backups) immediately before provisioning. These official sources were **verified 2026-08-30**; provider defaults are not approval evidence.

## Runbook checkpoints

1. Assign the transferable operator owner and on-call decision maker.
2. Capture configuration evidence for region, roles, backup location, 14 daily backups, URLs, and identity validation.
3. Execute the Auth0 AU email-OTP acceptance test and retain redacted evidence without tokens, OTPs, or session values.
4. Execute and time the full-restore → logical-tenant-export → tenant-restore drill in Australia.
5. Validate tenant boundaries, record RPO/RTO results, clean up temporary resources, and retain the drill record.
6. Obtain privacy/vendor sign-off and confirm all open gates are closed before enabling external invites.

## Sign-off

No evidence means no sign-off. A failed or expired check reopens the gate; the owner records the exception, remediation, and re-test before release.
