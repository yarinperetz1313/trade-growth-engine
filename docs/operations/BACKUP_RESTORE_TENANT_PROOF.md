# Backup, Restore, and Tenant Proof

This runbook separates a credential-independent local rehearsal from the later
Cloud SQL provider drill. A successful local run is labelled
`LOCAL_SYNTHETIC_LOGICAL_REHEARSAL`; it **does not prove live Cloud SQL readiness**.

## Local PostgreSQL 16.15 rehearsal

Prepare two fresh loopback databases on one isolated PostgreSQL 16.15 server.
The source must have the complete ordered repository migration ledger `001`–`016`,
an active selected tenant, an active unrelated tenant with actual data, a due
raw-import cleanup case, and a third tenant with pending offboarding, stale
membership/invitation access, and expired raw evidence. The restore target must be empty. Create distinct
nonprivileged login roles which inherit only `tge_runtime` and
`tge_maintenance`, respectively.

Set only the purpose-specific variables below. The command rejects generic
`DATABASE_URL`, production-like database names, a reused source/target, unsafe
identifiers, non-loopback local URLs, and an inexact disposable-target
acknowledgement.

Every PostgreSQL URL is parsed into one canonical endpoint used identically by
`pg.Client`, `pg_dump`, and `pg_restore`. URL query parameters are rejected
except the exact safe values `application_name=tge-backup-restore-proof` and
`sslmode=verify-full`; routing, service-file, password-file, client-certificate,
session-option, and credential overrides fail closed. Credentials are supplied
to PostgreSQL child processes only through a sanitized environment, never in
arguments or evidence. Ambient `PG*` routing variables are not inherited.

```sh
export TGE_BACKUP_RESTORE_MODE=LOCAL_LOGICAL_REHEARSAL
export TGE_BACKUP_SOURCE_ADMIN_URL='postgresql://.../tge_restore_source'
export TGE_RESTORE_TARGET_ADMIN_URL='postgresql://.../tge_restore_target'
export TGE_RESTORE_TARGET_RUNTIME_URL='postgresql://.../tge_restore_target'
export TGE_RESTORE_TARGET_MAINTENANCE_URL='postgresql://.../tge_restore_target'
export TGE_BACKUP_RESTORE_DRILL_ID='local-proof-yyyymmdd'
export TGE_BACKUP_RESTORE_TENANT_ID='00000000-0000-4000-8000-000000000000'
export TGE_BACKUP_RESTORE_EXPECTED_MIGRATION_ID='016'
export TGE_BACKUP_RESTORE_EXPECTED_MIGRATION_CHECKSUM='<sha256>'
export TGE_BACKUP_RESTORE_DISPOSABLE_TARGET_ACK='I_ACKNOWLEDGE_TARGET_DATABASE_IS_DISPOSABLE'
export TGE_BACKUP_RESTORE_EVIDENCE_DIR='/an/outside-repository/new-directory'
npm run proof:backup-restore
```

The command performs a full `pg_dump` custom-format backup, restores it with
`pg_restore`, runs due raw cleanup and pending offboarding **before traffic**,
verifies every ordered migration filename and repository-computed checksum, and compares a logical tenant
manifest across source and restore. It verifies exact monetary/currency and
known-zero/unknown classifications through the existing tenant-scoped
repositories without persisting the values. It
also verifies relationship constraints, no external send claim, nonprivileged
runtime readiness and forced RLS, prohibited transitive membership and `SET
ROLE`, object ownership and required/prohibited grants, own-tenant repository
reads, forged cross-tenant read/write denial, active unrelated-tenant data
isolation, expired raw scrubbing, and offboarded authentication lookup/reopen
denial. The manifest inventory is also checked against every current `tge` table
with a `tenant_id` column so a newly added tenant table cannot be silently
omitted.

The durable logical tenant manifest contains only table row counts and
deterministic SHA-256 digests. It contains no subjects, emails, filenames,
customer values, money values, connection strings, credentials, or raw cells.
It is verification/export evidence, **not a native tenant restore** and not a
portable tenant-data import package.

The sensitive full archive is removed, the local disposable restore database
is dropped, and the evidence records cleanup. The source is never dropped or
modified. One idempotent lifecycle owns clients, PostgreSQL children, the
archive, temporary directory, and the preflight-validated target. It performs
bounded cleanup on `SIGINT`/`SIGTERM` before preserving the original signal;
cleanup failure is reported and never hidden behind the primary command error.

This local rehearsal uses one PostgreSQL cluster whose global roles already
exist. It fail-closes unless the owner/migrator/runtime/maintenance role graph is
correct, but it **does not prove role recreation on a fresh Cloud SQL cluster**.
The provider drill must reconstruct and validate those global roles before the
restore can be considered usable.

## Recovery objectives

The mission thresholds are **RPO <= 24 hours** and **RTO <= 4 business hours**.
The local run records backup age and restore-to-verified wall-clock elapsed time,
but those measurements are synthetic harness evidence only. They are not a
customer SLA or provider-performance claim.

## Later Cloud SQL AU drill — exact external provider action

Do not run these steps without explicit provider/account, billing, privacy, and
operator approval. They remain an **external provider action**:

1. Reverify official Cloud SQL PostgreSQL backup/restore documentation.
2. Confirm the source is in `australia-southeast2`, the backup location is an
   explicit Australian regional location, and retention is **14 daily backups**.
3. Record the chosen provider backup identity and completion time without
   credentials or customer values.
4. Perform a **full isolated Cloud SQL restore** to a newly named temporary AU
   instance; never restore over the live instance or point application traffic
   at it.
5. Provision separate target admin, runtime, and maintenance credentials. Run
   the reviewed cluster-role reconstruction/preflight. Run due cleanup before
   traffic, then execute the same ledger, manifest, money,
   relationship, RLS, isolation, raw-expiry, offboarding, and no-send checks.
   A backup may restore memberships or invitations that were revoked after the
   backup time: reconcile the restored access state against the current
   authoritative identity/membership source and apply every later revocation
   before any application traffic is permitted.
6. Record provider-observed backup age for RPO and restore start through verified
   completion for RTO. Label provider evidence separately from local proof.
7. After evidence review, revoke temporary credentials and delete the isolated
   instance using the provider console/API. Confirm deletion and billing cleanup.

`CLOUD_SQL_AU_ISOLATED_VERIFICATION` configuration requires the exact
`APPROVED_CLOUD_SQL_AU_ISOLATED_RESTORE_TARGET` approval token, but this
repository command deliberately stops with
`BACKUP_RESTORE_EXTERNAL_PROVIDER_ACTION_REQUIRED`; it does not create, replace,
or destroy Cloud SQL resources. Provider automation must be reviewed against the
then-current Cloud SQL contract before it is enabled.
