const express =
  require("express");

const {
  config
} = require(
  "../config"
);

const {
  isSupabaseConfigured
} = require(
  "../integrations/supabase"
);

const {
  getAppState
} = require(
  "../core/appState"
);

const router =
  express.Router();

router.get(
  "/health",
  (req, res) => {
    const state =
      getAppState();

    res.json({
      ok: true,

      service:
        "trade-growth-engine",

      environment:
        config.nodeEnv,

      uptime:
        process.uptime(),

      timestamp:
        new Date().toISOString(),

      databaseConfigured:
        isSupabaseConfigured(),

      openAIConfigured:
        Boolean(
          process.env.OPENAI_API_KEY
        ),

      services:
        state.services
    });
  }
);

module.exports =
  router;
