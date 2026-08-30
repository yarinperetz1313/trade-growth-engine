# Legacy JSON Compatibility Contract

**PR-1 is complete:** it characterizes the local JSON contract without changing production persistence, tenancy, or product behavior. PR-2 is the exact next implementation handoff: introduce tenant-scoped, transactional production persistence while keeping these observable semantics.

## Authoritative observable semantics

| Area | Contract to preserve |
| --- | --- |
| Local store | `LOCAL_STORE_DIR` selects the isolated store; a missing collection reads as `[]`; writes replace the whole `<collection>.json` file. `createRecord` accepts caller-provided `id` and timestamps; `updateRecord` retains other fields and caller-mutated `id`/`created_at`, but always refreshes `updated_at`. |
| Value meaning | Deal intelligence keeps absent evidence unknown (`null`). Revenue intelligence treats only positive finite values as known; `null`, missing, blank, `unknown`, non-numeric, and zero values are unknown commercial value—not `$0`. By contrast, legacy analytics `calculatePipelineEconomics` coerces non-finite `sales.quoteValue` inputs to zero. |
| Relationships and ordering | Deal intelligence resolves linked prospects by `prospect_id`, activities/tasks by `opportunity_id`, and selects latest activity/task by descending `created_at`. Revenue intelligence excludes `WON`/`LOST`; its ranked actions use deterministic priority criteria and finish ties by `opportunity_id`. RevenueAction history sorts descending `created_at`. |
| RevenueAction | Materialization reuses an active action only when opportunity, semantic action type, and basis fingerprint match. Both `WON` and `LOST` opportunities are refused at materialization. An `APPROVED` action with any persisted effects is rejected before execution; `EXECUTING`/`FAILED` actions with one complete, matching set of effects reconcile to `EXECUTED`; multiple linked effects are rejected. JSON multi-file effects are recovery-oriented, not transactional. |

The deterministic fixture set at [`test/fixtures/legacy-json-compat/`](../../test/fixtures/legacy-json-compat/) and its integration characterization test are the executable compatibility evidence. They characterize the listed local-store mutation, value, analytics, ordering, and RevenueAction scenarios—including complete-effect recovery plus approved-action partial/multiple-effect rejection. They do not prove crash timing, concurrent-writer safety, partial-effect recovery, or a production adapter; those are PR-2 requirements.

## PR-2 repository boundary

`TenantContext` is server-resolved from membership and is never created from a client-supplied tenant ID. Every production lookup, list, insert, update, delete, relation traversal, and idempotency lookup receives it and applies tenant scope before returning or mutating data.

```text
repository.withTransaction(context, work)
repository.opportunities.get(context, opportunityId)
repository.opportunities.update(context, opportunityId, patch)
repository.activities.listByOpportunity(context, opportunityId)
repository.tasks.findEquivalentOpen(context, actionIdentity)
repository.revenueActions.findActiveDuplicate(context, opportunityId, actionType, fingerprint)
```

The PR-2 transaction boundary encloses the RevenueAction closed loop: read scoped opportunity/intelligence evidence → validate fingerprint/lifecycle → persist `EXECUTING` request → create or reconcile exact task/activity effects and intended opportunity mutation → finalize action. PostgreSQL RLS is set transaction-locally from this server-owned context; application predicates, RLS, and negative cross-tenant tests are all required. The JSON adapter remains local/test compatible and does not acquire a fabricated `tenant_id` field.

## One-way JSON-to-PostgreSQL manifest (planned PR-2 adapter contract)

Before cutover, generate a versioned manifest for one read-only JSON snapshot. Preserve each source identifier as `legacy_id` (unique with `tenant_id`); use a new database primary key only if the implementation requires one. Preserve source timestamps and unmodeled fields in `legacy_payload`; never normalize away evidence during import.

### Target authorization is mandatory

Legacy JSON source records are tenantless. The manifest therefore records **target import authorization evidence**, not a caller-supplied source tenant identity. The import service resolves the target `TenantContext` on the server before generating or accepting a manifest; it must refuse manifest generation and import when verified membership or target authorization is absent.

| Required manifest field | Requirement |
| --- | --- |
| `target_tenant_id` | The tenant ID resolved by the server for this target import. It is never copied from a legacy record or accepted as caller authority. |
| `authorized_by_subject_id` **or** `authorization_reference` | The authenticated subject that authorized the import, or an immutable operator/membership authorization reference that can be audited later. |
| `authorization_verified_at` | Server-recorded timestamp for the successful membership and target-authorization check. |
| `authorization_refusal` | Required refusal evidence when membership or target authorization is absent; no target manifest or import may proceed. |

| Legacy collection | PostgreSQL target | Field/relationship mapping |
| --- | --- | --- |
| `prospects` | `prospects` | `id → legacy_id`; `created_at`/`updated_at → source_*_at`; known CRM fields → typed columns; remaining source fields → `legacy_payload`. |
| `opportunities` | `opportunities` | `id → legacy_id`; `prospect_id → prospect legacy-id lookup in the same tenant`; stage, priority, value, probability, weighted value, next action, and timestamps retain source values; unmodeled fields → `legacy_payload`. |
| `activities` | `activities` | `id → legacy_id`; `opportunity_id`/`prospect_id → scoped legacy-id lookups`; type, description, metadata, and timestamps are retained. |
| `tasks` | `tasks` | `id → legacy_id`; `opportunity_id → scoped legacy-id lookup`; title, description, due/completed status, priority, metadata, and timestamps are retained. |
| `revenue_actions` | `revenue_actions` | `id → legacy_id`; `opportunity_id → scoped legacy-id lookup`; lifecycle fields, fingerprint, immutable snapshot, evidence, prepared execution, audit, execution result, and resulting task/activity legacy IDs are retained. |

The manifest records: the mandatory target authorization fields above; snapshot path and SHA-256; collection counts and per-collection SHA-256; source-to-target ID map; required-relationship results; positive/zero/unknown-value counts; RevenueAction lifecycle/fingerprint/effect-link results; and an exception ledger with source collection, legacy ID, reason, disposition, and operator approval.

**Cutover evidence:** signed manifest, successful scoped import, count/checksum comparison, relationship and unknown-value comparison, idempotency/effect-link reconciliation, transaction/RLS negative tests, and a post-cutover read-only comparison. There is no dual write. **Rollback evidence:** immutable source snapshot, manifest, target migration version, approved restore procedure, and proof that the application can return to the previous stable adapter before accepting new production writes.

## Legacy anomaly policy

| Condition | Required disposition |
| --- | --- |
| Zero, missing, `null`, blank, `unknown`, or non-numeric commercial values | Preserve source representation and report semantic classification; do not coerce to a known value. |
| Missing, dangling, or cross-collection relationship IDs | Report and block or explicitly quarantine; never relink to a “closest” record. |
| Duplicate/missing legacy IDs, invalid JSON, or malformed timestamps | Reject the affected import and record the exception; never generate replacement source IDs silently. |
| Equal/invalid ordering timestamps | Preserve raw values and report ordering ambiguity; do not invent chronology. |
| RevenueAction with invalid lifecycle, fingerprint, or task/activity effect link | Report and block/quarantine the action; never mark it executed, deduplicate it, or repair links silently. |
| Unmodeled fields or historically mutable IDs/creation timestamps | Retain in `legacy_payload` and the manifest; the snapshot cannot reconstruct missing history. |

## PR-2 acceptance handoff

PR-2 may begin only with the active-plan gates resolved. It is accepted when tenant-aware interfaces are implemented, all production reads/mutations are server-scoped, RevenueAction closed-loop mutations are transactional, PostgreSQL RLS and cross-tenant negative tests pass, the JSON adapter passes this characterization suite unchanged, and a dry-run manifest/rollback rehearsal produces the evidence above. It does **not** include UI, auth/provisioning, dependency, or PR-3+ work.
