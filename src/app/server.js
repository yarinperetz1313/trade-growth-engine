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
  createRevenueLeakCasesRouter
} = require("../api/revenueLeakCases");
const {
  createPilotEvidenceRouter
} = require("../api/pilotEvidence");
const {
  createPostgresCoreRouter
} = require("../api/postgresCore");
const {
  createImportsRouter
} = require("../api/imports");
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
const {
  createRevenueLeakCaseService
} = require("../revenueLeakCases/revenueLeakCaseService");
const {
  createImportService
} = require("../imports/importService");
const {
  createPilotEvidenceService
} = require("../pilotEvidence/pilotEvidenceService");

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
  healthRouter,
  importService,
  onUnhandledError = error => console.error(error),
  persistence,
  revenueActionService,
  resolveAuthorizationContext,
  resolveTenantContext,
  secureReadiness = null
} = {}) {
  if (persistence && revenueActionService) {
    throw new TypeError(
      "Inject either persistence or a RevenueAction service, not both."
    );
  }
  if (
    secureReadiness !== null
    && typeof secureReadiness?.isReady !== "function"
  ) {
    throw new TypeError("Secure readiness must expose isReady().");
  }
  if (typeof onUnhandledError !== "function") {
    throw new TypeError("Unhandled error reporting must be a function.");
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
    const requestAuthorizationContext = authRuntime
      ? req => req.tenantContext
      : resolveAuthorizationContext;
    const injectedImportService = importService || (
      persistence ? createImportService({ persistence }) : null
    );
    const importsRouter = (
      injectedImportService
      && typeof requestAuthorizationContext === "function"
      && typeof requestTenantContext === "function"
    ) ? createImportsRouter({
        service: injectedImportService,
        resolveAuthorizationContext: requestAuthorizationContext,
        resolvePersistenceContext: requestTenantContext
      })
      : null;
    api = createApiRouter({
      healthRouter,
      importsRouter,
      pilotEvidenceRouter: persistence?.repositories?.pilotEvidence
        ? createPilotEvidenceRouter({
          service: createPilotEvidenceService({ persistence }),
          resolveTenantContext: requestTenantContext
        })
        : null,
      postgresCoreRouter,
      revenueLeakCasesRouter: persistence?.repositories?.revenueLeakCases
        ? createRevenueLeakCasesRouter({
          service: createRevenueLeakCaseService({ persistence }),
          resolveTenantContext: requestTenantContext
        })
        : null,
      revenueActionsRouter: createRevenueActionsRouter({
        service: injectedService,
        resolveTenantContext: requestTenantContext
      })
    });
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(cors(authRuntime?.corsOptions));
  if (secureReadiness) {
    app.use((req, res, next) => {
      const publicWhileStarting = req.method === "GET" && [
        "/health",
        "/health/live",
        "/health/ready",
        "/api/auth/config"
      ].includes(req.path);
      if (publicWhileStarting || secureReadiness.isReady()) return next();
      return res.status(503).json({
        ok: false,
        error: "SECURE_RUNTIME_NOT_READY",
        message: "The secure pilot runtime is not ready."
      });
    });
  }
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
    if (err?.type === "entity.too.large") {
      return res.status(413).json({
        ok: false,
        error: "REQUEST_BODY_TOO_LARGE",
        message: "Request body exceeds the maximum allowed size."
      });
    }

    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({
        ok: false,
        error: "INVALID_JSON_BODY",
        message: "Request body must contain valid JSON."
      });
    }

    try {
      onUnhandledError(err);
    } catch {
      // Error reporting cannot replace the normalized response boundary.
    }
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
