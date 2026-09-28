import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PayoutsCard } from './Marketplace'

// B20.6 — the seller's payouts on /marketplace/selling, the way Lens B20.5 keeps them: a seller connects
// a Stripe account (Lens answers Stripe's onboarding link), comes back verified, sees the next payout with
// Stripe's fees, and takes the available balance as credits — one payout row, read back in the history.

function mockBff(connected: boolean) {
  const sent: Array<{ url: string; body: unknown }> = []
  const payouts = {
    account: connected ? { stripe_account_id: 'acct_1', country: 'GB', details_submitted: true, payouts_enabled: true, currently_due: [] } : null,
    in_holdback_usd_micros: 4_000_000,
    available_usd_micros: 30_000_000,
    owed_usd_micros: 0,
    paid_out_usd_micros: 0,
    minimum_usd_micros: 25_000_000,
    paid_this_month: false,
    quote: { gross_usd_micros: 30_000_000, account_fee_usd_micros: 2_000_000, payout_fee_usd_micros: 320_000, net_usd_micros: 27_680_000 },
    payouts: [] as Array<Record<string, unknown>>,
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if ((init?.method ?? 'GET') !== 'GET') sent.push({ url, body: JSON.parse(String(init?.body ?? 'null')) })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/marketplace/payouts') return json(payouts)
    if (url === '/api/marketplace/payouts/connect')
      return json({ url: 'https://connect.stripe.com/setup/e/acct_1/abc', account: { stripe_account_id: 'acct_1', country: 'GB' } })
    if (url === '/api/marketplace/payouts/credits') {
      const p = { id: 'mpo_1', method: 'credits', month: '2026-09', gross_usd_micros: 30_000_000, account_fee_usd_micros: 0, payout_fee_usd_micros: 0, net_usd_micros: 30_000_000, credits_ulxc: 300_000_000, paid_at: '2026-09-28T12:00:00Z', created_at: '2026-09-28T12:00:00Z' }
      payouts.payouts.push(p)
      payouts.paid_out_usd_micros = 30_000_000
      payouts.available_usd_micros = 0
      return json(p, 201)
    }
    return new Response('null', { status: 404 })
  })
  return sent
}

function renderCard(entry: string, redirect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <PayoutsCard redirect={redirect} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return redirect
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("the seller's payouts", () => {
  it('connects a Stripe account by sending the seller to Stripe’s onboarding', async () => {
    const sent = mockBff(false)
    const redirect = renderCard('/marketplace/selling')

    const connect = await screen.findByTestId('payouts-connect')
    fireEvent.change(within(connect).getByLabelText('Where you are paid'), { target: { value: 'IE' } })
    fireEvent.click(within(connect).getByRole('button', { name: 'Connect with Stripe' }))

    await vi.waitFor(() => expect(redirect).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/abc'))
    expect(sent).toEqual([{ url: '/api/marketplace/payouts/connect', body: { country: 'IE' } }])
  })

  it('back from Stripe: verified, the next payout after fees, and the balance taken as credits', async () => {
    const sent = mockBff(true)
    renderCard('/marketplace/selling?payouts=connected')

    expect(await screen.findByText('Back from Stripe. Below is what Stripe has told Talyvor about your account.')).toBeTruthy()
    expect(within(screen.getByTestId('payouts-account')).getByText('Verified')).toBeTruthy()
    expect(screen.getByText('$27.68')).toBeTruthy()
    expect(screen.getByText(/\$30\.00 less Stripe’s fees of \$2\.32, at cost/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Take $30.00 as credits' }))

    const history = await screen.findByTestId('payouts-history')
    expect(within(history).getByText('As credits')).toBeTruthy()
    expect(screen.getByTestId('payouts-available').textContent).toBe('$0.00')
    expect(sent).toEqual([{ url: '/api/marketplace/payouts/credits', body: {} }])
  })
})
