import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from './App'
import { populatedBff, settleQueries } from './populatedBff'

/**
 * ConsoleHeading.test.tsx — THE SIGNED-IN CONSOLE RENDERED NO HEADING ELEMENT AT ALL, SO NOTHING
 * IN IT COULD BE REACHED BY THE ONE NAVIGATION A SCREEN-READER USER REACHES FOR FIRST.
 *
 * ── WHAT WAS MEASURED, IN THE DOM RATHER THAN IN THE SOURCE ──────────────────────────
 *
 * A throwaway probe drove the real `<App />` to all twelve `CONSOLE_ROUTES` addresses and counted
 * `document.querySelectorAll('h1,h2,h3,h4,h5,h6')` at each:
 *
 *     /  /ledger  /billing  /billing/success  /billing/cancel  /keys
 *     /setup  /spend  /members  /settings  /track  /docs        →  headings = 0, all twelve
 *
 *     TOTAL heading elements across every gated address: 0 of 12 pages had one.
 *
 * The page name WAS on the screen the whole time — `App.tsx` painted it as
 * `<div className="min-w-0 truncate text-head text-ink">{page}</div>` — so a sighted reader saw a
 * page title and assistive technology saw an anonymous box. Pressing `H` (jump to next heading),
 * or asking for the heading list, returned nothing on every screen behind the gate.
 *
 * ⚠ THE COUNT IS RE-DERIVED, NOT INHERITED. The queue carried "the gated console renders exactly
 * ONE heading element", counted from SOURCE with a newline-tolerant matcher, that one being
 * `IssueDetail.tsx`'s `<h1>`. That figure is about the whole product and is consistent with this
 * one: IssueDetail is reached at `/track/<id>`, deeper than any address in `CONSOLE_ROUTES`, so at
 * the twelve addresses a person actually lands on, the rendered count is ZERO. A source census and
 * a per-address DOM census answer different questions; this file asserts the second.
 *
 * ── WHY THE HEADING IS THE ONE IN THE BANNER ─────────────────────────────────────────
 *
 * Not a new element and not a second copy of the title: the element that already names the page
 * becomes the heading it was behaving as. `ConsoleTitle.test.tsx` made this argument in prose when
 * it fixed the string — "to a screen reader arriving at the banner landmark, it IS the page" — and
 * `9e5560e` extended the same computed `page` value to `document.title`. One expression, now three
 * consumers: the tab, the visible title, and the heading.
 *
 * ⚠ AND IT IS MEASURED ZERO-PIXEL, WHICH IS WHY THIS IS STRUCTURE AND NOT DESIGN. Read out of the
 * BUILT artifact (`dist/assets/index-*.css`, sha256 6ac40c1be2bc…, 22,420 bytes) rather than
 * assumed from what Tailwind is believed to emit — every rule in the shipped sheet whose selector
 * list contains `h1` as a token:
 *
 *     h1,h2,h3,h4,h5,h6                        { font-size:inherit; font-weight:inherit }
 *     blockquote,dl,dd,h1,…,h6,hr,figure,p,pre { margin:0 }
 *
 * and `.text-head{font-size:17px;line-height:1.3;font-weight:600}` supplies the type either way.
 * An `<h1>` carrying the same classes paints the same pixels as the `<div>` did; the stylesheet is
 * byte-identical across the change.
 *
 * ── WHAT THIS FILE ASSERTS, AND THE VACUITY IT CLOSES ────────────────────────────────
 *
 * "There is a heading" is satisfied by an EMPTY heading, and "there is a heading with text" is
 * satisfied by the SAME text on every page — both are worse than the div, because they announce a
 * structure that does not inform. So the names are PINNED AS LITERALS below and the table must
 * equal `CONSOLE_ROUTES` in BOTH directions: a page added without naming it here fails, and a name
 * left here after its route goes fails too.
 *
 * ⚠ THE NAMES ARE NOT READ FROM `titleFor`. A guard that asks the code under test what it should
 * say agrees with it for every possible value of it — this queue has paid for that shape twice.
 */

/** Address (what a person types) from a route path (what `<Route path>` takes). */
const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '')

/**
 * The heading every gated address must render, written down here rather than derived.
 *
 * The three `/billing*` addresses share a name on purpose: they are one page reached three ways
 * (arriving from Stripe lands on `/billing/success`), and naming the destination after the
 * transaction that sent you there would name a page the reader is not on.
 */
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
  '/track': 'Track',
  '/docs': 'Docs',
}

/**
 * ⚠ THIS 404'd EVERYTHING, so this sweep measured each screen's EMPTY state (W1.1.17b). It now uses
 * the shared populated fixture; populatedBffCoverage.test.tsx stops that fixture rotting to a floor.
 */
function mockBff() {
  populatedBff((impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
  })
}

async function at(address: string) {
  window.history.pushState({}, '', address)
  render(<App />)
  // The gate probes /auth/me before the shell exists; the nav is the settled state.
  await screen.findByRole('navigation', { name: /sections/i })
  // ⚠ THE NAV IS THE SHELL. Counting here measures the screen mid-load — W1.1.17b.
  await settleQueries(queryClient, waitFor)
}

beforeEach(mockBff)
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('every gated console address is navigable by heading', () => {
  it('the pinned table and CONSOLE_ROUTES describe the same set of addresses', () => {
    const fromRouter = CONSOLE_ROUTES.map((r) => addressOf(r.path)).sort()
    const fromTable = Object.keys(PINNED).sort()
    expect(
      fromTable,
      'the pinned heading names and the router disagree — a console page was added or removed and ' +
        'nothing named its heading, so the sweep below would silently stop covering it',
    ).toEqual(fromRouter)
  })

  for (const route of CONSOLE_ROUTES) {
    const address = addressOf(route.path)

    it(`${address} renders exactly one h1, and it names the page`, async () => {
      await at(address)

      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      expect(
        headings.length,
        `${address} rendered ${headings.length} heading elements. With none, this page cannot be ` +
          'reached by the H key or listed in a screen reader’s headings rotor — the page name is ' +
          'painted as an anonymous element.',
      ).toBeGreaterThan(0)

      const h1s = document.querySelectorAll('h1')
      expect(
        h1s.length,
        `${address} rendered ${h1s.length} <h1> elements, want exactly 1 — two top-level headings ` +
          'on one screen is a second claim about what the page is.',
      ).toBe(1)

      // The name, pinned. An empty or constant heading is worse than the div it replaced: it
      // announces a structure that carries no information.
      expect(
        h1s[0].textContent,
        `${address} rendered an <h1> that does not name the page.`,
      ).toBe(PINNED[address])
    })
  }
})
