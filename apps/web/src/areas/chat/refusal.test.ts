import { describe, expect, it } from 'vitest'
import { REFUSAL_CODES, type RefusalCode, refusal, refusalCode } from './chatApi'

// B28.348 — the suite side of B28.82. Each refusal Lens tells apart arrives as `{"error", "code"}` (the
// code is what B28.82 adds on the Lens side) and, until then, as the sentence Lens writes for it today.
// Both must read as the same sentence, and no two refusals may read alike.
const LENS: Record<RefusalCode, { status: number; today: string; text: RegExp; remedy?: string }> = {
  spending_cap: {
    status: 402,
    today: "spending cap reached: this workspace's cap is $50.00 a month and $49.99 is spent — raise spending_cap_usd to continue",
    text: /monthly spending cap/,
  },
  budget_exceeded: { status: 402, today: 'budget exceeded for workspace/team/sprint', text: /spending limit on this workspace, team or sprint is used up/, remedy: '/features' },
  allowance_exhausted: {
    status: 402,
    today: "this period's plan allowance is used up and prepaid credit does not cover the request — top up to continue",
    text: /plan allowance is used up/,
    remedy: '/billing',
  },
  session_limit: {
    status: 402,
    today: 'this chat session has reached its spending limit of 5 LXC — start a new chat to continue',
    text: /This chat has spent the most one chat may/,
    remedy: 'new_chat',
  },
  guardrail_blocked: { status: 400, today: 'guardrail violation', text: /guardrails blocked that message/, remedy: '/features' },
  provider_overloaded: { status: 503, today: 'upstream overloaded', text: /provider is overloaded/ },
  workspace_rate_limited: {
    status: 429,
    today: 'rate limit reached: this workspace allows 60 requests a minute (rate_limit_rpm)',
    text: /its own rate limit/,
  },
}

const remedyOf = (r: ReturnType<typeof refusal>) => (r.remedy === undefined ? undefined : 'to' in r.remedy ? r.remedy.to : r.remedy.action)

describe('B28.348 — each of Lens’s refusals reads as itself', () => {
  it('names the refusal and its remedy from Lens’s code, and from the sentence Lens writes before it sends one', () => {
    const texts = new Set<string>()
    for (const code of REFUSAL_CODES) {
      const want = LENS[code]
      const coded = refusal(want.status, JSON.stringify({ error: 'refused', code }))
      const today = refusal(want.status, JSON.stringify({ error: want.today }))
      expect(refusalCode(want.status, JSON.stringify({ error: want.today })), code).toBe(code)
      expect(coded.text, code).toMatch(want.text)
      expect(today, code).toEqual(coded)
      expect(remedyOf(coded), code).toBe(want.remedy)
      // Only credit is fixed by topping up, and nothing Lens refused is "not configured".
      if (code !== 'allowance_exhausted') expect(coded.text, code).not.toMatch(/top up/i)
      expect(coded.text, code).not.toMatch(/not configured/i)
      texts.add(coded.text)
    }
    expect(texts.size).toBe(REFUSAL_CODES.length)
    // An empty balance is still "Top up on Billing"; a 503 that says so is still "not configured".
    expect(refusal(402, JSON.stringify({ error: 'insufficient LXC balance for estimated request cost' }))).toEqual({
      text: 'This workspace cannot cover the estimated cost of that request. Top up on Billing.',
      remedy: { label: 'Billing', to: '/billing' },
    })
    expect(refusal(503, JSON.stringify({ error: 'Google API key not configured' })).text).toBe('Chat is not configured on this deployment.')
    // Anthropic's own "overloaded", relayed as sent, and a guardrail block names what tripped it.
    expect(refusal(529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}').text).toMatch(/overloaded/)
    expect(refusal(400, JSON.stringify({ error: 'guardrail violation', violations: [{ type: 'pii' }, { type: 'injection' }] })).text).toMatch(
      /blocked that message \(pii, injection\)/,
    )
  })
})
