import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRevenueActionForLeakCase,
  getPilotEvidenceStatus,
  getRevenueLeakOperatingQueue,
  recordPilotCaseFeedback,
  recordPilotCaseInspected,
  recordPilotCaseSurfaced,
  scanStalledOpportunities
} from "../lib/api";
import {
  formatCommercialValue,
  formatCommercialValueSummary
} from "../lib/commercialValue";
import {
  classifyRevenueLeakOperatingQueueError,
  detectorOutcomePresentation,
  detectorReasonExplanation,
  filterRevenueLeakOperatingQueue,
  formatPotentialRevenueAggregate,
  formatPotentialRevenueAtRisk,
  isAmbiguousRevenueLeakCaseMutationError
} from "../lib/revenueLeakCaseContracts.mjs";
import {
  createPilotEvidenceOperationGuard,
  requiresPilotEvidenceReconciliation
} from "../lib/pilotEvidenceContracts.mjs";
import { EvidenceDetails } from "./RevenueLeakCasePanel.jsx";

function countLabel(summary) {
  if (!summary) return "No recorded values";
  return `${summary.known_count} known · ${summary.unknown_count} unknown`;
}

function summaryMoney(summary) {
  return formatCommercialValueSummary(summary);
}

function queueErrorCopy(error) {
  const kind = classifyRevenueLeakOperatingQueueError(error);
  if (kind === "UNAUTHORIZED") return {
    kind,
    title: "Revenue operating queue unauthorized",
    message: "You are not authorized to review this tenant's revenue operating queue."
  };
  if (kind === "LIMIT") return {
    kind,
    title: "Revenue operating queue limit reached",
    message: "The queue exceeds the safe 100-case limit. No partial queue is shown."
  };
  if (kind === "INTEGRITY") return {
    kind,
    title: "Revenue operating queue integrity conflict",
    message: "The server returned an integrity conflict. No completeness was inferred."
  };
  if (kind === "PERSISTENCE") return {
    kind,
    title: "Revenue operating queue persistence unavailable",
    message: "Durable queue truth is unavailable. No empty-queue conclusion was inferred."
  };
  return {
    kind,
    title: "Revenue operating queue unavailable",
    message: error?.message || "The revenue operating queue could not be loaded."
  };
}

function actionStateCopy(status) {
  if (status === "PREPARED") return "Action prepared · approval required";
  if (status === "RECOMMENDED") return "RECOMMENDED · approval required";
  if (status === "APPROVED") return "APPROVED · human approval recorded";
  if (status === null) return "Current action state unavailable";
  return status;
}

function ageCopy(age) {
  if (!age || !Number.isSafeInteger(age.elapsed_days)) return "Leak age unavailable";
  return age.elapsed_days === 1
    ? "1 day since detection"
    : `${age.elapsed_days} days since detection`;
}

function identityCopy(entry) {
  return entry.business?.name
    || entry.opportunity?.business_name
    || "Business identity unavailable";
}

const SCAN_OUTCOMES = [
  "ELIGIBLE_LEAK_DETECTED",
  "ELIGIBLE_NO_LEAK",
  "INSUFFICIENT_EVIDENCE",
  "STALE_OR_UNTRUSTWORTHY_SOURCE",
  "DATA_HEALTH_SUPPRESSED"
];
const FEEDBACK_OPTIONS = [
  ["USEFUL", "Useful"],
  ["WRONG", "Wrong"],
  ["ALREADY_HANDLED", "Already handled"],
  ["MISSING_CONTEXT", "Missing context"],
  ["NOT_WORTH_PURSUING", "Not worth pursuing"]
];

function dataOriginCopy(origin) {
  if (origin === "IMPORTED_CUSTOMER") return "Imported customer";
  if (origin === "SAMPLE_DEMO") {
    return "Sample / demo — excluded from first-value evidence";
  }
  return "Existing customer";
}

function ScanSummary({ summary }) {
  const detected = summary.outcomes.ELIGIBLE_LEAK_DETECTED.count;
  return (
    <section className="rcc2-scan-summary" role="status" aria-label="Complete explicit scan outcomes">
      <div className="rcc2-scan-heading">
        <strong>Complete explicit scan</strong>
        <span>Evaluated {summary.evaluated_count}</span>
        <span>Excluded {summary.excluded_count}</span>
        <span>Unevaluated {summary.unevaluated_count}</span>
      </div>
      {summary.evaluated_count === 0 && (
        <p>No canonical opportunities were available. Import or create opportunity evidence, then explicitly scan again.</p>
      )}
      {summary.evaluated_count > 0 && detected === 0 && (
        <p>No eligible stalled-opportunity leak was detected. Review every closed outcome below before deciding whether to improve evidence or scan again.</p>
      )}
      <div className="rcc2-scan-outcomes">
        {SCAN_OUTCOMES.map(outcome => {
          const result = summary.outcomes[outcome];
          const title = detectorOutcomePresentation(outcome, null).title;
          const reasons = Object.entries(result.reasons);
          return (
            <article key={outcome}>
              <strong>{title}</strong>
              <span>{result.count}</span>
              {reasons.length === 0 ? (
                <small>No closed reasons returned.</small>
              ) : (
                <ul>
                  {reasons.map(([reason, count]) => (
                    <li key={reason}>
                      <code>{reason}</code> · {count} — {detectorReasonExplanation(reason)}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
      <small>
        Suppressed {summary.outcomes.DATA_HEALTH_SUPPRESSED.count}. Detector thresholds and queue order are unchanged.
      </small>
    </section>
  );
}

function PilotJourney({ status }) {
  if (!status?.milestones.import_committed) return null;
  const milestones = [
    ["Import committed", status.milestones.import_committed],
    ["Explicit scan complete", status.milestones.portfolio_scan_completed],
    ["First credible case surfaced", status.milestones.first_credible_case_surfaced],
    ["Case inspected", status.milestones.case_inspected],
    ["RevenueAction linked", status.milestones.revenue_action_materialized_linked],
    ["Action approved", status.milestones.action_approved],
    ["Action executed", status.milestones.action_executed]
  ];
  return (
    <section className="rcc2-pilot-journey" aria-label="First-value pilot journey">
      <div>
        <span className="eyebrow">FIRST-VALUE JOURNEY</span>
        <strong>Privacy-minimized durable milestones</strong>
      </div>
      <ol>
        {milestones.map(([label, complete]) => (
          <li className={complete ? "complete" : "pending"} key={label}>
            <span aria-hidden="true">{complete ? "✓" : "○"}</span>{label}
          </li>
        ))}
      </ol>
    </section>
  );
}

function QueueSummary({ summary }) {
  const totals = summary?.known_positive?.totals_by_currency || [];
  return (
    <div className="rcc2-summary" aria-label="Potential revenue at risk summary">
      <div className="rcc2-summary-card rcc2-summary-money" aria-label="Known potential revenue at risk summary">
        <span>Known potential revenue at risk</span>
        {totals.length === 0 ? (
          <strong>No known positive totals</strong>
        ) : totals.map(total => (
          <strong key={total.currency}>
            {formatPotentialRevenueAggregate(total).value}
            <small>{total.case_count} {total.case_count === 1 ? "case" : "cases"}</small>
          </strong>
        ))}
        <small>No cross-currency total is calculated.</small>
      </div>
      <div className="rcc2-summary-card" aria-label="Known zero summary">
        <span>Known zero</span>
        <strong>{summary?.known_zero?.case_count || 0}</strong>
        <small>Recorded zero with authoritative currency</small>
      </div>
      <div className="rcc2-summary-card" aria-label="Unknown value summary">
        <span>Unknown value</span>
        <strong>{summary?.unknown?.case_count || 0}</strong>
        <small>Unknown is not $0</small>
      </div>
      <div className="rcc2-summary-card" aria-label="Not applicable summary">
        <span>Not applicable</span>
        <strong>{summary?.not_applicable?.case_count || 0}</strong>
        <small>Excluded from monetary totals</small>
      </div>
    </div>
  );
}

function QueueCase({
  entry,
  expanded,
  disabled,
  mutating,
  firstImported,
  inspected,
  feedback,
  feedbackCode,
  onToggle,
  onCreateAction,
  onOpenOpportunity,
  onFeedbackCode,
  onSubmitFeedback,
  onRetryInspection,
  pilotDisabled,
  retryInspection
}) {
  const businessName = identityCopy(entry);
  const potential = formatPotentialRevenueAtRisk(entry.potential_value);
  const linkedAction = entry.linked_revenue_action;
  const canNavigate = Boolean(entry.opportunity?.id);
  return (
    <article className="rcc2-case" data-case-id={entry.case.id}>
      <button
        type="button"
        className="rcc2-case-toggle"
        aria-expanded={expanded}
        aria-controls={`rcc2-detail-${entry.case.id}`}
        onClick={onToggle}
      >
          <span className="rcc2-case-identity">
            <span className={`rcc2-urgency ${entry.urgency.classification.toLowerCase()}`}>
              {entry.urgency.classification.replaceAll("_", " ")}
            </span>
            <span className={`rcc2-origin ${entry.data_origin.toLowerCase()}`}>
              {dataOriginCopy(entry.data_origin)}
            </span>
            {firstImported && (
              <span className="rcc2-first-value">First credible imported-customer case</span>
            )}
          <strong>{businessName}</strong>
          <small>
            {canNavigate ? "Opportunity" : "Historical opportunity"}{" "}
            {entry.historical_opportunity_id} · Case {entry.case.id}
          </small>
        </span>
        <span className="rcc2-case-value">
          <span>Potential revenue at risk</span>
          <strong>{potential.value}</strong>
          <small>{potential.detail}</small>
        </span>
        <span className="rcc2-case-why">
          Why TGE surfaced this — {businessName}
        </span>
      </button>

      {expanded && (
        <div className="rcc2-case-detail" id={`rcc2-detail-${entry.case.id}`}>
          <div className="rcc2-detail-heading">
            <div>
              <h4>Why TGE surfaced this</h4>
              <code>{entry.case.reason_code}</code>
              <p>
                The recorded opportunity reached the stalled threshold without a
                meaningful next action.
              </p>
            </div>
            <dl>
              <div><dt>Lifecycle</dt><dd>{entry.case.lifecycle_state}</dd></div>
              <div><dt>Leak age</dt><dd>{ageCopy(entry.leak_age)}</dd></div>
              <div><dt>Source</dt><dd>{entry.case.source.system}</dd></div>
              <div><dt>Detector</dt><dd>{entry.case.detector.id} v{entry.case.detector.version}</dd></div>
            </dl>
          </div>
          <EvidenceDetails
            source={entry.case.source}
            evidence={entry.case.evidence_snapshot.facts}
            evidenceClassification={entry.case.evidence_classification}
            evidenceState="AVAILABLE"
          />
          {firstImported && (
            <section className="rcc2-pilot-feedback" aria-label="First-value case feedback">
              <div>
                <h5>First-value evidence</h5>
                <p>{inspected
                  ? "This exact imported-customer case inspection is recorded."
                  : "Recording this inspection is pending or unavailable."}</p>
              </div>
              {retryInspection && (
                <button
                  type="button"
                  className="oc-secondary-button"
                  disabled={pilotDisabled}
                  onClick={onRetryInspection}
                >
                  Retry inspection evidence
                </button>
              )}
              {feedback ? (
                <strong>Feedback recorded: {feedback.replaceAll("_", " ")}</strong>
              ) : (
                <div className="rcc2-feedback-controls">
                  <label>
                    <span>Bounded feedback</span>
                    <select
                      value={feedbackCode}
                      disabled={pilotDisabled || !inspected}
                      onChange={event => onFeedbackCode(event.target.value)}
                    >
                      <option value="">Choose one</option>
                      {FEEDBACK_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="oc-secondary-button"
                    disabled={pilotDisabled || !inspected || !feedbackCode}
                    onClick={onSubmitFeedback}
                  >
                    Record feedback
                  </button>
                </div>
              )}
            </section>
          )}
          <div className="rcc2-next-action">
            <div>
              <h5>What should I do?</h5>
              <p>
                {canNavigate
                  ? "Create one durable recovery action, then review and prepare it in Opportunity Command Center. Human approval required; nothing is sent from this portfolio view."
                  : "Current opportunity context unavailable. Recovery action and navigation are unavailable; the historical source identity remains visible for review."}
              </p>
              {linkedAction && (
                <strong data-testid={`rcc2-action-state-${entry.case.id}`}>
                  {actionStateCopy(linkedAction.current.status)}
                </strong>
              )}
            </div>
            <div className="rcc2-case-buttons">
              {!linkedAction && canNavigate && (
                <button
                  type="button"
                  className="oc-primary-button"
                  disabled={disabled}
                  onClick={() => onCreateAction(entry)}
                >
                  {mutating ? "Reconciling durable truth…" : "Create recovery action"}
                </button>
              )}
              {canNavigate && (
                <button
                  type="button"
                  className="oc-secondary-button"
                  disabled={disabled}
                  onClick={() => onOpenOpportunity(entry.opportunity.id)}
                >
                  {linkedAction
                    ? "Continue in Opportunity Command Center"
                    : "Open opportunity"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
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
  actionsUnavailable = false,
  onRefresh,
  onOpenOpportunity
}) {
  const [queue, setQueue] = useState(null);
  const [queueState, setQueueState] = useState("LOADING");
  const [queueError, setQueueError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [lifecycleFilter, setLifecycleFilter] = useState("ALL");
  const [valueFilter, setValueFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [scanState, setScanState] = useState(null);
  const [scanSummary, setScanSummary] = useState(null);
  const [mutationCaseId, setMutationCaseId] = useState(null);
  const [mutationMessage, setMutationMessage] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [reconciliationBlocked, setReconciliationBlocked] = useState(false);
  const [pilotStatus, setPilotStatus] = useState(null);
  const [pilotStatusState, setPilotStatusState] = useState("LOADING");
  const [pilotMessage, setPilotMessage] = useState(null);
  const [pilotError, setPilotError] = useState(null);
  const [pilotMutation, setPilotMutation] = useState(null);
  const [pilotReconciliationBlocked, setPilotReconciliationBlocked] = useState(false);
  const [pilotRetry, setPilotRetry] = useState(null);
  const [feedbackCode, setFeedbackCode] = useState("");
  const mounted = useRef(false);
  const queueRequest = useRef(0);
  const queueRef = useRef(null);
  const pilotStatusRequest = useRef(0);
  const pilotGuard = useRef(null);
  const surfacedAttempt = useRef(null);
  const inspectedAttempts = useRef(new Set());
  const ambiguousPilotAttempt = useRef(null);
  if (pilotGuard.current === null) {
    pilotGuard.current = createPilotEvidenceOperationGuard();
  }

  const loadPilotStatus = useCallback(async () => {
    const requestId = ++pilotStatusRequest.current;
    setPilotStatusState("LOADING");
    try {
      const status = await getPilotEvidenceStatus();
      if (!mounted.current || requestId !== pilotStatusRequest.current) return null;
      setPilotStatus(status);
      setPilotStatusState("READY");
      setPilotError(null);
      return status;
    } catch (statusError) {
      if (!mounted.current || requestId !== pilotStatusRequest.current) return null;
      setPilotStatusState("ERROR");
      setPilotError({
        title: "Pilot evidence status unavailable",
        message: statusError?.message || "Durable first-value evidence could not be loaded."
      });
      return null;
    }
  }, []);

  const loadQueue = useCallback(async () => {
    const requestId = ++queueRequest.current;
    if (!queueRef.current) setQueueState("LOADING");
    else setRefreshing(true);
    setQueueError(null);
    try {
      const response = await getRevenueLeakOperatingQueue();
      if (!mounted.current || requestId !== queueRequest.current) return null;
      queueRef.current = response.data;
      setQueue(response.data);
      setQueueState("READY");
      setReconciliationBlocked(false);
      setSelectedCaseId(current =>
        response.data.entries.some(entry => entry.case.id === current)
          ? current
          : null
      );
      return response.data;
    } catch (requestError) {
      if (!mounted.current || requestId !== queueRequest.current) return null;
      setQueueError(queueErrorCopy(requestError));
      setQueueState(queueRef.current ? "STALE" : "ERROR");
      return null;
    } finally {
      if (mounted.current && requestId === queueRequest.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadQueue();
    loadPilotStatus();
    return () => {
      mounted.current = false;
      queueRequest.current += 1;
      pilotStatusRequest.current += 1;
      pilotGuard.current.invalidate();
    };
  }, [loadPilotStatus, loadQueue]);

  const firstImportedCase = queue?.entries.find(entry =>
    entry.data_origin === "IMPORTED_CUSTOMER"
  ) || null;

  useEffect(() => {
    const caseId = firstImportedCase?.case.id;
    if (
      !caseId
      || pilotStatusState !== "READY"
      || !pilotStatus?.milestones.portfolio_scan_completed
      || pilotStatus?.surfaced_case_id !== null
      || surfacedAttempt.current === caseId
    ) return;
    surfacedAttempt.current = caseId;
    void runPilotObservation({
      kind: "surface",
      caseId,
      request: () => recordPilotCaseSurfaced(caseId)
    });
  }, [
    firstImportedCase?.case.id,
    pilotStatus?.milestones.portfolio_scan_completed,
    pilotStatus?.surfaced_case_id,
    pilotStatusState
  ]);

  const visibleEntries = useMemo(() => filterRevenueLeakOperatingQueue(
    queue?.entries || [],
    { lifecycle: lifecycleFilter, value: valueFilter, source: sourceFilter }
  ), [lifecycleFilter, queue, sourceFilter, valueFilter]);

  async function refreshQueue() {
    setMutationMessage(null);
    setMutationError(null);
    await Promise.all([loadQueue(), loadPilotStatus(), onRefresh?.()]);
  }

  function pilotObservationConfirmed(status, attempt) {
    if (attempt.kind === "surface") {
      return status?.surfaced_case_id === attempt.caseId;
    }
    if (attempt.kind === "inspect") {
      return status?.inspected_case_ids.includes(attempt.caseId);
    }
    return status?.case_feedback.some(item =>
      item.case_id === attempt.caseId
      && item.feedback_code === attempt.feedbackCode
    );
  }

  async function runPilotObservation(attempt) {
    const token = pilotGuard.current.begin(`${attempt.kind}:${attempt.caseId}`);
    if (!token || pilotReconciliationBlocked) return;
    setPilotMutation(attempt);
    setPilotMessage(null);
    setPilotError(null);
    setPilotRetry(null);
    try {
      await attempt.request();
      if (!mounted.current || !pilotGuard.current.isCurrent(token)) return;
      const durable = await loadPilotStatus();
      if (!pilotGuard.current.isCurrent(token)) return;
      if (durable && pilotObservationConfirmed(durable, attempt)) {
        setPilotMessage(attempt.kind === "feedback"
          ? "Bounded feedback recorded for this exact case."
          : attempt.kind === "inspect"
            ? "Exact imported-customer case inspection recorded."
            : "First credible imported-customer case surfaced.");
      } else {
        setPilotError({
          title: "Pilot evidence status needs refresh",
          message: "The mutation response was confirmed, but durable status could not yet confirm the exact identifier."
        });
      }
    } catch (observationError) {
      if (!mounted.current || !pilotGuard.current.isCurrent(token)) return;
      if (requiresPilotEvidenceReconciliation(observationError)) {
        ambiguousPilotAttempt.current = attempt;
        setPilotReconciliationBlocked(true);
        const durable = await loadPilotStatus();
        if (!pilotGuard.current.isCurrent(token)) return;
        if (durable && pilotObservationConfirmed(durable, attempt)) {
          ambiguousPilotAttempt.current = null;
          setPilotReconciliationBlocked(false);
          setPilotMessage("Durable status confirms the exact pilot evidence fact. No duplicate mutation was attempted.");
        } else if (durable) {
          ambiguousPilotAttempt.current = null;
          setPilotReconciliationBlocked(false);
          setPilotRetry(attempt);
          setPilotError({
            title: "Pilot evidence not confirmed",
            message: "Durable status was reconciled and does not contain this exact fact. Retry only by explicit choice."
          });
        } else {
          setPilotError({
            title: "Pilot evidence outcome unknown",
            message: "Durable status must be reconciled before this evidence mutation can be retried."
          });
        }
      } else {
        setPilotError({
          title: "Pilot evidence unavailable",
          message: observationError?.message || "The bounded evidence fact could not be recorded."
        });
      }
    } finally {
      if (pilotGuard.current.finish(token)) setPilotMutation(null);
    }
  }

  async function reconcilePilotEvidence() {
    const attempt = ambiguousPilotAttempt.current;
    const durable = await loadPilotStatus();
    if (!durable) return;
    setPilotReconciliationBlocked(false);
    ambiguousPilotAttempt.current = null;
    if (attempt && pilotObservationConfirmed(durable, attempt)) {
      setPilotMessage("Durable status confirms the exact pilot evidence fact. No duplicate mutation was attempted.");
      setPilotError(null);
      return;
    }
    if (attempt) setPilotRetry(attempt);
    setPilotError(attempt ? {
      title: "Pilot evidence not confirmed",
      message: "Durable status does not contain this exact fact. Retry only by explicit choice."
    } : null);
  }

  function inspectFirstImported(entry, { explicitRetry = false } = {}) {
    const caseId = entry.case.id;
    if (
      pilotStatus?.inspected_case_ids.includes(caseId)
      || pilotMutation
      || pilotReconciliationBlocked
      || (!explicitRetry && inspectedAttempts.current.has(caseId))
    ) return;
    inspectedAttempts.current.add(caseId);
    void runPilotObservation({
      kind: "inspect",
      caseId,
      request: () => recordPilotCaseInspected(caseId)
    });
  }

  function toggleCase(entry) {
    const expanding = selectedCaseId !== entry.case.id;
    setSelectedCaseId(expanding ? entry.case.id : null);
    if (expanding && entry.case.id === firstImportedCase?.case.id) {
      inspectFirstImported(entry);
    }
  }

  function submitPilotFeedback() {
    const caseId = firstImportedCase?.case.id;
    if (!caseId || !feedbackCode) return;
    void runPilotObservation({
      kind: "feedback",
      caseId,
      feedbackCode,
      request: () => recordPilotCaseFeedback(caseId, feedbackCode)
    });
  }

  async function runScan() {
    setScanState("RUNNING");
    setMutationMessage(null);
    setMutationError(null);
    try {
      const response = await scanStalledOpportunities();
      if (!mounted.current) return;
      setScanSummary(response.summary);
      const durable = await loadQueue();
      await loadPilotStatus();
      if (durable) setMutationMessage(
        "Scan complete. The durable operating queue was refreshed."
      );
    } catch (scanError) {
      if (!mounted.current) return;
      if (isAmbiguousRevenueLeakCaseMutationError(scanError)) {
        setReconciliationBlocked(true);
        const [durable] = await Promise.all([loadQueue(), loadPilotStatus()]);
        setMutationError(durable ? {
          title: "Scan outcome reconciled",
          message: "The scan response was not confirmed. Durable queue truth was reloaded; run another scan only by explicit choice."
        } : {
          title: "Scan outcome unknown",
          message: "Durable queue truth must reload before another mutation is allowed."
        });
      } else {
        setMutationError(queueErrorCopy(scanError));
      }
    } finally {
      if (mounted.current) setScanState(null);
    }
  }

  async function createRecoveryAction(entry) {
    const caseId = entry.case.id;
    const opportunityId = entry.opportunity.id;
    setMutationCaseId(caseId);
    setMutationMessage(null);
    setMutationError(null);
    try {
      await createRevenueActionForLeakCase(caseId, opportunityId);
      if (!mounted.current) return;
      setReconciliationBlocked(true);
      const durable = await loadQueue();
      const linked = durable?.entries.find(item => item.case.id === caseId)
        ?.linked_revenue_action;
      if (linked) {
        const evidence = await loadPilotStatus();
        if (evidence && !evidence.linked_action_ids.includes(linked.id)) {
          setPilotError({
            title: "Linked action evidence not confirmed",
            message: "The exact case/action link is durable, but pilot status does not yet contain this action identifier. No mutation was repeated."
          });
        }
        setMutationMessage(
          "RevenueAction created and linked. Continue in Opportunity Command Center; approval required."
        );
      } else {
        setMutationError({
          title: "RevenueAction link needs reconciliation",
          message: "The handoff response succeeded, but durable queue truth did not confirm the link. Refresh before another attempt."
        });
      }
    } catch (handoffError) {
      if (!mounted.current) return;
      if (isAmbiguousRevenueLeakCaseMutationError(handoffError)) {
        setReconciliationBlocked(true);
        const durable = await loadQueue();
        const linked = durable?.entries.find(item => item.case.id === caseId)
          ?.linked_revenue_action;
        if (linked) {
          const evidence = await loadPilotStatus();
          if (evidence && !evidence.linked_action_ids.includes(linked.id)) {
            setPilotError({
              title: "Linked action evidence not confirmed",
              message: "Durable queue truth confirms the exact case/action link, but pilot status does not yet contain this action identifier. No mutation was repeated."
            });
          }
          setMutationMessage(
            "Durable server truth confirms the RevenueAction link. No duplicate mutation was attempted."
          );
        } else if (durable) {
          setMutationError({
            title: "RevenueAction handoff not confirmed",
            message: "Durable server truth was reloaded and does not show the link. Review the case before explicitly trying again."
          });
        } else {
          setMutationError({
            title: "RevenueAction handoff outcome unknown",
            message: "Durable queue truth must reload before another handoff is allowed."
          });
        }
      } else {
        setMutationError(queueErrorCopy(handoffError));
      }
    } finally {
      if (mounted.current) setMutationCaseId(null);
    }
  }

  const activePipeline = revenue?.active_pipeline;
  const attention = revenue?.revenue_requiring_attention;
  const classifications = revenue?.classifications || {};
  const topActions = revenue?.top_actions || [];
  const controlsDisabled = Boolean(
    scanState
    || mutationCaseId
    || refreshing
    || reconciliationBlocked
    || queueState !== "READY"
  );

  return (
    <section
      className="card revenue-command-center rcc2"
      data-testid="revenue-command-center"
      aria-labelledby="revenue-command-center-title"
    >
      <div className="rcc2-hero">
        <div>
          <span className="eyebrow">REVENUE COMMAND CENTER V2</span>
          <h3 id="revenue-command-center-title">What revenue needs attention?</h3>
          <p>
            Deterministic RevenueLeakCases ordered by the server from recorded,
            tenant-visible CRM evidence.
          </p>
        </div>
        <div className="rcc2-hero-actions">
          <button
            type="button"
            className="oc-primary-button"
            disabled={controlsDisabled || queueError?.kind === "UNAUTHORIZED"}
            onClick={runScan}
          >
            {scanState === "RUNNING" ? "Scanning…" : "Scan stalled opportunities"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={refreshing || reconciliationBlocked}
            onClick={refreshQueue}
          >
            {refreshing ? "Refreshing…" : "Refresh queue"}
          </button>
        </div>
      </div>

      {queueState === "LOADING" && !queue && (
        <div className="rcc2-state" role="status">Loading revenue leak operating queue…</div>
      )}
      {queueError && (
        <div className="rcc2-alert" role="alert">
          <strong>{queueError.title}</strong>
          <span>{queueError.message}</span>
          {queueState === "STALE" && (
            <small>Showing the last validated queue while refresh is unavailable.</small>
          )}
          {queueError.kind !== "UNAUTHORIZED" && (
            <button type="button" className="oc-secondary-button" onClick={loadQueue}>
              Retry queue
            </button>
          )}
        </div>
      )}
      {mutationMessage && <div className="rcc2-success" role="status">{mutationMessage}</div>}
      {mutationError && (
        <div className="rcc2-alert" role="alert">
          <strong>{mutationError.title}</strong><span>{mutationError.message}</span>
        </div>
      )}
      {pilotMessage && <div className="rcc2-success" role="status">{pilotMessage}</div>}
      {pilotError && (
        <div className="rcc2-alert" role="alert">
          <strong>{pilotError.title}</strong><span>{pilotError.message}</span>
          {pilotReconciliationBlocked && (
            <button
              type="button"
              className="oc-secondary-button"
              disabled={pilotStatusState === "LOADING"}
              onClick={reconcilePilotEvidence}
            >
              Reconcile pilot evidence
            </button>
          )}
          {!pilotReconciliationBlocked && pilotStatusState === "ERROR" && (
            <button type="button" className="oc-secondary-button" onClick={loadPilotStatus}>
              Retry pilot status
            </button>
          )}
          {!pilotReconciliationBlocked && pilotRetry && pilotRetry.kind !== "inspect" && (
            <button
              type="button"
              className="oc-secondary-button"
              disabled={Boolean(pilotMutation)}
              onClick={() => runPilotObservation(pilotRetry)}
            >
              Retry exact pilot evidence
            </button>
          )}
        </div>
      )}
      <PilotJourney status={pilotStatus} />
      {scanSummary && <ScanSummary summary={scanSummary} />}

      {queue && (
        <>
          <QueueSummary summary={queue.value_summary} />
          <fieldset className="rcc2-filters">
            <legend>Filter authoritative case fields</legend>
            <div className="rcc2-filter">
              <label htmlFor="rcc2-lifecycle-filter">Lifecycle</label>
              <select id="rcc2-lifecycle-filter" value={lifecycleFilter} onChange={event => setLifecycleFilter(event.target.value)}>
                <option value="ALL">All active states</option><option value="OPEN">Open</option><option value="SNOOZED">Snoozed</option>
              </select>
            </div>
            <div className="rcc2-filter">
              <label htmlFor="rcc2-value-filter">Value</label>
              <select id="rcc2-value-filter" value={valueFilter} onChange={event => setValueFilter(event.target.value)}>
                <option value="ALL">All value states</option><option value="KNOWN_POSITIVE">Known value</option><option value="KNOWN_ZERO">Known zero</option><option value="UNKNOWN">Unknown value</option><option value="NOT_APPLICABLE">Not applicable</option>
              </select>
            </div>
            <div className="rcc2-filter">
              <label htmlFor="rcc2-source-filter">Source</label>
              <select id="rcc2-source-filter" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}>
                <option value="ALL">All authoritative sources</option><option value="TGE">TGE</option>
              </select>
            </div>
          </fieldset>

          {queue.entries.length === 0 ? (
            <div className="rcc2-state" data-testid="revenue-leak-queue-empty">
              No active revenue leak cases need attention. This is a complete queue
              result, not a claim that every opportunity was recently scanned. Run
              the explicit stalled-opportunity scan to evaluate current canonical
              evidence, or import/create opportunities if none are available.
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="rcc2-state">No cases match these authoritative filters.</div>
          ) : (
            <div className="rcc2-cases" aria-label="Revenue leak operating queue">
              {visibleEntries.map(entry => (
                <QueueCase
                  key={entry.case.id}
                  entry={entry}
                  expanded={selectedCaseId === entry.case.id}
                  disabled={controlsDisabled || actionsUnavailable}
                  firstImported={entry.case.id === firstImportedCase?.case.id}
                  inspected={pilotStatus?.inspected_case_ids.includes(entry.case.id)}
                  feedback={pilotStatus?.case_feedback.find(item =>
                    item.case_id === entry.case.id
                  )?.feedback_code || null}
                  feedbackCode={feedbackCode}
                  mutating={mutationCaseId === entry.case.id}
                  onToggle={() => toggleCase(entry)}
                  onCreateAction={createRecoveryAction}
                  onFeedbackCode={setFeedbackCode}
                  onRetryInspection={() => inspectFirstImported(entry, {
                    explicitRetry: true
                  })}
                  onSubmitFeedback={submitPilotFeedback}
                  onOpenOpportunity={onOpenOpportunity}
                  pilotDisabled={Boolean(
                    pilotMutation
                    || pilotReconciliationBlocked
                    || pilotStatusState !== "READY"
                  )}
                  retryInspection={pilotRetry?.kind === "inspect"
                    && pilotRetry.caseId === entry.case.id}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div className="rcc2-secondary" aria-label="Legacy active-pipeline guidance">
        <h4>Opportunity guidance</h4>
        {loading && !revenue ? (
          <div className="pipeline-loading">Loading revenue intelligence…</div>
        ) : error && !revenue ? (
          <div className="pipeline-loading">Unable to load revenue intelligence.<button className="text-button" onClick={onRefresh}>Retry revenue</button></div>
        ) : (
          <>
            <div className="revenue-summary-grid">
              <div className="revenue-summary-item"><span>Active pipeline</span><strong data-testid="revenue-active-pipeline-value">{summaryMoney(activePipeline?.value)}</strong><small>{countLabel(activePipeline?.value)}</small></div>
              <div className="revenue-summary-item"><span>Weighted pipeline</span><strong data-testid="revenue-weighted-pipeline-value">{summaryMoney(activePipeline?.weighted_value)}</strong><small>{countLabel(activePipeline?.weighted_value)}</small></div>
              <div className="revenue-summary-item"><span>Requires attention</span><strong data-testid="revenue-attention-count">{attention?.opportunity_count || 0}</strong><small>{summaryMoney(attention?.value)} known value</small></div>
            </div>
            {error && <div className="revenue-error" role="status">Revenue refresh failed. Showing the last successful revenue result.</div>}
            <div className="revenue-classifications" aria-label="Revenue classifications">
              {CLASSIFICATION_BADGES.map(({ type, label }) => <span key={type} className="revenue-classification" data-testid={`revenue-classification-${type.toLowerCase()}`}>{label}: {classifications[type]?.count || 0}</span>)}
            </div>
            <div className="revenue-actions">
              <h4>Top opportunity actions</h4>
              {actionsUnavailable ? <div className="pipeline-loading">Opportunity actions are unavailable until opportunity data can be loaded.</div>
                : topActions.length === 0 ? <div className="pipeline-loading">No active opportunities need review.</div>
                  : topActions.map(item => <button key={item.opportunity_id} type="button" className="revenue-action" data-testid={`revenue-action-${item.opportunity_id}`} onClick={() => onOpenOpportunity(item.opportunity_id)}><span><strong>{item.business_name || "Unnamed opportunity"}</strong><small>{item.action.priority} · {item.action.type}{item.value.known ? ` · ${formatCommercialValue(item.value.amount, item.value.currency)}` : " · Value unknown"}</small></span><span className="revenue-action-title">{item.action.title} →</span></button>)}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
