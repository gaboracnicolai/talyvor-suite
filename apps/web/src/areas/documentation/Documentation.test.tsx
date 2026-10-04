import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { matchRoutes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from '../../App'
import { Landing } from '../marketing/Landing'
import { DOCUMENTATION_PATH, LICENCES } from './content'

// B27.31 — /documentation opens signed out, and every link on it reaches a screen the app mounts.
//
// ⚠ MOUNTED, NOT MERELY RENDERED. Track and Marketplace end in a `*` that draws their index, so
// /marketplace/no-such-screen renders Browse and a render-based check would pass it. The routes
// below are read from what the app DECLARES — App.tsx's public <Route>s, CONSOLE_ROUTES, and each
// area's own <Route>s with their catch-alls left out — so a link to a screen that was removed or
// renamed fails here. The Lens routes the page lists are checked against Lens's source by
// scripts/lens-routes.mjs in CI, which this repository cannot do from a unit test.

const SRC = resolve(import.meta.dirname, '../..')
const source = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8')

/** Each console route that hands the rest of the path to an area router, and that router's file. */
const AREA_ROUTERS: Record<string, string> = {
  '/marketplace/*': 'areas/marketplace/Marketplace.tsx',
  '/track/*': 'areas/track/TrackArea.tsx',
  '/docs/*': 'areas/docs/DocsArea.tsx',
}

function mountedRoutes(): Array<{ path: string }> {
  const routes: string[] = []
  // The public routes sit outside the gate in App(); `/*` is the gate itself, not a screen.
  for (const m of source('App.tsx').matchAll(/<Route path="(\/[^"]*)"/g)) {
    if (m[1] !== '/*') routes.push(m[1])
  }
  routes.push(DOCUMENTATION_PATH)
  for (const { path } of CONSOLE_ROUTES) {
    if (!path.endsWith('/*')) {
      routes.push(path)
      continue
    }
    const file = AREA_ROUTERS[path]
    if (!file) throw new Error(`${path} hands off to an area router this test does not know — add it to AREA_ROUTERS`)
    const base = path.slice(0, -2)
    const area = source(file)
    if (/<Route index /.test(area)) routes.push(base)
    for (const m of area.matchAll(/<Route path="([^"*]+)"/g)) routes.push(`${base}/${m[1]}`)
  }
  return routes.map((path) => ({ path }))
}

const MOUNTED = mountedRoutes()
const mounts = (pathname: string) => matchRoutes(MOUNTED, pathname) !== null

function mockSignedOut() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).startsWith('/auth/me')) {
      return new Response(JSON.stringify({ mode: 'oidc', authenticated: false, user: null, signup_open: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('/documentation', () => {
  it('opens signed out, outside the sign-in gate', async () => {
    mockSignedOut()
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /what talyvor does today/i })).toBeInTheDocument()
    const contents = screen.getByRole('navigation', { name: 'On this page' })
    for (const name of ['Lens API', 'Chat', 'Docs', 'Track', 'Agent Wallets', 'Marketplace', 'Talyvor Code', 'Licences']) {
      expect(within(contents).getByRole('link', { name })).toHaveAttribute('href', expect.stringMatching(/^#/))
    }
  })

  it('is wallet-first: getting started funds an agent, and Agent Wallets leads the guides and the routes (B28.15)', async () => {
    mockSignedOut()
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    const { container } = render(<App />)
    await screen.findByRole('heading', { level: 1, name: /what talyvor does today/i })
    const steps = within(container.querySelector<HTMLElement>('#start')!).getAllByRole('link').map((a) => a.textContent)
    expect(steps).toEqual([
      'Sign up',
      'Agent Wallets — Create agent',
      'Agent Wallets — Fund',
      'Agent Wallets — Issue a key',
      'Setup',
      'Agent Wallets — Statement',
    ])
    const contents = within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole('link')
    expect(contents.slice(0, 2).map((a) => a.textContent)).toEqual(['Start here', 'Agent Wallets'])
    expect([...container.querySelectorAll('main > section[id]')].slice(0, 2).map((s) => s.id)).toEqual(['start', 'wallets'])
    const groups = [...container.querySelectorAll('#lens details')]
    expect(groups[0].id).toBe('lens-wallets')
    expect(within(groups[0] as HTMLElement).getByText('/v1/workspaces/{wsID}/agents/{agentID}/statement')).toBeInTheDocument()
  })

  it('links only to screens the app mounts', async () => {
    // The resolver is not vacuous: an invented screen, and one an area's catch-all would draw, fail.
    expect(mounts('/no-such-screen')).toBe(false)
    expect(mounts('/marketplace/no-such-screen')).toBe(false)

    mockSignedOut()
    window.history.pushState({}, '', DOCUMENTATION_PATH)
    const { container } = render(<App />)
    await screen.findByRole('heading', { level: 1, name: /what talyvor does today/i })
    const hrefs = [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '')
    const internal = hrefs.filter((h) => !/^https?:\/\//.test(h))
    expect(internal.length).toBeGreaterThan(30)
    const broken = internal.filter((h) =>
      h.startsWith('#') ? container.querySelector(h) === null : !mounts(h.split('#')[0]),
    )
    expect(broken).toEqual([])
  })

  it('names the suite’s licence exactly as its LICENSE file does', () => {
    const first = readFileSync(resolve(SRC, '../../../LICENSE'), 'utf8').split('\n')[0].trim()
    expect(LICENCES.find((l) => l.repo === 'talyvor-suite')?.licence).toBe(first)
  })

  it('is linked from the site’s header and footer', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('null', { status: 404 }))
    render(<Landing />)
    for (const region of [screen.getByRole('banner'), screen.getByRole('contentinfo')]) {
      expect(within(region).getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', DOCUMENTATION_PATH)
    }
  })
})
