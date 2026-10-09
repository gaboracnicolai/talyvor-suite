import { describe, expect, it } from 'vitest'
import { MONEY_CURRENCIES, type ReconciliationRun, reconciliationVerdict } from '../src/reconciliation.ts'

const NOW = new Date('2026-10-10T01:30:00Z')
// Lens's runs as B30.11 writes them for a clean day: one per currency on the Test partner, nothing held, nothing broken.
const clean: ReconciliationRun[] = MONEY_CURRENCIES.map((currency) => ({
  id: `rec_${currency}`, day: '2026-10-09', currency, funding: 'test', partner: 'test', customers_hold_minor: 0, partner_holds_minor: 0,
  shortfall_minor: 0, break_count: 0, breaks: [], ran_at: '2026-10-10T00:05:00Z',
}))
// The payment Lens's own test plants: £7.00 on the ledger that the partner's statement does not show.
const missing = clean.map((r) => (r.currency !== 'GBP' ? r : {
  ...r, break_count: 1, customers_hold_minor: 700, shortfall_minor: 700,
  breaks: [{ kind: 'missing', workspace_id: 'ws', account_id: 'acc', payment_ref: 'test_pbb_never_arrived', ledger_minor: 700, statement_minor: 0, amount_minor: -700 }],
}))

describe('the daily reconciliation oracle (B30.123)', () => {
  it('passes a clean day in every currency', () => {
    expect(reconciliationVerdict(clean, clean, NOW)).toEqual({ pass: true, detail: expect.stringContaining('2026-10-09 reconciled with no break in 4 runs') })
  })

  it('fails on a missing break on the newest day', () => {
    const v = reconciliationVerdict(clean, missing, NOW)
    expect(v).toEqual({ pass: false, detail: expect.stringContaining('2026-10-09 GBP (test) has 1 breaks: missing test_pbb_never_arrived (ledger 700, statement 0)') })
  })

  it('fails on a shortfall in the safeguarding view', () => {
    expect(reconciliationVerdict(missing, clean, NOW)).toEqual({ pass: false, detail: expect.stringContaining('GBP (test) is short 700 minor units') })
  })

  it('fails when a currency was never reconciled, or the newest run is stale', () => {
    const v = reconciliationVerdict(clean.filter((r) => r.currency !== 'USDC'), clean, new Date('2026-10-13T00:00:00Z'))
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('no run in USDC')
    expect(v.detail).toContain('the daily run has stopped')
    expect(reconciliationVerdict([], [], NOW).detail).toContain('lists no run')
    // In the hour after midnight, before the job has run, the day before yesterday is still the newest, and fine.
    expect(reconciliationVerdict(clean, clean, new Date('2026-10-11T00:30:00Z')).pass).toBe(true)
  })
})
