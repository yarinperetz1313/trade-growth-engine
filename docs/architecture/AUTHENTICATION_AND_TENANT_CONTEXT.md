# Authentication and TenantContext boundary

Auth0 proves browser identity; Trade Growth Engine grants tenant access. The Pilot uses an Auth0 Australia tenant, New Universal Login, passwordless email OTP, and Authorization Code Flow with PKCE. It does not use magic links, Classic Login, Auth0 Organizations invitations, or public self-service signup.

## Request path

1. The browser SDK completes Authorization Code Flow with PKCE and keeps access tokens in memory. Production bootstrap invokes callback handling only on the exact allowlisted callback path with one non-empty `code`, one non-empty `state`, and no OAuth error parameters; the SDK remains responsible for state and PKCE verification. Direct or refreshed callback-path navigation without an OAuth response does not invoke callback handling. After a successful exchange, bootstrap replaces the consumed query and fragment with the callback path before rendering; malformed callbacks or failed URL cleanup fail closed. Protected requests obtain a fresh bearer from the memory-only SDK provider rather than accepting caller-authored authority.
2. The API validates the bearer token against one exact HTTPS issuer, one audience, the issuer's exact JWKS endpoint, and RS256. Expiry, issued-at time, and subject are required.
3. The server queries active memberships by the validated `(issuer, subject)` pair. Zero or multiple active memberships fail closed.
4. Exactly one result creates an immutable `TenantContext` containing only `tenantId`, `issuer`, `subject`, and canonical role.
5. The centralized role policy authorizes the operation. Sensitive invitation and membership changes also cross an injected reauthentication/MFA-ready policy boundary.
6. A production repository transaction receives the trusted context and sets transaction-local PostgreSQL context. Request fields, headers, query parameters, email, JWT custom tenant claims, and role claims never select a tenant or role.

`src/auth/postgresAuthRepository.js` persists membership and invitation operations through the same PR-3 PostgreSQL runtime role and transaction assumptions. For CRM requests, `src/app/server.js` first validates the independently branded auth `TenantContext`, then mints a separate trusted persistence `TenantContext` from its tenant ID, identity issuer, and subject. The PostgreSQL routers receive only that persistence context. When auth mode is enabled without the PostgreSQL adapter/bridge, business APIs return `503 TENANT_PERSISTENCE_UNAVAILABLE` rather than exposing unscoped JSON data.

## Role policy

| Permission | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| Read and update ordinary CRM work | Yes | Yes | Yes |
| Operational administration | Yes | Yes | No |
| Invitation and membership administration | Yes, with sensitive-action policy | No | No |
| Ownership transfer | Yes, with a future locked ownership workflow | No | No |

Authorization failures are generic. A cross-tenant identifier and a nonexistent identifier must not create distinguishable API responses.

## Assisted invitations

An OWNER can authorize an expiring invitation for an `ADMIN` or `MEMBER`, but the production Pilot application keeps invitation create/revoke behind the unavailable sensitive-action policy until a real step-up contract exists. It exposes no provisioning route. External Pilot One instead uses the explicit [identity operator runbook](../operations/IDENTITY_OPERATOR_RUNBOOK.md): a privileged, serializable, dry-run/apply command performs the assisted operation without broadening the runtime role.

The server-only Auth0 provisioning adapter requires one exact issuer, same-origin Management API base, passwordless email connection, and injected access-token provider. It reconciles one exact email identity, creates only when none exists, fails closed on ambiguity/provider/configuration errors, and never logs provider responses or credentials. The operator transaction creates the pending invitation with the provider-returned exact issuer and subject already present. It returns the random invitation capability only through an exclusive `0600` output file and persists only its SHA-256 hash. Retry uses the same operation UUID and exact facts; conflicting reuse fails closed.

The invitation landing page requires an explicit POST before authentication starts. After Universal Login email OTP, the callback is processed by the Auth0 SPA SDK, which verifies OAuth state and the PKCE exchange. The API validates the resulting access token again. Creation and consumption first take a terminal-aware shared tenant-row lock before inserting or locking invitation children. Consumption then locks the pending invitation and atomically activates the matching membership, marks the invitation consumed, and appends audit evidence. A completed access offboarding cannot retain a concurrent invitation or regain membership from residual invitation evidence. Expired, revoked, replayed, mismatched, ambiguous, terminal-tenant, and conflicting membership attempts return the same generic failure.

Application invitation tokens are capabilities, not identity. Successful consumption requires both the high-entropy token and the provisioned Auth0 `(issuer, subject)` match.

## Browser session and recovery

The invitation is read only from a bounded fragment route. Passive landing performs no API or provider action. An explicit continue action proves server availability, then Auth0 receives only the bounded invitation token and return route in SDK `appState`. After the exact callback is consumed and scrubbed, the browser sends a fresh in-memory access token to invitation acceptance before requesting membership-derived context. It renders the authenticated application only after both operations succeed.

Returning users have an explicit login action and authenticated users have an explicit logout action. Uninvited, wrong-user, expired, revoked, and replayed cases share generic unavailable presentation. Missing or malformed callback `appState` produces an interrupted state that instructs the user to restart from the original invitation. Neither recovery nor navigation reads tenant/role claims, persists access tokens, offers signup, or chooses a tenant.

## Operator bootstrap and revocation

The first tenant/OWNER bootstrap is idempotent only for one exact tenant UUID, slug, name, issuer, subject, active OWNER membership, and non-terminal tenant. Any partial, conflicting, multiple-tenant, or multiple-membership state fails closed. Dry-run and exact apply confirmation are mandatory.

Individual membership revocation requires one active same-tenant OWNER actor and an exact same-tenant target. A serializable transaction rejects terminal/offboarding tenants, cross-tenant or multiple membership state, inactive ambiguity, and removal of the last active OWNER. Pending invitation revocation uses the same actor and terminal safeguards. Both mutations append privacy-minimized audit evidence and make exact completed replay idempotent.

## Deployment-gated acceptance

Local tests prove deterministic token, membership, policy, redirect, provider-port, replay, operator, and PostgreSQL transaction contracts without provider calls. The real flow remains a deployment gate until a dedicated AU non-production Auth0 tenant, approved plan/entitlement, custom domain/SMTP settings, Management API client with only `read:users` and `create:users`, enabled email connection, and email-capture credentials exist. A published price/capability does not prove live entitlement; custom-domain credit-card verification must be completed if that route is approved.

The deployment test must start its message window before triggering New Universal Login, retrieve only the latest email created after that point, submit the latest OTP, prove earlier/replayed OTP rejection, prove invited activation, prove a provisioned-but-uninvited identity receives no `TenantContext`, verify exact callback/logout origins, and remove generated identities, invitations, and messages. Local seams are not evidence that Auth0 or SMTP has been provisioned.
