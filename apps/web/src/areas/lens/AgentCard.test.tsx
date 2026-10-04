import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.24 — the DONE line: an owner issues an agent a card and sees an approved and a declined purchase on
// it, each with its reason and rate. The mock BFF answers the way Lens B19.12 does: 404 until a card is
// issued, then the card and its authorisations, newest first, each with Lens's reason and the ECB's two
// published figures for the day it was converted at.

function mockBff() {
  const sent: Array<{ method: string; url: string; body: unknown }> = []
  const agent = { id: 'agt_1', name: 'Researcher', balance_ulxc: 50_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z', owner_user_id: 'ws_1', verified: true }
  let issued = false
  const purchase = (id: string, approved: boolean, pence: number, reason: string, ulxc?: number) => ({
    id,
    authorization_id: `iauth_${id}`,
    approved,
    reason,
    amount_minor: pence,
    currency: 'gbp',
    merchant_name: 'Compute shop',
    merchant_category: 'computer_software_stores',
    rate_date: '2026-09-25T00:00:00Z',
    ecb_usd_per_eur: '1.1672',
    ecb_currency_per_eur: '0.8354',
    amount_ulxc: ulxc,
    created_at: '2026-09-28T10:00:00Z',
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') sent.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({ workspace_balance_ulxc: 100_000_000, allocated_ulxc: 50_000_000, unallocated_ulxc: 50_000_000, spent_ulxc: 0, agents: [agent] })
    if (url === '/api/agents/agt_1/card' && method === 'POST') {
      issued = true
      return json({ id: 'ic_1', agent_id: 'agt_1', last4: '4242', exp_month: 9, exp_year: 2029, currency: 'gbp', livemode: false, created_at: '2026-09-28T09:00:00Z' }, 201)
    }
    if (url === '/api/agents/agt_1/card') {
      if (!issued) return json({ error: 'economy: this agent has no card' }, 404)
      return json({
        card: { id: 'ic_1', agent_id: 'agt_1', last4: '4242', exp_month: 9, exp_year: 2029, currency: 'gbp', livemode: false, created_at: '2026-09-28T09:00:00Z' },
        authorizations: [
          purchase('b', false, 200, "the agent's spending rules refuse this request: this payment would cost up to 27.943501 LXC; the agent's limit per request is 20 LXC"),
          purchase('a', true, 100, "within the agent's rules and balance", 13_971_751),
        ],
      })
    }
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 20_000_000, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    return new Response('null', { status: 404 })
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe("an agent's card on Agent Wallets", () => {
  it('issues a test card, then shows an approved and a declined purchase with the reason and the rate', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const issue = await screen.findByRole('button', { name: 'Issue a test card' })
    expect((issue as HTMLButtonElement).disabled).toBe(true) // the cardholder Stripe needs comes first
    for (const [label, value] of [
      ['First name', 'Ada'],
      ['Last name', 'Lovelace'],
      ['Address', '1 High Street'],
      ['Town or city', 'London'],
      ['Postcode', 'N1 1AA'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(issue)

    const card = await screen.findByTestId('agent-card')
    expect(card.textContent).toContain('•••• 4242')
    expect(card.textContent).toContain('expires 09/29 · GBP')
    expect(within(card).getByText('Test mode')).toBeTruthy()

    const rows = within(screen.getByTestId('agent-card-purchases')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Declined')).toBeTruthy()
    expect(rows[0].textContent).toContain("the agent's limit per request is 20 LXC")
    expect(rows[0].textContent).toContain('£2.00')
    expect(rows[0].textContent).toContain('—') // nothing charged
    expect(within(rows[1]).getByText('Approved')).toBeTruthy()
    expect(rows[1].textContent).toContain("within the agent's rules and balance")
    expect(rows[1].textContent).toContain('£1 = $1.3972 · ECB, 2026-09-25')
    expect(rows[1].textContent).toContain('−13.971751')

    expect(sent).toEqual([
      {
        method: 'POST',
        url: '/api/agents/agt_1/card',
        body: { first_name: 'Ada', last_name: 'Lovelace', email: '', phone_number: '', line1: '1 High Street', line2: '', city: 'London', postal_code: 'N1 1AA', country: 'GB' },
      },
    ])
  })

  // B27.21 — the holder's own phone goes with the cardholder, as Stripe takes it (E.164); one without its
  // country code holds the card back and says why. Lens hands phone_number to Stripe's cardholder.
  it("sends the holder's phone in E.164, and holds a phone without its country code", async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const issue = await screen.findByRole('button', { name: 'Issue a test card' })
    for (const [label, value] of [
      ['First name', 'Ada'],
      ['Last name', 'Lovelace'],
      ['Address', '1 High Street'],
      ['Town or city', 'London'],
      ['Postcode', 'N1 1AA'],
      ['Phone', '07700 900123'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    expect(screen.getByText('The phone number needs its country code, like +44 7700 900123.')).toBeTruthy()
    expect((issue as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+44 7700 900123' } })
    expect(screen.queryByText(/needs its country code/)).toBeNull()
    fireEvent.click(issue)

    await screen.findByTestId('agent-card')
    expect(sent).toHaveLength(1)
    expect((sent[0].body as { phone_number: string }).phone_number).toBe('+447700900123')
  })
})
