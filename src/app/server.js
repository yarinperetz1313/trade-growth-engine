const express =
  require("express");

const cors =
  require("cors");

const {
  config
} = require(
  "../config"
);

const {
  setServiceStatus
} = require(
  "../core/appState"
);

const api =
  require(
    "../api"
  );

function createApp({ authRuntime = null } = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors(authRuntime?.corsOptions));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  if (authRuntime) {
    app.use("/api/auth", authRuntime.publicRouter);
    app.use(
      "/api/auth",
      authRuntime.authenticateIdentity,
      authRuntime.deriveTenantContext,
      authRuntime.protectedRouter
    );
    app.use("/api/auth", (req, res) => {
      res.status(404).json({ ok: false, error: "ROUTE_NOT_FOUND" });
    });
    app.use(
      "/api",
      authRuntime.authenticateIdentity,
      authRuntime.deriveTenantContext,
      authRuntime.requireTenantPersistence
    );
  }

  app.use(api);

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: "ROUTE_NOT_FOUND"
    });
  });

  app.use((err, req, res, next) => {
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({
        ok: false,
        error: "INVALID_JSON_BODY",
        message: "Request body must contain valid JSON."
      });
    }

    console.error(err);
    return res.status(err.status || 500).json({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
      message: "The server could not complete the request."
    });
  });

  return app;
}

const app = createApp();

function startServer({ authRuntime = null } = {}) {
  setServiceStatus(
    "ai",
    Boolean(
      process.env.OPENAI_API_KEY
    )
  );

  const serverApp = authRuntime ? createApp({ authRuntime }) : app;

  return serverApp.listen(
    config.port,
    () => {
      console.log(
        "\n=========================================="
      );

      console.log(
        "       TRADE GROWTH ENGINE API"
      );

      console.log(
        "=========================================="
      );

      console.log(
        `Environment: ${config.nodeEnv}`
      );

      console.log(
        `Port: ${config.port}`
      );

      console.log(
        `http://localhost:${config.port}`
      );

      console.log(
        "==========================================\n"
      );
    }
  );
}

module.exports = {
  app,
  createApp,
  startServer
};
