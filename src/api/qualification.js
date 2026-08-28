const express =
  require("express");

const {
  qualifyProspect
} = require(
  "../intelligence/qualificationEngine"
);

const {
  findRecord,
  updateRecord
} = require(
  "../services/localStore"
);

const router =
  express.Router();

router.post(
  "/api/prospects/:id/qualify",
  async (
    req,
    res,
    next
  ) => {
    try {
      const prospect =
        findRecord(
          "prospects",
          req.params.id
        );

      if (!prospect) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "PROSPECT_NOT_FOUND"
          });
      }

      const result =
        qualifyProspect(
          prospect
        );

      const updated =
        updateRecord(
          "prospects",
          prospect.id,
          {
            qualification_score:
              result.score,

            qualification_status:
              result.priority,

            qualification:
              result
          }
        );

      res.json({
        ok: true,
        data: updated
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

router.post(
  "/api/qualification/preview",
  (
    req,
    res,
    next
  ) => {
    try {
      const result =
        qualifyProspect(
          req.body
        );

      res.json({
        ok: true,
        data: result
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
