const CUSTOMER_ORIGINS = new Set([
  "IMPORTED_CUSTOMER",
  "EXISTING_CUSTOMER"
]);

export function selectCredibleHero(entries) {
  if (!Array.isArray(entries)) return null;
  return entries.find(entry => CUSTOMER_ORIGINS.has(entry?.data_origin)) || null;
}

export function partitionCredibleCases(entries) {
  const customerEntries = [];
  const demoEntries = [];
  if (!Array.isArray(entries)) return { customerEntries, demoEntries };
  for (const entry of entries) {
    if (entry?.data_origin === "SAMPLE_DEMO") demoEntries.push(entry);
    else customerEntries.push(entry);
  }
  return { customerEntries, demoEntries };
}

export function buildFirstValueScanResult(summary, queue) {
  const outcomes = summary.outcomes;
  const credibleCaseCount = outcomes.ELIGIBLE_LEAK_DETECTED.count;
  const queueCurrent = queue !== null;
  return Object.freeze({
    state: credibleCaseCount > 0 ? "CREDIBLE_CASES" : "NO_CREDIBLE_CASE",
    credible_case_count: credibleCaseCount,
    assessed_no_leak_count: outcomes.ELIGIBLE_NO_LEAK.count,
    limitation_count:
      outcomes.INSUFFICIENT_EVIDENCE.count
      + outcomes.STALE_OR_UNTRUSTWORTHY_SOURCE.count
      + outcomes.DATA_HEALTH_SUPPRESSED.count
      + summary.unevaluated_count,
    queue_current: queueCurrent,
    active_case_count: queueCurrent ? queue.total_cases : null,
    known_totals_by_currency: queueCurrent
      ? queue.value_summary.known_positive.totals_by_currency
      : null,
    known_zero_case_count: queueCurrent
      ? queue.value_summary.known_zero.case_count
      : null,
    unknown_value_case_count: queueCurrent
      ? queue.value_summary.unknown.case_count
      : null,
    not_applicable_case_count: queueCurrent
      ? queue.value_summary.not_applicable.case_count
      : null,
    created_case_count: summary.reconciliation.created_count,
    replayed_case_count: summary.reconciliation.replayed_count,
    superseded_case_count: summary.reconciliation.superseded_count
  });
}
