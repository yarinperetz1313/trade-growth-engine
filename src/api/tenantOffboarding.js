"use strict";

const express = require("express");

const { AuthorizationError } = require("../auth/authorization");
const {
  TenantOffboardingError
} = require("../tenantOffboarding/tenantOffboardingService");

function createTenantOffboardingRouter({
  service,
  resolveAuthorizationContext,
  resolvePersistenceContext
} = {}) {
  if (!service?.request || !service?.status) {
    throw new TypeError("A tenant offboarding service is required.");
  }
  if (
    typeof resolveAuthorizationContext !== "function"
    || typeof resolvePersistenceContext !== "function"
  ) {
    throw new TypeError("Trusted offboarding context resolvers are required.");
  }

  const router = express.Router();
  const contexts = async req => ({
    authorizationContext: await resolveAuthorizationContext(req),
    persistenceContext: await resolvePersistenceContext(req)
  });

  router.post("/api/tenant-offboarding", route(async (req, res) => {
    const result = await service.request({
      ...(await contexts(req)),
      input: req.body,
      request: req
    });
    res.status(202).json({ ok: true, data: result });
  }));

  router.get("/api/tenant-offboarding", route(async (req, res) => {
    const result = await service.status(await contexts(req));
    res.json({ ok: true, data: result });
  }));

  return router;
}

function route(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (
        error instanceof TenantOffboardingError
        || error instanceof AuthorizationError
      ) {
        return res.status(error.status || 400).json({
          ok: false,
          error: error.code,
          message: error.message
        });
      }
      return next(error);
    }
  };
}

module.exports = { createTenantOffboardingRouter };
