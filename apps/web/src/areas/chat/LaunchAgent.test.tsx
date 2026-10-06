import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseLaunch } from './LaunchAgent'

// B28.350 — `/agent …` typed in Chat launches an agent: created with its budget moved into its wallet once, its
// rules saved, its key issued and shown once, then its first call read off its statement and linked. The BFF is
// mocked at the wire; that the agent appears in /api/agents with its budget and its first call is debited from its
// wallet is proven against Lens by the e2e scenario chat-launch-agent.

const M = 1_000_000

function mockBff() {
  const agents: Array<Record<string, unknown>> = []
  const created: Array<Record<string, unknown>> = []
  const rules: Array<Record<string, unknown>> = []
  const funds: Array<{ body: Record<string, unknown>; key: string | null }> = []
  const lines: Array<Record<string, unknown>> = []
  let fundRefusals = 1
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/context') return json({ workspace_id: 'ws_1', lens_public_base_url: 'https://lens.example' })
    if (url === '/api/agents' && method === 'GET') {
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 0, unallocated_ulxc: 100 * M, spent_ulxc: 0, agents })
    }
    if (url === '/api/agents' && method === 'POST') {
      created.push(body)
      const a = { id: 'agt_9', name: body.name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-06T05:00:00Z' }
      agents.push(a)
      return json(a, 201)
    }
    if (url === '/api/agents/agt_9/rules' && method === 'GET') {
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0 })
    }
    if (url === '/api/agents/agt_9/rules' && method === 'PUT') {
      rules.push(body)
      return json(body)
    }
    if (url === '/api/agents/agt_9/fund') {
      funds.push({ body, key: new Headers(init?.headers).get('Idempotency-Key') })
      if (fundRefusals-- > 0) return json({ error: 'economy: the workspace has 0 LXC free to give' }, 402)
      lines.push({ entry_id: 'ent_1', kind: 'fund', amount_ulxc: 20 * M, counterparty: 'workspace', balance_after_ulxc: 20 * M, at: '2026-10-06T05:00:01Z' })
      return json({ balance_ulxc: 20 * M })
    }
    if (url === '/api/agents/agt_9/keys') return json({ agent_id: 'agt_9', key: 'tlv_agent_secret_9', id: 'key_1', prefix: 'tlv_agent' }, 201)
    if (url === '/api/agents/agt_9/statement') return json({ lines: [...lines].reverse() })
    return new Response('null', { status: 404 })
  })
  return { created, rules, funds, lines }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Launch an agent from Chat (B28.350)', () => {
  it('reads the name, budget and rules from the command', () => {
    expect(parseLaunch('/agent Researcher budget 20 LXC, 5 a day, ask me above 2')).toEqual({ name: 'Researcher', budget: '20', daily: '5', approval: '2' })
    expect(parseLaunch('/agent "Support bot" with 50 LXC a month, daily limit 1.5, approve over 0.25')).toEqual({
      name: 'Support bot',
      budget: '50',
      daily: '1.5',
      approval: '0.25',
    })
    expect(parseLaunch('/agent')).toEqual({ name: '', budget: '', daily: '', approval: '' })
  })

  it('launches the agent the command names: rules, budget moved once, key shown once, first call linked', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const box = await screen.findByRole('textbox', { name: /message/i })
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: '/agent Researcher budget 20 LXC, 5 a day, ask me above 2' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    const card = await screen.findByTestId('chat-launch')
    expect(box).toHaveValue('')
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model
    expect(within(card).getByLabelText('Agent name')).toHaveValue('Researcher')
    expect(within(card).getByLabelText('Budget, in LXC')).toHaveValue('20')
    expect(within(card).getByLabelText('At most a day, in LXC')).toHaveValue('5')
    expect(within(card).getByLabelText('Ask a person above, in LXC')).toHaveValue('2')

    // The workspace has nothing free: the agent and its rules are made, the budget is not, and Billing is named.
    fireEvent.click(within(card).getByRole('button', { name: 'Launch Researcher' }))
    const refused = await within(card).findByRole('alert')
    expect(refused).toHaveTextContent(/^Researcher is made, but its budget was not moved: The workspace has 0 LXC free to give\. Put credit in on Billing$/)
    expect(within(refused).getByRole('link')).toHaveAttribute('href', '/billing')

    fireEvent.click(within(card).getByRole('button', { name: 'Try again' }))
    const done = await within(card).findByTestId('chat-launch-done')
    expect(done).toHaveTextContent(/^Launched Researcher with 20 LXC in its wallet\. Open it on Agent Wallets$/)
    expect(within(done).getByRole('link')).toHaveAttribute('href', '/agents?agent=agt_9')
    expect(within(card).getByTestId('chat-launch-key')).toHaveTextContent('tlv_agent_secret_9')

    // One agent; the rules as typed; the budget moved under one Idempotency-Key however many times it was tried.
    expect(bff.created).toEqual([{ name: 'Researcher' }])
    expect(bff.rules.at(-1)).toEqual({ max_per_request_ulxc: 0, daily_limit_ulxc: 5 * M, monthly_limit_ulxc: 20 * M, approval_above_ulxc: 2 * M })
    expect(bff.funds.map((f) => f.body)).toEqual([{ amount_ulxc: 20 * M }, { amount_ulxc: 20 * M }])
    expect(new Set(bff.funds.map((f) => f.key)).size).toBe(1)
    expect(bff.funds[0].key).toBeTruthy()

    // Its first call lands on the statement, and the card links that line.
    expect(await within(card).findByTestId('chat-launch-waiting')).toHaveTextContent('Waiting for Researcher’s first call.')
    bff.lines.push({ entry_id: 'ent_2', kind: 'spend', amount_ulxc: -12_345, counterparty: 'claude-opus-5', balance_after_ulxc: 20 * M - 12_345, at: '2026-10-06T05:01:00Z' })
    await queryClient.invalidateQueries({ queryKey: ['agent-statement', 'agt_9'] })
    const first = await within(card).findByTestId('chat-launch-first-call')
    expect(first).toHaveTextContent(/^Researcher’s first call is on its statement: −0\.012345 LXC, leaving 19\.987655 LXC in its wallet\. See it on the statement$/)
    expect(within(first).getByRole('link')).toHaveAttribute('href', '/agents?agent=agt_9&entry=ent_2')
  })
})
