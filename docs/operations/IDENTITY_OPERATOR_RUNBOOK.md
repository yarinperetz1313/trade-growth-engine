# External Pilot identity operator runbook

This runbook is the assisted boundary for the first Pilot tenant, Auth0-backed invitations, invitation revocation, and individual membership revocation. It does not authorize provider provisioning, production credentials, a customer identity, or release by itself.

## Authority and output rules

- Run `npm run identity:operator -- <command>` only from a reviewed build at the expected commit.
- `TGE_IDENTITY_OPERATOR_DATABASE_URL` is explicit and never falls back to `DATABASE_URL` or the runtime DSN. The connected login must be an approved PostgreSQL operator with `SUPERUSER` or `BYPASSRLS`; ordinary `tge_runtime`, `tge_maintenance`, and browser identities are rejected.
- Every mutation is dry-run by default. Apply requires both `--apply` and the command-specific exact confirmation below.
- Standard output contains only operation, mode, stable status, and whether a capability file was written. It never contains the DSN, token, email, issuer, subject, tenant name/slug, or provider response.
- Invitation capability output is created as a new absolute-path file with mode `0600`. Transfer its URL through the approved private channel, then remove the file under the approved evidence-retention policy. Never paste it into tickets, chat, screenshots, shell history, or general logs.
- Database audit payloads contain roles/status and SHA-256 identity fingerprints. Actor subject remains only in the canonical audit actor column where accountability requires it; invitee email and raw provider responses are absent from audit payloads.

## Commands

### First tenant and OWNER

Required environment: `TGE_IDENTITY_OPERATOR_DATABASE_URL`, `TGE_IDENTITY_TENANT_ID` (operator-generated UUID), `TGE_IDENTITY_TENANT_SLUG`, `TGE_IDENTITY_TENANT_NAME`, `TGE_IDENTITY_ISSUER`, and `TGE_IDENTITY_SUBJECT`.

1. Run `npm run identity:operator -- bootstrap` and require `WOULD_APPLY` or the exact idempotent `ALREADY_APPLIED` state.
2. Recheck that this is the intended empty Pilot database and that issuer and subject came from the approved Auth0 tenant rather than an email, claim, or browser value.
3. Apply with `npm run identity:operator -- bootstrap --apply --confirm=BOOTSTRAP_FIRST_TENANT`.

The serializable transaction refuses an existing non-exact tenant, partial bootstrap, multiple tenant/membership state, terminal tenant, non-OWNER role, inactive membership, or issuer/subject conflict.

### Provision and create an invitation

Required TGE environment: operator DSN, tenant ID, operation UUID, active OWNER actor issuer/subject, invitee email, `ADMIN` or `MEMBER` role, future expiry, absolute exclusive output path, and exact public app HTTPS origin.

Required Auth0 environment: exact AU `TGE_AUTH0_ISSUER`, same-origin `/api/v2/` Management API base, exact passwordless email connection name, and a just-in-time `TGE_AUTH0_MANAGEMENT_TOKEN`. The machine-to-machine client is limited to `read:users` and `create:users`; enable only the intended email connection. Do not grant update/delete users or tenant administration scopes to this command.

1. Run `npm run identity:operator -- invite`. Dry-run validates required non-secret configuration and makes no provider or database mutation.
2. Confirm provider/vendor/privacy approval, intended identity, expiry, role, operation UUID, exclusive output path, and private delivery route.
3. Apply with `npm run identity:operator -- invite --apply --confirm=CREATE_PROVISIONED_INVITATION`.

On apply, the command validates every input and provider setting, then exclusively reserves the new capability file at mode `0600` before constructing the database pool. A read-only serializable preflight proves the database login is an approved privileged operator and that the actor is the one exact active same-tenant OWNER. Only then may provider access begin; the final database transaction repeats the tenant/OWNER/terminal checks to close the race window.

The server-only adapter first reconciles an exact single Auth0 user by normalized email; zero matches creates one passwordless-email user; multiple/malformed matches fail closed. Every lookup, create, and conflict-reconciliation success must contain exactly one Auth0 identity whose connection equals `TGE_AUTH0_EMAIL_CONNECTION`, whose provider is `email`, and whose provider/user identifier reconstructs the authoritative top-level subject exactly. Missing, linked/ambiguous, wrong-connection, wrong-provider, or conflicting subject evidence is denied. A provider conflict is reread once. The database transaction records the exact returned issuer and subject in the initial pending invitation insert, so no invitation becomes begin-able before authoritative identity binding. The same operation UUID plus exact facts reconciles without issuing another capability; conflicting operation reuse or another pending invitation for the same identity is denied.

Missing, invalid, or already-existing capability output fails before database/provider access. Denied preflight removes only the exact empty file reserved by this process and makes no provider or application-data mutation. If the process is interrupted and leaves its reserved file, first prove that process has stopped and keep any non-empty file private. An empty reservation can be removed before rerunning the same operation UUID and exact facts. If the provider succeeded but the database did not, that rerun reconciles the provider identity and may complete normally. If the database had already succeeded, the rerun reports `RECONCILED` without a capability; revoke that invitation and start a new operation UUID because the stored hash cannot recover the old capability.

### Revoke a pending invitation

Required environment: operator DSN, tenant ID, invitation UUID, and exact active OWNER actor issuer/subject.

1. Dry-run: `npm run identity:operator -- revoke-invitation`.
2. Apply: `npm run identity:operator -- revoke-invitation --apply --confirm=REVOKE_INVITATION`.

Only a same-tenant pending invitation can change. Exact revoked replay is idempotent; consumed, cross-tenant, missing, terminal-tenant, non-OWNER, or ambiguous state is denied generically.

### Revoke one membership

Required environment: operator DSN, tenant ID, and exact actor and target issuer/subject pairs.

1. Dry-run: `npm run identity:operator -- revoke`.
2. Apply: `npm run identity:operator -- revoke --apply --confirm=REVOKE_MEMBERSHIP`.

The transaction requires one active same-tenant OWNER actor and one exact same-tenant target. It rejects cross-tenant/multiple membership, suspended or ambiguous state, a terminal/offboarding tenant, and removal of the last active OWNER. Exact revoked replay is idempotent.

## Application and provider gates

The Pilot application does not expose provisioning. Invitation create/revoke routes retain the unavailable sensitive-action policy and return `ACCESS_DENIED`; do not replace it with a header, claim, fixed assurance value, or test policy. Browser signup, Auth0 Organizations, tenant switching, browser tenant claims, and local-storage token authority remain unsupported.

Before external use, separately prove the exact issuer, API audience, JWKS, callback/logout/origin allowlists, AU tenant locality, New Universal Login email OTP, SMTP/sender controls, Management API client/connection/scopes, and cleanup. Current public Auth0 pricing or documented capability is not live entitlement: confirm the chosen plan, and account for credit-card verification required for a custom domain. Privacy/DPA, legal retention/deletion, customer identity, operator credential provisioning, and real email/OTP acceptance remain human/external gates.
