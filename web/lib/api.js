import {
  unwrapImportAnalysisResponse,
  unwrapImportCommitResponse,
  unwrapImportPreviewResponse
} from "./importContracts.mjs";
import {
  createBrowserApiRequest
} from "./browserApiRequest.mjs";
import {
  unwrapRevenueLeakCaseListResponse,
  unwrapRevenueLeakCaseMutationResponse,
  unwrapStalledOpportunityDetectionResponse
} from "./revenueLeakCaseContracts.mjs";

export const API_BASE =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3000";

const request = createBrowserApiRequest({
  apiBase: API_BASE,
  fetchImpl: (...args) => fetch(...args)
});

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

export async function getOpportunityRevenueLeakCases(
  opportunityId
) {
  const query = new URLSearchParams({
    opportunity_id: opportunityId
  }).toString();

  const response = await request(
    `/api/revenue-leak-cases?${query}`
  );
  unwrapRevenueLeakCaseListResponse(response, opportunityId);
  return response;
}

export async function detectStalledOpportunity(
  opportunityId
) {
  const response = await request(
    `/api/opportunities/${encodeURIComponent(opportunityId)}/revenue-leak-cases/detect-stalled`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
  return unwrapStalledOpportunityDetectionResponse(response, opportunityId);
}

export async function transitionRevenueLeakCase(
  caseId,
  transition,
  body,
  opportunityId
) {
  const response = await request(
    `/api/revenue-leak-cases/${encodeURIComponent(caseId)}/${transition}`,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
  unwrapRevenueLeakCaseMutationResponse(response, opportunityId);
  return response;
}

export async function linkRevenueLeakCaseToAction(
  caseId,
  revenueActionId,
  opportunityId
) {
  const response = await request(
    `/api/revenue-leak-cases/${encodeURIComponent(caseId)}/link-revenue-action`,
    {
      method: "POST",
      body: JSON.stringify({
        revenue_action_id: revenueActionId
      })
    }
  );
  unwrapRevenueLeakCaseMutationResponse(response, opportunityId);
  return response;
}

export async function createImportPreview(
  input
) {
  return unwrapImportPreviewResponse(await request(
    "/api/import-batches/preview",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  ));
}

export async function getImportPreview(
  batchId
) {
  return unwrapImportPreviewResponse(await request(
    `/api/import-batches/${encodeURIComponent(batchId)}/preview`
  ), batchId);
}

export async function analyzeImportPreview(
  batchId,
  input = {},
  expectations = {}
) {
  return unwrapImportAnalysisResponse(await request(
    `/api/import-batches/${encodeURIComponent(batchId)}/analysis`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  ), expectations);
}

export async function commitImportBatch(
  batchId,
  input,
  expectations = {}
) {
  return unwrapImportCommitResponse(await request(
    `/api/import-batches/${encodeURIComponent(batchId)}/commit`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  ), batchId, expectations);
}

export async function getImportCommit(
  batchId,
  expectations = {}
) {
  return unwrapImportCommitResponse(await request(
    `/api/import-batches/${encodeURIComponent(batchId)}/commit`
  ), batchId, expectations);
}
