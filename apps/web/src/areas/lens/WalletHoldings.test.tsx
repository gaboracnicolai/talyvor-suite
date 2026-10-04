import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B22.12 — the DONE line: on Agent Wallets an owner completes an escrow, fills and locks a pot, places a
// simulated order and sees the portfolio, and sees cash-out marked test money only. The mock BFF answers
// the way Lens B22.1, B22.6, B22.7, B22.8 and B22.9 do.

// B17.33 — what a pot's Move out met on each send (a 502, a dropped connection), and the key each carried.
let potOut: { blips: Array<502 | 'drop'>; keys: string[] } = { blips: [], keys: [] }

function mockBff() {
  const sent: Array<{ method: string; url: string; body: unknown }> = []
  potOut = { blips: [], keys: [] }
  const agent = { id: 'agt_1', name: 'Buyer', balance_ulxc: 50_000_000, spent_ulxc: 0, keys: [], created_at: '2026-09-01T09:00:00Z', owner_user_id: 'ws_1', verified: true }
  const escrow = {
    id: 'esc_1',
    payer_workspace_id: 'ws_1',
    payer_agent_id: 'agt_1',
    payee_workspace_id: 'ws_2',
    payee_agent_id: 'agt_bea',
    amount_ulxc: 10_000_000,
    memo: 'logo design',
    class: 'AMBER',
    test_funded_ulxc: 10_000_000,
    release_at: '2026-10-10T00:00:00Z',
    status: 'held',
    created_at: '2026-09-29T09:00:00Z',
    events: [{ kind: 'held', actor: 'payer', at: '2026-09-29T09:00:00Z' }] as Array<Record<string, string>>,
  }
  const pot: Record<string, unknown> = { id: 'pot_1', agent_id: 'agt_1', name: 'Rainy day', kind: 'reserve', target_ulxc: 20_000_000, balance_ulxc: 0, created_at: '2026-09-29T09:00:00Z' }
  const portfolio = {
    id: 'pf_1',
    agent_id: 'agt_1',
    name: 'FX test',
    simulated: true,
    notice: 'Simulated: executed by Talyvor’s simulator at the ECB reference rate. No order is ever sent to a market.',
    market_data: 'European Central Bank euro foreign exchange reference rates (source: ECB, free at www.ecb.europa.eu)',
    rate_date: '2026-09-28',
    starting_cash_uusd: 10_000_000_000,
    cash_uusd: 10_000_000_000,
    positions: [] as unknown[],
    value_uusd: 10_000_000_000,
    orders: [] as unknown[],
    created_at: '2026-09-29T09:00:00Z',
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents') return json({ workspace_balance_ulxc: 50_000_000, allocated_ulxc: 50_000_000, unallocated_ulxc: 0, spent_ulxc: 0, agents: [agent] })
    if (url === '/api/wallets/capabilities')
      return json({
        capabilities: [
          { capability: 'rules_approvals_statements_pots', name: 'Rules, approvals, statements and pots', class: 'GREEN', real_money: true },
          { capability: 'escrow', name: 'Escrow between agents', class: 'AMBER', real_money: false },
          { capability: 'cash_out', name: 'Cashing credits out as money', class: 'RED', real_money: false },
          { capability: 'invest_and_trade', name: 'Investing and trading real assets', class: 'RED', real_money: false },
        ],
      })
    if (url === '/api/wallets/escrows/esc_1/confirm' && method === 'POST') {
      escrow.status = 'released'
      escrow.events.push({ kind: 'released', actor: 'payer', detail: 'delivery confirmed', at: '2026-09-30T09:00:00Z' })
      return json(escrow)
    }
    if (url === '/api/wallets/escrows') return json({ escrows: [escrow] })
    if (url === '/api/agents/agt_1/pots/pot_1/in' && method === 'POST') {
      pot.balance_ulxc = (pot.balance_ulxc as number) + body.amount_ulxc
      return json(pot)
    }
    if (url === '/api/agents/agt_1/pots/pot_1/out' && method === 'POST') {
      potOut.keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
      const blip = potOut.blips.shift()
      if (blip === 502) return json({ error: 'Lens could not answer just now' }, 502)
      if (blip === 'drop') throw new TypeError('Failed to fetch')
      pot.balance_ulxc = (pot.balance_ulxc as number) - body.amount_ulxc
      return json(pot)
    }
    if (url === '/api/agents/agt_1/pots/pot_1/lock' && method === 'PUT') {
      pot.locked_until = body.locked_until
      return json(pot)
    }
    if (url === '/api/agents/agt_1/pots') return json({ pots: [pot] })
    if (url === '/api/wallets/quotes')
      return json({ simulated: true, market_data: portfolio.market_data, rate_date: '2026-09-28', quotes: [{ instrument: 'EUR', price_usd: '1.08000000', rate_date: '2026-09-28' }, { instrument: 'GBP', price_usd: '1.30000000', rate_date: '2026-09-28' }] })
    if (url === '/api/agents/agt_1/portfolios/pf_1/orders' && method === 'POST') {
      const order = { id: 'ord_1', portfolio_id: 'pf_1', ...body, status: 'filled', fill_price_usd: '1.08000000', fill_rate_date: '2026-09-28', cash_uusd: -1_080_000_000, simulated: true, created_at: '2026-09-29T10:00:00Z' }
      portfolio.cash_uusd -= 1_080_000_000
      portfolio.positions = [{ instrument: 'EUR', quantity_micros: 1_000_000_000, price_usd: '1.08000000', value_uusd: 1_080_000_000 }]
      portfolio.orders = [order]
      return json(order, 201)
    }
    if (url === '/api/agents/agt_1/portfolios') return json({ portfolios: [portfolio], notice: portfolio.notice })
    if (url === '/api/wallets/cash-outs') return json({ cash_outs: [] })
    if (url === '/api/wallets/requests') return json({ requests: [] })
    if (url === '/api/wallets/loans') return json({ loans: [] })
    if (url === '/api/wallets/credit-line') return json({ error: 'this workspace has no credit line' }, 404)
    if (url === '/api/agents/agt_1/transfers') return json({ transfers: [] })
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

describe('escrow, pots, investing and cash-out on Agent Wallets', () => {
  it('marks escrow and cash-out test money only and investing simulated, each with why', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)
    const cashOut = await screen.findAllByTestId('test-money-only-cash_out')
    expect(cashOut[0].textContent).toContain('Test money only')
    expect(cashOut[0].textContent).toContain('needs a licensed partner')
    expect((await screen.findAllByTestId('test-money-only-escrow'))[0].textContent).toMatch(/Test money only.*lawyer’s sign-off/)
    expect((await screen.findByTestId('test-money-only-invest_and_trade')).textContent).toMatch(/Simulated only.*authorised broker partner/)
    expect(screen.queryByTestId('test-money-only-rules_approvals_statements_pots')).toBeNull() // GREEN: nothing to mark
    // Never the word bank — but for the European Central Bank, whose rates the simulator and card panel name.
    expect((document.body.textContent ?? '').replace(/European Central Bank/g, '')).not.toMatch(/\bbank\b/i)
  })

  // B17.33 — a Move out that meets a deploy's restart (a 502, then no answer) is sent again under one
  // Idempotency-Key and lands once, instead of "Not moved."
  it('moves credits out of a pot through a restart, sending the same key until it is answered', async () => {
    mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Amount in LXC to move for Rainy day'), { target: { value: '1.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move in' }))
    expect(await within(screen.getByTestId('pot')).findByText('1.2', { selector: '.font-figure' })).toBeTruthy()

    potOut.blips.push(502, 'drop')
    fireEvent.change(screen.getByLabelText('Amount in LXC to move for Rainy day'), { target: { value: '0.4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move out' }))
    expect(await within(screen.getByTestId('pot')).findByText('0.8', { selector: '.font-figure' }, { timeout: 5_000 })).toBeTruthy()
    expect(within(screen.getByTestId('pot')).queryByRole('alert')).toBeNull()
    expect(potOut.keys).toHaveLength(3)
    expect(potOut.keys[0]).not.toBe('')
    expect(new Set(potOut.keys).size).toBe(1)
  }, 15_000)

  it('completes an escrow, fills and locks a pot, and places a simulated order that shows in the portfolio', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const escrow = await screen.findByTestId('escrow')
    expect(escrow.textContent).toContain('Buyer holds for agt_bea')
    fireEvent.click(within(escrow).getByRole('button', { name: 'Confirm delivered' }))
    expect(await within(await screen.findByTestId('escrow')).findByText('Released')).toBeTruthy()
    expect(screen.getByTestId('escrow').textContent).toContain('Released to the payee: delivery confirmed')
    expect(sent).toContainEqual({ method: 'POST', url: '/api/wallets/escrows/esc_1/confirm', body: {} })

    fireEvent.change(await screen.findByLabelText('Amount in LXC to move for Rainy day'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move in' }))
    expect(await within(screen.getByTestId('pot')).findByText('5', { selector: '.font-figure' })).toBeTruthy()
    expect(sent).toContainEqual({ method: 'POST', url: '/api/agents/agt_1/pots/pot_1/in', body: { amount_ulxc: 5_000_000 } })
    fireEvent.change(screen.getByLabelText('Lock Rainy day until'), { target: { value: '2099-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
    expect(await within(screen.getByTestId('pot')).findByText(/Locked until/)).toBeTruthy()
    expect(sent).toContainEqual({ method: 'PUT', url: '/api/agents/agt_1/pots/pot_1/lock', body: { locked_until: new Date('2099-01-01T00:00:00').toISOString() } })

    fireEvent.change(await screen.findByLabelText('Instrument for FX test'), { target: { value: 'EUR' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }))
    expect((await screen.findByText(/^Filled:/)).textContent).toBe('Filled: Buy 1,000 EUR at market — filled at $1.08 (2026-09-28 rate).')
    expect(sent).toContainEqual({ method: 'POST', url: '/api/agents/agt_1/portfolios/pf_1/orders', body: { instrument: 'EUR', side: 'buy', type: 'market', quantity_micros: 1_000_000_000 } })
    const shown = await within(screen.getByTestId('portfolio')).findByText('1,000 EUR')
    expect(shown).toBeTruthy()
    expect(screen.getByTestId('portfolio').textContent).toContain('worth $10,000.00: $8,920.00 cash')
  })
})
