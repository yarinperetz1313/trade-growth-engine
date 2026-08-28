const express =
  require("express");

const {
  listLeads,
  createLead
} = require(
  "../services/leadRepository"
);

const router =
  express.Router();

router.get(
  "/api/leads",
  async (
    req,
    res,
    next
  ) => {
    try {
      const result =
        await listLeads({
          limit:
            Number(
              req.query.limit
            ) || 100,

          offset:
            Number(
              req.query.offset
            ) || 0
        });

      res.json({
        ok: true,
        ...result
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

router.post(
  "/api/leads",
  async (
    req,
    res,
    next
  ) => {
    try {
      const result =
        await createLead(
          req.body
        );

      res.status(201)
        .json({
          ok: true,
          ...result
        });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

module.exports =
  router;
