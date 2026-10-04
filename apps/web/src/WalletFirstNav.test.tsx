import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'
import { SIDEBAR_FOLD_KEY } from './sidebarFold'

// B28.7 — the navigation is wallet-first. Drives the real <App /> as an operator, so every row the
// sidebar can offer is on screen once every group is open.

const ORDER = [
  'Home',
  'Approvals',
  'Agent Wallets',
  'Statements',
  'Chat',
  'Marketplace',
  'Work',
  'Track',
  'Docs',
  'Developers',
  'Connect an agent',
  'API keys',
  'Spend & routing',
  'Gateway features',
  'Billing',
  'Settings',
  'Operator',
]

const APPROVALS = [
  { id: 'apr_1', agent_id: 'agt_1', model: 'gpt-4o', amount_ulxc: 2_000_000, status: 'pending', created_at: '2026-10-04T10:00:00Z' },
  { id: 'apr_2', agent_id: 'agt_1', model: 'gpt-4o', amount_ulxc: 3_000_000, status: 'pending', created_at: '2026-10-04T11:00:00Z' },
  { id: 'apr_3', agent_id: 'agt_1', model: 'gpt-4o', amount_ulxc: 1_000_000, status: 'approved', created_at: '2026-10-03T09:00:00Z' },
]

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input).split('?')[0]
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'ng@example.com' }, operator: true })
    if (url === '/api/agents/approvals') return json({ approvals: APPROVALS })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T00:00:00Z' }],
      })
    return new Response('null', { status: 404 })
  })
}

async function sidebarAt(address: string): Promise<HTMLElement> {
  window.history.pushState({}, '', address)
  render(<App />)
  const nav = await screen.findByRole('navigation', { name: /sections/i })
  // The Operator group appears once /auth/me has said so.
  await within(nav).findByRole('button', { name: 'Operator' })
  fireEvent.click(within(nav).getByRole('button', { name: 'Open all' }))
  return nav
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.removeItem(SIDEBAR_FOLD_KEY)
})

describe('the navigation is wallet-first (B28.7)', () => {
  it('the sidebar shows Home, Approvals, Agent Wallets, Statements, Chat, Marketplace, Work, Developers, Billing, Settings, Operator — in that order', async () => {
    mockBff()
    const nav = await sidebarAt('/')
    await within(nav).findByRole('link', { name: /^Approvals 2/ })
    const named = Array.from(nav.querySelectorAll('a[href], button[aria-expanded]')).map((el) =>
      (el.textContent ?? '').replace(/\d+ waiting$/, '').trim(),
    )
    // A group and its one same-named link (Settings, then Settings) are one entry in the order.
    expect(named.filter((l, i) => ORDER.includes(l) && l !== named[i - 1])).toEqual(ORDER)
  })

  it('every link in the sidebar resolves to a page', async () => {
    mockBff()
    const nav = await sidebarAt('/')
    const hrefs = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.length).toBeGreaterThanOrEqual(25)
    for (const href of hrefs) {
      cleanup()
      queryClient.clear()
      window.history.pushState({}, '', href)
      render(<App />)
      const h1 = await screen.findByRole('heading', { level: 1 })
      expect(h1.textContent, `${href} opened no page`).not.toBe('Not found')
      expect(screen.queryByText(/Nothing at this address/), `${href} fell to the catch-all`).toBeNull()
    }
  })

  it('Approvals carries the count waiting, and opens them', async () => {
    mockBff()
    const nav = await sidebarAt('/')
    const link = await within(nav).findByRole('link', { name: 'Approvals 2 waiting' })
    fireEvent.click(link)
    expect(window.location.pathname).toBe('/approvals')
    const main = within(screen.getByRole('main'))
    await waitFor(() => expect(main.getAllByRole('button', { name: 'Deny' })).toHaveLength(2))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Approvals')
  })
})
