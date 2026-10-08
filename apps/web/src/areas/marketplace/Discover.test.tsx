import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B32.61 — Discover, walked the way its DONE line reads: filtered by capability and the most a use may cost, it shows
// only the mock's matching listings; a collection's page lists exactly its listings, in its curator's order. The mock
// BFF plays Lens's discovery (B32.50) as Lens does it: a search keeps the approved public listings declaring the
// capability whose per-use price is at or under max_price_per_use (µUSD), and a collection is read with its listings.

interface Mock {
  id: string
  title: string
  capabilities: string[]
  usd: number
}

const LISTINGS: Mock[] = [
  { id: 'lst_dates', title: 'Extract dates', capabilities: ['extract'], usd: 40_000 },
  { id: 'lst_names', title: 'Extract names', capabilities: ['extract'], usd: 60_000 },
  { id: 'lst_sum', title: 'Summarise', capabilities: ['summarize'], usd: 10_000 },
]

const listing = (m: Mock) => ({
  id: m.id,
  workspace_id: 'ws_seller',
  kind: 'prompt',
  title: m.title,
  description: '',
  price_per_use_ulxc: m.usd * 10,
  visibility: 'public',
  latest_version: 1,
  created_at: '2026-10-07T09:00:00Z',
  updated_at: '2026-10-07T09:00:00Z',
  capabilities: m.capabilities,
})

const COLLECTIONS = [
  { id: 'col_picked', workspace_id: 'ws_curator', title: 'Picked', description: 'A summary, then the names in it.', public: true, featured: false, listing_ids: ['lst_sum', 'lst_names'] },
  { id: 'col_start', workspace_id: 'ws_talyvor', title: 'Start here', description: '', public: true, featured: true, listing_ids: ['lst_dates'] },
]

function mockBff() {
  const searched: URLSearchParams[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://app')
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url.pathname === '/api/marketplace/search') {
      const q = url.searchParams
      searched.push(q)
      const max = q.get('max_price_per_use')
      const found = LISTINGS.filter((m) => !q.get('capability') || m.capabilities.includes(q.get('capability') ?? ''))
        .filter((m) => max === null || m.usd <= Number(max))
        .map((m) => ({ ...listing(m), price_per_use_usd_micros: m.usd, distinct_buyers_7d: 0, trending_score: 0 }))
      return json({ listings: found, sort: q.get('sort') || 'trending', page: 1, page_size: 50, total: found.length, has_more: false })
    }
    if (url.pathname === '/api/marketplace/capabilities')
      return json({ capabilities: [{ slug: 'extract', label: 'Extract' }, { slug: 'summarize', label: 'Summarize' }] })
    const out = (c: (typeof COLLECTIONS)[number]) => {
      const { listing_ids, ...rest } = c
      return { ...rest, listing_count: listing_ids.length, created_at: '2026-10-07T09:00:00Z', updated_at: '2026-10-07T10:00:00Z' }
    }
    if (url.pathname === '/api/marketplace/collections')
      return json({ collections: [...COLLECTIONS].sort((a, b) => Number(b.featured) - Number(a.featured)).map(out) })
    const one = /^\/api\/marketplace\/collections\/([^/]+)$/.exec(url.pathname)
    const c = COLLECTIONS.find((x) => x.id === one?.[1])
    if (c) return json({ ...out(c), listings: c.listing_ids.map((id) => listing(LISTINGS.find((m) => m.id === id) as Mock)) })
    if (url.pathname === '/api/rooms')
      return json({
        rooms: [
          { id: 'room_extract', owner_workspace_id: 'ws_other', title: 'Invoice extraction', topic: 'extract', description: '', visibility: 'public', status: 'open', terms_version: 1, member_count: 4, created_at: '2026-10-06T09:00:00Z', last_activity_at: '2026-10-07T09:00:00Z' },
          { id: 'room_poems', owner_workspace_id: 'ws_other', title: 'Poems', topic: 'poetry', description: '', visibility: 'public', status: 'open', terms_version: 1, member_count: 2, created_at: '2026-10-06T09:00:00Z', last_activity_at: '2026-10-07T08:00:00Z' },
        ],
        joined: null,
        invited: null,
      })
    return new Response('null', { status: 404 })
  })
  return searched
}

async function at(path: string) {
  cleanup()
  queryClient.clear()
  window.history.pushState({}, '', path)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

const titles = (list: HTMLElement) =>
  within(list)
    .getAllByTestId('listing-card')
    .map((c) => within(c).getByRole('link').textContent)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('Discover', () => {
  it('filters by capability and the most a use may cost, and shows only the listings that match', async () => {
    const searched = mockBff()
    await at('/marketplace')
    await waitFor(() => expect(titles(screen.getByRole('list', { name: 'Listings' }))).toHaveLength(3))
    await screen.findByRole('option', { name: 'Extract' })
    fireEvent.change(screen.getByLabelText('Capability'), { target: { value: 'extract' } })
    fireEvent.change(screen.getByLabelText(/Most a use may cost/), { target: { value: '0.05' } })
    await waitFor(() => expect(titles(screen.getByRole('list', { name: 'Listings' }))).toEqual(['Extract dates']))
    const asked = searched.at(-1)
    expect(asked?.get('capability')).toBe('extract')
    expect(asked?.get('max_price_per_use')).toBe('50000')
    expect(within(screen.getByTestId('listing-card')).getByTestId('listing-price').textContent).toBe('$0.04')
    // The rooms on the same topic, and not the others.
    const rooms = await screen.findByRole('list', { name: 'Rooms' })
    expect(within(rooms).getAllByRole('link').map((a) => a.textContent)).toEqual(['Invoice extraction'])
  })

  it("lists a collection's listings exactly, in its curator's order", async () => {
    mockBff()
    await at('/marketplace')
    const collections = await screen.findByRole('list', { name: 'Collections' })
    // The featured collection comes first.
    expect(within(collections).getAllByTestId('collection-card')[0].textContent).toContain('Start here')
    fireEvent.click(within(collections).getByRole('link', { name: 'Picked' }))
    expect(await screen.findByRole('heading', { name: 'Picked' })).toBeTruthy()
    const list = await screen.findByRole('list', { name: 'Listings in this collection' })
    expect(titles(list)).toEqual(['Summarise', 'Extract names'])
  })
})
