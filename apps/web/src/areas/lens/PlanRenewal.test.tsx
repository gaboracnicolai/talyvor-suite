import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Plans } from './Plans'

// B18.61 — a subscriber cancels on /plans, sees the day the plan ends, resumes, and sees it renew again.
// The mock BFF answers cancel and resume the way Lens B1.5 does — with Stripe's state after the change —
// while its own read of the subscription stays as it was, the way Lens's does until Stripe's webhook.

const PERIOD = {
  period_start: '2026-09-01T00:00:00Z',
  period_end: '2026-10-01T00:00:00Z',
  granted_ulxc: 191_200_000,
  consumed_ulxc: 0,
  remaining_ulxc: 191_200_000,
  fee_usd_cents: 2000,
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function serve() {
  const posts: string[] = []
  const state = (cancel: boolean) => ({ subscribed: true, status: 'active', current_period_end: '2026-10-28T00:00:00Z', cancel_at_period_end: cancel, livemode: false })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (init?.method === 'POST') posts.push(url)
    if (url === '/api/billing/allowance')
      return json({ capability: 'subscriptions', enabled: true, data: { allowance: PERIOD, earned_ulens: 0, earned_held_ulens: 0, earned_usd_cents: 0, earned_back_usd_cents: 0 } })
    if (url === '/api/billing/subscription') return json({ capability: 'subscriptions', enabled: true, data: state(false) })
    if (url === '/api/billing/subscription/cancel') return json(state(true))
    if (url === '/api/billing/subscription/resume') return json(state(false))
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, cache_poolable: true })
    return new Response('null', { status: 404 })
  })
  return posts
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('cancel and resume on /plans (B18.61)', () => {
  it('cancels at the end of the period, says the day it ends, and resumes', async () => {
    const posts = serve()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Plans />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const renewal = await screen.findByTestId('plan-renewal')
    expect(renewal.textContent).toBe('Your plan renews on Oct 28, 2026.')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel at the end of this period' }))
    await waitFor(() =>
      expect(screen.getByTestId('plan-renewal').textContent).toBe(
        'Your plan is cancelled. It ends on Oct 28, 2026, and you keep everything it includes until then.',
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Resume my plan' }))
    await waitFor(() => expect(screen.getByTestId('plan-renewal').textContent).toBe('Your plan renews on Oct 28, 2026.'))
    expect(posts).toEqual(['/api/billing/subscription/cancel', '/api/billing/subscription/resume'])
  })
})
