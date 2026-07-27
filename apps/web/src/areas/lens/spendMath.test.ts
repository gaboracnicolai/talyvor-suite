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
  //
  // ⚠ THIS FIXTURE CARRIED NO `type` AND THE ASSERTIONS BELOW PINNED THE HOLD AS A CHARGE — the
  // sentence directly above was true, written by the author, and contradicted three lines later by
  // `{ model: 'gpt-4o', requests: 1, ulxc: 409_725 }`. That is the hold. So the panel shipped ~4.5x
  // high with a GREEN suite asserting the wrong number, and a tester found it on the live deploy.
  // Real rows always carry `type` (Lens selects it, api.ts maps it); the fixture simply predated
  // anything reading it.
  const rows = [
    { amount: -409_725, type: 'reservation_hold', created_at: '2026-07-21T10:00:00Z', metadata: { requested_model: 'gpt-4o', request_id: 'rq1' } },
    { amount: 409_725, type: 'reservation_release', created_at: '2026-07-21T10:00:01Z', metadata: { requested_model: 'gpt-4o', request_id: 'rq1' } },
    { amount: -120_000, type: 'spend', created_at: '2026-07-21T10:00:02Z', metadata: { requested_model: 'gpt-4o', served_model: 'gpt-4o-mini', request_id: 'rq1' } },
    { amount: -80_000, type: 'spend', created_at: '2026-07-20T09:00:00Z', metadata: { requested_model: 'claude-sonnet-5', served_model: 'claude-sonnet-5' } },
    { amount: 50_000_000, type: 'purchase', created_at: '2026-07-19T08:00:00Z', metadata: { requested_model: 'gpt-4o' } }, // a credit, not spend
  ]

  it('attributes each SETTLED CHARGE to the model that served it, and ignores the hold entirely', () => {
    // Derived from the rule, not from what the code emits: only rows 3 and 4 are type 'spend'.
    // gpt-4o is ABSENT — its only row was the hold, which is a bound and not a bill. Its
    // disappearance is the fix: it used to head this list at 409_725, 3.4x the real charge.
    expect(lxcDebitsByModel(rows, 30, now)).toEqual([
      { model: 'gpt-4o-mini', requests: 1, ulxc: 120_000 },
      { model: 'claude-sonnet-5', requests: 1, ulxc: 80_000 },
    ])
  })

  // ⚠ RENAMED. This said "excludes credits by SIGN" — the superseded rule, and the one that let
  // holds through: a hold is negative and is not a charge, so sign was never the right test.
  it('counts only type=spend, so neither a credit nor a hold reads as spend', () => {
    const total = lxcDebitsByModel(rows, 30, now).reduce((n, a) => n + a.ulxc, 0)
    expect(total).toBe(120_000 + 80_000) // the two settled charges; the 409_725 hold is not one
  })

  it('drops rows with no model claim rather than inventing an "unknown" bucket', () => {
    const withBare = [...rows, { amount: -7, type: 'spend', created_at: '2026-07-21T11:00:00Z', metadata: {} }]
    // 2, not 3: the two settled charges. The hold no longer contributes a phantom request — the
    // live panel read "4 charges" for two requests before this.
    expect(lxcDebitsByModel(withBare, 30, now).reduce((n, a) => n + a.requests, 0)).toBe(2)
  })

  it('respects the window', () => {
    // 2 days keeps the 26-hour-old settled charge and drops the 51-hour-old sonnet debit. gpt-4o
    // is gone from this list for the same reason as above: its only row was the hold.
    expect(lxcDebitsByModel(rows, 2, now).map((a) => a.model)).toEqual(['gpt-4o-mini'])
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
