import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YourPlan } from './Plan'

// B1.6 — the subscriber's plan on /billing, from the BFF's gated GET /api/billing/allowance.

const SUBSCRIBED = {
  allowance: {
    period_start: '2026-09-01T00:00:00Z',
    period_end: '2026-10-01T00:00:00Z',
    granted_ulxc: 200_000_000,
    consumed_ulxc: 50_000_000,
    remaining_ulxc: 150_000_000,
    fee_usd_cents: 2000,
  },
  earned_ulens: 9_000_000,
  earned_held_ulens: 0,
  earned_usd_cents: 600,
  earned_back_usd_cents: 600,
}

function serve(body: unknown) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input) === '/api/billing/allowance'
      ? new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('null', { status: 404 }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <YourPlan />
    </QueryClientProvider>,
  )
  return { ...utils, fetchSpy }
}

afterEach(() => vi.restoreAllMocks())

describe('YourPlan (B1.6)', () => {
  it('tells a subscriber what the plan costs, what their answers earned back, and the allowance used and left', async () => {
    serve({ capability: 'subscriptions', enabled: true, data: SUBSCRIBED })

    const sentence = await screen.findByText(/Your plan is/)
    expect(sentence.textContent).toBe('Your plan is $20. Your team’s answers earned $6 of it back.')
    const used = screen.getByText('Allowance used').closest('div.flex')!
    expect(used.textContent).toMatch(/50.*of.*200/)
    const left = screen.getByText('Allowance left').closest('div.flex')!
    expect(left.textContent).toMatch(/150/)
  })

  it('draws nothing for a workspace without a plan, or a deployment that sells none', async () => {
    for (const body of [
      { capability: 'subscriptions', enabled: true, data: { ...SUBSCRIBED, allowance: null } },
      { capability: 'subscriptions', enabled: false },
    ]) {
      const { container, fetchSpy, unmount } = serve(body)
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 0))
      expect(container.textContent).toBe('')
      unmount()
      vi.restoreAllMocks()
    }
  })
})
