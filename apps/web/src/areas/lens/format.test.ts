import { describe, expect, it } from 'vitest'
import { formatUSD, formatWhen, humanizeType, ledgerStatus } from './format'

// These assertions pin the honest type→status mapping (report §Pill). They encode the
// two gaps deliberately: no ledger type is ever 'idle', and account movements get no pill.

describe('ledgerStatus maps real + source MINT types onto the Pill vocabulary', () => {
  it("marks held mints 'held' by suffix (real: pattern_mine_held)", () => {
    expect(ledgerStatus('pattern_mine_held', 'lens')).toBe('held')
    expect(ledgerStatus('compute_mine_held', 'lens')).toBe('held')
  })

  it("marks revoked mints 'slashed' by suffix (source-defined *_revoked)", () => {
    expect(ledgerStatus('pattern_mine_revoked', 'lens')).toBe('slashed')
    expect(ledgerStatus('pool_royalty_revoked', 'lens')).toBe('slashed')
  })

  it("treats any other counted mint as 'settled' (real: pattern_mine; source: pool_royalty, compute_mine)", () => {
    expect(ledgerStatus('pattern_mine', 'lens')).toBe('settled')
    expect(ledgerStatus('pool_royalty', 'lens')).toBe('settled')
    expect(ledgerStatus('compute_mine', 'lens')).toBe('settled')
    expect(ledgerStatus('a_brand_new_mint_kind', 'lens')).toBe('settled') // default survives new kinds
  })

  it('gives account MOVEMENTS no status (null → plain label, not a pill)', () => {
    for (const t of ['spend', 'purchase', 'admin_grant', 'convert_to_lxc', 'convert_from_lens']) {
      expect(ledgerStatus(t, 'lens')).toBeNull()
    }
  })

  it("never returns 'idle' — no ledger row is ever idle (the variant has no data source)", () => {
    const types = [
      'pattern_mine',
      'pattern_mine_held',
      'pattern_mine_revoked',
      'pool_royalty',
      'compute_mine',
      'spend',
      'purchase',
      'admin_grant',
      'convert_to_lxc',
      'convert_from_lens',
      // The two lxc_ledger types this sweep never named. `types.map(ledgerStatus)` used to
      // pass map's INDEX as the second argument the day one was added — so the call is
      // spelled out now rather than point-free.
      'reservation_hold',
      'reservation_release',
    ]
    for (const token of ['lens', 'lxc'] as const) {
      expect(types.map((t) => ledgerStatus(t, token)), token).not.toContain('idle')
    }
  })
})

describe('formatters', () => {
  it('µUSD → USD string', () => {
    expect(formatUSD(1_499_993)).toBe('$1.50')
    expect(formatUSD(0)).toBe('$0.00')
  })

  it('humanizeType strips underscores', () => {
    expect(humanizeType('pattern_mine_held')).toBe('pattern mine held')
  })

  // ⚠ THE RENDERED CLOCK IS ASSERTED IN src/renderedClock.test.ts, NOT HERE. This case used to
  // also claim to be "stable for a known instant" and checked only that the output was non-empty
  // and was not the ISO string it was handed — measured at `3b27d13`, flipping this formatter to
  // `hour12: true` left all 1069 tests green. Those two assertions are deleted rather than joined
  // by a real one; what a literal needed was a pinned gate zone, which vitest.config.ts now sets.
  // What survives here is the branch that has no clock in it at all.
  it('echoes an unparseable timestamp unchanged rather than inventing one', () => {
    expect(formatWhen('not-a-date')).toBe('not-a-date')
  })
})
