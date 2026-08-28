import { describe, expect, it } from 'vitest'

import { DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MS } from './BillingReturn'
import { PENDING_MAX_AGE_MS } from './topupApi'

/**
 * THE THREE TIMING CONSTANTS ON THE POST-PAYMENT PATH, WHICH NOTHING DEFENDED.
 *
 * MEASURED 2026-08-28 (tab-k2w8, W4.41) by mutation, not by reading
 * (~/talyvor-queue/w441-web-consts-census-k2w8.py). Population: every
 * module-level `const NAME = <number>` in apps/web/src non-test files — seven of
 * them. Each was changed to a clearly different value and `pnpm test` re-run.
 *
 * Result: 4 CAUGHT, 3 UNPINNED — and the split is not random. Every CAUGHT one
 * is a DISPLAY constant (three page sizes, and HOLDBACK_HOURS which the front
 * page states). All three UNPINNED ones are on the screen a customer lands on
 * AFTER PAYING:
 *
 *   DEFAULT_TIMEOUT_MS  45s -> 45ms   suite green
 *   DEFAULT_POLL_MS     2s  -> 2000s  suite green
 *   PENDING_MAX_AGE_MS  2h  -> 2min   suite green
 *
 * ⚠ WHY THE EXISTING TESTS COULD NOT SEE IT, and it is the same shape found
 * three times in talyvor-lens the same day: BillingReturn.test.tsx is thorough —
 * 15 cases across every state — and every one of them renders
 * `<BillingSuccess pollIntervalMs={5} timeoutMs={400} />`. It has to: the real
 * defaults would make the suite take 45 seconds. So the component is well
 * tested and the DEFAULTS are what nothing bound. A test that supplies the value
 * it is testing cannot notice that value changing.
 *
 * ⚠ THIS FILE CHANGES NO VALUE. Every number recorded is the number already
 * shipping. Whether 2s/45s/2h are the RIGHT numbers is a product judgement about
 * how long to make someone watch a spinner after paying, and is deliberately not
 * taken here.
 */
describe('the post-payment timing contract', () => {
  /**
   * The absolute values are pinned by EQUALITY rather than by a bound, and the
   * reason is stated because the choice went the other way elsewhere this week:
   * a bound needs a property to derive it from. A k-anonymity floor has one (a
   * 2-member cohort mean is invertible, so the floor must exceed 2). These three
   * have none — a shorter timeout is not "safer", it strands a paid customer on
   * a failure message; a longer one is not "safer" either. With nothing to
   * derive, the honest assertion is that a change be DECLARED.
   */
  it('records the shipped values, so changing one is a declared edit and not a silent token', () => {
    expect(DEFAULT_POLL_MS).toBe(2_000)
    expect(DEFAULT_TIMEOUT_MS).toBe(45_000)
    expect(PENDING_MAX_AGE_MS).toBe(2 * 60 * 60 * 1000)
  })

  /**
   * The equality pins above make a change declared. These two invariants make an
   * INCOHERENT change fail even when it is declared — which is the realistic
   * case, because whoever edits a constant edits the pin in the same commit.
   */
  it('gives the page at least two polls before it is allowed to declare a timeout', () => {
    // A timeout shorter than one poll interval means the page announces "we
    // stopped waiting" having asked about the money either once or never.
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * DEFAULT_POLL_MS)
  })

  it('keeps the pre-payment baseline alive longer than the return page waits for it', () => {
    // PENDING_MAX_AGE_MS is how long the balance recorded BEFORE leaving for
    // Stripe stays meaningful; DEFAULT_TIMEOUT_MS is how long the return page
    // polls for a change against it. If the baseline expired first, the page
    // would still be polling for a comparison it had already discarded — and
    // topupApi's own comment says a stale comparison "could announce a success
    // that never happened (or deny one that did)".
    expect(PENDING_MAX_AGE_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS)
  })
})
