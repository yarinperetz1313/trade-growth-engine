"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const test = require("node:test");

const {
  createPilotEvidenceRouter
} = require("../src/api/pilotEvidence");
const {
  createTenantContext
} = require("../src/persistence/tenantContext");

const CONTEXT = createTenantContext({
  tenantId: "10000000-0000-4000-8000-000000000001",
  subjectId: "auth0|operator-a"
});

async function withServer(router, operation) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  try {
    await new Promise(resolve => server.once("listening", resolve));
    await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

test("pilot evidence API exposes only status, surfaced, inspected, and closed feedback commands", async () => {
  const calls = [];
  const service = {
    forTenant(context) {
      assert.equal(context, CONTEXT);
      return {
        getStatus: async () => ({ events: [], latest_import: null }),
        recordCaseSurfaced: async id => (calls.push(["surface", id]), { ok: true, duplicate: false }),
        recordCaseInspected: async id => (calls.push(["inspect", id]), { ok: true, duplicate: false }),
        recordFeedback: async (id, code) => (calls.push(["feedback", id, code]), { ok: true, duplicate: false })
      };
    }
  };
  const router = createPilotEvidenceRouter({
    service,
    resolveTenantContext: () => CONTEXT
  });

  await withServer(router, async baseUrl => {
    assert.equal((await request(baseUrl, "GET", "/api/pilot-evidence/status")).status, 200);
    assert.equal((await request(
      baseUrl,
      "GET",
      `/api/pilot-evidence/status?tenant_id=${CONTEXT.tenantId}`
    )).status, 400);
    assert.equal((await request(baseUrl, "POST", "/api/pilot-evidence/cases/case-1/surfaced", {})).status, 200);
    assert.equal((await request(baseUrl, "POST", "/api/pilot-evidence/cases/case-1/inspected", {})).status, 200);
    assert.equal((await request(baseUrl, "POST", "/api/pilot-evidence/cases/case-1/feedback", {
      feedback_code: "USEFUL"
    })).status, 200);

    for (const [path, body] of [
      ["/api/pilot-evidence/cases/case-1/surfaced", { tenant_id: CONTEXT.tenantId }],
      ["/api/pilot-evidence/cases/case-1/inspected", { evidence_text: "customer content" }],
      ["/api/pilot-evidence/cases/case-1/feedback", { feedback_code: "OTHER" }],
      ["/api/pilot-evidence/cases/case-1/feedback", { feedback_code: "WRONG", comment: "free text" }]
    ]) {
      const rejected = await request(baseUrl, "POST", path, body);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.data.error, "PILOT_EVIDENCE_REQUEST_INVALID");
      assert.equal(JSON.stringify(rejected.data).includes("customer content"), false);
      assert.equal(JSON.stringify(rejected.data).includes("free text"), false);
    }
  });

  assert.deepEqual(calls, [
    ["surface", "case-1"],
    ["inspect", "case-1"],
    ["feedback", "case-1", "USEFUL"]
  ]);
});
