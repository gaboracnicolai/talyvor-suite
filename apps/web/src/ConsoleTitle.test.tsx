import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, NOT_FOUND_TITLE } from './App'

/**
 * THE CONSOLE HEADER NAMES THE PAGE YOU ARE ON — INCLUDING WHEN YOU ARE ON NONE OF THEM.
 *
 * ── WHAT WAS MEASURED, AT `c9e1e8a`, WITH EVERY GATE GREEN ───────────────────────────
 *
 * `App.tsx` carried TWO tables of paths that had to agree, and nothing asked whether they did:
 * the `<Routes>` list, and `titleFor()`'s own copy. They disagreed on every address that has
 * no page. Eight were driven through the real `<App />`; eight titled as a page:
 *
 *   /admin · /admin/certificates · /specimen · /nonesuch · /keys/extra → "Overview"
 *   /billingx → "Billing"   /trackers → "Track"   /docs-old → "Docs"
 *
 * Two mechanisms, both rendered:
 *   · `titleFor` ended `return exact[pathname] ?? 'Overview'`, so EVERY unmatched address
 *     titled as Overview. At /admin — the retired operator console `AdminRemoved.test.tsx`
 *     exists because someone still has it bookmarked — the console said, at one instant:
 *       header   "Overview"                 (a page you are not on)
 *       sidebar  nothing `aria-current`     (no page at all)
 *       body     "Nothing at this address — pick a section from the sidebar."
 *     Three signals, one false, and the false one is the only NAME on the screen. To a screen
 *     reader arriving at the banner landmark, it is the page.
 *   · `pathname.startsWith('/billing')` is true of `/billingx`, which routes to the catch-all.
 *     A prefix test is not the router's matcher and never was.
 *
 * ⚠ `AdminRemoved.test.tsx` ALREADY RENDERS /admin AND PASSES. It pins the body message and
 * each invented hostname by name — the strings someone thought of — and never asks what the
 * header says. That is the #91 shape (a curated list guards what it lists), one file away.
 *
 * ── WHY THIS READS THE RENDERED BANNER ───────────────────────────────────────────────
 *
 * The fix unifies the two tables into `CONSOLE_ROUTES`, which makes "every route has a title"
 * true BY CONSTRUCTION — so a test that asks that table about itself would pass for every value
 * of it. This drives `<App />` to each address and reads the string the banner actually paints.
 * It was red 8/20 on the code it was written against.
 *
 * ⚠ AND THE NAMES ARE PINNED AS LITERALS BELOW, not read from the table. Driving the render
 * loop off `CONSOLE_ROUTES` is what makes a NEW route audited automatically; it is also what
 * would let a renamed page rename its own expectation. `PINNED` is the second half: the table
 * must equal it exactly, in both directions, so adding a page without naming it here fails.
 */

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

async function at(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  // The gate probes /auth/me before the shell exists; the nav is the settled state.
  await screen.findByRole('navigation', { name: /sections/i })
}

/** The string the sticky top bar paints. `<header>` outside main/article IS the banner
 *  landmark, so this reads the element assistive tech announces, not a class name. */
function headerTitle(): string {
  const banner = screen.getByRole('banner')
  const title = banner.firstElementChild
  if (!title) throw new Error('the banner rendered no title element')
  return title.textContent ?? ''
}

/**
 * "This address matched no PAGE" — the app-level catch-all, identified by the half of its
 * sentence nothing else says.
 *
 * ⚠ THE FIRST VERSION MATCHED "Nothing at this address" AND WAS AMBIGUOUS. `DocsArea` has its
 * OWN nested catch-all opening with that same phrase, so /docs/spaces/… inside the Docs area
 * read as the app catch-all and the deep-address case failed on a product that was correct.
 * An instrument that cannot tell two different states apart reports one of them wrongly.
 */
const isCatchAll = () =>
  (document.body.textContent ?? '').includes('pick a section from the sidebar')

/** A route path is what `<Route path>` takes; an ADDRESS is what a person types. They differ
 *  only for the two splats, and `/track/*` matches `/track` itself. */
const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '')

beforeEach(mockBff)
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

/** EVERY PAGE'S NAME, AS A LITERAL. Keyed by the route path exactly as `<Route>` receives it. */
const PINNED: Readonly<Record<string, string>> = {
  '/': 'Overview',
  '/ledger': 'Ledger',
  '/chat': 'Chat',
  '/earnings': 'Earnings',
  '/billing': 'Billing',
  '/billing/success': 'Billing',
  '/billing/cancel': 'Billing',
  '/keys': 'API keys',
  '/setup': 'Setup',
  '/spend': 'Spend & routing',
  '/members': 'Members',
  '/settings': 'Settings',
  '/track/*': 'Track',
  '/docs/*': 'Docs',
}

/**
 * ADDRESSES WITH NO PAGE, each reachable today. /admin and /admin/certificates are the retired
 * operator console (a real bookmark — see AdminRemoved.test.tsx); /specimen is the deleted
 * design-system gallery (FirstRunGaps.test.tsx pins its removal); /keys/extra is one segment
 * past a real page; the last three are one CHARACTER past a real area prefix, which is the
 * exact shape `startsWith` could not tell from a page.
 */
const NO_SUCH_PAGE = [
  '/admin',
  '/admin/certificates',
  '/specimen',
  '/nonesuch',
  '/keys/extra',
  '/billingx',
  '/trackers',
  '/docs-old',
] as const

/**
 * Deep addresses INSIDE the two splat areas. They are pages, and they must keep the area's
 * name — the fix must not turn a matched splat into a not-found.
 *
 * ⚠ THE LAST TWO ARE THE AREAS' OWN not-found STATES, and they belong here rather than in
 * NO_SUCH_PAGE: an unknown address under /docs is still the Docs area (DocsArea renders its own
 * "Nothing at this address. Back to spaces" card), and TrackArea's `*` renders the issue LIST.
 * The top bar is naming the AREA you are in, and in both cases you are in it.
 */
const DEEP_IN_AREA: ReadonlyArray<readonly [string, string]> = [
  ['/track/issues/ISSUE-1', 'Track'],
  ['/docs/spaces/sp_1', 'Docs'],
  ['/track/nonesuch', 'Track'],
  ['/docs/nonesuch', 'Docs'],
]

describe('the table names every page it routes', () => {
  it('CONSOLE_ROUTES and the pinned names agree, in both directions', () => {
    const fromTable = Object.fromEntries(CONSOLE_ROUTES.map((r) => [r.path, r.title]))
    expect(fromTable).toEqual(PINNED)
  })

  it('the table is not empty, so no loop below can pass by having nothing to check', () => {
    // The floor. `it.each([])` reports zero tests, and a zero-length table is the state a
    // broken export is indistinguishable from. 12 is the count at the commit that added this.
    expect(CONSOLE_ROUTES.length).toBeGreaterThanOrEqual(12)
    expect(NO_SUCH_PAGE.length).toBeGreaterThanOrEqual(8)
  })
})

describe('every console address titles itself truthfully', () => {
  it.each(CONSOLE_ROUTES.map((r) => [addressOf(r.path), r.title] as const))(
    '%s is titled %s',
    async (address, title) => {
      await at(address)
      expect(headerTitle()).toBe(title)
      // A page that titles correctly but renders the catch-all is the same lie inverted, and
      // it is how a route deleted from the table would otherwise slip past.
      expect(isCatchAll(), `${address} rendered the catch-all under the title "${title}"`).toBe(
        false,
      )
    },
  )

  it.each(DEEP_IN_AREA)('%s keeps its area name', async (address, title) => {
    await at(address)
    expect(headerTitle()).toBe(title)
    expect(isCatchAll(), `${address} fell through to the catch-all`).toBe(false)
  })

  it.each(NO_SUCH_PAGE)('%s is titled as no page, not as a page', async (address) => {
    await at(address)
    // Prove the address really has no page first — otherwise the title assertion below would
    // be checking a route that quietly started existing.
    expect(isCatchAll(), `${address} is not the catch-all any more; this case is stale`).toBe(true)
    expect(headerTitle()).toBe('Not found')
  })
})

describe('the not-found title is not a page name', () => {
  it('is "Not found"', () => {
    // Hardcoded, not compared to itself: a guard that reads the constant it checks passes for
    // every value of that constant.
    expect(NOT_FOUND_TITLE).toBe('Not found')
  })

  it('is not the title of any console page', () => {
    expect(Object.values(PINNED)).not.toContain('Not found')
  })
})
