const {
  listLeads,
  updateLeadStatus,
  recordOutreach,
  recordReply,
  recordQuote,
  recordOutcome
} = require("../leads/leadEngine");

const {
  createOutreachPlan
} = require("./outreachEngine");

const {
  classifyReply,
  shouldStopSequence
} = require("./replyClassifier");

function createSalesPlan(
  lead
) {
  return {
    leadId:
      lead.id || null,

    businessName:
      lead.businessName ||
      lead.companyName ||
      null,

    outreach:
      createOutreachPlan({
        lead
      }),

    createdAt:
      new Date().toISOString()
  };
}

function handleReply({
  leadId,
  replyText
}) {
  const classification =
    classifyReply(
      replyText
    );

  try {
    recordReply(
      leadId,
      {
        text: replyText,
        classification
      }
    );
  } catch {
    /*
     * Keep classification usable
     * even if persistence fails.
     */
  }

  if (
    classification.type ===
    "INTERESTED"
  ) {
    try {
      updateLeadStatus(
        leadId,
        "INTERESTED"
      );
    } catch {}
  }

  if (
    classification.type ===
    "NOT_INTERESTED"
  ) {
    try {
      updateLeadStatus(
        leadId,
        "LOST"
      );
    } catch {}
  }

  return {
    classification,

    stopSequence:
      shouldStopSequence(
        classification
      )
  };
}

function getSalesOverview() {
  const leads =
    listLeads();

  const list =
    Array.isArray(leads)
      ? leads
      : [];

  return {
    generatedAt:
      new Date().toISOString(),

    totalLeads:
      list.length,

    statuses:
      list.reduce(
        (
          counts,
          lead
        ) => {
          const status =
            lead.status ||
            "UNKNOWN";

          counts[status] =
            (counts[status] || 0) +
            1;

          return counts;
        },
        {}
      )
  };
}

module.exports = {
  createSalesPlan,
  handleReply,
  getSalesOverview
};
