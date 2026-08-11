// The economics the landing page argues, kept OUT of the JSX so the numbers can be unit-tested and
// so a reader can check them without reading layout code.
//
// ⚠ EVERY FIGURE IN LEDGER_HIT IS FROM ONE REAL SETTLED TRANSACTION. They are not illustrative and
// they are not rounded: a page that invents its own arithmetic is one screenshot away from being
// caught, and real numbers from a real row cost nothing to defend. The µLXC/µLENS units are the
// ledger's own — see lxc_ledger and the mint rows in talyvor-lens.
export const LEDGER_HIT = {
  /** What this answer would have cost billed straight to the provider. */
  listMicroLXC: 2350,
  /** What the consumer was actually charged, being served from the pool. */
  chargedMicroLXC: 1645,
  /** The difference, kept by the consumer. list − charged. */
  savedMicroLXC: 705,
  /** Minted to the workspace whose answer was reused, settled after the holdback. */
  contributorEarnedMicroLENS: 822,
} as const

// Derived rather than restated, so the page cannot drift from its own arithmetic. A hardcoded 705
// beside a hardcoded 2350 and 1645 is three numbers that can disagree; this is one.
export const SAVED_CHECK = LEDGER_HIT.listMicroLXC - LEDGER_HIT.chargedMicroLXC

/**
 * The holdback window before a contributor's earnings settle.
 *
 * ⚠ READ FROM SOURCE, not chosen for the page: talyvor-lens internal/config/config.go sets
 * `c.PoolHoldbackWindow = 72 * time.Hour`, overridable by LENS_POOL_HOLDBACK_WINDOW. The window
 * exists so the statistical gaming vectors are detectable inside it before anything is spendable.
 * If that default moves, this line is wrong and the page is wrong — which is why it says 72 hours
 * rather than "a few days", a phrase that would have stayed true and meant nothing.
 */
export const HOLDBACK_HOURS = 72

/**
 * The compounding curve.
 *
 * ⚠ THIS IS A TARGET SHAPE, NOT A MEASUREMENT, and the page says so where it draws it. It is the
 * decided product claim — bills approach zero as the pool grows and usage compounds — expressed as
 * the curve that claim implies, so a visitor can see what is being promised instead of parsing an
 * adjective. Nothing here is presented as observed: LEDGER_HIT is the measured part of this page,
 * and it is labelled as the measured part.
 *
 * Shape: each additional contributing member raises the chance an arriving request already has an
 * answer in the pool, so the share a consumer pays decays. `remaining` is the fraction of list
 * price still paid at a given pool size, bottoming out near zero rather than at zero — the asymptote
 * is the honest form of "approaches".
 */
export function remainingShareAt(members: number): number {
  if (members <= 1) return 1
  // ⚠ THE DECAY IS NOT TUNED TO THE SETTLED HIT, AND THIS COMMENT USED TO SAY IT WAS. It read
  // "Decay tuned so the first member's arrival matches the real settled hit above (1645/2350)".
  // MEASURED, not read: at 2 contributors — the first OTHER contributor, the smallest pool in
  // which a hit is possible at all — this curve renders 2,194 µLXC against the 1,645 the ledger
  // row above it recorded, 549 µLXC HIGHER for the answer the page calls "the same answer". The
  // modelled saving there is 156 against a measured 705, understated 4.5x. The curve does not
  // fall to the settled charge until SEVEN contributors (1,564 at 7; 1,672 at 6, still above).
  // No value of `members` makes the sentence true: matching 1645/2350 = 0.70 exactly needs a
  // decay of ~5.25, not 14.
  //
  // 14 and 0.04 are CHOSEN shape parameters, which is what the page's own caption already tells
  // the visitor ("the shape this is built to reach ... not a measurement"). The comment was the
  // only place claiming the stronger thing — that the shape had been fitted to the measured row —
  // and nothing could fail for it, because a calibration claim in prose is not an assertion.
  // `economics.test.ts` now pins the crossing point so it cannot drift back into silence.
  //
  // ⚠ WHETHER THE CURVE SHOULD PASS THROUGH THE MEASURED ROW IS NOT FIXED HERE — see the queue.
  // Re-fitting the decay changes the bill this page promises at every pool size, and what a
  // front page promises about price is a decision, not a session's guess. Note the direction:
  // today the curve UNDER-promises against the one real row, which is the safe side to be wrong
  // on but is still not what the source said it was doing.
  const decay = Math.exp(-(members - 1) / 14)
  const floor = 0.04
  return floor + (1 - floor) * decay
}

/** µLXC still paid on a 2350 µLXC answer at a given pool size, rounded to whole µLXC. */
export function billAt(members: number): number {
  return Math.round(LEDGER_HIT.listMicroLXC * remainingShareAt(members))
}

/** Whole µLXC kept by the consumer at a given pool size. */
export function savedAt(members: number): number {
  return LEDGER_HIT.listMicroLXC - billAt(members)
}

/** Formats a µ-unit with thin separators, in the ledger's own style. */
export function micro(n: number): string {
  return n.toLocaleString('en-US')
}
