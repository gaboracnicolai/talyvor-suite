import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { queryClient } from './App'

// FirstRunGaps.test.tsx — three gaps a trial user hits, pinned by what they SEE.
//
// Each is asserted through the rendered app at a URL, not against a component's props: the
// question in every case is "what does a person arriving here get", and a component test can
// pass while the route that reaches it does not exist.
//
//  1. THE MARKETING PAGE OFFERS A ROUTE IN. Its only action was a mailto:, which is the weakest
//     link on a page for a product with a working checkout.
//  2. A FIRST-TIME USER REACHES SETUP WITHOUT HAVING TO FIND IT. Setup existed as a page nobody
//     was routed to — the instructions for using the product, behind a nav item.
//  3. /specimen DOES NOT RESOLVE. The internal component gallery was unlinked but routable.

function mockBff(opts: { needsChoice?: boolean } = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(
        JSON.stringify({
          mode: 'oidc',
          authenticated: true,
          user: { sub: 'sub-new', email: 'new@example.com' },
          workspace_id: 'uabcdefghijklmnopqrstuvwxy',
          cache_poolable: true,
          needs_pooling_choice: opts.needsChoice ?? false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/pooling') {
      // The decline write. Without this the choice fails, onDone never runs, and the redirect
      // under test never fires — the test would fail for a reason unrelated to routing.
      return new Response(JSON.stringify({ cache_poolable: false }), {
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

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

// ─── 1. the marketing page offers a route into the app ──────────────────────

describe('the marketing page offers a way in', () => {
  it('has a sign-in action that goes to the login flow, not only an email link', async () => {
    mockBff()
    at('/marketing')
    const signIn = await screen.findByRole('link', { name: /sign in/i })
    // /auth/login is the BFF's OIDC entry point. A mailto: or an in-app path is not a way in
    // for someone who does not have a session yet.
    expect(signIn.getAttribute('href')).toMatch(/^\/auth\/login/)
  })

  it('does not promise self-serve signup while the IdP gates who may enter', async () => {
    mockBff()
    at('/marketing')
    // "Get started free", "Sign up free", "Create your account" all promise a stranger can
    // complete the flow. They cannot: the Google app is in Testing mode, so a person not on
    // the test-user list hits a wall at the IdP. The page must not write a cheque the IdP
    // will bounce. When the OAuth app is published, THIS test is the thing to revisit.
    for (const promise of [/get started free/i, /sign up free/i, /create your account/i]) {
      expect(screen.queryByText(promise)).toBeNull()
    }
  })

  it('tells someone without access what to do, next to the sign-in action', async () => {
    mockBff()
    at('/marketing')
    // Honest ≠ unhelpful. A stranger who cannot sign in must not be left guessing; the
    // contact route stays, adjacent, and says who it is for.
    expect(await screen.findByText(/don’t have access|do not have access/i)).toBeInTheDocument()
  })
})

// ─── 2. a first-time user reaches Setup ─────────────────────────────────────

describe('first run routes a new user to Setup', () => {
  it('lands on Setup after the pooling choice, without having to find it', async () => {
    mockBff({ needsChoice: true })
    at('/')
    // The disclosure blocks first.
    await screen.findByText(/Your answers are being shared/i)

    // Choosing dismisses it; the app must then put the person on Setup rather than Overview.
    const decline = await screen.findByRole('button', { name: /^Do not share my answers$/i })
    fireEvent.click(decline)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/setup')
    })
  })

  it('does NOT trap them there — the whole app is reachable from Setup', async () => {
    mockBff()
    at('/setup')
    // Setup renders inside the normal shell, so every nav destination is one click away. A
    // first-run step with no way past is worse than no step at all: this asserts the nav is
    // present, not merely that Setup rendered.
    expect(await screen.findByRole('button', { name: /^overview$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^ledger$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^api keys$/i })).toBeInTheDocument()
  })

  it('a returning user is not sent to Setup again', async () => {
    mockBff({ needsChoice: false })
    at('/')
    // needs_pooling_choice is false on every login after the one that created the workspace,
    // so the redirect must not fire. Landing a returning user on Setup every time would be a
    // different kind of broken.
    await screen.findByRole('button', { name: /^ledger$/i })
    expect(window.location.pathname).toBe('/')
  })
})

// ─── 3. /specimen is gone ───────────────────────────────────────────────────

describe('the /specimen gallery is gone', () => {
  it('does not resolve at its old URL', async () => {
    mockBff()
    at('/specimen')
    // Same treatment as /admin: the catch-all answers honestly rather than rendering a blank
    // shell. A silent empty content area says nothing true about what happened.
    expect(await screen.findByText(/Nothing at this address/)).toBeInTheDocument()
  })

  it('is not in the nav', async () => {
    mockBff()
    at('/')
    await screen.findByRole('button', { name: /^ledger$/i })
    expect(screen.queryByRole('button', { name: /^specimen$/i })).toBeNull()
  })
})
