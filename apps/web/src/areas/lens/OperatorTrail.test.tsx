import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B27.29 — every operator action (approve a listing, take one down, retry a parked use) leaves one row
// on the Operator screen's trail, with who took it, what, on which target and when; the trail filters
// and downloads as CSV. The mock BFF records as apps/bff/operator_audit.go does: once the action is done.

const WHO = 'ng@example.com sub=s1'

const listing = (id: string, title: string) => ({
  id, workspace_id: 'ws_seller', kind: 'prompt', title, description: '', price_per_use_ulxc: 500_000,
  visibility: 'public', latest_version: 1, created_at: '2026-09-28T09:00:00Z', updated_at: '2026-09-28T09:00:00Z',
  review_status: 'approved',
})

const PARKED = {
  id: 'use_9', listing_id: 'lst_adder', buyer_workspace_id: 'ws_acme', price_ulxc: 500_000, used_at: '2026-10-01T08:00:00Z',
  refusals: 5, reason: 'card_declined', parked_at: '2026-10-02T12:00:00Z',
}

function mockBff() {
  const trail: { id: number; actor: string; action: string; target: string; detail: string; occurred_at: string; recorded_at: string }[] = []
  let queue = [listing('lst_ok', 'Fine prompt'), listing('lst_leak', 'Leaky prompt')]
  let parked = [PARKED]
  const record = (action: string, target: string, detail = '') => {
    const at = new Date(Date.UTC(2026, 9, 4, 10, trail.length)).toISOString()
    trail.unshift({ id: trail.length + 1, actor: WHO, action, target, detail, occurred_at: at, recorded_at: at })
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me')
      return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'ng@example.com' }, operator: true })
    if (url === '/api/admin/workspaces') return json({ workspaces: [] })
    if (url === '/api/admin/marketplace/review')
      return json({ listings: queue.map((l) => ({ listing: l, open_reports: 1, report_reasons: ['other'], report_details: [] })) })
    if (url === '/api/admin/marketplace/listings/lst_ok/approve' && init?.method === 'POST') {
      queue = queue.filter((l) => l.id !== 'lst_ok')
      record('marketplace.listing.approve', 'listing:lst_ok')
      return json(listing('lst_ok', 'Fine prompt'))
    }
    if (url === '/api/admin/marketplace/listings/lst_leak/takedown' && init?.method === 'POST') {
      const { reason } = JSON.parse(String(init.body)) as { reason: string }
      queue = queue.filter((l) => l.id !== 'lst_leak')
      record('marketplace.listing.takedown', 'listing:lst_leak', reason)
      return json({ listing: { ...listing('lst_leak', 'Leaky prompt'), review_status: 'taken_down' }, refunds: [] })
    }
    if (url === '/api/admin/marketplace/parked-uses') return json({ parked_uses: parked })
    if (url === '/api/admin/marketplace/parked-uses/use_9/retry' && init?.method === 'POST') {
      parked = []
      record('marketplace.parked_use.retry', 'parked_use:use_9')
      return json({ id: 'use_9', retrying: true })
    }
    if (url.startsWith('/api/admin/operator-audit')) {
      const q = new URL(url, 'http://x').searchParams
      return json({
        entries: trail.filter(
          (e) => (!q.get('action') || e.action === q.get('action')) && (!q.get('actor') || e.actor === q.get('actor')),
        ),
      })
    }
    return new Response('null', { status: 404 })
  })
}

async function at(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  return screen.findByRole('navigation', { name: /sections/i })
}

const trailAsked = () =>
  vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input)).filter((u) => u.startsWith('/api/admin/operator-audit'))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the operator trail (B27.29)', () => {
  it('each operator action leaves one row on the Operator screen, naming who did what to which target', async () => {
    mockBff()
    // Two actions in the review queue…
    await at('/marketplace/review')
    const [ok, leak] = await screen.findAllByTestId('review-item')
    fireEvent.click(within(ok).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getAllByTestId('review-item')).toHaveLength(1))
    fireEvent.click(within(leak).getByRole('button', { name: 'Take down' }))
    fireEvent.change(within(leak).getByLabelText(/Why it is taken down/), { target: { value: 'exposes a live key' } })
    fireEvent.click(within(leak).getByRole('button', { name: 'Take down and refund' }))
    await screen.findByTestId('takedown-result')
    cleanup()

    // …and one on the Operator screen, whose trail then holds all three.
    await at('/operator')
    expect(await screen.findAllByTestId('operator-action')).toHaveLength(2)
    fireEvent.click(within(await screen.findByTestId('parked-use')).getByRole('button', { name: 'Retry use_9' }))
    await waitFor(() => expect(screen.getAllByTestId('operator-action')).toHaveLength(3))

    const rows = screen.getAllByTestId('operator-action').map((r) => within(r).getAllByRole('cell').slice(1).map((c) => c.textContent))
    expect(rows).toEqual([
      [WHO, 'Retried a parked use', 'parked_use:use_9', ''],
      [WHO, 'Took down a listing', 'listing:lst_leak', 'exposes a live key'],
      [WHO, 'Approved a listing', 'listing:lst_ok', ''],
    ])
  })

  it('filters by action and by operator, and the CSV download carries the same filters', async () => {
    mockBff()
    await at('/operator')
    await screen.findByText(/No operator has acted yet/)
    const form = screen.getByRole('form', { name: 'Filter the operator trail' })
    fireEvent.change(within(form).getByLabelText('Action'), { target: { value: 'marketplace.listing.takedown' } })
    await waitFor(() => expect(trailAsked()).toContain('/api/admin/operator-audit?action=marketplace.listing.takedown'))
    expect(await screen.findByText('No action matches these filters.')).toBeTruthy()
    expect(within(form).getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      '/api/admin/operator-audit/export?action=marketplace.listing.takedown',
    )

    fireEvent.click(within(form).getByRole('button', { name: 'Clear filters' }))
    fireEvent.click(within(await screen.findByTestId('parked-use')).getByRole('button', { name: 'Retry use_9' }))
    fireEvent.click(await screen.findByRole('button', { name: `Only ${WHO}` }))
    await waitFor(() => expect(trailAsked()).toContain(`/api/admin/operator-audit?actor=${encodeURIComponent(WHO).replace(/%20/g, '+')}`))
    expect(within(form).getByRole('link', { name: 'Download CSV' }).getAttribute('href')).toBe(
      `/api/admin/operator-audit/export?actor=${encodeURIComponent(WHO).replace(/%20/g, '+')}`,
    )
  })
})
