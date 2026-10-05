import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Statement } from './AgentBank'
import type { PostingKind, StatementLine } from './agentBankApi'

// B28.19 — the DONE line: a statement with a transfer, a card charge, a top-up and a pot move shows four
// different, correct labels. The statement below carries every kind Lens posts on an agent's account
// (internal/economy: postEntry and the transfer, escrow, pay and reversal inserts), each as Lens writes it.

const M = 1_000_000
const line = (kind: PostingKind, amount: number, counterparty: string, ref = ''): StatementLine => ({
  entry_id: `ent_${kind}_${amount}`, kind, amount_ulxc: amount * M, counterparty, ref, balance_after_ulxc: 0, at: '2026-10-04T09:00:00Z',
})

const rows: Array<[StatementLine, string]> = [
  [line('fund', 10, 'workspace'), 'Funded by the workspace'],
  [line('withdraw', -1, 'workspace'), 'Taken back by the workspace'],
  [line('topup', 4, 'workspace'), 'Topped up automatically by the workspace'],
  [line('credit_line', 2, 'workspace'), 'Covered by the credit line'],
  [line('spend', -1, 'spend'), 'Spent on a request'],
  [line('hold', -1, 'spend'), 'Held for a request'],
  [line('release', 1, 'spend'), 'Released after a request'],
  [line('settle', -1, 'spend'), 'Settled a request'],
  [line('pay', -3, 'agent:agt_2', 'draft'), 'Paid Writer — draft'],
  [line('transfer', 5, 'agent:agt_2', 'tr_1'), 'Transfer from Writer'],
  [line('transfer', -2, 'agent:agt_2', 'tr_2'), 'Transferred to Writer'],
  [line('reversal', -5, 'agent:agt_2'), 'Test money given back to Writer'],
  [line('escrow', -6, 'escrow:esc_1'), 'Held in escrow'],
  [line('escrow', 6, 'escrow:esc_1'), 'Released from escrow'],
  [line('card', -7, 'spend', 'iauth_1'), 'Card charge'],
  [line('card', 7, 'spend', 'iauth_1'), 'Card refund'],
  [line('cash_out', -8, 'cash_out:co_1'), 'Cashed out'],
  [line('cash_out', 8, 'cash_out:co_1'), 'Cash-out returned'],
  [line('pot_in', -9, 'pot:pot_1'), 'Moved into a pot'],
  [line('pot_out', 9, 'pot:pot_1'), 'Moved out of a pot'],
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the agent statement', () => {
  it('names every kind of line, and a transfer, a card charge, a top-up and a pot move each by what it was', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/agents/agt_1/statement')
        return new Response(JSON.stringify({ agent_id: 'agt_1', lines: rows.map(([l]) => l) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response('null', { status: 404 })
    })
    const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:00:00Z' }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Statement agent={agent} nameOf={(id) => (id === 'agt_2' ? 'Writer' : 'an agent')} />
      </QueryClientProvider>,
    )

    const table = await screen.findByTestId('agent-statement')
    const what = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getByTestId('statement-what').textContent)
    expect(what).toEqual(rows.map(([, label]) => label))
    // Every kind Lens posts is on this statement, and none of them falls through to another's words.
    const kinds: PostingKind[] = ['fund', 'withdraw', 'topup', 'credit_line', 'spend', 'hold', 'settle', 'release', 'pay', 'transfer', 'escrow', 'reversal', 'card', 'cash_out', 'pot_in', 'pot_out']
    expect(new Set(rows.map(([l]) => l.kind))).toEqual(new Set(kinds))
    expect(what.filter((t) => t === 'Spent on a request')).toHaveLength(1)
    // The DONE line's four: four different labels, each the right one.
    const done = ['Transfer from Writer', 'Card charge', 'Topped up automatically by the workspace', 'Moved into a pot']
    for (const label of done) expect(what).toContain(label)
    expect(new Set(done).size).toBe(4)
    // A received transfer reads as money in, signed +.
    const received = within(table).getByText('Transfer from Writer').closest('tr')!
    expect(within(received).getAllByRole('cell')[2].textContent).toBe('+5 LXC')
  })
})
