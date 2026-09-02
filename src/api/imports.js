const express = require("express");

const { AuthorizationError } = require("../auth/authorization");
const { ImportCsvError } = require("../imports/csvParser");
const { ImportCommitError } = require("../imports/importCommit");
const { ImportContractError } = require("../imports/importService");
const { ImportMappingError } = require("../imports/importMapping");
const {
  PostgresTransactionOutcomeUnknownError
} = require("../persistence/postgres/transaction");

function createImportsRouter({
  service,
  resolveAuthorizationContext,
  resolvePersistenceContext
} = {}) {
  if (
    !service
    || typeof service.createPreview !== "function"
    || typeof service.readPreview !== "function"
    || typeof service.analyzePreview !== "function"
    || typeof service.commitBatch !== "function"
    || typeof service.readCommit !== "function"
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

  router.post("/api/import-batches/:batchId/analysis", route(async (req, res) => {
    const analysis = await service.analyzePreview({
      ...(await contexts(req)),
      batchId: req.params.batchId,
      input: req.body || {}
    });
    res.json({ ok: true, data: analysis });
  }));

  router.post("/api/import-batches/:batchId/commit", route(async (req, res) => {
    const committed = await service.commitBatch({
      ...(await contexts(req)),
      batchId: req.params.batchId,
      input: req.body
    });
    res.json({ ok: true, data: committed });
  }));

  router.get("/api/import-batches/:batchId/commit", route(async (req, res) => {
    const committed = await service.readCommit({
      ...(await contexts(req)),
      batchId: req.params.batchId
    });
    res.json({ ok: true, data: committed });
  }));

  return router;
}

function route(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (
        error instanceof PostgresTransactionOutcomeUnknownError
        && typeof error.attemptedId === "string"
        && error.attemptedId.length > 0
      ) {
        return res.status(500).json({
          ok: false,
          error: "POSTGRES_TRANSACTION_OUTCOME_UNKNOWN",
          message: "PostgreSQL did not confirm the transaction outcome; reconcile the attempted result before retrying.",
          details: { attemptedId: error.attemptedId }
        });
      }
      if (
        error instanceof ImportContractError
        || error instanceof ImportCommitError
        || error instanceof ImportCsvError
        || error instanceof ImportMappingError
        || error instanceof AuthorizationError
      ) {
        return res.status(error.status || 400).json({
          ok: false,
          error: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        });
      }
      return next(error);
    }
  };
}

module.exports = { createImportsRouter };
