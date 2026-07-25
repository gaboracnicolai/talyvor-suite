import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

// THE URLS ARE NOT OURS TO CHOOSE. Lens's Stripe redirect targets are configured
// in talyvor-lens (internal/config/config.go), and their DEFAULTS are literally:
//
//   LENS_BILLING_SUCCESS_URL = https://app.talyvor.com/billing/success?session_id={CHECKOUT_SESSION_ID}
//   LENS_BILLING_CANCEL_URL  = https://app.talyvor.com/billing/cancel
//
// A paying customer is returned to those paths by Stripe as a full page load. If
// this app does not resolve them, the customer's payment lands them on a broken
// page — which is exactly the state this repo was in before this change. These
// tests pin the contract at the URL, not at the component: renaming a route or
// mounting it one level deeper breaks them, which is the point.

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      // disabled mode: the gate passes straight through to the app.
      return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/lxc/balance') {
      return new Response(
        JSON.stringify({
          workspace_id: 'trial-ws-1',
          balance_ulxc: 42_000_000,
          lifetime_minted_ulxc: 0,
          lifetime_spent_ulxc: 0,
          usd_value_uusd: 4_200_000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/lxc/topup-options') {
      return new Response(JSON.stringify({ allowed_usd_cents: [1000, 5000, 10000] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(mockBff)
afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('the billing routes Lens already redirects to', () => {
  it('resolves /billing/success — the exact path in LENS_BILLING_SUCCESS_URL', async () => {
    at('/billing/success?session_id=cs_test_a1b2c3')
    expect(await screen.findByText(/your payment went through/i)).toBeInTheDocument()
    // And it carries the session id Stripe appended, as the support reference.
    expect(await screen.findByText(/cs_test_a1b2c3/)).toBeInTheDocument()
  })

  it('resolves /billing/cancel — the exact path in LENS_BILLING_CANCEL_URL', async () => {
    at('/billing/cancel')
    expect(await screen.findByText(/nothing was charged/i)).toBeInTheDocument()
  })

  it('resolves /billing, where a customer starts a top-up', async () => {
    at('/billing')
    expect(await screen.findByRole('button', { name: '$10' })).toBeInTheDocument()
  })

  it('reaches the top-up screen from the sidebar, so buying is discoverable', async () => {
    at('/')
    expect(await screen.findByRole('button', { name: /^billing$/i })).toBeInTheDocument()
  })
})
