const express = require("express");

const {
  isPlainObject,
  listRevenueActions,
  getRevenueAction,
  materializeRevenueAction,
  prepareRevenueAction,
  approveRevenueAction,
  rejectRevenueAction,
  cancelRevenueAction,
  executeRevenueAction
} = require("../revenueActions/revenueActionService");

const router = express.Router();

function sendResult(res, result, successStatus = 200) {
  if (result.ok === false) {
    const { statusCode, ...body } = result;
    return res.status(statusCode || 400).json(body);
  }
  return res.status(successStatus).json(result);
}

function validateBody(req, res) {
  if (req.body === undefined) return {};
  if (!isPlainObject(req.body)) {
    res.status(400).json({ ok: false, error: "INVALID_REQUEST_BODY", message: "Request body must be a JSON object.", details: { field: "body" } });
    return null;
  }
  return req.body;
}

function route(handler) {
  return (req, res) => {
    try {
      return handler(req, res);
    } catch {
      return res.status(500).json({
        ok: false,
        error: "REVENUE_ACTION_PERSISTENCE_UNAVAILABLE",
        message: "Revenue action persistence is temporarily unavailable."
      });
    }
  };
}

router.get("/api/revenue-actions", route((req, res) => {
  const data = listRevenueActions({ opportunityId: typeof req.query.opportunity_id === "string" ? req.query.opportunity_id : undefined });
  res.json({ ok: true, data, count: data.length });
}));

router.get("/api/revenue-actions/:id", route((req, res) => {
  const result = getRevenueAction(req.params.id);
  return result.ok === false ? sendResult(res, result) : res.json({ ok: true, data: result });
}));

router.post("/api/opportunities/:id/revenue-actions", route((req, res) => {
  if (validateBody(req, res) === null) return;
  const result = materializeRevenueAction(req.params.id);
  return sendResult(res, result, result.created ? 201 : 200);
}));

router.post("/api/revenue-actions/:id/prepare", route((req, res) => {
  if (validateBody(req, res) === null) return;
  return sendResult(res, prepareRevenueAction(req.params.id));
}));

router.post("/api/revenue-actions/:id/approve", route((req, res) => {
  if (validateBody(req, res) === null) return;
  return sendResult(res, approveRevenueAction(req.params.id));
}));

router.post("/api/revenue-actions/:id/reject", route((req, res) => {
  const body = validateBody(req, res);
  if (body === null) return;
  if (body.reason !== undefined && typeof body.reason !== "string") {
    return res.status(400).json({ ok: false, error: "INVALID_REQUEST_BODY", message: "Rejection reason must be a string when provided.", details: { field: "reason" } });
  }
  return sendResult(res, rejectRevenueAction(req.params.id, body.reason));
}));

router.post("/api/revenue-actions/:id/cancel", route((req, res) => {
  if (validateBody(req, res) === null) return;
  return sendResult(res, cancelRevenueAction(req.params.id));
}));

router.post("/api/revenue-actions/:id/execute", route((req, res) => {
  const body = validateBody(req, res);
  if (body === null) return;
  return sendResult(res, executeRevenueAction(req.params.id, body));
}));

module.exports = router;
