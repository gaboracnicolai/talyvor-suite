import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { docsNavKey } from './areas/docs/docsNav'

// B8.1 made a Docs page reachable from the sidebar; B10.6 changed how. The sidebar lists the pages a
// person PINNED and the last five they OPENED — never every page — and "All documents" reaches the
// rest. This drives the real app. Every other screen is a sidebar row, pinned by
// ConsoleNavLinks.test.tsx.

function mockBff() {
  // ScrollToTopOnPush scrolls on every in-app navigation; jsdom does not implement it.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
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
  it('every page is reachable through All documents; an opened page is recent; a pinned one is one click away and survives a reload', async () => {
    mockBff()
    window.history.pushState({}, '', '/')
    const first = render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })

    fireEvent.click(within(nav).getByRole('link', { name: 'All documents' }))
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: 'Open space Engineering' }))
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /Onboarding/ }))
    expect(window.location.pathname).toBe('/docs/spaces/sp-eng/pages/pg-1')
    // Opened, so it is the first of the recent pages.
    expect(await within(nav).findByRole('link', { name: 'Onboarding' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(await screen.findByRole('button', { name: 'Pin Onboarding' }))
    expect(within(nav).getByText('Pinned')).toBeTruthy()

    // A reload: a fresh app, the same browser.
    first.unmount()
    queryClient.clear()
    window.history.pushState({}, '', '/')
    render(<App />)
    const again = await screen.findByRole('navigation', { name: /sections/i })
    fireEvent.click(await within(again).findByRole('link', { name: 'Onboarding' }))
    expect(window.location.pathname).toBe('/docs/spaces/sp-eng/pages/pg-1')
  })

  it('lists no more than the pinned pages and the five most recently opened', async () => {
    mockBff()
    const refs = Array.from({ length: 9 }, (_, i) => ({ spaceId: 'sp-eng', pageId: `pg-${i + 2}`, title: `Page ${i + 2}` }))
    window.localStorage.setItem(
      docsNavKey('local'),
      JSON.stringify({ pinned: [refs[0], refs[1]], recent: refs }),
    )
    window.history.pushState({}, '', '/')
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })
    await within(nav).findByText('Pinned')
    const docLinks = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent)
      .filter((t) => t?.startsWith('Page '))
    // Two pinned, then the five newest of the rest — a pinned page is not listed twice.
    expect(docLinks).toEqual(['Page 2', 'Page 3', 'Page 4', 'Page 5', 'Page 6', 'Page 7', 'Page 8'])
  })
})
