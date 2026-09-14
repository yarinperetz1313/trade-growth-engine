# Assisted Pilot acceptance and operator runbook

This runbook executes one synthetic, production-like local acceptance journey
through the supported secure Pilot composition. It is repository evidence, not
deployment or external-provider evidence. Never point it at an existing
application database or a shared PostgreSQL server.

## Closed acceptance proof

`npm run acceptance:pilot` accepts only an explicit loopback test-server URL in
`TGE_ACCEPTANCE_DATABASE_URL`. The URL must name the administrative `postgres`
database and an explicit port. The command requires exact PostgreSQL 16.15,
refuses a server with an existing non-system database or TGE role, creates a
random database and least-privilege runtime login, applies the unchanged
append-only migrations, and removes those resources on success or failure.
Before inspecting the server, the command acquires one cluster-level advisory
lock and retains it through cleanup, so competing acceptance invocations fail
closed instead of sharing the fixed migration roles. The command atomically
marks those roles with an invocation-specific ownership value before creating
the database and verifies the complete marker set before any revoke or drop.
It never removes roles whose ownership marker is absent or belongs to another
run. PostgreSQL releases the advisory lock automatically if the owning session
is lost, so no stale filesystem lock requires manual deletion.

`SIGINT` and `SIGTERM` enter the same idempotent cleanup path as ordinary
success or failure. The first signal records one authoritative interruption,
prevents later provisioning and journey phases, and makes cleanup wait for any
in-flight provisioning operation to reach a known settled boundary. Committed
role ownership is published immediately after its transaction COMMIT so the
same cleanup cannot pass that resource and later report a false removal.
Cleanup begins exactly once and both signal handlers remain installed while it
runs, absorbing repeated same or mixed `SIGINT`/`SIGTERM` signals. Cleanup has
a bounded ten-second window; after cleanup or that explicit fallback resolves,
the command removes its handlers and re-raises the original signal so
shell/process termination semantics remain truthful. A stalled cleanup cannot
leave an unbounded signal handler; the whole disposable cluster must still be
torn down with the fixture commands below after any interrupted or failed run.

The journey proves:

1. business requests are gated while secure readiness is not ready;
2. local secure readiness reaches ready;
3. bearer verification uses the injected
   `LOCAL_DETERMINISTIC_NOT_AUTH0_OR_SMTP` verifier;
4. membership-derived tenant authority rejects a forged client tenant field and
   does not accept forged tenant query/header values as authority;
5. a second authenticated tenant cannot see the first tenant's batch,
   opportunity, case, queue entry, or RevenueAction;
6. bounded CSV preview → explicit mapping/Data Health → explicit canonical commit
   retains exact authoritative `AUD` currency;
7. explicit stalled-opportunity scan → server-ranked operating queue →
   case-to-RevenueAction handoff → prepare → approve → internal task execution
   retains durable case, action, task, and activity identities; and
8. `external_send_performed` is exactly `false`.

Success emits one closed JSON object containing only PostgreSQL version, stable
gate states/counts, action/effect mode, external-proof exclusions, and cleanup
state. It never emits a DSN, credential, token, tenant/customer ID, raw CSV
cell, filename, draft, or contact data. Configuration and execution failures
emit only a stable error code on stderr and return nonzero.

## Disposable local setup

Use a fresh dedicated cluster. The following is an acceptance-only loopback
fixture, not a production authentication or network configuration:

```sh
export TGE_ACCEPTANCE_ROOT="$(mktemp -d /tmp/tge-assisted-pilot.XXXXXX)"
export TGE_ACCEPTANCE_PORT=55439
/opt/homebrew/opt/postgresql@16/bin/initdb -D "$TGE_ACCEPTANCE_ROOT/data" --auth=trust
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D "$TGE_ACCEPTANCE_ROOT/data" \
  -o "-h 127.0.0.1 -p $TGE_ACCEPTANCE_PORT -k $TGE_ACCEPTANCE_ROOT" \
  -l "$TGE_ACCEPTANCE_ROOT/postgres.log" start
/opt/homebrew/opt/postgresql@16/bin/postgres --version
export TGE_ACCEPTANCE_DATABASE_URL="postgresql://$USER@127.0.0.1:$TGE_ACCEPTANCE_PORT/postgres"
npm --silent run acceptance:pilot
```

The version line must be `postgres (PostgreSQL) 16.15`. Treat any nonzero
result or any output other than the closed JSON proof as a failed gate. Stop and
investigate; do not broaden the command to a shared or existing database.

Always tear down the whole fixture, even after a failed command:

```sh
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D "$TGE_ACCEPTANCE_ROOT/data" stop -m fast
rm -rf "$TGE_ACCEPTANCE_ROOT"
unset TGE_ACCEPTANCE_DATABASE_URL TGE_ACCEPTANCE_PORT TGE_ACCEPTANCE_ROOT
```

Resolve and inspect `TGE_ACCEPTANCE_ROOT` before the removal command. It must be
the unique `/tmp/tge-assisted-pilot.*` directory created for this run.

## Secure assisted-pilot operations

### Intake and minimization

- Confirm the operator is authorized for the tenant and the customer approved
  the assisted import before accepting data.
- Use the product's authenticated CSV upload boundary. Do not accept database
  dumps, credentials, OAuth tokens, email archives, or unrelated documents.
- Ask for only fields required for the agreed workflow. Remove unrelated
  columns before upload; do not copy raw cells into tickets, chat, logs, or
  screenshots.
- Verify the bounded CSV preview and Data Health result before the explicit
  canonical commit. Ambiguity or blocking evidence stops the commit.
- The repository acceptance command uses only embedded synthetic data. Never
  replace it with customer data.

### Setup and access

- Use only the supported `server:pilot`/`start` composition in a provisioned
  Pilot. Keep migration, least-privilege runtime, and processor-only maintenance
  credentials separate. Do not provide any of them to the browser.
- Check liveness and secure readiness separately. A live/not-ready process must
  not receive business traffic.
- Verify active membership and role through server authority. Client tenant,
  role, email, headers, query values, and custom claims are never authority.

### Backup and recovery

This local acceptance does **not** prove backup/restore. Before external use,
configure an explicit Australian regional Cloud SQL backup location, retain 14
daily backups, and complete the production full-restore → logical tenant export
→ tenant restore drill. Record RPO/RTO timing and remove temporary resources.
Do not claim native tenant restore or a successful drill without that evidence.

### Incident response

- Stop new assisted invitations and imports, preserve privacy-minimized event
  codes/counts, and record the incident start and operator.
- If isolation, credential, or database integrity is uncertain, remove Pilot
  traffic and keep secure readiness closed. Do not copy tokens, DSNs, raw cells,
  contact data, or drafts into the incident record.
- Use the approved provider process for credential rotation or destructive
  infrastructure work. Re-run the affected readiness/isolation/acceptance gates
  before restoring access.

### Cleanup, deletion, and offboarding

- Raw staged evidence becomes unavailable at exactly 168 elapsed hours and is
  physically scrubbed only by the processor-only maintenance boundary. Run
  `npm run maintenance:cleanup` only with separately provisioned maintenance
  credentials and verify its aggregate stable states.
- Tenant offboarding requires the exact OWNER confirmation and the injected
  reauthentication/MFA-ready policy. Its truthful result is
  `ACCESS_AND_RAW_EVIDENCE_ONLY`: invitations, membership access, and raw import
  evidence are removed, while canonical CRM, ID-map reconciliation, audit, and
  Pilot evidence remain.
- No canonical tenant-data deletion policy is approved by this runbook. Do not
  delete canonical tenant records or represent access/raw-evidence offboarding
  as full tenant deletion.

### Teardown

- After each local acceptance, verify the proof reports the random database and
  runtime login as `REMOVED`, stop PostgreSQL, remove the unique fixture
  directory, unset variables, and confirm no dependency/build/test artifact was
  retained.

## Remaining production gates

A local PASS is explicitly **not** Auth0 AU, JWKS, Universal Login, SMTP/OTP,
provider provisioning/location, Australian infrastructure, production
maintenance, backup/restore, privacy/vendor/legal approval, or canonical
tenant-data deletion evidence. It does not authorize external invitations,
external sends, deployment, or release. Complete the separate
[Pilot Production Gate](PILOT_PRODUCTION_GATE.md) before any such claim.
