import { describe, expect, it } from 'vitest'
import { quickstartStatement } from '../src/sdk.ts'

const line = (kind: string, amount: number, after: number) => ({ entry_id: `${kind}${after}`, kind, amount_ulxc: amount, balance_after_ulxc: after, at: '' })

describe("the SDK quickstart's statement oracle (B28.440)", () => {
  it("passes Lens's statement of the model call: its spend debited before the answer, then settled", () => {
    // Newest first, as Lens serves it.
    const lines = [line('settle', 300, 9_998_800), line('spend', -1_500, 9_998_500), line('fund', 10_000_000, 10_000_000)]
    expect(quickstartStatement(lines)).toEqual({ pass: true, spentULXC: 1_200 })
  })

  it('fails a statement with no spend line, a short fund line, or a balance that does not follow', () => {
    expect(quickstartStatement([line('fund', 10_000_000, 10_000_000)]).pass).toBe(false)
    expect(quickstartStatement([line('spend', -1_500, 4_998_500), line('fund', 5_000_000, 5_000_000)]).pass).toBe(false)
    expect(quickstartStatement([line('spend', -1_500, 10_000_000), line('fund', 10_000_000, 10_000_000)]).pass).toBe(false)
  })
})
