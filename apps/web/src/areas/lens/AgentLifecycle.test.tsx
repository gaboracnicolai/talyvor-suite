import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.21 — an agent is renamed, described and archived on Agent Wallets. The mock BFF keeps the agent the
// way Lens B28.298 does: a PATCH changes its name and description, and archiving sweeps its balance back to
// the workspace in one withdraw line, revokes its keys and sets archived_at.

function mockBff() {
  const sent: Array<{ method: string; url: string; body?: unknown }> = []
  const agent: Record<string, unknown> = {
    id: 'agt_1', name: 'Researcher', description: '', balance_ulxc: 750_000, spent_ulxc: 0, keys: ['key_1'],
    created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true,
  }
  const lines: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') {
      const held = agent.balance_ulxc as number
      return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: held, unallocated_ulxc: 20_000_000 - held, spent_ulxc: 0, agents: [agent] })
    }
    if (url === '/api/agents/agt_1' && method === 'PATCH') {
      Object.assign(agent, JSON.parse(String(init?.body)))
      return json(agent)
    }
    if (url === '/api/agents/agt_1/archive') {
      const swept = agent.balance_ulxc as number
      lines.unshift({ entry_id: 'ent_9', kind: 'withdraw', amount_ulxc: -swept, counterparty: 'workspace', balance_after_ulxc: 0, created_at: '2026-10-05T09:00:00Z' })
      Object.assign(agent, { balance_ulxc: 0, keys: [], archived_at: '2026-10-05T09:00:00Z' })
      return json({ agent_id: 'agt_1', swept_ulxc: swept, revoked_keys: ['key_1'], archived_at: '2026-10-05T09:00:00Z' })
    }
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('renaming, describing and archiving an agent on Agent Wallets', () => {
  it('saves a new name and description, then archives it: the balance is swept and only its statement is left', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    fireEvent.change(await screen.findByLabelText('Name of Researcher'), { target: { value: 'Night researcher' } })
    fireEvent.change(screen.getByLabelText('What Researcher is for'), { target: { value: 'Reads the overnight reports' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByTestId('agent-description')).textContent).toBe('Reads the overnight reports')
    expect(screen.getByTestId('agent-open').textContent).toBe('Night researcher')

    fireEvent.click(screen.getByRole('button', { name: 'Archive Night researcher' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, archive Night researcher' }))
    const archived = await screen.findByTestId('agent-archived')
    expect(archived.textContent).toMatch(/0\.75 LXC.*went back to the workspace and 1 key was revoked/)
    expect(await screen.findByText('Taken back by the workspace')).toBeTruthy()
    // Archived, it can no longer be funded or given a key: those cards are gone.
    expect(screen.queryByLabelText('Amount in LXC for Night researcher')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Issue a key' })).toBeNull()
    expect(screen.getByText('Archived')).toBeTruthy()

    expect(sent).toEqual([
      { method: 'PATCH', url: '/api/agents/agt_1', body: { name: 'Night researcher', description: 'Reads the overnight reports' } },
      { method: 'POST', url: '/api/agents/agt_1/archive', body: {} },
    ])
  })
})
