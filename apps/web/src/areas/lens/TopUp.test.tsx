import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopUp } from './TopUp'
import { PENDING_TOPUP_KEY } from './topupApi'

// /billing — the ONLY way a customer can buy LXC. Everything here is wired to
// the real BFF surface (apps/bff/billing.go), never a fixture:
//   GET  /api/lxc/topup-options → the allowed amounts (never hardcoded here)
//   POST /api/lxc/checkout      → a Stripe Checkout Session URL
//
// The tests that matter most are the FAILURE ones. A top-up screen that fails
// silently is worse than none: the customer is about to be asked for money, and
// every way this can go wrong has to arrive as a sentence they can act on.

const BALANCE = {
  workspace_id: 'trial-ws-1',
  balance_ulxc: 42_000_000,
  lifetime_minted_ulxc: 100_000_000,
  lifetime_spent_ulxc: 58_000_000,
  usd_value_uusd: 4_200_000,
}
const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3'

type CheckoutReply = { status: number; body: unknown }

/** Mocks the two BFF routes this screen uses. `checkout` decides what the write
 *  path answers, so each honest-failure state can be driven for real. */
function mockBff(checkout: CheckoutReply = { status: 200, body: { url: SESSION_URL } }) {
  const post = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/lxc/checkout' && method === 'POST') {
      post(init)
      return new Response(JSON.stringify(checkout.body), {
        status: checkout.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/lxc/topup-options') {
      return new Response(JSON.stringify({ allowed_usd_cents: [1000, 5000, 10000] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/lxc/balance') {
      return new Response(JSON.stringify(BALANCE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
  return { post }
}

function renderTopUp(redirect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TopUp redirect={redirect} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, redirect }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('TopUp — the amounts come from the server', () => {
  it('offers exactly the amounts the BFF serves, never a hardcoded price', async () => {
    mockBff()
    renderTopUp()
    expect(await screen.findByRole('button', { name: '$10' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '$50' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '$100' })).toBeInTheDocument()
    // Nothing else pretending to be a price.
    expect(screen.queryByRole('button', { name: '$25' })).not.toBeInTheDocument()
  })

  it('renders only what the server allows when the list differs from the usual three', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/lxc/topup-options')
        return new Response(JSON.stringify({ allowed_usd_cents: [2500] }), { status: 200 })
      if (url === '/api/lxc/balance') return new Response(JSON.stringify(BALANCE), { status: 200 })
      return new Response('null', { status: 404 })
    })
    renderTopUp()
    expect(await screen.findByRole('button', { name: '$25' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '$10' })).not.toBeInTheDocument()
  })

  it('shows the current balance so the customer knows what they are topping up', async () => {
    mockBff()
    renderTopUp()
    expect(await screen.findByText(/42/)).toBeInTheDocument()
    expect(screen.getByText(/\$4\.20/)).toBeInTheDocument()
  })
})

describe('TopUp — a deployment that cannot sell says so up front', () => {
  // This ships to a box with LENS_BILLING_ENABLED unset. Offering three buy
  // buttons that cannot work — and only revealing it on click — is the thing
  // this must not do. The state is known before anything is drawn.
  function mockBillingOff() {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/lxc/topup-options') {
        return new Response(
          JSON.stringify({ allowed_usd_cents: [1000, 5000, 10000], billing_enabled: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url === '/api/lxc/balance') return new Response(JSON.stringify(BALANCE), { status: 200 })
      return new Response('null', { status: 404 })
    })
  }

  it('draws no buy buttons at all when billing is off on this deployment', async () => {
    mockBillingOff()
    renderTopUp()
    await screen.findByText(/isn’t available on this deployment/i)
    expect(screen.queryByRole('button', { name: '$10' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '$50' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '$100' })).not.toBeInTheDocument()
  })

  it('says top-up is unavailable here and names the flag that turns it on', async () => {
    mockBillingOff()
    renderTopUp()
    expect(await screen.findByText(/isn’t available on this deployment/i)).toBeInTheDocument()
    expect(screen.getByText(/LENS_BILLING_ENABLED/)).toBeInTheDocument()
  })

  it('still shows the balance — the account is readable even when nothing can be bought', async () => {
    mockBillingOff()
    renderTopUp()
    expect(await screen.findByText(/42/)).toBeInTheDocument()
  })

  it('reads as a calm off-state, not as a failure to load', async () => {
    mockBillingOff()
    renderTopUp()
    await screen.findByText(/isn’t available on this deployment/i)
    expect(screen.queryByText(/couldn’t load/i)).not.toBeInTheDocument()
  })
})

describe('TopUp — starting a purchase', () => {
  it('posts the chosen amount in cents and sends the browser to the Stripe URL', async () => {
    const { post } = mockBff()
    const redirect = vi.fn()
    renderTopUp(redirect)

    fireEvent.click(await screen.findByRole('button', { name: '$50' }))

    await waitFor(() => expect(redirect).toHaveBeenCalledWith(SESSION_URL))
    expect(post).toHaveBeenCalledTimes(1)
    const init = post.mock.calls[0][0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ usd_cents: 5000 })
  })

  it('records the pre-purchase balance so the return page can tell if the credit landed', async () => {
    mockBff()
    const redirect = vi.fn()
    renderTopUp(redirect)

    fireEvent.click(await screen.findByRole('button', { name: '$10' }))
    await waitFor(() => expect(redirect).toHaveBeenCalled())

    const stashed = JSON.parse(window.sessionStorage.getItem(PENDING_TOPUP_KEY) as string)
    expect(stashed.balance_ulxc).toBe(BALANCE.balance_ulxc)
    expect(stashed.usd_cents).toBe(1000)
  })

  it('never navigates when the checkout call fails — no half-started purchase', async () => {
    mockBff({ status: 502, body: { error: 'Lens couldn’t start the payment — nothing was charged' } })
    const redirect = vi.fn()
    renderTopUp(redirect)

    fireEvent.click(await screen.findByRole('button', { name: '$10' }))

    expect(await screen.findByText(/nothing was charged/i)).toBeInTheDocument()
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('TopUp — every failure says what actually happened', () => {
  it('billing disabled on the deployment reads as a state, not a fault, and says buying is unavailable', async () => {
    mockBff({
      status: 503,
      body: { error: 'billing is turned off on this deployment', billing_enabled: false },
    })
    renderTopUp()

    fireEvent.click(await screen.findByRole('button', { name: '$10' }))

    expect(await screen.findByText(/turned off on this deployment/i)).toBeInTheDocument()
    // The customer must be told plainly that they cannot buy here, and told how
    // it gets turned on — not left staring at a dead button.
    expect(screen.getByText(/can’t be bought here|cannot be bought here/i)).toBeInTheDocument()
  })

  it('a rejected origin explains the address, matching the mint screen', async () => {
    mockBff({ status: 403, body: { error: 'cross-origin write refused' } })
    renderTopUp()

    fireEvent.click(await screen.findByRole('button', { name: '$10' }))

    expect(await screen.findByText(/configured address/i)).toBeInTheDocument()
  })

  it('an expired session says to sign in rather than reporting a payment problem', async () => {
    mockBff({ status: 401, body: { error: 'authentication required' } })
    renderTopUp()

    fireEvent.click(await screen.findByRole('button', { name: '$10' }))

    expect(await screen.findByText(/sign in/i)).toBeInTheDocument()
  })

  it('an allow-list drift between the app and Lens is named as a mismatch, not blamed on the customer', async () => {
    mockBff({
      status: 502,
      body: {
        error:
          'this app offers $10, $50, $100, but Lens refused that amount — the two are running different top-up allow-lists. Nothing was charged.',
      },
    })
    renderTopUp()

    fireEvent.click(await screen.findByRole('button', { name: '$10' }))

    expect(await screen.findByText(/different top-up allow-lists/i)).toBeInTheDocument()
  })

  it('a 200 with no session URL is reported, not silently swallowed', async () => {
    // The one way this screen could still fail silently: an upstream answering
    // OK with nothing to navigate to. Doing nothing on click is indistinguishable
    // from a dead button, so it has to say something.
    mockBff({ status: 200, body: {} })
    const redirect = vi.fn()
    renderTopUp(redirect)

    fireEvent.click(await screen.findByRole('button', { name: '$10' }))

    expect(await screen.findByText(/couldn’t start the payment/i)).toBeInTheDocument()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('surfaces a failure to load the amounts instead of guessing at them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    renderTopUp()
    expect(await screen.findByText(/couldn’t load the top-up amounts/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '$10' })).not.toBeInTheDocument()
  })
})
