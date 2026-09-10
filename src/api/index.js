const express =
  require("express");

const health =
  require(
    "./health"
  );

const prospects =
  require(
    "./prospects"
  );

const leads =
  require(
    "./leads"
  );

const qualification =
  require(
    "./qualification"
  );

const opportunities =
  require(
    "./opportunities"
  );


const tasks =
  require(
    "./tasks"
  );

const revenueIntelligence =
  require(
    "./revenueIntelligence"
  );

const revenueActions =
  require(
    "./revenueActions"
  );

const revenueLeakCases =
  require(
    "./revenueLeakCases"
  );

const pilotEvidence =
  require(
    "./pilotEvidence"
  );

function createApiRouter({
  healthRouter = health,
  importsRouter = null,
  pilotEvidenceRouter = pilotEvidence,
  revenueLeakCasesRouter = revenueLeakCases,
  revenueActionsRouter = revenueActions,
  tenantOffboardingRouter = null,
  postgresCoreRouter = null
} = {}) {
  const router =
    express.Router();

router.use(
  healthRouter
);

if (postgresCoreRouter) {
  router.use(
    postgresCoreRouter
  );
} else {
  router.use(
    prospects
  );

  router.use(
    leads
  );

  router.use(
    qualification
  );

  router.use(
    opportunities
  );

  router.use(
    tasks
  );

  router.use(
    revenueIntelligence
  );
}

if (importsRouter) {
  router.use(
    importsRouter
  );
}

router.use(
  revenueActionsRouter
);

if (revenueLeakCasesRouter) {
  router.use(
    revenueLeakCasesRouter
  );
}

if (pilotEvidenceRouter) {
  router.use(
    pilotEvidenceRouter
  );
}

if (tenantOffboardingRouter) {
  router.use(
    tenantOffboardingRouter
  );
}

  router.get(
  "/api",
  (req, res) => {
    res.json({
      name:
        "Trade Growth Engine",

      version:
        "1.0.0",

      status:
        "operational",

      endpoints: {
        health:
          "/health",

        prospects:
          "/api/prospects",

        leads:
          "/api/leads"
      }
    });
  }
  );

  return router;
}

const router = createApiRouter();

module.exports =
  router;

module.exports.createApiRouter =
  createApiRouter;
