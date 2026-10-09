import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { minorText } from './OperatorCompliance'

// B30.104 — the operator's Compliance page: each capability's class and clearance, the safeguarding view, and each
// day's reconciliation with its breaks. The mock answers the way apps/bff/operator_reconciliation.go relays Lens.

const GBP_RUN = {
  id: 'run-gbp', day: '2026-10-08', currency: 'GBP', funding: 'test', partner: 'test',
  customers_hold_minor: 120_000, partner_holds_minor: 119_300, shortfall_minor: 700, break_count: 1,
  breaks: [{ kind: 'missing', workspace_id: 'ws-acme', account_id: 'acc-1', payment_ref: 'pay_77', ledger_minor: 700, statement_minor: 0, amount_minor: -700 }],
  ran_at: '2026-10-09T01:00:00Z',
}
const USDC_RUN = {
  id: 'run-usdc', day: '2026-10-08', currency: 'USDC', funding: 'test', partner: 'test',
  customers_hold_minor: 2_500_000, partner_holds_minor: 2_500_000, shortfall_minor: 0, break_count: 0, breaks: [],
  ran_at: '2026-10-09T01:00:00Z',
}

function mockBff(admin: { status: number; body: unknown } = { status: 200, body: null }) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'ng@example.com' }, operator: true })
    if (url === '/api/wallets/capabilities')
      return json({
        capabilities: [
          { capability: 'spend_on_talyvor', name: 'Spending on Talyvor', class: 'GREEN', real_money: true },
          { capability: 'currency_accounts', name: 'Accounts in pounds, euros, dollars and USDC', class: 'RED', real_money: false },
          {
            capability: 'pay_another_owner', name: 'Paying another owner', class: 'AMBER', real_money: true,
            clearance: { by: 'nicolai', at: '2026-10-01T09:00:00Z', reference: 'LEGAL-12', licence_reference: 'FCA-9', partner: 'acme-emi', countries: ['GB'], expires_at: '2027-10-01T00:00:00Z' },
          },
        ],
      })
    if (admin.status !== 200 && url.startsWith('/api/admin/')) return json(admin.body, admin.status)
    if (url === '/api/admin/safeguarding') return json({ currencies: [GBP_RUN, USDC_RUN] })
    if (url === '/api/admin/reconciliation') return json({ runs: [GBP_RUN, USDC_RUN] })
    return json(null, 404)
  })
}

async function at(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  return screen.findByRole('navigation', { name: /sections/i })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the operator’s Compliance page (B30.104)', () => {
  it('shows each capability’s class and clearance, the shortfall, and a missing statement line as a break with its amount', async () => {
    mockBff()
    const nav = await at('/operator/compliance')
    expect(within(nav).getByRole('link', { name: 'Compliance' })).toHaveAttribute('href', '/operator/compliance')
    expect(await screen.findByTestId('compliance-preview')).toHaveTextContent('Preview — test money only')

    const caps = await screen.findAllByTestId('compliance-capability')
    expect(caps.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Spending on Talyvorspend_on_talyvorGREENLiveNeeds none$/),
      expect.stringMatching(/currency_accountsREDTest onlyNot cleared$/),
      expect.stringMatching(/AMBERLiveCleared by nicolai on 2026-10-01, until 2027-10-01LEGAL-12 · FCA-9 · acme-emi · GB$/),
    ])

    const cover = await screen.findAllByTestId('compliance-safeguarding')
    expect(cover[0]).toHaveTextContent('£1,200.00')
    expect(cover[0]).toHaveTextContent('£1,193.00')
    expect(cover[0]).toHaveTextContent('Short £7.00')
    expect(cover[1]).toHaveTextContent('2.50 USDC')
    expect(cover[1]).toHaveTextContent('Covered')

    expect(screen.getByTestId('compliance-run-totals')).toHaveTextContent('2 runs · 1 break')
    const [gbp, usdc] = screen.getAllByTestId('compliance-run')
    expect(within(gbp).getByTestId('compliance-break')).toHaveTextContent(
      'Not on the statement: -£7.00ledger £7.00 · statement £0.00 · pay_77 · workspace ws-acme',
    )
    expect(usdc).toHaveTextContent('Clean')
  })

  it('says which key to set when the web app cannot read the reconciliation', async () => {
    const sentence = 'The Compliance page is not connected: set LENS_OPERATOR_READ_KEY in the web app’s environment.'
    mockBff({ status: 501, body: { error: sentence } })
    await at('/operator/compliance')
    await waitFor(() => expect(screen.getAllByText(sentence)).toHaveLength(2))
  })

  it('keeps USDC to six places and pounds to two', () => {
    expect(minorText(1_234_567, 'USDC')).toBe('1.234567 USDC')
    expect(minorText(-700, 'gbp')).toBe('-£7.00')
  })
})
