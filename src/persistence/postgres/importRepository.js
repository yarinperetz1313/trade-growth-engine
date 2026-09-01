const PREVIEW_ROW_LIMIT = 100;

function createImportRepository(client, tenantId) {
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
    }
  };
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
