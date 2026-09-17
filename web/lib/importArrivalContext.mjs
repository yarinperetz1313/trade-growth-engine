const ARRIVAL_LABELS = Object.freeze({
  opportunities: "Opportunity export"
});

export function buildImportArrivalContext(result, facts) {
  const committedCount = result?.summary?.committed;
  const sourceLabel = ARRIVAL_LABELS[facts?.source_collection];

  if (
    !Number.isSafeInteger(committedCount)
    || committedCount < 0
    || !sourceLabel
  ) return null;

  return Object.freeze({ committedCount, sourceLabel });
}
