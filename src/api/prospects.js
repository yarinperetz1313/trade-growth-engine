const express =
  require("express");

const {
  listProspects,
  createProspect
} = require(
  "../services/prospectRepository"
);

const router =
  express.Router();

router.get(
  "/api/prospects",
  async (
    req,
    res,
    next
  ) => {
    try {
      const result =
        await listProspects({
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
  "/api/prospects",
  async (
    req,
    res,
    next
  ) => {
    try {
      const result =
        await createProspect(
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
