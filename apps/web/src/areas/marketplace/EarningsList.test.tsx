import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.159 — the earnings list on screen: /marketplace/selling draws one row for each earning in Lens's earnings list
// (GET …/marketplace/earnings → earnings[], its latest 100, newest first), in Lens's order, each with its share to
// the µUSD and where that share is. The list below is Lens's JSON for a sale in the holdback, a royalty from a remix
// of the seller's listing, a payment to the seller's agent, a share held for a dispute, a refunded one and a use that
// cost less than a cent.

const LENS_EARNINGS = [
  { use_id: 'use_6', listing_id: 'lst_1', kind: 'sale', gross_usd_micros: 500_000, share_usd_micros: 425_000, fee_usd_micros: 75_000, invoice_id: 'in_6', cleared_at: '2026-10-08T10:00:00Z', payable_at: '2099-01-01T00:00:00Z' },
  { use_id: 'use_5', listing_id: 'lst_theirs', kind: 'lineage', depth: 1, original_listing_id: 'lst_1', gross_usd_micros: 0, share_usd_micros: 21_250, fee_usd_micros: 0, invoice_id: 'in_5', cleared_at: '2026-10-07T10:00:00Z', payable_at: '2026-10-07T10:00:00Z' },
  { use_id: 'use_4', listing_id: '', kind: 'sale', gross_usd_micros: 2_000_000, share_usd_micros: 1_700_000, fee_usd_micros: 300_000, invoice_id: 'in_4', cleared_at: '2026-10-06T10:00:00Z', payable_at: '2026-10-06T10:00:00Z', payee_agent_id: 'agt_bea' },
  { use_id: 'use_3', listing_id: 'lst_1', kind: 'sale', gross_usd_micros: 500_000, share_usd_micros: 425_000, fee_usd_micros: 75_000, invoice_id: 'in_3', cleared_at: '2026-10-05T10:00:00Z', payable_at: '2026-10-05T10:00:00Z', held_for: 'dispute' },
  { use_id: 'use_2', listing_id: 'lst_1', kind: 'sale', gross_usd_micros: 500_000, share_usd_micros: 425_000, fee_usd_micros: 75_000, invoice_id: 'in_2', cleared_at: '2026-10-04T10:00:00Z', payable_at: '2026-10-04T10:00:00Z', refunded_at: '2026-10-05T09:00:00Z' },
  { use_id: 'use_1', listing_id: 'lst_1', kind: 'sale', gross_usd_micros: 10_000, share_usd_micros: 8_500, fee_usd_micros: 1_500, invoice_id: 'in_1', cleared_at: '2026-10-03T10:00:00Z', payable_at: '2026-10-03T10:00:00Z' },
]

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/marketplace/mine')
      return json({ listings: [{ id: 'lst_1', workspace_id: 'ws_seller', kind: 'prompt', title: 'Translate to French', price_per_use_ulxc: 5_000_000, visibility: 'public', latest_version: 1 }] })
    if (url === '/api/marketplace/earnings')
      return json({
        pending_uses: 0,
        pending_usd_micros: 0,
        payable_usd_micros: 2_579_250,
        in_holdback_usd_micros: 425_000,
        available_usd_micros: 2_154_250,
        paid_out_usd_micros: 0,
        owed_usd_micros: 0,
        lifetime_gross_usd_micros: 3_510_000,
        refunded_usd_micros: 425_000,
        earnings: LENS_EARNINGS,
      })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the earnings list on screen', () => {
  it('draws one row for each earning in Lens’s list, in its order, with its share and where it is', async () => {
    mockBff()
    window.history.pushState({}, '', '/marketplace/selling')
    render(<App />)

    const list = await screen.findByTestId('market-earnings-list')
    const rows = within(list).getAllByTestId('market-earning')
    expect(rows.map((r) => r.dataset.useId)).toEqual(LENS_EARNINGS.map((e) => e.use_id))
    expect(rows.map((r) => within(r).getByTestId('market-earning-share').textContent)).toEqual([
      '$0.425',
      '$0.02125',
      '$1.70',
      '$0.425',
      '$0.425',
      '$0.0085',
    ])
    expect(rows.map((r) => within(r).getByTestId('market-earning-state').textContent)).toEqual([
      'In the holdback',
      'Past the holdback',
      'Past the holdback',
      'Held: dispute',
      'Refunded',
      'Past the holdback',
    ])
    // The sale links to the seller's listing by its title; the royalty names the original it was paid on; a payment
    // to the seller's agent has no listing to link to.
    expect(within(rows[0]).getByRole('link', { name: 'Translate to French' }).getAttribute('href')).toBe('/marketplace/listings/lst_1')
    expect(rows[1].textContent).toContain('Royalty on Translate to French')
    expect(within(rows[2]).queryByRole('link')).toBeNull()
    expect(rows[2].textContent).toContain('Payment to your agent')
    expect(rows[0].textContent).toContain('buyer paid $0.50, Talyvor’s fee $0.075')
    expect(within(rows[4]).getByTestId('market-earning-share').className).toContain('line-through')
  })
})
