const express = require("express");

const {
  requireTenantContext
} = require("../persistence/tenantContext");

function createPostgresCoreRouter({ service, resolveTenantContext } = {}) {
  if (!service || typeof service.forTenant !== "function") {
    throw new TypeError("A tenant-bound PostgreSQL core service is required.");
  }
  if (typeof resolveTenantContext !== "function") {
    throw new TypeError(
      "A server-injected TenantContext resolver is required for tenant-bound core persistence."
    );
  }

  async function requestService(req) {
    const context = requireTenantContext(await resolveTenantContext(req));
    return service.forTenant(context);
  }

  function route(handler) {
    return async (req, res) => {
      try {
        return await handler(req, res, await requestService(req));
      } catch {
        return res.status(500).json({
          ok: false,
          error: "POSTGRES_PERSISTENCE_UNAVAILABLE",
          message: "PostgreSQL persistence is temporarily unavailable."
        });
      }
    };
  }

  function sendMutation(res, result) {
    if (result.ok === false) {
      return res.status(result.error === "OPPORTUNITY_NOT_FOUND" ? 404 : 400)
        .json(result);
    }
    return res.json(result);
  }

  const router = express.Router();

  router.get("/api/prospects", route(async (req, res, requestBound) => {
    const result = await requestBound.listProspects({
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0
    });
    res.json({ ok: true, ...result });
  }));

  router.post("/api/prospects", route(async (req, res, requestBound) => {
    const result = await requestBound.createProspect(req.body || {});
    res.status(201).json({ ok: true, ...result });
  }));

  router.post("/api/prospects/:id/qualify", route(async (
    req,
    res,
    requestBound
  ) => {
    const result = await requestBound.qualifyProspect(req.params.id);
    if (result.error) {
      return res.status(result.error === "PROSPECT_NOT_FOUND" ? 404 : 400)
        .json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, ...result });
  }));

  router.post("/api/qualification/preview", route(async (
    req,
    res,
    requestBound
  ) => {
    res.json({
      ok: true,
      data: await requestBound.previewQualification(req.body || {})
    });
  }));

  for (const method of ["get", "post"]) {
    router[method]("/api/leads", route(async (req, res) => res.status(501).json({
      ok: false,
      error: "POSTGRES_LEAD_PERSISTENCE_UNSUPPORTED",
      message: "Lead persistence is not available in PostgreSQL mode."
    })));
  }

  router.get("/api/opportunities", route(async (req, res, requestBound) => {
    const data = await requestBound.listOpportunities();
    res.json({ ok: true, data, count: data.length });
  }));

  router.post("/api/opportunities/from-prospect/:id", route(async (
    req,
    res,
    requestBound
  ) => {
    const result = await requestBound.createOpportunityFromProspect(req.params.id);
    if (result.error) {
      return res.status(result.error === "PROSPECT_NOT_FOUND" ? 404 : 400)
        .json({ ok: false, error: result.error });
    }
    return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
  }));

  router.patch("/api/opportunities/:id/stage", route(async (
    req,
    res,
    requestBound
  ) => {
    const result = await requestBound.updateOpportunityStage(
      req.params.id,
      req.body?.stage
    );
    if (result.error) {
      return res.status(result.error === "OPPORTUNITY_NOT_FOUND" ? 404 : 400)
        .json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, ...result });
  }));

  router.get("/api/pipeline/metrics", route(async (req, res, requestBound) => {
    res.json({ ok: true, data: await requestBound.getPipelineMetrics() });
  }));

  router.get("/api/opportunities/:id/intelligence", route(async (
    req,
    res,
    requestBound
  ) => {
    const result = await requestBound.getOpportunityIntelligence(req.params.id);
    if (result.error) {
      return res.status(result.error === "OPPORTUNITY_NOT_FOUND" ? 404 : 400)
        .json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, data: result });
  }));

  router.post("/api/opportunities/:id/intelligence/contact", route(async (
    req,
    res,
    requestBound
  ) => sendMutation(res, await requestBound.addContact({
    opportunityId: req.params.id,
    contactName: req.body?.contactName
  }))));

  router.post("/api/opportunities/:id/intelligence/value", route(async (
    req,
    res,
    requestBound
  ) => sendMutation(res, await requestBound.setValue({
    opportunityId: req.params.id,
    value: req.body?.value
  }))));

  router.post("/api/opportunities/:id/intelligence/follow-up", route(async (
    req,
    res,
    requestBound
  ) => sendMutation(res, await requestBound.createIntelligenceTask({
    opportunityId: req.params.id,
    title: req.body?.title,
    priority: req.body?.priority,
    actionType: req.body?.actionType,
    followUp: true
  }))));

  router.post("/api/opportunities/:id/intelligence/task", route(async (
    req,
    res,
    requestBound
  ) => sendMutation(res, await requestBound.createIntelligenceTask({
    opportunityId: req.params.id,
    title: req.body?.title,
    priority: req.body?.priority,
    actionType: req.body?.actionType
  }))));

  router.get("/api/opportunities/:id/activities", route(async (
    req,
    res,
    requestBound
  ) => {
    const data = await requestBound.listActivities(req.params.id);
    res.json({ ok: true, data, count: data.length });
  }));

  router.get("/api/tasks", route(async (req, res, requestBound) => {
    const data = await requestBound.listTasks();
    res.json({ ok: true, data, count: data.length });
  }));

  router.get("/api/tasks/opportunity/:opportunityId", route(async (
    req,
    res,
    requestBound
  ) => {
    const data = await requestBound.listTasks(req.params.opportunityId);
    res.json({ ok: true, data, count: data.length });
  }));

  router.post("/api/tasks", route(async (req, res, requestBound) => {
    const result = await requestBound.createTask(req.body || {});
    if (result.ok === false) return res.status(400).json(result);
    return res.status(result.duplicate ? 200 : 201).json(result);
  }));

  router.patch("/api/tasks/:id", route(async (req, res, requestBound) => {
    const result = await requestBound.updateTask(req.params.id, req.body || {});
    if (result.ok === false) {
      return res.status(result.error === "Task not found" ? 404 : 400).json(result);
    }
    return res.json(result);
  }));

  router.get("/api/intelligence/revenue", route(async (
    req,
    res,
    requestBound
  ) => {
    res.json({ ok: true, data: await requestBound.getRevenueIntelligence() });
  }));

  return router;
}

module.exports = {
  createPostgresCoreRouter
};
