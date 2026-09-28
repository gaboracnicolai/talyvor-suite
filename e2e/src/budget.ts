// B17.3 — THE HARD SPEND CAP.
//
// Every request that can cost money reserves its WORST case before it is sent (its whole input plus
// the most output it may produce, at the model's list price) and is settled with what it actually
// cost once the answer is in. A reservation that would take committed + held past the cap is refused
// and the request is never sent, so the run cannot spend more than the cap even with every in-flight
// answer at its maximum. After the first refusal the cap stays shut: no new work starts.

export class CapReached extends Error {
  constructor(capUSD: number) {
    super(`spend cap of $${capUSD.toFixed(2)} reached — nothing more is sent`)
  }
}

export interface Hold {
  readonly worstUSD: number
}

export class SpendCap {
  readonly capUSD: number
  private committedUSD = 0
  private heldUSD = 0
  private shut = false
  private refusedCount = 0

  constructor(capUSD: number) {
    if (!(capUSD > 0)) throw new Error('the spend cap must be positive')
    this.capUSD = capUSD
  }

  /** Reserves worstUSD, or throws CapReached without reserving anything. */
  reserve(worstUSD: number): Hold {
    if (!(worstUSD >= 0) || !Number.isFinite(worstUSD)) throw new Error(`bad worst case ${worstUSD}`)
    if (this.shut || this.committedUSD + this.heldUSD + worstUSD > this.capUSD) {
      this.shut = true
      this.refusedCount++
      throw new CapReached(this.capUSD)
    }
    this.heldUSD += worstUSD
    return { worstUSD }
  }

  /**
   * Releases the hold and commits what the request cost. An unknown cost commits the whole worst case:
   * a charge nobody could read is counted at the most it could have been, never at zero.
   */
  settle(hold: Hold, actualUSD: number | undefined): void {
    this.heldUSD = Math.max(0, this.heldUSD - hold.worstUSD)
    const cost = actualUSD === undefined || !Number.isFinite(actualUSD) || actualUSD < 0 ? hold.worstUSD : actualUSD
    this.committedUSD += cost
  }

  get spentUSD(): number {
    return this.committedUSD
  }

  get inFlightUSD(): number {
    return this.heldUSD
  }

  get reached(): boolean {
    return this.shut
  }

  get refused(): number {
    return this.refusedCount
  }
}

/** Tokens a text will cost at most as input: generous, so the worst case is never an underestimate. */
export function worstInputTokens(chars: number): number {
  return Math.ceil(chars / 2) + 200
}
