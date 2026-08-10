import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

// PanelReportsItsOwnQuery.test.tsx — A PANEL MUST REPORT THE STATE OF THE QUERY IT IS GUARDING.
//
// ── WHAT THIS CATCHES THAT SessionExpired.test.tsx CANNOT ────────────────────
//
// SessionExpired.test.tsx holds the "one dead session is one message" property, and it is a
// good guard. But its fixture — `mockAllApi(status)` — answers EVERY /api/* with the SAME
// status. Under a uniform fixture every panel's error object is interchangeable, so a panel
// that renders a DIFFERENT query's error produces byte-identical output to one that renders
// its own. The property that file exists to protect is therefore structurally invisible to it,
// not by an oversight in its assertions but by the shape of its input.
//
// Measured, on the tree before this file existed. Real <App />, real shipped queryClient, the
// mint ledger and the LXC ledger refused independently:
//
//     mint ledger / LXC ledger      /spend said                    / (Overview) said
//     ────────────────────────────  ─────────────────────────────  ─────────────────────────────
//     401 / 200                     "Couldn’t load the ledger."    "Unavailable."
//     500 / 401                     "Unavailable."                 "Couldn’t load the mint ledger."
//     401 / 401  (the shipped       "Unavailable."                 "Unavailable."
//                 fixture's shape)
//
// The third row is why nothing was red. The first two are the defect, in both directions:
// Spend.tsx guarded on `ledger.isError` and passed `lxc.error`, so it reported a query it was
// not rendering. Overview.tsx:291 is the SAME seam written correctly (`ledger.isError` →
// `ledger.error`), two files away, for the same request — which is what makes the middle
// column a positive control rather than an opinion.
//
// Both directions are harmful and neither is cosmetic:
//   · 401 on the ledger, LXC fine  → the bar says "your session has expired" and the panel
//     underneath adds a second, different diagnosis. That eighth voice is the entire reason
//     components/SessionExpiredBar.tsx exists.
//   · 500 on the ledger, LXC 401   → a genuine fault is laundered into the neutral
//     "Unavailable." placeholder, under a bar telling the reader to sign in again. Signing in
//     again does not fix a 500, and the fault has been made invisible.
//
// ── IT IS THE ORDINARY NAVIGATION, NOT A CONTRIVED ONE ───────────────────────
//
// Measured: clicking "Spend" from Overview issues exactly two requests —
// /api/usage?days=7 and /api/tokens/history — and does NOT re-request /api/lxc/history,
// because `["lxc-history",200,0]` is the SAME key on both screens and staleTime is 15s while
// Spend's mint-ledger key `["spend-ledger"]` is its own and always misses. So on that click the
// LXC query is a fresh cache hit with error === null at exactly the moment the mint ledger
// asks the network. "One query failing while its neighbour holds good data" is the default
// state of that navigation, not an edge case.
//
// ── THE PROPERTY, STATED SO A UNIFORM FIXTURE CANNOT SATISFY IT ──────────────
//
// A: refuse EXACTLY ONE route with 401 and answer every other route 200. The bar must appear
//    and NO panel anywhere may say "Couldn’t load"/"Couldn’t check". With one 401 in flight
//    there is no genuine fault to report, so any such sentence is a panel describing a request
//    that is not its own (or its own successful one).
// B: the inverse, scoped to one card, because a "somewhere on the page" assertion cannot tell
//    which panel spoke. A genuine fault must survive a 401 standing next to it.
//
// The baseline case is the must-stay-green companion: under an all-200 fixture every address
// must render with no failure wording at all. Without it, a fixture that stopped reaching the
// app would make A pass by rendering nothing.

const AUTHENTICATED = {
  mode: 'oidc',
  authenticated: true,
  user: { sub: 'sub-1', email: 'tester@example.com' },
  workspace_id: 'uabcdefghijklmnopqrstuvwxy',
  cache_poolable: false,
  needs_pooling_choice: false,
  signup_open: true,
}

/**
 * Every route this app asks for, answered with a body its screen can render. A panel guarded
 * `q.isError || !q.data` renders its failure branch on a 200 it cannot read, so an incomplete
 * body here would red case A for a reason that has nothing to do with the property. The
 * baseline case is what proves this map is complete.
 */
function bodyFor(url: string): unknown {
  if (url.includes('/api/tokens/history'))
    return [{ id: 'l1', workspace_id: 'w', amount_ulens: 420, balance_after_ulens: 420, type: 'pattern_mine', description: 'mine', created_at: '2026-07-21T10:00:00Z', metadata: { model_used: 'claude-haiku-4-5' } }]
  if (url.includes('/api/lxc/history'))
    return [{ id: 'x1', workspace_id: 'w', amount_ulxc: -640000, balance_after_ulxc: 49360000, type: 'spend', description: 'settle', metadata: { served_model: 'claude-haiku-4-5' }, created_at: '2026-07-21T10:00:05Z' }]
  if (url.includes('/api/spend/month')) return { current_month_usd: 4.31 }
  if (url.includes('/api/usage'))
    return { period_days: 7, models: [], cache: { total_requests: 8, cache_hits: 2, misses: 6, hit_rate: 0.25, by_source: {} } }
  if (url.includes('/api/lxc/balance')) return { balance_ulxc: 49360000, held_ulxc: 0 }
  if (url.includes('/api/tokens/balance')) return { balance_ulens: 1000 }
  if (url.includes('/api/bonds')) return { enabled: false }
  if (url.includes('/api/lxc/topup-options')) return { allowed_usd_cents: [1000, 2500], billing_enabled: true }
  if (url.includes('/api/context')) return { workspace_id: 'uabcdefghijklmnopqrstuvwxy', lens_base_url: 'http://lens:8080', lens_public_base_url: 'https://lens.example' }
  if (url.includes('/api/distill')) return { distill_policy: 'disabled', converted: 0, vision_ocr: 0, days: 30 }
  // The LIST routes. ⚠ AN OBJECT HERE IS NOT A HARMLESS STAND-IN: the first draft answered
  // `{}` for every unlisted route, and /track's screens — which map over what they are given —
  // never reached a settled state at all under a refusal, so three sweep cases timed out
  // against a screen that was still churning. The baseline case did not catch it, because an
  // unreadable body happens to render calmly here. A fixture's completeness is part of the
  // measurement, not part of the scaffolding.
  if (url.includes('/api/keys')) return []
  if (url.includes('/api/members')) return []
  if (url.includes('/api/track/workspaces')) return []
  if (url.includes('/api/track/issues')) return []
  if (url.includes('/api/docs/spaces')) return []
  return {}
}

const requested: string[] = []

/**
 * `refusals` is a list of [route fragment, status]. Everything else answers 200. The point of
 * this mock, and its whole difference from mockAllApi, is that it can refuse ONE route.
 */
function mockBff(refusals: Array<[string, number]> = []) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json(AUTHENTICATED)
    requested.push(url)
    for (const [fragment, status] of refusals) {
      if (url.includes(fragment)) return json({ error: 'refused' }, status)
    }
    return json(bodyFor(url))
  })
}

/**
 * THE PINNED TABLE. Derived by measurement (one all-200 render per address, recording every
 * /api/ path requested), then written down here so the sweep's scope is reviewable and so a
 * screen that GAINS or LOSES a query cannot quietly change what is covered — a runtime-derived
 * set alone would silently shrink to nothing if the fixture stopped reaching the app.
 *
 * ⚠ THE MIXING DEFECT NEEDS TWO CONCURRENT QUERIES, so only the five addresses with more than
 * one route below can host it: /, /billing, /setup, /spend and /track. The single-route
 * addresses are swept anyway — the property is general, and their cost is one render each.
 */
const ADDRESS_ROUTES: Record<string, string[]> = {
  '/': ['/api/bonds', '/api/docs/spaces', '/api/lxc/balance', '/api/lxc/history', '/api/spend/month', '/api/tokens/balance', '/api/tokens/history', '/api/track/workspaces', '/api/usage'],
  '/ledger': ['/api/lxc/history'],
  '/billing': ['/api/lxc/balance', '/api/lxc/topup-options'],
  '/keys': ['/api/keys'],
  '/setup': ['/api/context', '/api/keys'],
  '/spend': ['/api/lxc/history', '/api/spend/month', '/api/tokens/history', '/api/usage'],
  '/members': ['/api/members'],
  '/settings': ['/api/distill'],
  '/track': ['/api/members', '/api/track/issues', '/api/track/workspaces'],
  '/docs': ['/api/docs/spaces'],
}

const FAILURE_WORDING = /Couldn[’']t (load|check)/i

/*
 * ⚠ THE EXEMPTION THAT USED TO LIVE HERE IS CLOSED. /settings was the one gated address that
 * raised no bar on a 401, because areas/lens/Documents.tsx#readDistill threw a bare
 * `new Error(String(res.status))` instead of the shared ApiError, and all three session
 * mechanisms key on that type. It is exempt from nothing now, and the cases in
 * "the read that no session mechanism could see" below are what keep it that way.
 */

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

function pageText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ')
}

/**
 * Settled = the gate has let the app through, every request it is going to make has been made,
 * and nothing still says "Loading…".
 *
 * ⚠ THE FIRST DRAFT OF THIS HELPER WAS THE FILE'S OWN BIGGEST HOLE. It waited only for the
 * absence of "Loading…", which is TRUE AT t=0 — AuthGate has not resolved /auth/me yet, so the
 * body is a single empty <div> with no loading text in it. Every case "settled" instantly
 * against an empty page: the route table derived [] and matched nothing, and the two scoped
 * cases could not find a card because none had rendered. An assertion over a page that never
 * rendered is not a weak assertion, it is no assertion.
 *
 * So this waits for evidence the app is actually running (a request went out) and then for the
 * request stream to go quiet, not merely for one render to look calm.
 */
async function settled() {
  await waitFor(() => expect(requested.length).toBeGreaterThan(0), { timeout: 5000 })
  let previous = -1
  await waitFor(
    () => {
      const stable = requested.length === previous
      previous = requested.length
      expect(stable && !/Loading…|Checking…/.test(pageText())).toBe(true)
    },
    { timeout: 5000, interval: 60 },
  )
}

beforeEach(() => {
  queryClient.clear()
  requested.length = 0
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

// ─── the floor: the table is the product's, and it is not empty ─────────────

describe('the swept set', () => {
  it('covers every gated address, and no address contributes nothing', () => {
    const addresses = Object.keys(ADDRESS_ROUTES)
    expect(addresses).toHaveLength(10)
    for (const [addr, routes] of Object.entries(ADDRESS_ROUTES)) {
      expect(routes.length, `${addr} contributes no route, so it is swept by nothing`).toBeGreaterThan(0)
    }
    // The number the sweep below actually runs. Pinned so that a table someone trims — or a
    // fixture that stops reaching the app — shows up as a smaller sweep rather than as a
    // quieter one.
    const pairs = Object.values(ADDRESS_ROUTES).reduce((n, r) => n + r.length, 0)
    expect(pairs).toBe(25)
  })

  for (const [addr, routes] of Object.entries(ADDRESS_ROUTES)) {
    it(`${addr} still asks for exactly the routes this file sweeps`, async () => {
      mockBff()
      at(addr)
      await settled()
      const actual = [...new Set(requested.filter((u) => u.startsWith('/api/')).map((u) => u.split('?')[0]))].sort()
      expect(actual).toEqual(routes)
    })
  }
})

// ─── the must-stay-green baseline ───────────────────────────────────────────

describe('with every request answered, no address reports a failure', () => {
  for (const addr of Object.keys(ADDRESS_ROUTES)) {
    it(`${addr} renders clean`, async () => {
      mockBff()
      at(addr)
      await settled()
      expect(pageText()).not.toMatch(FAILURE_WORDING)
      expect(document.querySelector('[role="alert"]')).toBeNull()
    })
  }
})

// ─── A. one 401 in flight is one message, and nothing else ──────────────────

describe('a single refused credential is never reported as a genuine fault', () => {
  for (const [addr, routes] of Object.entries(ADDRESS_ROUTES)) {
    for (const route of routes) {
      it(`${addr} with only ${route} refused 401`, async () => {
        mockBff([[route, 401]])
        at(addr)
        await settled()
        // The bar is the one voice that may speak. If it is absent the case proved nothing —
        // the 401 never reached a panel — so this assertion is what stops a silent pass.
        await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 5000 })
        const text = pageText()
        const spoke = text.match(/Couldn[’']t (load|check)[^.]*\.?/gi) ?? []
        expect(
          spoke,
          `${addr}: only ${route} was refused, and with a 401. Any panel saying "Couldn’t load" here is reporting a request that is not the one it is guarding.`,
        ).toEqual([])
      })
    }
  }
})

// ─── B. the inverse: a genuine fault must survive a 401 beside it ───────────
//
// Scoped to ONE card, because "the page says Couldn’t load somewhere" cannot tell which panel
// said it — a sibling's wording would answer for the one under test.

function cardNamed(name: RegExp): string {
  const heading = screen.getByRole('heading', { name })
  const card = heading.closest('div.rounded-card')
  expect(card, `no card found around the heading ${name}`).not.toBeNull()
  return (card?.textContent ?? '').replace(/\s+/g, ' ')
}

describe('a 500 next to a 401 is still a 500', () => {
  it('/spend: the mint-ledger card reports its OWN 500, not the LXC ledger’s 401', async () => {
    mockBff([
      ['/api/tokens/history', 500],
      ['/api/lxc/history', 401],
    ])
    at('/spend')
    await settled()
    const card = cardNamed(/Earned by model/i)
    expect(card, 'the mint ledger returned 500; "Unavailable." is the expired-credential placeholder and hides it').not.toMatch(/Unavailable\./)
    expect(card).toMatch(FAILURE_WORDING)
  })

  it('/ (Overview) does this correctly — the control that says the product already knows the answer', async () => {
    mockBff([
      ['/api/tokens/history', 500],
      ['/api/lxc/history', 401],
    ])
    at('/')
    await settled()
    // Overview.tsx:291 — `ledger.isError ? <Failed what="the mint ledger" error={ledger.error} />`.
    // Same seam, same request, written the right way round. MUST STAY GREEN.
    expect(pageText()).toMatch(/Couldn[’']t load the mint ledger/i)
  })
})

// ─── the read that no session mechanism could see ───────────────────────────
//
// /settings' only read is areas/lens/Documents.tsx#readDistill. It threw
// `new Error(String(res.status))` while every other hand-rolled read in this app raises the
// shared ApiError on purpose and says so in a comment (track/data.ts, docs/api.ts, keysApi,
// topupApi, IssueList, DocsUpstreamCard, Sharing, Overview's probe). ALL THREE session
// mechanisms key on that type, so one untyped throw turned all three off at once:
//
//   1. isSessionExpired() → false, so no bar. Measured: `role="alert"` absent at /settings
//      under a 401 while every other gated address raised it.
//   2. App.tsx's `retry` — "a 401 is a verdict, not a flake" — does not apply, so the refusal
//      was RETRIED. Measured: /api/distill requested TWICE.
//   3. QueryCache.onError never invalidates ['auth-me'], so the gate is not re-probed.
//
// ⚠ AND THE SCREEN THEN GAVE ADVICE THAT WAS FALSE IN EXACTLY THAT STATE — "The buttons below
// still work" — which is the failure components/SessionExpiredBar.tsx was built to remove,
// arriving from the one direction that file could not reach: a panel that never learned the
// session was the problem.
//
// The type is the fix; the wording follows from it, because with the bar now showing, the old
// sentence would be a second voice under it. Both halves of this file are that one change.

/** Refuse by fragment AND method, so the read and the write can be refused independently. */
function mockDistill(readStatus: number | null, writeStatus: number | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json(AUTHENTICATED)
    requested.push(`${method} ${url}`)
    if (url.includes('/api/distill')) {
      const refused = method === 'GET' ? readStatus : writeStatus
      if (refused !== null) return json({ error: 'refused' }, refused)
      return json({ distill_policy: 'always', converted: 0, vision_ocr: 0, days: 30 })
    }
    return json(bodyFor(url))
  })
}

const DISTILL_ADVICE = /buttons below still work/i
const RETRY_ADVICE = /You can try again/i

describe('the document-setting read is a first-class citizen of the session machinery', () => {
  it('a 401 is a verdict, not a flake — /api/distill is asked ONCE', async () => {
    mockDistill(401, null)
    at('/settings')
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 5000 })
    await settled()
    const reads = requested.filter((r) => r.startsWith('GET /api/distill'))
    // The client's retry rule is `failureCount < 1 && !(error instanceof ApiError && status === 401)`.
    // An untyped throw slips past the second half and the refusal is retried — the same refusal,
    // to the same dead credential, for the same answer.
    expect(reads, 'a refused credential was asked twice').toHaveLength(1)
  })

  it('the setting does not add a second diagnosis under the bar', async () => {
    mockDistill(401, null)
    at('/settings')
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 5000 })
    await settled()
    expect(pageText(), 'the bar has already said what happened; "the buttons still work" is both a second voice and false').not.toMatch(DISTILL_ADVICE)
  })

  it('but a GENUINE fault keeps the sentence AND its advice — must stay green', async () => {
    // THE CONTROL THAT STOPS THIS BECOMING "call every failure a session problem". On a 500 the
    // buttons really do still work and re-reading really is what happens, so the sentence is
    // correct and must not be traded away for a vaguer one.
    mockDistill(500, null)
    at('/settings')
    await settled()
    await waitFor(() => expect(pageText()).toMatch(DISTILL_ADVICE), { timeout: 5000 })
    expect(document.querySelector('[role="alert"]'), 'a 500 is not a session problem').toBeNull()
  })

  it('the WRITE half too: a refused save does not tell you to try again', async () => {
    // Four lines from the read, the same shape. "You can try again" is the write half's version
    // of "the buttons below still work": true of a blip, false of a dead credential, and a third
    // voice under a bar that has already given the remedy.
    mockDistill(null, 401)
    at('/settings')
    await settled()
    fireEvent.click(await screen.findByRole('button', { name: /Do not convert my documents/i }))
    await waitFor(() => expect(pageText()).toMatch(/did not save/i), { timeout: 5000 })
    expect(pageText()).not.toMatch(RETRY_ADVICE)
  })

  it('and a genuine save failure DOES — must stay green', async () => {
    mockDistill(null, 500)
    at('/settings')
    await settled()
    fireEvent.click(await screen.findByRole('button', { name: /Do not convert my documents/i }))
    await waitFor(() => expect(pageText()).toMatch(/did not save/i), { timeout: 5000 })
    expect(pageText()).toMatch(RETRY_ADVICE)
  })
})
