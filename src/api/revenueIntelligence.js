const express = require("express");

const {
  readCollectionReadOnly
} = require("../services/localStore");
const {
  buildDealIntelligenceFromData
} = require("../intelligence/dealIntelligence");
const {
  buildRevenueIntelligence
} = require("../intelligence/revenueIntelligence");

const router = express.Router();

router.get(
  "/api/intelligence/revenue",
  (req, res) => {
    try {
      const generatedAt = new Date().toISOString();
      const prospects =
        readCollectionReadOnly("prospects");
      const opportunities =
        readCollectionReadOnly("opportunities");
      const activities =
        readCollectionReadOnly("activities");
      const tasks =
        readCollectionReadOnly("tasks");
      const intelligences = opportunities.map(
        opportunity =>
          buildDealIntelligenceFromData(
            opportunity,
            {
              prospects,
              activities,
              tasks,
              generatedAt
            }
          )
      );

      res.json({
        ok: true,
        data: buildRevenueIntelligence({
          opportunities,
          intelligences,
          generatedAt
        })
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: "REVENUE_INTELLIGENCE_UNAVAILABLE",
        details: {
          message: error.message
        }
      });
    }
  }
);

module.exports = router;
