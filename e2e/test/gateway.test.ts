import { describe, expect, it } from 'vitest'
import { catalogULXC, cheapestOf, refusedVerdict, servedVerdict } from '../src/gateway.ts'
import type { LedgerRow } from '../src/lens.ts'

// One request on a workspace key as Lens wrote it on 7 Oct 2026: its hold, the hold released, the spend, its fee.
function served(spend: number, fee: number, hold = 85, start = 1_000_000_000): LedgerRow[] {
  const at = '2026-10-07T01:48:41Z'
  const row = (id: string, type: string, amount: number, after: number, metadata?: Record<string, unknown>): LedgerRow =>
    ({ id, type, amount_ulxc: amount, balance_after_ulxc: after, description: type === 'platform_fee' ? 'Platform fee 5.5%' : type, metadata, created_at: at })
  return [
    row('h', 'reservation_hold', -hold, start - hold),
    row('r', 'reservation_release', hold, start),
    row('s', 'spend', -spend, start - spend),
    row('f', 'platform_fee', -fee, start - spend - fee, { platform_fee_bps: 550, spend_ulxc: spend }),
  ]
}

const nano = { id: 'gpt-4.1-nano', provider: 'openai', display_name: 'GPT-4.1 nano', input_per_1m: 0.1, output_per_1m: 0.4 }

describe("every way into Lens's gateway (B34.6)", () => {
  it('prices a request at the catalog price in whole µLXC, rounded up, with no float left over', () => {
    // 34 in / 2 out at $0.10 / $0.40 a million is 4.2 µUSD: 42 µLXC at $0.10 an LXC, where a float gives 42.00000000000001.
    expect(catalogULXC(nano, 34, 2, 0.1)).toBe(42)
    expect(catalogULXC(nano, 31, 2, 0.1)).toBe(39)
    expect(catalogULXC({ input_per_1m: 0.075, output_per_1m: 0.3 }, 1, 0, 0.1)).toBe(1)
    expect(cheapestOf([nano, { ...nano, id: 'gpt-4o-mini', input_per_1m: 0.15, output_per_1m: 0.6 }, { ...nano, id: 'old', input_per_1m: 0, deprecated: true }], 'openai')?.id).toBe('gpt-4.1-nano')
  })

  it("passes one spend row at the catalog price with its fee and its hold released, and Lens's float rounding one µLXC up", () => {
    expect(servedVerdict(served(42, 3), 42, 550).pass).toBe(true)
    expect(servedVerdict(served(43, 3), 42, 550).pass).toBe(true)
  })

  it('fails a served request that wrote no spend row, one at another price, or a hold never released', () => {
    expect(servedVerdict([], 42, 550)).toEqual({ pass: false, detail: expect.stringContaining('wrote 0 spend rows') })
    expect(servedVerdict(served(44, 3), 42, 550)).toEqual({ pass: false, detail: expect.stringContaining('debits 44 µLXC; at the catalog price it costs 42') })
    expect(servedVerdict(served(42, 3).filter((r) => r.id !== 'r'), 42, 550)).toEqual({ pass: false, detail: expect.stringContaining('move -85 µLXC more') })
  })

  it("takes a provider's no-key refusal as its answer only when the ledger stays still", () => {
    expect(refusedVerdict(503, 'groq not configured', []).pass).toBe(true)
    expect(refusedVerdict(503, 'groq not configured', served(42, 3))).toEqual({ pass: false, detail: expect.stringContaining('the ledger gained') })
    expect(refusedVerdict(502, 'bad gateway', []).pass).toBe(false)
  })
})
