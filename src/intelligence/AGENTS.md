# Intelligence Notes

`dealIntelligence.js` is deterministic. Preserve known/unknown semantics, do not invent market facts, and keep `health.status` separate from close probability. Mutations belong in API action handlers, then intelligence should be recalculated from persisted CRM evidence.

RevenueAction consumes intelligence snapshots but must not change scoring or turn unknown facts into values.
