import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.97 — the Invoices screen: an invoice issued from an agent's account with "Create and send" goes to the BFF with the
// lines the form holds, in minor units and basis points, and the row then reads Sent with its pay link.

const ACCOUNTS = [
  { id: 'macc_co', agent_id: '', currency: 'GBP', purpose: 'company', status: 'open', name: 'GBP account', balance_minor: 0, test_minor: 0, live_minor: 0 },
  { id: 'macc_agt', agent_id: 'agt_1', currency: 'GBP', purpose: 'agent', status: 'open', name: 'GBP account', balance_minor: 0, test_minor: 0, live_minor: 0 },
]

function mockBff() {
  const sent: Array<{ url: string; body: unknown }> = []
  const invoices: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/accounts') return json({ accounts: ACCOUNTS })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-10T09:00:00Z' }] })
    if (url === '/api/wallets/capabilities') return json({ capabilities: [{ capability: 'payments_in', name: 'Money in', class: 'RED', real_money: false, level_needed: 'L2' }] })
    if (url === '/api/money/invoices' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { lines: { quantity: number; unit_amount_minor: number; vat_rate_bps: number }[]; send: boolean }
      sent.push({ url, body })
      const net = body.lines.reduce((s, l) => s + l.quantity * l.unit_amount_minor, 0)
      const vat = body.lines.reduce((s, l) => s + Math.round((l.quantity * l.unit_amount_minor * l.vat_rate_bps) / 10000), 0)
      const inv = { id: 'inv_1', issuer: 'Fixture Ltd', number: 'INV-000001', reference: 'a1b2c3d4e5f6', pay_url: 'https://app.talyvor.com/pay/0123456789abcdef0123456789abcdef0123456789abcdef',
        currency: 'GBP', customer_name: 'Acme', lines: body.lines, subtotal_minor: net, vat_minor: vat, total_minor: net + vat, paid_minor: 0, due_minor: net + vat,
        due_date: '2026-12-31', remind_days_before: 0, status: body.send ? 'sent' : 'draft', created_at: '2026-10-11T09:00:00Z' }
      invoices.unshift(inv)
      return json(inv, 201)
    }
    if (url === '/api/money/invoices') return json({ invoices })
    return json({ error: 'not found' }, 404)
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Invoices screen', () => {
  it('issues an invoice from the agent’s account with its lines in minor units, and the row reads Sent with its pay link', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/invoices')
    render(<App />)

    const form = await screen.findByTestId('new-invoice')
    expect(screen.getByTestId('invoices-preview').textContent).toContain('Preview — test money only')
    expect(screen.getByText('No invoice issued yet: create one above, and it appears here when it is issued.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Paid into'), { target: { value: 'macc_agt' } })
    fireEvent.change(within(form).getByLabelText('Customer'), { target: { value: 'Acme' } })
    fireEvent.change(within(form).getByLabelText('Line 1: description'), { target: { value: 'Research' } })
    fireEvent.change(within(form).getByLabelText('Line 1: quantity'), { target: { value: '2' } })
    fireEvent.change(within(form).getByLabelText('Line 1: unit price in GBP'), { target: { value: '50.00' } })
    fireEvent.change(within(form).getByLabelText('Line 1: VAT %'), { target: { value: '20' } })
    expect(within(form).getByTestId('new-invoice-total').textContent).toBe('£120.00')
    fireEvent.click(within(form).getByRole('button', { name: 'Create and send' }))

    const row = await screen.findByTestId('invoice-INV-000001')
    expect(bff.sent).toHaveLength(1)
    expect(bff.sent[0].body).toMatchObject({ account_id: 'macc_agt', customer_name: 'Acme', send: true, due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
      lines: [{ description: 'Research', quantity: 2, unit_amount_minor: 5000, vat_rate_bps: 2000 }] })
    expect(within(row).getByText('Sent')).toBeTruthy()
    expect(within(row).getByText('£120.00')).toBeTruthy()
    expect((within(row).getByTestId('pay-link') as HTMLInputElement).value).toBe('https://app.talyvor.com/pay/0123456789abcdef0123456789abcdef0123456789abcdef')
    expect(screen.getByTestId('invoices-count').textContent).toBe('1 invoice, 0 paid')
  })
})
