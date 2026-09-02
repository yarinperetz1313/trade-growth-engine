const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveTenantContext
} = require("../src/auth/authorization");
const {
  bridgeAuthTenantContext,
  createApp
} = require("../src/app/server");
const {
  createImportsRouter
} = require("../src/api/imports");
const {
  hashImportEvidence,
} = require("../src/imports/csvParser");
const {
  ImportContractError,
  createImportService
} = require("../src/imports/importService");
const {
  withTenantTransaction
} = require("../src/persistence/postgres/transaction");

const TENANT_A = "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e";
const TENANT_B = "b0e8a2a0-9c44-4d84-9263-7d417ac00b8e";

function upload(csv) {
  return {
    filename: "../untrusted-name.xlsx",
    mediaType: "application/octet-stream",
    contentBase64: Buffer.from(csv, "utf8").toString("base64")
  };
}

async function authContext({ tenantId = TENANT_A, role = "OWNER" } = {}) {
  return resolveTenantContext({
    identity: { issuer: "https://tenant.au.auth0.com/", subject: `auth0|${role}` },
    membershipRepository: {
      async findActiveMembershipsByIdentity({ issuer, subject }) {
        return [{ tenantId, issuer, subject, role, status: "ACTIVE" }];
      }
    }
  });
}

function fakePersistence() {
  const previews = new Map();
  const calls = [];
  return {
    adapter: "postgres",
    calls,
    forTenant(context) {
      calls.push(["forTenant", context]);
      return {
        imports: {
          async stagePreview(draft) {
            calls.push(["stagePreview", draft]);
            const preview = {
              batch: {
                id: draft.batch.id,
                status: "PREVIEWED",
                sourceFilename: draft.batch.sourceFilename,
                sourceSha256: draft.batch.sourceSha256,
                authorizedBySubjectId: draft.batch.authorizedBySubjectId,
                previewSummary: draft.batch.previewSummary
              },
              records: structuredClone(draft.records)
            };
            previews.set(`${context.tenantId}:${draft.batch.id}`, preview);
            return structuredClone(preview);
          },
          async findPreview(batchId) {
            calls.push(["findPreview", batchId]);
            return structuredClone(previews.get(`${context.tenantId}:${batchId}`) || null);
          },
          async findAnalysisEvidence(batchId) {
            calls.push(["findAnalysisEvidence", batchId]);
            return structuredClone(previews.get(`${context.tenantId}:${batchId}`) || null);
          }
        },
        prospects: forbidden("prospects"),
        opportunities: forbidden("opportunities"),
        tasks: forbidden("tasks"),
        activities: forbidden("activities"),
        revenueActions: forbidden("revenueActions")
      };
    }
  };
}

function forbidden(name) {
  return new Proxy({}, {
    get() {
      assert.fail(`PR-5A must not access canonical ${name} persistence`);
    }
  });
}

test("OWNER and ADMIN atomically stage a CSV preview with immutable evidence only", async () => {
  for (const role of ["OWNER", "ADMIN"]) {
    const authorizationContext = await authContext({ role });
    const persistenceContext = bridgeAuthTenantContext(authorizationContext);
    const persistence = fakePersistence();
    const service = createImportService({
      persistence,
      clock: () => new Date("2026-09-01T00:00:00.000Z"),
      idFactory: () => `batch-${role.toLowerCase()}`
    });

    const preview = await service.createPreview({
      authorizationContext,
      persistenceContext,
      input: {
        sourceCollection: "prospects",
        upload: upload("source_id,value,note\np-1,0,unknown\np-2,,=2+2")
      }
    });

    assert.equal(preview.batch.status, "PREVIEWED");
    assert.equal(preview.batch.authorizedBySubjectId, `auth0|${role}`);
    assert.deepEqual(preview.batch.previewSummary, {
      format: "CSV",
      byteCount: 44,
      rowCount: 2,
      columnCount: 3,
      headers: ["source_id", "value", "note"],
      reportedMediaType: "application/octet-stream",
      parserLimits: {
        maxFileBytes: 262144,
        maxRows: 1000,
        maxColumns: 64,
        maxHeaderBytes: 256,
        maxCellBytes: 4096,
        maxCells: 32000,
        maxSerializedStagingBytes: 2516582,
        maxSerializedPreviewBytes: 917504
      },
      valueKindCounts: {
        BLANK: 1,
        KNOWN_ZERO: 1,
        NONNUMERIC: 3,
        UNKNOWN: 1
      }
    });
    assert.equal(preview.records[0].sourceOrdinal, 0);
    assert.equal(preview.records[0].sourceRowNumber, 2);
    assert.equal(preview.records[0].rawPayload.cells[1].raw, "0");
    assert.equal(preview.records[1].rawPayload.cells[1].valueKind, "BLANK");
    assert.equal(preview.records[1].rawPayload.cells[2].raw, "=2+2");
    assert.match(preview.records[0].rawPayloadSha256, /^[0-9a-f]{64}$/);
    assert.equal(
      preview.records[0].rawPayloadSha256,
      hashImportEvidence(preview.records[0].rawPayload)
    );
    assert.match(preview.records[0].idempotencyKey, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      persistence.calls.map(([name]) => name),
      ["forTenant", "stagePreview"]
    );
  }
});

test("MEMBER, forged context, caller tenant, path input, and unsupported collection fail before persistence", async () => {
  const persistence = fakePersistence();
  const service = createImportService({ persistence });
  const member = await authContext({ role: "MEMBER" });
  const memberPersistence = bridgeAuthTenantContext(member);
  const validInput = {
    sourceCollection: "prospects",
    upload: upload("id\n1")
  };

  await assert.rejects(
    service.createPreview({
      authorizationContext: member,
      persistenceContext: memberPersistence,
      input: validInput
    }),
    error => error.code === "ACCESS_DENIED" && error.status === 403
  );
  for (const input of [
    { ...validInput, tenantId: TENANT_B },
    { ...validInput, path: "/tmp/export.csv" },
    { ...validInput, sourceCollection: "customers" }
  ]) {
    await assert.rejects(
      service.createPreview({
        authorizationContext: await authContext(),
        persistenceContext: bridgeAuthTenantContext(await authContext()),
        input
      }),
      error => error instanceof ImportContractError && error.code === "IMPORT_REQUEST_INVALID"
    );
  }
  await assert.rejects(
    service.createPreview({
      authorizationContext: { ...(await authContext()) },
      persistenceContext: bridgeAuthTenantContext(await authContext()),
      input: validInput
    }),
    error => error.code === "ACCESS_DENIED"
  );
  assert.equal(persistence.calls.length, 0);
});

test("preview reads are admin-only and cross-tenant equals nonexistent", async () => {
  const persistence = fakePersistence();
  const service = createImportService({ persistence, idFactory: () => "batch-a" });
  const ownerA = await authContext();
  const persistenceA = bridgeAuthTenantContext(ownerA);
  await service.createPreview({
    authorizationContext: ownerA,
    persistenceContext: persistenceA,
    input: { sourceCollection: "prospects", upload: upload("id\n1") }
  });

  const ownerB = await authContext({ tenantId: TENANT_B });
  const persistenceB = bridgeAuthTenantContext(ownerB);
  for (const batchId of ["batch-a", "does-not-exist"]) {
    await assert.rejects(
      service.readPreview({
        authorizationContext: ownerB,
        persistenceContext: persistenceB,
        batchId
      }),
      error => error.code === "IMPORT_BATCH_UNAVAILABLE" && error.status === 404
    );
  }
});

test("analysis returns a reviewable draft over all staged rows without canonical access or persistence", async () => {
  const persistence = fakePersistence();
  const service = createImportService({ persistence, idFactory: () => "batch-analysis" });
  const owner = await authContext();
  const persistenceContext = bridgeAuthTenantContext(owner);
  await service.createPreview({
    authorizationContext: owner,
    persistenceContext,
    input: {
      sourceCollection: "prospects",
      upload: upload("External Key,Trading Name,Email Address\np-1,Acme,a@example.com")
    }
  });

  const analysis = await service.analyzePreview({
    authorizationContext: owner,
    persistenceContext,
    batchId: "batch-analysis",
    input: {
      selections: [
        { targetField: "id", sourceColumn: "External Key", selectedType: "TEXT" },
        { targetField: "business_name", sourceColumn: "Trading Name", selectedType: "TEXT" }
      ]
    }
  });

  assert.equal(analysis.mapping.status, "DRAFT");
  assert.equal(analysis.mapping.accepted, false);
  assert.equal(analysis.mapping.selectionState, "USER_EDITED_DRAFT");
  assert.equal(analysis.dataHealth.totalRows, 1);
  assert.deepEqual(
    persistence.calls.slice(-2).map(([name]) => name),
    ["forTenant", "findAnalysisEvidence"]
  );
});

test("analysis API is tenant-safe and normalizes invalid draft selections", async () => {
  const owner = await authContext();
  const persistenceContext = bridgeAuthTenantContext(owner);
  const persistence = fakePersistence();
  const service = createImportService({ persistence, idFactory: () => "analysis-api" });
  await service.createPreview({
    authorizationContext: owner,
    persistenceContext,
    input: { sourceCollection: "prospects", upload: upload("id,business_name\np-1,Acme") }
  });
  const router = createImportsRouter({
    service,
    resolveAuthorizationContext: () => owner,
    resolvePersistenceContext: () => persistenceContext
  });

  const response = await requestRouter(router, "/api/import-batches/analysis-api/analysis", {
    method: "POST",
    body: { selections: [
      { targetField: "id", sourceColumn: "id", selectedType: "TEXT" },
      { targetField: "business_name", sourceColumn: "id", selectedType: "TEXT" }
    ] }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.data, {
    ok: false,
    error: "IMPORT_MAPPING_SELECTION_INVALID",
    message: "The draft import mapping selection is invalid."
  });

  const ownerB = await authContext({ tenantId: TENANT_B });
  await assert.rejects(
    service.analyzePreview({
      authorizationContext: ownerB,
      persistenceContext: bridgeAuthTenantContext(ownerB),
      batchId: "analysis-api",
      input: {}
    }),
    error => error.code === "IMPORT_BATCH_UNAVAILABLE" && error.status === 404
  );
});

test("import router normalizes unavailable previews without an existence oracle", async () => {
  const owner = await authContext();
  const persistenceContext = bridgeAuthTenantContext(owner);
  const service = {
    async createPreview() {
      assert.fail("createPreview is not expected");
    },
    async readPreview() {
      throw new ImportContractError(
        "IMPORT_BATCH_UNAVAILABLE",
        "The requested import batch is unavailable.",
        404
      );
    }
  };
  const router = createImportsRouter({
    service,
    resolveAuthorizationContext: () => owner,
    resolvePersistenceContext: () => persistenceContext
  });
  const response = await requestRouter(router, "/api/import-batches/anything/preview");
  assert.equal(response.status, 404);
  assert.deepEqual(response.data, {
    ok: false,
    error: "IMPORT_BATCH_UNAVAILABLE",
    message: "The requested import batch is unavailable."
  });
});

test("ambiguous preview COMMIT returns only its batch ID and supports reconciliation", async () => {
  const owner = await authContext();
  const persistenceContext = bridgeAuthTenantContext(owner);
  const previews = new Map();
  let rejectCommit = true;
  const pool = {
    async connect() {
      return {
        async query(sql) {
          if (sql === "COMMIT" && rejectCommit) {
            rejectCommit = false;
            throw new Error("commit acknowledgement lost");
          }
          return { rows: [] };
        },
        release() {}
      };
    }
  };
  const persistence = {
    adapter: "postgres",
    forTenant(context) {
      return {
        imports: {
          async stagePreview(draft) {
            return withTenantTransaction(pool, context, async () => {
              const preview = {
                batch: structuredClone(draft.batch),
                records: structuredClone(draft.records),
                previewRowLimit: 100
              };
              previews.set(`${context.tenantId}:${draft.batch.id}`, preview);
              return structuredClone(preview);
            });
          },
          async findPreview(batchId) {
            return structuredClone(
              previews.get(`${context.tenantId}:${batchId}`) || null
            );
          }
        }
      };
    }
  };
  const app = createApp({
    persistence,
    resolveAuthorizationContext: () => owner,
    resolveTenantContext: () => persistenceContext
  });
  const rawCell = "tenant-private-raw-cell";

  const created = await requestRouter(app, "/api/import-batches/preview", {
    method: "POST",
    body: {
      sourceCollection: "prospects",
      upload: upload(`id,note\n1,${rawCell}`)
    }
  });

  assert.equal(created.status, 500);
  assert.deepEqual(created.data, {
    ok: false,
    error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
    message: "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
    details: { attemptedId: created.data.details.attemptedId }
  });
  assert.match(created.data.details.attemptedId, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(created.data).includes(rawCell), false);
  assert.equal(Object.hasOwn(created.data, "attemptedResult"), false);

  const reconciled = await requestRouter(
    app,
    `/api/import-batches/${created.data.details.attemptedId}/preview`
  );
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.data.data.batch.id, created.data.details.attemptedId);
  assert.equal(reconciled.data.data.records[0].rawPayload.cells[1].raw, rawCell);
});

test("oversized JSON import envelopes return a bounded transport error without fault logging", async () => {
  const owner = await authContext();
  const persistence = fakePersistence();
  const service = createImportService({ persistence });
  const express = require("express");
  let authenticationCalls = 0;
  const authRuntime = {
    corsOptions: {},
    publicRouter: express.Router(),
    protectedRouter: express.Router(),
    authenticateIdentity(req, res, next) {
      authenticationCalls += 1;
      next();
    },
    deriveTenantContext(req, res, next) {
      req.tenantContext = owner;
      next();
    }
  };
  const app = createApp({ authRuntime, persistence, importService: service });
  const loggedFaults = [];
  const originalConsoleError = console.error;
  console.error = (...args) => loggedFaults.push(args);

  let response;
  try {
    response = await requestRouter(app, "/api/import-batches/preview", {
      method: "POST",
      parseJson: false,
      body: {
        sourceCollection: "prospects",
        upload: {
          filename: "oversized.csv",
          mediaType: "text/csv",
          contentBase64: "A".repeat(1024 * 1024)
        }
      }
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 413);
  assert.deepEqual(response.data, {
    ok: false,
    error: "REQUEST_BODY_TOO_LARGE",
    message: "Request body exceeds the maximum allowed size."
  });
  assert.equal(authenticationCalls, 0);
  assert.deepEqual(loggedFaults, []);
  assert.equal(persistence.calls.length, 0);
});

test("application composition exposes the tenant-authorized import preview contract", async () => {
  const express = require("express");
  const owner = await authContext();
  const member = await authContext({ role: "MEMBER" });
  const persistence = fakePersistence();
  const service = createImportService({ persistence, idFactory: () => "composed-batch" });
  const authRuntime = {
    corsOptions: {},
    publicRouter: express.Router(),
    protectedRouter: express.Router(),
    authenticateIdentity(req, res, next) { next(); },
    deriveTenantContext(req, res, next) {
      req.tenantContext = req.get("x-test-role") === "MEMBER" ? member : owner;
      next();
    }
  };
  const app = createApp({
    authRuntime,
    persistence,
    importService: service
  });

  const created = await requestRouter(app, "/api/import-batches/preview", {
    method: "POST",
    body: {
      sourceCollection: "prospects",
      upload: upload("id,value\n1,0")
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.data.batch.id, "composed-batch");
  const read = await requestRouter(app, "/api/import-batches/composed-batch/preview");
  assert.equal(read.status, 200);
  assert.equal(read.data.data.batch.id, "composed-batch");
  const denied = await requestRouter(app, "/api/import-batches/preview", {
    method: "POST",
    headers: { "x-test-role": "MEMBER" },
    body: {
      sourceCollection: "prospects",
      upload: upload("id\n1")
    }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error, "ACCESS_DENIED");
  const oversized = await requestRouter(app, "/api/import-batches/preview", {
    method: "POST",
    body: {
      sourceCollection: "prospects",
      upload: upload(`id\n${"x".repeat(4097)}`)
    }
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.data.error, "CSV_CELL_LIMIT_EXCEEDED");
  const malformed = await requestRouter(app, "/api/import-batches/preview", {
    method: "POST",
    body: {
      sourceCollection: "prospects",
      upload: {
        filename: "bad.csv",
        mediaType: "text/csv",
        contentBase64: "%%%"
      }
    }
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.data.error, "CSV_BASE64_INVALID");
});

async function requestRouter(
  router,
  pathname,
  { method = "GET", parseJson = true, body, headers = {} } = {}
) {
  const express = require("express");
  const app = express();
  if (parseJson) {
    app.use(express.json());
  }
  app.use(router);
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
