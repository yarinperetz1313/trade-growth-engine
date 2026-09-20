# External Pilot Offboarding Operator

This runbook is the assisted-pilot operator path for the existing PostgreSQL
offboarding contract. It removes database access and raw import evidence. It
does **not** delete canonical CRM records, identity maps, audit/Pilot evidence,
provider users, logs, exports, or backups.

## Authority and configuration

- Use a dedicated operator login exposed only as
  `TGE_OFFBOARDING_OPERATOR_DATABASE_URL`. The command has no runtime or generic
  DSN fallback.
- The authenticated session login must have the existing `tge_runtime`
  database role and no other transitive role membership, including PostgreSQL
  predefined file/server roles. It must have no owner, migrator, maintenance,
  superuser, create-database, create-role, replication, schema-create, or
  bypass-RLS authority. The effective role must exactly equal the authenticated
  session login; a connection that uses `options=-c role=...` or another role
  switch is rejected even when the effective role looks restricted. The
  command verifies this shape before reading or requesting anything; a generic
  runtime or privileged login is rejected.
- Supply the exact tenant UUID and the exact named active OWNER issuer and
  subject. The command fails closed if the identity is missing, ambiguous,
  non-OWNER, or belongs to another tenant.
- Keep issuer, subject, DSN, customer data, filenames, and provider credentials
  out of tickets and command output. The command emits only stable status codes,
  timestamps, counts, retention classes, and operator handoff instructions.
- The separate maintenance login remains configured only through
  `TGE_MAINTENANCE_DATABASE_URL` and retains its existing targetless processor
  authority.

Do not use a production owner/migrator credential. Do not place either DSN in a
shell history entry; load it through the approved secret-backed environment.

## 1. Preflight (default dry-run)

```sh
npm run operator:offboarding -- request \
  --tenant "$TGE_TENANT_UUID" \
  --issuer "$TGE_OWNER_ISSUER" \
  --subject "$TGE_OWNER_SUBJECT"
```

Expected new-request code: `OFFBOARDING_REQUEST_DRY_RUN_READY`. The dry-run
performs no database write. `OFFBOARDING_REQUEST_DRY_RUN_EXISTING` means a
request is already pending or failed; follow its `nextAction` instead of making
another request.

Stop on any of these codes:

- `OFFBOARDING_OWNER_UNAVAILABLE`: re-check the exact named active OWNER and
  tenant; do not substitute another actor.
- `OFFBOARDING_REQUEST_TERMINAL`: access/raw offboarding already completed; use
  the receipt command.
- `OFFBOARDING_REQUEST_ACTOR_MISMATCH`: the tenant already has a request from a
  different named actor; stop rather than replacing or adopting that request.
- `OFFBOARDING_REQUEST_RECONCILIATION_REQUIRED`: PostgreSQL did not confirm the
  request transaction outcome. Do not report denial and do not automatically
  retry. Run the actor-bound `status` command once to reconcile database truth.
- `OFFBOARDING_STATUS_UNAVAILABLE` or
  `OFFBOARDING_OPERATOR_CONFIGURATION_INVALID`: fix the dedicated operator
  connection/configuration; do not fall back to another DSN.

## 2. Explicit request

This is an irreversible access/raw-evidence action. Obtain the required human
approval before running it.

```sh
npm run operator:offboarding -- request \
  --tenant "$TGE_TENANT_UUID" \
  --issuer "$TGE_OWNER_ISSUER" \
  --subject "$TGE_OWNER_SUBJECT" \
  --apply \
  --confirm OFFBOARD_ACCESS_AND_RAW_EVIDENCE
```

The command resolves one exact active OWNER, then calls the existing
`TenantOffboardingService`. Its repository transaction establishes tenant,
issuer, and subject as transaction-local database context. The authoritative
database function performs the final OWNER and identity revalidation. After an
acknowledged mutation, the operator re-reads the actor-bound request before it
can report acceptance. A same-actor concurrent replay returns the single
existing request; a different active OWNER racing for that tenant cannot adopt
or report acceptance of the other actor's request.

If COMMIT may have succeeded but its acknowledgement was lost, the command
returns `OFFBOARDING_REQUEST_RECONCILIATION_REQUIRED` with
`outcomeConfirmed: false` and `operatorCommand: status`. It does not claim the
request failed, run maintenance, or retry the mutation. Use the exact same
tenant/issuer/subject with the status command above; only the authoritative
actor-bound status determines the next action.

`OFFBOARDING_REQUEST_ACCEPTED` means only that the request exists. It does not
mean memberships were revoked, raw evidence was scrubbed, a provider user was
disabled, or canonical data was deleted.

The application/public offboarding route remains separately fail-closed unless
its configured step-up assurance policy is satisfied. This operator credential
does not weaken that route.

## 3. Maintenance handoff

For `PENDING`, run the existing production maintenance command with the
separate maintenance credential:

```sh
npm run maintenance:cleanup
```

The command processes targetless pending/retryable work. Do not add a tenant
argument, directly edit the request row, or call private scrub functions.

Inspect the actor-bound lifecycle without requesting another mutation:

```sh
npm run operator:offboarding -- status \
  --tenant "$TGE_TENANT_UUID" \
  --issuer "$TGE_OWNER_ISSUER" \
  --subject "$TGE_OWNER_SUBJECT"
```

- `PENDING`: run `npm run maintenance:cleanup`.
- `IN_PROGRESS`: do not start a competing targeted command; re-run status after
  the existing maintenance invocation reaches a terminal result.
- `FAILED` with `retryable: true`: retain the evidence and run
  `npm run maintenance:cleanup` once through the normal maintenance schedule.
  If substantially the same failure repeats, stop and investigate the stable
  maintenance/database evidence; never repair it with row edits.
- `OFFBOARDED_ACCESS_REVOKED`: collect the receipt.

## 4. Receipt and retention inventory

```sh
npm run operator:offboarding -- receipt \
  --tenant "$TGE_TENANT_UUID" \
  --issuer "$TGE_OWNER_ISSUER" \
  --subject "$TGE_OWNER_SUBJECT"
```

`inventory` is an alias for `receipt`; `inspect` is an alias for `status`.
The terminal receipt is still bound to the original issuer/subject using the
privacy-preserving request hash because database memberships have been deleted.
It reports:

- request lifecycle and retry state;
- immutable deletion-evidence attempt count and latest success/failure status;
- raw batches/rows scrubbed;
- memberships revoked and invitations deleted;
- current counts/status for raw remnants, active memberships, invitations,
  canonical CRM, ID maps, audit evidence, and Pilot evidence;
- `externalActionsPerformed: false` unless database evidence truthfully says
  otherwise.

It never prints customer rows, subjects, emails, filenames, DSNs, tokens, or
raw payloads.

## 5. External and policy actions

Completion of the database receipt leaves these explicit gates:

1. Disable/delete the exact provider/Auth0 user through the approved provider
   process. This repository has no merged provider adapter for this action; do
   not duplicate provider authentication code or claim it was performed.
2. Obtain the legal/privacy decision for canonical CRM, ID-map, audit, and Pilot
   evidence retention or deletion. Database offboarding intentionally retains
   them.
3. Inventory application/provider logs and any exports. Their retention state
   is reported as unknown until external evidence establishes it.
4. Apply the approved backup expiry policy and reconcile any later restore so
   offboarded access/raw-evidence state is not resurrected. Backup expiry and
   restore reconciliation are external actions, not database receipt effects.

Do not perform canonical destructive deletion, provider deletion, backup
deletion, or production secret changes without their separate human gates.
