const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.join(
  process.cwd(),
  "data",
  "reports"
);

function safeFilename(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createReport({
  services,
  runMode = "unknown",
  modelVersion = "1.0.0"
}) {
  const timestamp = new Date().toISOString();

  const opportunities = Array.isArray(services)
    ? services
        .filter(Boolean)
        .map(service => ({
          service: service.name,

          scores: {
            initialOpportunity:
              service.initialScore ?? null,

            marketOpportunity:
              service.marketScore ?? null,

            economicViability:
              service.economicScore ??
              service.businessViability ??
              null,

            decisionScore:
              service.decisionScore ?? null,

            confidenceAdjustedScore:
              service.confidenceAdjustedScore ??
              null
          },

          market: {
            competitorsFound:
              service.competitorsFound ?? null,

            competitivePressure:
              service.competitivePressure ?? null,

            differentiation:
              service.differentiation ?? null,

            responseTimeGap:
              service.responseTimeGap ?? null,

            pricingTransparencyGap:
              service.pricingTransparencyGap ?? null
          },

          evidence: {
            confidenceScore:
              service.confidenceScore ?? null,

            evidenceCoverage:
              service.evidenceCoverage ?? null,

            researchStatus:
              service.researchStatus ?? null
          },

          economics: {
            classification:
              service.economicClassification ??
              null,

            riskFlags:
              Array.isArray(service.economicRiskFlags)
                ? service.economicRiskFlags
                : []
          },

          decision: {
            classification:
              service.classification ??
              null,

            recommendation:
              service.decision ??
              null,

            strengths:
              Array.isArray(service.strengths)
                ? service.strengths
                : [],

            risks:
              Array.isArray(service.risks)
                ? service.risks
                : [],

            validationPriorities:
              Array.isArray(
                service.validationPriorities
              )
                ? service.validationPriorities
                : []
          }
        }))
    : [];

  const ranked = [...opportunities]
    .filter(
      opportunity =>
        typeof opportunity.scores
          .confidenceAdjustedScore ===
        "number"
    )
    .sort(
      (a, b) =>
        b.scores.confidenceAdjustedScore -
        a.scores.confidenceAdjustedScore
    );

  return {
    reportVersion: "1.0.0",

    generatedAt: timestamp,

    model: {
      version: modelVersion,

      purpose:
        "Trade opportunity discovery and prioritisation",

      warning:
        "Scores are model outputs and do not guarantee profitability."
    },

    run: {
      mode: runMode,

      servicesEvaluated:
        opportunities.length,

      servicesWithDecisionScores:
        ranked.length
    },

    winner:
      ranked.length > 0
        ? ranked[0]
        : null,

    ranking: ranked,

    allOpportunities:
      opportunities
  };
}


function saveReport(report) {
  fs.mkdirSync(
    REPORT_DIR,
    {
      recursive: true
    }
  );

  const timestamp =
    new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

  const filename =
    `opportunity-report-${timestamp}.json`;

  const filepath =
    path.join(
      REPORT_DIR,
      filename
    );

  fs.writeFileSync(
    filepath,
    JSON.stringify(
      report,
      null,
      2
    )
  );

  return filepath;
}


function loadLatestReport() {
  if (!fs.existsSync(REPORT_DIR)) {
    return null;
  }

  const files =
    fs.readdirSync(REPORT_DIR)
      .filter(
        file =>
          file.startsWith(
            "opportunity-report-"
          ) &&
          file.endsWith(".json")
      )
      .sort()
      .reverse();

  if (files.length === 0) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          REPORT_DIR,
          files[0]
        ),
        "utf8"
      )
    );
  } catch {
    return null;
  }
}


module.exports = {
  createReport,
  saveReport,
  loadLatestReport
};
