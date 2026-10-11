import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, CONSOLE_ROUTES, queryClient } from './App'
import { SIDEBAR_FOLD_KEY } from './sidebarFold'
import { openEveryGroup } from './sidebarTestKit'

// B24.1 — the sidebar folds to its group titles; pressing a title opens its links. Drives the real
// <App />: the titles are the buttons a person presses, and what is asserted is which links exist.

// B28.7 — the wallet's own rows (Home, Approvals, Agent Wallets, Statements, Chat) never fold; these do.
const TITLES = ['Marketplace', 'Work', 'Developers', 'Billing', 'Money', 'Settings']

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === '/auth/me') {
      return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

async function mountAt(address: string): Promise<HTMLElement> {
  window.history.pushState({}, '', address)
  render(<App />)
  return screen.findByRole('navigation', { name: /sections/i })
}

/** A fresh load of the same address in the same browser: storage survives, the app does not. */
async function reload(address: string): Promise<HTMLElement> {
  cleanup()
  queryClient.clear()
  return mountAt(address)
}

const title = (nav: HTMLElement, name: string) => within(nav).getByRole('button', { name })
const openTitles = (nav: HTMLElement) =>
  TITLES.filter((t) => title(nav, t).getAttribute('aria-expanded') === 'true')
const linkNames = (nav: HTMLElement) => within(nav).queryAllByRole('link').map((a) => a.textContent)

beforeEach(mockBff)
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.removeItem(SIDEBAR_FOLD_KEY)
})

describe('the sidebar folds to its group titles (B24.1)', () => {
  it('opens on a fresh load showing only the titles, plus the current page’s group with that page marked', async () => {
    const nav = await mountAt('/ledger')
    expect(openTitles(nav)).toEqual(['Billing'])
    expect(within(nav).getByRole('link', { name: 'Ledger' })).toHaveAttribute('aria-current', 'page')
    expect(linkNames(nav)).not.toContain('API keys')
    expect(linkNames(nav)).not.toContain('Members')
    // Each title is a real <button> — Enter and Space press it — that names the region it controls.
    for (const t of TITLES) {
      const b = title(nav, t)
      expect(b.tagName).toBe('BUTTON')
      expect(b).toHaveAttribute('type', 'button')
      expect(document.getElementById(b.getAttribute('aria-controls') ?? '')).not.toBeNull()
    }
  })

  it('pressing a title opens its links and leaves the other groups as they are; pressing again folds it', async () => {
    const nav = await mountAt('/ledger')
    fireEvent.click(title(nav, 'Developers'))
    expect(openTitles(nav)).toEqual(['Developers', 'Billing'])
    fireEvent.click(within(nav).getByRole('link', { name: 'API keys' }))
    expect(window.location.pathname).toBe('/keys')

    fireEvent.click(title(nav, 'Billing'))
    expect(openTitles(nav)).toEqual(['Developers'])
    expect(linkNames(nav)).not.toContain('Ledger')
  })

  it('one control at the top folds every group, and then opens every group', async () => {
    const nav = await mountAt('/ledger')
    fireEvent.click(within(nav).getByRole('button', { name: 'Fold all' }))
    expect(openTitles(nav)).toEqual([])
    expect(linkNames(nav)).toEqual(['Home', 'Approvals', 'Agent Wallets', 'Statements', 'Royalties', 'Chat', 'Rooms', 'Privacy', 'Terms'])

    fireEvent.click(within(nav).getByRole('button', { name: 'Open all' }))
    expect(openTitles(nav)).toEqual(TITLES)
    expect(within(nav).getByRole('link', { name: 'Plan & top up' })).toBeInTheDocument()
  })

  it('remembers the choice across a reload, and still opens the group of the page you land on', async () => {
    let nav = await mountAt('/ledger')
    fireEvent.click(title(nav, 'Work'))
    nav = await reload('/ledger')
    expect(openTitles(nav)).toEqual(['Work', 'Billing'])

    fireEvent.click(within(nav).getByRole('button', { name: 'Fold all' }))
    nav = await reload('/members')
    expect(openTitles(nav)).toEqual(['Settings'])
  })

  it('storage that is blocked just means the default', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const nav = await mountAt('/keys')
    expect(openTitles(nav)).toEqual(['Developers'])
    fireEvent.click(title(nav, 'Work'))
    expect(openTitles(nav)).toEqual(['Work', 'Developers'])
  })

  it('never hides where you are: on a fresh load at every address, the current page’s row is already showing', async () => {
    let marked = 0
    for (const route of CONSOLE_ROUTES) {
      const address = route.path.replace(/\/\*$/, '')
      const nav = await mountAt(address)
      const current = () => Array.from(nav.querySelectorAll('[aria-current="page"]')).map((el) => el.textContent)
      const onLoad = current()
      openEveryGroup(nav)
      expect(onLoad, `${address}: its row was folded away on load`).toEqual(current())
      if (onLoad.length > 0) marked++
      cleanup()
      queryClient.clear()
    }
    // FLOOR: most addresses have a row of their own; an equality over empty lists proves nothing.
    expect(marked).toBeGreaterThanOrEqual(CONSOLE_ROUTES.length - 5)
  })

  it('navigating to a page in a folded group opens that group', async () => {
    const nav = await mountAt('/ledger')
    fireEvent.click(within(nav).getByRole('button', { name: 'Fold all' }))
    act(() => {
      window.history.pushState({}, '', '/track/cycles')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(openTitles(nav)).toEqual(['Work'])
    expect(within(nav).getByRole('link', { name: 'Cycles' })).toHaveAttribute('aria-current', 'page')
  })

  it('on a phone, pressing a title inside the drawer keeps the drawer open; following a link closes it', async () => {
    const nav = await mountAt('/ledger')
    const menu = screen.getByRole('button', { name: 'Menu' })
    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(title(nav, 'Developers'))
    expect(menu, 'pressing a title closed the drawer').toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(nav).getByRole('link', { name: 'API keys' }))
    expect(window.location.pathname).toBe('/keys')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })
})
