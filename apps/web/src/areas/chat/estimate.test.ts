import { describe, expect, it } from 'vitest'

import type { ChatTool } from './chatApi'
import { previewCost } from './estimate'
import { formatCostRange } from './price'

const OPUS = { provider: 'anthropic', input_per_1m: 5, output_per_1m: 25 }
const TOOL: ChatTool = { name: 'agent_spend', description: 'What an agent spent.', input_schema: { type: 'object', properties: {} } }

describe('the price range before sending (B28.99)', () => {
  it('prices the conversation and the question: a one-token answer at the low end, a 4,096-token answer at the high end', () => {
    // 30 + 6 + 30 = 66 bytes. Low: 66 / 8 = 8 tokens in, 1 out. High: 66 / 2 = 33 + 64 framing + 8 × 3 messages = 121 in, 4,096 out.
    const range = previewCost(
      [{ role: 'user', content: 'What is the capital of France?' }, { role: 'assistant', content: 'Paris.' }, { role: 'assistant', content: '' }],
      'What is the capital of Poland?',
      [],
      OPUS,
      [],
    )
    expect(range).toEqual({ low_usd: (8 * 5 + 1 * 25) / 1e6, high_usd: (121 * 5 + 4096 * 25) / 1e6, answer_tokens: 4096 })
  })

  it('counts the wallet tools for a provider that is offered them, and a document toward the high end only', () => {
    const plain = previewCost([], 'How much did Researcher spend?', [], OPUS, [])!
    const tooled = previewCost([], 'How much did Researcher spend?', [], OPUS, [TOOL])!
    expect(tooled.low_usd).toBeGreaterThan(plain.low_usd)
    expect(tooled.high_usd - plain.high_usd).toBeGreaterThan((600 * 5) / 1e6)
    // Google is offered no tools (TOOL_PROVIDERS), so they cost it nothing.
    expect(previewCost([], 'How much did Researcher spend?', [], { ...OPUS, provider: 'google' }, [TOOL])).toEqual(plain)

    const withDoc = previewCost([], 'How much did Researcher spend?', [{ name: 'q3.pdf', media_type: 'application/pdf', size: 20_000, file_id: 'tdoc_1' }], OPUS, [])!
    expect(withDoc.low_usd).toBe(plain.low_usd)
    expect(withDoc.high_usd - plain.high_usd).toBeCloseTo((10_000 * 5) / 1e6, 12)
  })

  it('rounds each end away from the middle, so the range shown is never narrower than the one estimated', () => {
    // 0.0004999 LXC shown as 0.00049, never 0.0005; 1.02835 LXC as 1.03, never 1.03 rounded down to 1.02.
    expect(formatCostRange(0.00004999, 0.102835, 0.1)).toBe('≈ 0.00049–1.03 LXC')
    // A value already at two significant digits is kept, not pushed a step out by float error (0.0012 / 0.0001 = 11.999…).
    expect(formatCostRange(0.00012, 0.012, 0.1)).toBe('≈ 0.0012–0.12 LXC')
    expect(formatCostRange(0.00004999, 0.102835, undefined)).toBe('≈ $0.000049–0.11')
  })
})
