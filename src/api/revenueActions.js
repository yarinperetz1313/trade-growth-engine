const express = require("express");

const legacyService = require("../revenueActions/revenueActionService");
const {
  requireTenantContext
} = require("../persistence/tenantContext");

function sendResult(res, result, successStatus = 200) {
  if (result.ok === false) {
    const { statusCode, ...body } = result;
    return res.status(statusCode || 400).json(body);
  }
  return res.status(successStatus).json(result);
}

function validateBody(req, res) {
  if (req.body === undefined) return {};
  if (!legacyService.isPlainObject(req.body)) {
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

function createRevenueActionsRouter({
  service = legacyService,
  resolveTenantContext
} = {}) {
  const tenantBound = typeof service?.forTenant === "function";
  if (tenantBound && typeof resolveTenantContext !== "function") {
    throw new TypeError(
      "A server-injected TenantContext resolver is required for tenant-bound RevenueAction persistence."
    );
  }

  async function requestService(req) {
    if (!tenantBound) return service;
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
          error: "REVENUE_ACTION_PERSISTENCE_UNAVAILABLE",
          message: "Revenue action persistence is temporarily unavailable."
        });
      }
    };
  }

  const router = express.Router();

  router.get("/api/revenue-actions", route(async (req, res, resolveService) => {
    const requestBound = await resolveService(req);
    const data = await requestBound.listRevenueActions({
      opportunityId: typeof req.query.opportunity_id === "string" &&
        req.query.opportunity_id.length > 0
        ? req.query.opportunity_id
        : undefined
    });
    res.json({ ok: true, data, count: data.length });
  }));

  router.get("/api/revenue-actions/:id", route(async (req, res, resolveService) => {
    const requestBound = await resolveService(req);
    const result = await requestBound.getRevenueAction(req.params.id);
    return result.ok === false
      ? sendResult(res, result)
      : res.json({ ok: true, data: result });
  }));

  router.post("/api/opportunities/:id/revenue-actions", route(async (
    req,
    res,
    resolveService
  ) => {
    if (validateBody(req, res) === null) return;
    const requestBound = await resolveService(req);
    const result = await requestBound.materializeRevenueAction(req.params.id);
    return sendResult(res, result, result.created ? 201 : 200);
  }));

  router.post("/api/revenue-actions/:id/prepare", route(async (
    req,
    res,
    resolveService
  ) => {
    if (validateBody(req, res) === null) return;
    const requestBound = await resolveService(req);
    return sendResult(res, await requestBound.prepareRevenueAction(req.params.id));
  }));

  router.post("/api/revenue-actions/:id/approve", route(async (
    req,
    res,
    resolveService
  ) => {
    if (validateBody(req, res) === null) return;
    const requestBound = await resolveService(req);
    return sendResult(res, await requestBound.approveRevenueAction(req.params.id));
  }));

  router.post("/api/revenue-actions/:id/reject", route(async (
    req,
    res,
    resolveService
  ) => {
    const body = validateBody(req, res);
    if (body === null) return;
    if (body.reason !== undefined && typeof body.reason !== "string") {
      return res.status(400).json({
        ok: false,
        error: "INVALID_REQUEST_BODY",
        message: "Rejection reason must be a string when provided.",
        details: { field: "reason" }
      });
    }
    const requestBound = await resolveService(req);
    return sendResult(
      res,
      await requestBound.rejectRevenueAction(req.params.id, body.reason)
    );
  }));

  router.post("/api/revenue-actions/:id/cancel", route(async (
    req,
    res,
    resolveService
  ) => {
    if (validateBody(req, res) === null) return;
    const requestBound = await resolveService(req);
    return sendResult(res, await requestBound.cancelRevenueAction(req.params.id));
  }));

  router.post("/api/revenue-actions/:id/execute", route(async (
    req,
    res,
    resolveService
  ) => {
    const body = validateBody(req, res);
    if (body === null) return;
    const requestBound = await resolveService(req);
    return sendResult(
      res,
      await requestBound.executeRevenueAction(req.params.id, body)
    );
  }));

  return router;
}

const router = createRevenueActionsRouter();

module.exports = router;
module.exports.createRevenueActionsRouter = createRevenueActionsRouter;
