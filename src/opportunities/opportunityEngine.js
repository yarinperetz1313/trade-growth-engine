const {
  createRecord,
  readCollection,
  findRecord,
  updateRecord
} = require("../services/localStore");
const {
  summarizeOpportunityAmounts
} = require("./monetarySummary");

const STAGES = [
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "REPLIED",
  "MEETING",
  "PROPOSAL",
  "WON",
  "LOST"
];

const DEFAULT_PROBABILITIES = {
  NEW: 0.10,
  QUALIFIED: 0.20,
  CONTACTED: 0.25,
  REPLIED: 0.40,
  MEETING: 0.60,
  PROPOSAL: 0.75,
  WON: 1.00,
  LOST: 0.00
};

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function probabilityForStage(stage) {
  return (
    DEFAULT_PROBABILITIES[stage] ??
    DEFAULT_PROBABILITIES.NEW
  );
}

function calculateWeightedValue(
  value,
  probability
) {
  return Math.round(
    Number(value || 0) *
      Number(probability || 0)
  );
}

function createOpportunityFromProspect(
  prospectId
) {
  const prospect = findRecord(
    "prospects",
    prospectId
  );

  if (!prospect) {
    return {
      error: "PROSPECT_NOT_FOUND"
    };
  }

  const existing =
    readCollection(
      "opportunities"
    ).find(
      opportunity =>
        opportunity.prospect_id ===
        prospectId &&
        opportunity.stage !== "LOST"
    );

  if (existing) {
    return {
      data: existing,
      created: false
    };
  }

  const qualification =
    prospect.qualification || {};

  const score = Number(
    qualification.score ??
      prospect.qualification_score ??
      0
  );

  const priority =
    qualification.priority ??
    prospect.qualification_status ??
    "LOW";

  const stage =
    score >= 70
      ? "QUALIFIED"
      : "NEW";

  const value = Number(
    prospect.value_estimate ??
      prospect.estimated_value ??
      prospect.opportunity_value ??
      0
  );

  const probability =
    probabilityForStage(
      stage
    );

  const opportunity =
    createRecord(
      "opportunities",
      {
        prospect_id:
          prospect.id,

        business_name:
          prospect.business_name,

        stage,

        priority,

        qualification_score:
          score,

        value,

        probability,

        weighted_value:
          calculateWeightedValue(
            value,
            probability
          ),

        next_action:
          stage === "QUALIFIED"
            ? "Begin qualified outreach"
            : "Research and qualify prospect"
      }
    );

  createRecord(
    "activities",
    {
      prospect_id:
        prospect.id,

      opportunity_id:
        opportunity.id,

      type:
        "OPPORTUNITY_CREATED",

      description:
        `Opportunity created from prospect qualification`,

      metadata: {
        score,
        priority,
        stage
      }
    }
  );

  return {
    data: opportunity,
    created: true
  };
}

function updateOpportunityStage(
  opportunityId,
  stage
) {
  if (!STAGES.includes(stage)) {
    return {
      error:
        "INVALID_OPPORTUNITY_STAGE"
    };
  }

  const opportunity =
    findRecord(
      "opportunities",
      opportunityId
    );

  if (!opportunity) {
    return {
      error:
        "OPPORTUNITY_NOT_FOUND"
    };
  }

  const probability =
    probabilityForStage(
      stage
    );

  const updated =
    updateRecord(
      "opportunities",
      opportunityId,
      {
        stage,

        probability,

        weighted_value:
          calculateWeightedValue(
            opportunity.value,
            probability
          ),

        next_action:
          nextActionForStage(
            stage
          )
      }
    );

  createRecord(
    "activities",
    {
      prospect_id:
        opportunity.prospect_id,

      opportunity_id:
        opportunity.id,

      type:
        "STAGE_CHANGED",

      description:
        `Opportunity moved to ${stage}`,

      metadata: {
        stage,
        probability
      }
    }
  );

  return {
    data: updated
  };
}

function nextActionForStage(
  stage
) {
  const actions = {
    NEW:
      "Research and qualify prospect",

    QUALIFIED:
      "Begin qualified outreach",

    CONTACTED:
      "Monitor for response",

    REPLIED:
      "Continue conversation",

    MEETING:
      "Prepare for meeting",

    PROPOSAL:
      "Follow up on proposal",

    WON:
      "Begin client onboarding",

    LOST:
      "Record loss reason"
  };

  return (
    actions[stage] ||
    "Review opportunity"
  );
}

function buildPipelineMetrics(
  opportunities = []
) {
  const active =
    opportunities.filter(
      opportunity =>
        opportunity.stage !==
          "WON" &&
        opportunity.stage !==
          "LOST"
    );

  const pipelineValue = summarizeOpportunityAmounts(
    active,
    opportunity => opportunity?.value
  );
  const weightedPipelineValue = summarizeOpportunityAmounts(
    active,
    opportunity => opportunity?.weighted_value
  );

  const won =
    opportunities.filter(
      opportunity =>
        opportunity.stage ===
        "WON"
    );

  const wonValue = summarizeOpportunityAmounts(
    won,
    opportunity => opportunity?.value
  );

  const byStage = {};

  for (const stage of STAGES) {
    const stageItems =
      opportunities.filter(
        opportunity =>
          opportunity.stage ===
          stage
      );

    const value = summarizeOpportunityAmounts(
      stageItems,
      opportunity => opportunity?.value
    );
    const weightedValue = summarizeOpportunityAmounts(
      stageItems,
      opportunity => opportunity?.weighted_value
    );

    byStage[stage] = {
      count:
        stageItems.length,
      value: value.known_total,
      value_summary: value,
      weighted_value: weightedValue.known_total,
      weighted_value_summary: weightedValue
    };
  }

  return {
    total:
      opportunities.length,

    active:
      active.length,

    pipeline_value:
      pipelineValue.known_total,

    pipeline_value_summary:
      pipelineValue,

    weighted_pipeline_value:
      weightedPipelineValue.known_total,

    weighted_pipeline_value_summary:
      weightedPipelineValue,

    won_value:
      wonValue.known_total,

    won_value_summary:
      wonValue,

    by_stage:
      byStage
  };
}

function getPipelineMetrics() {
  return buildPipelineMetrics(
    readCollection(
      "opportunities"
    )
  );
}

module.exports = {
  STAGES,
  DEFAULT_PROBABILITIES,
  buildPipelineMetrics,
  createOpportunityFromProspect,
  updateOpportunityStage,
  getPipelineMetrics
};
