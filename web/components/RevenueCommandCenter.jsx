import React from "react";
import { formatCommercialValue } from "../lib/commercialValue";

function countLabel(summary) {
  if (!summary) {
    return "No recorded values";
  }

  return `${summary.known_count} known · ${summary.unknown_count} unknown`;
}

function summaryMoney(summary) {
  if (!summary || Number(summary.known_count) === 0) {
    return "Unknown";
  }

  return formatCommercialValue(summary.known_total);
}

const CLASSIFICATION_BADGES = [
  { type: "STRONG", label: "Strong" },
  { type: "AT_RISK", label: "At risk" },
  { type: "STALE", label: "Stale" },
  { type: "NO_NEXT_ACTION", label: "No next action" },
  { type: "VALUE_UNKNOWN", label: "Value unknown" }
];

export default function RevenueCommandCenter({
  revenue,
  loading,
  error,
  onRefresh,
  onOpenOpportunity
}) {
  if (loading && !revenue) {
    return (
      <section
        className="card revenue-command-center"
        data-testid="revenue-command-center"
      >
        <div className="pipeline-loading">
          Loading revenue intelligence…
        </div>
      </section>
    );
  }

  if (error && !revenue) {
    return (
      <section
        className="card revenue-command-center"
        data-testid="revenue-command-center"
      >
        <div className="pipeline-loading">
          Unable to load revenue intelligence.
          <button
            className="text-button"
            onClick={onRefresh}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const activePipeline =
    revenue?.active_pipeline;
  const attention =
    revenue?.revenue_requiring_attention;
  const classifications =
    revenue?.classifications || {};
  const topActions =
    revenue?.top_actions || [];
  const hasRevenueError = Boolean(error);

  return (
    <section
      className="card revenue-command-center"
      data-testid="revenue-command-center"
    >
      <div className="card-head">
        <div>
          <h3>Revenue Command Center</h3>
          <p>
            Deterministic active-pipeline attention from recorded CRM evidence.
          </p>
        </div>

        <button
          className="text-button"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>

      <div className="revenue-summary-grid">
        <div className="revenue-summary-item">
          <span>Active pipeline</span>
          <strong data-testid="revenue-active-pipeline-value">
            {summaryMoney(activePipeline?.value)}
          </strong>
          <small>
            {countLabel(activePipeline?.value)}
            {" · zero or blank remains unknown"}
          </small>
        </div>

        <div className="revenue-summary-item">
          <span>Weighted pipeline</span>
          <strong data-testid="revenue-weighted-pipeline-value">
            {summaryMoney(activePipeline?.weighted_value)}
          </strong>
          <small>{countLabel(activePipeline?.weighted_value)}</small>
        </div>

        <div className="revenue-summary-item">
          <span>Requires attention</span>
          <strong data-testid="revenue-attention-count">
            {attention?.opportunity_count || 0}
          </strong>
          <small>
            {summaryMoney(attention?.value)} known value
          </small>
        </div>
      </div>

      {hasRevenueError && (
        <div className="revenue-error" role="status">
          Revenue refresh failed. Showing the last successful revenue result.
          <button
            className="text-button"
            onClick={onRefresh}
          >
            Retry revenue
          </button>
        </div>
      )}

      <div className="revenue-classifications" aria-label="Revenue classifications">
        {CLASSIFICATION_BADGES.map(({ type, label }) => (
          <span
            key={type}
            className="revenue-classification"
            data-testid={`revenue-classification-${type.toLowerCase()}`}
          >
            {label}: {classifications[type]?.count || 0}
          </span>
        ))}
      </div>

      <div className="revenue-actions">
        <h4>Top actions</h4>
        {topActions.length === 0 ? (
          <div className="pipeline-loading">
            No active opportunities need review.
          </div>
        ) : (
          topActions.map(item => (
            <button
              key={item.opportunity_id}
              type="button"
              className="revenue-action"
              data-testid={`revenue-action-${item.opportunity_id}`}
              onClick={() =>
                onOpenOpportunity(item.opportunity_id)
              }
            >
              <span>
                <strong>
                  {item.business_name || "Unnamed opportunity"}
                </strong>
                <small>
                  {item.action.priority} · {item.action.type}
                  {item.value.known
                    ? ` · ${formatCommercialValue(item.value.amount)}`
                    : " · Value unknown"}
                </small>
              </span>
              <span className="revenue-action-title">
                {item.action.title} →
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
