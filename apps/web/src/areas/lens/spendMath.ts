// Pure derivation over ledger-shaped rows, for BOTH Lens ledgers. These functions run on the
// live /api/tokens/history and /api/lxc/history rows.
//
// The row SHAPE lives here now rather than in a fixtures module: a shape is part of the
// derivation's contract, whereas the sample rows that exercise it belong in the test files.
// areas/lens/fixtures.ts is gone — every screen it fed now reads a real route.

/** A mint-ledger row: the shape /api/tokens/history serves. */
export interface SpendLedgerRow {
  id: string
  amount_ulens: number
  type: string
  created_at: string
  metadata: Record<string, unknown>
}

export interface ModelAgg {
  model: string
  /** How many ledger rows named this model. */
  requests: number
  /** Exact µLENS across those rows — a count, never a float. */
  ulens: number
}

// byModel groups rows by metadata.model_used, largest µ first. Rows without a
// model claim are DROPPED, not bucketed as "unknown": inventing a bucket would
// present absence-of-provenance as a model, which is exactly the kind of quiet
// fabrication this app refuses elsewhere.
export function byModel(rows: SpendLedgerRow[]): ModelAgg[] {
  const agg = new Map<string, ModelAgg>()
  for (const r of rows) {
    const model = r.metadata['model_used']
    if (typeof model !== 'string' || model === '') continue
    const a = agg.get(model) ?? { model, requests: 0, ulens: 0 }
    a.requests += 1
    a.ulens += r.amount_ulens
    agg.set(model, a)
  }
  return [...agg.values()].sort((a, b) => b.ulens - a.ulens || a.model.localeCompare(b.model))
}

// inWindow keeps rows from the last `days` days relative to `now` (exclusive
// lower bound `now - days`). `now` is a parameter, not a wall-clock read, so
// the same call is reproducible in tests and in the UI.
export function inWindow(rows: SpendLedgerRow[], days: number, now: Date): SpendLedgerRow[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  return rows.filter((r) => {
    const t = Date.parse(r.created_at)
    return Number.isFinite(t) && t >= cutoff
  })
}

/** A row with a signed µ amount — either token's normalized ledger shape. */
export interface SignedRow {
  amount: number
  created_at: string
  /** The lxc_ledger row type. ⚠ LOAD-BEARING — see SETTLED_CHARGE below. Optional so the LENS
   *  ledger, which shares this shape, is unaffected. */
  type?: string
}

/** A signed row that still carries its lxc_ledger metadata document. */
export interface SignedRowWithMeta extends SignedRow {
  metadata: Record<string, unknown>
}

// ⚠ WHAT COUNTS AS SPENT — and why summing negative rows was ~4.5x too high.
//
// lxc_ledger carries SIX types. Only ONE of them is a charge:
//
//   spend                 the delivered charge. THIS is spend.
//   reservation_hold      NEGATIVE, but a pre-serve BOUND, not a bill. Released moments later.
//   reservation_release   the compensating credit; nets the hold to zero.
//   grant | purchase | convert_from_lens   credits.
//
// The previous rule was "negative amount = debit", chosen so that "credits are excluded by SIGN,
// not by type string, which stays correct if a new credit type appears". That reasoning is right
// about CREDITS and wrong about HOLDS: a hold is negative and is not a charge. Real production
// rows — a -3270 hold, its +3270 release, and the -920 that was actually billed — summed to 8,380
// where 1,840 was spent.
//
// Lens states this at the writer (internal/economy/agent_subbudget.go:191):
//   "LXCTypeReservationHold marks the pre-serve HOLD debit — a bound, NOT a bill. Revenue readers
//    (sum type='spend') MUST exclude it; it nets to zero against its release."
// `type` survives the whole path — Lens selects it, the BFF proxies it, api.ts maps it — and only
// this file's row interface dropped it, so the sums could not see what they were adding.
//
// ⚠ ALLOW-LIST, NOT DENY-LIST. Excluding 'reservation_hold' by name would silently over-count the
// next negative non-charge type someone adds. Naming the one type that IS a charge fails the other
// way: a genuinely new charge type would be under-counted and visibly missing, which someone
// notices, rather than inflating a number nobody can check.
const SETTLED_CHARGE = 'spend'

/** One model's share of the LXC that left the balance. µLXC, exact integer. */
export interface LxcModelAgg {
  model: string
  requests: number
  ulxc: number
}

// lxcDebitsByModel splits LXC spend per model — the thing two screens used to say was
// impossible ("LXC ledger rows carry no model attribution"). It became possible at lens
// #343 and richer at #355; the rows have carried it on the wire the whole time since, and
// this UI was throwing the field away in api.lxcLedger before anything could read it.
//
// WHICH MODEL A DEBIT BELONGS TO: served_model when present, else requested_model. The hold
// is taken PRE-ROUTE so it can only name the requested model; the delivered-charge spend row
// names both, and there the model that actually served is the truthful attribution for the
// money. Falling back rather than dropping keeps hold-only rows (a settle that never
// completed, a swept reservation) attributed instead of silently absent.
//
// This is the LXC ledger ONLY — µLXC the workspace was charged. It is NOT provider USD COGS
// (token_events / /api/usage), and the two must never be summed into one column: one is what
// the customer paid, the other what the provider cost. Two ledgers, no mixing.
//
// Credits are excluded by SIGN, like debitTotal, so a grant or purchase can never read as
// spend. Rows with no model claim are DROPPED, not bucketed as "unknown" — same rule as
// byModel: absence of provenance is not a model.
export function lxcDebitsByModel(rows: SignedRowWithMeta[], days: number, now: Date): LxcModelAgg[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  const agg = new Map<string, LxcModelAgg>()
  for (const r of rows) {
    const t = Date.parse(r.created_at)
    if (!Number.isFinite(t) || t < cutoff) continue
    if (r.amount >= 0) continue // credit, not spend
    const served = r.metadata['served_model']
    const requested = r.metadata['requested_model']
    const model =
      typeof served === 'string' && served !== ''
        ? served
        : typeof requested === 'string' && requested !== ''
          ? requested
          : ''
    if (model === '') continue
    // Holds carry model metadata too, so without this they inflated BOTH the µLXC and the request
    // count — two holds and two charges read as "4 charges" for two requests.
    if (r.type !== SETTLED_CHARGE) continue
    const a = agg.get(model) ?? { model, requests: 0, ulxc: 0 }
    a.requests += 1
    a.ulxc += -r.amount
    agg.set(model, a)
  }
  return [...agg.values()].sort((a, b) => b.ulxc - a.ulxc || a.model.localeCompare(b.model))
}

// debitTotal sums the SETTLED CHARGES inside the window and returns the total as a POSITIVE µ
// count — what the workspace was actually billed. See SETTLED_CHARGE above for why this is an
// allow-list on the type rather than a test on the sign.
//
// ⚠ A row with no `type` still falls back to the sign test, because the LENS ledger shares this
// shape and does not have lxc_ledger's types. That fallback is only correct for ledgers whose
// every negative row IS a charge — true of the mint ledger, and the reason this stayed unnoticed.
export function debitTotal(rows: SignedRow[], days: number, now: Date): number {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  let total = 0
  for (const r of rows) {
    const t = Date.parse(r.created_at)
    if (!Number.isFinite(t) || t < cutoff) continue
    if (typeof r.type === 'string' ? r.type === SETTLED_CHARGE : r.amount < 0) {
      total += -r.amount
    }
  }
  return total
}
