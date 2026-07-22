import { describe, expect, it } from 'vitest'
import { byModel, inWindow } from './spendMath'
import { fixtureSpendRows } from './fixtures'

// Pure derivation over ledger-shaped rows: the SAME functions run on live
// /api/tokens/history rows once the BFF wiring lands — swapping the data
// source must not change a number.

describe('byModel', () => {
  it('groups by metadata.model_used, counting requests and summing µLENS, largest first', () => {
    const agg = byModel(fixtureSpendRows)
    expect(agg).toEqual([
      { model: 'claude-sonnet-5', requests: 1, ulens: 950 },
      { model: 'claude-haiku-4-5', requests: 3, ulens: 660 },
    ])
  })
  it('drops rows with no model claim rather than inventing an "unknown" bucket', () => {
    const rows = [...fixtureSpendRows, { id: 'x', amount_ulens: 5, type: 't', created_at: '2026-07-21T00:00:00Z', metadata: {} }]
    expect(byModel(rows).reduce((n, a) => n + a.requests, 0)).toBe(4)
  })
})

describe('inWindow', () => {
  const now = new Date('2026-07-22T12:00:00Z')
  it('keeps only rows within the last N days', () => {
    expect(inWindow(fixtureSpendRows, 7, now).map((r) => r.id)).toEqual(['l1', 'l2', 'l3'])
    expect(inWindow(fixtureSpendRows, 30, now)).toHaveLength(4)
  })
})
