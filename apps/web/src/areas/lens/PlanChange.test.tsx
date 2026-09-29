import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Plans } from './Plans'

// B18.20 — a Plus subscriber moves to Pro on /plans, told first what Stripe will charge, and the earnings
// card counts the people their answers helped. The mock BFF answers the switch the way Lens B18.14 does —
// with Stripe's state after the swap — and its allowance moves to Pro's fee only after that, the way
// Lens's does when Stripe's webhook arrives.

const period = (fee: number) => ({
  period_start: '2026-09-01T00:00:00Z',
  period_end: '2026-10-01T00:00:00Z',
  granted_ulxc: 191_200_000,
  consumed_ulxc: 0,
  remaining_ulxc: 191_200_000,
  fee_usd_cents: fee,
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function serve() {
  const posts: string[] = []
  let fee = 2000
  const live = { subscribed: true, status: 'active', current_period_end: '2026-10-28T00:00:00Z', cancel_at_period_end: false, livemode: false }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (init?.method === 'POST') posts.push(`${url} ${String(init.body)}`)
    if (url === '/api/billing/allowance')
      return json({ capability: 'subscriptions', enabled: true, data: { allowance: period(fee), earned_ulens: 0, earned_held_ulens: 0, earned_usd_cents: 0, earned_back_usd_cents: 0 } })
    if (url === '/api/billing/subscription') return json({ capability: 'subscriptions', enabled: true, data: live })
    if (url === '/api/billing/subscription/plan') {
      fee = 10000
      return json(live)
    }
    if (url === '/api/earnings') return json({ reuses: 4, helped_workspaces: 3 })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, cache_poolable: true })
    return new Response('null', { status: 404 })
  })
  return posts
}

function renderPlans() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Plans />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('change plan on /plans (B18.20)', () => {
  it('moves a Plus subscriber to Pro after saying what Stripe will charge', async () => {
    const posts = serve()
    renderPlans()
    expect(await screen.findByRole('heading', { name: 'You’re on Plus.' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Pro' }))
    expect(
      screen.getByText(
        'Move to Pro now? Stripe credits the unused part of this month on Plus and charges the rest of it at Pro’s price, on your next invoice.',
      ),
    ).toBeTruthy()
    expect(posts).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Move to Pro' }))
    await waitFor(() =>
      expect(screen.getByTestId('plan-moved').textContent).toBe(
        'You moved to Pro, and this month’s included usage now follows it.',
      ),
    )
    expect(screen.getByRole('heading', { name: 'You’re on Pro.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Switch to Plus' })).toBeTruthy()
    expect(posts).toEqual(['/api/billing/subscription/plan {"plan":"pro"}'])
  })

  it('says how many people the subscriber’s answers helped', async () => {
    serve()
    renderPlans()
    expect((await screen.findByTestId('plans-helped')).textContent).toBe('3')
    expect(screen.getByText(/4 reuses in all, so far/)).toBeTruthy()
  })
})
