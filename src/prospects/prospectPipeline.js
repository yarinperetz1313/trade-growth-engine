const fs = require("fs");
const path = require("path");

const {
  qualifyProspects
} = require("./prospectQualification");

const PIPELINE_DIR = path.join(
  process.cwd(),
  "data",
  "prospects"
);

function ensureDirectory() {
  fs.mkdirSync(
    PIPELINE_DIR,
    {
      recursive: true
    }
  );
}

function buildQualifiedPipeline(
  prospects
) {
  if (
    !Array.isArray(prospects)
  ) {
    throw new Error(
      "prospects must be an array"
    );
  }

  const qualifiedResults =
    qualifyProspects(
      prospects
    );

  const highPriority =
    qualifiedResults.filter(
      prospect =>
        prospect.qualification &&
        prospect.qualification
          .qualification === "HIGH"
    );

  const mediumPriority =
    qualifiedResults.filter(
      prospect =>
        prospect.qualification &&
        prospect.qualification
          .qualification === "MEDIUM"
    );

  const excluded =
    qualifiedResults.filter(
      prospect =>
        prospect.qualification &&
        prospect.qualification
          .qualification === "EXCLUDED"
    );

  const lowPriority =
    qualifiedResults.filter(
      prospect =>
        prospect.qualification &&
        prospect.qualification
          .qualification === "LOW"
    );

  return {
    generatedAt:
      new Date().toISOString(),

    totalProspects:
      qualifiedResults.length,

    highPriority:
      highPriority.length,

    mediumPriority:
      mediumPriority.length,

    lowPriority:
      lowPriority.length,

    excluded:
      excluded.length,

    prospects:
      qualifiedResults,

    priority: {
      high:
        highPriority,

      medium:
        mediumPriority
    }
  };
}

function savePipeline(
  pipeline
) {
  ensureDirectory();

  const filePath =
    path.join(
      PIPELINE_DIR,
      `qualified-pipeline-${Date.now()}.json`
    );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      pipeline,
      null,
      2
    )
  );

  return filePath;
}

function runProspectPipeline(
  prospects
) {
  const pipeline =
    buildQualifiedPipeline(
      prospects
    );

  const filePath =
    savePipeline(
      pipeline
    );

  return {
    ...pipeline,

    filePath
  };
}

module.exports = {
  buildQualifiedPipeline,
  savePipeline,
  runProspectPipeline
};
