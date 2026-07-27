import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

// SessionExpired.test.tsx — WHAT THE PERSON SEES WHEN THE WORKSPACE TOKEN DIES.
//
// THE INCIDENT, reproduced exactly. Lens restarted with a new ephemeral signing key. Every
// existing session's workspace token became unverifiable, so every workspace-scoped read came
// back 401. The screen said "Couldn't load the LXC balance", "Couldn't load the mint ledger",
// "Couldn't check" — eight panels, eight failures, none of them saying why and none saying what
// to do. The cause was a dead credential and the fix was one click. Neither was on screen.
//
// THE CONDITION THAT MAKES IT INVISIBLE, and why the auth gate cannot catch it: the BFF's OWN
// session is still perfectly valid. /auth/me answers authenticated:true, because what expired is
// the LENS token the BFF holds on the session — not the session. So the gate renders the app,
// every panel asks Lens, every panel is refused, and the only thing the person can conclude is
// that the product is broken. These tests therefore mock /auth/me as AUTHENTICATED and every
// /api/* as 401; anything less faithful would be caught by the gate and prove nothing.
//
// THIS IS NOT ONLY A DEPLOY ARTIFACT. The workspace token is minted for 8 hours
// (sessionTokenTTLHours) and the BFF session lasts 12 (BFF_SESSION_TTL default), so between
// hour 8 and hour 12 EVERY session is in this state with nothing having restarted at all. The
// restart simply did it to everyone at once. The BFF side of that is fixed separately; this
// file is about the screen being honest whenever it happens, because it will.
//
// THREE STATES, THREE MESSAGES — the property under test:
//   401 → "your session expired", said ONCE, with a way to fix it
//   503/404 → "not configured on this deployment" (calm state, not a fault) — must not move
//   anything else → "Couldn't load …" (a genuine fault) — must not move either
// A change that makes 401 honest by making 500 say the same thing has not fixed anything.

const AUTHENTICATED = {
  mode: 'oidc',
  authenticated: true,
  user: { sub: 'sub-1', email: 'tester@example.com' },
  workspace_id: 'uabcdefghijklmnopqrstuvwxy',
  cache_poolable: false,
  needs_pooling_choice: false,
  signup_open: true,
}

/** Every /api/* answers `status`; /auth/me stays authenticated (the live condition). */
function mockAllApi(status: number, body: unknown = { error: 'nope' }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(JSON.stringify(AUTHENTICATED), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
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
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

// ─── 1. a 401 reads as an expired session, with a way out ───────────────────

describe('a 401 from Lens says the session expired, and how to fix it', () => {
  it('names the actual cause instead of "couldn’t load"', async () => {
    mockAllApi(401)
    at('/')
    // The words a person can act on. "Couldn't load the LXC balance" is true and useless:
    // it describes the symptom the person can already see.
    expect(await screen.findByText(/session (has )?expired|signed out/i)).toBeInTheDocument()
  })

  it('offers the fix as something to click, not as advice to read', async () => {
    mockAllApi(401)
    at('/')
    await screen.findByText(/session (has )?expired|signed out/i)
    // /auth/login rotates the session and re-provisions, which re-mints the workspace token —
    // so this single click IS the fix. ("Sign out and back in" was the manual workaround; it
    // is two steps for the same effect.)
    const action = screen.getByRole('link', { name: /sign in again|sign in/i })
    expect(action.getAttribute('href')).toMatch(/^\/auth\/login/)
  })

  it('sends the person back where they were', async () => {
    mockAllApi(401)
    at('/ledger')
    await screen.findByText(/session (has )?expired|signed out/i)
    const action = screen.getByRole('link', { name: /sign in again|sign in/i })
    expect(action.getAttribute('href')).toContain('return_to=')
    expect(decodeURIComponent(action.getAttribute('href') ?? '')).toContain('/ledger')
  })
})

// ─── 2. ONE fault, not eight ────────────────────────────────────────────────

describe('one dead session is one message, not eight', () => {
  it('says it exactly once even though every panel failed', async () => {
    mockAllApi(401)
    at('/')
    await screen.findByText(/session (has )?expired|signed out/i)
    // Overview alone asks for balances, two ledgers, month spend, usage and the products
    // strip. Eight cards each announcing their own failure reads as eight broken things and
    // sends the reader looking for eight causes.
    expect(screen.getAllByText(/session (has )?expired|signed out/i)).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: /sign in again|sign in/i })).toHaveLength(1)
  })

  it('no panel still shouts "Couldn’t load"', async () => {
    mockAllApi(401)
    at('/')
    await screen.findByText(/session (has )?expired|signed out/i)
    // The banner explains it; a card repeating "Couldn't load the LXC balance" underneath is
    // the same misdiagnosis the banner just corrected.
    expect(screen.queryByText(/couldn’t load|couldn't load|couldn’t check|couldn't check/i))
      .toBeNull()
  })
})

// ─── 1b. a refusal must never be reported as unreachability ─────────────────

describe('a 401 never reads as "the upstream is down"', () => {
  // The three states have to be distinguishable in WORDS, not merely in code. Several screens
  // said "Couldn't reach Track", "Couldn't reach Docs", "a problem reaching Lens from this app"
  // — sentences that are precisely wrong for a 401: the request ARRIVED and was refused. Telling
  // someone the network is at fault sends them to check a network that is fine, and it is the
  // one diagnosis that guarantees they will not try the thing that works.
  //
  // ⚠ THE LIST IS THE GUARD'S SCOPE, so it is derived from the screens actually changed rather
  // than from the ones easiest to render. An earlier version stopped at '/docs', which renders
  // the space LIST — so the two deepest Docs screens (SpaceView, PageView) were edited with
  // nothing covering them. Reverting their fix left this suite green. The id-bearing routes
  // below are what closed that: measured by reverting each fix and checking this file goes red,
  // not by assuming a route name covers everything under it.
  const ROUTES = [
    '/',
    '/ledger',
    '/keys',
    '/spend',
    '/members',
    '/track',
    '/docs',
    '/docs/spaces/sp-1',
    '/docs/spaces/sp-1/pages/pg-1',
    '/billing/success',
  ]

  for (const route of ROUTES) {
    it(`${route} does not blame the network`, async () => {
      mockAllApi(401)
      at(route)
      await screen.findByRole('alert')
      const text = document.body.textContent ?? ''
      expect(text).not.toMatch(/couldn[’']t reach/i)
      expect(text).not.toMatch(/problem reaching/i)
      expect(text).not.toMatch(/proxy answered with an error/i)
      expect(text).not.toMatch(/unreachable/i)
    })
  }

  it('but a 502 SHOULD still be allowed to blame the upstream', async () => {
    // The control. These sentences are correct when the upstream really is unreachable, and
    // deleting them everywhere would be the opposite mistake — trading one wrong diagnosis for
    // a vaguer one. /docs is used because its copy is the most explicit about reachability.
    mockAllApi(502, { error: 'lens upstream unreachable' })
    at('/docs')
    await waitFor(
      () => {
        expect(document.body.textContent ?? '').toMatch(/couldn[’']t reach|proxy answered with an error/i)
      },
      { timeout: 5000 },
    )
  })
})

// ─── 2b. the gate and the bar must not both speak ───────────────────────────

describe('when the BFF session itself is gone, the gate handles it alone', () => {
  it('shows the sign-in card and NOT a second session message underneath', async () => {
    // The other 401: not a stale workspace token but no session at all (expiry, logout
    // elsewhere, a BFF restart — sessions are in-memory). /auth/me says unauthenticated, so
    // AuthGate replaces the whole app with the sign-in card.
    //
    // Both paths are honest on their own; the risk is that they stack — a sign-in card with a
    // session-expired bar wedged above it is two components explaining the same thing to the
    // same person, which is the exact failure this change exists to remove, reintroduced at a
    // different layer.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/auth/me') {
        return new Response(JSON.stringify({ mode: 'oidc', authenticated: false, user: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: 'authentication required' }), { status: 401 })
    })
    at('/')
    await screen.findByRole('heading', { name: /sign in to talyvor/i })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ─── 3. the other two states MUST NOT MOVE ──────────────────────────────────

describe('three states stay three', () => {
  it('a 500 is still a genuine fault and still says "Couldn’t load"', async () => {
    mockAllApi(500)
    at('/')
    // THE CONTROL that stops this change from being "call everything a session problem".
    // A dead Lens, a bad gateway, a panic upstream — none of those are fixed by signing in,
    // and telling someone to sign in again sends them round a loop that cannot help.
    // A LONGER WINDOW ON PURPOSE: the query client retries once on a non-401 (a 5xx can be a
    // blip) and does NOT retry a 401 (a verdict is not a flake). So the genuine-fault path is
    // legitimately slower to settle, and a 1s default would fail this control for a reason
    // that has nothing to do with what it asserts.
    expect(
      await screen.findAllByText(/couldn’t load|couldn't load|couldn’t check|couldn't check/i, {}, { timeout: 5000 }),
    ).not.toHaveLength(0)
    expect(screen.queryByText(/session (has )?expired|signed out/i)).toBeNull()
  })

  it('a 502 (Lens unreachable) is not a session problem either', async () => {
    mockAllApi(502, { error: 'lens upstream unreachable' })
    at('/')
    expect(
      await screen.findAllByText(/couldn’t load|couldn't load|couldn’t check|couldn't check/i, {}, { timeout: 5000 }),
    ).not.toHaveLength(0)
    expect(screen.queryByText(/session (has )?expired|signed out/i)).toBeNull()
  })

  it('a 503 is still the calm "not configured" state, not an expired session', async () => {
    mockAllApi(503, { error: 'track upstream not configured on this BFF' })
    at('/')
    // isUnconfigured()'s existing meaning. A product nobody wired is information, and it must
    // not start telling people their session died.
    await waitFor(() =>
      expect(screen.queryByText(/session (has )?expired|signed out/i)).toBeNull(),
    )
  })
})
