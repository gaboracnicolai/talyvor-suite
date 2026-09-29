import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B18.25 — an operator opens Operator → Workspaces and sees every workspace's spend, held LENS and last
// activity; anyone else has no row for it, and the BFF refuses them if they type the address.

const WORKSPACES = [
  { id: 'ws_beta', name: 'Beta', created_at: null, current_month_usd: 0.004, all_time_usd: 0.02, requests: 1,
    held_ulens: 822, last_request_at: '2026-09-28T09:30:00Z' },
  { id: 'ws_acme', name: 'Acme', created_at: '2026-08-01T00:00:00Z', current_month_usd: 1.25, all_time_usd: 9.5,
    requests: 40, held_ulens: 0, last_request_at: '2026-09-20T10:00:00Z' },
  { id: 'ws_quiet', name: '', created_at: null, current_month_usd: 0, all_time_usd: 0, requests: 0, held_ulens: 0,
    last_request_at: null },
]

function mockBff(operator: boolean) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me')
      return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'ng@example.com' }, operator })
    if (url === '/api/admin/workspaces')
      return operator
        ? json({ workspaces: WORKSPACES })
        : json({ error: 'operator access required — this account is not on OPERATOR_SUBS' }, 403)
    return new Response('null', { status: 404 })
  })
}

async function at(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  return screen.findByRole('navigation', { name: /sections/i })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the operator screen (B18.25)', () => {
  it('an operator sees every workspace’s spend, held LENS and last activity', async () => {
    mockBff(true)
    const nav = await at('/operator')
    expect(within(nav).getByRole('link', { name: 'Workspaces' })).toHaveAttribute('href', '/operator')
    const rows = await screen.findAllByTestId('operator-workspace')
    expect(rows).toHaveLength(3)
    const [beta, acme, quiet] = rows
    expect(within(beta).getByText('Beta')).toBeTruthy()
    expect(within(beta).getByText('< $0.01')).toBeTruthy()
    expect(beta.textContent).toContain('822µlens')
    expect(within(acme).getByText('$1.25')).toBeTruthy()
    expect(within(acme).getByText('$9.50')).toBeTruthy()
    expect(within(acme).getByText('40')).toBeTruthy()
    expect(within(quiet).getByText('ws_quiet')).toBeTruthy()
    expect(within(quiet).getByText('Never')).toBeTruthy()
    expect(screen.getByTestId('operator-totals').textContent).toMatch(/^3 workspaces · \$1\.25 spent this month · /)
  })

  it('nobody else has a row for it, and typing the address shows the refusal, not data', async () => {
    mockBff(false)
    const nav = await at('/operator')
    expect(within(nav).queryByRole('link', { name: 'Workspaces' })).toBeNull()
    expect(await screen.findByText('Only Talyvor’s operators can see this screen.')).toBeTruthy()
    expect(screen.queryByTestId('operator-workspace')).toBeNull()
  })
})
