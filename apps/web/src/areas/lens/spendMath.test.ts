import { describe, expect, it } from 'vitest'
import { byModel, debitTotal, inWindow, lxcDebitsByModel, type SignedRow, type SpendLedgerRow } from './spendMath'

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
    // `type: 'spend'` so the MISSING MODEL is the only reason this drops. Without it the row was
    // a settled charge and a modelless row at once, and the empty result had two explanations.
    const row = { amount: -5, created_at: '2026-07-21T10:00:00Z', type: 'spend', metadata: {} }
    expect(lxcDebitsByModel([row], 30, now)).toEqual([])
  })
})

describe('debitTotal', () => {
  // ⚠ THIS TEST USED TO CARRY NO `type` ON ANY ROW, AND SO COULD NOT SEE THE RULE THE FILE IS
  // ABOUT. It asserted "sums only in-window NEGATIVE amounts" — the SIGN rule that read 4.5x
  // high in production and that SETTLED_CHARGE replaced. Every row lacking `type` took
  // debitTotal's `typeof`-fallback, so the allow-list was never once evaluated here.
  // MEASURED, not argued: with the old fixture, mutating `SETTLED_CHARGE` to 'spend_x' left
  // this describe block GREEN while four sibling `lxcDebitsByModel` tests went red — the money
  // total's only unit test was blind to the constant that decides what money is.
  it('sums the settled charges only — a negative reservation_hold is a bound, not a bill', () => {
    const now = new Date('2026-07-22T12:00:00Z')
    // Real lxc_ledger shapes, one complete request cycle plus a second charge.
    const rows: SignedRow[] = [
      { amount: -3_270, created_at: '2026-07-21T10:00:00Z', type: 'reservation_hold' }, // negative, NOT a bill
      { amount: 3_270, created_at: '2026-07-21T10:00:02Z', type: 'reservation_release' }, // nets the hold
      { amount: -920, created_at: '2026-07-21T10:00:02Z', type: 'spend' }, // the delivered charge
      { amount: -1_360_000, created_at: '2026-07-20T09:00:00Z', type: 'spend' },
      { amount: 50_000_000, created_at: '2026-07-19T08:00:00Z', type: 'purchase' }, // credit
      { amount: -999, created_at: '2026-05-01T00:00:00Z', type: 'spend' }, // charge, OUT of window
    ]
    // 1_360_000 + 920. The naive sum of negatives would be 1_365_189.
    expect(debitTotal(rows, 30, now)).toBe(1_360_920)
    // a 2-day window keeps only the 26-hour-old charge (the 51-hour one drops out)
    expect(debitTotal(rows, 2, now)).toBe(920)
  })

  // ⚠ THE BRANCH THIS REPLACES WAS DEAD, AND ITS COMMENT WAS FALSE ABOUT THE LEDGER IT NAMED.
  // debitTotal used to fall back to the sign test for any row whose `type` was not a string,
  // "because the LENS ledger shares this shape and does not have lxc_ledger's types". MEASURED:
  // `api.LedgerRow.type` is a REQUIRED string that BOTH `api.lensLedger` and `api.lxcLedger`
  // set from the wire; lens serialises `Type string \`json:"type"\`` (no omitempty) over a
  // NOT NULL column; and the LENS ledger's types are precisely what `format.ts#ledgerStatus`
  // classifies by suffix. So no row this product can build reached the fallback, and a LENS row
  // would have been excluded by the allow-list rather than sign-summed anyway.
  //
  // It is asserted rather than merely deleted because `type` being required is a compile-time
  // claim over untyped JSON: a cast, an `any`, or a fetch that skips api.ts all reproduce the
  // shape, and if the fallback ever returns, the 4.5x sign rule returns with it on the same
  // money figure and nothing else in the tree would say so.
  it('does not count a row whose type is missing — the sign rule is gone, not merely unused', () => {
    const now = new Date('2026-07-22T12:00:00Z')
    const untyped = [{ amount: -640_000, created_at: '2026-07-21T10:00:00Z' }] as unknown as SignedRow[]
    expect(debitTotal(untyped, 30, now)).toBe(0)
  })
})
