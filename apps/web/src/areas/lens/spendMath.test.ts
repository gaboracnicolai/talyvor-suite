import { describe, expect, it } from 'vitest'
import { byModel, debitTotal, inWindow, lxcDebitsByModel, type SpendLedgerRow } from './spendMath'

// Mint-ledger sample rows. Declared HERE, in the test, not exported from a module a screen
// could import — the distinction areas/lens/fixtures.ts failed to hold.
const fixtureSpendRows: SpendLedgerRow[] = [
  { id: 'l1', amount_ulens: 420, type: 'pattern_mine', created_at: '2026-07-21T10:00:00Z', metadata: { model_used: 'claude-haiku-4-5' } },
  { id: 'l2', amount_ulens: 180, type: 'pattern_mine', created_at: '2026-07-21T11:30:00Z', metadata: { model_used: 'claude-haiku-4-5' } },
  { id: 'l3', amount_ulens: 950, type: 'pattern_mine', created_at: '2026-07-20T09:15:00Z', metadata: { model_used: 'claude-sonnet-5' } },
  { id: 'l4', amount_ulens: 60, type: 'pattern_mine_held', created_at: '2026-07-05T08:00:00Z', metadata: { model_used: 'claude-haiku-4-5' } },
]


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

// The screens used to say "LXC ledger rows carry no model attribution, so spend has no
// per-model split". That was true at lens 8c70d9e and is false now: every agent-lane writer
// stamps requested_model, and the settle SPEND row also stamps served_model. These rows are
// the shape /api/lxc/history serves today — the caption was outliving the data.
describe('lxcDebitsByModel', () => {
  const now = new Date('2026-07-22T12:00:00Z')
  // A settle pair as Lens actually writes it: the release refunds the whole hold, then the
  // spend row charges what was delivered. Only the spend row is a real charge.
  const rows = [
    { amount: -409_725, created_at: '2026-07-21T10:00:00Z', metadata: { requested_model: 'gpt-4o', request_id: 'rq1' } },
    { amount: 409_725, created_at: '2026-07-21T10:00:01Z', metadata: { requested_model: 'gpt-4o', request_id: 'rq1' } },
    { amount: -120_000, created_at: '2026-07-21T10:00:02Z', metadata: { requested_model: 'gpt-4o', served_model: 'gpt-4o-mini', request_id: 'rq1' } },
    { amount: -80_000, created_at: '2026-07-20T09:00:00Z', metadata: { requested_model: 'claude-sonnet-5', served_model: 'claude-sonnet-5' } },
    { amount: 50_000_000, created_at: '2026-07-19T08:00:00Z', metadata: { requested_model: 'gpt-4o' } }, // a grant — credit, not spend
  ]

  it('attributes each debit to the model that SERVED it, falling back to the requested one', () => {
    // The hold (-409_725) is attributed to gpt-4o (requested; no served model exists
    // pre-route); the delivered charge to gpt-4o-mini (what actually served).
    expect(lxcDebitsByModel(rows, 30, now)).toEqual([
      { model: 'gpt-4o', requests: 1, ulxc: 409_725 },
      { model: 'gpt-4o-mini', requests: 1, ulxc: 120_000 },
      { model: 'claude-sonnet-5', requests: 1, ulxc: 80_000 },
    ])
  })

  it('excludes credits by SIGN, so a grant never reads as spend', () => {
    const total = lxcDebitsByModel(rows, 30, now).reduce((n, a) => n + a.ulxc, 0)
    expect(total).toBe(409_725 + 120_000 + 80_000)
  })

  it('drops rows with no model claim rather than inventing an "unknown" bucket', () => {
    const withBare = [...rows, { amount: -7, created_at: '2026-07-21T11:00:00Z', metadata: {} }]
    expect(lxcDebitsByModel(withBare, 30, now).reduce((n, a) => n + a.requests, 0)).toBe(3)
  })

  it('respects the window', () => {
    // 2 days keeps the 26-hour-old gpt-4o pair and drops the 51-hour-old sonnet debit.
    expect(lxcDebitsByModel(rows, 2, now).map((a) => a.model)).toEqual(['gpt-4o', 'gpt-4o-mini'])
    // 1 day is before every row here — an empty split, not a zero-valued row.
    expect(lxcDebitsByModel(rows, 1, now)).toEqual([])
  })

  it('returns nothing when no row carries a model — the honest empty, not a zero row', () => {
    expect(lxcDebitsByModel([{ amount: -5, created_at: '2026-07-21T10:00:00Z', metadata: {} }], 30, now)).toEqual([])
  })
})

describe('debitTotal', () => {
  it('sums only in-window NEGATIVE amounts, returned positive — credits are not spend', () => {
    const now = new Date('2026-07-22T12:00:00Z')
    const rows = [
      { amount: -640_000, created_at: '2026-07-21T10:00:00Z' }, // debit, in window
      { amount: -1_360_000, created_at: '2026-07-20T09:00:00Z' }, // debit, in window
      { amount: 50_000_000, created_at: '2026-07-19T08:00:00Z' }, // grant credit — excluded by sign
      { amount: -999, created_at: '2026-05-01T00:00:00Z' }, // debit, OUT of window
    ]
    expect(debitTotal(rows, 30, now)).toBe(2_000_000)
    // a 2-day window keeps only the 26-hour-old debit (the 51-hour one drops out)
    expect(debitTotal(rows, 2, now)).toBe(640_000)
  })
})
