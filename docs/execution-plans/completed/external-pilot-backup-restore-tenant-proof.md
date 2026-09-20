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

1. proves PostgreSQL 16.15, an empty disposable target, the full ordered
   repository migration ledger, the required global-role graph, an active
   selected tenant, an active data-bearing unrelated tenant, and a third tenant
   with meaningful pending offboarding;
2. records the selected tenant's source count/hash manifest;
3. creates a full custom-format `pg_dump` archive without placing credentials in
   process arguments;
4. restores the complete database with `pg_restore` and compares the full ledger
   and pre-maintenance manifest;
5. invokes the real maintenance-only cleanup processors before runtime traffic;
6. executes the existing tenant-scoped repositories for opportunities, imports,
   cases, actions, tasks, activities, and evidence; verifies exact money,
   currency, known-zero, and unknown truth; then proves relationships, no send,
   runtime readiness/nonprivilege, forced RLS, grants/ownership, cross-tenant
   negatives, active unrelated-tenant isolation, expired raw scrubbing, and
   offboarded authentication denial;
7. records RPO/RTO measurements, deletes the sensitive archive, drops only the
   preflight-proven disposable target, and writes minimized JSON evidence.

The same validated canonical endpoints drive Node clients and PostgreSQL tools;
unsafe URL overrides and ambient PostgreSQL routing variables are rejected or
removed. A single idempotent lifecycle owns cleanup on success, command failure,
and signals, and cleanup errors remain visible. Catalog inventory prevents a
new tenant table from silently escaping the manifest.

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
Because the local proof restores within one cluster, the external drill must
also recreate and validate the global role graph on the fresh target. Before
traffic, operators must reconcile post-backup identity and membership
revocations against the current authoritative source; snapshot cleanup alone
cannot prove revocations that occurred after the backup.
