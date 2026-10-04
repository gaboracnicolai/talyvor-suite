import { describe, expect, it } from 'vitest'
import { HOLDBACK_HOURS, LEDGER_HIT, SAVED_MICRO_LXC } from './economics'

// The page's numbers, guarded away from the layout. A marketing page whose arithmetic does not add
// up is one screenshot from being caught, and these figures are quoted as REAL — so they are held
// to the standard of real figures.

describe('the settled hit', () => {
  /**
   * ⚠ TWO ASSERTIONS WERE DELETED HERE AND NOT RETARGETED, WHICH IS WORTH THE PARAGRAPH.
   *
   * They were `charged + saved === list` and `SAVED_CHECK === saved` — the SAME equation written
   * twice, over a third literal `LEDGER_HIT.savedMicroLXC: 705` that the page rendered while the
   * derived constant beside it was referenced by nothing but line 14 of this file. With the saving
   * now DERIVED in `economics.ts`, both restate `charged + (list − charged) === list`: true for
   * every value of every constant, so no mutation can red either. An assertion no control can
   * claim is decoration, and decoration on a money page reads as coverage — MEASURED, not argued:
   * re-added in derived form, `listMicroLXC` 2350→2400 and `chargedMicroLXC` 1645→1700 each leave
   * both green while the crossing-point case below reds. See w11-saved-derivation-controls.py, D2.
   *
   * ⚠ BUT THE DELETION ALONE WOULD HAVE COST REAL COVERAGE, AND THAT WAS MEASURED BEFORE IT WAS
   * REPLACED. The third literal WAS the cross-check: `charged + saved === list` reds on a change to
   * ANY ONE of the three, so it pinned `listMicroLXC` and `chargedMicroLXC` as a side effect. With
   * the saving derived and nothing put back, `listMicroLXC` 2350→2400 is caught by NOTHING —
   * measured on this tree: `pnpm test` EXIT 0, apps/web 1068/1068, packages/ui 350/350. The front
   * page's list price could move and no gate in this repo would notice. The prescription that
   * reached this session said "delete them rather than retarget them" and stopped one step short.
   *
   * So the two figures the page quotes as READ OFF A ROW are now pinned DIRECTLY, which is the
   * shape `HOLDBACK_HOURS` below already uses for the same reason: a number this repo cannot
   * re-derive, pinned with its source named. It is also STRICTLY STRONGER than what it replaces —
   * the old equation was blind to a coordinated change that kept the arithmetic true (a different
   * settled row quoted wholesale), and these are not.
   */
  it('quotes the settled row it says it quotes', () => {
    // ⚠ THE PROVENANCE, NOT A PREFERENCE. These are the list price and the pooled charge of ONE
    // real settled transaction in talyvor-lens's `lxc_ledger` — the block's own header stakes the
    // page on that. Nothing in this repo can re-derive them, so a test is the only thing that can
    // notice them moving. If a DIFFERENT row is ever quoted, this is the line that has to move
    // with it, deliberately, rather than a number sliding in under an unchanged sentence.
    expect(LEDGER_HIT.listMicroLXC).toBe(2350)
    expect(LEDGER_HIT.chargedMicroLXC).toBe(1645)
    expect(LEDGER_HIT.contributorEarnedMicroLENS).toBe(822)
  })

  /**
   * What is NOT decoration is the case immediately below, and its job changed with this merge.
   */
  it('charges below list — the whole claim, and the premise the derivation rests on', () => {
    // ⚠ THIS IS NOW LOAD-BEARING, not a restatement of the obvious. talyvor-lens writes the
    // ledger's own saving as `max(0, pool_list_ulxc − charged)` (internal/economy
    // AgentDebitMeta.toSpendMap); `SAVED_MICRO_LXC` omits that clamp, because on this row the
    // clamp can never fire and a branch no mutation can reach is decoration of its own. The
    // condition under which the unclamped form agrees with the upstream one is EXACTLY this
    // inequality. If a future row is ever quoted here with a charge at or above list, the page's
    // saving and the ledger's would disagree and this is the case that says so.
    expect(LEDGER_HIT.chargedMicroLXC).toBeLessThan(LEDGER_HIT.listMicroLXC)
    expect(SAVED_MICRO_LXC).toBeGreaterThan(0)
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
