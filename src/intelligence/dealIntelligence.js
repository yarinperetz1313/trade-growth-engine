const {
  readCollection
} = require("../services/localStore");

function clamp(value, min = 0, max = 100) {
  return Math.max(
    min,
    Math.min(max, Number(value) || 0)
  );
}

function hasValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  const normalized =
    String(value).trim();

  return (
    normalized !== "" &&
    normalized.toLowerCase() !==
      "unknown"
  );
}

function daysSince(
  date,
  now = Date.now()
) {
  if (!date) return null;

  const timestamp =
    new Date(date).getTime();

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(
    0,
    (new Date(now).getTime() - timestamp) /
      86400000
  );
}

function findProspect(opportunity) {
  if (!opportunity?.prospect_id) {
    return null;
  }

  return (
    readCollection("prospects")
      .find(
        prospect =>
          prospect.id ===
          opportunity.prospect_id
      ) || null
  );
}

function firstValue(...values) {
  return (
    values.find(value =>
      hasValue(value)
    ) ?? null
  );
}

function hasMeaningfulContactName(value) {
  if (!hasValue(value)) {
    return false;
  }

  const normalized =
    String(value).trim();

  if (normalized.toLowerCase() === "j") {
    return false;
  }

  return normalized.length >= 2;
}

function firstContactValue(...values) {
  return (
    values.find(value =>
      hasMeaningfulContactName(value)
    ) ?? null
  );
}

function buildDealIntelligenceFromData(
  opportunity,
  {
    prospects = [],
    activities: allActivities = [],
    tasks: allTasks = [],
    generatedAt = new Date().toISOString()
  } = {}
) {
  const prospect =
    prospects.find(
      item =>
        item.id ===
        opportunity?.prospect_id
    ) || null;

  const activities =
    allActivities.filter(
      activity =>
        activity.opportunity_id ===
        opportunity.id
    );

  const tasks =
    allTasks.filter(
      task =>
        task.opportunity_id ===
        opportunity.id
    );

  const latestActivity =
    [...activities]
      .sort(
        (a, b) =>
          new Date(
            b.created_at || 0
          ) -
          new Date(
            a.created_at || 0
          )
      )[0] || null;

  const latestTask =
    [...tasks]
      .sort(
        (a, b) =>
          new Date(
            b.created_at || 0
          ) -
          new Date(
            a.created_at || 0
          )
      )[0] || null;

  const activityAge =
    daysSince(
      latestActivity?.created_at,
      generatedAt
    );

  /*
   * Resolve CRM information from the
   * opportunity first, then linked prospect.
   *
   * We never invent missing values.
   */

  const businessName =
    firstValue(
      opportunity.business_name,
      opportunity.name,
      prospect?.business_name,
      prospect?.company_name,
      prospect?.name
    );

  const service =
    firstValue(
      opportunity.service,
      prospect?.service,
      prospect?.trade,
      prospect?.industry
    );

  const location =
    firstValue(
      opportunity.location,
      prospect?.location,
      prospect?.suburb,
      prospect?.city
    );

  const website =
    firstValue(
      opportunity.website,
      prospect?.website,
      prospect?.url
    );

  const contactName =
    firstContactValue(
      opportunity.contact_name,
      prospect?.contact_name,
      prospect?.decision_maker,
      prospect?.owner_name
    );

  /*
   * ----------------------------------------------------------
   * EVIDENCE
   * ----------------------------------------------------------
   */

  const evidenceChecks = [
    {
      key: "business",
      label: "Business identified",
      present:
        hasValue(businessName)
    },
    {
      key: "service",
      label: "Service identified",
      present:
        hasValue(service)
    },
    {
      key: "location",
      label: "Location identified",
      present:
        hasValue(location)
    },
    {
      key: "stage",
      label: "Stage identified",
      present:
        hasValue(opportunity.stage)
    },
    {
      key: "value",
      label: "Commercial value known",
      present:
        Number(
          opportunity.value
        ) > 0
    },
    {
      key: "next_action",
      label: "Next action defined",
      present:
        hasValue(
          opportunity.next_action
        )
    },
    {
      key: "contact",
      label: "Decision maker/contact identified",
      present:
        hasValue(contactName)
    },
    {
      key: "website",
      label: "Website identified",
      present:
        hasValue(website)
    }
  ];

  const known =
    evidenceChecks
      .filter(
        item => item.present
      )
      .map(
        item => item.label
      );

  const unknown =
    evidenceChecks
      .filter(
        item => !item.present
      )
      .map(
        item => item.label
      );

  const dataQuality =
    Math.round(
      (
        evidenceChecks.filter(
          item => item.present
        ).length /
        evidenceChecks.length
      ) * 100
    );

  /*
   * ----------------------------------------------------------
   * FIT
   * ----------------------------------------------------------
   */

  let fit = 0;

  if (hasValue(businessName)) {
    fit += 25;
  }

  if (hasValue(service)) {
    fit += 25;
  }

  if (hasValue(location)) {
    fit += 25;
  }

  if (opportunity.prospect_id) {
    fit += 25;
  }

  /*
   * ----------------------------------------------------------
   * COMMERCIAL POTENTIAL
   * ----------------------------------------------------------
   */

  const value =
    Number(
      opportunity.value || 0
    );

  const commercialPotential =
    value > 0
      ? clamp(
          Math.round(
            35 +
              Math.min(
                65,
                Math.log10(
                  value + 1
                ) * 14
              )
          )
        )
      : null;

  /*
   * ----------------------------------------------------------
   * ENGAGEMENT
   * ----------------------------------------------------------
   */

  const engagement =
    activities.length === 0
      ? 0
      : clamp(
          30 +
            activities.length *
              14
        );

  /*
   * ----------------------------------------------------------
   * MOMENTUM
   * ----------------------------------------------------------
   */

  let momentum = 0;

  if (activities.length > 0) {
    momentum += 30;
  }

  if (
    activityAge !== null
  ) {
    if (activityAge <= 2) {
      momentum += 50;
    } else if (
      activityAge <= 7
    ) {
      momentum += 35;
    } else if (
      activityAge <= 14
    ) {
      momentum += 15;
    }
  }

  const openTasks =
    tasks.filter(
      task =>
        task.status !==
        "COMPLETED"
    );

  if (openTasks.length > 0) {
    momentum += 20;
  }

  momentum =
    clamp(momentum);

  /*
   * ----------------------------------------------------------
   * STALE RISK
   * ----------------------------------------------------------
   */

  let staleRisk = 0;

  if (
    activityAge === null
  ) {
    staleRisk = 85;
  } else if (
    activityAge > 21
  ) {
    staleRisk = 100;
  } else if (
    activityAge > 14
  ) {
    staleRisk = 85;
  } else if (
    activityAge > 7
  ) {
    staleRisk = 60;
  } else if (
    activityAge > 3
  ) {
    staleRisk = 30;
  }

  /*
   * ----------------------------------------------------------
   * OVERALL HEALTH
   *
   * Commercial potential is excluded when
   * value is unknown. Unknown ≠ zero.
   * ----------------------------------------------------------
   */

  const components = [
    fit,
    dataQuality,
    engagement,
    momentum
  ];

  if (
    commercialPotential !==
    null
  ) {
    components.push(
      commercialPotential
    );
  }

  const overall =
    Math.round(
      components.reduce(
        (sum, item) =>
          sum + item,
        0
      ) /
        components.length
    );

  /*
   * ----------------------------------------------------------
   * CONFIDENCE
   * ----------------------------------------------------------
   */

  const confidence =
    clamp(
      Math.round(
        dataQuality * 0.75 +
          (
            activities.length > 0
              ? 25
              : 0
          )
      )
    );

  /*
   * ----------------------------------------------------------
   * RISKS
   * ----------------------------------------------------------
   */

  const risks = [];

  if (
    !hasValue(
      opportunity.next_action
    )
  ) {
    risks.push({
      type:
        "NO_NEXT_ACTION",
      severity:
        "HIGH",
      title:
        "No next action defined",
      reason:
        "The opportunity does not currently have a clear recorded next action."
    });
  }

  if (
    activityAge === null
  ) {
    risks.push({
      type:
        "NO_ACTIVITY",
      severity:
        "HIGH",
      title:
        "No activity recorded",
      reason:
        "There is no persisted activity history for this opportunity."
    });
  } else if (
    activityAge > 7
  ) {
    risks.push({
      type:
        "STALE",
      severity:
        activityAge > 14
          ? "HIGH"
          : "MEDIUM",
      title:
        "Opportunity is becoming stale",
      reason:
        `The latest activity was approximately ${Math.round(
          activityAge
        )} days ago.`
    });
  }

  if (
    value <= 0
  ) {
    risks.push({
      type:
        "VALUE_UNKNOWN",
      severity:
        "MEDIUM",
      title:
        "Commercial value is unknown",
      reason:
        "No positive opportunity value is currently recorded."
    });
  }

  if (
    !hasValue(service)
  ) {
    risks.push({
      type:
        "SERVICE_UNKNOWN",
      severity:
        "MEDIUM",
      title:
        "Service is unknown",
      reason:
        "Neither the opportunity nor linked prospect contains a recorded service."
    });
  }

  if (
    !hasValue(location)
  ) {
    risks.push({
      type:
        "LOCATION_UNKNOWN",
      severity:
        "MEDIUM",
      title:
        "Location is unknown",
      reason:
        "Neither the opportunity nor linked prospect contains a recorded location."
    });
  }

  if (
    !hasValue(contactName)
  ) {
    risks.push({
      type:
        "CONTACT_UNKNOWN",
      severity:
        "MEDIUM",
      title:
        "Decision maker is unknown",
      reason:
        "No contact or decision-maker information is currently recorded."
    });
  }

  /*
   * ----------------------------------------------------------
   * NEXT BEST ACTION
   * ----------------------------------------------------------
   */

  let nextBestAction;

  if (
    !hasValue(
      opportunity.next_action
    )
  ) {
    nextBestAction = {
      type:
        "CREATE_TASK",
      priority:
        "HIGH",
      title:
        "Define the next action",
      reason:
        "The opportunity has no explicit next action recorded.",
      taskTitle:
        `Define next action — ${
          businessName ||
          "opportunity"
        }`
    };
  } else if (
    !hasValue(contactName)
  ) {
    nextBestAction = {
      type:
        "RESEARCH",
      priority:
        "HIGH",
      title:
        "Identify the decision maker",
      reason:
        "The opportunity has an action plan but no identified contact or decision maker.",
      taskTitle:
        `Identify decision maker — ${
          businessName ||
          "opportunity"
        }`
    };
  } else if (
    activityAge === null ||
    activityAge > 7
  ) {
    nextBestAction = {
      type:
        "FOLLOW_UP",
      priority:
        activityAge !== null &&
        activityAge > 14
          ? "HIGH"
          : "MEDIUM",
      title:
        "Follow up on the opportunity",
      reason:
        activityAge === null
          ? "There is no recorded activity."
          : `The opportunity has had no activity for approximately ${Math.round(
              activityAge
            )} days.`,
      taskTitle:
        `Follow up — ${
          businessName ||
          "opportunity"
        }`
    };
  } else if (
    value <= 0
  ) {
    nextBestAction = {
      type:
        "QUALIFY",
      priority:
        "MEDIUM",
      title:
        "Confirm commercial value",
      reason:
        "The opportunity is active but its commercial value has not been established.",
      taskTitle:
        `Confirm opportunity value — ${
          businessName ||
          "opportunity"
        }`
    };
  } else {
    nextBestAction = {
      type:
        "ADVANCE",
      priority:
        "MEDIUM",
      title:
        opportunity.next_action ||
        "Advance the opportunity",
      reason:
        "The opportunity has recent activity, known commercial value and a defined next action.",
      taskTitle:
        opportunity.next_action
    };
  }

  /*
   * ----------------------------------------------------------
   * HEALTH STATUS
   * ----------------------------------------------------------
   */

  let status;

  if (
    overall >= 75 &&
    staleRisk < 40
  ) {
    status =
      "STRONG";
  } else if (
    overall >= 50 &&
    staleRisk < 70
  ) {
    status =
      "MEDIUM";
  } else {
    status =
      "AT_RISK";
  }

  return {
    generated_at:
      generatedAt,

    opportunity_id:
      opportunity.id,

    resolved: {
      business_name:
        businessName,
      service,
      location,
      website,
      contact_name:
        contactName,
      source:
        prospect
          ? "opportunity+prospect"
          : "opportunity"
    },

    score: {
      overall,
      confidence,
      fit,
      data_quality:
        dataQuality,
      commercial_potential:
        commercialPotential,
      engagement,
      momentum,
      stale_risk:
        staleRisk
    },

    health: {
      status,
      risks
    },

    evidence: {
      known,
      unknown
    },

    activity: {
      count:
        activities.length,
      latest:
        latestActivity,
      days_since_latest:
        activityAge
    },

    tasks: {
      count:
        tasks.length,
      open:
        openTasks.length,
      latest:
        latestTask
    },

    next_best_action:
      nextBestAction
  };
}

function buildDealIntelligence(
  opportunity
) {
  const prospect =
    findProspect(opportunity);

  return buildDealIntelligenceFromData(
    opportunity,
    {
      prospects: prospect ? [prospect] : [],
      activities:
        readCollection("activities"),
      tasks:
        readCollection("tasks")
    }
  );
}

function getOpportunityIntelligence(
  opportunityId
) {
  const opportunity =
    readCollection(
      "opportunities"
    ).find(
      item =>
        item.id ===
        opportunityId
    );

  if (!opportunity) {
    return {
      error:
        "OPPORTUNITY_NOT_FOUND"
    };
  }

  return {
    opportunity,
    intelligence:
      buildDealIntelligence(
        opportunity
      )
  };
}

module.exports = {
  buildDealIntelligence,
  buildDealIntelligenceFromData,
  getOpportunityIntelligence
};
