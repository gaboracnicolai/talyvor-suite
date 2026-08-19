/**
 * Lens spend, grouped by the FEATURE TAG — and what that grouping is NOT.
 *
 * ⚠⚠ THE POPULATION IS EVERY PROXIED CALL, NOT "THE AI FEATURES". MEASURED against talyvor-lens
 * `469a255751c8a124fb132d875ecd0ca32664f88e` (read-only; that repo was held by another tab and
 * was never written to): `handleSpendBy("feature")` is `GROUP BY feature` over `token_events`,
 * and `feature` is written from `r.Header.Get("X-Talyvor-Feature")` in the proxy — a header no
 * caller is required to send. `migrations/0001_init.sql` declares the column TEXT with no NOT
 * NULL. So the empty tag is a real, expected, and probably LARGE bucket: every tool a customer
 * points at Lens off this product's own Setup page sends no such header.
 *
 * ⚠ WHICH IS WHY THE UNTAGGED ROW IS KEPT AND NAMED RATHER THAN FILTERED. A list of `docs-ai-*`
 * rows with the blank one removed would read as a workspace's whole spend while being an
 * arbitrary slice of it — the census failure this repository has caught repeatedly, in the one
 * place where the reader is looking at money.
 *
 * ⚠ AND THE TAGS ARE NOT ALL OPERATIONS. Docs sends the operation (`docs-ai-summarize`,
 * `docs-ai-ask`, …) and says in its own client why — a page-scoped tag "would blow up the
 * cardinality of Lens's by-feature aggregation". TRACK SENDS THE ISSUE'S OWN IDENTIFIER
 * (`internal/ai/engine.go` passes `issue.Identifier` for triage, find-duplicates and summarise),
 * so a workspace using Track gets one row per ISSUE next to the operation rows. That is a
 * property of the upstream call sites, not something this app can normalise away, and the screen
 * says so rather than presenting the list as a menu of features.
 *
 * ⚠ THE COST IS THE PROVIDER'S USD, NOT THE µLXC THE WORKSPACE WAS CHARGED. `SUM(cost_usd)` over
 * the same `token_events.cost_usd` column that `/api/spend/month` sums
 * (talyvor-lens internal/tenant/store.go#monthSpendSQL) — so it is the month card's ledger
 * grouped, not a third source. The WINDOWS differ (rolling days here, calendar month there), so
 * the two are not expected to agree and the screen must not imply they should.
 *
 * ⚠ A ROW THAT CANNOT BE DRAWN IS COUNTED, NEVER SILENTLY DISCARDED — areas/track/issueSearch.ts's
 * rule, and here it is a rule about money: a quietly shorter list understates what was spent.
 */

/** The label the untagged bucket carries, so the empty string never reaches a screen as a blank
 *  row a reader would take for a rendering fault. */
export const UNTAGGED = 'Untagged — no feature header'

export interface FeatureSpendRow {
  /** Lens's tag, or {@link UNTAGGED} when the caller sent no `X-Talyvor-Feature`. */
  feature: string
  /** Provider USD for the window. A float upstream, so every screen dresses it as derived. */
  costUSD: number
  requests: number
}

export type FeatureSpendView =
  | { kind: 'rows'; rows: FeatureSpendRow[]; dropped: number }
  | { kind: 'empty' }
  | { kind: 'unrecognised' }

export function readFeatureSpend(payload: unknown): FeatureSpendView {
  // NOT AN ARRAY IS `unrecognised`, NOT EMPTY. Lens's own zero-row answer is `null`, which
  // lib/api.ts#getJSONArray normalises to `[]` for every list read in this app and documents as
  // deliberate; anything ELSE that is not a list is a shape this app cannot read, and rendering
  // it as "nothing was spent" would be a false claim about money.
  if (!Array.isArray(payload)) return { kind: 'unrecognised' }
  if (payload.length === 0) return { kind: 'empty' }

  const rows: FeatureSpendRow[] = []
  let dropped = 0

  for (const raw of payload) {
    if (typeof raw !== 'object' || raw === null) {
      dropped++
      continue
    }
    const r = raw as Record<string, unknown>
    if (typeof r.feature !== 'string' || typeof r.cost_usd !== 'number' || typeof r.requests !== 'number') {
      dropped++
      continue
    }
    rows.push({
      feature: r.feature === '' ? UNTAGGED : r.feature,
      costUSD: r.cost_usd,
      requests: r.requests,
    })
  }

  // A list that had rows and yielded none is NOT the empty state — something was spent and this
  // app could read none of it. `empty` above is reserved for the list that was genuinely empty.
  if (rows.length === 0) return { kind: 'unrecognised' }
  return { kind: 'rows', rows, dropped }
}
