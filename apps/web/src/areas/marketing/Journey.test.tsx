import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// THE JOURNEY, not the links. Someone arrives from talyvor.com (which redirects here), reads the
// page, and has to be able to reach signup — and, before handing over an account, the policies.
//
// ⚠ ASSERTING ARRIVAL, NOT ANCHORS. A test that finds an <a href="/signup"> passes on a page whose
// signup route does not exist, or resolves to the SPA fallback, or renders an error. So each step
// reads the href off the RENDERED page and then drives the real router to it, asserting the
// destination's OWN content — the thing only that screen says.
//
// The page uses plain anchors on purpose (it renders with no router context; see Landing.tsx), so
// the navigation a browser performs is a full page load. Driving the router to the extracted href
// is the faithful test of that: it proves the address the page publishes resolves to a real screen.

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/auth/me')) return json({ mode: 'oidc', authenticated: false, user: null })
    if (url.startsWith('/api/signup-open')) return json({ signup_open: true })
    return new Response('null', { status: 404 })
  })
}

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('a signed-out visitor arrives from talyvor.com and can act', () => {
  it('lands on the page and is told the thesis, not a placeholder', async () => {
    mockBff()
    at('/marketing')
    // The claim the page exists to make. If this sentence goes, the page has lost its argument.
    expect(await screen.findByText(/toward zero/i)).toBeInTheDocument()
    // And the inversion, in the page's own voice.
    expect(screen.getByText(/cheaper as more people use it/i)).toBeInTheDocument()
  })

  it('reaches signup — the address it publishes resolves to the real signup screen', async () => {
    mockBff()
    const { unmount } = at('/marketing')
    const cta = (await screen.findAllByRole('link', { name: /get started/i }))[0]
    const href = cta.getAttribute('href') ?? ''
    expect(href).toBe('/signup')
    unmount()

    mockBff()
    at(href)
    // ARRIVAL: content only the signup screen carries.
    expect(await screen.findByRole('heading', { name: /create your talyvor workspace/i })).toBeInTheDocument()
  })

  it('reaches privacy before handing over an account', async () => {
    mockBff()
    const { unmount } = at('/marketing')
    const link = (await screen.findAllByRole('link', { name: /^privacy$/i }))[0]
    const href = link.getAttribute('href') ?? ''
    expect(href).toBe('/privacy')
    unmount()

    mockBff()
    at(href)
    expect((await screen.findAllByText(/needs legal review/i)).length).toBeGreaterThan(0)
  })

  it('reaches terms', async () => {
    mockBff()
    const { unmount } = at('/marketing')
    const link = (await screen.findAllByRole('link', { name: /^terms$/i }))[0]
    const href = link.getAttribute('href') ?? ''
    expect(href).toBe('/terms')
    unmount()

    mockBff()
    at(href)
    expect(await screen.findByText(/not money/i)).toBeInTheDocument()
  })
})
