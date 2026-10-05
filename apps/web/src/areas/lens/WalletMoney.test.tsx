import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B22.10 — the DONE line: on Agent Wallets an owner sends test credits to another person's agent, accepts a
// request, offers a loan to another company and sees its repayments, late and default, and sees each AMBER
// capability marked test money only. The mock BFF answers the way Lens B22.1, B22.3, B22.4 and B22.5 do.

function mockBff({ received = false } = {}) {
  const sent: Array<{ method: string; url: string; body: unknown }> = []
  // B28.23 — with `received`, agt_1 holds a 1.5 LXC transfer from another company's agent, which Lens says it may
  // give back; given back, Lens lists the refund, marks the original refunded_by it, and agt_1 holds 1.5 LXC less.
  const incoming = { id: 'xfr_in', from_workspace_id: 'ws_3', from_agent_id: 'agt_bea', to_workspace_id: 'ws_1', to_agent_id: 'agt_1', amount_ulxc: 1_500_000, memo: 'overpaid', class: 'AMBER', test_funded_ulxc: 0, created_at: '2026-09-29T08:00:00Z' }
  const refund = { ...incoming, id: 'xfr_back', from_workspace_id: 'ws_1', from_agent_id: 'agt_1', to_workspace_id: 'ws_3', to_agent_id: 'agt_bea', memo: 'refund: overpaid', refund_of: 'xfr_in', created_at: '2026-09-29T11:00:00Z' }
  let givenBack = false
  const agent = { id: 'agt_1', name: 'Buyer', balance_ulxc: 50_000_000, spent_ulxc: 0, keys: [], created_at: '2026-09-01T09:00:00Z', owner_user_id: 'ws_1', verified: true, handle: 'acme.buyer' }
  let answered = false
  const loan = {
    id: 'loan_1',
    lender_workspace_id: 'ws_1',
    lender_agent_id: 'agt_1',
    borrower_workspace_id: 'ws_2',
    borrower_agent_id: 'agt_other',
    principal_ulxc: 100_000_000,
    interest_bps: 1000,
    instalments: 3,
    every: 'day',
    late_fee_ulxc: 2_000_000,
    memo: 'working capital',
    status: 'defaulted',
    paid_instalments: 2,
    offered_at: '2026-09-28T09:00:00Z',
    decided_at: '2026-09-28T09:05:00Z',
    events: [
      { kind: 'payout', principal_ulxc: 100_000_000, transfer_id: 'xfer_p', at: '2026-09-28T09:05:00Z' },
      { kind: 'instalment', instalment: 1, principal_ulxc: 33_333_333, interest_ulxc: 3_333_333, transfer_id: 'xfer_1', at: '2026-09-29T09:05:00Z' },
      { kind: 'instalment', instalment: 2, principal_ulxc: 33_333_333, interest_ulxc: 3_333_333, transfer_id: 'xfer_2', at: '2026-09-30T09:05:00Z' },
      { kind: 'missed', instalment: 3, detail: 'economy: not enough funds for this movement', at: '2026-10-01T09:05:00Z' },
      { kind: 'late', instalment: 3, at: '2026-10-01T09:05:00Z' },
      { kind: 'missed', instalment: 3, late_fee_ulxc: 2_000_000, at: '2026-10-02T09:05:00Z' },
      { kind: 'defaulted', instalment: 3, at: '2026-10-02T09:05:00Z' },
    ],
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') {
      const held = agent.balance_ulxc - (givenBack ? 1_500_000 : 0)
      return json({ workspace_balance_ulxc: held, allocated_ulxc: held, unallocated_ulxc: 0, spent_ulxc: 0, agents: [{ ...agent, balance_ulxc: held }] })
    }
    if (url === '/api/wallets/transfers/xfr_in/refund' && method === 'POST') {
      givenBack = true
      return json(refund)
    }
    if (url === '/api/wallets/capabilities')
      return json({
        capabilities: [
          { capability: 'pay_another_owner', name: 'Sending and requesting money between different owners', class: 'AMBER', real_money: false },
          { capability: 'loans_between_companies', name: 'Loans between companies', class: 'AMBER', real_money: false },
          { capability: 'company_credit_line', name: 'Talyvor’s credit line to companies, for Talyvor services', class: 'GREEN', real_money: true },
        ],
      })
    if (url === '/api/agents/agt_1/send' && method === 'POST')
      return json({ id: 'xfer_9', from_workspace_id: 'ws_1', from_agent_id: 'agt_1', to_workspace_id: 'ws_3', to_agent_id: 'agt_bea', amount_ulxc: 5_000_000, class: 'AMBER', test_funded_ulxc: 5_000_000, created_at: '2026-09-29T10:00:00Z' })
    if (url === '/api/agents/agt_1/transfers')
      return json({ transfers: !received ? [] : givenBack ? [refund, { ...incoming, refunded_by: 'xfr_back' }] : [{ ...incoming, refundable: true }] })
    if (url === '/api/wallets/requests/mreq_1/accept' && method === 'POST') {
      answered = true
      return json({ id: 'mreq_1', status: 'accepted' })
    }
    if (url === '/api/wallets/requests')
      return json({
        requests: [
          { id: 'mreq_1', from_workspace_id: 'ws_3', from_agent_id: 'agt_bea', to_workspace_id: 'ws_1', to_agent_id: 'agt_1', amount_ulxc: 20_000_000, memo: 'expenses', status: answered ? 'accepted' : 'pending', created_at: '2026-09-29T09:00:00Z' },
        ],
      })
    if (url === '/api/wallets/credit-line') return json({ error: 'this workspace has no credit line' }, 404)
    if (url === '/api/agents/agt_1/loans' && method === 'POST') return json({ ...loan, id: 'loan_2', status: 'offered', paid_instalments: 0, events: [] }, 201)
    if (url === '/api/wallets/loans') return json({ loans: [loan] })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/agt_1/card') return json({ error: 'economy: this agent has no card' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('money between owners on Agent Wallets', () => {
  it('marks each AMBER capability test money only, and why', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)
    for (const c of ['pay_another_owner', 'loans_between_companies']) {
      const marks = await screen.findAllByTestId(`test-money-only-${c}`)
      expect(marks[0].textContent).toContain('Test money only')
      expect(marks[0].textContent).toMatch(/lawyer’s sign-off/)
    }
    expect(screen.queryByTestId('test-money-only-company_credit_line')).toBeNull() // GREEN: nothing to mark
    // Never the word bank — but for the European Central Bank, whose rate the card panel (B19.24) names.
    expect((document.body.textContent ?? '').replace(/European Central Bank/g, '')).not.toMatch(/\bbank\b/i)
  })

  it('sends test credits to another person’s agent, accepts a request, and offers a loan whose repayments, late and default show', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    expect((await screen.findByTestId('agent-address')).textContent).toContain('@acme.buyer')
    fireEvent.change(screen.getByLabelText('Send to (wallet ID or @handle)'), { target: { value: '@bea' } })
    fireEvent.change(screen.getByLabelText('Amount in LXC to send'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('What it is for'), { target: { value: 'design work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send credits' }))
    expect((await screen.findByText(/Sent/)).textContent).toMatch(/Sent 5 LXC of test money\. It went to another owner’s agent\./)
    expect(sent).toContainEqual({ method: 'POST', url: '/api/agents/agt_1/send', body: { to: '@bea', amount_ulxc: 5_000_000, memo: 'design work' } })

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('Accepted')).toBeTruthy()
    expect(sent).toContainEqual({ method: 'POST', url: '/api/wallets/requests/mreq_1/accept', body: {} })

    fireEvent.change(screen.getByLabelText('Lend to (wallet ID or @handle)'), { target: { value: '@other.co' } })
    fireEvent.change(screen.getByLabelText('Loan amount in LXC'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Interest over the whole loan, in percent'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Offer' }))
    expect(await screen.findByText(/Offered\./)).toBeTruthy()
    expect(sent).toContainEqual({
      method: 'POST',
      url: '/api/agents/agt_1/loans',
      body: { to: '@other.co', principal_ulxc: 100_000_000, interest_bps: 1000, instalments: 3, every: 'month', late_fee_ulxc: 0, memo: '' },
    })

    const shown = (await screen.findByTestId('loan')).textContent ?? ''
    expect(shown).toContain('In default')
    expect(shown).toContain('2 of 3 repaid')
    expect(shown).toContain('Instalment 1 of 3 repaid: 33.333333 LXC + 3.333333 LXC interest')
    expect(shown).toContain('Instalment 2 of 3 repaid')
    expect(shown).toContain('The loan is late')
    expect(shown).toContain('Missed again: the loan is in default')
    expect((await screen.findByTestId('no-credit-line')).textContent).toContain('no credit line')
  })

  it('gives back a received transfer, asked twice: the refund shows, the original is marked, and the balance falls by it', async () => {
    const sent = mockBff({ received: true })
    window.history.pushState({}, '', '/agents')
    render(<App />)

    expect((await screen.findByTestId('agent-balance-agt_1')).textContent).toContain('50')
    expect(await screen.findByText('Received from agt_bea — overpaid')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Give back' }))
    expect(sent).toEqual([]) // the first press only asks
    fireEvent.click(screen.getByRole('button', { name: 'Yes, give it back' }))

    expect((await screen.findByText(/^Gave .*back to agt_bea\.$/)).textContent).toMatch(/^Gave 1\.5 LXC.* back to agt_bea\.$/)
    expect(sent).toContainEqual({ method: 'POST', url: '/api/wallets/transfers/xfr_in/refund', body: {} })
    expect(await screen.findByText('Gave back to agt_bea — refund: overpaid')).toBeTruthy()
    expect(screen.getByText('Given back')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Give back' })).toBeNull()
    await vi.waitFor(() => expect(screen.getByTestId('agent-balance-agt_1').textContent).toContain('48.5'))
  })
})
