const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LEADS_DIR = path.join(
  process.cwd(),
  "data",
  "leads"
);

const VALID_STATUSES = [
  "DISCOVERED",
  "QUALIFIED",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "QUOTE",
  "WON",
  "LOST"
];

function ensureDirectory() {
  fs.mkdirSync(
    LEADS_DIR,
    {
      recursive: true
    }
  );
}

function createLead(prospect) {
  if (
    !prospect ||
    !prospect.businessName
  ) {
    throw new Error(
      "A prospect with a businessName is required."
    );
  }

  const qualification =
    prospect.qualification || {};

  return {
    id:
      `lead-${Date.now()}-${crypto
        .randomBytes(3)
        .toString("hex")}`,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString(),

    status:
      qualification.qualified
        ? "QUALIFIED"
        : "DISCOVERED",

    businessName:
      prospect.businessName,

    website:
      prospect.website || null,

    location:
      prospect.location || null,

    phone:
      prospect.phone || null,

    email:
      prospect.email || null,

    industry:
      prospect.industry || null,

    service:
      prospect.service || null,

    qualificationScore:
      qualification.qualificationScore ??
      null,

    qualification:
      qualification.qualification ??
      null,

    qualificationDetails:
      qualification.scores ||
      null,

    evidence:
      Array.isArray(
        prospect.evidence
      )
        ? prospect.evidence
        : [],

    sourceUrl:
      prospect.sourceUrl ||
      null,

    notes:
      prospect.notes ||
      null,

    outreach: {
      attempts: 0,

      lastContactedAt:
        null,

      lastChannel:
        null,

      messages: []
    },

    sales: {
      quoteValue:
        null,

      quoteSentAt:
        null,

      wonAt:
        null,

      lostAt:
        null,

      lossReason:
        null
    },

    economics: {
      acquisitionCost:
        0,

      revenue:
        0,

      grossProfit:
        null
    }
  };
}

function validateStatus(status) {
  if (
    !VALID_STATUSES.includes(
      status
    )
  ) {
    throw new Error(
      `Invalid lead status: ${status}`
    );
  }
}

function saveLead(lead) {
  ensureDirectory();

  lead.updatedAt =
    new Date().toISOString();

  const filePath =
    path.join(
      LEADS_DIR,
      `${lead.id}.json`
    );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      lead,
      null,
      2
    )
  );

  return filePath;
}

function loadLead(id) {
  ensureDirectory();

  const filePath =
    path.join(
      LEADS_DIR,
      `${id}.json`
    );

  if (
    !fs.existsSync(
      filePath
    )
  ) {
    throw new Error(
      `Lead not found: ${id}`
    );
  }

  return JSON.parse(
    fs.readFileSync(
      filePath,
      "utf8"
    )
  );
}

function updateLeadStatus(
  id,
  status
) {
  validateStatus(status);

  const lead =
    loadLead(id);

  lead.status =
    status;

  const now =
    new Date().toISOString();

  if (
    status === "WON"
  ) {
    lead.sales.wonAt =
      now;
  }

  if (
    status === "LOST"
  ) {
    lead.sales.lostAt =
      now;
  }

  return saveLead(
    lead
  );
}

function recordOutreach({
  id,
  channel,
  message
}) {
  if (!channel) {
    throw new Error(
      "channel is required"
    );
  }

  if (!message) {
    throw new Error(
      "message is required"
    );
  }

  const lead =
    loadLead(id);

  const now =
    new Date().toISOString();

  lead.outreach.attempts += 1;

  lead.outreach.lastContactedAt =
    now;

  lead.outreach.lastChannel =
    channel;

  lead.outreach.messages.push({
    timestamp:
      now,

    channel,

    message
  });

  if (
    lead.status ===
    "DISCOVERED" ||
    lead.status ===
    "QUALIFIED"
  ) {
    lead.status =
      "CONTACTED";
  }

  return saveLead(
    lead
  );
}

function recordReply({
  id,
  message
}) {
  if (!message) {
    throw new Error(
      "message is required"
    );
  }

  const lead =
    loadLead(id);

  const now =
    new Date().toISOString();

  lead.outreach.messages.push({
    timestamp:
      now,

    channel:
      "INBOUND",

    message
  });

  lead.status =
    "REPLIED";

  return saveLead(
    lead
  );
}

function recordQuote({
  id,
  value
}) {
  if (
    typeof value !==
    "number" ||
    value < 0
  ) {
    throw new Error(
      "quote value must be a non-negative number"
    );
  }

  const lead =
    loadLead(id);

  const now =
    new Date().toISOString();

  lead.sales.quoteValue =
    value;

  lead.sales.quoteSentAt =
    now;

  lead.status =
    "QUOTE";

  return saveLead(
    lead
  );
}

function recordOutcome({
  id,
  won,
  revenue = 0,
  acquisitionCost = 0,
  lossReason = null
}) {
  if (
    typeof revenue !==
      "number" ||
    revenue < 0
  ) {
    throw new Error(
      "revenue must be a non-negative number"
    );
  }

  if (
    typeof acquisitionCost !==
      "number" ||
    acquisitionCost < 0
  ) {
    throw new Error(
      "acquisitionCost must be a non-negative number"
    );
  }

  const lead =
    loadLead(id);

  const now =
    new Date().toISOString();

  lead.economics.revenue =
    revenue;

  lead.economics.acquisitionCost =
    acquisitionCost;

  lead.economics.grossProfit =
    revenue -
    acquisitionCost;

  if (won) {
    lead.status =
      "WON";

    lead.sales.wonAt =
      now;
  } else {
    lead.status =
      "LOST";

    lead.sales.lostAt =
      now;

    lead.sales.lossReason =
      lossReason;
  }

  return saveLead(
    lead
  );
}

function listLeads() {
  ensureDirectory();

  return fs
    .readdirSync(
      LEADS_DIR
    )
    .filter(
      file =>
        file.endsWith(
          ".json"
        )
    )
    .map(
      file =>
        JSON.parse(
          fs.readFileSync(
            path.join(
              LEADS_DIR,
              file
            ),
            "utf8"
          )
        )
    );
}

module.exports = {
  VALID_STATUSES,
  createLead,
  saveLead,
  loadLead,
  updateLeadStatus,
  recordOutreach,
  recordReply,
  recordQuote,
  recordOutcome,
  listLeads
};
