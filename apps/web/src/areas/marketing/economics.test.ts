import { describe, expect, it } from 'vitest'
import { HOLDBACK_HOURS, LEDGER_HIT, SAVED_CHECK, billAt, remainingShareAt, savedAt } from './economics'

// The page's numbers, guarded away from the layout. A marketing page whose arithmetic does not add
// up is one screenshot from being caught, and these figures are quoted as REAL — so they are held
// to the standard of real figures.

describe('the settled hit', () => {
  it('adds up: charged + saved is list', () => {
    expect(LEDGER_HIT.chargedMicroLXC + LEDGER_HIT.savedMicroLXC).toBe(LEDGER_HIT.listMicroLXC)
  })

  it('states the saving rather than restating it — the derived value agrees', () => {
    expect(SAVED_CHECK).toBe(LEDGER_HIT.savedMicroLXC)
  })

  it('charges below list, which is the whole claim', () => {
    expect(LEDGER_HIT.chargedMicroLXC).toBeLessThan(LEDGER_HIT.listMicroLXC)
  })
})

describe('the holdback the page quotes', () => {
  // ⚠ READ FROM talyvor-lens internal/config/config.go: `c.PoolHoldbackWindow = 72 * time.Hour`.
  // This test cannot reach that repo, so it pins the number the page prints and names its source.
  // If the upstream default moves, this is the line that has to move with it — deliberately a
  // constant rather than a vague phrase, because "a few days" would have stayed true and told a
  // reader nothing.
  it('is the 72 hours the gateway actually holds earnings for', () => {
    expect(HOLDBACK_HOURS).toBe(72)
  })
})

describe('the compounding curve', () => {
  it('starts at list price with nobody else in the pool', () => {
    expect(remainingShareAt(1)).toBe(1)
    expect(billAt(1)).toBe(LEDGER_HIT.listMicroLXC)
    expect(savedAt(1)).toBe(0)
  })

  it('falls monotonically as the pool grows — the claim, as a property', () => {
    for (let m = 1; m < 61; m++) {
      expect(billAt(m + 1)).toBeLessThanOrEqual(billAt(m))
    }
  })

  it('approaches zero without reaching it — an asymptote is the honest form of "toward"', () => {
    const far = billAt(61)
    expect(far).toBeGreaterThan(0)
    expect(far).toBeLessThan(LEDGER_HIT.listMicroLXC / 5)
  })

  it('never claims a saving larger than the bill it started from', () => {
    for (const m of [1, 5, 20, 61]) {
      expect(savedAt(m)).toBeLessThanOrEqual(LEDGER_HIT.listMicroLXC)
      expect(savedAt(m) + billAt(m)).toBe(LEDGER_HIT.listMicroLXC)
    }
  })
})
