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

## Review remediation

Fresh review of checkpoint `3010dd3` found that the proof sampled rather than
fully compared the effective runtime/maintenance privilege contract and released
PostgreSQL child ownership immediately after sending `SIGTERM`. Remediation
cycle **2/3** adds exact catalog-derived table, sequence, function, schema, and
RevenueAction-column privilege comparison. Tenant-bearing tables are discovered
by their `tenant_id` column independently of RLS, after which manifest inclusion
and forced RLS are separate requirements.

Four real PostgreSQL mutations were RED **0/4** at the reviewed checkpoint: a
maintenance read of `import_staging_records`, runtime execution of the
offboarding processor, removal of required opportunity mutations, and an
owner-created tenant table without RLS. The fixed proof rejects all four before
backup, while the unchanged positive drill still restores and verifies. Child
cleanup now waits for confirmed exit, escalates a SIGTERM-ignoring child with
SIGKILL, and refuses archive/target removal if owned child shutdown cannot be
confirmed. A never-settling cleanup emits one redacted failure before preserving
the original SIGINT/SIGTERM semantics. Focused configuration/lifecycle tests
pass **36/36**, integration passes **528/528**, and PostgreSQL 16.15 passes
**96/96**. No schema or migration changed.

Final Policy V2 remediation cycle **3/3** closes the remaining same-root column
privilege gap. PostgreSQL table privilege checks do not expose an independently
granted column privilege, so the verifier now compares effective `SELECT`,
`INSERT`, `UPDATE`, and `REFERENCES` for every live column across the complete
`tge` table catalog. Expected permissions come from the existing table contract;
the bounded RevenueAction update columns are the only explicit column exception.
The comparison executes for `tge_runtime`, `tge_maintenance`, and both dedicated
login roles, covering inherited and direct grants without weakening table,
sequence, schema, function, ownership, or manifest checks.

Four new PostgreSQL 16.15 attacks were RED **0/4** at `0ba7a05`: runtime group
and login `UPDATE (commit_metadata)` authority, plus maintenance group and login
`SELECT (raw_payload)` authority, all falsely certified. With the group update
grant, the runtime login performed one real committed-batch metadata update in a
rolled-back transaction. After the fix all four attacks fail certification, the
same operations without the grants fail with `42501`, the prior four adversarial
contracts remain closed, and the positive full dump/restore proof passes. The
focused database proof is **11/11** and configuration/lifecycle is **36/36**.

## Bounded CI harness recovery

The first push/pull-request Verify attempts for exact candidate `654a65c`
(`35502589796` and `35502603705`) each passed integration **528/528** and
failed PostgreSQL **101/102** at the same positive proof call. Authoritative
Actions run/log inspection and a disposable PostgreSQL 16.15 reproduction with
Node 22.22.3 and `npm ci` dependencies classify this as
`TEST_OR_CI_HARNESS_DEFECT`. A redacted diagnostic recovered phase `BACKUP`
and inner `ERR_ASSERTION`: the test expected `PGHOST=127.0.0.1`, while CI
correctly supplied `localhost`. The assertion ran before invoking `pg_dump`.

The exact unmodified candidate reproduced the CI failure (**10/11** focused).
Before fixing the assertion, a new full-rehearsal endpoint matrix was RED
**1/2**: explicit `localhost` failed even with a numeric caller URL, while
explicit `127.0.0.1` succeeded. The harness now compares the command host with
its configured source or target URL, preserving endpoint-identity verification.
Both regressions are GREEN **2/2**, the complete focused proof is **13/13**,
and `npm run test:db` against the disposable server using CI's `localhost`
spelling is **104/104**. `npm run test:harness` and `git diff --check` pass.

All prior privilege, isolation, recovery, cleanup, and evidence assertions remain.
No production script, application, migration, CI configuration, or external
provider operation changed. Integration/build/browser gates were not repeated
for this test-only correction. GitHub push, independent review, and replacement
Verify remain coordinator-owned; these local results do not claim green CI.

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
