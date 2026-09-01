const express = require("express");

const { AuthorizationError } = require("../auth/authorization");
const { ImportCsvError } = require("../imports/csvParser");
const { ImportContractError } = require("../imports/importService");

function createImportsRouter({
  service,
  resolveAuthorizationContext,
  resolvePersistenceContext
} = {}) {
  if (
    !service
    || typeof service.createPreview !== "function"
    || typeof service.readPreview !== "function"
  ) {
    throw new TypeError("An import staging service is required.");
  }
  if (
    typeof resolveAuthorizationContext !== "function"
    || typeof resolvePersistenceContext !== "function"
  ) {
    throw new TypeError("Trusted authorization and persistence context resolvers are required.");
  }

  const router = express.Router();
  const contexts = async req => ({
    authorizationContext: await resolveAuthorizationContext(req),
    persistenceContext: await resolvePersistenceContext(req)
  });

  router.post("/api/import-batches/preview", route(async (req, res) => {
    const preview = await service.createPreview({
      ...(await contexts(req)),
      input: req.body
    });
    res.status(201).json({ ok: true, data: preview });
  }));

  router.get("/api/import-batches/:batchId/preview", route(async (req, res) => {
    const preview = await service.readPreview({
      ...(await contexts(req)),
      batchId: req.params.batchId
    });
    res.json({ ok: true, data: preview });
  }));

  return router;
}

function route(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (
        error instanceof ImportContractError
        || error instanceof ImportCsvError
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

module.exports = { createImportsRouter };
