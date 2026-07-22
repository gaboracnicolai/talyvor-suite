import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Overview } from './Overview'

const BALANCES: Record<string, unknown> = {
  '/api/lxc/balance': {
    workspace_id: 'trial-ws-1',
    balance_ulxc: 14999936,
    lifetime_minted_ulxc: 15000000,
    lifetime_spent_ulxc: 64,
    usd_value_uusd: 1499993,
  },
  '/api/tokens/balance': {
    workspace_id: 'trial-ws-1',
    balance_ulens: 1000,
    lifetime_earned_ulens: 1000,
    lifetime_spent_ulens: 0,
    updated_at: '2026-07-19T14:52:59Z',
  },
  '/api/tokens/history': [
    { id: 'a', workspace_id: 'trial-ws-1', amount_ulens: 1000, balance_after_ulens: 1000, type: 'pattern_mine', description: 'pattern shared', metadata: {}, created_at: '2026-07-19T14:35:21Z' },
  ],
}

// Route mocked BFF responses by path. `bonds` decides the capability case per test.
function mockBff(bonds: { status?: number; body: unknown }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/bonds')) {
      return new Response(JSON.stringify(bonds.body), {
        status: bonds.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    for (const [path, body] of Object.entries(BALANCES)) {
      if (url.startsWith(path)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response('null', { status: 404 })
  })
}

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Overview />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('capability-gated bonds render as state, not fault', () => {
  it('a disabled capability (BFF {enabled:false}) reads as OFF, not an error', async () => {
    mockBff({ body: { capability: 'bonds', enabled: false } })
    renderOverview()

    // the OFF affordance and its explanatory line appear …
    expect(await screen.findByText('Off')).toBeInTheDocument()
    expect(screen.getByText(/Turned off in this workspace/)).toBeInTheDocument()
    // … and the error copy does NOT (a disabled capability is information)
    expect(screen.queryByText(/Couldn’t load bonds/)).toBeNull()
  })

  it('a genuine failure (500) still surfaces as an error, not a fake OFF', async () => {
    mockBff({ status: 500, body: { error: 'boom' } })
    renderOverview()

    expect(await screen.findByText(/Couldn’t load bonds/)).toBeInTheDocument()
    expect(screen.queryByText('Off')).toBeNull()
  })
})
