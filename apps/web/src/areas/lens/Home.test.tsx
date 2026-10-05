import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from '../../App'
import { PRODUCT_CARDS } from './Home'

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

    expect(await screen.findByRole('heading', { level: 2, name: 'Welcome to Talyvor' })).toBeInTheDocument()
    expect(await screen.findByText('Your agents’ wallets, at a glance.')).toBeInTheDocument()
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

    expect(await screen.findByText('Give every agent a wallet.')).toBeInTheDocument()
    expect(screen.getByTestId('home-onboarding')).toHaveTextContent('give its first agent a wallet in three steps')
    expect(screen.getByRole('button', { name: 'Create agent' })).toBeDisabled()
    expect(screen.queryByTestId('home-approvals-waiting')).not.toBeInTheDocument()
  })
})

// B28.8 — DONE reads: "a brand-new workspace reaches a funded agent with a key without ever seeing a
// full-screen consent page". The BFF below keeps state the way Lens does: an agent created, its rules
// saved, LXC moved out of the workspace into it, a key issued, and a request on its statement.
function mockNewWorkspace() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const writes: { path: string; body: unknown }[] = []
  let agent: { id: string; name: string; balance_ulxc: number; spent_ulxc: number; keys: string[]; created_at: string; owner_user_id: string } | null = null
  let rules = { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '' }
  const lines: object[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method !== 'GET') writes.push({ path: `${method} ${url}`, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me')
      return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'new@example.com' }, workspace_id: 'ws_new', cache_poolable: true, needs_pooling_choice: true })
    if (url === '/api/context') return json({ workspace_id: 'ws_new', lens_base_url: 'http://lens:8080', lens_public_base_url: 'https://lens.example.com' })
    if (url === '/api/agents' && method === 'POST') {
      agent = { id: 'agt_new', name: body.name, balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-04T12:00:00Z', owner_user_id: 'u1' }
      return json(agent, 201)
    }
    if (url === '/api/agents') {
      const allocated = agent?.balance_ulxc ?? 0
      return json({ workspace_balance_ulxc: 20 * M, allocated_ulxc: allocated, unallocated_ulxc: 20 * M - allocated, spent_ulxc: 0, agents: agent ? [agent] : [] })
    }
    if (url === '/api/agents/agt_new/rules' && method === 'PUT') return json((rules = body))
    if (url === '/api/agents/agt_new/rules') return json(rules)
    if (url === '/api/agents/agt_new/fund' && agent) {
      agent.balance_ulxc += body.amount_ulxc
      lines.unshift({ entry_id: 'e1', kind: 'fund', amount_ulxc: body.amount_ulxc, counterparty: 'workspace', balance_after_ulxc: agent.balance_ulxc, at: '2026-10-04T12:01:00Z' })
      return json({ balance_ulxc: agent.balance_ulxc })
    }
    if (url === '/api/agents/agt_new/keys' && agent) {
      agent.keys.push('tlv_ak_1234')
      return json({ agent_id: 'agt_new', key: 'tlv_ak_1234secret', id: 'key_1', prefix: 'tlv_ak_1234' }, 201)
    }
    if (url === '/api/agents/agt_new/statement') {
      // The agent's first request, sent with its key, is on the statement once the key exists.
      if (agent && agent.keys.length > 0 && lines.length === 1) {
        agent.balance_ulxc -= 1200
        lines.unshift({ entry_id: 'e2', kind: 'spend', amount_ulxc: -1200, counterparty: 'provider:anthropic', balance_after_ulxc: agent.balance_ulxc, at: '2026-10-04T12:02:00Z' })
      }
      return json({ lines })
    }
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/forecast') return json({ spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url.startsWith('/api/')) return json({})
    return new Response('null', { status: 404 })
  })
  return writes
}

describe('Home — three-step wallet onboarding (B28.8)', () => {
  it('a brand-new workspace reaches a funded agent with a key, and sees its first request, with no consent page', async () => {
    const writes = mockNewWorkspace()
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(await screen.findByText('Give every agent a wallet.')).toBeInTheDocument()
    expect(screen.queryByText(/Share your answers, and earn from them/i)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Share answers with other companies/i })).toBeChecked()

    // 1 — the agent, with a budget and an approval amount.
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Researcher' } })
    fireEvent.change(screen.getByLabelText('Monthly budget, in LXC'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Ask a person above, in LXC'), { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    // 2 — fund it. The onboarding stays open though the book now lists the agent.
    fireEvent.change(await screen.findByLabelText('Amount to fund Researcher, in LXC'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fund Researcher' }))

    // 3 — its key, a snippet carrying it, and its first request on its statement.
    fireEvent.click(await screen.findByRole('button', { name: 'Issue its key' }))
    expect(await screen.findByTestId('onboarding-key')).toHaveTextContent('tlv_ak_1234secret')
    expect(screen.getAllByText(/OPENAI_API_KEY="tlv_ak_1234secret"/).length).toBeGreaterThan(0)
    expect(await screen.findByTestId('onboarding-first-request', {}, { timeout: 5_000 })).toHaveTextContent(
      'Researcher’s first request is on its statement: −0.0012 LXC, leaving 4.9988 LXC in its wallet.',
    )

    // What reached the BFF, in order: the agent, its rules, the funding, the key. Sharing was not written.
    await waitFor(() => expect(writes.map((w) => w.path)).toEqual([
      'POST /api/agents',
      'PUT /api/agents/agt_new/rules',
      'POST /api/agents/agt_new/fund',
      'POST /api/agents/agt_new/keys',
    ]))
    expect(writes[1].body).toMatchObject({ monthly_limit_ulxc: 10 * M, approval_above_ulxc: 500_000 })
    expect(writes[2].body).toEqual({ amount_ulxc: 5 * M })

    // Done hands Home back its wallets view.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Your agents’ wallets, at a glance.')).toBeInTheDocument()
  })
})

// B29.8 — DONE reads: "every card opens its existing route; every figure the home shows today is still
// shown". The figures are the first describe's; this clicks each card from a freshly opened Home and reads
// the address and the top bar's title, which is the route table's own name for the page it landed on.
describe('Home — the product cards (B29.8)', () => {
  it('every card opens its existing route', async () => {
    mockBff({ agents: AGENTS })
    for (const card of PRODUCT_CARDS) {
      window.history.pushState({}, '', '/')
      render(<App />)
      const cards = await screen.findByRole('list', { name: 'Products' })
      const link = within(cards).getByRole('link', { name: new RegExp(`^${card.title}`) })
      expect(link).toHaveAttribute('href', card.to)
      expect(link.querySelector('svg[data-icon]')).not.toBeNull()
      fireEvent.click(link)
      expect(window.location.pathname).toBe(card.to)
      const route = CONSOLE_ROUTES.find((r) => (r.path.endsWith('/*') ? card.to === r.path.slice(0, -2) : r.path === card.to))
      expect(route, `${card.to} is not a console route`).toBeDefined()
      expect(screen.getByRole('banner')).toHaveTextContent(route!.title)
      cleanup()
      queryClient.clear()
    }
    expect(PRODUCT_CARDS.map((c) => c.title)).toEqual(['Agent Wallets', 'Approvals', 'Statements', 'Chat', 'Marketplace', 'Track', 'Docs', 'Developers'])
  })
})
