# Backup, Restore, and Tenant Proof

This runbook separates a credential-independent local rehearsal from the later
Cloud SQL provider drill. A successful local run is labelled
`LOCAL_SYNTHETIC_LOGICAL_REHEARSAL`; it **does not prove live Cloud SQL readiness**.

## Local PostgreSQL 16.15 rehearsal

Prepare two fresh loopback databases on one isolated PostgreSQL 16.15 server.
The source must have migrations `001`–`016`, at least two synthetic tenants, an
active selected-tenant membership, a due raw-import cleanup case, and an
offboarded unrelated tenant. The restore target must be empty. Create distinct
nonprivileged login roles which inherit only `tge_runtime` and
`tge_maintenance`, respectively.

Set only the purpose-specific variables below. The command rejects generic
`DATABASE_URL`, production-like database names, a reused source/target, unsafe
identifiers, non-loopback local URLs, and an inexact disposable-target
acknowledgement.

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
verifies the complete migration ledger/checksums, and compares a logical tenant
manifest across source and restore. It verifies exact monetary/currency and
known-zero/unknown classifications by digest without persisting the values. It
also verifies relationship constraints, no external send claim, nonprivileged
runtime and forced RLS, own-tenant visibility, forged cross-tenant write denial,
unrelated-tenant isolation, expired raw scrubbing, and denial of offboarded
access reopening.

The durable logical tenant manifest contains only table row counts and
deterministic SHA-256 digests. It contains no subjects, emails, filenames,
customer values, money values, connection strings, credentials, or raw cells.
It is verification/export evidence, **not a native tenant restore** and not a
portable tenant-data import package.

The sensitive full archive is removed, the local disposable restore database
is dropped, and the evidence records cleanup. The source is never dropped or
modified.

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
   due cleanup before traffic, then execute the same ledger, manifest, money,
   relationship, RLS, isolation, raw-expiry, offboarding, and no-send checks.
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
