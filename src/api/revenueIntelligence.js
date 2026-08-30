const express = require("express");

const {
  getRevenueIntelligenceSnapshot
} = require("../intelligence/revenueIntelligenceSnapshot");

const router = express.Router();

router.get(
  "/api/intelligence/revenue",
  (req, res) => {
    try {
      res.json({
        ok: true,
        data: getRevenueIntelligenceSnapshot()
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
