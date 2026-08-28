# Future Persistence Migration Plan (Plan Only)

This is intentionally plan-only. Do not migrate persistence until a dedicated change is approved.

## Target shape
Introduce a repository abstraction between routes/domain logic and storage. Keep local JSON as one adapter and add a transactional database adapter only after contracts are covered by tests.

## Required capabilities before migration
- Repository interfaces for opportunities, prospects, activities, tasks, and pipeline reads.
- Transaction support for multi-collection action mutations.
- Multi-process safety with locking or database transactions.
- Tenant isolation in all repository methods and queries.
- Schema migrations with forward/backward compatibility notes.
- Backups before migration and restore drills after migration.
- Rollback plan that can return to the previous stable adapter and data snapshot.
- Contract tests that run against JSON and the future adapter.
- E2E smoke that proves the closed-loop Command Center still works.

## Suggested sequence
1. Characterize existing JSON behavior with repository contract tests.
2. Introduce repositories without changing storage.
3. Move routes/actions behind repositories.
4. Add transaction boundaries around intelligence actions.
5. Add tenant-aware data access.
6. Add database adapter and migrations behind a feature flag.
7. Run dual-read or shadow verification before cutover.
8. Cut over only after backup, rollback, integration, E2E, and operational checks pass.
