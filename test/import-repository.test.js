const assert = require("node:assert/strict");
const test = require("node:test");

const {
  hashImportEvidence
} = require("../src/imports/csvParser");

const {
  createPostgresRepositories
} = require("../src/persistence/postgres/repositories");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");

const context = createTenantContext({
  tenantId: "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
  subjectId: "auth0|owner"
});

function draft() {
  return {
    batch: {
      id: "batch-1",
      status: "PREVIEWED",
      sourceFilename: "untrusted.xlsx",
      sourceSha256: "a".repeat(64),
      authorizedBySubjectId: "auth0|owner",
      authorizationVerifiedAt: "2026-09-01T00:00:00.000Z",
      previewSummary: { format: "CSV", rowCount: 1 },
      rawStorageKey: null,
      rawExpiresAt: "2026-09-08T00:00:00.000Z",
      metadataRetainUntil: "2027-09-01T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z"
    },
    records: [{
      id: "row:0",
      sourceCollection: "prospects",
      sourceId: `csv-row:0:${"b".repeat(64)}`,
      sourceOrdinal: 0,
      sourceRowNumber: 2,
      rawPayload: {
        sourceRowNumber: 2,
        cells: [{
          columnOrdinal: 0,
          present: true,
          raw: "0",
          valueKind: "KNOWN_ZERO"
        }]
      },
      rawPayloadSha256: "b".repeat(64),
      disposition: "PENDING",
      idempotencyKey: "c".repeat(64),
      metadata: { source_id_kind: "SYNTHETIC_ROW_EVIDENCE" }
    }],
    auditEvent: {
      id: "import-preview:batch-1",
      eventType: "IMPORT_PREVIEW_CREATED",
      subjectId: "auth0|owner",
      entityType: "import_batch",
      entityId: "batch-1",
      payload: { row_count: 1, external_action_performed: false },
      occurredAt: "2026-09-01T00:00:00.000Z",
      retainUntil: "2027-09-01T00:00:00.000Z"
    }
  };
}

test("import repository stages batch, rows, and audit in one tenant transaction only", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push([sql, params]);
      if (/insert into tge\.import_batches/i.test(sql)) {
        return { rows: [{
          tenant_id: context.tenantId,
          id: "batch-1",
          status: "PREVIEWED",
          source_filename: "untrusted.xlsx",
          source_sha256: "a".repeat(64),
          authorized_by_subject_id: "auth0|owner",
          authorization_verified_at: "2026-09-01T00:00:00.000Z",
          preview_summary: { format: "CSV", rowCount: 1 }
        }] };
      }
      if (/insert into tge\.import_staging_records/i.test(sql)) {
        return { rows: [{
          tenant_id: context.tenantId,
          import_batch_id: "batch-1",
          id: "row:0",
          source_collection: "prospects",
          source_id: `csv-row:0:${"b".repeat(64)}`,
          source_ordinal: "0",
          raw_payload: draft().records[0].rawPayload,
          raw_payload_sha256: "b".repeat(64),
          disposition: "PENDING",
          idempotency_key: "c".repeat(64),
          metadata: draft().records[0].metadata
        }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });

  const preview = await repositories.imports.stagePreview(context, draft());

  assert.equal(preview.batch.id, "batch-1");
  assert.equal(preview.records[0].rawPayload.cells[0].raw, "0");
  const statements = calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(" ").toLowerCase());
  assert.deepEqual(statements, [
    "begin",
    "select tge.set_request_context($1::uuid, $2::text)",
    "insert into tge.import_batches",
    "insert into tge.import_staging_records",
    "insert into tge.audit_events",
    "commit"
  ]);
  for (const [sql, params] of calls.filter(([sql]) => /tge\.import_|tge\.audit_events/.test(sql))) {
    assert.equal(params[0], context.tenantId, sql);
    assert.doesNotMatch(sql, /tge\.(prospects|opportunities|tasks|activities|revenue_actions)/);
  }
});

test("import preview lookup uses explicit tenant scope and a bounded row sample", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push([sql, params]);
      if (/from tge\.import_batches/i.test(sql)) {
        return { rows: [{
          tenant_id: context.tenantId,
          id: "batch-1",
          status: "PREVIEWED",
          source_filename: "source.csv",
          source_sha256: "a".repeat(64),
          preview_summary: { rowCount: 101 }
        }] };
      }
      if (/from tge\.import_staging_records/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });

  const result = await repositories.imports.findPreview(context, "batch-1");
  assert.equal(result.batch.id, "batch-1");
  const selects = calls.filter(([sql]) => /^\s*select \*/i.test(sql));
  assert.equal(selects.length, 2);
  assert.match(selects[0][0], /where tenant_id = \$1 and id = \$2/i);
  assert.match(selects[1][0], /where tenant_id = \$1 and import_batch_id = \$2/i);
  assert.match(selects[1][0], /limit \$3/i);
  assert.equal(selects[1][1][2], 100);
});

test("import analysis evidence reads every staged row in source order and remains tenant-scoped", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push([sql, params]);
      if (/from tge\.import_batches/i.test(sql)) {
        return { rows: [{
          tenant_id: context.tenantId,
          id: "batch-1",
          status: "PREVIEWED",
          preview_summary: { headers: ["id"], rowCount: 101 }
        }] };
      }
      if (/from tge\.import_staging_records/i.test(sql)) {
        return { rows: [draft().records[0]].map(record => ({
          import_batch_id: "batch-1",
          id: record.id,
          source_collection: record.sourceCollection,
          source_id: record.sourceId,
          source_ordinal: record.sourceOrdinal,
          raw_payload: record.rawPayload,
          raw_payload_sha256: record.rawPayloadSha256,
          disposition: record.disposition,
          idempotency_key: record.idempotencyKey,
          metadata: record.metadata
        })) };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });

  const evidence = await repositories.imports.findAnalysisEvidence(context, "batch-1");
  assert.equal(evidence.batch.id, "batch-1");
  assert.equal(evidence.records.length, 1);
  const stagedSelect = calls.find(([sql]) => /from tge\.import_staging_records/i.test(sql));
  assert.match(stagedSelect[0], /where tenant_id = \$1 and import_batch_id = \$2/i);
  assert.match(stagedSelect[0], /order by source_ordinal/i);
  assert.doesNotMatch(stagedSelect[0], /limit/i);
  assert.deepEqual(stagedSelect[1], [context.tenantId, "batch-1"]);
  assert.equal(calls.some(([sql]) => /tge\.(prospects|opportunities|tasks|activities|revenue_actions)/i.test(sql)), false);
});

test("canonical import locks, reconciles, materializes, maps, audits, and finalizes in one tenant transaction", async () => {
  const calls = [];
  const staged = draft().records[0];
  const committedBatch = {
    tenant_id: context.tenantId,
    id: "batch-1",
    status: "COMMITTED",
    source_filename: "source.csv",
    source_sha256: "a".repeat(64),
    preview_summary: { sourceCollection: "prospects", rowCount: 1 },
    commit_idempotency_key: "commit-attempt-1",
    committed_at: "2026-09-02T00:00:00.000Z",
    commit_metadata: {}
  };
  const client = {
    async query(sql, params) {
      calls.push([sql, params]);
      if (/lock_import_commit_batch/i.test(sql)) {
        return { rows: [{
          ...committedBatch,
          status: "PREVIEWED",
          commit_idempotency_key: null,
          committed_at: null,
          commit_metadata: null
        }] };
      }
      if (/lock_import_commit_records/i.test(sql)) {
        return { rows: [{
          import_batch_id: "batch-1",
          id: staged.id,
          source_collection: staged.sourceCollection,
          source_id: staged.sourceId,
          source_ordinal: staged.sourceOrdinal,
          raw_payload: staged.rawPayload,
          raw_payload_sha256: staged.rawPayloadSha256,
          disposition: staged.disposition,
          idempotency_key: staged.idempotencyKey,
          metadata: staged.metadata
        }] };
      }
      if (/from tge\.import_id_map/i.test(sql)) return { rows: [] };
      if (/select id from tge\.prospects/i.test(sql)) return { rows: [] };
      if (/insert into tge\.prospects/i.test(sql)) {
        return { rows: [{ id: "prospect-1" }] };
      }
      if (/select \* from tge\.finalize_import_commit/i.test(sql)) {
        return { rows: [committedBatch] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });
  let preparedEvidence;

  const result = await repositories.imports.commitCanonical(context, {
    batchId: "batch-1",
    committedAt: "2026-09-02T00:00:00.000Z",
    subjectId: context.subjectId,
    input: {
      sourceSystem: "pilot-crm",
      idempotencyKey: "commit-attempt-1"
    },
    prepare(evidence) {
      preparedEvidence = evidence;
      return {
        outcome: "READY",
        batchId: "batch-1",
        sourceCollection: "prospects",
        sourceSystem: "pilot-crm",
        idempotencyKey: "commit-attempt-1",
        requestFingerprint: "d".repeat(64),
        summary: {
          total: 1,
          committed: 1,
          skipped: 0,
          conflicted: 0,
          failed: 0
        },
        conflicts: [],
        rows: [{
          stagingRecordId: staged.id,
          sourceCollection: "prospects",
          sourceOrdinal: 0,
          sourceRowNumber: 2,
          sourceRecordId: "source-1",
          rawPayloadSha256: staged.rawPayloadSha256,
          canonicalTargetId: "prospect-1",
          canonicalPayloadSha256: "e".repeat(64),
          canonicalRecord: { id: "prospect-1", business_name: "Acme" },
          disposition: "COMMITTED",
          duplicateOfSourceOrdinal: null,
          validationErrors: []
        }]
      };
    }
  });

  assert.equal(preparedEvidence.batch.status, "PREVIEWED");
  assert.equal(preparedEvidence.records[0].rawPayload.cells[0].raw, "0");
  assert.equal(result.outcome, "COMMITTED");
  assert.equal(result.rows[0].targetId, "prospect-1");
  assert.equal(result.reconciled, false);
  assert.equal(calls[0][0], "BEGIN");
  assert.equal(calls.at(-1)[0], "COMMIT");
  assert.equal(calls.some(([sql]) => /select pg_advisory_xact_lock/i.test(sql)), true);
  assert.equal(calls.some(([sql]) => /insert into tge\.import_id_map/i.test(sql)), true);
  assert.equal(calls.some(([sql]) => /record_import_commit_outcome/i.test(sql)), true);
  assert.equal(calls.some(([sql]) => /insert into tge\.audit_events/i.test(sql)), true);
  assert.equal(calls.some(([sql]) => /finalize_import_commit/i.test(sql)), true);
  for (const [sql, params] of calls.filter(([sql]) => /tge\.(import_|prospects|audit_events)/i.test(sql))) {
    if (Array.isArray(params) && params.length > 0) {
      assert.equal(params[0], context.tenantId, sql);
    }
  }
});

test("same committed request reconciles without rebuilding, inserting, mapping, or auditing", async () => {
  const calls = [];
  const storedResult = {
    outcome: "COMMITTED",
    batch: { id: "batch-1", status: "COMMITTED" },
    rows: [{ sourceOrdinal: 0, targetId: "prospect-1", disposition: "COMMITTED" }],
    summary: { total: 1, committed: 1, skipped: 0, conflicted: 0, failed: 0 },
    reconciled: false
  };
  const client = {
    async query(sql, params) {
      calls.push([sql, params]);
      if (/lock_import_commit_batch/i.test(sql)) {
        return { rows: [{
          tenant_id: context.tenantId,
          id: "batch-1",
          status: "COMMITTED",
          source_filename: "source.csv",
          source_sha256: "a".repeat(64),
          commit_idempotency_key: "commit-attempt-1",
          commit_metadata: {
            inputFingerprint: hashImportEvidence({
              batchId: "batch-1",
              input: {
                sourceSystem: "pilot-crm",
                idempotencyKey: "commit-attempt-1",
                selections: []
              }
            }),
            requestFingerprint: "d".repeat(64),
            result: storedResult
          },
          committed_at: "2026-09-02T00:00:00.000Z"
        }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repositories = createPostgresRepositories({
    pool: { connect: async () => client }
  });
  const result = await repositories.imports.commitCanonical(context, {
    batchId: "batch-1",
    committedAt: "2026-09-03T00:00:00.000Z",
    subjectId: context.subjectId,
    input: {
      sourceSystem: "pilot-crm",
      idempotencyKey: "commit-attempt-1",
      selections: []
    },
    prepare() {
      assert.fail("a committed retry must not rebuild the canonical plan");
    }
  });

  assert.equal(result.reconciled, true);
  assert.deepEqual(calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(" ").toLowerCase()), [
    "begin",
    "select tge.set_request_context($1::uuid, $2::text)",
    "select * from",
    "commit"
  ]);
});
