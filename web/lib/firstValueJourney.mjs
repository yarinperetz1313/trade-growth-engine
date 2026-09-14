const CUSTOMER_ORIGINS = new Set([
  "IMPORTED_CUSTOMER",
  "EXISTING_CUSTOMER"
]);

export function selectCredibleHero(entries) {
  if (!Array.isArray(entries)) return null;
  return entries.find(entry => CUSTOMER_ORIGINS.has(entry?.data_origin)) || null;
}

export function buildFirstValueScanResult(summary, queue) {
  const outcomes = summary.outcomes;
  const credibleCaseCount = outcomes.ELIGIBLE_LEAK_DETECTED.count;
  return Object.freeze({
    state: credibleCaseCount > 0 ? "CREDIBLE_CASES" : "NO_CREDIBLE_CASE",
    credible_case_count: credibleCaseCount,
    assessed_no_leak_count: outcomes.ELIGIBLE_NO_LEAK.count,
    limitation_count:
      outcomes.INSUFFICIENT_EVIDENCE.count
      + outcomes.STALE_OR_UNTRUSTWORTHY_SOURCE.count
      + outcomes.DATA_HEALTH_SUPPRESSED.count
      + summary.unevaluated_count,
    active_case_count: queue.total_cases,
    known_totals_by_currency:
      queue.value_summary.known_positive.totals_by_currency,
    known_zero_case_count: queue.value_summary.known_zero.case_count,
    unknown_value_case_count: queue.value_summary.unknown.case_count,
    not_applicable_case_count: queue.value_summary.not_applicable.case_count,
    created_case_count: summary.reconciliation.created_count,
    replayed_case_count: summary.reconciliation.replayed_count,
    superseded_case_count: summary.reconciliation.superseded_count
  });
}
