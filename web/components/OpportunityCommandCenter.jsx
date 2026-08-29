import React, { useEffect, useMemo, useState } from "react";
import {
  getOpportunityIntelligence,
  runOpportunityIntelligenceAction
} from "../lib/api";

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

      if (hasStaleRisk) {
        actions.push({
          key: "followup",
          title:
            "Create follow-up",
          description:
            "Activity signals indicate this opportunity may require follow-up.",
          type: "followup"
        });
      }

      if (
        nextAction?.taskTitle
      ) {
        actions.push({
          key: "task",
          title:
            nextAction.taskTitle,
          description:
            nextAction.reason ||
            "Recommended next action from Deal Intelligence.",
          type: "task"
        });
      }

      return actions;
    }, [
      hasContact,
      hasValue,
      hasStaleRisk,
      nextAction
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
          ) : nextAction?.taskTitle ? (
            <button
              className="oc-primary-button"
              data-testid="create-intelligence-task"
              disabled={
                actionLoading ===
                "task"
              }
              onClick={() =>
                performAction(
                  "task",
                  "task",
                  {
                    title:
                      nextAction.taskTitle,
                    priority:
                      nextAction.priority ||
                      "MEDIUM",
                    actionType:
                      nextAction.type
                  }
                )
              }
            >
              {actionLoading ===
              "task"
                ? "Creating…"
                : "Create Task"}
            </button>
          ) : null}
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

          {hasStaleRisk && (
            <ActionCard
              title="Create follow-up"
              description="Create a high-priority follow-up task for this opportunity."
            >
              <button
                className="oc-secondary-button"
                disabled={
                  actionLoading ===
                  "followup"
                }
                onClick={() =>
                  performAction(
                    "followup",
                    "follow-up",
                    {
                      title:
                        `Follow up — ${
                          resolved?.business_name ||
                          "opportunity"
                        }`,
                      priority:
                        "HIGH"
                    }
                  )
                }
              >
                {actionLoading ===
                "followup"
                  ? "Creating…"
                  : "Create Follow-up"}
              </button>
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
