import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'
import { PENDING_TOPUP_KEY } from './areas/lens/topupApi'

// checkoutRefusalSurface.test.tsx — THE PAYMENT BUTTON THAT SAID NOTHING WHEN THE REQUEST
// NEVER GOT AN ANSWER.
//
// /billing is the only place a customer can buy LXC, and TopUp.tsx opens with a promise:
// "Fail silently … A top-up page about to ask for money that just greys out is worse than no
// page at all." Every failure it names — billing off, expired session, rejected origin,
// allow-list drift, unreachable Lens — arrives as its own sentence.
//
// ⚠ THE SENTENCE WAS GATED ON THE ERROR'S CLASS, NOT ON THERE BEING AN ERROR. TopUp.tsx read
//
//     const failure = start.error instanceof CheckoutError ? start.error : null
//     …
//     {failure ? <p>{failureText(failure.kind, failure.detail)}</p> : null}
//
// so an error that is not a `CheckoutError` set `failure` to null and rendered NOTHING. Every
// OTHER error surface in this product gates on `isError` and uses `instanceof` only INSIDE the
// block to choose better words — Keys.tsx:114/116, ConvertLens.tsx:201/208,
// IssueList.tsx:305/316 all have that shape, each with a fallback. TopUp was the only surface
// in the app where the class check WAS the gate (measured: the one `instanceof` outside a
// `.isError ?` in any .tsx).
//
// WHAT REACHES IT. `topupApi.checkout` raises a CheckoutError for every answer it gets — every
// status, and even a 200 with no url (topupApi.ts:171). What it cannot convert is not getting
// an answer at all: `fetch` REJECTS (offline, DNS failure, connection reset, TLS failure) with
// a TypeError, which is not a CheckoutError.
//
// MEASURED before this file existed, real `<App/>` at /billing, real shipped queryClient,
// clicking the $10 button and counting the characters the click adds to the page:
//
//     checkout answered with        POST sent   characters added   session bar
//     ---------------------------   ---------   ----------------   -----------
//     503 billing disabled          yes                      150   no
//     401 signed out                yes                       85   yes
//     403 origin refused            yes                      115   no
//     400 amount refused            yes                        7   no   (the BFF's own words)
//     502 upstream                  yes                        7   no   (the BFF's own words)
//     200 with no session url       yes                       67   no
//     fetch REJECTS (offline)       yes                        0   no
//
// ⚠ ZERO CHARACTERS, AND THE POST WAS SENT. The button returns from "Starting…" to "$10" and
// the page is byte-identical to before the click. The customer is told nothing at all — the
// exact outcome the file's header says must not exist. (400 and 502 add only 7 because the
// screen echoes the BFF's own sentence verbatim; the fixture's was "up: 400".)
//
// ⚠ WHY SIX GREEN FAILURE TESTS COULD NOT SEE IT. TopUp.test.tsx drives every honest failure
// state, and its fixture answers each one by RETURNING a Response. A returned Response — any
// status, including a 200 with no url — always becomes a CheckoutError, so the gate is
// satisfied in all six. No test in the repo made `fetch` itself reject, so the one failure mode
// the gate excludes was the one no fixture could produce.
//
// ⚠ AND NO BAR COVERS FOR IT. Measured false above: a fetch rejection carries no status, so
// `isSessionExpired` (ApiError + 401) is false, and the mutation error never reaches the query
// cache that SessionExpiredBar derives from. The App's only global handler is
// `QueryCache.onError` (App.tsx:44) — queries, not mutations.
//
// THE FIX SAYS NOTHING NEW. The fallback is the sentence topupApi.ts already raises for an
// answer it cannot use (`'upstream'`, topupApi.ts:172): "Couldn't start the payment — nothing
// was charged. Please try again." It is honest for a rejection by construction — this call only
// asks Lens to create a Stripe Checkout Session, and the payment happens at Stripe AFTER the
// redirect (TopUp.tsx:22, apps/bff/billing.go:180), so a call that never completed cannot
// have charged anyone.

const AUTHENTICATED = {
  mode: 'oidc',
  authenticated: true,
  user: { sub: 'sub-1', email: 'tester@example.com' },
  workspace_id: 'uabcdefghijklmnopqrstuvwxy',
  cache_poolable: false,
  needs_pooling_choice: false,
  signup_open: true,
}

const BALANCE = {
  workspace_id: 'trial-ws-1',
  balance_ulxc: 42_000_000,
  lifetime_minted_ulxc: 100_000_000,
  lifetime_spent_ulxc: 58_000_000,
  usd_value_uusd: 4_200_000,
}

/** A Response spec the checkout route answers with, or 'reject' — `fetch` itself fails. */
type CheckoutAnswer = { status: number; body: unknown } | 'reject'

let checkoutAnswer: CheckoutAnswer = { status: 200, body: { url: 'https://checkout.stripe.com/c/pay/cs' } }
/** Proves the click reached the network: a 0-character page with 0 POSTs is a dead button, not silence. */
let posts = 0

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (path === '/auth/me') return json(AUTHENTICATED)
    if (path === '/api/lxc/checkout' && method === 'POST') {
      posts += 1
      if (checkoutAnswer === 'reject') throw new TypeError('Failed to fetch')
      return json(checkoutAnswer.body, checkoutAnswer.status)
    }
    if (path === '/api/lxc/topup-options') {
      return json({ allowed_usd_cents: [1000, 5000, 10000], billing_enabled: true })
    }
    if (path === '/api/lxc/balance') return json(BALANCE)
    return json(null, 404)
  })
}

beforeEach(() => {
  queryClient.clear()
  checkoutAnswer = { status: 200, body: { url: 'https://checkout.stripe.com/c/pay/cs' } }
  posts = 0
  mockBff()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
  window.history.pushState({}, '', '/')
})

/** Open /billing on the real App, click the $10 button, and hand back what the page gained. */
async function buyTenDollars(): Promise<{ added: number; text: string }> {
  window.history.pushState({}, '', '/billing')
  render(<App />)
  const btn = await screen.findByRole('button', { name: '$10' })
  const before = document.body.textContent?.length ?? 0
  fireEvent.click(btn)
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Starting…' })).toBeNull()
  })
  const text = document.body.textContent ?? ''
  return { added: text.length - before, text }
}

describe('/billing — a checkout that never got an answer', () => {
  it('says the payment could not be started instead of adding nothing to the page', async () => {
    checkoutAnswer = 'reject'
    const { added, text } = await buyTenDollars()

    // The click reached the network: this is silence, not a disabled button.
    expect(posts).toBe(1)
    // The measured defect, stated as the invariant: a failed purchase attempt changes the page.
    expect(added).toBeGreaterThan(0)
    expect(text).toContain('nothing was charged')
  })

  it('does not blame a cause it cannot know — no expired session, no disabled billing', async () => {
    checkoutAnswer = 'reject'
    const { text } = await buyTenDollars()

    expect(posts).toBe(1)
    // ⚠ THE ANCHOR IS NOT DECORATION. Before the fix this whole test passed on an EMPTY page:
    // four `not.toContain`s are satisfied by a screen that says nothing at all, which is the
    // defect. Requiring the sentence FIRST is what gives the four negatives a page to be false
    // on — without it they can never fail, in either direction.
    expect(text).toContain('nothing was charged')
    // A fetch rejection carries no status. Naming one of the five kinds would be a guess, and
    // three of them tell the customer to do something that would not help.
    expect(text).not.toContain('Your session has expired')
    expect(text).not.toContain('LENS_BILLING_ENABLED')
    expect(text).not.toContain('isn’t on offer')
    expect(text).not.toContain('origin was rejected')
  })

  // ⚠ NOT AN ASSERTION ABOUT NAVIGATION. `window.location.assign` cannot be spied in this jsdom
  // ("Cannot redefine property: assign"), and a test that throws while setting up its own spy
  // reads in the runner exactly like a caught defect. What IS observable is the marker the flow
  // depends on — and TopUp.tsx:85 states the rule: written only once the session exists, so a
  // failed checkout must not leave a pending marker behind.
  it('leaves no pending top-up marker behind when the call never completed', async () => {
    checkoutAnswer = 'reject'
    await buyTenDollars()
    expect(posts).toBe(1)
    expect(window.sessionStorage.getItem(PENDING_TOPUP_KEY)).toBeNull()

    // The positive half, in the same fixture: an accepted checkout DOES record one. Without it,
    // "no marker" is satisfied by a mechanism that never writes a marker under any condition.
    cleanup()
    queryClient.clear()
    posts = 0
    checkoutAnswer = { status: 200, body: { url: 'https://checkout.stripe.com/c/pay/cs' } }
    await buyTenDollars()
    expect(posts).toBe(1)
    expect(window.sessionStorage.getItem(PENDING_TOPUP_KEY)).not.toBeNull()
  })

  // ── MUST STAY GREEN ───────────────────────────────────────────────────────────────────
  // The fix widens the gate; it must not flatten the five sentences into one. If a future
  // change answers every failure with the fallback, these two red and the one above does not.

  it('still names the deployment flag when billing is switched off', async () => {
    checkoutAnswer = { status: 503, body: { billing_enabled: false, error: 'billing disabled' } }
    const { text } = await buyTenDollars()

    expect(text).toContain('LENS_BILLING_ENABLED')
  })

  it('still tells an expired session to sign in rather than reporting a payment fault', async () => {
    checkoutAnswer = { status: 401, body: { error: 'signed out' } }
    const { text } = await buyTenDollars()

    expect(text).toContain('Your session has expired')
  })
})
