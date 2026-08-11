import { formatDay } from '@talyvor/ui'
import { describe, expect, it } from 'vitest'
import { formatWhen as lensWhen } from './areas/lens/format'
import { formatWhen as trackWhen } from './areas/track/format'

// THE PRODUCT'S RENDERED CLOCK — asserted as a STRING, in a PINNED zone.
//
// ── WHAT THIS REPLACES, AND THE MEASUREMENT THAT SAYS SO ─────────────────────
//
// `areas/lens/format.ts#formatWhen` draws the timestamp on the ledger row (Ledger.tsx), on
// Overview twice (the balance's "Updated", every activity row) and beside every API key's
// creation (Keys.tsx). Its test was named "formatWhen is stable for a known instant" and
// asserted exactly two things about the output: that it is not the ISO string it was handed,
// and that its length is greater than zero.
//
// MEASURED at `3b27d13`, not read: `hour12: false` → `hour12: true` in that file — the ledger's
// clock flipping from 14:52 to 2:52 PM on four surfaces — left **1069/1069 tests green**, every
// gate in the repo included. Any non-empty string that is not the input satisfied the case that
// existed to hold this function still. The month could change shape, the minutes could lose
// their padding, the zone could change: all of it passes.
//
// The two vacuous assertions are DELETED rather than joined by a real one — an assertion no
// mutation can red is not coverage, it is a claim that coverage exists. What is kept there is
// the junk-echo case, which reads a real branch and does not depend on a clock.
//
// ── WHY THIS FILE NEEDED THE ZONE PINNED FIRST ───────────────────────────────
//
// Neither shipped `formatWhen` passes a `timeZone`, so both render in the READER's zone. That
// is what made the vacuous assertion attractive: you cannot pin a rendered clock as a literal
// until you have decided which clock the gate runs in. The sibling module tried anyway —
// `areas/track/format.test.ts` asserted `/Jul 19/` for `2026-07-19T14:52:59Z` — and that
// assertion is true at UTC, Europe/Bucharest, America/Los_Angeles and Pacific/Midway and FALSE
// past UTC+9:08, where the instant is already the 20th. Measured: the whole apps/web suite is
// green at those four zones and red at Pacific/Kiritimati. CI runs UTC, so the gate agreed with
// itself for as long as nobody ran it from Auckland.
//
// vitest.config.ts pins `TZ: 'Pacific/Kiritimati'` for both projects, and that config states why
// the pin is not UTC: under UTC a zone-dependent formatter and a `timeZone: 'UTC'` one produce
// the SAME string, so the pin that looks safest is the one that would blind this file.
//
// ⚠ THE PINNED ZONE IS THE GATE'S, NEVER THE PRODUCT'S. No surface renders +14 to anybody; the
// product renders the reader's own clock. What the pin buys is that the two rules this product
// ships are legible side by side below: the same instant is "Jul 19, 2026" by `formatDay`'s UTC
// calendar and "Jul 20, 04:52" on the clock — a divergence that is invisible under a UTC gate.
//
// ⚠ WHAT IS NOT DECIDED HERE: whether a LEDGER row should carry the reader's clock at all. An
// instant Lens recorded on Jul 19 is drawn "Jul 20" to a reader far enough east, with no zone
// marker anywhere on the row, so two people reading one ledger read two days. This file pins
// the behaviour that ships; changing it is a product decision and is left to one.

/** The instant both module tests already used, kept so the literals are comparable to theirs. */
const INSTANT = '2026-07-19T14:52:59.743069Z'
/** Same UTC day, early enough that +14 has not crossed midnight — the clock moves, the day does not. */
const SAME_DAY_INSTANT = '2026-07-19T00:30:00Z'

describe('the rendered clock', () => {
  // Catches every option in the shipped `Intl` call at once: the month style, the numeric day,
  // the zero-padded 24-hour time, the separator — and the zone, which no other assertion in the
  // repo reads. A literal, not a shape: a regex over a clock is how the vacuous case happened.
  it('draws a known instant as one exact string', () => {
    expect(lensWhen(INSTANT)).toBe('Jul 20, 04:52')
    expect(lensWhen(SAME_DAY_INSTANT)).toBe('Jul 19, 14:30')
  })

  // figureFace.test.ts documents track's formatWhen as "a second formatWhen, same shape and same
  // answer" as lens's. That was a claim about two modules and NOTHING compared them — each had
  // its own test, so either could have moved alone. This is that sentence, checked.
  it('is one clock: both shipped formatWhen implementations answer identically', () => {
    expect(trackWhen(INSTANT)).toBe(lensWhen(INSTANT))
    expect(trackWhen(SAME_DAY_INSTANT)).toBe(lensWhen(SAME_DAY_INSTANT))
  })

  // The OTHER date rule this product ships, and the must-stay-green companion for every mutation
  // aimed at the clock above. `formatDay` carries `timeZone: 'UTC'` in its own call, so its answer
  // does not depend on the pin — measured: packages/ui is 350/350 green at UTC, Pacific/Midway AND
  // Pacific/Kiritimati. A control that reds BOTH this and the clock has broken the environment,
  // not a formatter, which is what stops a red above from being a catch-all.
  //
  // ⚠ THE TWO RULES DISAGREE, AND THAT IS THE PRODUCT PROPERTY: `INSTANT` is "Jul 19, 2026" here
  // and "Jul 20, 04:52" above — one instant, two days, because one rule is the ledger's calendar
  // and the other is the reader's clock. That is stated rather than asserted: an assertion of the
  // difference would red for exactly the mutations the two cases already catch, and this file's
  // whole subject is assertions that add a name without adding a catcher.
  it('is a different rule from the clock: a UTC calendar day, in every zone', () => {
    expect(formatDay(INSTANT)).toBe('Jul 19, 2026')
    expect(formatDay(SAME_DAY_INSTANT)).toBe('Jul 19, 2026')
  })
})
