const { hashImportEvidence } = require("../../imports/csvParser");
const { TARGETS } = require("../../imports/importMapping");
const {
  activityToRow,
  encodeColumnValue,
  opportunityToRow,
  prospectToRow,
  taskToRow
} = require("./mappers");

const PREVIEW_ROW_LIMIT = 100;

const CANONICAL_TARGETS = Object.freeze({
  prospects: Object.freeze({
    table: "prospects",
    targetColumn: "target_prospect_id",
    toRow: prospectToRow,
    references: []
  }),
  opportunities: Object.freeze({
    table: "opportunities",
    targetColumn: "target_opportunity_id",
    toRow: opportunityToRow,
    references: [{ field: "prospect_id", table: "prospects", required: false }]
  }),
  tasks: Object.freeze({
    table: "tasks",
    targetColumn: "target_task_id",
    toRow: taskToRow,
    references: [{ field: "opportunity_id", table: "opportunities", required: true }]
  }),
  activities: Object.freeze({
    table: "activities",
    targetColumn: "target_activity_id",
    toRow: activityToRow,
    references: [
      { field: "opportunity_id", table: "opportunities", required: true },
      { field: "prospect_id", table: "prospects", required: false }
    ]
  })
});

function createImportRepository(client, tenantId, checkpoint = async () => {}) {
  return {
    async stagePreview({ batch, records, auditEvent }) {
      const insertedBatch = await client.query(
        `insert into tge.import_batches (
           tenant_id, id, status, source_filename, source_sha256,
           authorized_by_subject_id, authorization_verified_at,
           preview_summary, raw_storage_key, raw_expires_at,
           metadata_retain_until, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $12
         )
         returning *`,
        [
          tenantId,
          batch.id,
          batch.status,
          batch.sourceFilename,
          batch.sourceSha256,
          batch.authorizedBySubjectId,
          batch.authorizationVerifiedAt,
          JSON.stringify(batch.previewSummary),
          batch.rawStorageKey,
          batch.rawExpiresAt,
          batch.metadataRetainUntil,
          batch.createdAt
        ]
      );

      const previewRecords = [];
      for (const record of records) {
        const inserted = await client.query(
          `insert into tge.import_staging_records (
             tenant_id, import_batch_id, id, source_collection, source_id,
             source_ordinal, raw_payload, raw_payload_sha256, disposition,
             idempotency_key, metadata, created_at, updated_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb,
             $12, $12
           )
           returning *`,
          [
            tenantId,
            batch.id,
            record.id,
            record.sourceCollection,
            record.sourceId,
            record.sourceOrdinal,
            JSON.stringify(record.rawPayload),
            record.rawPayloadSha256,
            record.disposition,
            record.idempotencyKey,
            JSON.stringify(record.metadata),
            batch.createdAt
          ]
        );
        if (previewRecords.length < PREVIEW_ROW_LIMIT) {
          previewRecords.push(mapRecord(inserted.rows[0]));
        }
      }

      await client.query(
        `insert into tge.audit_events (
           tenant_id, id, event_type, subject_id, entity_type, entity_id,
           payload, occurred_at, retain_until, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $8)`,
        [
          tenantId,
          auditEvent.id,
          auditEvent.eventType,
          auditEvent.subjectId,
          auditEvent.entityType,
          auditEvent.entityId,
          JSON.stringify(auditEvent.payload),
          auditEvent.occurredAt,
          auditEvent.retainUntil
        ]
      );

      return {
        batch: mapBatch(insertedBatch.rows[0]),
        records: previewRecords,
        previewRowLimit: PREVIEW_ROW_LIMIT
      };
    },

    async findPreview(batchId) {
      const batch = await client.query(
        `select * from tge.import_batches
         where tenant_id = $1 and id = $2`,
        [tenantId, batchId]
      );
      if (!batch.rows[0]) return null;
      const records = await client.query(
        `select * from tge.import_staging_records
         where tenant_id = $1 and import_batch_id = $2
         order by source_ordinal
         limit $3`,
        [tenantId, batchId, PREVIEW_ROW_LIMIT]
      );
      return {
        batch: mapBatch(batch.rows[0]),
        records: records.rows.map(mapRecord),
        previewRowLimit: PREVIEW_ROW_LIMIT
      };
    },

    async findAnalysisEvidence(batchId) {
      const batch = await client.query(
        `select * from tge.import_batches
         where tenant_id = $1 and id = $2`,
        [tenantId, batchId]
      );
      if (!batch.rows[0]) return null;
      const records = await client.query(
        `select * from tge.import_staging_records
         where tenant_id = $1 and import_batch_id = $2
         order by source_ordinal`,
        [tenantId, batchId]
      );
      return {
        batch: mapBatch(batch.rows[0]),
        records: records.rows.map(mapRecord)
      };
    },

    async commitCanonical(request) {
      validateRepositoryCommitRequest(request);
      const batchResult = await client.query(
        "select * from tge.lock_import_commit_batch($1::uuid, $2::text)",
        [tenantId, request.batchId]
      );
      if (!batchResult.rows[0]) return null;
      const lockedBatch = mapBatch(batchResult.rows[0]);
      const inputFingerprint = commitInputFingerprint(
        request.batchId,
        request.input,
        lockedBatch.previewSummary?.sourceCollection
      );
      if (lockedBatch.status === "COMMITTED") {
        if (
          lockedBatch.commitIdempotencyKey === request.input.idempotencyKey
          && lockedBatch.commitMetadata?.inputFingerprint === inputFingerprint
          && lockedBatch.commitMetadata?.result
        ) {
          return {
            ...structuredClone(lockedBatch.commitMetadata.result),
            batch: lockedBatch,
            reconciled: true
          };
        }
        const conflict = conflictResult(lockedBatch, "BATCH_ALREADY_COMMITTED", [{
          code: "BATCH_ALREADY_COMMITTED",
          batchId: request.batchId
        }]);
        await appendLifecycleConflictAudit(
          client,
          tenantId,
          lockedBatch,
          conflict,
          request,
          inputFingerprint
        );
        return conflict;
      }
      if (lockedBatch.status !== "PREVIEWED") {
        const conflict = conflictResult(lockedBatch, "IMPORT_LIFECYCLE_CONFLICT", [{
          code: "IMPORT_LIFECYCLE_CONFLICT",
          batchId: request.batchId,
          status: lockedBatch.status
        }]);
        return recordLifecycleConflict(
          client,
          tenantId,
          lockedBatch,
          conflict,
          request,
          inputFingerprint
        );
      }

      const stagedResult = await client.query(
        "select * from tge.lock_import_commit_records($1::uuid, $2::text)",
        [tenantId, request.batchId]
      );
      const evidence = {
        batch: lockedBatch,
        records: stagedResult.rows.map(mapRecord)
      };
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($2::text, 544743)) from (select $1::uuid) tenant_scope",
        [tenantId, `idempotency:${tenantId}:${request.input.idempotencyKey}`]
      );
      const existingIdempotency = await client.query(
        `select id from tge.import_batches
         where tenant_id = $1 and commit_idempotency_key = $2
           and id <> $3
         order by id
         limit 1`,
        [tenantId, request.input.idempotencyKey, request.batchId]
      );
      if (existingIdempotency.rows[0]) {
        return recordBlockedAttempt(
          client,
          tenantId,
          lockedBatch,
          {
            outcome: "CONFLICTED",
            requestFingerprint: inputFingerprint,
            rows: evidence.records.map(record => ({
              sourceOrdinal: record.sourceOrdinal
            })),
            summary: {
              total: evidence.records.length,
              committed: 0,
              skipped: 0,
              conflicted: evidence.records.length,
              failed: 0
            },
            conflicts: [{
              code: "IMPORT_IDEMPOTENCY_KEY_CONFLICT",
              batchId: existingIdempotency.rows[0].id
            }]
          },
          request,
          inputFingerprint
        );
      }
      const plan = request.prepare(evidence);
      if (!["READY", "CONFLICTED", "FAILED"].includes(plan?.outcome)) {
        throw new TypeError("Canonical import preparation returned an invalid outcome.");
      }
      if (plan.outcome !== "READY") {
        return recordBlockedAttempt(
          client,
          tenantId,
          lockedBatch,
          plan,
          request,
          inputFingerprint
        );
      }

      const target = CANONICAL_TARGETS[plan.sourceCollection];
      if (!target) {
        throw new TypeError("Canonical import preparation selected an unsupported target.");
      }
      const primaryRows = plan.rows.filter(row => row.disposition === "COMMITTED");
      await lockImportIdentities(client, tenantId, plan, primaryRows);

      const existingMaps = await findExistingMaps(
        client,
        tenantId,
        plan,
        primaryRows
      );
      const mapsByIdentity = new Map(
        existingMaps.map(row => [row.source_record_id, row])
      );
      const conflicts = [];
      const newRows = [];
      for (const row of primaryRows) {
        const existing = mapsByIdentity.get(row.sourceRecordId);
        if (!existing) {
          newRows.push(row);
          continue;
        }
        const mappedTarget = existing[target.targetColumn];
        if (
          existing.canonical_payload_sha256 === row.canonicalPayloadSha256
          && mappedTarget === row.canonicalTargetId
        ) {
          row.disposition = "EXACT_DUPLICATE";
          row.canonicalRecord = null;
          row.reconciledImportBatchId = existing.import_batch_id;
          continue;
        }
        conflicts.push({
          code: "SOURCE_IDENTITY_MAP_CONFLICT",
          sourceRecordId: row.sourceRecordId,
          sourceOrdinal: row.sourceOrdinal,
          mappedTargetId: mappedTarget,
          requestedTargetId: row.canonicalTargetId
        });
      }

      const targetIds = newRows.map(row => row.canonicalTargetId);
      const duplicateTargetIds = duplicates(targetIds);
      conflicts.push(...duplicateTargetIds.map(targetId => ({
        code: "CANONICAL_ID_COLLISION",
        targetId
      })));
      const existingTargets = duplicateTargetIds.length > 0
        ? []
        : await findCanonicalTargets(client, tenantId, target, targetIds);
      conflicts.push(...existingTargets.map(row => ({
        code: "CANONICAL_ID_COLLISION",
        targetId: row.id
      })));
      conflicts.push(...await findMissingReferences(
        client,
        tenantId,
        target,
        newRows
      ));
      conflicts.push(...await findCanonicalUniquenessConflicts(
        client,
        tenantId,
        target,
        newRows
      ));
      if (conflicts.length > 0) {
        const blocked = {
          ...plan,
          outcome: "CONFLICTED",
          conflicts,
          summary: {
            total: plan.rows.length,
            committed: 0,
            skipped: 0,
            conflicted: plan.rows.length,
            failed: 0
          }
        };
        return recordBlockedAttempt(
          client,
          tenantId,
          lockedBatch,
          blocked,
          request,
          inputFingerprint
        );
      }

      await client.query("SAVEPOINT canonical_import_materialization");
      let materializationConflict = null;
      let materializingRow = null;
      try {
        for (const row of newRows) {
          materializingRow = row;
          await checkpoint("beforeImportCanonicalInserted", {
            batchId: request.batchId,
            sourceOrdinal: row.sourceOrdinal,
            targetId: row.canonicalTargetId
          });
          await insertCanonicalRow(
            client,
            tenantId,
            target,
            row,
            plan,
            request.committedAt,
            request.batchId
          );
          await checkpoint("afterImportCanonicalInserted", {
            batchId: request.batchId,
            sourceOrdinal: row.sourceOrdinal,
            targetId: row.canonicalTargetId
          });
          await insertIdMap(client, tenantId, target, row, plan, request);
          await checkpoint("afterImportIdMapInserted", {
            batchId: request.batchId,
            sourceOrdinal: row.sourceOrdinal,
            targetId: row.canonicalTargetId
          });
        }
        await client.query("RELEASE SAVEPOINT canonical_import_materialization");
      } catch (error) {
        materializationConflict = canonicalMaterializationConflict(
          error,
          materializingRow
        );
        if (!materializationConflict) throw error;
        await client.query("ROLLBACK TO SAVEPOINT canonical_import_materialization");
        await client.query("RELEASE SAVEPOINT canonical_import_materialization");
      }
      if (materializationConflict) {
        return recordBlockedAttempt(
          client,
          tenantId,
          lockedBatch,
          {
            ...plan,
            outcome: "CONFLICTED",
            conflicts: [materializationConflict],
            summary: {
              total: plan.rows.length,
              committed: 0,
              skipped: 0,
              conflicted: plan.rows.length,
              failed: 0
            }
          },
          request,
          inputFingerprint
        );
      }

      const resultRows = plan.rows.map(row => ({
        sourceOrdinal: row.sourceOrdinal,
        sourceRowNumber: row.sourceRowNumber,
        sourceRecordId: row.sourceRecordId,
        targetId: row.canonicalTargetId,
        canonicalPayloadSha256: row.canonicalPayloadSha256,
        disposition: row.disposition,
        ...(row.duplicateOfSourceOrdinal == null
          ? {}
          : { duplicateOfSourceOrdinal: row.duplicateOfSourceOrdinal }),
        ...(row.reconciledImportBatchId
          ? { reconciledImportBatchId: row.reconciledImportBatchId }
          : {})
      }));
      const summary = {
        total: resultRows.length,
        committed: resultRows.filter(row => row.disposition === "COMMITTED").length,
        skipped: resultRows.filter(row => row.disposition === "EXACT_DUPLICATE").length,
        conflicted: 0,
        failed: 0
      };
      for (const row of plan.rows) {
        await client.query(
          `select tge.record_import_commit_outcome(
             $1::uuid, $2::text, $3::text, $4::text, $5::timestamptz,
             $6::jsonb
           )`,
          [
            tenantId,
            request.batchId,
            row.stagingRecordId,
            row.disposition,
            request.committedAt,
            JSON.stringify({
              canonical_payload_sha256: row.canonicalPayloadSha256,
              source_system: plan.sourceSystem,
              source_record_id: row.sourceRecordId,
              target_id: row.canonicalTargetId,
              ...(row.duplicateOfSourceOrdinal == null
                ? {}
                : { duplicate_of_source_ordinal: row.duplicateOfSourceOrdinal }),
              ...(row.reconciledImportBatchId
                ? { reconciled_import_batch_id: row.reconciledImportBatchId }
                : {})
            })
          ]
        );
      }
      await checkpoint("afterImportRowOutcomesRecorded", {
        batchId: request.batchId
      });

      const storedResult = {
        outcome: "COMMITTED",
        batch: { id: request.batchId, status: "COMMITTED" },
        rows: resultRows,
        summary,
        reconciled: false
      };
      const commitMetadata = {
        inputFingerprint,
        requestFingerprint: plan.requestFingerprint,
        sourceSystem: plan.sourceSystem,
        targetCollection: plan.sourceCollection,
        reviewedMapping: {
          selections: request.input.selections,
          sourceIdentitySelection: request.input.sourceIdentitySelection
        },
        result: storedResult
      };
      await insertAuditEvent(client, tenantId, {
        id: `import-commit:${request.batchId}:${plan.requestFingerprint}`,
        eventType: "IMPORT_COMMIT_COMPLETED",
        subjectId: request.subjectId,
        entityId: request.batchId,
        payload: {
          source_system: plan.sourceSystem,
          target_collection: plan.sourceCollection,
          request_fingerprint: plan.requestFingerprint,
          outcomes: summary,
          rows: resultRows,
          external_action_performed: false
        },
        occurredAt: request.committedAt,
        retainUntil: auditRetainUntil(
          lockedBatch.metadataRetainUntil,
          request.committedAt
        )
      });
      await checkpoint("afterImportAuditAppended", { batchId: request.batchId });
      await checkpoint("beforeImportFinalized", { batchId: request.batchId });
      const finalized = await client.query(
        `select * from tge.finalize_import_commit(
           $1::uuid, $2::text, $3::text, $4::jsonb, $5::timestamptz
         )`,
        [
          tenantId,
          request.batchId,
          request.input.idempotencyKey,
          JSON.stringify(commitMetadata),
          request.committedAt
        ]
      );
      if (!finalized.rows[0]) {
        throw new Error("Canonical import lifecycle finalization failed.");
      }
      await checkpoint("beforeImportCommit", { batchId: request.batchId });
      return {
        ...storedResult,
        batch: mapBatch(finalized.rows[0])
      };
    },

    async findCommit(batchId) {
      const batch = await client.query(
        `select * from tge.import_batches
         where tenant_id = $1 and id = $2 and status = 'COMMITTED'`,
        [tenantId, batchId]
      );
      if (!batch.rows[0]?.commit_metadata?.result) return null;
      return {
        ...structuredClone(batch.rows[0].commit_metadata.result),
        batch: mapBatch(batch.rows[0]),
        reconciled: true
      };
    }
  };
}

async function lockImportIdentities(client, tenantId, plan, rows) {
  const locks = rows.flatMap(row => [
    `source:${tenantId}:${plan.sourceSystem}:${plan.sourceCollection}:${row.sourceRecordId}`,
    `target:${tenantId}:${plan.sourceCollection}:${row.canonicalTargetId}`,
    ...(plan.sourceCollection === "prospects" && row.canonicalRecord?.dedupe_key != null
      ? [`prospect-dedupe:${tenantId}:${row.canonicalRecord.dedupe_key}`]
      : [])
  ]).sort();
  for (const lock of [...new Set(locks)]) {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($2::text, 544743)) from (select $1::uuid) tenant_scope",
      [tenantId, lock]
    );
  }
}

async function findExistingMaps(client, tenantId, plan, rows) {
  if (rows.length === 0) return [];
  const result = await client.query(
    `select * from tge.import_id_map
     where tenant_id = $1
       and source_collection = $2
       and source_system = $3
       and source_record_id = any($4::text[])
     order by source_record_id, import_batch_id`,
    [
      tenantId,
      plan.sourceCollection,
      plan.sourceSystem,
      rows.map(row => row.sourceRecordId)
    ]
  );
  return result.rows;
}

async function findCanonicalTargets(client, tenantId, target, ids) {
  if (ids.length === 0) return [];
  const result = await client.query(
    `select id from tge.${target.table}
     where tenant_id = $1 and id = any($2::text[])
     order by id
     for key share`,
    [tenantId, ids]
  );
  return result.rows;
}

async function findMissingReferences(client, tenantId, target, rows) {
  const conflicts = [];
  for (const reference of target.references) {
    const ids = [...new Set(rows.map(row => row.canonicalRecord[reference.field]).filter(Boolean))].sort();
    if (ids.length === 0) continue;
    const result = await client.query(
      `select id from tge.${reference.table}
       where tenant_id = $1 and id = any($2::text[])
       order by id
       for key share`,
      [tenantId, ids]
    );
    const found = new Set(result.rows.map(row => row.id));
    for (const id of ids.filter(candidate => !found.has(candidate))) {
      conflicts.push({
        code: "CANONICAL_REFERENCE_UNAVAILABLE",
        field: reference.field,
        targetId: id
      });
    }
  }
  return conflicts;
}

async function findCanonicalUniquenessConflicts(client, tenantId, target, rows) {
  if (target.table !== "prospects") return [];
  const keys = rows
    .map(row => row.canonicalRecord.dedupe_key)
    .filter(value => value !== null && value !== undefined);
  const conflicts = duplicates(keys).map(() => ({
    code: "PROSPECT_DEDUPE_KEY_COLLISION"
  }));
  if (keys.length === 0 || conflicts.length > 0) return conflicts;
  const result = await client.query(
    `select dedupe_key from tge.prospects
     where tenant_id = $1 and dedupe_key = any($2::text[])
     order by dedupe_key
     for key share`,
    [tenantId, keys]
  );
  return result.rows.map(() => ({ code: "PROSPECT_DEDUPE_KEY_COLLISION" }));
}

async function insertCanonicalRow(
  client,
  tenantId,
  target,
  row,
  plan,
  committedAt,
  batchId
) {
  const record = {
    ...row.canonicalRecord,
    metadata: {
      ...(row.canonicalRecord.metadata || {}),
      import: {
        batch_id: batchId,
        source_system: plan.sourceSystem,
        source_record_id: row.sourceRecordId,
        source_ordinal: row.sourceOrdinal,
        raw_payload_sha256: row.rawPayloadSha256,
        numeric_evidence: row.numericEvidence || {}
      }
    },
    created_at: row.canonicalRecord.created_at || committedAt,
    updated_at: row.canonicalRecord.updated_at
      || row.canonicalRecord.created_at
      || committedAt
  };
  const mapped = target.toRow(record, { exactNumericFields: row.numericEvidence });
  const entries = Object.entries(mapped);
  const columns = ["tenant_id", ...entries.map(([column]) => column)];
  const values = [tenantId, ...entries.map(([column, value]) =>
    encodeColumnValue(column, value))];
  const placeholders = values.map((_, index) => `$${index + 1}`);
  await client.query(
    `insert into tge.${target.table} (${columns.join(", ")})
     values (${placeholders.join(", ")})
     returning id`,
    values
  );
}

async function insertIdMap(client, tenantId, target, row, plan, request) {
  await client.query(
    `insert into tge.import_id_map (
       tenant_id, import_batch_id, source_collection, source_id,
       source_ordinal, source_system, source_record_id,
       canonical_payload_sha256, commit_idempotency_key,
       ${target.targetColumn}, metadata, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12
     )`,
    [
      tenantId,
      request.batchId,
      plan.sourceCollection,
      row.stagingSourceId || row.stagingRecordId,
      row.sourceOrdinal,
      plan.sourceSystem,
      row.sourceRecordId,
      row.canonicalPayloadSha256,
      request.input.idempotencyKey,
      row.canonicalTargetId,
      JSON.stringify({ raw_payload_sha256: row.rawPayloadSha256 }),
      request.committedAt
    ]
  );
}

async function recordBlockedAttempt(
  client,
  tenantId,
  batch,
  plan,
  request,
  inputFingerprint
) {
  const safe = {
    outcome: plan.outcome,
    batch: { id: request.batchId, status: batch.status },
    rows: (plan.rows || []).map(row => ({
      sourceOrdinal: row.sourceOrdinal,
      disposition: plan.outcome
    })),
    summary: plan.summary,
    conflicts: (plan.conflicts || []).map(safeIssue),
    failures: (plan.failures || []).map(safeIssue),
    reconciled: false
  };
  const requestFingerprint = plan.requestFingerprint || inputFingerprint;
  await client.query(
    `select tge.record_import_commit_attempt(
       $1::uuid, $2::text, $3::jsonb, $4::timestamptz
     )`,
    [
      tenantId,
      request.batchId,
      JSON.stringify({
        inputFingerprint,
        requestFingerprint,
        outcome: plan.outcome,
        summary: plan.summary
      }),
      request.committedAt
    ]
  );
  await insertAuditEvent(client, tenantId, {
    id: `import-commit-attempt:${request.batchId}:${requestFingerprint}:${plan.outcome}`,
    eventType: `IMPORT_COMMIT_${plan.outcome}`,
    subjectId: request.subjectId,
    entityId: request.batchId,
    payload: {
      request_fingerprint: requestFingerprint,
      outcomes: plan.summary,
      conflicts: safe.conflicts,
      failures: safe.failures,
      external_action_performed: false
    },
    occurredAt: request.committedAt,
    retainUntil: auditRetainUntil(batch.metadataRetainUntil, request.committedAt)
  }, true);
  return safe;
}

async function recordLifecycleConflict(
  client,
  tenantId,
  batch,
  conflict,
  request,
  inputFingerprint
) {
  const summary = {
    inputFingerprint,
    requestFingerprint: inputFingerprint,
    outcome: "CONFLICTED",
    summary: conflict.summary,
    lifecycleStatus: batch.status
  };
  await client.query(
    `select tge.record_import_commit_lifecycle_conflict(
       $1::uuid, $2::text, $3::jsonb, $4::timestamptz
     )`,
    [tenantId, request.batchId, JSON.stringify(summary), request.committedAt]
  );
  await appendLifecycleConflictAudit(
    client,
    tenantId,
    batch,
    conflict,
    request,
    inputFingerprint
  );
  return conflict;
}

async function appendLifecycleConflictAudit(
  client,
  tenantId,
  batch,
  conflict,
  request,
  inputFingerprint
) {
  await insertAuditEvent(client, tenantId, {
    id: `import-commit-attempt:${request.batchId}:${inputFingerprint}:CONFLICTED`,
    eventType: "IMPORT_COMMIT_CONFLICTED",
    subjectId: request.subjectId,
    entityId: request.batchId,
    payload: {
      input_fingerprint: inputFingerprint,
      outcomes: conflict.summary,
      conflicts: conflict.conflicts.map(safeIssue),
      external_action_performed: false
    },
    occurredAt: request.committedAt,
    retainUntil: auditRetainUntil(batch.metadataRetainUntil, request.committedAt)
  }, true);
}

async function insertAuditEvent(client, tenantId, event, ignoreDuplicate = false) {
  await client.query(
    `insert into tge.audit_events (
       tenant_id, id, event_type, subject_id, entity_type, entity_id,
       payload, occurred_at, retain_until, created_at
     ) values ($1, $2, $3, $4, 'import_batch', $5, $6::jsonb, $7, $8, $7)
     ${ignoreDuplicate ? "on conflict (tenant_id, id) do nothing" : ""}`,
    [
      tenantId,
      event.id,
      event.eventType,
      event.subjectId,
      event.entityId,
      JSON.stringify(event.payload),
      event.occurredAt,
      event.retainUntil
    ]
  );
}

function conflictResult(batch, code, conflicts) {
  return {
    outcome: "CONFLICTED",
    batch,
    rows: [],
    summary: {
      total: batch.previewSummary?.rowCount || 0,
      committed: 0,
      skipped: 0,
      conflicted: batch.previewSummary?.rowCount || 0,
      failed: 0
    },
    conflicts: conflicts.map(conflict => ({ ...conflict, code })),
    reconciled: false
  };
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function auditRetainUntil(batchRetention, occurredAt) {
  const occurred = new Date(occurredAt);
  occurred.setUTCFullYear(occurred.getUTCFullYear() + 1);
  const required = occurred.toISOString();
  if (!batchRetention) return required;
  return new Date(batchRetention).valueOf() >= occurred.valueOf()
    ? batchRetention
    : required;
}

function commitInputFingerprint(batchId, input, sourceCollection) {
  const definitions = TARGETS[sourceCollection]?.fields || [];
  const supplied = new Map((input.selections || []).map(selection => [
    selection.targetField,
    selection
  ]));
  const definitionNames = new Set(definitions.map(definition => definition.targetField));
  const selections = definitions.length > 0
    ? [
      ...definitions.map(definition => supplied.get(definition.targetField) || {
        targetField: definition.targetField,
        sourceColumn: null,
        selectedType: definition.declaredType
      }),
      ...(input.selections || []).filter(selection =>
        !definitionNames.has(selection.targetField))
    ]
    : [...(input.selections || [])];
  return hashImportEvidence({
    batchId,
    input: {
      ...input,
      selections: selections.sort((left, right) =>
        left.targetField.localeCompare(right.targetField))
    }
  });
}

function canonicalMaterializationConflict(error, row) {
  if (!row) return null;
  if (error?.code === "23503") {
    const field = error.constraint?.match(
      /_tenant_id_(prospect_id|opportunity_id)_fkey$/
    )?.[1];
    return {
      code: "CANONICAL_REFERENCE_UNAVAILABLE",
      sourceOrdinal: row.sourceOrdinal,
      ...(field
        ? { field, targetId: row.canonicalRecord?.[field] ?? null }
        : {})
    };
  }
  if (error?.code !== "23505") return null;
  const constraint = error.constraint || "";
  let code;
  if (constraint === "prospects_tenant_id_dedupe_key_key") {
    code = "PROSPECT_DEDUPE_KEY_COLLISION";
  } else if (/^(prospects|opportunities|tasks|activities)_pkey$/.test(constraint)) {
    code = "CANONICAL_ID_COLLISION";
  } else if (constraint === "import_id_map_source_identity_uidx") {
    code = "SOURCE_IDENTITY_MAP_CONFLICT";
  } else if (/^import_id_map_global_target_.*_uidx$/.test(constraint)) {
    code = "CANONICAL_ID_COLLISION";
  } else if (/^import_id_map_.*(?:_key|_uidx|_pkey)$/.test(constraint)) {
    code = "IMPORT_ID_MAP_COLLISION";
  } else if (/^(prospects|opportunities|tasks|activities)_/.test(constraint)) {
    code = "CANONICAL_UNIQUENESS_COLLISION";
  } else {
    return null;
  }
  return {
    code,
    sourceOrdinal: row.sourceOrdinal,
    targetId: row.canonicalTargetId
  };
}

function safeIssue(issue) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
    return { code: "IMPORT_COMMIT_ISSUE" };
  }
  const allowed = [
    "batchId",
    "code",
    "field",
    "mappedTargetId",
    "requestedTargetId",
    "sourceCollection",
    "sourceOrdinal",
    "sourceOrdinals",
    "sourceRecordId",
    "status",
    "targetField",
    "targetId"
  ];
  return {
    ...Object.fromEntries(allowed.filter(key => Object.hasOwn(issue, key)).map(key => [
      key,
      issue[key]
    ])),
    ...(Array.isArray(issue.validationErrors)
      ? { validationErrors: issue.validationErrors.map(safeIssue) }
      : {})
  };
}

function validateRepositoryCommitRequest(request) {
  if (
    !request
    || typeof request !== "object"
    || typeof request.batchId !== "string"
    || !request.batchId
    || typeof request.committedAt !== "string"
    || typeof request.subjectId !== "string"
    || !request.subjectId
    || !request.input
    || typeof request.input.idempotencyKey !== "string"
    || typeof request.prepare !== "function"
  ) {
    throw new TypeError("A complete canonical import repository request is required.");
  }
}

function mapBatch(row) {
  return {
    id: row.id,
    status: row.status,
    sourceFilename: row.source_filename,
    sourceSha256: row.source_sha256,
    authorizedBySubjectId: row.authorized_by_subject_id,
    authorizationVerifiedAt: timestamp(row.authorization_verified_at),
    previewSummary: row.preview_summary,
    conflictSummary: row.conflict_summary,
    commitIdempotencyKey: row.commit_idempotency_key,
    commitMetadata: row.commit_metadata,
    committedAt: timestamp(row.committed_at),
    rawExpiresAt: timestamp(row.raw_expires_at),
    metadataRetainUntil: timestamp(row.metadata_retain_until),
    createdAt: timestamp(row.created_at)
  };
}

function mapRecord(row) {
  return {
    id: row.id,
    importBatchId: row.import_batch_id,
    sourceCollection: row.source_collection,
    sourceId: row.source_id,
    sourceOrdinal: Number(row.source_ordinal),
    sourceRowNumber: row.raw_payload?.sourceRowNumber,
    rawPayload: row.raw_payload,
    rawPayloadSha256: row.raw_payload_sha256,
    disposition: row.disposition,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata
  };
}

function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

module.exports = { PREVIEW_ROW_LIMIT, createImportRepository };
