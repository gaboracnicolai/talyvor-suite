import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

const PARKED = {
  id: 'use_9', listing_id: 'lst_adder', buyer_workspace_id: 'ws_acme', price_ulxc: 500_000, used_at: '2026-10-01T08:00:00Z',
  refusals: 5, reason: "resource_missing: No such customer: 'cus_gone'", parked_at: '2026-10-02T12:00:00Z',
}

function mockBff(operator: boolean) {
  let parked = [PARKED]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me')
      return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'ng@example.com' }, operator })
    if (url === '/api/admin/workspaces')
      return operator
        ? json({ workspaces: WORKSPACES })
        : json({ error: 'operator access required — this account is not on OPERATOR_SUBS' }, 403)
    if (url === '/api/admin/marketplace/parked-uses') return json({ parked_uses: parked })
    if (url === '/api/admin/marketplace/parked-uses/use_9/retry' && init?.method === 'POST') {
      parked = []
      return json({ id: 'use_9', retrying: true })
    }
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

  // B27.19 — a parked marketplace use shows Stripe's reason and how often it refused; Retry puts it back on
  // the next metering run and it leaves the list.
  it('an operator retries a parked marketplace use', async () => {
    mockBff(true)
    await at('/operator')
    const row = await screen.findByTestId('parked-use')
    expect(row.textContent).toContain("resource_missing: No such customer: 'cus_gone'")
    expect(within(row).getByText('5 times')).toBeTruthy()
    expect(within(row).getByText('0.5 LXC')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'Retry use_9' }))
    expect((await screen.findByTestId('parked-retried')).textContent).toBe('use_9 will be tried again on the next metering run.')
    expect(await screen.findByText(/No use is parked/)).toBeTruthy()
    const retries = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input).endsWith('/retry'))
    expect(retries).toHaveLength(1)
    expect(retries[0][1]?.method).toBe('POST')
  })

  it('nobody else has a row for it, and typing the address shows the refusal, not data', async () => {
    mockBff(false)
    const nav = await at('/operator')
    expect(within(nav).queryByRole('link', { name: 'Workspaces' })).toBeNull()
    // B26.29 — a 403 is a verdict, so it is not retried: the refusal shows at once, well inside the
    // one-second wait a retry would cost, and the BFF is asked exactly once.
    expect(await screen.findByText('Only Talyvor’s operators can see this screen.', {}, { timeout: 500 })).toBeTruthy()
    expect(screen.queryByTestId('operator-workspace')).toBeNull()
    const asked = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input) === '/api/admin/workspaces')
    expect(asked).toHaveLength(1)
  })
})
