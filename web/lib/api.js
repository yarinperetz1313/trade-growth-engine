const API_BASE =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3000";

async function request(
  path,
  options = {}
) {
  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        headers: {
          "Content-Type":
            "application/json",
          ...(options.headers || {})
        },
        ...options
      }
    );

  let body = null;

  try {
    body =
      await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(
      body?.message ||
      body?.error ||
      `Request failed: ${response.status}`
    );
  }

  return body;
}

export function getHealth() {
  return request(
    "/health"
  );
}

export function getProspects(
  params = {}
) {
  const query =
    new URLSearchParams(
      params
    ).toString();

  return request(
    `/api/prospects${
      query
        ? `?${query}`
        : ""
    }`
  );
}

export function createProspect(
  prospect
) {
  return request(
    "/api/prospects",
    {
      method: "POST",
      body:
        JSON.stringify(
          prospect
        )
    }
  );
}

export function getLeads(
  params = {}
) {
  const query =
    new URLSearchParams(
      params
    ).toString();

  return request(
    `/api/leads${
      query
        ? `?${query}`
        : ""
    }`
  );
}

export function createLead(
  lead
) {
  return request(
    "/api/leads",
    {
      method: "POST",
      body:
        JSON.stringify(
          lead
        )
    }
  );
}

export function getOpportunities(
  params = {}
) {
  const query =
    new URLSearchParams(
      params
    ).toString();

  return request(
    `/api/opportunities${
      query
        ? `?${query}`
        : ""
    }`
  );
}

export function getPipelineMetrics() {
  return request(
    "/api/pipeline/metrics"
  );
}

export function getRevenueIntelligence() {
  return request(
    "/api/intelligence/revenue"
  );
}

export function getOpportunityActivities(
  opportunityId
) {
  return request(
    `/api/opportunities/${opportunityId}/activities`
  );
}

export function createOpportunityFromProspect(
  prospectId
) {
  return request(
    `/api/opportunities/from-prospect/${prospectId}`,
    {
      method: "POST"
    }
  );
}

export function updateOpportunityStage(
  opportunityId,
  stage
) {
  return request(
    `/api/opportunities/${opportunityId}/stage`,
    {
      method: "PATCH",
      body:
        JSON.stringify({
          stage
        })
    }
  );
}


export function getOpportunityTasks(
  opportunityId
) {
  return request(
    `/api/tasks/opportunity/${opportunityId}`
  );
}

export function createTask(
  task
) {
  return request(
    "/api/tasks",
    {
      method: "POST",
      body: JSON.stringify(task)
    }
  );
}

export function updateTask(
  taskId,
  updates
) {
  return request(
    `/api/tasks/${taskId}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates)
    }
  );
}


export function getOpportunityIntelligence(
  opportunityId
) {
  return request(
    `/api/opportunities/${opportunityId}/intelligence`
  );
}

export function runOpportunityIntelligenceAction(
  opportunityId,
  action,
  body = {}
) {
  return request(
    `/api/opportunities/${opportunityId}/intelligence/${action}`,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}

export function getOpportunityRevenueActions(
  opportunityId
) {
  const query = new URLSearchParams({
    opportunity_id: opportunityId
  }).toString();

  return request(
    `/api/revenue-actions?${query}`
  );
}

export function createRevenueAction(
  opportunityId
) {
  return request(
    `/api/opportunities/${opportunityId}/revenue-actions`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function transitionRevenueAction(
  actionId,
  transition,
  body = {}
) {
  return request(
    `/api/revenue-actions/${actionId}/${transition}`,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}
