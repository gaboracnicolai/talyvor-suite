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
  /** Minted to the workspace whose answer was reused, settled after the holdback. */
  contributorEarnedMicroLENS: 822,
} as const

/**
 * The difference, kept by the consumer — DERIVED, and that is now a measurement rather than a
 * preference.
 *
 * ⚠ THIS USED TO BE A THIRD LITERAL (`LEDGER_HIT.savedMicroLXC: 705`) BESIDE A `SAVED_CHECK` THAT
 * NOTHING RENDERED, and the comment on that check claimed the page "cannot drift from its own
 * arithmetic ... this is one [number]". It was not one number: `Landing.tsx` drew the literal, the
 * derived constant had exactly one reference in the whole repo and it was a unit test, so drift was
 * prevented by an ASSERTION, not by construction. The two assertions holding it were also the SAME
 * equation written twice — `charged + saved = list` and `list − charged = saved` — which is why
 * mutating `chargedMicroLXC` reds both and neither could ever be justified on its own.
 *
 * ⚠ AND DERIVING IT WAS NOT A TIDY-UP, WHICH IS WHY IT WAITED FOR A MEASUREMENT. The block above
 * states that every figure in it comes off ONE REAL SETTLED ROW. If the ledger recorded a saving
 * INDEPENDENTLY — after a rounding, a fee, a partial refund — then computing it here would
 * silently invent a number on the one part of this page sold as measured, and 705 = 2350 − 1645
 * exactly is consistent with both stories, so this file could never tell you which it was.
 *
 * ⚠ MEASURED IN talyvor-lens AT `34afe59`, READ-ONLY, AND IT SETTLES IT: THE LEDGER DERIVES THE
 * SAVING THE SAME WAY, DELIBERATELY. `lxc_ledger` has no saving COLUMN at all (migrations 0027 and
 * 0083: amount, balance_after, type, description, metadata, created_at). The saving exists only
 * inside the metadata document, written by `internal/economy.AgentDebitMeta.toSpendMap` — "the only
 * place that disclosure is assembled" — as `pool_saved_ulxc = pool_list_ulxc − the amount ACTUALLY
 * debited`. Its own comment says why it is not a caller-supplied field: "a saving computed by the
 * caller can disagree with what the customer really paid, and then one row states two different
 * prices. Derived, the three numbers reconcile on every row — charged + saved = list." So the two
 * stories were never rivals: read off the row IS list − charged, upstream, by construction. Cited
 * by SYMBOL rather than by line, because a cross-repo line citation decays with no commit here —
 * see #153, where one enum's line numbers had decayed into three contradictory answers.
 *
 * ⚠ THE ONE PLACE THE UPSTREAM RULE AND THIS LINE DIFFER IS THE CLAMP, and the premise that closes
 * it is asserted rather than assumed. `toSpendMap` floors the saving at 0 so a pooled hit can never
 * read as having cost MORE than the live call; this expression does not, and would go negative.
 * The condition under which the two agree is exactly `chargedMicroLXC < listMicroLXC`, which
 * `economics.test.ts` asserts — that case is the premise of this derivation, not decoration. The
 * clamp is deliberately NOT reproduced: on this row it can never fire, so no control could ever
 * reach the branch, and a branch no mutation can exercise is decoration of a different kind.
 */
export const SAVED_MICRO_LXC = LEDGER_HIT.listMicroLXC - LEDGER_HIT.chargedMicroLXC

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
