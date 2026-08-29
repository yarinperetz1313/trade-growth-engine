# Deterministic Contracts

## Known versus unknown
Missing CRM evidence remains unknown. Unknown value does not become zero commercial potential; the score uses `null` where the evidence is absent.

## Health is not close probability
`health.status` is a deterministic risk/quality status derived from recorded data quality, engagement, momentum, staleness, and available commercial evidence. It must not be presented as probability of closing.

## Evidence sources
Deal intelligence reads persisted opportunity, linked prospect, activities, and tasks. It must not invent website, service, location, contact, demand, conversion, revenue, or market-size facts.

## Action loop
Every successful action must be observable in persisted state and in recalculated intelligence. Duplicate requests should be safe and should not create duplicate equivalent tasks or activities.


## Revenue portfolio
The revenue portfolio is a deterministic read model over active opportunities and their existing deal intelligence. Commercial value is known only when it is a positive finite value. Missing, `null`, zero, blank, and non-numeric values are unknown and excluded from known totals; each ranked action exposes `value.known` so the UI never turns unknown into `$0`. This accounting does not change deal-intelligence scoring or the positive-value mutation rule. `STRONG`, `AT_RISK`, `STALE`, `NO_NEXT_ACTION`, and `VALUE_UNKNOWN` remain structured classifications rather than close-probability claims. Classifications can overlap; attention is a deduplicated per-opportunity union of actionable gaps, including `VALUE_UNKNOWN`. `STRONG` is health evidence, not an exemption from actionability. Ranked actions carry the opportunity ID, recorded evidence, and existing action metadata; ties end with the opportunity ID so ordering is stable.
