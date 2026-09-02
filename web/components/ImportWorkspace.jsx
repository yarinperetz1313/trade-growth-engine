import React, {
  useMemo,
  useRef,
  useState
} from "react";

import {
  analyzeImportPreview,
  commitImportBatch,
  createImportPreview,
  getImportCommit,
  getImportPreview
} from "../lib/api";
import {
  createImportOperationGuard,
  hasCompleteSourceIdentity,
  isConfirmedMissingReconciliation,
  requiresImportPostReconciliation
} from "../lib/importContracts.mjs";
import {
  readImportFileAsBase64
} from "../lib/importFile.mjs";

const SOURCE_COLLECTIONS = [
  ["prospects", "Prospects"],
  ["opportunities", "Opportunities"],
  ["tasks", "Tasks"],
  ["activities", "Activities"],
  ["revenue_actions", "Revenue actions (preview only)"]
];

export default function ImportWorkspace() {
  const [phase, setPhase] = useState("upload");
  const [sourceCollection, setSourceCollection] = useState("prospects");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [selections, setSelections] = useState([]);
  const [sourceIdentityColumn, setSourceIdentityColumn] = useState(null);
  const [dataHealthStale, setDataHealthStale] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [operation, setOperation] = useState(null);
  const [sourceSystem, setSourceSystem] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [result, setResult] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [unknownOutcome, setUnknownOutcome] = useState(null);
  const operationGuard = useRef(null);
  const attemptedPreviewRequest = useRef(null);
  const attemptedCommit = useRef(null);
  if (operationGuard.current === null) {
    operationGuard.current = createImportOperationGuard();
  }

  const headers = preview?.batch?.previewSummary?.headers || [];
  const dataHealth = analysis?.dataHealth;
  const sourceIdentityComplete = hasCompleteSourceIdentity(dataHealth);
  const canContinue = Boolean(
    analysis
    && !dataHealthStale
    && dataHealth?.totalRows > 0
    && dataHealth?.rowsWithBlockingErrors === 0
    && sourceIdentityComplete
    && sourceIdentityColumn
    && selections
      .filter(item => item.required)
      .every(item => item.sourceColumn)
  );
  const reviewedRequest = useMemo(() => ({
    sourceSystem: sourceSystem.trim(),
    idempotencyKey,
    sourceIdentitySelection: {
      sourceColumn: sourceIdentityColumn
    },
    selections: selections.map(item => ({
      targetField: item.targetField,
      sourceColumn: item.sourceColumn,
      selectedType: item.selectedType
    }))
  }), [idempotencyKey, selections, sourceIdentityColumn, sourceSystem]);

  async function createPreview() {
    return submitPreview(null);
  }

  async function retryPreview() {
    return submitPreview(attemptedPreviewRequest.current);
  }

  async function submitPreview(savedRequest) {
    if (!file && !savedRequest) return;
    const token = beginOperation("preview");
    if (!token) return;
    let postAttempted = false;
    clearMessages();
    try {
      const request = savedRequest || {
        sourceCollection,
        upload: {
          filename: file.name,
          mediaType: file.type || "text/csv",
          contentBase64: await readImportFileAsBase64(file)
        }
      };
      if (!operationGuard.current.isCurrent(token)) return;
      attemptedPreviewRequest.current = request;
      postAttempted = true;
      const response = await createImportPreview(request);
      if (!operationGuard.current.isCurrent(token)) return;
      acceptPreview(response);
    } catch (caught) {
      if (operationGuard.current.isCurrent(token)) {
        handlePreviewError(caught, postAttempted);
      }
    } finally {
      finishOperation(token);
    }
  }

  function acceptPreview(nextPreview) {
    setPreview(nextPreview);
    setAnalysis(null);
    setSelections([]);
    setSourceIdentityColumn(null);
    setDataHealthStale(false);
    setPhase("preview");
    setUnknownOutcome(null);
    setError(null);
    attemptedPreviewRequest.current = null;
  }

  async function reconcilePreview() {
    const attemptedId = unknownOutcome?.batchId;
    if (!attemptedId) return;
    const token = beginOperation("reconcile-preview");
    if (!token) return;
    setError(null);
    try {
      const response = await getImportPreview(attemptedId);
      if (!operationGuard.current.isCurrent(token)) return;
      acceptPreview(response);
      setNotice("Preview reconciled after an unconfirmed transaction outcome.");
    } catch (caught) {
      if (!operationGuard.current.isCurrent(token)) return;
      if (isConfirmedMissingReconciliation(caught)) {
        setError({
          ...apiError(caught),
          message: "No staged preview was found. You may retry the same upload."
        });
      } else {
        setError(apiError(caught));
      }
    } finally {
      finishOperation(token);
    }
  }

  async function reviewMapping() {
    const token = beginOperation("analysis");
    if (!token) return;
    clearMessages();
    try {
      const response = await analyzeImportPreview(
        preview.batch.id,
        {},
        analysisExpectations(preview)
      );
      if (!operationGuard.current.isCurrent(token)) return;
      acceptAnalysis(response);
      setPhase("mapping");
    } catch (caught) {
      if (operationGuard.current.isCurrent(token)) setError(apiError(caught));
    } finally {
      finishOperation(token);
    }
  }

  function acceptAnalysis(nextAnalysis) {
    setAnalysis(nextAnalysis);
    setSelections((nextAnalysis?.mapping?.fields || []).map(field => ({
      targetField: field.targetField,
      sourceColumn: field.sourceColumn,
      selectedType: field.selectedType || field.declaredType,
      declaredType: field.declaredType,
      required: field.required,
      suggestion: field.suggestion
    })));
    setSourceIdentityColumn(nextAnalysis?.mapping?.sourceIdentity?.sourceColumn || null);
    setDataHealthStale(false);
    setError(null);
  }

  function updateSelection(targetField, sourceColumn) {
    setSelections(current => current.map(item => (
      item.targetField === targetField
        ? { ...item, sourceColumn: sourceColumn || null }
        : item
    )));
    setDataHealthStale(true);
    setNotice(null);
  }

  async function recalculateDataHealth() {
    const token = beginOperation("analysis");
    if (!token) return;
    clearMessages();
    try {
      const response = await analyzeImportPreview(preview.batch.id, {
        selections: selections.map(item => ({
          targetField: item.targetField,
          sourceColumn: item.sourceColumn,
          selectedType: item.selectedType
        })),
        sourceIdentitySelection: {
          sourceColumn: sourceIdentityColumn
        }
      }, analysisExpectations(preview));
      if (!operationGuard.current.isCurrent(token)) return;
      acceptAnalysis(response);
      setNotice("Mapping and Data Health refreshed.");
    } catch (caught) {
      if (operationGuard.current.isCurrent(token)) setError(apiError(caught));
    } finally {
      finishOperation(token);
    }
  }

  function continueToConfirmation() {
    if (!canContinue || operationGuard.current.isPending()) return;
    setIdempotencyKey(current => current || createBrowserIdempotencyKey());
    setConfirmed(false);
    setPhase("confirm");
    clearMessages();
  }

  async function commitReviewed() {
    if (
      !confirmed
      || !sourceSystem.trim()
      || !idempotencyKey
      || operationGuard.current.isPending()
    ) return;
    attemptedCommit.current = {
      batchId: preview.batch.id,
      request: structuredClone(reviewedRequest),
      totalRows: analysis.dataHealth.totalRows
    };
    return submitCommit(attemptedCommit.current);
  }

  async function retryCommit() {
    return submitCommit(attemptedCommit.current);
  }

  async function submitCommit(attempt) {
    if (!attempt) return;
    const token = beginOperation("commit");
    if (!token) return;
    clearMessages();
    setConflict(null);
    try {
      const response = await commitImportBatch(
        attempt.batchId,
        attempt.request,
        { totalRows: attempt.totalRows, reconciled: false }
      );
      if (!operationGuard.current.isCurrent(token)) return;
      acceptResult(response);
    } catch (caught) {
      if (!operationGuard.current.isCurrent(token)) return;
      if (requiresImportPostReconciliation(caught)) {
        setUnknownOutcome({
          kind: "commit",
          batchId: attempt.batchId
        });
        setError(apiError(caught));
        setPhase("unknown-commit");
      } else if (caught?.status === 409 || caught?.code === "IMPORT_COMMIT_CONFLICT") {
        attemptedCommit.current = null;
        setConflict(caught.details || null);
        setError(apiError(caught));
        setPhase("conflict");
      } else {
        attemptedCommit.current = null;
        setError(apiError(caught));
      }
    } finally {
      finishOperation(token);
    }
  }

  async function reconcileCommit() {
    const attempt = attemptedCommit.current;
    if (!attempt) return;
    const token = beginOperation("reconcile-commit");
    if (!token) return;
    setError(null);
    try {
      const response = await getImportCommit(
        unknownOutcome?.batchId || attempt.batchId,
        { totalRows: attempt.totalRows, reconciled: true }
      );
      if (!operationGuard.current.isCurrent(token)) return;
      acceptResult(response);
    } catch (caught) {
      if (!operationGuard.current.isCurrent(token)) return;
      setError(isConfirmedMissingReconciliation(caught)
        ? {
            ...apiError(caught),
            message: "No committed result was found. You may retry the same confirmed request."
          }
        : apiError(caught));
    } finally {
      finishOperation(token);
    }
  }

  function acceptResult(nextResult) {
    setResult(nextResult);
    setUnknownOutcome(null);
    setError(null);
    setPhase("result");
    attemptedCommit.current = null;
  }

  function returnToMapping() {
    setPhase("mapping");
    setConflict(null);
    setError(null);
    setConfirmed(false);
    attemptedCommit.current = null;
  }

  function reset() {
    operationGuard.current.invalidate();
    setPhase("upload");
    setFile(null);
    setPreview(null);
    setAnalysis(null);
    setSelections([]);
    setSourceIdentityColumn(null);
    setDataHealthStale(false);
    setSourceSystem("");
    setConfirmed(false);
    setIdempotencyKey(null);
    setResult(null);
    setConflict(null);
    setUnknownOutcome(null);
    setOperation(null);
    attemptedPreviewRequest.current = null;
    attemptedCommit.current = null;
    clearMessages();
  }

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  function handlePreviewError(caught, postAttempted) {
    if (postAttempted && requiresImportPostReconciliation(caught)) {
      setUnknownOutcome({
        kind: "preview",
        batchId: caught.details?.attemptedId || null
      });
      setError(apiError(caught));
    } else {
      attemptedPreviewRequest.current = null;
      setError(apiError(caught));
    }
  }

  function beginOperation(kind) {
    const token = operationGuard.current.begin(kind);
    if (token) setOperation(kind);
    return token;
  }

  function finishOperation(token) {
    if (operationGuard.current.finish(token)) setOperation(null);
  }

  return (
    <div className="page import-workspace" data-testid="import-workspace">
      <div className="page-actions import-heading">
        <div>
          <h2>Import CRM data</h2>
          <p>Review exact CSV evidence before any canonical record is committed.</p>
        </div>
        {phase !== "upload" && phase !== "result" && (
          <button className="text-button" onClick={reset}>Start another import</button>
        )}
      </div>

      <ImportSteps phase={phase} />

      {phase === "upload" && (
        <UploadStep
          error={error}
          file={file}
          loading={Boolean(operation)}
          onFile={setFile}
          onPreview={createPreview}
          onReconcile={reconcilePreview}
          onRetry={retryPreview}
          sourceCollection={sourceCollection}
          setSourceCollection={setSourceCollection}
          unknownOutcome={unknownOutcome}
        />
      )}

      {phase === "preview" && (
        <PreviewStep
          loading={operation === "analysis"}
          notice={notice}
          onReview={reviewMapping}
          preview={preview}
          error={error}
        />
      )}

      {phase === "mapping" && (
        <MappingStep
          analysis={analysis}
          dataHealthStale={dataHealthStale}
          error={error}
          headers={headers}
          loading={operation === "analysis"}
          notice={notice}
          onContinue={continueToConfirmation}
          onRecalculate={recalculateDataHealth}
          onSelection={updateSelection}
          onSourceIdentity={value => {
            setSourceIdentityColumn(value || null);
            setDataHealthStale(true);
            setNotice(null);
          }}
          selections={selections}
          sourceIdentityColumn={sourceIdentityColumn}
          sourceIdentityComplete={sourceIdentityComplete}
          canContinue={canContinue}
        />
      )}

      {phase === "confirm" && (
        <ConfirmationStep
          analysis={analysis}
          confirmed={confirmed}
          error={error}
          loading={operation === "commit"}
          onBack={returnToMapping}
          onCommit={commitReviewed}
          setConfirmed={setConfirmed}
          setSourceSystem={setSourceSystem}
          sourceSystem={sourceSystem}
        />
      )}

      {phase === "conflict" && (
        <ConflictStep conflict={conflict} error={error} onBack={returnToMapping} />
      )}

      {phase === "unknown-commit" && (
        <UnknownCommitStep
          error={error}
          loading={operation === "reconcile-commit" || operation === "commit"}
          onReconcile={reconcileCommit}
          onRetry={retryCommit}
        />
      )}

      {phase === "result" && <ResultStep result={result} onReset={reset} />}
    </div>
  );
}

function ImportSteps({ phase }) {
  const active = phase === "conflict" || phase === "unknown-commit" ? "commit" : phase;
  const steps = [
    ["upload", "1. Upload"],
    ["preview", "2. Preview"],
    ["mapping", "3. Mapping & health"],
    ["confirm", "4. Confirm"],
    ["commit", "5. Commit"],
    ["result", "6. Result"]
  ];
  return (
    <ol className="import-steps" aria-label="Import progress">
      {steps.map(([id, label]) => (
        <li className={id === active ? "active" : ""} key={id}>{label}</li>
      ))}
    </ol>
  );
}

function UploadStep({
  error,
  file,
  loading,
  onFile,
  onPreview,
  onReconcile,
  onRetry,
  sourceCollection,
  setSourceCollection,
  unknownOutcome
}) {
  const unauthorized = error && [401, 403].includes(error.status);
  return (
    <section className="card import-panel">
      <div className="card-head">
        <div>
          <h3>{unauthorized ? "Import access unavailable" : "Upload CSV"}</h3>
          <p>{unauthorized
            ? "Only an OWNER or ADMIN can run imports."
            : "CSV only. The browser does not evaluate formulas or infer tenant authority."}</p>
        </div>
      </div>
      <div className="import-panel-body">
        {unknownOutcome?.kind === "preview" && (
          <StatusPanel title="Preview outcome unknown" message="Reconcile the attempted batch before retrying this upload.">
            {unknownOutcome.batchId ? (
              <button className="primary" disabled={loading} onClick={onReconcile}>
                {loading ? "Reconciling..." : "Reconcile preview"}
              </button>
            ) : (
              <p>The response omitted a safe batch identifier, so this upload cannot be retried automatically.</p>
            )}
            {error?.status === 404 && (
              <button className="text-button" disabled={loading} onClick={onRetry}>Retry preview</button>
            )}
          </StatusPanel>
        )}
        {error && (
          <StatusPanel title={unauthorized ? null : "Preview unavailable"} message={error.message} tone="error">
            {!unauthorized && !unknownOutcome && (
              <button className="text-button" disabled={loading} onClick={onRetry}>
                Retry preview
              </button>
            )}
          </StatusPanel>
        )}
        <div className="import-form-grid">
          <label>
            <span>Source collection</span>
            <select value={sourceCollection} onChange={event => setSourceCollection(event.target.value)} disabled={loading || Boolean(unknownOutcome)}>
              {SOURCE_COLLECTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>CSV file</span>
            <input
              accept=".csv,text/csv"
              type="file"
              disabled={loading || Boolean(unknownOutcome)}
              onChange={event => onFile(event.target.files?.[0] || null)}
            />
          </label>
        </div>
        <p className="import-empty-copy">{file ? `${file.name} · ${formatBytes(file.size)}` : "No CSV selected yet."}</p>
        {loading ? (
          <div className="import-loading" role="status">Reading immutable CSV evidence…</div>
        ) : (
          <button className="primary" disabled={!file || Boolean(unknownOutcome) || unauthorized} onClick={onPreview}>Create preview</button>
        )}
      </div>
    </section>
  );
}

function PreviewStep({ error, loading, notice, onReview, preview }) {
  const summary = preview?.batch?.previewSummary || {};
  return (
    <>
      {notice && <StatusPanel message={notice} tone="success" />}
      {error && <StatusPanel title="Mapping unavailable" message={error.message} tone="error" />}
      <section className="card import-panel">
        <div className="card-head">
          <div>
            <h3>Raw evidence preview</h3>
            <p>{summary.rowCount} rows · {summary.columnCount} columns · {formatBytes(summary.byteCount)}</p>
          </div>
          <button className="primary" disabled={loading} onClick={onReview}>
            {loading ? "Analyzing..." : "Review deterministic mapping"}
          </button>
        </div>
        {summary.rowCount === 0 ? (
          <div className="import-empty">No data rows were found in this CSV.</div>
        ) : (
          <EvidenceTable preview={preview} />
        )}
      </section>
    </>
  );
}

function EvidenceTable({ preview }) {
  const headers = preview.batch.previewSummary.headers;
  return (
    <div className="import-table-wrap">
      <table className="import-evidence-table">
        <thead><tr><th>Row</th>{headers.map((header, index) => <th key={`${index}:${header}`}>{header}</th>)}</tr></thead>
        <tbody>
          {preview.records.map(record => (
            <tr data-testid={`evidence-row-${record.sourceOrdinal}`} key={record.id}>
              <th>{record.sourceRowNumber}</th>
              {headers.map((header, columnOrdinal) => {
                const evidence = record.rawPayload?.cells?.[columnOrdinal] || {
                  present: false,
                  raw: null,
                  valueKind: "MISSING"
                };
                return (
                  <td key={`${columnOrdinal}:${header}`}>
                    <code>{evidenceLabel(evidence)}</code>
                    <small className={`evidence-kind kind-${evidence.valueKind.toLowerCase()}`}>{evidence.valueKind}</small>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MappingStep({
  analysis,
  canContinue,
  dataHealthStale,
  error,
  headers,
  loading,
  notice,
  onContinue,
  onRecalculate,
  onSelection,
  onSourceIdentity,
  selections,
  sourceIdentityColumn,
  sourceIdentityComplete
}) {
  const usedColumns = new Map(selections.filter(item => item.sourceColumn).map(item => [item.sourceColumn, item.targetField]));
  const unsupported = analysis?.mapping?.status === "UNSUPPORTED_TARGET";
  return (
    <>
      {notice && <StatusPanel message={notice} tone="success" />}
      {error && <StatusPanel title="Mapping or Data Health unavailable" message={error.message} tone="error" />}
      <section className="card import-panel">
        <div className="card-head">
          <div>
            <h3>Deterministic mapping review</h3>
            <p>Suggestions are deterministic, draft, and not accepted automatically.</p>
          </div>
        </div>
        <div className="import-panel-body">
          {unsupported ? (
            <StatusPanel
              title="Canonical mapping unavailable"
              message="This collection can be staged and previewed, but the current canonical import contract does not support committing it."
            />
          ) : (
            <>
              <div className="mapping-identity">
                <MappingEvidence
                  ariaLabel="Source identity evidence"
                  mapping={analysis.mapping.sourceIdentity}
                  title="Source identity"
                />
                <label>
                  <span>Source identity</span>
                  <select disabled={loading} value={sourceIdentityColumn || ""} onChange={event => onSourceIdentity(event.target.value)}>
                    <option value="">Unmapped</option>
                    {headers.map(header => <option key={header} value={header}>{header}</option>)}
                  </select>
                  <small>Separate from the canonical target ID; never uses the synthetic staging locator.</small>
                </label>
              </div>
              <div className="mapping-list">
                {selections.map(selection => {
                  const evidence = analysis.mapping.fields.find(field => (
                    field.targetField === selection.targetField
                  ));
                  return (
                    <div className="mapping-row" key={selection.targetField}>
                      <MappingEvidence
                        ariaLabel={`Mapping evidence for ${selection.targetField}`}
                        mapping={evidence}
                        title={selection.targetField}
                      />
                      <label>
                        <span>Source column</span>
                        <select
                          aria-label={`Map ${selection.targetField}`}
                          disabled={loading}
                          value={selection.sourceColumn || ""}
                          onChange={event => onSelection(selection.targetField, event.target.value)}
                        >
                          <option value="">Unmapped</option>
                          {headers.map(header => (
                            <option
                              disabled={usedColumns.has(header) && usedColumns.get(header) !== selection.targetField}
                              key={header}
                              value={header}
                            >{header}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  );
                })}
              </div>
              <button className="primary" disabled={loading || !sourceIdentityColumn} onClick={onRecalculate}>
                {loading ? "Recalculating..." : "Recalculate Data Health"}
              </button>
            </>
          )}
        </div>
      </section>

      <DataHealth health={analysis?.dataHealth} rows={analysis?.rows} stale={dataHealthStale} />

      <div className="import-footer-actions">
        {!canContinue && (
          <span>{dataHealthStale
            ? "Recalculate after mapping changes before confirmation."
            : unsupported
              ? "This staged collection is preview-only."
            : analysis?.dataHealth?.totalRows === 0
              ? "An empty CSV cannot be committed."
              : !sourceIdentityComplete
                ? "Source identity must cover every staged row before confirmation."
              : "Resolve blocking mapping or row errors before confirmation."}</span>
        )}
        <button className="primary" disabled={loading || !canContinue} onClick={onContinue}>Continue to confirmation</button>
      </div>
    </>
  );
}

function MappingConfirmation({ mapping }) {
  if (!mapping || mapping.status === "UNSUPPORTED_TARGET") return null;
  return (
    <section className="reviewed-mapping">
      <h4>Reviewed mapping evidence</h4>
      <MappingEvidence
        ariaLabel="Source identity evidence"
        mapping={mapping.sourceIdentity}
        title="Source identity"
      />
      <div className="mapping-list">
        {mapping.fields.map(field => (
          <MappingEvidence
            ariaLabel={`Mapping evidence for ${field.targetField}`}
            key={field.targetField}
            mapping={field}
            title={field.targetField}
          />
        ))}
      </div>
    </section>
  );
}

function MappingEvidence({ ariaLabel, mapping, title }) {
  const samples = Array.isArray(mapping?.sampleValues) ? mapping.sampleValues : [];
  const issues = Array.isArray(mapping?.validationIssues) ? mapping.validationIssues : [];
  return (
    <section aria-label={ariaLabel} className="mapping-evidence">
      <h4>{title}</h4>
      <dl>
        <div><dt>Source column</dt><dd>{mapping?.sourceColumn || "Unmapped"}</dd></div>
        <div><dt>Target field</dt><dd>{mapping?.targetField || mapping?.sourceField || "Source identity"}</dd></div>
        <div><dt>Inferred type</dt><dd>{mapping?.inferredType || "UNKNOWN"}</dd></div>
        <div><dt>Selected type</dt><dd>{mapping?.selectedType || mapping?.identityType || "TEXT"}</dd></div>
        <div><dt>Requirement</dt><dd>{mapping?.required ? "Required" : "Optional"}</dd></div>
      </dl>
      <div className="mapping-evidence-detail">
        <strong>Sample values</strong>
        {samples.length === 0 ? (
          <span>None</span>
        ) : (
          <ul>
            {samples.map(sample => (
              <li key={`${sample.sourceOrdinal}:${sample.sourceRowNumber}`}>
                row {sample.sourceRowNumber}: {evidenceLabel(sample)} · {sample.valueKind}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mapping-evidence-detail">
        <strong>Validation issues</strong>
        {issues.length === 0 ? (
          <span>None</span>
        ) : (
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.code}:${issue.sourceOrdinal ?? "mapping"}:${index}`}>
                {issue.code}
                {Number.isInteger(issue.sourceRowNumber) ? ` · row ${issue.sourceRowNumber}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DataHealth({ health, rows = [], stale }) {
  if (!health) return null;
  const sampledIssues = rows.flatMap(row => [
    ...(row.errors || []).map(issue => ({ ...issue, severity: "Blocking", sourceRowNumber: row.sourceRowNumber })),
    ...(row.warnings || []).map(issue => ({ ...issue, severity: "Preserved", sourceRowNumber: row.sourceRowNumber }))
  ]).slice(0, 20);
  return (
    <section className={`card import-panel data-health ${stale ? "stale" : ""}`}>
      <div className="card-head">
        <div>
          <h3>Data Health</h3>
          <p>{stale ? "Mapping changed; these metrics need recalculation." : `All ${health.totalRows} staged rows analyzed.`}</p>
        </div>
      </div>
      <div className="data-health-grid">
        <HealthMetric label="Valid" value={`${health.validRows} valid rows`} />
        <HealthMetric label="Blocking" value={`${health.rowsWithBlockingErrors} rows with blocking errors`} />
        <HealthMetric label="Conflicts" value={`${health.duplicateConflictCount} duplicate conflicts`} />
        <HealthMetric label="Unknown" value={`${health.unknownUnmappedStatuses?.unknownValueCount || 0} unknown values preserved`} />
        <HealthMetric label="Source identity" value={`${health.sourceIdCoverage?.percentage || 0}% coverage`} />
        {health.contactabilityCoverage && (
          <HealthMetric label="Contactability" value={`${health.contactabilityCoverage.percentage}% coverage`} />
        )}
      </div>
      <div className="data-health-details">
        <p><strong>Unmapped source columns:</strong> {listOrNone(health.unknownUnmappedStatuses?.unmappedSourceColumns)}</p>
        <p><strong>Unmapped target fields:</strong> {listOrNone(health.unknownUnmappedStatuses?.unmappedTargetFields)}</p>
        <p><strong>Commercially important missing values:</strong> {formatCounts(health.missingValueCounts)}</p>
        <div>
          <strong>Timestamp coverage:</strong>
          {Object.entries(health.timestampCoverage || {}).length === 0 ? (
            <span> None</span>
          ) : (
            <ul className="timestamp-coverage">
              {Object.entries(health.timestampCoverage).map(([field, coverage]) => (
                <li key={field}>{field}: {coverage.coveredRows}/{coverage.totalRows} covered · {coverage.invalidRows} invalid · {coverage.missingRows} missing ({coverage.percentage}%)</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {sampledIssues.length > 0 && (
        <div className="data-health-issues">
          <h4>Sampled row evidence</h4>
          {sampledIssues.map((issue, index) => (
            <div key={`${issue.sourceRowNumber}:${issue.code}:${index}`}>
              <strong>{issue.severity} · row {issue.sourceRowNumber} · {issue.code}</strong>
              <span>{issue.targetField || issue.identityRole || "Raw row"}</span>
              {issue.rawEvidence && Object.hasOwn(issue.rawEvidence, "valueKind") && (
                <code>{evidenceLabel(issue.rawEvidence)} · {issue.rawEvidence.valueKind}</code>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HealthMetric({ label, value }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function ConfirmationStep({
  analysis,
  confirmed,
  error,
  loading,
  onBack,
  onCommit,
  setConfirmed,
  setSourceSystem,
  sourceSystem
}) {
  const total = analysis.dataHealth.totalRows;
  return (
    <section className="card import-panel">
      <div className="card-head">
        <div>
          <h3>Confirm canonical import</h3>
          <p>This explicit action may create canonical CRM records. It never sends external communications.</p>
        </div>
      </div>
      <div className="import-panel-body confirmation-body">
        {error && <StatusPanel title="Commit unavailable" message={error.message} tone="error" />}
        {error?.code === "IMPORT_COMMIT_VALIDATION_FAILED" && (
          <CommitValidationEvidence details={error.details} />
        )}
        <DataHealth health={analysis.dataHealth} rows={analysis.rows} stale={false} />
        <MappingConfirmation mapping={analysis.mapping} />
        <label>
          <span>Source system</span>
          <input disabled={loading} value={sourceSystem} maxLength={128} onChange={event => setSourceSystem(event.target.value)} placeholder="pilot-crm" />
        </label>
        <label className="confirmation-check">
          <input type="checkbox" checked={confirmed} disabled={loading} onChange={event => setConfirmed(event.target.checked)} />
          <span>I confirm this reviewed mapping and Data Health result.</span>
        </label>
        <div className="import-footer-actions">
          <button className="text-button" disabled={loading} onClick={onBack}>Back to mapping</button>
          <button className="primary" disabled={loading || !confirmed || !sourceSystem.trim()} onClick={onCommit}>
            {loading ? "Committing..." : `Commit ${total} rows`}
          </button>
        </div>
      </div>
    </section>
  );
}

function CommitValidationEvidence({ details }) {
  const failures = Array.isArray(details?.failures)
    ? details.failures.slice(0, 100)
    : [];
  if (failures.length === 0) return null;
  return (
    <div className="data-health-issues">
      <h4>Commit validation evidence</h4>
      <p>{details?.summary?.failed ?? failures.length} failed validation</p>
      {failures.map((failure, index) => (
        <div key={`${failure?.sourceOrdinal}:${failure?.code}:${index}`}>
          <strong>Source ordinal {failure?.sourceOrdinal ?? "unknown"} · {failure?.code || "VALIDATION_FAILED"}</strong>
          {(Array.isArray(failure?.validationErrors) ? failure.validationErrors : []).map((issue, issueIndex) => (
            <code key={`${issue?.code}:${issueIndex}`}>{issue?.code || "VALIDATION_FAILED"}</code>
          ))}
        </div>
      ))}
    </div>
  );
}

function ConflictStep({ conflict, error, onBack }) {
  const details = conflict || {};
  return (
    <section className="card import-panel import-terminal conflict">
      <h3>Import conflict</h3>
      <p>{error?.message || "The reviewed import conflicts with existing identity evidence."}</p>
      <strong>{details.summary?.conflicted ?? 0} conflicted</strong>
      <ul>
        {(details.conflicts || []).map((item, index) => (
          <li key={`${item.code}:${index}`}><code>{item.code}</code>{item.sourceRecordId ? ` · ${item.sourceRecordId}` : ""}</li>
        ))}
      </ul>
      <button className="primary" onClick={onBack}>Return to mapping</button>
    </section>
  );
}

function UnknownCommitStep({ error, loading, onReconcile, onRetry }) {
  return (
    <section className="card import-panel import-terminal warning">
      <h3>Commit outcome unknown</h3>
      <p>The commit acknowledgement is ambiguous. Reconcile this batch before another commit attempt.</p>
      {error && <StatusPanel message={error.message} tone="error" />}
      <div className="import-footer-actions">
        <button className="primary" disabled={loading} onClick={onReconcile}>{loading ? "Reconciling..." : "Reconcile commit"}</button>
        {error?.status === 404 && <button className="text-button" disabled={loading} onClick={onRetry}>Retry same commit</button>}
      </div>
    </section>
  );
}

function ResultStep({ onReset, result }) {
  const summary = result?.summary || {};
  return (
    <section className="card import-panel import-terminal success">
      <h3>Import committed</h3>
      <p>Batch {result?.batch?.id} is committed. No external action was performed.</p>
      {result?.reconciled && <p>Reconciled after an unconfirmed transaction outcome.</p>}
      <div className="result-grid">
        <strong>{summary.committed || 0} committed</strong>
        <strong>{summary.skipped || 0} skipped</strong>
        <strong>{summary.conflicted || 0} conflicted</strong>
        <strong>{summary.failed || 0} failed</strong>
      </div>
      <button className="primary" onClick={onReset}>Start another import</button>
    </section>
  );
}

function StatusPanel({ children, message, title, tone = "warning" }) {
  return (
    <div className={`import-status ${tone}`} role="status">
      {title && <h3>{title}</h3>}
      <p>{message}</p>
      {children}
    </div>
  );
}

function apiError(error) {
  return {
    code: error?.code || null,
    details: error?.details,
    message: error?.message || "The import request could not be completed.",
    status: error?.status || null
  };
}

function analysisExpectations(preview) {
  const summary = preview?.batch?.previewSummary;
  return {
    batchId: preview?.batch?.id,
    headers: summary?.headers,
    sourceCollection: summary?.sourceCollection,
    totalRows: summary?.rowCount
  };
}

function evidenceLabel(evidence) {
  if (!evidence?.present || evidence.valueKind === "MISSING") return "Not supplied";
  if (evidence.valueKind === "BLANK") return "Empty string";
  return evidence.raw;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function listOrNone(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "None";
}

function formatCounts(counts) {
  const entries = Object.entries(counts || {});
  return entries.length
    ? entries.map(([field, count]) => `${field}: ${count}`).join(", ")
    : "None";
}

function createBrowserIdempotencyKey() {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `browser-${random}`;
}
