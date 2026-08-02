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
  // Decay tuned so the first member's arrival matches the real settled hit above (1645/2350) and
  // the curve flattens toward a floor as the pool gets large.
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
