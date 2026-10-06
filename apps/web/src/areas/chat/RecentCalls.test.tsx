import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import type { StatementLine } from '../lens/agentBankApi'
import { RECENT_CALLS, recentCalls } from './RecentCalls'

// B28.356 — the talyvor-suite side of B28.93: an agent's recent calls beside the conversation. The BFF is mocked at
// the wire with the statement Lens answers (newest first). That the rows match a real agent's statement on Lens is
// proven by the e2e scenario chat-recent-calls.

const M = 1_000_000

function mockBff() {
  // Oldest first here; the BFF answers newest first. Call n: a 20 000 µLXC estimate, then call 0 also settles 5 000
  // back and pays a 600 µLXC platform fee. A payment between the calls is not a call.
  const lines: Array<Record<string, unknown>> = [{ entry_id: 'ent_fund', kind: 'fund', amount_ulxc: 5 * M, counterparty: 'workspace', at: '2026-10-06T05:00:00Z' }]
  const at = (s: number) => new Date(Date.UTC(2026, 9, 6, 6, 0, s)).toISOString()
  for (let n = 0; n <= RECENT_CALLS; n++) {
    const call = { ref: `req_${n}`, counterparty: 'spend', model: n % 2 === 0 ? 'claude-opus-5' : 'gpt-5-mini', source: n % 2 === 0 ? 'Chat' : 'Key “prod”' }
    lines.push({ ...call, entry_id: `ent_${n}`, kind: 'spend', amount_ulxc: -20_000 - n, at: at(2 * n) })
    if (n === 0) {
      lines.push({ entry_id: 'ent_pay', kind: 'pay', amount_ulxc: -M, counterparty: 'agent:agt_2', ref: 'invoice 4', at: at(1) })
      lines.push({ ...call, entry_id: 'ent_0s', kind: 'settle', amount_ulxc: 5_000, at: at(1) })
      lines.push({ ...call, entry_id: 'ent_0f', kind: 'platform_fee', amount_ulxc: -600, label: 'Platform fee 3%', at: at(1) })
    }
  }
  let balance = 0
  for (const l of lines) l.balance_after_ulxc = balance += l.amount_ulxc as number
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents') {
      const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: balance, spent_ulxc: 0, keys: [], created_at: '2026-10-06T04:00:00Z' }
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: balance, unallocated_ulxc: 100 * M - balance, spent_ulxc: 0, agents: [agent] })
    }
    if (url === '/api/agents/agt_1/statement') return json({ lines: [...lines].reverse() })
    return new Response('null', { status: 404 })
  })
  return [...lines].reverse() as unknown as StatementLine[]
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Recent calls beside Chat (B28.356)', () => {
  it('lists the newest 20 calls, each what its lines took, with its model and source, linked to its row', async () => {
    mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const panel = await screen.findByTestId('chat-live-statement')
    await within(panel).findAllByTestId('live-statement-line')
    fireEvent.click(within(panel).getByRole('button', { name: 'Recent calls' }))
    expect(within(panel).getByRole('button', { name: 'Recent calls' })).toHaveAttribute('aria-pressed', 'true')

    const rows = await within(panel).findAllByTestId('recent-call')
    // 21 calls: the newest 20, newest first — call 0 is on Agent Wallets.
    expect(rows).toHaveLength(RECENT_CALLS)
    expect(rows.map((r) => r.getAttribute('data-ref'))).toEqual(Array.from({ length: RECENT_CALLS }, (_, i) => `req_${RECENT_CALLS - i}`))
    const newest = rows[0]
    expect(within(newest).getByTestId('recent-call-model')).toHaveTextContent('claude-opus-5')
    expect(within(newest).getByTestId('recent-call-cost')).toHaveTextContent('−0.02002 LXC')
    expect(within(newest).getByTestId('recent-call-source')).toHaveTextContent('Chat')
    expect(newest).toHaveAttribute('href', '/agents?agent=agt_1&entry=ent_20')
    expect(within(rows[1]).getByTestId('recent-call-model')).toHaveTextContent('gpt-5-mini')
  })

  it('adds up every line of one call — its estimate, the settle and the fee — and leaves other lines out', () => {
    const all = recentCalls(mockBff(), Infinity)
    expect(all).toHaveLength(RECENT_CALLS + 1)
    const first = all[all.length - 1]
    expect(first).toMatchObject({ ref: 'req_0', entry_id: 'ent_0', entries: ['ent_0f', 'ent_0s', 'ent_0'], cost_ulxc: 20_000 - 5_000 + 600, model: 'claude-opus-5' })
    expect(all.flatMap((c) => c.entries)).not.toContain('ent_pay')
  })
})
