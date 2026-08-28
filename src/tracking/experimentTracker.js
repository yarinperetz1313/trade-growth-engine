const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(
  process.cwd(),
  "data",
  "results"
);

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

function safeFilename(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createExperimentRecord({
  experimentId,
  service
}) {
  if (!experimentId) {
    throw new Error(
      "experimentId is required"
    );
  }

  if (!service) {
    throw new Error(
      "service is required"
    );
  }

  return {
    experimentId,

    service,

    createdAt:
      new Date().toISOString(),

    status: "ACTIVE",

    targets: {
      prospects: 0,
      enquiries: 0,
      qualifiedEnquiries: 0,
      quotes: 0,
      jobsWon: 0,
      jobsLost: 0
    },

    financials: {
      marketingCost: 0,
      salesCost: 0,
      fulfilmentCost: 0,
      otherCost: 0,
      revenue: 0
    },

    leads: [],

    results: {
      enquiryRate: null,
      qualificationRate: null,
      quoteRate: null,
      closeRate: null,

      averageRevenuePerWonJob: null,

      totalCost: 0,
      contribution: null,

      costPerEnquiry: null,
      costPerQualifiedEnquiry: null,
      costPerQuote: null,
      customerAcquisitionCost: null,

      roi: null,

      breakEvenJobs: null
    }
  };
}

function calculateRate(
  numerator,
  denominator
) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return Math.round(
    (numerator / denominator) *
      10000
  ) / 100;
}

function calculateEconomics(record) {
  const targets = record.targets;
  const financials = record.financials;

  const totalCost =
    financials.marketingCost +
    financials.salesCost +
    financials.fulfilmentCost +
    financials.otherCost;

  const contribution =
    financials.revenue -
    totalCost;

  const averageRevenuePerWonJob =
    targets.jobsWon > 0
      ? financials.revenue /
        targets.jobsWon
      : null;

  const costPerEnquiry =
    targets.enquiries > 0
      ? totalCost /
        targets.enquiries
      : null;

  const costPerQualifiedEnquiry =
    targets.qualifiedEnquiries > 0
      ? totalCost /
        targets.qualifiedEnquiries
      : null;

  const costPerQuote =
    targets.quotes > 0
      ? totalCost /
        targets.quotes
      : null;

  const customerAcquisitionCost =
    targets.jobsWon > 0
      ? totalCost /
        targets.jobsWon
      : null;

  const roi =
    totalCost > 0
      ? contribution /
        totalCost
      : null;

  return {
    enquiryRate:
      calculateRate(
        targets.enquiries,
        targets.prospects
      ),

    qualificationRate:
      calculateRate(
        targets.qualifiedEnquiries,
        targets.enquiries
      ),

    quoteRate:
      calculateRate(
        targets.quotes,
        targets.qualifiedEnquiries
      ),

    closeRate:
      calculateRate(
        targets.jobsWon,
        targets.quotes
      ),

    averageRevenuePerWonJob,

    totalCost,

    contribution,

    costPerEnquiry,

    costPerQualifiedEnquiry,

    costPerQuote,

    customerAcquisitionCost,

    roi,

    breakEvenJobs:
      averageRevenuePerWonJob &&
      averageRevenuePerWonJob > 0
        ? Math.ceil(
            totalCost /
              averageRevenuePerWonJob
          )
        : null
  };
}

function updateResults(record) {
  record.results =
    calculateEconomics(record);

  return record;
}

function addLead(record, lead) {
  if (!lead || typeof lead !== "object") {
    throw new Error(
      "lead must be an object"
    );
  }

  const newLead = {
    id:
      lead.id ||
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    createdAt:
      new Date().toISOString(),

    name:
      lead.name || null,

    business:
      lead.business || null,

    contact:
      lead.contact || null,

    source:
      lead.source || null,

    status:
      lead.status || "PROSPECT",

    notes:
      lead.notes || null
  };

  record.leads.push(newLead);

  return newLead;
}

function updateTargets(
  record,
  updates = {}
) {
  const allowedFields = [
    "prospects",
    "enquiries",
    "qualifiedEnquiries",
    "quotes",
    "jobsWon",
    "jobsLost"
  ];

  for (const field of allowedFields) {
    if (
      updates[field] !== undefined
    ) {
      const value =
        Number(updates[field]);

      if (
        !Number.isFinite(value) ||
        value < 0
      ) {
        throw new Error(
          `${field} must be a non-negative number`
        );
      }

      record.targets[field] =
        value;
    }
  }

  updateResults(record);

  return record;
}

function updateFinancials(
  record,
  updates = {}
) {
  const allowedFields = [
    "marketingCost",
    "salesCost",
    "fulfilmentCost",
    "otherCost",
    "revenue"
  ];

  for (const field of allowedFields) {
    if (
      updates[field] !== undefined
    ) {
      const value =
        Number(updates[field]);

      if (
        !Number.isFinite(value) ||
        value < 0
      ) {
        throw new Error(
          `${field} must be a non-negative number`
        );
      }

      record.financials[field] =
        value;
    }
  }

  updateResults(record);

  return record;
}

function saveExperimentRecord(
  record
) {
  ensureDataDir();

  if (
    !record ||
    !record.experimentId
  ) {
    throw new Error(
      "Valid experiment record required"
    );
  }

  updateResults(record);

  const filename =
    `${safeFilename(
      record.service
    )}-${safeFilename(
      record.experimentId
    )}.json`;

  const filePath =
    path.join(
      DATA_DIR,
      filename
    );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      record,
      null,
      2
    )
  );

  return filePath;
}

function loadExperimentRecord(
  filePath
) {
  if (
    !fs.existsSync(filePath)
  ) {
    throw new Error(
      `Experiment record not found: ${filePath}`
    );
  }

  const record =
    JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );

  updateResults(record);

  return record;
}

function evaluateExperiment(
  record
) {
  updateResults(record);

  const {
    jobsWon,
    quotes,
    qualifiedEnquiries,
    enquiries
  } = record.targets;

  const {
    totalCost,
    contribution,
    roi
  } = record.results;

  const signals = [];

  if (
    jobsWon > 0 &&
    contribution > 0
  ) {
    signals.push(
      "POSITIVE_UNIT_ECONOMICS"
    );
  }

  if (
    jobsWon > 0 &&
    roi !== null &&
    roi >= 1
  ) {
    signals.push(
      "STRONG_RETURN"
    );
  }

  if (
    quotes > 0 &&
    jobsWon === 0
  ) {
    signals.push(
      "QUOTES_WITHOUT_CLOSED_JOBS"
    );
  }

  if (
    qualifiedEnquiries > 0 &&
    quotes === 0
  ) {
    signals.push(
      "QUALIFIED_LEADS_WITHOUT_QUOTES"
    );
  }

  if (
    enquiries > 0 &&
    qualifiedEnquiries === 0
  ) {
    signals.push(
      "QUALIFICATION_PROBLEM"
    );
  }

  if (
    totalCost > 0 &&
    contribution < 0
  ) {
    signals.push(
      "NEGATIVE_CONTRIBUTION"
    );
  }

  let recommendation =
    "CONTINUE_TESTING";

  if (
    jobsWon >= 2 &&
    contribution > 0 &&
    roi !== null &&
    roi >= 1
  ) {
    recommendation =
      "SCALE_CANDIDATE";
  } else if (
    totalCost > 0 &&
    contribution < 0 &&
    enquiries === 0
  ) {
    recommendation =
      "STOP_OR_REDESIGN";
  }

  return {
    recommendation,

    signals,

    economics:
      record.results,

    sampleSize: {
      prospects:
        record.targets.prospects,

      enquiries:
        record.targets.enquiries,

      qualifiedEnquiries:
        record.targets
          .qualifiedEnquiries,

      quotes:
        record.targets.quotes,

      jobsWon:
        record.targets.jobsWon
    }
  };
}

module.exports = {
  createExperimentRecord,
  addLead,
  updateTargets,
  updateFinancials,
  updateResults,
  calculateEconomics,
  saveExperimentRecord,
  loadExperimentRecord,
  evaluateExperiment
};
