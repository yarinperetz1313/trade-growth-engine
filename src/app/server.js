const express = require("express");
const cors = require("cors");

const { config } = require("../config");
const { setServiceStatus } = require("../core/appState");
const defaultApi = require("../api");
const { createApiRouter } = require("../api");
const {
  createRevenueActionsRouter
} = require("../api/revenueActions");
const {
  createPostgresCoreRouter
} = require("../api/postgresCore");
const {
  assertTrustedTenantContext
} = require("../auth/authorization");
const {
  createPostgresCoreService
} = require("../persistence/postgres/coreService");
const {
  createTenantContext: createPersistenceTenantContext
} = require("../persistence/tenantContext");
const {
  createPostgresRevenueActionService
} = require("../revenueActions/postgresRevenueActionService");

function bridgeAuthTenantContext(authTenantContext) {
  const trustedAuthContext = assertTrustedTenantContext(authTenantContext);
  return createPersistenceTenantContext({
    tenantId: trustedAuthContext.tenantId,
    subjectId: trustedAuthContext.subject
  });
}

function sendTenantPersistenceUnavailable(res) {
  return res.status(503).json({
    ok: false,
    error: "TENANT_PERSISTENCE_UNAVAILABLE",
    message: "Tenant-scoped persistence is unavailable."
  });
}

function createApp({
  authRuntime = null,
  persistence,
  revenueActionService,
  resolveTenantContext
} = {}) {
  if (persistence && revenueActionService) {
    throw new TypeError(
      "Inject either persistence or a RevenueAction service, not both."
    );
  }

  const authPersistenceAvailable = Boolean(
    authRuntime
    && persistence?.adapter === "postgres"
    && typeof persistence.forTenant === "function"
  );
  let requestTenantContext = resolveTenantContext;
  if (authRuntime && authPersistenceAvailable) {
    requestTenantContext = req => req.persistenceTenantContext;
  }

  let api = defaultApi;
  let injectedService;
  if (!authRuntime || authPersistenceAvailable) {
    injectedService = persistence
      ? createPostgresRevenueActionService({ persistence })
      : revenueActionService;
  }
  if (injectedService) {
    const postgresCoreRouter = persistence
      ? createPostgresCoreRouter({
        service: createPostgresCoreService({ persistence }),
        resolveTenantContext: requestTenantContext
      })
      : null;
    api = createApiRouter({
      postgresCoreRouter,
      revenueActionsRouter: createRevenueActionsRouter({
        service: injectedService,
        resolveTenantContext: requestTenantContext
      })
    });
  }

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
      (req, res, next) => {
        if (!authPersistenceAvailable) {
          return sendTenantPersistenceUnavailable(res);
        }
        try {
          req.persistenceTenantContext = bridgeAuthTenantContext(
            req.tenantContext
          );
          return next();
        } catch {
          return sendTenantPersistenceUnavailable(res);
        }
      }
    );
  }

  app.use(api);

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "ROUTE_NOT_FOUND" });
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

function startServer(options = {}) {
  setServiceStatus("ai", Boolean(process.env.OPENAI_API_KEY));

  const serverApp = Object.keys(options).length > 0 ? createApp(options) : app;
  return serverApp.listen(config.port, () => {
    console.log("\n==========================================");
    console.log("       TRADE GROWTH ENGINE API");
    console.log("==========================================");
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Port: ${config.port}`);
    console.log(`http://localhost:${config.port}`);
    console.log("==========================================\n");
  });
}

module.exports = {
  app,
  bridgeAuthTenantContext,
  createApp,
  startServer
};
