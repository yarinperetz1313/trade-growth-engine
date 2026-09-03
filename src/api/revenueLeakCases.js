"use strict";

const express = require("express");

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
const {
  createRevenueLeakCaseService
} = require("../revenueLeakCases/revenueLeakCaseService");

function sendResult(res, result, successStatus = 200) {
  if (result.ok === false) {
    const { statusCode, ...body } = result;
    return res.status(statusCode || 400).json(body);
  }
  return res.status(successStatus).json(result);
}

function validateBody(req, res) {
  if (
    req.body === null
    || typeof req.body !== "object"
    || Array.isArray(req.body)
  ) {
    res.status(400).json({
      ok: false,
      error: "INVALID_REQUEST_BODY",
      message: "Request body must be a JSON object.",
      details: { field: "body" }
    });
    return null;
  }
  return req.body;
}

function validateDetectorBody(req, res) {
  if (
    req.body === undefined
    || (
      req.body !== null
      && typeof req.body === "object"
      && !Array.isArray(req.body)
      && Object.keys(req.body).length === 0
    )
  ) {
    return true;
  }
  res.status(400).json({
    ok: false,
    error: "REVENUE_LEAK_DETECTOR_REQUEST_INVALID",
    message: "Stalled-opportunity detection accepts only an empty JSON object.",
    details: { field: "body" }
  });
  return false;
}

function createRevenueLeakCasesRouter({ service, resolveTenantContext } = {}) {
  if (!service || typeof service.forTenant !== "function") {
    throw new TypeError("A tenant-bound RevenueLeakCase service is required.");
  }
  if (typeof resolveTenantContext !== "function") {
    throw new TypeError(
      "A server-injected TenantContext resolver is required for tenant-bound RevenueLeakCase persistence."
    );
  }

  async function requestService(req) {
    const context = requireTenantContext(await resolveTenantContext(req));
    return service.forTenant(context);
  }

  function route(handler) {
    return async (req, res) => {
      try {
        return await handler(req, res, requestService);
      } catch {
        return res.status(500).json({
          ok: false,
          error: "REVENUE_LEAK_CASE_PERSISTENCE_UNAVAILABLE",
          message: "Revenue leak case persistence is temporarily unavailable."
        });
      }
    };
  }

  const router = express.Router();

  router.get("/api/revenue-leak-cases", route(async (req, res, resolveService) => {
    const requestBound = await resolveService(req);
    const data = await requestBound.listRevenueLeakCases({
      opportunityId: typeof req.query.opportunity_id === "string"
        && req.query.opportunity_id.length > 0
        ? req.query.opportunity_id
        : undefined,
      state: typeof req.query.state === "string" && req.query.state.length > 0
        ? req.query.state
        : undefined
    });
    return res.json({ ok: true, data, count: data.length });
  }));

  router.get("/api/revenue-leak-cases/:id", route(async (req, res, resolveService) => {
    const requestBound = await resolveService(req);
    const result = await requestBound.getRevenueLeakCase(req.params.id);
    return result.ok === false
      ? sendResult(res, result)
      : res.json({ ok: true, data: result });
  }));

  router.post("/api/revenue-leak-cases/reconcile", route(async (
    req,
    res,
    resolveService
  ) => {
    const body = validateBody(req, res);
    if (body === null) return;
    const requestBound = await resolveService(req);
    const result = await requestBound.reconcileRevenueLeakCase(body);
    return sendResult(res, result, result.created ? 201 : 200);
  }));

  router.post(
    "/api/opportunities/:id/revenue-leak-cases/detect-stalled",
    route(async (req, res, resolveService) => {
      if (!validateDetectorBody(req, res)) return;
      const requestBound = await resolveService(req);
      const result = await requestBound.detectStalledOpportunity(req.params.id);
      return sendResult(
        res,
        result,
        result.reconciliation?.created ? 201 : 200
      );
    })
  );

  for (const [routeName, serviceMethod] of [
    ["snooze", "snoozeRevenueLeakCase"],
    ["resume", "resumeRevenueLeakCase"],
    ["dismiss", "dismissRevenueLeakCase"]
  ]) {
    router.post(`/api/revenue-leak-cases/:id/${routeName}`, route(async (
      req,
      res,
      resolveService
    ) => {
      const body = validateBody(req, res);
      if (body === null) return;
      const requestBound = await resolveService(req);
      return sendResult(res, await requestBound[serviceMethod](req.params.id, body));
    }));
  }

  router.post("/api/revenue-leak-cases/:id/link-revenue-action", route(async (
    req,
    res,
    resolveService
  ) => {
    const body = validateBody(req, res);
    if (body === null) return;
    const requestBound = await resolveService(req);
    return sendResult(res, await requestBound.linkRevenueAction(req.params.id, body));
  }));

  return router;
}

const localContext = createTenantContext({
  tenantId: LOCAL_REVENUE_LEAK_TENANT_ID,
  subjectId: "local-runtime"
});
const localService = createRevenueLeakCaseService({
  persistence: createPersistence({ adapter: "json" })
});
const router = createRevenueLeakCasesRouter({
  service: localService,
  resolveTenantContext: () => localContext
});

module.exports = router;
module.exports.createRevenueLeakCasesRouter = createRevenueLeakCasesRouter;
