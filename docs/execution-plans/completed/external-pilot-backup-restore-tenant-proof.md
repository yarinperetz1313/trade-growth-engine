# External Pilot Backup, Restore, and Tenant Proof

## Objective

Produce credential-independent, production-shaped evidence for a full logical
PostgreSQL backup, fresh isolated restore, pre-traffic retention maintenance,
restored tenant/isolation verification, privacy-minimized evidence, and safe
teardown. Keep the later Cloud SQL AU restore as an explicit external action.

## Authorized scope

- Backup/restore CLI and fail-closed configuration.
- PostgreSQL 16.15 synthetic rehearsal through migrations `001`–`016`.
- Redacted tenant manifest and drill evidence.
- RPO/RTO timing against the Pilot thresholds.
- Local teardown and a later-provider runbook.
- Focused and real-PostgreSQL tests.

## Non-goals

- Provider provisioning, credentials, payment, or Cloud SQL mutation.
- Live/customer data.
- Product, authentication, browser, schema, or migration changes.
- Canonical tenant-data deletion or a claim of native tenant restore.

## Implementation

`npm run proof:backup-restore` requires purpose-specific source admin, target
admin, target runtime, and target maintenance URLs; a bounded drill ID; selected
tenant UUID; expected terminal migration/checksum identity; a new evidence
directory; and the exact disposable-target acknowledgement. Local mode requires
loopback endpoints and distinct databases. The provider-shaped mode requires a
separate exact approval but stops at the external provider boundary.

The local command:

1. proves PostgreSQL 16.15, an empty disposable target, the terminal migration
   identity, an active selected membership, and an unrelated offboarded tenant;
2. records the selected tenant's source count/hash manifest;
3. creates a full custom-format `pg_dump` archive without placing credentials in
   process arguments;
4. restores the complete database with `pg_restore` and compares the full ledger
   and pre-maintenance manifest;
5. invokes the real maintenance-only cleanup processors before runtime traffic;
6. verifies exact monetary/currency/classification preservation by deterministic
   hashes, validated relationships, no external-send truth, nonprivileged runtime
   attributes, forced RLS, own-tenant reads, cross-tenant write denial,
   unrelated-tenant isolation, expired raw scrubbing, and offboarded reopen
   denial;
7. records RPO/RTO measurements, deletes the sensitive archive, drops only the
   preflight-proven disposable target, and writes minimized JSON evidence.

## Privacy and safety contract

Durable evidence contains table row counts, SHA-256 digests, bounded statuses,
timestamps, and elapsed milliseconds only. It excludes DSNs, credentials,
subjects, emails, filenames, customer cells, monetary values, and raw payloads.
The logical manifest is evidence, not a restorable tenant export. The source is
read-only throughout the proof.

## Acceptance criteria

- Red-first configuration/runbook contracts are green.
- A real PostgreSQL 16.15 run performs `pg_dump` and `pg_restore`.
- Migrations `001`–`016` and their checksums match across source and restore.
- Two-tenant selected/unrelated isolation and all requested privacy, retention,
  money, relationship, no-send, runtime, RLS, and offboarding checks pass.
- Evidence is redacted and the local target/archive cleanup is verified.
- The proof explicitly states that live Cloud SQL readiness is not proven.

## External stop condition

The remaining action is the approved, operator-owned full isolated Cloud SQL
restore in `australia-southeast2`, using an explicit Australian backup location
and 14 daily backups, followed by equivalent verification and provider-instance
teardown. No part of this repository slice performs that action.
