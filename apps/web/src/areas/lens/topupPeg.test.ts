import { describe, expect, it } from 'vitest'

import { formatLXC, lxcForCents } from './topupApi'

// W4.10 asks the buy buttons to say what an amount BUYS: "the conversion is the thing they cannot
// do in their head at $0.10 per credit". MEASURED before this change: the buttons rendered the
// dollar amount ALONE.
//
// ⚠ AND THE PEG IS SERVED, NOT WRITTEN HERE. talyvor-lens exposes it on the UNAUTHENTICATED
// `GET /v1/economy/conversion-rate` as `usd_per_lxc`, so this screen needs no second copy of a
// money constant — the defect the sibling `allowedTopUpCents` mirror needs a whole paragraph to
// justify, and which does not apply to a value that HAS an endpoint.

describe('lxcForCents', () => {
  it('converts the advertised amounts at the served peg', () => {
    expect(lxcForCents(1000, 0.1)).toBe(100)
    expect(lxcForCents(5000, 0.1)).toBe(500)
    expect(lxcForCents(10000, 0.1)).toBe(1000)
  })

  // ⚠ THE DIRECTION THAT MATTERS. A wrong conversion on a money screen is worse than none, so an
  // unknown or nonsense peg yields null and the caller renders nothing. Note 0 is what an ABSENT
  // JSON field decodes to, so it must be refused for the same reason undefined is — otherwise a
  // missing peg divides by zero and every amount buys Infinity credits.
  it('refuses to convert when the peg is unknown or nonsense', () => {
    for (const peg of [undefined, 0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lxcForCents(1000, peg as number | undefined)).toBeNull()
    }
    // The control: the same call with a real peg DOES convert, so the nulls above are the peg
    // being refused and not this function being inert.
    expect(lxcForCents(1000, 0.1)).toBe(100)
  })

  it('refuses a non-positive amount', () => {
    expect(lxcForCents(0, 0.1)).toBeNull()
    expect(lxcForCents(-1000, 0.1)).toBeNull()
  })
})

describe('formatLXC', () => {
  it('shows whole credits when the division is exact', () => {
    expect(formatLXC(100)).toBe('100 LXC')
    expect(formatLXC(1000)).toBe('1,000 LXC')
  })

  // An off-peg deployment must not be rounded into a number the customer will not be credited.
  it('keeps two decimals when it is not exact', () => {
    expect(formatLXC(133.333333)).toBe('133.33 LXC')
  })
})
