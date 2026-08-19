import { describe, expect, it } from 'vitest'

import { UNTAGGED, readFeatureSpend } from './featureSpend'

// What /api/spend/by-feature said, and what it CANNOT say.
//
// The upstream aggregate is `GROUP BY feature` over `token_events`
// (talyvor-lens internal/api/server.go#Server.handleSpendBy at `469a2557`), so the population is
// EVERY proxied call in the window — not "the AI features". The two facts that follow from that
// are the two this reader exists to preserve.

const row = (over: Record<string, unknown> = {}) => ({
  feature: 'docs-ai-summarize',
  cost_usd: 0.0031,
  requests: 2,
  input_tokens: 900,
  output_tokens: 40,
  ...over,
})

describe('readFeatureSpend', () => {
  it('reads the tag, the cost and the request count', () => {
    const v = readFeatureSpend([row()])
    expect(v).toEqual({
      kind: 'rows',
      rows: [{ feature: 'docs-ai-summarize', costUSD: 0.0031, requests: 2 }],
      dropped: 0,
    })
  })

  // ⚠⚠ THE UNTAGGED BUCKET IS THE ONE ROW A "WHAT YOUR AI FEATURES COST" CARD WOULD BE TEMPTED
  // TO HIDE, AND HIDING IT IS THE DEFECT. `token_events.feature` is TEXT with no NOT NULL and the
  // proxy writes `r.Header.Get("X-Talyvor-Feature")` — an empty string for every caller that does
  // not set it, which is every tool this product's own Setup page tells a customer to point at
  // Lens. Dropping it would leave a list of AI tags that reads as the whole of a workspace's
  // spend while being an arbitrary slice of it.
  it('keeps the untagged bucket and names it', () => {
    const v = readFeatureSpend([row({ feature: '', cost_usd: 4.2, requests: 900 })])
    expect(v).toEqual({
      kind: 'rows',
      rows: [{ feature: UNTAGGED, costUSD: 4.2, requests: 900 }],
      dropped: 0,
    })
  })

  // Upstream is ORDER BY cost_usd DESC and the card shows the WHOLE list, so the order is
  // upstream's and is not re-derived here. Asserted so a future local sort has to argue with a
  // test rather than quietly disagree with the hint the card prints.
  it('preserves upstream order', () => {
    const v = readFeatureSpend([
      row({ feature: 'b', cost_usd: 2 }),
      row({ feature: 'a', cost_usd: 1 }),
    ])
    expect(v.kind === 'rows' && v.rows.map((r) => r.feature)).toEqual(['b', 'a'])
  })

  // A row that cannot be drawn is COUNTED, never silently discarded — areas/track/issueSearch.ts's
  // rule, for the same reason: a quietly shorter list is a lie about how much was spent.
  it('counts rows it cannot read instead of dropping them silently', () => {
    const v = readFeatureSpend([row(), null, { feature: 'x' }, row({ cost_usd: 'free' })])
    expect(v).toEqual({
      kind: 'rows',
      rows: [{ feature: 'docs-ai-summarize', costUSD: 0.0031, requests: 2 }],
      dropped: 3,
    })
  })

  // `[]` is what api.getJSONArray hands over for Lens's `null` — a workspace that has spent
  // nothing in the window. It is EMPTY, and it is not a fault.
  it('an empty list is empty, not a fault', () => {
    expect(readFeatureSpend([])).toEqual({ kind: 'empty' })
  })

  // Everything unreadable is empty too — but only when it was a LIST. A non-array is a shape this
  // app does not recognise and must never render as "you have spent nothing".
  it('a non-array is unrecognised, never empty', () => {
    for (const bad of [null, undefined, {}, 'null', 0, { error: 'boom' }]) {
      expect(readFeatureSpend(bad), String(bad)).toEqual({ kind: 'unrecognised' })
    }
  })

  // A list whose every row is unreadable is NOT the empty state: something was spent and this app
  // could not read any of it. Saying "nothing was spent" there would be a false claim about money.
  it('a list of only unreadable rows is unrecognised, not empty', () => {
    expect(readFeatureSpend([null, 1, 'x'])).toEqual({ kind: 'unrecognised' })
  })
})
