const express =
  require("express");

const {
  readCollection
} = require("../services/localStore");

const {
  createOpportunityFromProspect,
  updateOpportunityStage,
  getPipelineMetrics
} = require(
  "../opportunities/opportunityEngine"
);

const {
  getOpportunityIntelligence
} = require(
  "../intelligence/dealIntelligence"
);

const {
  addContact,
  setValue,
  createFollowUp,
  createNextActionTask
} = require(
  "../api/intelligenceActions"
);

const router =
  express.Router();

router.get(
  "/api/opportunities",
  (req, res) => {
    const opportunities =
      readCollection(
        "opportunities"
      );

    res.json({
      ok: true,
      data: opportunities,
      count:
        opportunities.length
    });
  }
);

router.post(
  "/api/opportunities/from-prospect/:id",
  (req, res) => {
    const result =
      createOpportunityFromProspect(
        req.params.id
      );

    if (result.error) {
      return res
        .status(
          result.error ===
            "PROSPECT_NOT_FOUND"
            ? 404
            : 400
        )
        .json({
          ok: false,
          error: result.error
        });
    }

    res.status(
      result.created
        ? 201
        : 200
    ).json({
      ok: true,
      ...result
    });
  }
);

router.patch(
  "/api/opportunities/:id/stage",
  (req, res) => {
    const result =
      updateOpportunityStage(
        req.params.id,
        req.body.stage
      );

    if (result.error) {
      return res
        .status(
          result.error ===
            "OPPORTUNITY_NOT_FOUND"
            ? 404
            : 400
        )
        .json({
          ok: false,
          error: result.error
        });
    }

    res.json({
      ok: true,
      ...result
    });
  }
);

router.get(
  "/api/pipeline/metrics",
  (req, res) => {
    res.json({
      ok: true,
      data:
        getPipelineMetrics()
    });
  }
);


router.get(
  "/api/opportunities/:id/intelligence",
  (req, res) => {
    const result =
      getOpportunityIntelligence(
        req.params.id
      );

    if (result.error) {
      return res
        .status(
          result.error ===
            "OPPORTUNITY_NOT_FOUND"
            ? 404
            : 400
        )
        .json({
          ok: false,
          error: result.error
        });
    }

    res.json({
      ok: true,
      data: result
    });
  }
);


router.post(
  "/api/opportunities/:id/intelligence/contact",
  (req, res) => {
    const body =
      req.body || {};

    const result =
      addContact({
        opportunityId:
          req.params.id,
        contactName:
          body.contactName
      });

    if (!result.ok) {
      return res
        .status(
          result.error ===
            "OPPORTUNITY_NOT_FOUND"
            ? 404
            : 400
        )
        .json(result);
    }

    res.json(result);
  }
);

router.post(
  "/api/opportunities/:id/intelligence/value",
  (req, res) => {
    const body =
      req.body || {};

    const result =
      setValue({
        opportunityId:
          req.params.id,
        value:
          body.value
      });

    if (!result.ok) {
      return res
        .status(
          result.error ===
            "OPPORTUNITY_NOT_FOUND"
            ? 404
            : 400
        )
        .json(result);
    }

    res.json(result);
  }
);

router.post(
  "/api/opportunities/:id/intelligence/follow-up",
  (req, res) => {
    const body =
      req.body || {};

    const result =
      createFollowUp({
        opportunityId:
          req.params.id,
        title:
          body.title,
        priority:
          body.priority,
        actionType:
          body.actionType
      });

    if (!result.ok) {
      return res
        .status(
          result.error ===
            "OPPORTUNITY_NOT_FOUND"
            ? 404
            : 400
        )
        .json(result);
    }

    res.json(result);
  }
);

router.post(
  "/api/opportunities/:id/intelligence/task",
  (req, res) => {
    const body =
      req.body || {};

    const result =
      createNextActionTask({
        opportunityId:
          req.params.id,
        title:
          body.title,
        priority:
          body.priority,
        actionType:
          body.actionType
      });

    if (!result.ok) {
      return res
        .status(
          result.error ===
            "OPPORTUNITY_NOT_FOUND"
            ? 404
            : 400
        )
        .json(result);
    }

    res.json(result);
  }
);

router.get(
  "/api/opportunities/:id/activities",
  (req, res) => {
    const activities =
      readCollection(
        "activities"
      ).filter(
        activity =>
          activity.opportunity_id ===
          req.params.id
      );

    res.json({
      ok: true,
      data: activities,
      count:
        activities.length
    });
  }
);

module.exports =
  router;
