// Pure derivation over mint-ledger-shaped rows. These functions are written
// against the shape /api/tokens/history serves TODAY, so wiring the live route
// in (once the scaffold render-test allows querying screens) is a data-source
// swap with zero logic change — the numbers must not move.
import type { SpendLedgerRow } from './fixtures'

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
