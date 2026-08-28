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

const router =
  express.Router();

router.use(
  health
);

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

module.exports =
  router;
