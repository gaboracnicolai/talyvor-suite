import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { docsNavKey } from './areas/docs/docsNav'

// B8.1 made a Docs page reachable from the sidebar; B10.6 changed how. The sidebar lists the pages a
// person PINNED and the last five they OPENED — never every page — and "All documents" reaches the
// rest. This drives the real app. Every other screen is a sidebar row, pinned by
// ConsoleNavLinks.test.tsx.

type ServerPin = { page_id: string; space_id: string; title: string; at: string }

/** A BFF whose Docs keeps pins (B18.27) — the same list whichever browser asks. */
function mockBff(pins: ServerPin[] = []) {
  // ScrollToTopOnPush scrolls on every in-app navigation; jsdom does not implement it.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/docs/pins') return json(pins)
    const pin = /^\/api\/docs\/spaces\/(.+)\/pages\/(.+)\/pin$/.exec(url)
    if (pin !== null) {
      const [, spaceId, pageId] = pin
      const at = pins.findIndex((p) => p.space_id === spaceId && p.page_id === pageId)
      if (at >= 0) pins.splice(at, 1)
      if (method === 'PUT') pins.unshift({ page_id: pageId, space_id: spaceId, title: pageId === 'pg-1' ? 'Onboarding' : pageId, at: '' })
      return json({ pinned: method === 'PUT' })
    }
    if (url === '/api/docs/spaces') return json([{ id: 'sp-eng', name: 'Engineering', slug: 'eng' }])
    if (url === '/api/docs/spaces/sp-eng') return json({ id: 'sp-eng', name: 'Engineering', slug: 'eng' })
    if (url === '/api/docs/spaces/sp-eng/pages') return json([{ id: 'pg-1', title: 'Onboarding' }])
    const page = /^\/api\/docs\/spaces\/sp-eng\/pages\/(pg-\d+)$/.exec(url)
    if (page !== null) {
      const title = page[1] === 'pg-1' ? 'Onboarding' : `Page ${page[1].slice(3)}`
      return json({ id: page[1], title, content_text: 'hello' })
    }
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
  window.localStorage.clear()
})

describe('the Docs sidebar: pinned and recent pages, never all of them (B10.6)', () => {
  it('every page is reachable through All documents; an opened page is recent; a pinned one is one click away, in another browser too', async () => {
    mockBff()
    window.history.pushState({}, '', '/')
    const first = render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })

    // B24.1 — the Docs title opens the Docs group; from `/` it starts folded.
    fireEvent.click(within(nav).getByRole('button', { name: 'Docs' }))
    fireEvent.click(within(nav).getByRole('link', { name: 'All documents' }))
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: 'Open space Engineering' }))
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /Onboarding/ }))
    expect(window.location.pathname).toBe('/docs/spaces/sp-eng/pages/pg-1')
    // Opened, so it is the first of the recent pages.
    expect(await within(nav).findByRole('link', { name: 'Onboarding' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(await screen.findByRole('button', { name: 'Pin Onboarding' }))
    expect(await within(nav).findByText('Pinned')).toBeTruthy()

    // Another browser (B18.27): a fresh app with nothing in this browser's storage. Docs kept the pin.
    first.unmount()
    queryClient.clear()
    window.localStorage.clear()
    window.history.pushState({}, '', '/')
    render(<App />)
    const again = await screen.findByRole('navigation', { name: /sections/i })
    fireEvent.click(within(again).getByRole('button', { name: 'Docs' }))
    fireEvent.click(await within(again).findByRole('link', { name: 'Onboarding' }))
    expect(window.location.pathname).toBe('/docs/spaces/sp-eng/pages/pg-1')
  })

  it('lists no more than the pinned pages and the five most recently opened', async () => {
    const refs = Array.from({ length: 9 }, (_, i) => ({ spaceId: 'sp-eng', pageId: `pg-${i + 2}`, title: `Page ${i + 2}` }))
    mockBff([refs[0], refs[1]].map((r) => ({ page_id: r.pageId, space_id: r.spaceId, title: r.title, at: '' })))
    window.localStorage.setItem(docsNavKey('local'), JSON.stringify({ pinned: [], recent: refs }))
    window.history.pushState({}, '', '/')
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })
    fireEvent.click(within(nav).getByRole('button', { name: 'Docs' }))
    await within(nav).findByText('Pinned')
    const docLinks = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent)
      .filter((t) => t?.startsWith('Page '))
    // Two pinned, then the five newest of the rest — a pinned page is not listed twice.
    expect(docLinks).toEqual(['Page 2', 'Page 3', 'Page 4', 'Page 5', 'Page 6', 'Page 7', 'Page 8'])
  })

  it('a pin this browser kept before pins moved to Docs is sent to Docs once, and then lives there', async () => {
    const pins: ServerPin[] = []
    mockBff(pins)
    const old = { spaceId: 'sp-eng', pageId: 'pg-1', title: 'Onboarding' }
    window.localStorage.setItem(docsNavKey('local'), JSON.stringify({ pinned: [old], recent: [] }))
    window.history.pushState({}, '', '/')
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })
    fireEvent.click(within(nav).getByRole('button', { name: 'Docs' }))
    expect(await within(nav).findByText('Pinned')).toBeTruthy()
    expect(await within(nav).findByRole('link', { name: 'Onboarding' })).toBeTruthy()
    expect(pins.map((p) => p.page_id)).toEqual(['pg-1'])
    expect(JSON.parse(window.localStorage.getItem(docsNavKey('local')) ?? '{}').pinned).toEqual([])
  })
})
