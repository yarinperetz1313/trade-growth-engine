import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  detectStalledOpportunity,
  getOpportunityRevenueLeakCases,
  linkRevenueLeakCaseToAction,
  transitionRevenueLeakCase
} from "../lib/api";
import {
  allowedRevenueLeakCaseActions,
  classifyRevenueLeakCaseError,
  detectorOutcomePresentation,
  detectorReasonExplanation,
  formatPotentialRevenueAtRisk
} from "../lib/revenueLeakCaseContracts.mjs";

const DAY_MS = 86400000;

function readableDate(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "Invalid recorded timestamp"
    : parsed.toLocaleString("en-AU");
}

function errorCopy(error) {
  const kind = classifyRevenueLeakCaseError(error);
  if (kind === "UNAUTHORIZED") {
    return {
      kind,
      title: "Revenue leak review unauthorized",
      message: "You are not authorized to review revenue leak cases for this opportunity."
    };
  }
  if (kind === "PERSISTENCE") {
    return {
      kind,
      title: "Revenue leak case persistence unavailable",
      message: "No empty or no-leak conclusion was inferred. Retry when durable case state is available."
    };
  }
  return {
    kind,
    title: "Revenue leak review unavailable",
    message: error?.message || "The revenue leak request could not be completed."
  };
}

function replaceCase(history, nextCase) {
  const remaining = history.filter(item => item.id !== nextCase.id);
  return [nextCase, ...remaining].sort((left, right) =>
    String(right.detected_at || "").localeCompare(String(left.detected_at || ""))
      || String(left.id).localeCompare(String(right.id))
  );
}

function EvidenceDetails({ source, evidence, evidenceClassification, evidenceState }) {
  if (!evidence) {
    const message = evidenceState === "STALE"
      ? "Evidence unavailable / stale — the canonical source cannot authorize a case."
      : evidenceState === "SUPPRESSED"
        ? "Evidence unavailable / suppressed — Data Health blocked case creation."
        : "Evidence unavailable — the detector could not establish the minimum canonical facts.";
    return <div className="rlc-evidence-empty">{message}</div>;
  }

  const baseline = evidence.activity_baseline;
  const nextAction = evidence.next_action;
  const freshness = evidence.source_freshness;
  const criteria = evidence.criteria;
  const commercialBasis = evidence.commercial_value_basis;
  const activeTaskIds = Array.isArray(nextAction?.active_task_ids)
    ? nextAction.active_task_ids
    : [];

  return (
    <div className="rlc-evidence" data-testid="revenue-leak-evidence">
      <div>
        <span>Evidence classification</span>
        <strong>{evidenceClassification || "Detector evaluation"}</strong>
      </div>
      <div>
        <span>Opportunity stage</span>
        <strong>{evidence.opportunity_stage || "Not recorded"}</strong>
      </div>
      <div>
        <span>Meaningful activity baseline</span>
        <strong>
          {baseline
            ? `${baseline.kind} · ${readableDate(baseline.at)}`
            : "Not recorded"}
        </strong>
      </div>
      <div>
        <span>Stalled since</span>
        <strong>{readableDate(evidence.stalled_since)}</strong>
      </div>
      <div>
        <span>Next action evidence</span>
        <strong>
          {nextAction
            ? `${nextAction.present === true ? "Present" : "Absent"} · ${nextAction.source}`
            : "Not recorded"}
        </strong>
        {typeof nextAction?.opportunity_value === "string" && (
          <small>{nextAction.opportunity_value}</small>
        )}
        {activeTaskIds.length > 0 && (
          <small>Active tasks: {activeTaskIds.join(", ")}</small>
        )}
      </div>
      <div>
        <span>Detector thresholds</span>
        <strong>
          {criteria
            ? `${criteria.stale_after_days}d stalled · ${criteria.source_freshness_days}d source freshness`
            : "Not recorded"}
        </strong>
      </div>
      <div>
        <span>Source observed</span>
        <strong>{readableDate(source?.observed_at || freshness?.observed_at)}</strong>
      </div>
      <div>
        <span>Source version</span>
        <strong className="rlc-version">{source?.observed_version || "Not recorded"}</strong>
      </div>
      <div>
        <span>Commercial evidence</span>
        <strong>{commercialBasis?.classification || "Not recorded"}</strong>
        {commercialBasis?.reason && <small>{commercialBasis.reason}</small>}
      </div>
    </div>
  );
}

function PotentialValue({ value }) {
  const display = formatPotentialRevenueAtRisk(value);
  return (
    <div className="rlc-value" data-testid="potential-revenue-at-risk">
      <span>{display.label}</span>
      <strong>{display.value}</strong>
      <small>{display.detail}</small>
    </div>
  );
}

function AuditHistory({ audit = [] }) {
  return (
    <div className="rlc-audit" data-testid="revenue-leak-audit">
      <h4>Auditable lifecycle</h4>
      {audit.map((entry, index) => (
        <div className="rlc-audit-entry" key={`${entry.transition}-${entry.at}-${index}`}>
          <strong>{entry.transition}</strong>
          <span>{readableDate(entry.at)}</span>
          {entry.reason && <span>Reason: {entry.reason}</span>}
          {entry.reason_code && <span>Reason code: {entry.reason_code}</span>}
          {entry.wake_at && <span>Wake time: {readableDate(entry.wake_at)}</span>}
          {entry.revenue_action_id && (
            <span>
              RevenueAction: {entry.revenue_action_id}
              {entry.revenue_action_status ? ` · ${entry.revenue_action_status}` : ""}
            </span>
          )}
          {entry.subject_id && <span>Actor: {entry.subject_id}</span>}
        </div>
      ))}
    </div>
  );
}

export default function RevenueLeakCasePanel({ opportunityId, revenueActions = [] }) {
  const [history, setHistory] = useState([]);
  const [historyState, setHistoryState] = useState("LOADING");
  const [historyError, setHistoryError] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [detectionError, setDetectionError] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [mutation, setMutation] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [mutationMessage, setMutationMessage] = useState(null);
  const [snoozeReason, setSnoozeReason] = useState("");
  const [resumeReason, setResumeReason] = useState("");
  const [dismissReason, setDismissReason] = useState("");
  const [snoozeDays, setSnoozeDays] = useState("7");
  const opportunityGeneration = useRef(0);
  const historyRequest = useRef(0);

  async function loadHistory(generation = opportunityGeneration.current) {
    const requestId = ++historyRequest.current;
    setHistoryState("LOADING");
    setHistoryError(null);
    try {
      const result = await getOpportunityRevenueLeakCases(opportunityId);
      if (
        generation !== opportunityGeneration.current
        || requestId !== historyRequest.current
      ) return;
      const cases = Array.isArray(result?.data) ? result.data : [];
      setHistory(cases);
      setSelectedCaseId(current => {
        if (cases.some(item => item.id === current)) return current;
        return cases.find(item => ["OPEN", "SNOOZED"].includes(item.state))?.id
          || cases[0]?.id
          || null;
      });
      setHistoryState("READY");
    } catch (error) {
      if (
        generation !== opportunityGeneration.current
        || requestId !== historyRequest.current
      ) return;
      setHistoryError(errorCopy(error));
      setHistoryState("ERROR");
    }
  }

  useEffect(() => {
    const generation = ++opportunityGeneration.current;
    setHistory([]);
    setEvaluation(null);
    setSelectedCaseId(null);
    setDetectionError(null);
    setMutationError(null);
    setMutationMessage(null);
    loadHistory(generation);
    return () => {
      opportunityGeneration.current += 1;
      historyRequest.current += 1;
    };
  }, [opportunityId]);

  const selectedCase = useMemo(() =>
    history.find(item => item.id === selectedCaseId)
      || evaluation?.case
      || history[0]
      || null,
  [evaluation, history, selectedCaseId]);

  const allowedActions = new Set(
    allowedRevenueLeakCaseActions(selectedCase?.state)
  );
  const activeRevenueAction = [...revenueActions]
    .filter(action =>
      action.opportunity_id === opportunityId
      && ["RECOMMENDED", "PREPARED", "APPROVED", "EXECUTING", "FAILED"].includes(action.status)
    )
    .sort((left, right) =>
      String(right.updated_at || right.created_at || "").localeCompare(
        String(left.updated_at || left.created_at || "")
      ) || String(right.id).localeCompare(String(left.id))
    )[0] || null;
  const wakeAt = useMemo(() => new Date(
    Date.now() + Number(snoozeDays) * DAY_MS
  ).toISOString(), [snoozeDays]);

  async function runDetection() {
    const generation = opportunityGeneration.current;
    setDetecting(true);
    setEvaluation(null);
    setDetectionError(null);
    setMutationMessage(null);
    try {
      const result = await detectStalledOpportunity(opportunityId);
      if (generation !== opportunityGeneration.current) return;
      setEvaluation(result);
      if (result.case) {
        setHistory(current => replaceCase(current, result.case));
        setSelectedCaseId(result.case.id);
      }
      await loadHistory(generation);
    } catch (error) {
      if (generation !== opportunityGeneration.current) return;
      setDetectionError(errorCopy(error));
    } finally {
      if (generation === opportunityGeneration.current) setDetecting(false);
    }
  }

  async function runTransition(transition, body, successMessage) {
    if (!selectedCase) return;
    const generation = opportunityGeneration.current;
    setMutation(transition);
    setMutationError(null);
    setMutationMessage(null);
    try {
      const result = await transitionRevenueLeakCase(
        selectedCase.id,
        transition,
        body,
        opportunityId
      );
      if (generation !== opportunityGeneration.current) return;
      setHistory(current => replaceCase(current, result.data));
      setSelectedCaseId(result.data.id);
      setMutationMessage(successMessage);
      if (transition === "snooze") setSnoozeReason("");
      if (transition === "resume") setResumeReason("");
      if (transition === "dismiss") setDismissReason("");
      await loadHistory(generation);
    } catch (error) {
      if (generation !== opportunityGeneration.current) return;
      setMutationError(errorCopy(error));
    } finally {
      if (generation === opportunityGeneration.current) setMutation(null);
    }
  }

  async function linkExistingRevenueAction() {
    if (!selectedCase || !activeRevenueAction) return;
    const generation = opportunityGeneration.current;
    setMutation("link");
    setMutationError(null);
    setMutationMessage(null);
    try {
      const result = await linkRevenueLeakCaseToAction(
        selectedCase.id,
        activeRevenueAction.id,
        opportunityId
      );
      if (generation !== opportunityGeneration.current) return;
      setHistory(current => replaceCase(current, result.data));
      setSelectedCaseId(result.data.id);
      setMutationMessage(
        result.duplicate
          ? "This RevenueAction was already linked."
          : "Existing RevenueAction linked without changing its lifecycle."
      );
      await loadHistory(generation);
    } catch (error) {
      if (generation !== opportunityGeneration.current) return;
      setMutationError(errorCopy(error));
    } finally {
      if (generation === opportunityGeneration.current) setMutation(null);
    }
  }

  function goToRevenueActionWorkflow() {
    const target = document.getElementById("revenue-action-workflow");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  }

  const evaluationPresentation = evaluation
    ? detectorOutcomePresentation(evaluation.outcome, evaluation.reason_code)
    : null;
  const selectedEvidence = selectedCase?.evidence_snapshot?.facts;
  const selectedSource = selectedCase ? {
    observed_at: selectedCase.source_observed_at,
    observed_version: selectedCase.source_observed_version
  } : null;
  const blockedByAuth = historyError?.kind === "UNAUTHORIZED";

  return (
    <section className="oc-panel rlc-panel" data-testid="revenue-leak-case-panel">
      <div className="rlc-heading">
        <div>
          <div className="oc-card-label">REVENUE LEAK REVIEW</div>
          <h2>Check this opportunity for a credible stall</h2>
          <p className="oc-section-description">
            Run the versioned detector explicitly. TGE will use only recorded canonical
            opportunity, activity, and task evidence.
          </p>
        </div>
        <button
          className="oc-primary-button"
          data-testid="detect-stalled-opportunity"
          disabled={detecting || Boolean(mutation) || blockedByAuth}
          onClick={runDetection}
        >
          {detecting ? "Checking…" : "Check for stalled opportunity"}
        </button>
      </div>

      {historyState === "LOADING" && history.length === 0 && (
        <div className="rlc-state" role="status">Loading durable revenue leak history…</div>
      )}

      {historyError && (
        <div className="oc-error rlc-error" role="alert">
          <strong>{historyError.title}</strong>
          <span>{historyError.message}</span>
          {!blockedByAuth && (
            <button className="oc-secondary-button" onClick={() => loadHistory()}>
              Retry history
            </button>
          )}
        </div>
      )}

      {detectionError && (
        <div className="oc-error rlc-error" role="alert">
          <strong>{detectionError.title}</strong>
          <span>{detectionError.message}</span>
        </div>
      )}

      {evaluation && evaluationPresentation && (
        <div
          className={`rlc-outcome ${evaluationPresentation.evidenceState.toLowerCase()}`}
          data-testid="revenue-leak-detector-outcome"
          role="status"
        >
          <span>{evaluation.outcome}</span>
          <h3>{evaluationPresentation.title}</h3>
          <code>{evaluation.reason_code}</code>
          <p>{evaluationPresentation.explanation}</p>
          <div className="rlc-source-summary">
            <span>
              Detector {evaluation.detector?.id || "unavailable"}
              {evaluation.detector?.version
                ? ` · version ${evaluation.detector.version}`
                : ""}
            </span>
          </div>
          <PotentialValue value={evaluation.commercial_value} />
          <EvidenceDetails
            source={evaluation.source}
            evidence={evaluation.evidence}
            evidenceState={evaluationPresentation.evidenceState}
          />
        </div>
      )}

      {mutationMessage && (
        <div
          className="oc-success-banner"
          data-testid="revenue-leak-success"
          role="status"
        >
          ✓ {mutationMessage}
        </div>
      )}

      {mutationError && (
        <div className="oc-error rlc-error" role="alert">
          <strong>{mutationError.title}</strong>
          <span>{mutationError.message}</span>
        </div>
      )}

      {historyState === "READY" && history.length === 0 && !evaluation?.case && (
        <div className="rlc-state" data-testid="revenue-leak-empty-history">
          No durable revenue leak cases are recorded for this opportunity. No detector
          conclusion has been inferred.
        </div>
      )}

      {history.length > 0 && (
        <div className="rlc-history" data-testid="revenue-leak-history">
          <h3>Durable case history</h3>
          <div className="rlc-history-list">
            {history.map(item => {
              const valueDisplay = formatPotentialRevenueAtRisk(item.commercial_value);
              return (
                <button
                  type="button"
                  className={item.id === selectedCase?.id ? "selected" : ""}
                  key={item.id}
                  onClick={() => setSelectedCaseId(item.id)}
                  aria-pressed={item.id === selectedCase?.id}
                >
                  <span className={`rlc-status ${item.state.toLowerCase()}`}>{item.state}</span>
                  <strong>{item.reason_code}</strong>
                  <small>Case {item.id}</small>
                  <small>{readableDate(item.detected_at)}</small>
                  <small>{valueDisplay.value} · {valueDisplay.detail}</small>
                  {item.superseded_by_case_id && (
                    <small>Superseded by: {item.superseded_by_case_id}</small>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedCase && (
        <article className="rlc-case-detail" data-testid="revenue-leak-case-detail">
          <div className="rlc-case-title">
            <div>
              <span className={`rlc-status ${selectedCase.state.toLowerCase()}`}>
                {selectedCase.state}
              </span>
              <h3>Why TGE surfaced this</h3>
              <code>{selectedCase.reason_code}</code>
              <p>{detectorReasonExplanation(selectedCase.reason_code)}</p>
            </div>
            <PotentialValue value={selectedCase.commercial_value} />
          </div>

          <div className="rlc-source-summary">
            <span>Detector {selectedCase.detector_id} · version {selectedCase.detector_version}</span>
            <span>Detected {readableDate(selectedCase.detected_at)}</span>
            {selectedCase.supersedes_case_id && (
              <span>Supersedes case {selectedCase.supersedes_case_id}</span>
            )}
          </div>

          <EvidenceDetails
            source={selectedSource}
            evidence={selectedEvidence}
            evidenceClassification={selectedCase.evidence_classification}
            evidenceState="AVAILABLE"
          />

          <div className="rlc-action-link">
            <div>
              <h4>Existing RevenueAction workflow</h4>
              <p>
                RevenueAction remains the sole execution boundary. Nothing is sent by TGE
                from this case review.
              </p>
              {selectedCase.revenue_action_id && (
                <span data-testid="linked-revenue-action">
                  Linked RevenueAction {selectedCase.revenue_action_id} · status at link {selectedCase.revenue_action_status_at_link}
                </span>
              )}
            </div>
            <div className="rlc-button-row">
              <button className="oc-secondary-button" onClick={goToRevenueActionWorkflow}>
                Go to RevenueAction workflow
              </button>
              {allowedActions.has("LINK_REVENUE_ACTION")
                && !selectedCase.revenue_action_id
                && activeRevenueAction && (
                <button
                  className="oc-secondary-button"
                  data-testid="link-revenue-action-to-case"
                  disabled={Boolean(mutation)}
                  onClick={linkExistingRevenueAction}
                >
                  {mutation === "link" ? "Linking…" : "Link existing RevenueAction"}
                </button>
              )}
            </div>
          </div>

          {allowedActions.size > 0 && (
            <div className="rlc-lifecycle" data-testid="revenue-leak-lifecycle-controls">
              <h4>Human decision</h4>
              {allowedActions.has("SNOOZE") && (
                <div className="rlc-control">
                  <label htmlFor="revenue-leak-snooze-reason">Reason to snooze</label>
                  <input
                    id="revenue-leak-snooze-reason"
                    value={snoozeReason}
                    maxLength={512}
                    disabled={Boolean(mutation)}
                    onChange={event => setSnoozeReason(event.target.value)}
                  />
                  <label htmlFor="revenue-leak-snooze-duration">Future wake time</label>
                  <select
                    id="revenue-leak-snooze-duration"
                    value={snoozeDays}
                    disabled={Boolean(mutation)}
                    onChange={event => setSnoozeDays(event.target.value)}
                  >
                    <option value="1">In 1 day</option>
                    <option value="3">In 3 days</option>
                    <option value="7">In 7 days</option>
                    <option value="14">In 14 days</option>
                  </select>
                  <small>Wake time: {readableDate(wakeAt)}</small>
                  <button
                    className="oc-secondary-button"
                    disabled={!snoozeReason.trim() || Boolean(mutation)}
                    onClick={() => runTransition(
                      "snooze",
                      {
                        reason: snoozeReason.trim(),
                        wake_at: new Date(
                          Date.now() + Number(snoozeDays) * DAY_MS
                        ).toISOString()
                      },
                      "Case snoozed with a recorded human reason and wake time."
                    )}
                  >
                    {mutation === "snooze" ? "Snoozing…" : "Snooze case"}
                  </button>
                </div>
              )}

              {allowedActions.has("RESUME") && (
                <div className="rlc-control">
                  <label htmlFor="revenue-leak-resume-reason">Reason to resume</label>
                  <input
                    id="revenue-leak-resume-reason"
                    value={resumeReason}
                    maxLength={512}
                    disabled={Boolean(mutation)}
                    onChange={event => setResumeReason(event.target.value)}
                  />
                  <button
                    className="oc-secondary-button"
                    disabled={!resumeReason.trim() || Boolean(mutation)}
                    onClick={() => runTransition(
                      "resume",
                      { reason: resumeReason.trim() },
                      "Case resumed with a recorded human reason."
                    )}
                  >
                    {mutation === "resume" ? "Resuming…" : "Resume case"}
                  </button>
                </div>
              )}

              {allowedActions.has("DISMISS") && (
                <div className="rlc-control">
                  <label htmlFor="revenue-leak-dismiss-reason">Reason to dismiss</label>
                  <input
                    id="revenue-leak-dismiss-reason"
                    value={dismissReason}
                    maxLength={512}
                    disabled={Boolean(mutation)}
                    onChange={event => setDismissReason(event.target.value)}
                  />
                  <button
                    className="oc-secondary-button"
                    disabled={!dismissReason.trim() || Boolean(mutation)}
                    onClick={() => runTransition(
                      "dismiss",
                      { reason: dismissReason.trim() },
                      "Case dismissed with a recorded human reason."
                    )}
                  >
                    {mutation === "dismiss" ? "Dismissing…" : "Dismiss case"}
                  </button>
                </div>
              )}
            </div>
          )}

          <AuditHistory audit={selectedCase.audit} />
        </article>
      )}
    </section>
  );
}
