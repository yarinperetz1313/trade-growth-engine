const assert = require("node:assert/strict");
const test = require("node:test");

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
