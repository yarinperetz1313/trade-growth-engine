# External Pilot Deployment and Operations

This runbook is the credential-independent foundation for one assisted Australian pilot. It defines what an operator must render and verify; it does **not** provision, update, or delete provider resources. The sanitized source template is [`../../deploy/gcp/pilot-deployment.template.json`](../../deploy/gcp/pilot-deployment.template.json).

## Fixed release contract

- Build the API/jobs artifact from the root `Dockerfile`. Both stages pin `node:22.22.0-bookworm-slim`; dependency installation is lockfile-exact and omits development dependencies and lifecycle scripts. The runtime is non-root and starts the existing Pilot API directly so `SIGTERM` reaches Node.
- Publish only an immutable Melbourne Artifact Registry digest. Replace `${MELBOURNE_IMAGE_URI_BY_DIGEST}` only with `australia-southeast2-docker.pkg.dev/.../trade-growth-engine@sha256:<64 lowercase hex>`.
- Build the separately hosted browser with an exact HTTPS API origin:

  ```sh
  TGE_PUBLIC_API_URL=https://api.example.test \
  VITE_API_URL=https://api.example.test \
  npm run verify:pilot-release
  ```

  The gate deletes prior `dist/` output, runs `build:pilot`, verifies the requested origin in the artifact, and validates the container and deployment contracts. It performs no cloud API call and requires no provider credentials.

## Render and review before provisioning

1. Copy the template outside the repository and replace project, image, URL, and Auth0 public placeholders. Do not place a DSN, token, password, private key, or service-account key in the rendered file.
2. Create four distinct service accounts: runtime, migrator, maintenance, and scheduler invoker. Do not grant runtime either migration or maintenance authority. Prefer workload identity; do not download service-account keys.
3. Create three Secret Manager secrets containing the runtime, migrator, and maintenance PostgreSQL URLs. Pin deployed revisions to explicit secret versions. The runtime service may access only its runtime URL; each job may access only its matching URL.
4. Review IAM with a second operator. The scheduler identity may invoke only the maintenance job. The runtime service is publicly invokable because liveness, readiness, Auth0 public configuration, and bearer-authenticated APIs share the HTTPS origin; application authentication and tenant authority still fail closed.
5. Run `npm run validate:pilot-deployment` against the checked-in sanitized template. Apply the rendered provider configuration only after provider, privacy/DPA, billing, domain, and identity approvals are recorded.

The checked-in template fixes Cloud Run, Cloud SQL for PostgreSQL 16, Scheduler, and backups in `australia-southeast2` (Melbourne). It explicitly selects Cloud SQL `ENTERPRISE` with non-shared-core `db-custom-1-3840`; PostgreSQL 16 must not inherit the provider's Enterprise Plus default, and `db-f1-micro`/`db-g1-small` are rejected because shared-core instances have no Cloud SQL SLA. This is a reviewable pilot baseline, not cost approval. Cloud SQL has no authorized network, requires encrypted transport, enables point-in-time recovery, protects deletion, places backups in Melbourne, and retains 14 daily backups. Reverify current provider capability, SLA, price, quota, and semantics immediately before a human applies the rendered configuration.

## Release sequence

1. Record the source commit and immutable image digest. Run the release gate above.
2. Execute the migrator job with the migrator identity and `TGE_DATABASE_URL`. Require exit 0 and retain only the migration identifiers/checksums—never the DSN.
3. Deploy a new API revision with **no traffic**, the runtime identity, and `TGE_RUNTIME_DATABASE_URL`. Probe its revision URL; direct traffic only after `/health/live` returns 200 and `/health/ready` returns 200. Readiness proves the local runtime role/schema/membership path only; it does not prove real Auth0 OTP, SMTP, backups, or customer acceptance.
4. Execute the maintenance job once with the maintenance identity before enabling its scheduler. Require `status: "drained"` and exit 0. Exit 2 means a failed/retryable item requires operator action; exit 3 means the bounded run observed possible remaining or locked backlog and must be investigated or safely rerun.
5. Enable the Melbourne-time scheduler only after the manual job passes. Keep Cloud Run job automatic retries at zero because the script owns bounded, idempotent retries and produces an explicit nonzero result.
6. Deploy the browser artifact only after its exact API origin, Auth0 callback/logout allowlists, HTTPS certificate, and CORS origin are independently checked.

## Privacy-safe diagnostics and alerts

Cloud logging should parse JSON from the API platform and maintenance stdout. Do not add request bodies, authorization headers, DSNs, emails, subjects, tenant IDs, batch IDs, request IDs, raw import cells, or provider tokens to logs or alert labels.

| Signal | Alert | First operator action |
| --- | --- | --- |
| `/health/ready` is non-200 for 5 minutes while `/health/live` is 200 | `PILOT_READINESS_UNAVAILABLE` | Inspect stable runtime lifecycle codes and Cloud SQL connectivity/role/schema state; do not expose the DSN. |
| API 5xx is nonzero for 5 minutes | `PILOT_API_5XX` | Correlate revision/time window only, then check readiness and bounded application error codes. |
| Maintenance job exits 2 or 3 | `PILOT_MAINTENANCE_ACTION_REQUIRED` | Read the minimized counts, oldest processed state, and backlog status; do not query customer/raw data into logs. |
| Latest successful AU backup is older than 24 hours | `PILOT_BACKUP_STALE` | Stop release progression, restore backup operation, then rehearse recovery. |

`oldestProcessed` exposes only state, retryable truth, and attempt count for the first ordered item returned by the existing maintenance functions. `backlogStatus: "retryable_or_failed"` is an explicit operator-action state. `backlogStatus: "none_observed"` is bounded-run evidence, not a promise that concurrent locked work does not exist.

## Backup, restore, rollback, and incidents

- Before external data, prove a full Cloud SQL restore into a temporary Melbourne instance, then perform the separately documented logical selected-tenant export/restore. Record timestamps showing RPO at most 24 hours and RTO at most 4 business hours. Never describe that procedure as native tenant restore.
- Roll application code back by routing traffic to the last recorded healthy immutable revision. Never roll a database schema backward automatically. Append-only forward remediation requires review and a fresh migrator execution.
- A readiness failure, maintenance nonzero exit, stale backup, suspected tenant boundary breach, or secret exposure pauses invites and data ingestion. Preserve privacy-minimized logs, revoke traffic/access as approved, and escalate to the named operator/security owner.
- Offboarding currently revokes access and scrubs raw evidence only. Canonical tenant-data deletion remains blocked on the approved legal/contractual retention policy and must not be represented as complete deletion.

## External gates still open

Provider accounts, payment, IAM creation, Secret Manager values, Cloud SQL provisioning, real Auth0 Australia and SMTP/OTP acceptance, DNS/certificates, privacy/DPA approval, retention/deletion policy, alert-channel wiring, observed backups, destructive restore rehearsal, and real-customer evidence all require explicit human action and retained redacted evidence.
