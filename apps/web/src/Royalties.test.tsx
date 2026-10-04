import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'

// B28.10 — Earnings became Royalties, under Statements. Driven through the real <App /> so the
// sidebar, the route table and the old address are the ones a person meets.

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const body =
      url === '/auth/me'
        ? { mode: 'oidc', authenticated: true, user: { sub: 's', email: 'a@example.com' }, workspace_id: 'uabcdefghijklmnopqrstuvwxy', cache_poolable: true }
        : {}
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

describe('Royalties sits under Statements', () => {
  beforeEach(() => {
    queryClient.clear()
    mockBff()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('the sidebar offers Royalties directly after Statements, and no Earnings', async () => {
    window.history.pushState({}, '', '/statements')
    render(<App />)
    const nav = await screen.findByRole('navigation', { name: /sections/i })
    const names = within(nav).getAllByRole('link').map((a) => a.textContent)
    expect(names[names.indexOf('Statements') + 1]).toBe('Royalties')
    expect(within(nav).getByRole('link', { name: 'Royalties' })).toHaveAttribute('href', '/statements/royalties')
    expect(names).not.toContain('Earnings')
  })

  it('the old /earnings address lands on Royalties', async () => {
    window.history.pushState({}, '', '/earnings')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Royalties' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/statements/royalties')
  })
})
