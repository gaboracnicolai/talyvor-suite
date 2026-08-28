import { describe, expect, it } from 'vitest'

import { formatCost } from '../track/format'
import { formatUsdPer1M } from './price'

// THE DEFECT, MEASURED AT RENDER TIME AND NOT READ:
//
//   List price · 2.5 in / 10 out per 1M tokens
//
// That is what the chat screen — the ONE surface whose product thesis is showing what a message
// costs — actually put in the DOM. There is no currency mark anywhere in it. `2.5` is not a
// quantity of anything named, and the two figures on one line disagree about their decimals
// because `String(10.00)` is `"10"`.
//
// ⚠ AND THE PRODUCT'S FIGURE AUDIT CANNOT SEE IT, BY DESIGN AND CORRECTLY. figureKind() returns
// null unless an element's own text is a figure ALONE; this text carries words, so it is prose and
// the audit declines to police it (its own "TRAP TWO — A SENTENCE IS NOT A FIGURE"). The currency
// floor therefore never applied here. The audit is not broken — the price simply sits in the one
// shape it does not look at.

describe('formatUsdPer1M', () => {
  it('carries the currency mark and pads money to two decimals', () => {
    expect(formatUsdPer1M(2.5)).toBe('$2.50')
    expect(formatUsdPer1M(10)).toBe('$10.00')
    expect(formatUsdPer1M(180)).toBe('$180.00')
    expect(formatUsdPer1M(0)).toBe('$0.00')
  })

  // ⚠ THE ASSERTION THAT DECIDES THE IMPLEMENTATION. 0.015 is a REAL seeded catalog price
  // (internal/catalog/seed.go — the cheapest InputPer1M of 45 entries). Any formatter that rounds
  // to two decimals corrupts it by a third.
  it('does not round a real sub-cent catalog rate', () => {
    expect(formatUsdPer1M(0.015)).toBe('$0.015')
    expect(formatUsdPer1M(0.02)).toBe('$0.02')
    expect(formatUsdPer1M(0.6)).toBe('$0.60')
  })

  // ⚠ THE CONTROL, AND IT NAMES THE TRAP RATHER THAN DESCRIBING IT. formatCost is this app's house
  // money formatter and is the obvious thing to reach for here. It is CORRECT for the spend figures
  // it was written for — actual dollars, where two decimals IS the money boundary — and WRONG for a
  // per-1M rate: 0.015 is not < 0.01, so it takes the toFixed(2) branch.
  //
  // ⚠ AND IT ROUNDS **DOWN**, WHICH IS NOT THE DIRECTION "round half up" PREDICTS — I asserted
  // $0.02 here first and the test said $0.01. 0.015 has no exact double: it is stored as
  // 0.014999999999999999445, so toFixed(2) is correctly rounding a value that is BELOW the
  // midpoint. The house rule elsewhere in this product is that charges CEIL; this silently floors,
  // and it does so for the cheapest model in the catalog. Guessing the direction of a float
  // rounding is exactly the thing to measure instead.
  it('the house spend formatter corrupts that price by a third, downward', () => {
    expect(formatCost(0.015)).toBe('$0.01')
    expect(formatUsdPer1M(0.015)).not.toBe(formatCost(0.015))
  })

  // Losslessness stated as a property over the real catalog's whole range, not as three examples:
  // stripping the mark and the padding must return the number it was given.
  it('is lossless — the formatted value parses back to the input', () => {
    for (const v of [0.015, 0.02, 0.075, 0.1, 0.15, 0.6, 1, 2.5, 3, 5, 10, 15, 25, 30, 60, 180]) {
      expect(Number(formatUsdPer1M(v).slice(1))).toBe(v)
    }
  })

  // A price the deployment sends that is not a number must not render as "$NaN". The catalog is
  // proxied from Lens, so this client does not get to assume the field is present.
  it('refuses a non-finite value instead of rendering $NaN', () => {
    expect(formatUsdPer1M(Number.NaN)).toBe('—')
    expect(formatUsdPer1M(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatUsdPer1M(undefined as unknown as number)).toBe('—')
  })
})
