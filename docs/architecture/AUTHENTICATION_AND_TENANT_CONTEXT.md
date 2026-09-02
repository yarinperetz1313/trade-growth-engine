# Authentication and TenantContext boundary

Auth0 proves browser identity; Trade Growth Engine grants tenant access. The Pilot uses an Auth0 Australia tenant, New Universal Login, passwordless email OTP, and Authorization Code Flow with PKCE. It does not use magic links, Classic Login, Auth0 Organizations invitations, or public self-service signup.

## Request path

1. The browser SDK completes Authorization Code Flow with PKCE and keeps access tokens in memory. Production bootstrap invokes callback handling only on the exact allowlisted callback path with one non-empty `code`, one non-empty `state`, and no OAuth error parameters; the SDK remains responsible for state and PKCE verification. Direct or refreshed callback-path navigation without an OAuth response does not invoke callback handling. After a successful exchange, bootstrap replaces the consumed query and fragment with the callback path before rendering; malformed callbacks or failed URL cleanup fail closed. Protected requests obtain a fresh bearer from the memory-only SDK provider rather than accepting caller-authored authority.
2. The API validates the bearer token against one exact HTTPS issuer, one audience, the issuer's exact JWKS endpoint, and RS256. Expiry, issued-at time, and subject are required.
3. The server queries active memberships by the validated `(issuer, subject)` pair. Zero or multiple active memberships fail closed.
4. Exactly one result creates an immutable `TenantContext` containing only `tenantId`, `issuer`, `subject`, and canonical role.
5. The centralized role policy authorizes the operation. Sensitive invitation and membership changes also cross an injected reauthentication/MFA-ready policy boundary.
6. A production repository transaction receives the trusted context and sets transaction-local PostgreSQL context. Request fields, headers, query parameters, email, JWT custom tenant claims, and role claims never select a tenant or role.

`src/auth/postgresAuthRepository.js` persists membership and invitation operations through the same PR-3 PostgreSQL runtime role and transaction assumptions. For CRM requests, `src/app/server.js` first validates the independently branded auth `TenantContext`, then mints a separate trusted persistence `TenantContext` from only its tenant ID and subject. The PostgreSQL routers receive only that persistence context. When auth mode is enabled without the PostgreSQL adapter/bridge, business APIs return `503 TENANT_PERSISTENCE_UNAVAILABLE` rather than exposing unscoped JSON data.

## Role policy

| Permission | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| Read and update ordinary CRM work | Yes | Yes | Yes |
| Operational administration | Yes | Yes | No |
| Invitation and membership administration | Yes, with sensitive-action policy | No | No |
| Ownership transfer | Yes, with a future locked ownership workflow | No | No |

Authorization failures are generic. A cross-tenant identifier and a nonexistent identifier must not create distinguishable API responses.

## Assisted invitations

An OWNER creates an expiring invitation for an `ADMIN` or `MEMBER`. The application returns the random token once and persists only its SHA-256 hash. A server-only provisioning policy records the exact expected Auth0 issuer and subject; browser callers cannot invoke that operation.

The invitation landing page requires an explicit POST before authentication starts. After Universal Login email OTP, the callback is processed by the Auth0 SPA SDK, which verifies OAuth state and the PKCE exchange. The API validates the resulting access token again. Consumption locks the pending invitation and atomically activates the matching membership, marks the invitation consumed, and appends audit evidence. Expired, revoked, replayed, mismatched, ambiguous, and conflicting membership attempts return the same generic failure.

Application invitation tokens are capabilities, not identity. Successful consumption requires both the high-entropy token and the provisioned Auth0 `(issuer, subject)` match.

## Deployment-gated acceptance

Local tests prove deterministic token, membership, policy, redirect, replay, and transaction contracts. The real flow remains a deployment gate until a dedicated AU non-production Auth0 tenant, custom domain/SMTP settings, and email-capture credentials exist.

The deployment test must start its message window before triggering New Universal Login, retrieve only the latest email created after that point, submit the latest OTP, prove earlier/replayed OTP rejection, prove invited activation, prove a provisioned-but-uninvited identity receives no `TenantContext`, verify exact callback/logout origins, and remove generated identities, invitations, and messages. Local seams are not evidence that Auth0 or SMTP has been provisioned.
