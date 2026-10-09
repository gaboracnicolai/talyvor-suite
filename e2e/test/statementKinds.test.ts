import { describe, expect, it } from 'vitest'
import type { AgentLine } from '../src/lens.ts'
import { type Made, type Shown, statementKindsVerdict } from '../src/statementKinds.ts'

// The four lines statement-line-kinds makes, as Lens posts them on the agent's account (newest first), and what Agent
// Wallets' Statement shows for them with B28.19 (apps/web/src/areas/lens/AgentBank.tsx lineText) and before it.
const made: Made[] = [
  { kind: 'topup', amount_ulxc: 10_000_000, words: 'Topped up automatically by the workspace' },
  { kind: 'transfer', amount_ulxc: 1_500_000, counterparty: 'agent:agt_writer', words: 'Transfer from Writer 5' },
  { kind: 'card', amount_ulxc: -2_540_000, words: 'Card charge' },
  { kind: 'pot_in', amount_ulxc: -500_000, words: 'Moved into a pot' },
]
const line = (kind: string, amount: number, counterparty: string, after: number): AgentLine => ({
  entry_id: `ent_${kind}`, kind, amount_ulxc: amount, counterparty, balance_after_ulxc: after, at: '2026-10-09T03:00:00Z',
})
const lines: AgentLine[] = [
  line('pot_in', -500_000, 'pot:pot_1', 8_460_000),
  line('card', -2_540_000, 'spend', 8_960_000),
  line('transfer', 1_500_000, 'agent:agt_writer', 11_500_000),
  line('topup', 10_000_000, 'workspace', 10_000_000),
]
const held = 8_460_000

const withB2819: Shown[] = [
  { what: 'Moved into a pot', amount: '−0.5 LXC' },
  { what: 'Card charge', amount: '−2.54 LXC' },
  { what: 'Transfer from Writer 5', amount: '+1.5 LXC' },
  { what: 'Topped up automatically by the workspace', amount: '+10 LXC' },
]

describe('statement-line-kinds', () => {
  it('passes on the four lines Lens posts, each named by what it was', () => {
    const v = statementKindsVerdict(made, lines, held, withB2819)
    expect(v).toMatchObject({ pass: true })
    expect(v.detail).toContain('"Transfer from Writer 5" +1.5 LXC')
  })

  it('fails the statement as it was before B28.19, naming each line it misnames', () => {
    // Every kind but fund, withdraw, pay, hold, release and settle fell through to "Spent on a request".
    const before = withB2819.map((r) => ({ ...r, what: 'Spent on a request' }))
    const v = statementKindsVerdict(made, lines, held, before)
    expect(v.pass).toBe(false)
    for (const [kind, words] of [['pot_in', 'Moved into a pot'], ['card', 'Card charge'], ['transfer', 'Transfer from Writer 5'], ['topup', 'Topped up automatically by the workspace']]) {
      expect(v.detail).toContain(`the ${kind} line`)
      expect(v.detail).toContain(`reads "Spent on a request", not "${words}"`)
    }
    expect(v.detail).toContain('4 row(s) read "Spent on a request"')
  })

  it('fails a ledger that posted a top-up as a funding, whatever the screen says', () => {
    const asFund = lines.map((l) => (l.kind === 'topup' ? { ...l, kind: 'fund' } : l))
    const v = statementKindsVerdict(made, asFund, held, withB2819)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain("Lens's statement has 0 line(s) of topup of 10000000 µLXC, want one")
    expect(v.detail).toContain('lines nothing here made: fund 10000000 (workspace)')
  })
})
