import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Plans } from './Plans'
import { BillingSuccess } from './BillingReturn'
import { PENDING_PLAN_KEY } from './planApi'

// B13.3 — /plans: three cards, the usage meter and the earnings card, all from the BFF.

const PERIOD = {
  period_start: '2026-09-01T00:00:00Z',
  period_end: '2026-10-01T00:00:00Z',
  granted_ulxc: 191_200_000,
  consumed_ulxc: 118_544_000, // 62%
  remaining_ulxc: 72_656_000,
  fee_usd_cents: 2000,
}
const SUBSCRIBED = { allowance: PERIOD, earned_ulens: 9_000_000, earned_held_ulens: 0, earned_usd_cents: 600, earned_back_usd_cents: 600 }
const UNSUBSCRIBED = { ...SUBSCRIBED, allowance: null }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function serve(allowance: unknown, { sharing = true, pooled = 9 } = {}) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/billing/allowance') return json(allowance)
    if (url === '/api/billing/subscribe') return json({ url: 'https://checkout.stripe.com/c/pay/cs_test_plan' })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, cache_poolable: sharing })
    if (url.startsWith('/api/usage'))
      return json({ period_days: 30, models: [], cache: { total_requests: 40, cache_hits: pooled, misses: 31, hit_rate: 0.2, by_source: { upstream: 31, cache_hit_pooled: pooled } } })
    return new Response('null', { status: 404 })
  })
  return fetchSpy
}

function renderIn(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('Plans (B13.3)', () => {
  it('offers Plus $20, Pro $100 and Max $200 with every model on each, and Choose starts that plan’s checkout', async () => {
    const fetchSpy = serve({ capability: 'subscriptions', enabled: true, data: UNSUBSCRIBED })
    const redirect = vi.fn()
    renderIn(<Plans redirect={redirect} />)

    const text = (await screen.findByText('Plus')).closest('ul')!.textContent
    for (const price of ['$20', '$100', '$200']) expect(text).toContain(price)
    expect(screen.getAllByText('Every model from every provider')).toHaveLength(3)

    fireEvent.click(await screen.findByRole('button', { name: 'Choose Pro' }))
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_plan'))
    const call = fetchSpy.mock.calls.find(([u]) => String(u) === '/api/billing/subscribe')!
    expect(call[1]?.method).toBe('POST')
    expect(JSON.parse(String(call[1]?.body))).toEqual({ plan: 'pro' })
    expect(JSON.parse(window.sessionStorage.getItem(PENDING_PLAN_KEY)!).plan).toBe('pro')
  })

  it('shows a subscriber their plan, the usage meter as a percentage, and what their answers earned', async () => {
    serve({ capability: 'subscriptions', enabled: true, data: SUBSCRIBED })
    renderIn(<Plans />)

    expect(await screen.findByRole('heading', { name: 'You’re on Plus.' })).toBeInTheDocument()
    expect(screen.getByText(/of this month’s included usage/).textContent).toBe('62% of this month’s included usage')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62')
    expect(screen.getByText(/Your answers earned you/).textContent).toBe(
      'Your answers earned you $6 this month — $6 of your $20 plan back.',
    )
    const pooled = await screen.findByText('Answered from the shared pool')
    expect(pooled.closest('div.flex')!.textContent).toContain('9')
    expect(screen.queryByRole('button', { name: /^Choose/ })).not.toBeInTheDocument()
  })

  it('says a subscriber with sharing off earns nothing, and where to switch it on', async () => {
    serve({ capability: 'subscriptions', enabled: true, data: SUBSCRIBED }, { sharing: false })
    renderIn(<Plans />)
    expect(await screen.findByText(/Answer sharing is off, so your answers earn nothing/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Turn it on in Features' }).getAttribute('href')).toBe('/features')
  })

  it('draws no buy button where plans are not sold', async () => {
    serve({ capability: 'subscriptions', enabled: false })
    renderIn(<Plans />)
    expect(await screen.findByText(/Plans aren’t on sale on this deployment yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Choose/ })).not.toBeInTheDocument()
  })
})

describe('the plan checkout’s return (B13.3)', () => {
  it('waits for Lens to grant the period, then says which plan the workspace is on', async () => {
    window.sessionStorage.setItem(PENDING_PLAN_KEY, JSON.stringify({ plan: 'max', at: Date.now() }))
    let granted = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input) === '/api/billing/allowance'
        ? json({ capability: 'subscriptions', enabled: true, data: granted ? { ...SUBSCRIBED, allowance: { ...PERIOD, fee_usd_cents: 20000 } } : UNSUBSCRIBED })
        : new Response('null', { status: 404 }),
    )
    renderIn(<BillingSuccess pollIntervalMs={5} timeoutMs={2000} />)

    expect(await screen.findByRole('heading', { name: 'Confirming your Max plan.' })).toBeInTheDocument()
    granted = true
    expect(await screen.findByRole('heading', { name: 'You’re on Max.' })).toBeInTheDocument()
    expect(window.sessionStorage.getItem(PENDING_PLAN_KEY)).toBeNull()
  })
})
