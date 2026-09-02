## Objective

Describe the single engineering objective this PR delivers.

## Related issue

Closes #

## What changed

Summarize the material code, schema, test, documentation, or operational changes.

## Architecture / contract impact

- Contracts changed:
- Contracts intentionally preserved:
- Migrations / compatibility impact:

## Security / tenant-isolation impact

- Authentication / authorization impact:
- Tenant-boundary impact:
- Secrets / external systems impact:
- New threat surface or mitigations:

## Verification

List the exact commands and outcomes, including counts where applicable.

```text
npm run test:harness
npm run test:integration
npm run test:db
npm run test:e2e
npm run build
git diff --check
```

GitHub Actions run:

## Review evidence

- Fresh-context review:
- Security/database review if applicable:
- Material findings fixed:

## Known limitations / non-goals

State anything intentionally not implemented in this PR.

## Rollback / recovery notes

Describe rollback considerations for migrations, data, external side effects, or deployment changes. Use `N/A` only when truly not applicable.

## Merge gate

- [ ] Linked issue acceptance criteria satisfied
- [ ] Required `verify` check green
- [ ] No unresolved material review findings
- [ ] No direct push or merge bypass of protected `main`
