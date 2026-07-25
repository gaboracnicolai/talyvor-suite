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
}

/** A signed row that still carries its lxc_ledger metadata document. */
export interface SignedRowWithMeta extends SignedRow {
  metadata: Record<string, unknown>
}

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
    const a = agg.get(model) ?? { model, requests: 0, ulxc: 0 }
    a.requests += 1
    a.ulxc += -r.amount
    agg.set(model, a)
  }
  return [...agg.values()].sort((a, b) => b.ulxc - a.ulxc || a.model.localeCompare(b.model))
}

// debitTotal sums the DEBITS (negative amounts) inside the window and returns
// the total as a POSITIVE µ count — "how much left the balance". Credits
// (grants, purchases, conversions) are excluded by SIGN, not by type string,
// which stays correct if a new credit type appears. Exact integer µ, no float.
export function debitTotal(rows: SignedRow[], days: number, now: Date): number {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  let total = 0
  for (const r of rows) {
    const t = Date.parse(r.created_at)
    if (!Number.isFinite(t) || t < cutoff) continue
    if (r.amount < 0) total += -r.amount
  }
  return total
}
