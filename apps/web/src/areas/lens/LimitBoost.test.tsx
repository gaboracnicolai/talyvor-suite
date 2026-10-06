import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.32 — a limit boost on Agent Wallets. The mock BFF keeps boosts the way Lens B28.308 does: one per limit, raised
// from the rules' value until a time, listed while in force and ended early by a DELETE on that limit.

function mockBff() {
  const sent: Array<{ method: string; url: string; body?: unknown }> = []
  const agents = [
    { id: 'agt_1', name: 'Researcher', balance_ulxc: 10_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true },
  ]
  const rules = { max_per_request_ulxc: 0, daily_limit_ulxc: 10_000_000, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false }
  let boosts: Array<Record<string, unknown>> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 20_000_000, allocated_ulxc: 10_000_000, unallocated_ulxc: 10_000_000, spent_ulxc: 0, agents })
    if (url === '/api/agents/agt_1/rules/boosts' && method === 'POST') {
      const { rule, value, until } = body as { rule: string; value: number; until: string }
      const b = { rule, raised_from: 10_000_000, value, until, created_by: 'jwt:user:ws_1', created_at: '2026-10-06T09:00:00Z' }
      boosts = [b]
      return json(b, 201)
    }
    if (url === '/api/agents/agt_1/rules/boosts') return json({ boosts })
    if (url === '/api/agents/agt_1/rules/boosts/daily_limit_ulxc' && method === 'DELETE') {
      boosts = []
      return new Response(null, { status: 204 })
    }
    if (url === '/api/agents/agt_1/rules/history') return json({ versions: [] })
    if (url === '/api/agents/agt_1/rules') return json(rules)
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('a limit boost', () => {
  it('raises a limit until a time, shows what it reverts to, and can be ended early', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const limit = (await screen.findByLabelText('Limit to raise for Researcher')) as HTMLSelectElement
    expect(limit.value).toBe('daily_limit_ulxc')
    fireEvent.change(screen.getByLabelText('Raise Researcher’s limit to'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Raise Researcher’s limit until'), { target: { value: '2030-01-01T18:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Raise until then' }))

    const row = await screen.findByTestId('boost-daily_limit_ulxc')
    expect(row.textContent).toMatch(/^Daily limit raised to 50 LXC until .+, then 10 LXC again by itself\.In force/)
    expect(screen.getByRole('status').textContent).toMatch(/^Researcher’s daily limit is 50 LXC until .+, then 10 LXC again by itself\.$/)

    fireEvent.click(screen.getByRole('button', { name: 'End the boost on Researcher’s daily limit now' }))
    await waitFor(() => expect(screen.queryByTestId('boost-daily_limit_ulxc')).toBeNull())

    expect(sent).toEqual([
      { method: 'POST', url: '/api/agents/agt_1/rules/boosts', body: { rule: 'daily_limit_ulxc', value: 50_000_000, until: new Date('2030-01-01T18:00').toISOString() } },
      { method: 'DELETE', url: '/api/agents/agt_1/rules/boosts/daily_limit_ulxc', body: {} },
    ])
  })
})
