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

// ⚠ WHERE THE MODELLED CURVE MEETS THE MEASURED ROW — the one relationship on this page that
// spans its two halves, and the one nothing was checking.
//
// The page shows a real settled hit (1,645 µLXC charged on a 2,350 µLXC answer) and then, under
// the heading "The same answer, at a pool of N contributors", a modelled bill for THAT answer.
// `economics.ts` used to claim in a comment that the model had been fitted to the row — that the
// first other contributor's arrival reproduces 1645/2350. It has not been, and no test could ever
// have said so: every case above tests the curve against ITSELF (starts at list, falls, flattens,
// sums) and none of them puts the model and the ledger row in the same sentence.
//
// So this pins the crossing: the pool size at which the modelled bill first falls to or below the
// charge the ledger actually recorded. Today it is SEVEN — the curve quotes 2,194 at two
// contributors, 549 µLXC ABOVE the measured row, and does not reach it until 7.
//
// ⚠ THIS PINS A DISAGREEMENT, NOT A TARGET. Whether the curve should be re-fitted so the crossing
// is 2 is a decision about what the front page promises about price, and it is in the queue rather
// than in this diff. When that decision is made this test FAILS, and the failure is the point: it
// is the line that makes someone re-read the comment in economics.ts describing the shape.
//
// ⚠ ONE ASSERTION, DELIBERATELY. `billAt(2)` is the number a visitor sees and pinning it too was
// tempting, but every parameter mutation that moves it moves the crossing as well — decay, floor
// and the ledger charge all reach both — so a second case would have been justified by no mutation
// of its own. The crossing is the wider statement: it reads the model AND the ledger row.
describe('the modelled curve against the measured row', () => {
  /** First pool size whose modelled bill is at or below `target` µLXC; null if the slider never gets there. */
  function firstPoolSizeAtOrBelow(target: number): number | null {
    for (let m = 1; m <= 61; m++) if (billAt(m) <= target) return m
    return null
  }

  it('does not reach the charge the ledger recorded until 7 contributors', () => {
    expect(firstPoolSizeAtOrBelow(LEDGER_HIT.chargedMicroLXC)).toBe(7)
  })
})
