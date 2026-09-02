const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCanonicalCommitPlan
} = require("../src/imports/importCommit");
const {
  resolveTenantContext
} = require("../src/auth/authorization");
const {
  ImportContractError,
  createImportService
} = require("../src/imports/importService");
const {
  createImportsRouter
} = require("../src/api/imports");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");
const {
  PostgresTransactionOutcomeUnknownError
} = require("../src/persistence/postgres/transaction");
const {
  hashImportEvidence,
  parseCsvUpload
} = require("../src/imports/csvParser");

function stagedEvidence(csv, sourceCollection = "opportunities") {
  const parsed = parseCsvUpload({
    filename: "source.csv",
    mediaType: "text/csv",
    contentBase64: Buffer.from(csv, "utf8").toString("base64")
  });
  return {
    batch: {
      id: "batch-commit",
      status: "PREVIEWED",
      sourceSha256: parsed.sourceSha256,
      metadataRetainUntil: "2027-09-01T00:00:00.000Z",
      previewSummary: {
        sourceCollection,
        headers: parsed.headers,
        rowCount: parsed.rows.length
      }
    },
    records: parsed.rows.map(row => ({
      id: `row:${row.sourceOrdinal}`,
      importBatchId: "batch-commit",
      sourceCollection,
      sourceId: `csv-row:${row.sourceOrdinal}:${row.rawPayloadSha256}`,
      sourceOrdinal: row.sourceOrdinal,
      sourceRowNumber: row.sourceRowNumber,
      rawPayload: row.rawPayload,
      rawPayloadSha256: hashImportEvidence(row.rawPayload),
      disposition: "PENDING",
      metadata: { source_id_kind: "SYNTHETIC_ROW_EVIDENCE" }
    }))
  };
}

function commitInput(overrides = {}) {
  return {
    sourceSystem: "pilot-crm",
    idempotencyKey: "commit-attempt-1",
    sourceIdentitySelection: { sourceColumn: "source_id" },
    selections: [
      { targetField: "id", sourceColumn: "id", selectedType: "TEXT" },
      {
        targetField: "business_name",
        sourceColumn: "business_name",
        selectedType: "TEXT"
      },
      { targetField: "stage", sourceColumn: "stage", selectedType: "STATUS" },
      { targetField: "value", sourceColumn: "value", selectedType: "NUMBER" },
      {
        targetField: "probability",
        sourceColumn: "probability",
        selectedType: "NUMBER"
      }
    ],
    ...overrides
  };
}

async function authContext({
  tenantId = "a0e8a2a0-9c44-4d84-9263-7d417ac00b8e",
  role = "OWNER"
} = {}) {
  return resolveTenantContext({
    identity: {
      issuer: "https://tenant.au.auth0.com/",
      subject: `auth0|${role}`
    },
    membershipRepository: {
      async findActiveMembershipsByIdentity({ issuer, subject }) {
        return [{ tenantId, issuer, subject, role, status: "ACTIVE" }];
      }
    }
  });
}

function persistenceContext(authorizationContext) {
  return createTenantContext({
    tenantId: authorizationContext.tenantId,
    subjectId: authorizationContext.subject
  });
}

test("canonical commit preserves exact commercial evidence and known numeric zero", () => {
  const plan = buildCanonicalCommitPlan(stagedEvidence(
    "source_id,id,business_name,stage,value,probability\n" +
    "src-1,opp-1,Large Trade,QUALIFIED,9007199254740993,0\n" +
    "src-2,opp-2,Tiny Trade,QUALIFIED,1e-4000,0\n" +
    "src-3,opp-3,Unknown Trade,QUALIFIED,n/a,0\n" +
    "src-4,opp-4,Zero Trade,QUALIFIED,0,0"
  ), commitInput());

  assert.equal(plan.outcome, "READY");
  assert.equal(plan.rows.length, 4);
  assert.equal(plan.rows[0].canonicalRecord.value, "9007199254740993");
  assert.equal(plan.rows[1].canonicalRecord.value, "1e-4000");
  assert.equal(plan.rows[2].canonicalRecord.value, "unknown");
  assert.equal(plan.rows[0].canonicalRecord.probability, 0);
  assert.equal(plan.rows[3].canonicalRecord.value, 0);
  assert.equal(plan.rows[3].canonicalRecord.probability, 0);
  assert.equal(
    new Set(plan.rows.map(row => row.canonicalPayloadSha256)).size,
    plan.rows.length
  );
  assert.match(plan.rows[0].canonicalPayloadSha256, /^[0-9a-f]{64}$/);
  assert.equal(plan.rows[0].rawPayloadSha256, plan.evidence.records[0].rawPayloadSha256);
});

test("parser-classified unknown source identities fail without becoming global IDs", () => {
  for (const literal of ["unknown", "n/a", "na", "not known", " N/A "]) {
    const plan = buildCanonicalCommitPlan(stagedEvidence(
      "source_id,id,business_name,stage,value,probability\n" +
      `${literal},opp-1,Unknown Identity,QUALIFIED,0,0`
    ), commitInput());

    assert.equal(plan.outcome, "FAILED", literal);
    assert.equal(plan.summary.failed, 1, literal);
    assert.equal(plan.failures[0].code, "CANONICAL_ROW_VALIDATION_FAILED");
    assert.equal(
      plan.failures[0].validationErrors.some(issue =>
        issue.code === "SOURCE_IDENTITY_UNKNOWN"),
      true,
      literal
    );
  }
});

test("request fingerprints use the complete normalized reviewed-selection vector", () => {
  const evidence = stagedEvidence(
    "source_id,id,business_name,stage,value,probability\n" +
    "src-1,opp-1,Acme,QUALIFIED,0,0"
  );
  const omitted = buildCanonicalCommitPlan(evidence, commitInput());
  const explicitUnmapped = buildCanonicalCommitPlan(evidence, commitInput({
    selections: [
      ...commitInput().selections,
      {
        targetField: "contact_name",
        sourceColumn: null,
        selectedType: "TEXT"
      }
    ]
  }));

  assert.equal(omitted.outcome, "READY");
  assert.equal(explicitUnmapped.outcome, "READY");
  assert.equal(omitted.requestFingerprint, explicitUnmapped.requestFingerprint);
});

test("canonical commit rejects malformed and duplicate reviewed selections", () => {
  const evidence = stagedEvidence(
    "source_id,id,business_name,stage,value,probability\n" +
    "src-1,opp-1,Acme,QUALIFIED,0,0"
  );

  for (const selections of [
    [{ targetField: "id", sourceColumn: "id", selectedType: "TEXT", tenantId: "forged" }],
    [
      { targetField: "id", sourceColumn: "id", selectedType: "TEXT" },
      { targetField: "id", sourceColumn: "business_name", selectedType: "TEXT" }
    ]
  ]) {
    assert.throws(
      () => buildCanonicalCommitPlan(evidence, commitInput({ selections })),
      error => error.code === "IMPORT_COMMIT_REQUEST_INVALID"
    );
  }
});

test("canonical commit validates every staged row beyond the preview sample", () => {
  const rows = Array.from({ length: 101 }, (_, index) => (
    `${index},opp-${index},${index === 100 ? "" : `Trade ${index}`},QUALIFIED,0,0`
  ));
  const plan = buildCanonicalCommitPlan(stagedEvidence(
    "source_id,id,business_name,stage,value,probability\n" + rows.join("\n")
  ), commitInput());

  assert.equal(plan.outcome, "FAILED");
  assert.equal(plan.summary.total, 101);
  assert.equal(plan.summary.failed, 101);
  assert.equal(plan.failures[0].sourceOrdinal, 100);
});

test("the first exact source-ordered row wins and exact repeats are explicit skips", () => {
  const evidence = stagedEvidence(
    "source_id,id,business_name,stage,value,probability\n" +
    "src-1,opp-1,Acme,QUALIFIED,0,0\n" +
    "src-1,opp-1,Acme,QUALIFIED,0,0"
  );
  const plan = buildCanonicalCommitPlan(evidence, commitInput());

  assert.equal(plan.outcome, "READY");
  assert.equal(plan.rows[0].disposition, "COMMITTED");
  assert.equal(plan.rows[1].disposition, "EXACT_DUPLICATE");
  assert.equal(plan.rows[1].canonicalRecord, null);
  assert.equal(plan.rows[1].duplicateOfSourceOrdinal, 0);
  assert.deepEqual(plan.summary, {
    total: 2,
    committed: 1,
    skipped: 1,
    conflicted: 0,
    failed: 0
  });
});

test("one source identity with different canonical payloads conflicts the whole batch", () => {
  const plan = buildCanonicalCommitPlan(stagedEvidence(
    "source_id,id,business_name,stage,value,probability\n" +
    "src-1,opp-1,Acme,QUALIFIED,0,0\n" +
    "src-1,opp-1,Changed,QUALIFIED,0,0"
  ), commitInput());

  assert.equal(plan.outcome, "CONFLICTED");
  assert.equal(plan.rows.every(row => row.canonicalRecord === null), true);
  assert.deepEqual(plan.summary, {
    total: 2,
    committed: 0,
    skipped: 0,
    conflicted: 2,
    failed: 0
  });
  assert.equal(plan.conflicts[0].code, "SOURCE_IDENTITY_PAYLOAD_CONFLICT");
  assert.deepEqual(plan.conflicts[0].sourceOrdinals, [0, 1]);
});

test("same identity and canonical payload still conflicts when immutable raw evidence differs", () => {
  const plan = buildCanonicalCommitPlan(stagedEvidence(
    "source_id,id,business_name,stage,value,probability,note\n" +
    "src-1,opp-1,Acme,QUALIFIED,0,0,first\n" +
    "src-1,opp-1,Acme,QUALIFIED,0,0,changed"
  ), commitInput());

  assert.equal(plan.outcome, "CONFLICTED");
  assert.equal(plan.conflicts[0].code, "SOURCE_IDENTITY_EVIDENCE_CONFLICT");
  assert.deepEqual(plan.conflicts[0].sourceOrdinals, [0, 1]);
});

test("commit service authorizes operational admins and rebuilds the plan inside one repository boundary", async () => {
  const evidence = stagedEvidence(
    "source_id,id,business_name,stage,value,probability\n" +
    "src-1,opp-1,Acme,QUALIFIED,unknown,0"
  );
  const calls = [];
  const persistence = {
    adapter: "postgres",
    forTenant(context) {
      calls.push(["forTenant", context]);
      return {
        imports: {
          async commitCanonical(request) {
            calls.push(["commitCanonical", request]);
            const plan = request.prepare(evidence);
            assert.equal(plan.rows[0].canonicalRecord.value, "unknown");
            return {
              outcome: "COMMITTED",
              batch: { id: evidence.batch.id, status: "COMMITTED" },
              rows: plan.rows,
              summary: plan.summary,
              reconciled: false
            };
          },
          async findCommit() {
            assert.fail("findCommit is not expected");
          }
        }
      };
    }
  };
  const service = createImportService({
    persistence,
    clock: () => new Date("2026-09-02T01:02:03.000Z")
  });

  for (const role of ["OWNER", "ADMIN"]) {
    const authorizationContext = await authContext({ role });
    const result = await service.commitBatch({
      authorizationContext,
      persistenceContext: persistenceContext(authorizationContext),
      batchId: evidence.batch.id,
      input: commitInput()
    });
    assert.equal(result.outcome, "COMMITTED");
    const request = calls.findLast(([name]) => name === "commitCanonical")[1];
    assert.equal(request.batchId, evidence.batch.id);
    assert.equal(request.subjectId, `auth0|${role}`);
    assert.equal(request.committedAt, "2026-09-02T01:02:03.000Z");
  }
});

test("commit rejects members and caller-authored authority before persistence", async () => {
  const calls = [];
  const persistence = {
    adapter: "postgres",
    forTenant() {
      calls.push("forTenant");
      return { imports: {} };
    }
  };
  const service = createImportService({ persistence });
  const member = await authContext({ role: "MEMBER" });
  await assert.rejects(
    service.commitBatch({
      authorizationContext: member,
      persistenceContext: persistenceContext(member),
      batchId: "batch-commit",
      input: commitInput()
    }),
    error => error.code === "ACCESS_DENIED" && error.status === 403
  );

  const owner = await authContext();
  await assert.rejects(
    service.commitBatch({
      authorizationContext: owner,
      persistenceContext: persistenceContext(owner),
      batchId: "batch-commit",
      input: { ...commitInput(), tenantId: owner.tenantId }
    }),
    error => error.code === "IMPORT_COMMIT_REQUEST_INVALID"
  );
  assert.deepEqual(calls, []);
});

test("commit reconciliation reads remain tenant-generic and expose only committed evidence", async () => {
  const tenantA = await authContext();
  const tenantB = await authContext({
    tenantId: "b0e8a2a0-9c44-4d84-9263-7d417ac00b8e"
  });
  const results = new Map([[
    `${tenantA.tenantId}:batch-commit`,
    { outcome: "COMMITTED", batch: { id: "batch-commit", status: "COMMITTED" } }
  ]]);
  const persistence = {
    adapter: "postgres",
    forTenant(context) {
      return {
        imports: {
          async findCommit(batchId) {
            return structuredClone(results.get(`${context.tenantId}:${batchId}`) || null);
          }
        }
      };
    }
  };
  const service = createImportService({ persistence });
  assert.equal((await service.readCommit({
    authorizationContext: tenantA,
    persistenceContext: persistenceContext(tenantA),
    batchId: "batch-commit"
  })).outcome, "COMMITTED");

  for (const batchId of ["batch-commit", "missing"]) {
    await assert.rejects(
      service.readCommit({
        authorizationContext: tenantB,
        persistenceContext: persistenceContext(tenantB),
        batchId
      }),
      error => error instanceof ImportContractError
        && error.code === "IMPORT_BATCH_UNAVAILABLE"
        && error.status === 404
    );
  }
});

test("commit and reconciliation HTTP routes stay thin and return auditable outcomes", async () => {
  const owner = await authContext();
  const trustedPersistence = persistenceContext(owner);
  const calls = [];
  const committed = {
    outcome: "COMMITTED",
    batch: { id: "batch-commit", status: "COMMITTED" },
    rows: [{
      sourceOrdinal: 0,
      sourceRecordId: "src-1",
      targetId: "opp-1",
      disposition: "COMMITTED"
    }],
    summary: { total: 1, committed: 1, skipped: 0, conflicted: 0, failed: 0 },
    reconciled: false
  };
  const service = {
    async createPreview() { assert.fail("createPreview is not expected"); },
    async readPreview() { assert.fail("readPreview is not expected"); },
    async analyzePreview() { assert.fail("analyzePreview is not expected"); },
    async commitBatch(request) {
      calls.push(["commitBatch", request]);
      return committed;
    },
    async readCommit(request) {
      calls.push(["readCommit", request]);
      return { ...committed, reconciled: true };
    }
  };
  const router = createImportsRouter({
    service,
    resolveAuthorizationContext: () => owner,
    resolvePersistenceContext: () => trustedPersistence
  });

  const created = await requestRouter(
    router,
    "/api/import-batches/batch-commit/commit",
    { method: "POST", body: commitInput() }
  );
  assert.equal(created.status, 200);
  assert.deepEqual(created.data.data, committed);
  assert.equal(calls[0][1].batchId, "batch-commit");
  assert.deepEqual(calls[0][1].input, commitInput());

  const reconciled = await requestRouter(
    router,
    "/api/import-batches/batch-commit/commit"
  );
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.data.data.reconciled, true);
  assert.equal(calls[1][1].batchId, "batch-commit");
});

test("commit HTTP conflicts expose bounded outcome evidence without raw staged cells", async () => {
  const owner = await authContext();
  const safeDetails = {
    outcome: "CONFLICTED",
    batch: { id: "batch-commit", status: "PREVIEWED" },
    rows: [{ sourceOrdinal: 0, disposition: "CONFLICTED" }],
    summary: { total: 1, committed: 0, skipped: 0, conflicted: 1, failed: 0 },
    conflicts: [{ code: "CANONICAL_ID_COLLISION", targetId: "opp-1" }],
    reconciled: false
  };
  const service = {
    async createPreview() {},
    async readPreview() {},
    async analyzePreview() {},
    async readCommit() {},
    async commitBatch() {
      throw new ImportContractError(
        "IMPORT_COMMIT_CONFLICT",
        "The canonical import commit conflicts with existing import or canonical identity.",
        409,
        safeDetails
      );
    }
  };
  const router = createImportsRouter({
    service,
    resolveAuthorizationContext: () => owner,
    resolvePersistenceContext: () => persistenceContext(owner)
  });
  const response = await requestRouter(
    router,
    "/api/import-batches/batch-commit/commit",
    { method: "POST", body: commitInput() }
  );

  assert.equal(response.status, 409);
  assert.deepEqual(response.data, {
    ok: false,
    error: "IMPORT_COMMIT_CONFLICT",
    message: "The canonical import commit conflicts with existing import or canonical identity.",
    details: safeDetails
  });
  assert.equal(JSON.stringify(response.data).includes("rawPayload"), false);
});

test("lost commit acknowledgement returns only the batch ID for explicit reconciliation", async () => {
  const owner = await authContext();
  const service = {
    async createPreview() {},
    async readPreview() {},
    async analyzePreview() {},
    async readCommit() {},
    async commitBatch() {
      throw new PostgresTransactionOutcomeUnknownError(
        new Error("commit acknowledgement lost"),
        { batch: { id: "batch-commit" }, rawPayload: "must-not-leak" }
      );
    }
  };
  const router = createImportsRouter({
    service,
    resolveAuthorizationContext: () => owner,
    resolvePersistenceContext: () => persistenceContext(owner)
  });
  const response = await requestRouter(
    router,
    "/api/import-batches/batch-commit/commit",
    { method: "POST", body: commitInput() }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(response.data, {
    ok: false,
    error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
    message: "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
    details: { attemptedId: "batch-commit" }
  });
});

async function requestRouter(
  router,
  pathname,
  { method = "GET", body } = {}
) {
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${pathname}`,
      {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      }
    );
    return { status: response.status, data: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close(error =>
      error ? reject(error) : resolve()));
  }
}
