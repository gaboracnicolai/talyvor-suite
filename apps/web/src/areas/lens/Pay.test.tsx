import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.96 — the Pay screen: a payee saved with its account details is listed with what its bank said of the name; a payment
// to it from the agent's account goes to the BFF in minor units with the account, the payee and one idempotency key, and the
// row then reads Completed; a payouts CSV goes up as text/csv and the batch reads its rows' results.

const ACCOUNTS = [
  { id: 'macc_co', agent_id: '', currency: 'GBP', purpose: 'company', status: 'open', name: 'GBP account', balance_minor: 0, test_minor: 0, live_minor: 0 },
  { id: 'macc_agt', agent_id: 'agt_1', currency: 'GBP', purpose: 'agent', status: 'open', name: 'GBP account', balance_minor: 10000, test_minor: 10000, live_minor: 0 },
]

function mockBff() {
  const sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []
  const payees: unknown[] = []
  const payments: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/money/accounts') return json({ accounts: ACCOUNTS })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 0, allocated_ulxc: 0, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-10T09:00:00Z' }] })
    if (url === '/api/wallets/capabilities') return json({ capabilities: [{ capability: 'payments_out', name: 'Money out', class: 'RED', real_money: false, level_needed: 'L2' }] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/money/mandates') return json({ granted: [], received: [] })
    if (url === '/api/money/payouts' && init?.method === 'POST') {
      sent.push({ url, headers: init.headers as Record<string, string>, body: init.body })
      return json({ id: 'mpob_1', funding: 'test', status: 'awaiting_approval', rows_total: 2, rows_valid: 1, rows_invalid: 1, totals_minor: { GBP: 500 }, created_at: '2026-10-11T09:00:00Z',
        rows: [{ line: 2, payee_id: 'payee_1', payee_name: 'Acme Ltd', amount_minor: 500, currency: 'GBP', reference: 'May', status: 'valid' },
          { line: 3, payee_id: 'nobody', amount_minor: 100, currency: 'GBP', reference: '', status: 'invalid', detail: 'no such payee' }] }, 201)
    }
    if (url === '/api/money/payouts') return json({ payouts: [] })
    if (url === '/api/money/payees' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, string>
      sent.push({ url, headers: init.headers as Record<string, string>, body })
      const p = { id: 'payee_1', ...body, check: 'exact_match', checked_by: 'test', checked_at: '2026-10-11T09:00:00Z', needs_confirmation: false, created_at: '2026-10-11T09:00:00Z' }
      payees.push(p)
      return json(p, 201)
    }
    if (url === '/api/money/payees') return json({ payees })
    if (url === '/api/money/payments' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      sent.push({ url, headers: init.headers as Record<string, string>, body })
      const p = { id: 'mpay_1', account_id: body.account_id, payee_id: body.payee_id, payee_name: 'Acme Ltd', amount_minor: body.amount_minor, currency: body.currency, funding: 'test',
        reference: body.reference, idempotency_key: body.idempotency_key, status: 'completed', created_at: '2026-10-11T09:00:00Z', updated_at: '2026-10-11T09:00:01Z' }
      payments.unshift(p)
      return json(p, 201)
    }
    if (url === '/api/money/payments') return json({ payments })
    return json({ error: 'not found' }, 404)
  })
  return { sent }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Pay screen', () => {
  it('saves a payee, pays it from the agent’s account in minor units under one key, and the payment reads Completed', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)

    const payeeForm = await screen.findByTestId('new-payee')
    expect(screen.getByTestId('pay-preview').textContent).toContain('Preview — test money only')
    fireEvent.change(within(payeeForm).getByLabelText('Payee’s name'), { target: { value: 'Acme Ltd' } })
    fireEvent.change(within(payeeForm).getByLabelText('Sort code'), { target: { value: '04-00-04' } })
    fireEvent.change(within(payeeForm).getByLabelText('Account number'), { target: { value: '12345678' } })
    fireEvent.click(within(payeeForm).getByRole('button', { name: 'Save payee' }))
    const payee = await screen.findByTestId('payee-payee_1')
    expect(bff.sent[0].body).toEqual({ name: 'Acme Ltd', country: 'GB', sort_code: '040004', account_number: '12345678' })
    expect(within(payee).getByText('Exact match')).toBeTruthy()

    const form = screen.getByTestId('send-payment')
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: 'macc_agt' } })
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: 'payee_1' } })
    fireEvent.change(within(form).getByLabelText('Amount in GBP'), { target: { value: '20.00' } })
    fireEvent.change(within(form).getByLabelText('Reference'), { target: { value: 'Rent' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }))
    const row = await screen.findByTestId('payment-mpay_1')
    expect(bff.sent[1].body).toMatchObject({ account_id: 'macc_agt', payee_id: 'payee_1', amount_minor: 2000, currency: 'GBP', reference: 'Rent' })
    expect(String((bff.sent[1].body as { idempotency_key: string }).idempotency_key).length).toBeGreaterThan(8)
    expect(within(row).getByText('£20.00')).toBeTruthy()
    expect(within(row).getByText('Completed')).toBeTruthy()
    expect(screen.getByTestId('pay-count').textContent).toBe('1 payment out, 1 completed')
  })

  it('uploads a payouts CSV as text/csv under one key and shows each row’s result', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/money/pay')
    render(<App />)
    const form = await screen.findByTestId('payout-upload')
    const csv = 'payee_id,amount,currency,reference\npayee_1,5.00,GBP,May\nnobody,1.00,GBP,\n'
    const file = new File([csv], 'payouts.csv', { type: 'text/csv' })
    file.text = () => Promise.resolve(csv)
    fireEvent.change(within(form).getByLabelText('Payouts CSV'), { target: { files: [file] } })
    fireEvent.click(within(form).getByRole('button', { name: 'Upload and check' }))
    const batch = await screen.findByTestId('payout-mpob_1')
    expect(bff.sent[0].headers['Content-Type']).toBe('text/csv')
    expect(bff.sent[0].headers['Idempotency-Key'].length).toBeGreaterThan(8)
    expect(bff.sent[0].body).toBe(csv)
    expect(within(batch).getByTestId('payout-row-3').textContent).toContain('no such payee')
    expect(within(batch).getByRole('button', { name: 'Approve and pay 1 row' })).toBeTruthy()
  })
})
