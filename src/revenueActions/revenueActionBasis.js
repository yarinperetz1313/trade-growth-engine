const crypto = require("node:crypto");

const EXECUTION_TYPES = Object.freeze({
  FOLLOW_UP: "COMMUNICATION_DRAFT",
  CREATE_TASK: "INTERNAL_TASK",
  RESEARCH: "INTERNAL_TASK",
  QUALIFY: "INTERNAL_TASK",
  ADVANCE: "INTERNAL_TASK"
});

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function factualEvidence(state) {
  const opportunity = state.opportunity;
  const intelligence = state.intelligence;
  const resolved = intelligence.resolved || {};
  const value = Number(opportunity.value);
  const valueKnown = Number.isFinite(value) && value > 0;

  return {
    factual: {
      stage: opportunity.stage || null,
      recorded_next_action: normalizeText(opportunity.next_action) || null,
      commercial_value: {
        known: valueKnown,
        amount: valueKnown ? value : null
      },
      business_name: resolved.business_name || null,
      contact_name: resolved.contact_name || null,
      service: resolved.service || null,
      location: resolved.location || null,
      latest_activity: intelligence.activity?.latest
        ? {
            id: intelligence.activity.latest.id || null,
            type: intelligence.activity.latest.type || null,
            created_at: intelligence.activity.latest.created_at || null
          }
        : null,
      tasks: {
        count: intelligence.tasks?.count || 0,
        open_count: intelligence.tasks?.open || 0,
        latest: intelligence.tasks?.latest
          ? {
              id: intelligence.tasks.latest.id || null,
              title: intelligence.tasks.latest.title || null,
              status: intelligence.tasks.latest.status || null,
              created_at: intelligence.tasks.latest.created_at || null
            }
          : null
      }
    },
    derived: {
      health_status: intelligence.health?.status || null,
      risk_types: (intelligence.health?.risks || [])
        .map(risk => risk.type)
        .filter(Boolean),
      stale_risk: intelligence.score?.stale_risk ?? null,
      days_since_latest_activity:
        intelligence.activity?.days_since_latest ?? null,
      known: clone(intelligence.evidence?.known || []),
      unknown: clone(intelligence.evidence?.unknown || [])
    }
  };
}

function recommendationBasis(state, recommendation, evidence) {
  return {
    opportunity_id: state.opportunity.id,
    action_type: recommendation?.type || null,
    priority: recommendation?.priority || null,
    title: recommendation?.title || null,
    reason: recommendation?.reason || null,
    task_title: recommendation?.taskTitle || null,
    stage: evidence.factual.stage,
    recorded_next_action: evidence.factual.recorded_next_action,
    commercial_value: evidence.factual.commercial_value,
    business_name: evidence.factual.business_name,
    contact_name: evidence.factual.contact_name,
    service: evidence.factual.service,
    location: evidence.factual.location,
    latest_activity: evidence.factual.latest_activity
  };
}

function calculateRevenueActionBasis(state) {
  const recommendation = state.intelligence.next_best_action;
  const evidence = factualEvidence(state);
  return {
    recommendation,
    evidence,
    basisFingerprint: fingerprint(
      recommendationBasis(state, recommendation, evidence)
    )
  };
}

function expectedRevenueActionSemantics(actionType) {
  const executionType = EXECUTION_TYPES[actionType];
  if (!executionType) return null;
  return {
    executionType,
    approvalRequirement: "HUMAN",
    riskClass: executionType === "COMMUNICATION_DRAFT"
      ? "EXTERNAL_CONSEQUENTIAL"
      : "INTERNAL",
    source: "DEAL_INTELLIGENCE"
  };
}

function buildProposedExecution(action) {
  const expected = expectedRevenueActionSemantics(action.action_type);
  if (!expected || action.execution_type !== expected.executionType) return null;

  if (expected.executionType === "COMMUNICATION_DRAFT") {
    const facts = action.evidence.factual;
    const business = facts.business_name;
    const contact = facts.contact_name;
    const service = facts.service;
    const stage = facts.stage;
    const subject = stage === "PROPOSAL"
      ? `Following up${business ? ` on the ${business} proposal` : " on the proposal"}`
      : `Following up${business ? ` on ${business}` : " on the opportunity"}`;
    const greeting = contact ? `Hi ${contact},` : "Hello,";
    const context = service
      ? `the ${service} opportunity${business ? ` for ${business}` : ""}`
      : `the opportunity${business ? ` for ${business}` : ""}`;

    return {
      type: "COMMUNICATION_DRAFT",
      channel: "EMAIL",
      subject,
      body: [
        greeting,
        "",
        `I’m following up regarding ${context}.`,
        "Please let me know if you have any questions or if anything is needed to progress the next step.",
        "",
        "Kind regards"
      ].join("\n"),
      external_send_performed: false
    };
  }

  const title =
    action.recommendation_snapshot.task_title ||
    action.recommendation_snapshot.title;
  const normalizedTitle = normalizeText(title).toLowerCase();
  return {
    type: "INTERNAL_TASK",
    title,
    normalized_title: normalizedTitle,
    semantic_task_key: [
      action.opportunity_id,
      action.action_type,
      normalizedTitle
    ].join(":"),
    description: action.recommendation_snapshot.reason || "",
    priority: action.priority || "MEDIUM",
    due_at: null
  };
}

module.exports = {
  buildProposedExecution,
  calculateRevenueActionBasis,
  clone,
  expectedRevenueActionSemantics,
  factualEvidence,
  fingerprint,
  normalizeText,
  recommendationBasis
};
