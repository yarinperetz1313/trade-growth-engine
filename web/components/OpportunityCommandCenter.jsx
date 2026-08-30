import React, { useEffect, useMemo, useState } from "react";
import {
  createRevenueAction,
  getOpportunityRevenueActions,
  getOpportunityIntelligence,
  runOpportunityIntelligenceAction,
  transitionRevenueAction
} from "../lib/api";

const ACTIVE_REVENUE_ACTION_STATUSES = new Set([
  "RECOMMENDED",
  "PREPARED",
  "APPROVED",
  "EXECUTING",
  "FAILED"
]);

const SUPPORTED_REVENUE_ACTION_TYPES = new Set([
  "FOLLOW_UP",
  "CREATE_TASK",
  "RESEARCH",
  "QUALIFY",
  "ADVANCE"
]);

function money(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Unknown";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(numeric);
}

function score(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Unknown";
  }

  return Math.round(Number(value));
}

function Signal({ label, value, danger = false }) {
  const numeric =
    value === null ||
    value === undefined ||
    value === ""
      ? null
      : Number(value);

  const width =
    numeric === null
      ? 0
      : Math.max(
          0,
          Math.min(100, numeric)
        );

  return (
    <div className="oc-signal">
      <div className="oc-signal-top">
        <span>{label}</span>
        <strong>
          {numeric === null
            ? "Unknown"
            : Math.round(numeric)}
        </strong>
      </div>

      <div className="oc-bar">
        <div
          className={`oc-bar-fill ${
            danger ? "danger" : ""
          }`}
          style={{
            width: `${width}%`
          }}
        />
      </div>
    </div>
  );
}

function ActionCard({
  title,
  description,
  children
}) {
  return (
    <div className="oc-action-item">
      <div className="oc-action-icon">
        →
      </div>

      <div className="oc-action-body">
        <strong>{title}</strong>
        <span>{description}</span>
        {children}
      </div>
    </div>
  );
}

export default function OpportunityCommandCenter({
  opportunity,
  onBack,
  onOpportunityUpdated
}) {
  const [payload, setPayload] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState(null);

  const [actionLoading, setActionLoading] =
    useState(null);

  const [actionMessage, setActionMessage] =
    useState(null);

  const [actionError, setActionError] =
    useState(null);

  const [contactName, setContactName] =
    useState("");

  const [value, setValue] =
    useState("");

  const [revenueActions, setRevenueActions] =
    useState([]);

  const [executionLoading, setExecutionLoading] =
    useState(null);

  const [executionError, setExecutionError] =
    useState(null);

  const [executionMessage, setExecutionMessage] =
    useState(null);

  async function loadRevenueActions() {
    try {
      const result = await getOpportunityRevenueActions(
        opportunity.id
      );
      setRevenueActions(result.data || []);
    } catch (err) {
      setExecutionError(
        err.message || "Unable to load execution history."
      );
    }
  }

  async function loadIntelligence({
    notifyOpportunityUpdated = true
  } = {}) {
    setLoading(true);
    setError(null);

    try {
      const data =
        await getOpportunityIntelligence(
          opportunity.id
        );

      setPayload(data.data);

      if (
        notifyOpportunityUpdated &&
        data.data?.opportunity
      ) {
        await onOpportunityUpdated?.(
          data.data.opportunity
        );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIntelligence();
    loadRevenueActions();
  }, [opportunity.id]);

  const intelligence =
    payload?.intelligence;

  const currentOpportunity =
    payload?.opportunity ||
    opportunity;

  const resolved =
    intelligence?.resolved;

  const scoreData =
    intelligence?.score;

  const health =
    intelligence?.health;

  const evidence =
    intelligence?.evidence;

  const activity =
    intelligence?.activity;

  const tasks =
    intelligence?.tasks;

  const nextAction =
    intelligence?.next_best_action;

  const risks =
    health?.risks || [];

  const hasContact =
    resolved?.contact_name &&
    resolved.contact_name !==
      "Unknown";

  const hasValue =
    currentOpportunity.value !==
      null &&
    currentOpportunity.value !==
      undefined &&
    currentOpportunity.value !== "" &&
    Number(currentOpportunity.value) > 0;

  const hasStaleRisk =
    Number(scoreData?.stale_risk) >=
    70;

  const activeRevenueAction = revenueActions
    .filter(action => ACTIVE_REVENUE_ACTION_STATUSES.has(action.status))
    .sort((left, right) =>
      String(right.updated_at || right.created_at || "").localeCompare(
        String(left.updated_at || left.created_at || "")
      ) || String(right.id).localeCompare(String(left.id))
    )[0] || null;

  const canPrepareRevenueAction =
    SUPPORTED_REVENUE_ACTION_TYPES.has(nextAction?.type);

  async function applyRevenueActionResult(result) {
    const refreshed = result?.refreshed;

    if (
      refreshed?.opportunity &&
      refreshed?.opportunity_intelligence
    ) {
      setPayload({
        opportunity: refreshed.opportunity,
        intelligence: refreshed.opportunity_intelligence
      });
      await onOpportunityUpdated?.(refreshed.opportunity);
    }

    await loadRevenueActions();
  }

  async function copyCommunicationDraft() {
    const draft = activeRevenueAction?.proposed_execution;
    if (!draft || draft.type !== "COMMUNICATION_DRAFT") return;

    setExecutionError(null);
    setExecutionMessage(null);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Copy is unavailable in this browser.");
      }
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setExecutionMessage("Draft copied for human review.");
    } catch (err) {
      setExecutionError(err.message || "Unable to copy the prepared draft.");
    }
  }

  async function runRevenueActionTransition(
    key,
    transition,
    body = {}
  ) {
    if (!activeRevenueAction) return;

    setExecutionLoading(key);
    setExecutionError(null);
    setExecutionMessage(null);

    try {
      const result = await transitionRevenueAction(
        activeRevenueAction.id,
        transition,
        body
      );
      await applyRevenueActionResult(result);
      setExecutionMessage(
        result.duplicate
          ? "Execution state was already applied."
          : "Execution state updated."
      );
    } catch (err) {
      setExecutionError(err.message);
      await loadRevenueActions();
      await loadIntelligence();
    } finally {
      setExecutionLoading(null);
    }
  }

  async function prepareCurrentRevenueAction() {
    setExecutionLoading("prepare");
    setExecutionError(null);
    setExecutionMessage(null);

    try {
      const created = activeRevenueAction
        ? { data: activeRevenueAction }
        : await createRevenueAction(currentOpportunity.id);
      const prepared = await transitionRevenueAction(
        created.data.id,
        "prepare",
        {}
      );
      await applyRevenueActionResult(prepared);
      setExecutionMessage(
        prepared.duplicate
          ? "Prepared execution already exists."
          : "Execution prepared for review."
      );
    } catch (err) {
      setExecutionError(err.message);
      await loadRevenueActions();
      await loadIntelligence();
    } finally {
      setExecutionLoading(null);
    }
  }

  async function performAction(
    key,
    action,
    body
  ) {
    setActionLoading(key);
    setActionMessage(null);
    setActionError(null);

    try {
      const data =
        await runOpportunityIntelligenceAction(
          currentOpportunity.id,
          action,
          body || {}
        );

      if (data.opportunity) {
        const freshPayload =
          data.state || {
            opportunity: data.opportunity,
            intelligence: data.intelligence
          };

        setPayload(freshPayload);
        await onOpportunityUpdated?.(
          data.opportunity
        );
      }

      setActionMessage(
        data.duplicate
          ? "Action was already applied."
          : "Action completed successfully."
      );

      setContactName("");
      setValue("");

      await loadIntelligence({
        notifyOpportunityUpdated: false
      });
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  const recommendedActions =
    useMemo(() => {
      const actions = [];

      if (!hasContact) {
        actions.push({
          key: "contact",
          title:
            "Identify the decision maker",
          description:
            "No contact or decision maker is currently attached to this opportunity.",
          type: "contact"
        });
      }

      if (!hasValue) {
        actions.push({
          key: "value",
          title:
            "Add commercial value",
          description:
            "The opportunity currently has no recorded commercial value.",
          type: "value"
        });
      }

      return actions;
    }, [
      hasContact,
      hasValue,
      hasStaleRisk
    ]);

  if (loading) {
    return (
      <div className="oc-page" data-testid="opportunity-command-center">
        <button
          className="oc-back"
          onClick={onBack}
        >
          ← Back to opportunities
        </button>

        <div className="oc-loading">
          <div className="oc-loading-pulse" />
          <strong>
            Building opportunity intelligence…
          </strong>
          <span>
            Analysing CRM evidence,
            activity, tasks and prospect
            context.
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="oc-page" data-testid="opportunity-command-center">
        <button
          className="oc-back"
          onClick={onBack}
        >
          ← Back to opportunities
        </button>

        <div className="oc-error">
          <strong>
            Unable to load intelligence
          </strong>

          <span>{error}</span>

          <button
            className="oc-primary-button"
            onClick={loadIntelligence}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="oc-page" data-testid="opportunity-command-center">
      <button
        className="oc-back"
        onClick={onBack}
      >
        ← Back to opportunities
      </button>

      <header className="oc-header">
        <div>
          <div className="oc-eyebrow">
            OPPORTUNITY COMMAND CENTER
          </div>

          <h1>
            {resolved?.business_name ||
              currentOpportunity.business_name ||
              currentOpportunity.name ||
              "Opportunity"}
          </h1>

          <div className="oc-meta">
            {resolved?.service && (
              <span>
                {resolved.service}
              </span>
            )}

            {resolved?.location && (
              <span>
                {resolved.location}
              </span>
            )}

            {currentOpportunity.stage && (
              <span>
                {currentOpportunity.stage}
              </span>
            )}
          </div>
        </div>

        <div className="oc-header-right">
          <div className="oc-health-badge" data-testid="opportunity-health-status">
            <span />
            {health?.status ||
              "UNKNOWN"}
          </div>

          <div className="oc-value" data-testid="opportunity-value">
            {money(
              currentOpportunity.value
            )}
          </div>
        </div>
      </header>

      {actionMessage && (
        <div className="oc-success-banner" data-testid="action-success">
          ✓ {actionMessage}
        </div>
      )}

      {actionError && (
        <div className="oc-error">
          <strong>Action failed</strong>
          <span>{actionError}</span>
        </div>
      )}

      <section className="oc-hero-grid">
        <div className="oc-health-card">
          <div className="oc-card-label">
            OPPORTUNITY HEALTH
          </div>

          <div className="oc-score-row">
            <div className="oc-big-score">
              {score(
                scoreData?.overall
              )}
            </div>

            <div>
              <div className="oc-score-title">
                {health?.status ||
                  "UNKNOWN"}
              </div>

              <div className="oc-score-confidence">
                {score(
                  scoreData?.confidence
                )}
                % confidence
              </div>
            </div>
          </div>

          <div className="oc-score-description">
            Deterministic health
            assessment based on
            recorded CRM evidence.
            This is not a probability
            of closing.
          </div>
        </div>

        <div className="oc-action-card">
          <div className="oc-card-label">
            NEXT BEST ACTION
          </div>

          <h2>
            {nextAction?.title ||
              "No action required"}
          </h2>

          <p>
            {nextAction?.reason ||
              "The opportunity currently has no critical recommended action."}
          </p>

          {(
            nextAction?.type ===
              "QUALIFY" ||
            !hasValue
          ) ? (
            <div className="oc-next-action-form">
              <input
                type="number"
                min="1"
                step="100"
                value={value}
                onChange={e =>
                  setValue(
                    e.target.value
                  )
                }
                placeholder="Estimated deal value (AUD)"
              />

              <button
                className="oc-primary-button"
                disabled={
                  !value ||
                  Number(value) <= 0 ||
                  actionLoading ===
                    "value"
                }
                onClick={() =>
                  performAction(
                    "value",
                    "value",
                    {
                      value:
                        Number(value)
                    }
                  )
                }
              >
                {actionLoading ===
                "value"
                  ? "Confirming…"
                  : "Confirm Commercial Value"}
              </button>
            </div>
          ) : canPrepareRevenueAction ? (
            <span className="oc-execution-pointer">
              Prepare and review this action in the execution workflow below.
            </span>
          ) : null}
        </div>
      </section>

      <section
        className="oc-panel oc-execution-panel"
        data-testid="revenue-action-execution"
      >
        <div className="oc-card-label">
          OPPORTUNITY EXECUTION
        </div>

        <h2>Human-controlled action lifecycle</h2>

        <p className="oc-section-description">
          TGE prepares the work. External communication is never sent by TGE
          in this phase and requires explicit human approval and confirmation.
        </p>

        {executionError && (
          <div className="oc-error" data-testid="revenue-action-error">
            <strong>Execution action failed</strong>
            <span>{executionError}</span>
          </div>
        )}

        {executionMessage && (
          <div className="oc-success-banner" data-testid="revenue-action-success">
            ✓ {executionMessage}
          </div>
        )}

        {!activeRevenueAction ? (
          <div className="oc-execution-recommendation">
            <div>
              <span className="oc-status-badge">RECOMMENDED</span>
              <strong>{nextAction?.title || "No executable recommendation"}</strong>
              <p>{nextAction?.reason || "No deterministic recommendation is available."}</p>
            </div>

            {canPrepareRevenueAction && (
              <button
                className="oc-primary-button"
                data-testid="prepare-revenue-action"
                disabled={executionLoading === "prepare"}
                onClick={prepareCurrentRevenueAction}
              >
                {executionLoading === "prepare" ? "Preparing…" : "Prepare action"}
              </button>
            )}
          </div>
        ) : (
          <div className="oc-execution-current">
            <div className="oc-execution-heading">
              <div>
                <span
                  className="oc-status-badge"
                  data-testid="revenue-action-status"
                >
                  {activeRevenueAction.status}
                </span>
                <strong>{activeRevenueAction.title}</strong>
              </div>
              <small>
                {activeRevenueAction.action_type} · {activeRevenueAction.priority}
              </small>
            </div>

            <p>{activeRevenueAction.reason}</p>

            {activeRevenueAction.proposed_execution?.type ===
              "COMMUNICATION_DRAFT" && (
              <div
                className="oc-execution-proposal"
                data-testid="communication-draft"
              >
                <span>Email draft · not sent by TGE</span>
                <strong>{activeRevenueAction.proposed_execution.subject}</strong>
                <pre>{activeRevenueAction.proposed_execution.body}</pre>
                <button
                  className="oc-secondary-button"
                  data-testid="copy-communication-draft"
                  onClick={copyCommunicationDraft}
                >
                  Copy draft
                </button>
              </div>
            )}

            {activeRevenueAction.proposed_execution?.type ===
              "INTERNAL_TASK" && (
              <div
                className="oc-execution-proposal"
                data-testid="internal-task-proposal"
              >
                <span>Internal task</span>
                <strong>{activeRevenueAction.proposed_execution.title}</strong>
                <p>{activeRevenueAction.proposed_execution.description}</p>
                <small>
                  {activeRevenueAction.proposed_execution.priority} · No due date invented
                </small>
              </div>
            )}

            <div className="oc-execution-controls">
              {activeRevenueAction.status === "RECOMMENDED" && (
                <button
                  className="oc-primary-button"
                  disabled={executionLoading === "prepare"}
                  onClick={prepareCurrentRevenueAction}
                >
                  Prepare action
                </button>
              )}

              {activeRevenueAction.status === "PREPARED" && (
                <>
                  <button
                    className="oc-primary-button"
                    data-testid="approve-revenue-action"
                    disabled={executionLoading === "approve"}
                    onClick={() =>
                      runRevenueActionTransition("approve", "approve")
                    }
                  >
                    {executionLoading === "approve" ? "Approving…" : "Approve"}
                  </button>
                  <button
                    className="oc-secondary-button"
                    data-testid="reject-revenue-action"
                    disabled={executionLoading === "reject"}
                    onClick={() =>
                      runRevenueActionTransition("reject", "reject")
                    }
                  >
                    Reject
                  </button>
                </>
              )}

              {activeRevenueAction.status === "APPROVED" && (
                <button
                  className="oc-primary-button"
                  data-testid="execute-revenue-action"
                  disabled={executionLoading === "execute"}
                  onClick={() =>
                    runRevenueActionTransition(
                      "execute",
                      "execute",
                      activeRevenueAction.execution_type === "COMMUNICATION_DRAFT"
                        ? { executionMode: "MANUAL_CONFIRMED" }
                        : {}
                    )
                  }
                >
                  {executionLoading === "execute"
                    ? "Confirming…"
                    : activeRevenueAction.execution_type === "COMMUNICATION_DRAFT"
                      ? "Mark completed manually"
                      : "Create internal task"}
                </button>
              )}

              {activeRevenueAction.status === "EXECUTING" && (
                <span className="oc-execution-pointer">
                  Recovering linked CRM effects before allowing another execution.
                </span>
              )}

              {activeRevenueAction.status === "FAILED" && (
                <button
                  className="oc-primary-button"
                  data-testid="retry-revenue-action"
                  disabled={executionLoading === "execute"}
                  onClick={() =>
                    runRevenueActionTransition(
                      "execute",
                      "execute",
                      activeRevenueAction.execution_type === "COMMUNICATION_DRAFT"
                        ? { executionMode: "MANUAL_CONFIRMED" }
                        : {}
                    )
                  }
                >
                  Retry execution
                </button>
              )}
            </div>
          </div>
        )}

        <div className="oc-execution-history" data-testid="revenue-action-history">
          <h3>Recent execution history</h3>
          {revenueActions.length === 0 ? (
            <div className="oc-empty">No durable revenue actions recorded.</div>
          ) : (
            revenueActions.slice(0, 5).map(action => (
              <div className="oc-execution-history-item" key={action.id}>
                <span>{action.status}</span>
                <div>
                  <strong>{action.title}</strong>
                  <small>
                    {action.executed_at || action.rejected_at || action.prepared_at || action.created_at}
                  </small>
                  <small>{action.reason}</small>
                  {action.proposed_execution?.type === "COMMUNICATION_DRAFT" && (
                    <small>Email draft prepared · not sent by TGE</small>
                  )}
                  {action.proposed_execution?.type === "INTERNAL_TASK" && (
                    <small>Internal task: {action.proposed_execution.title}</small>
                  )}
                  {action.approved_at && <small>Human approval recorded</small>}
                  {action.rejection_reason && <small>Rejected: {action.rejection_reason}</small>}
                  {action.execution_result?.mode && (
                    <small>Execution: {action.execution_result.mode} · {action.execution_result.outcome}</small>
                  )}
                  {action.resulting_activity_id && <small>CRM activity linked</small>}
                  {action.resulting_task_id && <small>CRM task linked</small>}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="oc-panel">
        <div className="oc-card-label">
          ACTION CENTRE
        </div>

        <h2>
          Resolve intelligence gaps
        </h2>

        <p className="oc-section-description">
          Turn detected gaps into
          actual CRM actions. Every
          successful action creates
          activity and refreshes the
          intelligence score.
        </p>

        <div className="oc-actions">
          {!hasContact && (
            <ActionCard
              title="Add decision maker"
              description="Attach the person responsible for this opportunity."
            >
              <div className="oc-action-form">
                <input
                  data-testid="contact-name-input"
                  value={contactName}
                  onChange={e =>
                    setContactName(
                      e.target.value
                    )
                  }
                  placeholder="Contact name"
                />

                <button
                  className="oc-secondary-button"
                  data-testid="add-contact"
                  disabled={
                    !contactName.trim() ||
                    actionLoading ===
                      "contact"
                  }
                  onClick={() =>
                    performAction(
                      "contact",
                      "contact",
                      {
                        contactName
                      }
                    )
                  }
                >
                  {actionLoading ===
                  "contact"
                    ? "Saving…"
                    : "Add Contact"}
                </button>
              </div>
            </ActionCard>
          )}

          {!hasValue && (
            <ActionCard
              title="Set commercial value"
              description="Record the estimated opportunity value."
            >
              <div className="oc-action-form">
                <input
                  type="number"
                  min="0"
                  value={value}
                  onChange={e =>
                    setValue(
                      e.target.value
                    )
                  }
                  placeholder="Value in AUD"
                />

                <button
                  className="oc-secondary-button"
                  disabled={
                    !value ||
                    actionLoading ===
                      "value"
                  }
                  onClick={() =>
                    performAction(
                      "value",
                      "value",
                      {
                        value
                      }
                    )
                  }
                >
                  {actionLoading ===
                  "value"
                    ? "Saving…"
                    : "Set Value"}
                </button>
              </div>
            </ActionCard>
          )}

          {!recommendedActions.length && (
            <div className="oc-all-clear">
              ✓ No major intelligence
              gaps detected.
            </div>
          )}
        </div>
      </section>

      <section className="oc-grid">
        <div className="oc-panel">
          <div className="oc-card-label">
            DEAL SIGNALS
          </div>

          <h2>
            Intelligence profile
          </h2>

          <div className="oc-signals">
            <Signal
              label="Fit"
              value={
                scoreData?.fit
              }
            />

            <Signal
              label="Data quality"
              value={
                scoreData?.data_quality
              }
            />

            <Signal
              label="Commercial potential"
              value={
                scoreData?.commercial_potential
              }
            />

            <Signal
              label="Engagement"
              value={
                scoreData?.engagement
              }
            />

            <Signal
              label="Momentum"
              value={
                scoreData?.momentum
              }
            />

            <Signal
              label="Stale risk"
              value={
                scoreData?.stale_risk
              }
              danger
            />
          </div>
        </div>

        <div className="oc-panel">
          <div className="oc-card-label">
            DEAL SNAPSHOT
          </div>

          <h2>
            Current state
          </h2>

          <div className="oc-snapshot">
            <div>
              <span>Stage</span>
              <strong>
                {currentOpportunity.stage ||
                  "Unknown"}
              </strong>
            </div>

            <div>
              <span>Value</span>
              <strong>
                {money(
                  currentOpportunity.value
                )}
              </strong>
            </div>

            <div>
              <span>Weighted value</span>
              <strong>
                {money(
                  currentOpportunity.weighted_value
                )}
              </strong>
            </div>

            <div>
              <span>Open tasks</span>
              <strong data-testid="open-task-count">
                {tasks?.open || 0}
              </strong>
            </div>

            <div>
              <span>Activities</span>
              <strong data-testid="activity-count">
                {activity?.count ||
                  0}
              </strong>
            </div>

            <div>
              <span>Latest activity</span>
              <strong>
                {activity?.days_since_latest ===
                null
                  ? "None"
                  : `${Math.round(
                      activity?.days_since_latest ||
                        0
                    )}d ago`}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="oc-panel">
        <div className="oc-card-label">
          RISK CENTRE
        </div>

        <h2>
          What could hold this deal back?
        </h2>

        {!risks.length ? (
          <div className="oc-all-clear">
            ✓ No material risks detected.
          </div>
        ) : (
          <div className="oc-risks">
            {risks.map(
              (risk, index) => (
                <div
                  className={`oc-risk ${String(
                    risk.severity ||
                      ""
                  ).toLowerCase()}`}
                  key={
                    `${risk.type}-${index}`
                  }
                >
                  <div className="oc-risk-severity">
                    {risk.severity}
                  </div>

                  <div className="oc-risk-content">
                    <strong>
                      {risk.title}
                    </strong>

                    <span>
                      {risk.reason}
                    </span>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </section>

      <section className="oc-grid">
        <div className="oc-panel">
          <div className="oc-card-label">
            EVIDENCE
          </div>

          <h2>
            What the system actually
            knows
          </h2>

          <div className="oc-evidence-columns">
            <div>
              <h3>KNOWN</h3>

              {(
                evidence?.known ||
                []
              ).map(item => (
                <div
                  className="oc-evidence known"
                  key={item}
                >
                  <span>✓</span>
                  {item}
                </div>
              ))}
            </div>

            <div>
              <h3>UNKNOWN</h3>

              {(
                evidence?.unknown ||
                []
              ).map(item => (
                <div
                  className="oc-evidence unknown"
                  key={item}
                >
                  <span>?</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="oc-panel">
          <div className="oc-card-label">
            RESOLVED CONTEXT
          </div>

          <h2>
            Prospect intelligence
          </h2>

          <div className="oc-context">
            <div>
              <span>Business</span>
              <strong>
                {resolved?.business_name ||
                  "Unknown"}
              </strong>
            </div>

            <div>
              <span>Service</span>
              <strong>
                {resolved?.service ||
                  "Unknown"}
              </strong>
            </div>

            <div>
              <span>Location</span>
              <strong>
                {resolved?.location ||
                  "Unknown"}
              </strong>
            </div>

            <div>
              <span>Contact</span>
              <strong>
                {resolved?.contact_name ||
                  "Unknown"}
              </strong>
            </div>

            <div>
              <span>Website</span>
              <strong>
                {resolved?.website ||
                  "Unknown"}
              </strong>
            </div>

            <div>
              <span>Data source</span>
              <strong>
                {resolved?.source ||
                  "Unknown"}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="oc-panel">
        <div className="oc-card-label">
          ACTIVITY
        </div>

        <h2>
          Recent opportunity activity
        </h2>

        {activity?.latest ? (
          <div className="oc-activity-item">
            <div className="oc-activity-dot" />

            <div>
              <strong>
                {activity.latest.type ||
                  activity.latest.title ||
                  "Activity"}
              </strong>

              <span>
                {activity.latest.created_at
                  ? new Date(
                      activity.latest.created_at
                    ).toLocaleString(
                      "en-AU"
                    )
                  : "Date unknown"}
              </span>
            </div>
          </div>
        ) : (
          <div className="oc-empty">
            No activity recorded.
          </div>
        )}
      </section>

      <section className="oc-panel">
        <div className="oc-card-label">
          TASKS
        </div>

        <h2>Execution</h2>

        <div className="oc-task-summary">
          <div>
            <strong>
              {tasks?.count || 0}
            </strong>
            <span>
              Total tasks
            </span>
          </div>

          <div>
            <strong>
              {tasks?.open || 0}
            </strong>
            <span>
              Open tasks
            </span>
          </div>

          <div>
            <strong>
              {tasks?.count
                ? tasks.count -
                  tasks.open
                : 0}
            </strong>
            <span>
              Completed
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
