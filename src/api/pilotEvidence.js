"use strict";

const express = require("express");

const {
  FEEDBACK_CODES,
  PilotEvidenceError
} = require("../pilotEvidence/pilotEvidenceDomain");
const {
  createPilotEvidenceService
} = require("../pilotEvidence/pilotEvidenceService");
const {
  createPersistence
} = require("../persistence/createPersistence");
const {
  createTenantContext,
  requireTenantContext
} = require("../persistence/tenantContext");
const {
  LOCAL_REVENUE_LEAK_TENANT_ID
} = require("../revenueLeakCases/jsonRevenueLeakCaseRepository");

const FEEDBACK = new Set(FEEDBACK_CODES);

function createPilotEvidenceRouter({ service, resolveTenantContext } = {}) {
  if (!service || typeof service.forTenant !== "function") {
    throw new TypeError("A tenant-bound pilot evidence service is required.");
  }
  if (typeof resolveTenantContext !== "function") {
    throw new TypeError("A server-injected TenantContext resolver is required.");
  }

  async function requestService(req) {
    return service.forTenant(requireTenantContext(await resolveTenantContext(req)));
  }

  const router = express.Router();
  router.get("/api/pilot-evidence/status", route(async (req, res) => {
    if (Object.keys(req.query || {}).length > 0) return invalidRequest(res);
    const requestBound = await requestService(req);
    return res.json({ ok: true, data: await requestBound.getStatus() });
  }));

  for (const [path, method] of [
    ["surfaced", "recordCaseSurfaced"],
    ["inspected", "recordCaseInspected"]
  ]) {
    router.post(`/api/pilot-evidence/cases/:id/${path}`, route(async (req, res) => {
      if (!validCaseId(req.params.id) || !emptyBody(req.body)) {
        return invalidRequest(res);
      }
      const requestBound = await requestService(req);
      return sendResult(res, await requestBound[method](req.params.id));
    }));
  }

  router.post("/api/pilot-evidence/cases/:id/feedback", route(async (req, res) => {
    if (
      !validCaseId(req.params.id)
      || !exactObject(req.body, ["feedback_code"])
      || !FEEDBACK.has(req.body.feedback_code)
    ) return invalidRequest(res);
    const requestBound = await requestService(req);
    return sendResult(
      res,
      await requestBound.recordFeedback(req.params.id, req.body.feedback_code)
    );
  }));
  return router;
}

function sendResult(res, result) {
  if (result?.ok === false) {
    const { statusCode, ...body } = result;
    return res.status(statusCode || 400).json(body);
  }
  return res.json(result);
}

function route(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      if (error instanceof PilotEvidenceError) {
        return res.status(error.status || 400).json({
          ok: false,
          error: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        });
      }
      return res.status(500).json({
        ok: false,
        error: "PILOT_EVIDENCE_PERSISTENCE_UNAVAILABLE",
        message: "Pilot evidence persistence is temporarily unavailable."
      });
    }
  };
}

function invalidRequest(res) {
  return res.status(400).json({
    ok: false,
    error: "PILOT_EVIDENCE_REQUEST_INVALID",
    message: "The pilot evidence request is invalid."
  });
}

function validCaseId(value) {
  return typeof value === "string"
    && value !== ""
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 255;
}

function emptyBody(value) {
  return value === undefined || exactObject(value, []);
}

function exactObject(value, keys) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
  );
}

const localContext = createTenantContext({
  tenantId: LOCAL_REVENUE_LEAK_TENANT_ID,
  subjectId: "local-runtime"
});
const localService = createPilotEvidenceService({
  persistence: createPersistence({ adapter: "json" })
});
const router = createPilotEvidenceRouter({
  service: localService,
  resolveTenantContext: () => localContext
});

module.exports = router;
module.exports.createPilotEvidenceRouter = createPilotEvidenceRouter;
