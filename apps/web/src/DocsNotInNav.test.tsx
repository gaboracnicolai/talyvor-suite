import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { App } from './App'

// Docs IS NOT IN THE NAV, and this pins that it stays out — the same treatment /admin and
// /specimen got, for the same reason: someone reads an absence as an oversight and re-adds it.
//
// WHY IT IS OUT. Docs serves one PINNED workspace shared by every signed-in person. Listing it
// under "Products" tells a trial user it is theirs, and the gap only appears after they have put
// something in it. It returns when Docs gets Track's per-identity bootstrap.
//
// The ROUTE deliberately still works — this asserts the nav item is gone, not the feature.

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

describe('Docs is not offered in the Products nav', () => {
  beforeEach(() => {
    mockBff()
    window.history.pushState({}, '', '/')
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders no Docs navigation item', async () => {
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })
    const docsItems = Array.from(nav.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && /^\s*Docs\s*$/.test(el.textContent ?? ''),
    )
    expect(docsItems).toHaveLength(0)
  })

  it('still lists Track, so the assertion above is about Docs and not a dead nav', async () => {
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })
    expect(nav.textContent).toContain('Track')
  })
})
