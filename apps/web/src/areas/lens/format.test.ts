import { describe, expect, it } from 'vitest'
import { formatUSD, formatWhen, humanizeType, ledgerStatus } from './format'

// These assertions pin the honest type→status mapping (report §Pill). They encode the
// two gaps deliberately: no ledger type is ever 'idle', and account movements get no pill.

describe('ledgerStatus maps real + source ledger types onto the Pill vocabulary', () => {
  it("marks held mints 'held' by suffix (real: pattern_mine_held)", () => {
    expect(ledgerStatus('pattern_mine_held')).toBe('held')
    expect(ledgerStatus('compute_mine_held')).toBe('held')
  })

  it("marks revoked mints 'slashed' by suffix (source-defined *_revoked)", () => {
    expect(ledgerStatus('pattern_mine_revoked')).toBe('slashed')
    expect(ledgerStatus('pool_royalty_revoked')).toBe('slashed')
  })

  it("treats any other counted mint as 'settled' (real: pattern_mine; source: pool_royalty, compute_mine)", () => {
    expect(ledgerStatus('pattern_mine')).toBe('settled')
    expect(ledgerStatus('pool_royalty')).toBe('settled')
    expect(ledgerStatus('compute_mine')).toBe('settled')
    expect(ledgerStatus('a_brand_new_mint_kind')).toBe('settled') // default survives new kinds
  })

  it('gives account MOVEMENTS no status (null → plain label, not a pill)', () => {
    for (const t of ['spend', 'purchase', 'admin_grant', 'convert_to_lxc', 'convert_from_lens']) {
      expect(ledgerStatus(t)).toBeNull()
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
    ]
    expect(types.map(ledgerStatus)).not.toContain('idle')
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

  it('formatWhen is stable for a known instant and echoes junk unchanged', () => {
    expect(formatWhen('not-a-date')).toBe('not-a-date')
    // A real ISO parses to a non-empty, non-echoed label.
    const out = formatWhen('2026-07-19T14:52:59.743069Z')
    expect(out).not.toBe('2026-07-19T14:52:59.743069Z')
    expect(out.length).toBeGreaterThan(0)
  })
})
