import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.23 — the DONE line: an ownerless agent on the screen says why it cannot be funded, Nicolai claims
// it, and funding it then works. The mock BFF keeps the agent the way Lens B19.11 does: owner_user_id is
// "" until the claim, verified follows the workspace once there is an owner, and a fund moves the balance.

function mockBff() {
  const sent: Array<{ method: string; url: string }> = []
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: '', verified: false }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ method, url })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: agent.balance_ulxc, unallocated_ulxc: 20_000_000 - agent.balance_ulxc, spent_ulxc: 0, agents: [agent] })
    if (url === '/api/agents/agt_1/claim') {
      agent.owner_user_id = 'ws_1'
      agent.verified = true
      return json({ agent_id: 'agt_1', owner_user_id: 'ws_1' })
    }
    if (url === '/api/agents/agt_1/fund') {
      agent.balance_ulxc = 5_000_000
      return json({ agent_id: 'agt_1', balance_ulxc: 5_000_000 })
    }
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
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

describe("an agent's owner and verified badge on the Agent Bank", () => {
  it('says why an ownerless agent cannot be funded, claims it, then funds it', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    expect((await screen.findByTestId('agent-ownerless')).textContent).toContain('Researcher has no owner, so it cannot be funded')
    expect(screen.queryByLabelText('Amount in LXC for Researcher')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Claim Researcher' }))

    expect(await screen.findByText('You own Researcher now. Fund it here.')).toBeTruthy()
    expect(within(screen.getByTestId('agent-ownership')).getByText('Verified')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Amount in LXC for Researcher'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fund' }))

    expect(await screen.findByText(/Researcher now holds/)).toBeTruthy()
    expect(sent).toEqual([
      { method: 'POST', url: '/api/agents/agt_1/claim' },
      { method: 'POST', url: '/api/agents/agt_1/fund' },
    ])
  })
})
