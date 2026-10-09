import { describe, expect, it } from 'vitest'
import { quickstartBooking, quickstartQuestion, quickstartStatement } from '../src/sdk.ts'

const line = (kind: string, amount: number, after: number) => ({ entry_id: `${kind}${after}`, kind, amount_ulxc: amount, balance_after_ulxc: after, at: '' })

describe("the SDK quickstart's statement oracle (B28.440)", () => {
  it("passes Lens's statement of the model call: its hold, the settle of what was not used, and its platform fee (B32.11)", () => {
    // Newest first, as Lens serves it. 1,200 µLXC spent; 5.5% of it is 66.
    const lines = [line('platform_fee', -66, 9_998_734), line('settle', 300, 9_998_800), line('hold', -1_500, 9_998_500), line('fund', 10_000_000, 10_000_000)]
    expect(quickstartStatement(lines, 550)).toEqual({ pass: true, spentULXC: 1_200 })
  })

  it('fails a statement with no call line, a short fund line, a balance that does not follow, or the wrong fee', () => {
    expect(quickstartStatement([line('fund', 10_000_000, 10_000_000)], 550).pass).toBe(false)
    expect(quickstartStatement([line('hold', -1_500, 4_998_500), line('fund', 5_000_000, 5_000_000)], 0).pass).toBe(false)
    expect(quickstartStatement([line('hold', -1_500, 10_000_000), line('fund', 10_000_000, 10_000_000)], 0).pass).toBe(false)
    expect(quickstartStatement([line('settle', 300, 9_998_800), line('hold', -1_500, 9_998_500), line('fund', 10_000_000, 10_000_000)], 550).pass).toBe(false)
    expect(quickstartStatement([line('platform_fee', -65, 9_998_735), line('settle', 300, 9_998_800), line('hold', -1_500, 9_998_500),
      line('fund', 10_000_000, 10_000_000)], 550).pass).toBe(false)
  })
})

describe("how the SDK quickstart's model call is booked (B17.180)", () => {
  it("does not book an answer Lens replayed from the workspace's own earlier one: Lens wrote no spend row for it", () => {
    expect(quickstartBooking(new Headers({ 'X-Talyvor-Cache-Replay': 'true' }), 0.0001, 0.01)).toEqual({ replayed: true, ulxc: undefined })
  })

  it('books a pooled answer at what Lens says it charged, and any other at its price', () => {
    expect(quickstartBooking(new Headers({ 'X-Talyvor-Cache-Replay': 'true', 'X-Talyvor-Pool-Charged-ULXC': '420' }), 0.0001, 0.01)).toEqual({ replayed: false, ulxc: 420 })
    expect(quickstartBooking(new Headers(), 0.0001, 0.01)).toEqual({ replayed: false, ulxc: 10_000 })
  })
})

describe("the SDK quickstart's question (B17.181)", () => {
  it('asks the model to repeat its fresh word, the wording gpt-4o-mini answered with the bare word 20 of 20', () => {
    expect(quickstartQuestion('fetutevoni')).toBe('Repeat this exact string and nothing else: fetutevoni')
  })
})
