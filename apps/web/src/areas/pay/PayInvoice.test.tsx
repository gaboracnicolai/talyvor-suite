import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.97 — the pay page, signed out: it shows the invoice as Lens serves it with "Preview — test money only", the card button asks
// the BFF's public route for the checkout and sends the browser there, and back with ?paid=card it reads again until paid.

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef'

function mockBff() {
  let status: 'sent' | 'paid' = 'sent'
  let cardCalls = 0
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, code = 200) => new Response(JSON.stringify(v), { status: code, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: false, user: null })
    if (url === '/api/agents') return json({ error: 'sign in' }, 401)
    if (url === `/api/public/pay/${TOKEN}/card` && init?.method === 'POST') {
      cardCalls += 1
      return json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }, 201)
    }
    if (url === `/api/public/pay/${TOKEN}`) {
      const paid = status === 'paid'
      return json({
        notice: 'Preview — test money only. Nothing paid here moves real money.',
        card: !paid,
        ...(paid ? {} : { transfer: { details: { holder: 'Fixture Ltd', currency: 'GBP', sort_code: '040004', account_number: '12345678' }, mode: 'TEST', reference: 'TLV-AGT a1b2c3' } }),
        invoice: { id: 'inv_1', issuer: 'Fixture Ltd', number: 'INV-000001', reference: 'a1b2c3', currency: 'GBP', customer_name: 'Acme',
          lines: [{ description: 'Research', quantity: 2, unit_amount_minor: 5000, vat_rate_bps: 2000, net_minor: 10000, vat_minor: 2000 }],
          subtotal_minor: 10000, vat_minor: 2000, total_minor: 12000, paid_minor: paid ? 12000 : 0, due_minor: paid ? 0 : 12000, due_date: '2026-12-31',
          remind_days_before: 0, status, created_at: '2026-10-11T09:00:00Z', ...(paid ? { paid_at: '2026-10-11T10:00:00Z', payments: [{ entry_id: 'e1', method: 'card', amount_minor: 12000, paid_at: '2026-10-11T10:00:00Z' }] } : {}) },
      })
    }
    return json({ error: 'not found' }, 404)
  })
  return { pay: () => (status = 'paid'), cards: () => cardCalls }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the pay page', () => {
  it('shows the invoice with Preview — test money only, sends the payer to the checkout Lens opened, and reads paid on return', async () => {
    const bff = mockBff()
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign, pathname: `/pay/${TOKEN}`, search: '' } as Location)
    window.history.pushState({}, '', `/pay/${TOKEN}`)
    const view = render(<App />)

    expect((await screen.findByTestId('pay-headline')).textContent).toBe('£120.00 due by 2026-12-31')
    expect(screen.getByTestId('pay-preview').textContent).toContain('Preview — test money only')
    expect(screen.getByTestId('pay-due').textContent).toBe('£120.00')
    expect(screen.getByTestId('pay-reference').textContent).toContain('TLV-AGT a1b2c3')
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pay £120.00 by card' }))
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'))
    expect(bff.cards()).toBe(1)

    // Back from Stripe: the invoice is paid, and the page says so with the card payment.
    bff.pay()
    view.unmount()
    queryClient.clear()
    window.history.pushState({}, '', `/pay/${TOKEN}?paid=card`)
    render(<App />)
    expect((await screen.findByTestId('pay-headline')).textContent).toBe('Paid — thank you')
    expect(screen.getByTestId('pay-paid').textContent).toContain('£120.00 by card')
    expect(screen.queryByRole('button', { name: /by card/ })).toBeNull()
  })
})
