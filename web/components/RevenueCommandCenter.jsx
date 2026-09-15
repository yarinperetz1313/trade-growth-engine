import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRevenueActionForLeakCase,
  getOpportunityRevenueLeakCases,
  getPilotEvidenceStatus,
  getRevenueLeakOperatingQueue,
  getStalledOpportunityEligibility,
  recordPilotCaseFeedback,
  recordPilotCaseInspected,
  recordPilotCaseSurfaced,
  scanStalledOpportunities,
  transitionRevenueLeakCase
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
import {
  buildFirstValueScanResult,
  partitionCredibleCases,
  selectCredibleHero
} from "../lib/firstValueJourney.mjs";
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

function eligibilityErrorCopy(error) {
  const kind = classifyRevenueLeakOperatingQueueError(error);
  if (kind === "UNAUTHORIZED") return {
    kind,
    title: "Operational Data Health unauthorized",
    message: "You are not authorized to assess this tenant's opportunity dataset."
  };
  if (kind === "PERSISTENCE") return {
    kind,
    title: "Operational Data Health unavailable",
    message: "Tenant-scoped canonical evidence is temporarily unavailable. No scan-readiness conclusion was inferred."
  };
  return {
    kind,
    title: "Operational Data Health could not be verified",
    message: error?.message || "Server-authoritative detector readiness could not be loaded."
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

function ScanSummary({ summary, queue, queueFreshness }) {
  const queueCurrent = queueFreshness === "CURRENT";
  const result = buildFirstValueScanResult(summary, queueCurrent ? queue : null);
  const detected = result.credible_case_count;
  return (
    <section className="rcc2-scan-summary" role="status" aria-label="Complete explicit scan outcomes">
      <div className="rcc2-result-heading">
        <span className="eyebrow">WHAT TGE FOUND</span>
        <h4>{detected > 0
          ? `${detected} credible revenue ${detected === 1 ? "case" : "cases"} found`
          : summary.evaluated_count === 0
            ? "No opportunity evidence was available to scan"
            : "No credible stalled-opportunity case found"}</h4>
        <p>{detected > 0
          ? queueCurrent
            ? "The durable queue below contains the current active cases after this explicit scan. Open the highest-priority customer case to inspect why it matters and choose the next human-controlled step."
            : "The explicit scan confirmed credible cases. Current active-case counts and economic value remain withheld until durable queue truth refreshes."
          : summary.evaluated_count === 0
            ? "No canonical opportunities were available. Import or create opportunity evidence, review Operational Data Health, then explicitly scan again."
          : result.limitation_count > 0
            ? `TGE found no leak in ${result.assessed_no_leak_count} assessable records; ${result.limitation_count} could not support a decision. Review the exact limitations before improving evidence and scanning again.`
            : `TGE found no stalled leak in ${result.assessed_no_leak_count} assessable records. This result covers only the current tenant-visible opportunity dataset.`}</p>
      </div>
      <div className="rcc2-result-counts" aria-label="Credible scan result counts">
        <div><span>Credible cases</span><strong>{result.credible_case_count}</strong></div>
        <div><span>Assessed · no leak</span><strong>{result.assessed_no_leak_count}</strong></div>
        <div><span>Evidence limitations</span><strong>{result.limitation_count}</strong></div>
        {queueCurrent ? (
          <div><span>Active cases now</span><strong>{result.active_case_count}</strong></div>
        ) : (
          <div>
            <span>Current case truth</span>
            <strong>{queueFreshness === "REFRESHING"
              ? "Refreshing durable queue truth"
              : "Unavailable"}</strong>
          </div>
        )}
      </div>
      <QueueSummary
        summary={queue?.value_summary}
        freshness={queueFreshness}
        entries={queue?.entries}
      />
      {queueCurrent ? (
        <small className="rcc2-result-truth">
          Known amounts are exact current active-case values grouped by authoritative currency.
          No cross-currency total is calculated. Unknown is not zero. Sample/demo cases stay labelled
          and never satisfy first-value evidence. Created {result.created_case_count},
          replayed {result.replayed_case_count}, and reconciled as superseded {result.superseded_case_count}.
        </small>
      ) : (
        <small className="rcc2-result-truth">
          Confirmed scan outcomes remain available, but current active-case counts and money unavailable
          until a durable queue refresh succeeds. Created {result.created_case_count}, replayed {result.replayed_case_count},
          and reconciled as superseded {result.superseded_case_count} are scan outcomes, not current queue totals.
        </small>
      )}
      <details className="rcc2-scan-details">
        <summary>Inspect complete detector outcomes and reason codes</summary>
        <div className="rcc2-scan-heading">
          <span>Evaluated {summary.evaluated_count}</span>
          <span>Excluded {summary.excluded_count}</span>
          <span>Unevaluated {summary.unevaluated_count}</span>
        </div>
        <div className="rcc2-scan-outcomes">
          {SCAN_OUTCOMES.map(outcome => {
            const outcomeResult = summary.outcomes[outcome];
            const title = detectorOutcomePresentation(outcome, null).title;
            const reasons = Object.entries(outcomeResult.reasons);
            return (
              <article key={outcome}>
                <strong>{title}</strong>
                <span>{outcomeResult.count}</span>
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
      </details>
    </section>
  );
}

const NEXT_STEP_COPY = Object.freeze({
  CORRECT_OPPORTUNITY_STAGE: "Use the pipeline stage control to record a recognized stage, then refresh readiness.",
  IMPORT_ACTIVITY_OR_CREATED_AT: "Import a valid meaningful activity linked to this opportunity, then refresh readiness.",
  CORRECT_TIMESTAMP_EVIDENCE: "Ask the assisted-pilot operator to correct this canonical timestamp. Re-import does not overwrite immutable source evidence.",
  IMPORT_NEWER_SOURCE_DATA: "Import newer activity evidence linked to this opportunity, or ask the assisted-pilot operator to resolve the immutable source record.",
  CORRECT_OPPORTUNITY_EVIDENCE: "Ask the assisted-pilot operator to correct this canonical opportunity record before scanning.",
  CORRECT_NEXT_ACTION_EVIDENCE: "Ask the assisted-pilot operator to correct the malformed next-action evidence before scanning.",
  CORRECT_TASK_STATUS: "Ask the assisted-pilot operator to correct the unsupported task status before scanning.",
  CORRECT_TASK_EVIDENCE: "Ask the assisted-pilot operator to resolve duplicated or inconsistent task evidence before scanning.",
  CORRECT_ACTIVITY_EVIDENCE: "Ask the assisted-pilot operator to resolve duplicated or malformed activity evidence before scanning.",
  CORRECT_COMMERCIAL_EVIDENCE: "Ask the assisted-pilot operator to correct malformed value or currency evidence. Missing money may remain unknown without blocking an otherwise valid record."
});

function readinessHeading(summary) {
  if (summary.readiness === "EMPTY") return "No opportunities are available to assess";
  if (summary.readiness === "READY") {
    return `${summary.detector_assessable_count} of ${summary.total_opportunities} opportunities are ready to assess`;
  }
  if (summary.readiness === "PARTIAL") {
    return `${summary.detector_assessable_count} of ${summary.total_opportunities} opportunities are ready to assess`;
  }
  if (summary.readiness === "NOT_READY") {
    return `0 of ${summary.total_opportunities} opportunities are ready to assess`;
  }
  return "The explicit stalled-opportunity scan is currently blocked";
}

function OperationalDataHealth({ readiness, state, error, onRetry }) {
  if (state === "LOADING" && !readiness) {
    return (
      <section className="rcc2-readiness rcc2-state" role="status">
        Checking whether your opportunity data is ready…
      </section>
    );
  }
  if (error || !readiness) {
    return (
      <section className="rcc2-readiness rcc2-alert" role="alert">
        <strong>{error?.title || "Operational Data Health unavailable"}</strong>
        <span>{error?.message || "TGE could not confirm whether this data is ready, so scanning remains unavailable."}</span>
        {error?.kind !== "UNAUTHORIZED" && (
          <button type="button" className="oc-secondary-button" onClick={onRetry}>
            Retry readiness
          </button>
        )}
      </section>
    );
  }
  const summary = readiness.summary;
  const ineligible = readiness.records.filter(record =>
    record.classification !== "ELIGIBLE"
  );
  return (
    <section
      className={`rcc2-readiness ${summary.readiness.toLowerCase()}`}
      aria-labelledby="operational-data-health-title"
      data-testid="stalled-opportunity-readiness"
    >
      <div className="rcc2-readiness-heading">
        <div>
          <span className="eyebrow">STEP 1 · CHECK YOUR DATA</span>
          <h4 id="operational-data-health-title">Operational Data Health</h4>
          <strong>{readinessHeading(summary)}</strong>
        </div>
        <span className="rcc2-readiness-status">{summary.readiness.replaceAll("_", " ")}</span>
      </div>
      {summary.readiness === "EMPTY" && (
        <p>Import or create opportunity evidence before running the detector.</p>
      )}
      {summary.readiness === "READY" && (
        <p>TGE received {summary.total_opportunities} current tenant-visible opportunities and can assess all {summary.detector_assessable_count}. Review the value coverage, then explicitly scan when you choose.</p>
      )}
      {summary.readiness === "PARTIAL" && (
        <p>TGE received {summary.total_opportunities} current tenant-visible opportunities. It can assess {summary.detector_assessable_count}; {summary.detector_unassessable_count} have limitations. Review those limitations before explicitly scanning the supported subset.</p>
      )}
      {summary.readiness === "NOT_READY" && (
        <p>The explicit scan would return only evidence limitations. Resolve the supported issues below, then refresh readiness.</p>
      )}
      {summary.readiness === "BLOCKED" && (
        <p>The current portfolio exceeds or violates the bounded scan contract. No record was assessed and the scan action remains unavailable.</p>
      )}
      <div className="rcc2-readiness-metrics" aria-label="Stalled-opportunity assessment coverage">
        <div><span>Known to TGE</span><strong>{summary.total_opportunities}</strong></div>
        <div><span>Ready to assess</span><strong>{summary.detector_assessable_count}</strong></div>
        <div><span>Cannot assess now</span><strong>{summary.detector_unassessable_count}</strong></div>
        <div><span>Known positive value</span><strong>{summary.commercial_value_coverage.known_positive_count}</strong></div>
        <div><span>Known zero</span><strong>{summary.commercial_value_coverage.known_zero_count}</strong></div>
        <div><span>Unknown value</span><strong>{summary.commercial_value_coverage.unknown_count}</strong></div>
        {summary.commercial_value_coverage.not_assessed_count > 0 && (
          <div><span>Value not assessed</span><strong>{summary.commercial_value_coverage.not_assessed_count}</strong></div>
        )}
      </div>
      <small className="rcc2-readiness-scope">
        Coverage is limited to the current tenant-visible canonical opportunity dataset. TGE does not claim this is the customer's complete business. No money is aggregated or converted here; unknown is not zero.
      </small>
      {Object.keys(summary.reason_counts).length > 0 && (
        <div className="rcc2-readiness-reasons" aria-label="Reasons opportunities cannot be assessed">
          <strong>Blockers to resolve before these records can be assessed</strong>
          <ul>
            {Object.entries(summary.reason_counts).map(([reasonCode, count]) => (
              <li key={reasonCode}>
                <span>{detectorReasonExplanation(reasonCode)}</span>
                <strong>{count}</strong>
                <details><summary>Diagnostic code</summary><code>{reasonCode}</code></details>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.global_reason_code && (
        <div className="rcc2-readiness-blocker">
          <code>{summary.global_reason_code}</code>
          <span>{summary.total_opportunities} records cannot enter the bounded 100-opportunity scan.</span>
        </div>
      )}
      {ineligible.length > 0 && (
        <details className="rcc2-readiness-records">
          <summary>Inspect {ineligible.length} records that cannot be assessed now</summary>
          <div>
            {ineligible.map(record => (
              <article key={record.opportunity_id} data-readiness-record={record.opportunity_id}>
                <div>
                  <strong>{record.opportunity_name || "Unnamed opportunity"}</strong>
                <small>Opportunity needs attention before scanning</small>
                </div>
                <span>{detectorOutcomePresentation(record.detector_outcome, record.reason_code).title}</span>
                <p>{detectorReasonExplanation(record.reason_code)}</p>
                <details><summary>Operator diagnostics</summary><code>{record.reason_code} · {record.opportunity_id}</code></details>
                <p><strong>Next useful action:</strong> {NEXT_STEP_COPY[record.next_step]}</p>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function RevenueJourneyPath() {
  return (
    <section className="rcc2-path" aria-label="How TGE gets to a safe action">
      <div><span>1</span><strong>Check your data</strong><small>See what can support a trustworthy review.</small></div>
      <div><span>2</span><strong>Scan when ready</strong><small>You choose when TGE checks for stalled opportunities.</small></div>
      <div><span>3</span><strong>Review the strongest case</strong><small>Approve any resulting work before it is created.</small></div>
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
    <details className="rcc2-pilot-journey" aria-label="First-value pilot journey">
      <summary>Operator diagnostics · Pilot milestone evidence</summary>
      <p>Privacy-minimized product evidence only—not customer adoption or commercial-outcome evidence.</p>
      <ol>
        {milestones.map(([label, complete]) => (
          <li className={complete ? "complete" : "pending"} key={label}>
            <span aria-hidden="true">{complete ? "✓" : "○"}</span>{label}
          </li>
        ))}
      </ol>
    </details>
  );
}

function ScanAction({ disabled, disabledRefresh, running, onScan, onRefresh, refreshing }) {
  return (
    <section className="rcc2-scan-action" aria-label="Explicit opportunity scan">
      <div>
        <span className="eyebrow">STEP 2 · SCAN WHEN READY</span>
        <h4>Check ready opportunities for a credible stall</h4>
        <p>This runs only when you choose it. It reviews recorded evidence and refreshes the durable case queue.</p>
      </div>
      <div className="rcc2-hero-actions">
        <button type="button" className="oc-primary-button" disabled={disabled} onClick={onScan}>
          {running ? "Scanning…" : "Scan stalled opportunities"}
        </button>
        <button type="button" className="text-button" disabled={disabledRefresh} onClick={onRefresh}>
          {refreshing ? "Refreshing…" : "Refresh queue"}
        </button>
      </div>
    </section>
  );
}

function AllCaseQueueSummary({ summary }) {
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

function QueueSummary({ summary, freshness, entries = [] }) {
  if (freshness !== "CURRENT") {
    return (
      <div className="rcc2-state" role="status" aria-label="Current queue economic truth">
        <strong>{freshness === "REFRESHING"
          ? "Refreshing current queue economics…"
          : "Current queue economics unavailable"}</strong>
        <small>
          Exact active-case counts and money are withheld until an authorized
          durable queue refresh succeeds. Unknown is not zero.
        </small>
      </div>
    );
  }

  const { demoEntries } = partitionCredibleCases(entries);
  const customerHero = selectCredibleHero(entries);
  if (demoEntries.length > 0) {
    const potential = customerHero
      ? formatPotentialRevenueAtRisk(customerHero.potential_value)
      : null;
    const businessName = customerHero ? identityCopy(customerHero) : null;
    return (
      <div className="rcc2-economic-evidence">
        <section
          className="rcc2-primary-economic-evidence"
          aria-label="Primary customer-case economic evidence"
        >
          <span className="eyebrow">CUSTOMER-CASE EVIDENCE</span>
          <h4>{businessName || "No active customer case"}</h4>
          <strong>{potential?.value || "No customer-case amount"}</strong>
          <small>{potential
            ? `${potential.detail} · exact server-projected case evidence`
            : "Sample/demo evidence is excluded from customer first-value evidence."}</small>
        </section>
        <details
          className="rcc2-all-case-aggregate"
          aria-label="All active-case aggregate including sample and demo evidence"
        >
          <summary>
            Server all-case aggregate · includes {demoEntries.length} sample/demo
            {demoEntries.length === 1 ? " case" : " cases"}
          </summary>
          <p>
            This secondary server-authoritative disclosure includes customer and
            sample/demo cases. It is not customer first-value evidence.
          </p>
          <AllCaseQueueSummary summary={summary} />
        </details>
      </div>
    );
  }

  return (
    <AllCaseQueueSummary summary={summary} />
  );
}

function QueueCase({
  entry,
  expanded,
  disabled,
  mutating,
  hero,
  firstImported,
  inspected,
  feedback,
  feedbackCode,
  onToggle,
  onCreateAction,
  onDecision,
  onOpenOpportunity,
  onFeedbackCode,
  onSubmitFeedback,
  onRetryInspection,
  pilotDisabled,
  retryInspection
}) {
  const [snoozeReason, setSnoozeReason] = useState("");
  const [snoozeDays, setSnoozeDays] = useState("3");
  const [dismissReason, setDismissReason] = useState("");
  const businessName = identityCopy(entry);
  const potential = formatPotentialRevenueAtRisk(entry.potential_value);
  const linkedAction = entry.linked_revenue_action;
  const canNavigate = Boolean(entry.opportunity?.id);
  return (
    <article className={`rcc2-case${hero ? " hero" : ""}`} data-case-id={entry.case.id}>
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
            {hero && (
              <span className="rcc2-hero-case">Highest-priority credible customer case</span>
            )}
          <strong>{businessName}</strong>
          <small>{canNavigate ? "Customer opportunity" : "Historical opportunity"} · {entry.case.lifecycle_state.replaceAll("_", " ")}</small>
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
              <p>
                The recorded opportunity reached the stalled threshold without a
                meaningful next action.
              </p>
            </div>
            <dl>
              <div><dt>Lifecycle</dt><dd>{entry.case.lifecycle_state}</dd></div>
              <div><dt>Leak age</dt><dd>{ageCopy(entry.leak_age)}</dd></div>
              <div><dt>Recorded source</dt><dd>{entry.case.source.system}</dd></div>
            </dl>
          </div>
          <details className="rcc2-business-evidence">
            <summary>Review supporting business evidence</summary>
            <EvidenceDetails
              source={entry.case.source}
              evidence={entry.case.evidence_snapshot.facts}
              evidenceClassification={entry.case.evidence_classification}
              evidenceState="AVAILABLE"
            />
          </details>
          <details className="rcc2-operator-diagnostics">
            <summary>Operator diagnostics</summary>
            <dl>
              <div><dt>Case ID</dt><dd>{entry.case.id}</dd></div>
              <div><dt>Opportunity ID</dt><dd>{entry.historical_opportunity_id}</dd></div>
              <div><dt>Reason code</dt><dd>{entry.case.reason_code}</dd></div>
              <div><dt>Detector</dt><dd>{entry.case.detector.id} v{entry.case.detector.version}</dd></div>
            </dl>
          </details>
          {firstImported && (
            <section className="rcc2-pilot-feedback" aria-label="First-value case feedback">
              <div>
                <h5>Was this case useful?</h5>
                <p>{inspected
                  ? "Your review of this imported-customer case is recorded."
                  : "Case review confirmation is pending or unavailable."}</p>
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
                    <span>Case feedback</span>
                    <select
                      aria-label="Bounded feedback"
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
              <h5>Continue to a safe action</h5>
              <p>
                {canNavigate
                  ? "Create one linked action, then review → approve → create the internal task. Nothing is sent from this case review."
                  : "Current opportunity context unavailable. Recovery action and navigation are unavailable; the historical source identity remains visible for review."}
              </p>
              {linkedAction && (
                <strong data-testid={`rcc2-action-state-${entry.case.id}`}>
                  Action already exists · {actionStateCopy(linkedAction.current.status)}
                </strong>
              )}
              {!canNavigate && (
                <strong>TAKE ACTION cannot proceed — current opportunity context is unavailable.</strong>
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
                  {mutating === "TAKE_ACTION" ? "Reconciling durable truth…" : "TAKE ACTION"}
                </button>
              )}
              {canNavigate && (
                <button
                  type="button"
                  className="oc-secondary-button"
                  disabled={disabled}
                  onClick={() => onOpenOpportunity(entry.opportunity.id, {
                    focusAction: Boolean(linkedAction),
                    caseId: entry.case.id,
                    actionId: linkedAction?.id || null
                  })}
                >
                  {linkedAction
                    ? "CONTINUE ACTION"
                    : "Open opportunity"}
                </button>
              )}
            </div>
          </div>
          <section className="rcc2-decisions" aria-label={`Human decisions for ${businessName}`}>
            <div>
              <h5>SNOOZE</h5>
              <p>Keep the case active, record why, and set a future wake time.</p>
              {entry.case.lifecycle_state === "OPEN" ? (
                <>
                  <label>
                    <span>Reason to snooze</span>
                    <input
                      value={snoozeReason}
                      maxLength={512}
                      disabled={disabled}
                      onChange={event => setSnoozeReason(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Wake time</span>
                    <select
                      value={snoozeDays}
                      disabled={disabled}
                      onChange={event => setSnoozeDays(event.target.value)}
                    >
                      <option value="1">In 1 day</option>
                      <option value="3">In 3 days</option>
                      <option value="7">In 7 days</option>
                      <option value="14">In 14 days</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="oc-secondary-button"
                    disabled={disabled || !snoozeReason.trim()}
                    onClick={() => onDecision(entry, "snooze", {
                      reason: snoozeReason.trim(),
                      wake_at: new Date(
                        Date.now() + Number(snoozeDays) * 24 * 60 * 60 * 1000
                      ).toISOString()
                    })}
                  >
                    {mutating === "SNOOZE" ? "Snoozing…" : "SNOOZE"}
                  </button>
                </>
              ) : (
                <strong>Already snoozed · use the opportunity history to resume.</strong>
              )}
            </div>
            <div>
              <h5>DISMISS</h5>
              <p>Close this case with a durable human reason. This does not rewrite its evidence.</p>
              <label>
                <span>Reason to dismiss</span>
                <input
                  value={dismissReason}
                  maxLength={512}
                  disabled={disabled}
                  onChange={event => setDismissReason(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="oc-secondary-button"
                disabled={disabled || !dismissReason.trim()}
                onClick={() => onDecision(entry, "dismiss", {
                  reason: dismissReason.trim()
                })}
              >
                {mutating === "DISMISS" ? "Dismissing…" : "DISMISS"}
              </button>
            </div>
          </section>
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
  const [readiness, setReadiness] = useState(null);
  const [readinessState, setReadinessState] = useState("LOADING");
  const [readinessError, setReadinessError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [lifecycleFilter, setLifecycleFilter] = useState("ALL");
  const [valueFilter, setValueFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [scanState, setScanState] = useState(null);
  const [scanSummary, setScanSummary] = useState(null);
  const [queueEconomicFreshness, setQueueEconomicFreshness] = useState(null);
  const [mutationCaseId, setMutationCaseId] = useState(null);
  const [mutationKind, setMutationKind] = useState(null);
  const [mutationMessage, setMutationMessage] = useState(null);
  const [mutationError, setMutationError] = useState(null);
  const [reconciliationBlocked, setReconciliationBlocked] = useState(false);
  const [pendingCaseReconciliation, setPendingCaseReconciliation] = useState(null);
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
  const readinessRequest = useRef(0);
  const queueRef = useRef(null);
  const scanSummaryRef = useRef(null);
  const queueTruthGeneration = useRef(0);
  const queueMutationEpoch = useRef(0);
  const activeQueueMutation = useRef(null);
  const pendingCaseReconciliationRef = useRef(null);
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

  const loadQueue = useCallback(async ({ queueMutationToken = null } = {}) => {
    const mutationEpoch = queueMutationEpoch.current;
    const activeMutation = activeQueueMutation.current;
    const ownsMutationBoundary = activeMutation === null
      || queueMutationToken === activeMutation;
    const requestId = ownsMutationBoundary ? ++queueRequest.current : null;
    const truthGeneration = queueTruthGeneration.current;
    if (ownsMutationBoundary) {
      if (!queueRef.current) setQueueState("LOADING");
      else setRefreshing(true);
      setQueueError(null);
    }
    try {
      const response = await getRevenueLeakOperatingQueue();
      if (
        !mounted.current
        || !ownsMutationBoundary
        || requestId !== queueRequest.current
        || mutationEpoch !== queueMutationEpoch.current
      ) return null;
      queueRef.current = response.data;
      setQueue(response.data);
      setQueueState("READY");
      if (truthGeneration === queueTruthGeneration.current) {
        setQueueEconomicFreshness("CURRENT");
      }
      setSelectedCaseId(current =>
        response.data.entries.some(entry => entry.case.id === current)
          ? current
          : null
      );
      return response.data;
    } catch (requestError) {
      if (
        !mounted.current
        || !ownsMutationBoundary
        || requestId !== queueRequest.current
        || mutationEpoch !== queueMutationEpoch.current
      ) return null;
      setQueueError(queueErrorCopy(requestError));
      setQueueState(queueRef.current ? "STALE" : "ERROR");
      if (truthGeneration === queueTruthGeneration.current) {
        setQueueEconomicFreshness("UNAVAILABLE");
      }
      return null;
    } finally {
      if (
        mounted.current
        && ownsMutationBoundary
        && requestId === queueRequest.current
        && mutationEpoch === queueMutationEpoch.current
      ) setRefreshing(false);
    }
  }, []);

  function setCaseReconciliation(attempt) {
    pendingCaseReconciliationRef.current = attempt;
    setPendingCaseReconciliation(attempt);
  }

  function invalidateQueueEconomicTruth(nextState = "REFRESHING") {
    queueTruthGeneration.current += 1;
    setQueueEconomicFreshness(nextState);
  }

  function restoreQueueEconomicTruthAfterDefinitiveFailure(queueMutationToken) {
    if (
      activeQueueMutation.current === queueMutationToken
      && queueRef.current
    ) {
      setQueueEconomicFreshness("CURRENT");
    }
  }

  function beginQueueMutation() {
    const token = queueMutationEpoch.current + 1;
    queueMutationEpoch.current = token;
    activeQueueMutation.current = token;
    queueRequest.current += 1;
    setRefreshing(false);
    invalidateQueueEconomicTruth();
    return token;
  }

  function finishQueueMutation(token) {
    if (activeQueueMutation.current === token) {
      activeQueueMutation.current = null;
    }
  }

  async function loadCurrentQueueTruth() {
    const durable = await loadQueue();
    if (durable && pendingCaseReconciliationRef.current === null) {
      setReconciliationBlocked(false);
    }
    return durable;
  }

  const loadReadiness = useCallback(async () => {
    const requestId = ++readinessRequest.current;
    setReadinessState("LOADING");
    setReadinessError(null);
    try {
      const response = await getStalledOpportunityEligibility();
      if (!mounted.current || requestId !== readinessRequest.current) return null;
      setReadiness(response);
      setReadinessState("READY");
      return response;
    } catch (requestError) {
      if (!mounted.current || requestId !== readinessRequest.current) return null;
      setReadiness(null);
      setReadinessState("ERROR");
      setReadinessError(eligibilityErrorCopy(requestError));
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadQueue();
    loadPilotStatus();
    loadReadiness();
    return () => {
      mounted.current = false;
      queueRequest.current += 1;
      readinessRequest.current += 1;
      pilotStatusRequest.current += 1;
      pilotGuard.current.invalidate();
    };
  }, [loadPilotStatus, loadQueue, loadReadiness]);

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
    await Promise.all([
      loadCurrentQueueTruth(),
      loadPilotStatus(),
      loadReadiness(),
      onRefresh?.()
    ]);
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
    const queueMutationToken = beginQueueMutation();
    setScanState("RUNNING");
    setMutationMessage(null);
    setMutationError(null);
    try {
      const response = await scanStalledOpportunities();
      if (!mounted.current) return;
      scanSummaryRef.current = response.summary;
      setScanSummary(response.summary);
      invalidateQueueEconomicTruth();
      const durable = await loadQueue({ queueMutationToken });
      await Promise.all([loadPilotStatus(), loadReadiness()]);
      if (durable) {
        setMutationMessage(
          "Scan complete. The durable operating queue was refreshed."
        );
      }
    } catch (scanError) {
      if (!mounted.current) return;
      if (isAmbiguousRevenueLeakCaseMutationError(scanError)) {
        invalidateQueueEconomicTruth("UNAVAILABLE");
        setReconciliationBlocked(true);
        const [durable] = await Promise.all([
          loadQueue({ queueMutationToken }),
          loadPilotStatus()
        ]);
        if (durable) setReconciliationBlocked(false);
        setMutationError(durable ? {
          title: "Scan outcome reconciled",
          message: "The scan response was not confirmed. Durable queue truth was reloaded; run another scan only by explicit choice."
        } : {
          title: "Scan outcome unknown",
          message: "Durable queue truth must reload before another mutation is allowed."
        });
      } else {
        restoreQueueEconomicTruthAfterDefinitiveFailure(queueMutationToken);
        setMutationError(queueErrorCopy(scanError));
      }
    } finally {
      finishQueueMutation(queueMutationToken);
      if (mounted.current) setScanState(null);
    }
  }

  async function createRecoveryAction(entry) {
    const queueMutationToken = beginQueueMutation();
    const caseId = entry.case.id;
    const opportunityId = entry.opportunity.id;
    setMutationCaseId(caseId);
    setMutationKind("TAKE_ACTION");
    setMutationMessage(null);
    setMutationError(null);
    try {
      await createRevenueActionForLeakCase(caseId, opportunityId);
      if (!mounted.current) return;
      setReconciliationBlocked(true);
      const durable = await loadQueue({ queueMutationToken });
      if (durable) setReconciliationBlocked(false);
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
        const durable = await loadQueue({ queueMutationToken });
        if (durable) setReconciliationBlocked(false);
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
        restoreQueueEconomicTruthAfterDefinitiveFailure(queueMutationToken);
        setMutationError(queueErrorCopy(handoffError));
      }
    } finally {
      finishQueueMutation(queueMutationToken);
      if (mounted.current) {
        setMutationCaseId(null);
        setMutationKind(null);
      }
    }
  }

  async function runCaseDecision(entry, transition, body) {
    const queueMutationToken = beginQueueMutation();
    const caseId = entry.case.id;
    const opportunityId = entry.historical_opportunity_id;
    const expectedState = transition === "snooze" ? "SNOOZED" : "DISMISSED";
    setMutationCaseId(caseId);
    setMutationKind(expectedState === "SNOOZED" ? "SNOOZE" : "DISMISS");
    setMutationMessage(null);
    setMutationError(null);
    try {
      const response = await transitionRevenueLeakCase(
        caseId,
        transition,
        body,
        opportunityId
      );
      if (!mounted.current) return;
      if (response.data.state !== expectedState) {
        throw Object.assign(new Error("The case response did not confirm the requested lifecycle state."), {
          code: "REVENUE_LEAK_BROWSER_RESPONSE_INVALID",
          status: null
        });
      }
      await loadQueue({ queueMutationToken });
      setCaseReconciliation(null);
      setMutationMessage(expectedState === "SNOOZED"
        ? "Case snoozed with a durable human reason and future wake time."
        : "Case dismissed with a durable human reason. Its evidence and audit history remain inspectable in the opportunity.");
    } catch (decisionError) {
      if (!mounted.current) return;
      if (isAmbiguousRevenueLeakCaseMutationError(decisionError)) {
        try {
          const history = await getOpportunityRevenueLeakCases(opportunityId);
          if (!mounted.current) return;
          const durableCase = history.data.find(item => item.id === caseId);
          await loadQueue({ queueMutationToken });
          setReconciliationBlocked(false);
          if (durableCase?.state === expectedState) {
            setCaseReconciliation(null);
            setMutationMessage(
              `Durable case history confirms ${expectedState}. No duplicate mutation was attempted.`
            );
          } else {
            setCaseReconciliation(null);
            setMutationError({
              title: "Case decision not confirmed",
              message: "Durable case history does not show the requested state. Review current truth before explicitly trying again."
            });
          }
        } catch (historyError) {
          invalidateQueueEconomicTruth("UNAVAILABLE");
          setReconciliationBlocked(true);
          setCaseReconciliation({ caseId, opportunityId, expectedState });
          setMutationError({
            title: "Case decision outcome unknown",
            message: "Durable case history must reload before another case or action mutation is allowed. Open the opportunity to reconcile its full history."
          });
        }
      } else {
        restoreQueueEconomicTruthAfterDefinitiveFailure(queueMutationToken);
        setMutationError(queueErrorCopy(decisionError));
      }
    } finally {
      finishQueueMutation(queueMutationToken);
      if (mounted.current) {
        setMutationCaseId(null);
        setMutationKind(null);
      }
    }
  }

  async function reconcileCaseDecision() {
    const attempt = pendingCaseReconciliation;
    if (!attempt) return;
    const queueMutationToken = beginQueueMutation();
    setMutationCaseId(attempt.caseId);
    setMutationKind("RECONCILE");
    try {
      const history = await getOpportunityRevenueLeakCases(attempt.opportunityId);
      if (!mounted.current) return;
      const durableCase = history.data.find(item => item.id === attempt.caseId);
      await loadQueue({ queueMutationToken });
      setCaseReconciliation(null);
      setReconciliationBlocked(false);
      if (durableCase?.state === attempt.expectedState) {
        setMutationError(null);
        setMutationMessage(
          `Durable case history confirms ${attempt.expectedState}. No duplicate mutation was attempted.`
        );
      } else {
        setMutationError({
          title: "Case decision not confirmed",
          message: "Durable case history does not show the requested state. Review current truth before explicitly trying again."
        });
      }
    } catch (historyError) {
      invalidateQueueEconomicTruth("UNAVAILABLE");
      setMutationError({
        title: "Case decision outcome still unknown",
        message: "Durable case history remains unavailable. No case or action mutation can be retried yet."
      });
    } finally {
      finishQueueMutation(queueMutationToken);
      if (mounted.current) {
        setMutationCaseId(null);
        setMutationKind(null);
      }
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
    || pendingCaseReconciliation
    || queueState !== "READY"
  );
  const scanCredible = readinessState === "READY"
    && ["READY", "PARTIAL"].includes(readiness?.summary?.readiness);
  const credibleHero = selectCredibleHero(queue?.entries || []);
  const { customerEntries, demoEntries } = partitionCredibleCases(visibleEntries);
  const presentedQueueFreshness = queueState === "READY"
    ? queueEconomicFreshness
    : queueEconomicFreshness === null
      ? null
      : "UNAVAILABLE";

  return (
    <section
      className="card revenue-command-center rcc2"
      data-testid="revenue-command-center"
      aria-labelledby="revenue-command-center-title"
    >
      <div className="rcc2-hero">
        <div>
          <span className="eyebrow">REVENUE LEAK QUEUE</span>
          <h3 id="revenue-command-center-title">Find the first credible revenue problem</h3>
          <p>
            See what TGE received, what the server can assess, exact known money,
            why a case matters, and the next human-controlled action.
          </p>
        </div>
      </div>
      <RevenueJourneyPath />

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
            <button type="button" className="oc-secondary-button" onClick={loadCurrentQueueTruth}>
              Retry queue
            </button>
          )}
        </div>
      )}
      {mutationMessage && <div className="rcc2-success" role="status">{mutationMessage}</div>}
      {mutationError && (
        <div className="rcc2-alert" role="alert">
          <strong>{mutationError.title}</strong><span>{mutationError.message}</span>
          {pendingCaseReconciliation && (
            <button
              type="button"
              className="oc-secondary-button"
              disabled={mutationKind === "RECONCILE"}
              onClick={reconcileCaseDecision}
            >
              {mutationKind === "RECONCILE" ? "Reconciling…" : "Reconcile case history"}
            </button>
          )}
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
      <OperationalDataHealth
        readiness={readiness}
        state={readinessState}
        error={readinessError}
        onRetry={loadReadiness}
      />
      <ScanAction
        disabled={controlsDisabled || !scanCredible || queueError?.kind === "UNAUTHORIZED"}
        disabledRefresh={refreshing || reconciliationBlocked || Boolean(pendingCaseReconciliation)}
        running={scanState === "RUNNING"}
        onScan={runScan}
        onRefresh={refreshQueue}
        refreshing={refreshing}
      />
      {scanSummary && (
        <ScanSummary
          summary={scanSummary}
          queue={queue}
          queueFreshness={presentedQueueFreshness}
        />
      )}

      {queue && (
        <>
          {!scanSummary && (
            <QueueSummary
              summary={queue.value_summary}
              freshness={presentedQueueFreshness}
              entries={queue.entries}
            />
          )}
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
            <>
            {customerEntries.length > 0 && (
            <section className="rcc2-case-group" aria-label="Priority customer review">
              <div className="rcc2-case-group-heading">
                <span className="eyebrow">STEP 3 · REVIEW THE STRONGEST CASE</span>
                <h4>Priority customer review</h4>
                <p>The first case follows the server's order. TGE has not re-ranked these customer cases in the browser.</p>
              </div>
            <div className="rcc2-cases">
              {customerEntries.map(entry => (
                <QueueCase
                  key={entry.case.id}
                  entry={entry}
                  expanded={selectedCaseId === entry.case.id}
                  disabled={controlsDisabled || actionsUnavailable}
                  hero={entry.case.id === credibleHero?.case.id}
                  firstImported={entry.case.id === firstImportedCase?.case.id}
                  inspected={pilotStatus?.inspected_case_ids.includes(entry.case.id)}
                  feedback={pilotStatus?.case_feedback.find(item =>
                    item.case_id === entry.case.id
                  )?.feedback_code || null}
                  feedbackCode={feedbackCode}
                  mutating={mutationCaseId === entry.case.id ? mutationKind : null}
                  onToggle={() => toggleCase(entry)}
                  onCreateAction={createRecoveryAction}
                  onDecision={runCaseDecision}
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
            </section>
            )}
            {demoEntries.length > 0 && (
              <details className="rcc2-demo-cases" aria-label="Demo and sample cases">
                <summary>Demo and sample cases · {demoEntries.length} excluded from customer first-value evidence</summary>
                <p>These entries are useful for rehearsal only. Their order is preserved within this section.</p>
                <div className="rcc2-cases">
                  {demoEntries.map(entry => (
                    <QueueCase
                      key={entry.case.id}
                      entry={entry}
                      expanded={selectedCaseId === entry.case.id}
                      disabled={controlsDisabled || actionsUnavailable}
                      hero={false}
                      firstImported={false}
                      inspected={false}
                      feedback={null}
                      feedbackCode={feedbackCode}
                      mutating={mutationCaseId === entry.case.id ? mutationKind : null}
                      onToggle={() => toggleCase(entry)}
                      onCreateAction={createRecoveryAction}
                      onDecision={runCaseDecision}
                      onFeedbackCode={setFeedbackCode}
                      onRetryInspection={() => {}}
                      onSubmitFeedback={submitPilotFeedback}
                      onOpenOpportunity={onOpenOpportunity}
                      pilotDisabled
                      retryInspection={false}
                    />
                  ))}
                </div>
              </details>
            )}
            </>
          )}
        </>
      )}

      <details className="rcc2-secondary" aria-label="Legacy active-pipeline guidance">
        <summary>Operator diagnostics · Legacy opportunity guidance</summary>
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
      </details>
      <PilotJourney status={pilotStatus} />
    </section>
  );
}
