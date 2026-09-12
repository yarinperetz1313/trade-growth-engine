# Authoritative opportunity currency

Opportunity currency is optional commercial evidence. A known currency is an
exact string matching `^[A-Z]{3}$`. The contract is deliberately ISO-style: it
does not normalize case or whitespace and does not claim registry validation.
Absent and JSON `null` currency are truthfully unknown. The system never derives
currency from locale, tenant, amount, another opportunity, browser state, or
formatting, and it has no tenant default or FX behavior.

Commercial amount and currency are independent evidence. Amount without
currency retains its existing amount state but cannot become a known monetary
value in the stalled-opportunity/RevenueLeakCase contract. Currency without a
valid amount likewise retains the currency while commercial value stays
unknown. Probability, expected value, and cross-currency comparison remain
outside that deterministic contract.

## Persistence

Local JSON remains the default local authority. Existing opportunity objects
without `currency` remain readable, explicit `null` remains unknown, and
unrelated JSON-compatible fields are preserved. There is no JSON cutover or
dual write.

Append-only migration `016_authoritative_opportunity_currency.sql` adds the
nullable `tge.opportunities.currency` column and a collation-independent check
of exactly three uppercase ASCII bytes. The same byte-exact rule guards the
upgrade preflight. It
promotes only exact valid currency already present in the authoritative
`current_payload` (or the legacy payload when current payload is absent), leaves
missing/null evidence as SQL `NULL`, preserves both JSON payloads at the semantic
JSON level, and fails the entire transaction on malformed or non-string legacy
evidence. Because opportunity RLS is forced, the bounded cross-tenant migration
preflight/backfill uses an owner-only policy created and dropped inside the same
migration transaction. Forced RLS is never disabled; an error rolls the
temporary policy and every schema/data change back. Runtime table grants,
tenant predicates, and trusted `TenantContext` remain unchanged.

New repository writes model currency in the column and exclude it from the
compatibility payload, while unknown JSON fields remain in that payload.
Repository and mutation boundaries reject malformed supplied currency before
state changes. Ordinary opportunity updates preserve the existing currency.

## CSV import and browser behavior

The complete reviewed opportunity mapping vector includes optional `currency`
as `TEXT`. Exact valid codes are stored unchanged. Blank, null, unknown, and
missing cells remain absent currency; lowercase, padded, wrong-length, or other
malformed codes are blocking `COMMERCIAL_CURRENCY_INVALID` evidence. Currency
participates in the normalized commit request and canonical payload
fingerprints, so replay and reconciliation cannot silently change it.
Committed opportunity batches created before currency joined that normalized
vector retain idempotent replay only through their unversioned legacy vector:
the stored mapping, headers, collection, tenant, source identity/system/hash,
row evidence, and request/input fingerprints must all remain exact. New
commits record the currency-aware fingerprint version, and unknown explicit
versions fail closed.

Raw cell evidence stays only in immutable staging evidence until its existing
expiry. Commit failure/audit and Pilot evidence retain bounded outcome codes and
counts, not customer names, source identities, or currency cell contents.
Canonical commit remains tenant-transactional and idempotent.

The browser requires the same complete optional field in analysis responses.
Opportunity value actions submit currency only when the operator typed an exact
canonical code; blank input supplies no currency. Display uses an explicit code
only when persisted truth supplies one and otherwise labels the currency as
unknown. There is no AUD/USD fallback or silent uppercasing/trimming.

## Portfolio monetary truth

Pipeline and revenue-intelligence accumulation accepts only positive amounts
representable as `NUMERIC(20,6)` and converts each amount to exact scaled integer
units. A weighted amount is known only when its required base amount is also
known under that contract. Totals are emitted as decimal strings in alphabetical
authoritative currency groups. The retained scalar total is an exact decimal string
only when every known amount belongs to one authoritative currency; it is `null`
when currencies differ or any known amount lacks valid currency, and remains `0`
when there are no known positive amounts. Grouped totals and withheld counts make
that decision explicit. Missing and malformed currency values remain readable in
legacy JSON, but their amounts are withheld rather than combined or assigned a
unit. The Pipeline browser view performs client-side reduction for its locally
loaded opportunities, using the same exact grouped/withheld and weighted-base
contract; all other summary surfaces render server summaries. No browser surface
presents a unitless combined monetary total. There is no FX or tenant default.

RevenueAction factual evidence continues to preserve its domain's positive-value
and zero/unknown semantics. Exact valid currency remains the canonical code;
absent and `null` retain their legacy missing-currency basis shape. A present
malformed persisted currency is instead retained verbatim with
`currency_valid: false`, so it fails closed as invalid evidence and cannot share
a basis fingerprint with missing/null, a different malformed value, or a valid
canonical currency.
