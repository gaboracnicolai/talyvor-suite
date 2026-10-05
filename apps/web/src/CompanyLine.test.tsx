import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { COMPANY_LINE } from './company'

// B32.2 — every page of the website names the company, its number and its registered office, and
// the legal pages say who runs Talyvor.

const TOKEN = 'tok_abcdefghijklmnop'

function mockBff(me: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json(me)
    if (url === `/api/public/boards/${TOKEN}`) {
      return json({ workspace: 'Acme', project: 'Website', truncated: false, issues: [] })
    }
    return new Response('null', { status: 404 })
  })
}

const SIGNED_OUT = { mode: 'oidc', authenticated: false, user: null }
/** Loopback dev: the gate passes straight through, so Settings renders. */
const PASSES_THROUGH = { mode: 'disabled', authenticated: false, user: null }

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => queryClient.clear())
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('the company line', () => {
  it('is the register’s line, word for word', () => {
    expect(COMPANY_LINE).toBe(
      'TALYVOR LTD · Registered in England and Wales · Company number 17299143 · Registered office: 71-75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ',
    )
  })

  it.each([
    ['/marketing', SIGNED_OUT],
    ['/pricing', SIGNED_OUT],
    ['/documentation', SIGNED_OUT],
    ['/terms', SIGNED_OUT],
    ['/privacy', SIGNED_OUT],
    ['/signin', SIGNED_OUT],
    ['/signup', SIGNED_OUT],
    [`/board/${TOKEN}`, SIGNED_OUT],
    ['/settings', PASSES_THROUGH],
  ])('%s shows it', async (path, me) => {
    mockBff(me)
    at(path)
    expect(await screen.findByText(COMPANY_LINE)).toBeInTheDocument()
  })
})

describe('the legal pages say who runs Talyvor', () => {
  it('Terms opens with who the terms are between', async () => {
    mockBff(SIGNED_OUT)
    at('/terms')
    await screen.findByRole('heading', { name: /^terms$/i })
    const first = screen.getByRole('main').querySelector('header + p')
    expect(first?.textContent).toBe(
      'These terms are between you and TALYVOR LTD, a company registered in England and Wales (number 17299143) whose registered office is 71-75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ. Contact: nicolai@talyvor.com.',
    )
  })

  it('Privacy opens with who decides how personal data is used', async () => {
    mockBff(SIGNED_OUT)
    at('/privacy')
    await screen.findByRole('heading', { name: /^privacy$/i })
    const first = screen.getByRole('main').querySelector('header + p')
    expect(first?.textContent).toBe(
      'TALYVOR LTD (company number 17299143, registered office 71-75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ) runs Talyvor and decides how the personal data this notice describes is used. Contact: nicolai@talyvor.com.',
    )
  })
})
