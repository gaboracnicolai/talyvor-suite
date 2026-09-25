import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

// B8.1 — the Docs editor opens on a page inside a space, so it is the one B1–B6 screen the sidebar
// cannot address directly. The sidebar names the workspace's spaces; this drives the real app from
// Overview and counts the clicks to a page. Every other screen is a sidebar row, pinned by
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
    if (url === '/api/docs/spaces/sp-eng/pages/pg-1')
      return json({ id: 'pg-1', title: 'Onboarding', content_text: 'hello' })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('from Overview, a Docs page is two clicks away', () => {
  it('sidebar space, then the page — and the page is what opens', async () => {
    mockBff()
    window.history.pushState({}, '', '/')
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })

    fireEvent.click(await within(nav).findByRole('link', { name: 'Engineering' }))
    expect(window.location.pathname).toBe('/docs/spaces/sp-eng')

    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /Onboarding/ }))
    expect(window.location.pathname).toBe('/docs/spaces/sp-eng/pages/pg-1')
    expect(within(nav).getByRole('link', { name: 'Engineering' })).toHaveAttribute('aria-current', 'page')
  })
})
