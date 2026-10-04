import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.6 — the first screen after sign-in is the wallet home. DONE reads: "after sign-in a returning
// user lands on Home and sees per-agent budget-used and the approvals count". The mock BFF answers the
// routes Home reads exactly as Lens shapes them (economy.AgentBook, AgentRules, AgentApproval,
// SpendForecast), behind an oidc session that is signed in and not new.

const M = 1_000_000

const AGENTS = [
  { id: 'agt_1', name: 'Researcher', balance_ulxc: 6 * M, spent_ulxc: 4 * M, keys: [], created_at: '2026-10-01T09:00:00Z' },
  { id: 'agt_2', name: 'Buyer', balance_ulxc: 10 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T09:05:00Z' },
]

function mockBff({ agents, newWorkspace = false }: { agents: typeof AGENTS; newWorkspace?: boolean }) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const allocated = agents.reduce((s, a) => s + a.balance_ulxc, 0)
    if (url === '/auth/me')
      return json({
        mode: 'oidc',
        authenticated: true,
        user: { sub: 'u1', email: 'owner@example.com' },
        workspace_id: 'ws_1',
        cache_poolable: false,
        needs_pooling_choice: newWorkspace,
      })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 50 * M,
        allocated_ulxc: allocated,
        unallocated_ulxc: 50 * M - allocated,
        spent_ulxc: 4 * M,
        agents,
      })
    if (url === '/api/agents/approvals')
      return json({
        approvals: [
          { id: 'apr_1', agent_id: 'agt_1', amount_ulxc: 2 * M, model: 'gpt-4o', status: 'pending', created_at: '2026-10-04T08:00:00Z' },
          { id: 'apr_2', agent_id: 'agt_2', amount_ulxc: 3 * M, model: '', status: 'pending', created_at: '2026-10-04T08:10:00Z' },
          { id: 'apr_3', agent_id: 'agt_1', amount_ulxc: 1 * M, model: 'gpt-4o', status: 'approved', created_at: '2026-10-03T08:00:00Z' },
        ],
      })
    if (url === '/api/agents/forecast')
      return json({
        at: '2026-10-04T12:00:00Z',
        month_start: '2026-10-01T00:00:00Z',
        month_end: '2026-11-01T00:00:00Z',
        spent_ulxc: 3 * M,
        forecast_ulxc: 25 * M,
        agents: agents.map((a) => ({ agent_id: a.id, name: a.name, spent_ulxc: a.id === 'agt_1' ? 3 * M : 0, forecast_ulxc: 0 })),
      })
    const rules = /^\/api\/agents\/([^/]+)\/rules$/.exec(url)
    if (rules)
      return json({
        max_per_request_ulxc: 0,
        daily_limit_ulxc: 0,
        // Researcher's budget is 12 LXC a month; Buyer has none.
        monthly_limit_ulxc: rules[1] === 'agt_1' ? 12 * M : 0,
        approval_above_ulxc: 0,
        allowed_models: null,
        allowed_providers: null,
        active_from: '',
        active_until: '',
        timezone: '',
      })
    if (url === '/api/workspace/pooling' || url.startsWith('/api/')) return json({})
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Home — the wallet home (B28.6)', () => {
  it('a returning user lands on Home and sees each agent’s budget used and the approvals waiting', async () => {
    mockBff({ agents: AGENTS })
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Your agents’ wallets, at a glance.' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Home')

    // Two pending, one decided: the count is the pending ones.
    expect(await screen.findByTestId('home-approvals-waiting')).toHaveTextContent('2')
    expect(screen.getByText(/2 requests are waiting for a person to approve/)).toBeInTheDocument()

    // Researcher spent 3 of its 12 LXC monthly budget: 25%. Buyer has no budget, so it is offered one.
    expect(await screen.findByTestId('home-budget-used-agt_1')).toHaveTextContent('25%')
    expect(screen.getByRole('progressbar', { name: 'Researcher’s monthly budget used' })).toHaveAttribute('aria-valuenow', '25')
    const buyer = screen.getByText(/no monthly budget set/).closest('div.flex.min-h-row') as HTMLElement
    expect(within(buyer).getByText('Buyer')).toBeInTheDocument()
    expect(within(buyer).getByRole('link', { name: 'Set a budget' })).toHaveAttribute('href', '/agents')

    // The rest of the home: what the workspace holds and has not given out, the forecast, and pause-all.
    expect(screen.getByTestId('home-total-balance')).toHaveTextContent('50')
    expect(screen.getByTestId('home-unallocated')).toHaveTextContent('34')
    expect(await screen.findByTestId('home-forecast')).toHaveTextContent('25 LXC')
    expect(screen.getByRole('button', { name: 'Pause every agent' })).toBeInTheDocument()
  })

  it('a workspace with no agents opens Home in onboarding mode', async () => {
    mockBff({ agents: [] })
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Give every agent a wallet.' })).toBeInTheDocument()
    expect(screen.getByTestId('home-onboarding')).toHaveTextContent('has no agents yet')
    expect(screen.getByRole('link', { name: 'Create an agent' })).toHaveAttribute('href', '/agents')
    expect(screen.queryByTestId('home-approvals-waiting')).not.toBeInTheDocument()
  })
})
