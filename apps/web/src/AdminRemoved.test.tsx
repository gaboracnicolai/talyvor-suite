import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

// /admin IS GONE, and this pins that it stays gone.
//
// ── WHY IT WAS DELETED RATHER THAN MARKED ────────────────────────────────────
//
// A fixture badge asks the reader to treat a number as a placeholder. That bargain collapses
// for an operator console, because the content is precisely what someone consults when they
// cannot verify it independently. A certificate expiring in 17 days and a node one version
// behind the published config are not placeholders to anyone reading them under pressure —
// and a screenshot carries none of the marking.
//
// The five screens invented node identities, IP addresses, certificate fingerprints and a
// Let's Encrypt issuer string, with the fixture chip on the first card of each screen only (on
// Topology, three of four cards had no adjacent marker at all). There was also no path to real
// data in this deployment: no BFF route, no admin key configuration anywhere in the repo, and
// edge-infra is not in the serving topology.
//
// The shapes were verbatim from edge-infra's cmd/server/admin.go and were real work. That is an
// argument for keeping them in git history, which deleting does — not for serving them at /admin.

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      // disabled mode: the gate passes straight through to the app.
      return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(mockBff)
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('the /admin area is gone', () => {
  it('is not reachable from the nav', async () => {
    at('/')
    // wait for the shell to settle past the auth probe
    //
    // ⚠ `link`, NOT `button`, AND THE NEGATIVE ASSERTION IS WHY IT MATTERS. Sidebar destinations
    // became `<a href>` — see ConsoleNavLinks.test.tsx. Left as `button`, the line below would ask
    // whether a role NOTHING in the nav has any more is absent, and no nav item added in future
    // could ever make it fail: an /admin row restored tomorrow would be a link and would pass.
    expect(await screen.findByRole('link', { name: /^ledger$/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^admin$/i })).toBeNull()
    // the "Operator" group held only Admin, so the group header goes with it
    expect(screen.queryByText('Operator')).toBeNull()
  })

  it('renders none of the invented infrastructure at its old URL', async () => {
    at('/admin')
    expect(await screen.findByText(/Nothing at this address/)).toBeInTheDocument()
    // the specific fabrications, each named so a revert cannot pass this quietly
    expect(screen.queryByText('edge-proxy-euwest1-a')).toBeNull()
    expect(screen.queryByText(/10\.0\.1\.11/)).toBeNull()
    expect(screen.queryByText(/Let’s Encrypt|Let's Encrypt/)).toBeNull()
    expect(screen.queryByText(/payments\.internal/)).toBeNull()
    expect(screen.queryByText(/fixture/i)).toBeNull()
  })

  it('a stale bookmark to a sub-page lands somewhere honest, not on a blank shell', async () => {
    // Removing the route left /admin/* matching nothing, and AppShell had no catch-all — so
    // an operator's bookmark would have rendered an empty content area with no explanation.
    // A silent blank is the same failure class as an invented number: the page says nothing
    // true about what happened.
    at('/admin/certificates')
    expect(await screen.findByText(/Nothing at this address/)).toBeInTheDocument()
  })

  it('the catch-all does not swallow a real route', async () => {
    at('/ledger')
    expect(await screen.findByText(/LXC ledger|LENS token ledger/)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing at this address/)).toBeNull()
  })
})
