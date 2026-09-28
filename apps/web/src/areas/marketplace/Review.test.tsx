import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B20.12 — an operator sees a reported listing in the review queue, takes it down with a reason, and
// sees the buyers' refunds. The mock BFF answers as apps/bff/market_review.go relays Lens B20.4.

const LISTING = {
  id: 'lst_leak', workspace_id: 'ws_seller', kind: 'prompt', title: 'Leaky prompt', description: '',
  price_per_use_ulxc: 500_000, visibility: 'public', latest_version: 1, created_at: '2026-09-28T09:00:00Z',
  updated_at: '2026-09-28T09:00:00Z', review_status: 'approved',
}

function mockBff(operator: boolean) {
  const takedowns: unknown[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me')
      return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'ng@example.com' }, operator })
    if (url === '/api/admin/marketplace/review')
      return takedowns.length > 0
        ? json({ listings: [] })
        : json({ listings: [{ listing: LISTING, open_reports: 2, report_reasons: ['secret'], report_details: ['an API key in the template'] }] })
    if (url === '/api/admin/marketplace/listings/lst_leak/takedown') {
      takedowns.push(JSON.parse(String(init?.body)))
      return json({
        listing: { ...LISTING, review_status: 'taken_down', review_reason: 'exposes a live key' },
        refunds: [{ use_id: 'use_1', listing_id: 'lst_leak', buyer_workspace_id: 'ws_buyer', seller_workspace_id: 'ws_seller',
          price_ulxc: 500_000, gross_usd_micros: 500_000, reversed_share_usd_micros: 500_000, reason: 'exposes a live key',
          refunded_at: '2026-09-28T10:00:00Z' }],
      })
    }
    return new Response('null', { status: 404 })
  })
  return takedowns
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

describe('the marketplace review queue (B20.12)', () => {
  it('an operator takes a reported listing down with a reason and sees the refunds', async () => {
    const takedowns = mockBff(true)
    await at('/marketplace/review')
    const item = await screen.findByTestId('review-item')
    expect(within(item).getByText('Leaky prompt')).toBeTruthy()
    expect(within(item).getByText('an API key in the template')).toBeTruthy()
    fireEvent.click(within(item).getByRole('button', { name: 'Take down' }))
    fireEvent.change(within(item).getByLabelText(/Why it is taken down/), { target: { value: 'exposes a live key' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Take down and refund' }))
    const result = await screen.findByTestId('takedown-result')
    expect(takedowns).toEqual([{ reason: 'exposes a live key' }])
    expect(within(result).getByText('ws_buyer')).toBeTruthy()
    expect(within(result).getByText('exposes a live key')).toBeTruthy()
    expect(await screen.findByText(/^Nothing is waiting for review\./)).toBeTruthy()
  })

  it('the sidebar offers the queue to an operator and to nobody else', async () => {
    mockBff(true)
    const nav = await at('/marketplace')
    expect(await within(nav).findByRole('link', { name: 'Review queue' })).toBeTruthy()
    cleanup()
    queryClient.clear()
    mockBff(false)
    const nav2 = await at('/marketplace')
    await within(nav2).findByRole('link', { name: 'Your bill' })
    expect(within(nav2).queryByRole('link', { name: 'Review queue' })).toBeNull()
  })
})
