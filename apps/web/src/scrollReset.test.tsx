import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, CONSOLE_ROUTES, queryClient } from './App'

/**
 * scrollReset.test.tsx — CLIENT-SIDE NAVIGATION CARRIED THE PREVIOUS PAGE'S SCROLL OFFSET INTO
 * THE NEXT PAGE, so a reader who scrolled down and then clicked a destination arrived part-way
 * through it. The browser resets scroll on a real navigation; this application replaced real
 * navigations with client-side ones and did not replace the thing they did for free.
 *
 * ── WHAT WAS MEASURED, IN REAL CHROME ON THE BUILT ARTIFACT ──────────────────────────
 *
 * `apps/web/dist` at `088d711` served over HTTP with a BFF stub, driven in Chrome at 1280x720.
 * The SAME PAIR OF PAGES and the SAME STARTING OFFSET, twice — the only difference between the
 * rows is whether the navigation was a full page load or a click on the in-page link:
 *
 *     /terms scrolled to y=900  --(browser: location change, full load)-->  /privacy   y = 0
 *     /terms scrolled to y=900  --(click the "Privacy" link, client-side)-->  /privacy y = 900
 *
 * The full-load row is the POSITIVE CONTROL: it proves the instrument reads 0 when a reset
 * happens, and that /privacy does not scroll itself. 900 is not a clamp — /privacy's maximum
 * offset is 1881, so the offset was CARRIED, not coincidentally landed on.
 *
 * Inside the console, from the tallest gated address:
 *
 *     /setup scrolled to its bottom (y=1905.5) --click--> /settings   y = 116.5  (its MAXIMUM)
 *     /setup scrolled to its bottom (y=1905.5) --click--> /privacy    y = 1881   (its MAXIMUM)
 *
 * so clicking "Privacy" from a scrolled page opened the privacy policy at its last line.
 *
 * ── WHY THE OBVIOUS FIX IS WRONG, ALSO MEASURED ──────────────────────────────────────
 *
 * `history.scrollRestoration` is `auto` and the browser's own restoration WORKS across these
 * client-side entries — measured in the same session: /terms at y=900, forward to /privacy,
 * scrolled to y=300, `history.back()` restored 900, `history.forward()` restored 300. A
 * scroll-to-top on every location change would DESTROY that: the back button would drop the
 * reader at the top of a page they had read half of. So the reset is applied on PUSH and
 * REPLACE and NOT on POP — the browser keeps the half of this it already does correctly.
 *
 * ── WHAT THIS FILE CAN AND CANNOT SEE ────────────────────────────────────────────────
 *
 * ⚠ jsdom HAS NO LAYOUT AND NO SCROLLING. `window.scrollY` is 0 forever here regardless of what
 * the product does, so a position assertion in this file could never fail — the first describe
 * block MEASURES that and pins it, so nobody later writes one believing it guards something.
 * What is assertable here is the MECHANISM: that the top of the document is requested on a push
 * and is not requested on a pop, at every address and on both sides of the auth gate. The Chrome
 * rows above are the proof that the mechanism is the one the reader needs.
 */

/** Where the product must put the reader on a push: the top of the document. */
const TOP = [0, 0]

function scrollCalls(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
  return spy.mock.calls.map((c) => Array.from(c) as unknown[])
}

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

/** The sections nav, or a failure that says so rather than a silent empty sweep. */
function sectionsNav(): HTMLElement {
  const nav = document.querySelector<HTMLElement>('nav[aria-label="Sections"]')
  if (!nav) throw new Error('the sections nav did not render — nothing below is a fact about it')
  return nav
}

function destination(path: string): HTMLAnchorElement {
  const a = Array.from(sectionsNav().querySelectorAll<HTMLAnchorElement>('a[href]')).find(
    (el) => new URL(el.href, window.location.origin).pathname === path,
  )
  if (!a) throw new Error(`the sidebar offered no destination for ${path}`)
  return a
}

let scrollTo: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // jsdom's window.scrollTo is a no-op that warns; the spy replaces it so the call is observable
  // AND the warning does not reach the virtual console.
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

describe('the instrument, before it is pointed at the product', () => {
  it('sees a request for the top of the document, with its arguments', () => {
    window.scrollTo(0, 0)
    expect(
      scrollCalls(scrollTo),
      'the spy did not record a scroll request — every "it scrolled" below would be unfalsifiable',
    ).toEqual([TOP])
  })

  it('records nothing when nothing asks to scroll', () => {
    expect(
      scrollCalls(scrollTo),
      'the spy reported a call nobody made — every "it did not scroll" below would be a lie',
    ).toEqual([])
  })

  // ⚠ THIS CASE PRINTS `Not implemented: window.scrollTo` TO stderr, and that IS the measurement:
  // it restores jsdom's own stub and calls it, which is the only way to show the position never
  // moves. The line is expected output, not a warning anybody needs to act on.
  it('CANNOT see scroll position: jsdom leaves window.scrollY at 0 whatever is asked of it', () => {
    scrollTo.mockRestore()
    window.scrollTo(0, 900)
    expect(
      window.scrollY,
      'jsdom moved scrollY — then a position assertion IS possible here and this file is ' +
        'measuring less than it could',
    ).toBe(0)
  })
})

describe('a push navigation puts the reader at the top of the page they asked for', () => {
  beforeEach(mockBff)

  // Every gated address, because the defect is a property of navigation itself and a fix
  // installed on one screen's shell would leave the rest carrying the offset.
  for (const route of CONSOLE_ROUTES) {
    const address = route.path.replace(/\/\*$/, '')
    // Somewhere else to go from here. `/` is a destination from every address but its own.
    const target = address === '/' ? '/ledger' : '/'

    it(`${address} → ${target}: the top of the document is requested`, async () => {
      window.history.pushState({}, '', address)
      render(<App />)
      await screen.findByRole('navigation', { name: /sections/i })
      scrollTo.mockClear()

      fireEvent.click(destination(target))

      await waitFor(() => expect(window.location.pathname).toBe(target))
      expect(
        scrollCalls(scrollTo),
        `clicking through to ${target} left the document where the previous page was scrolled ` +
          'to — the reader arrives part-way down a page they have not seen the top of',
      ).toEqual([TOP])
    })
  }

  // ⚠ THE PUBLIC HALF IS A SEPARATE SEAM. /privacy, /terms, /signin, /signup and /marketing are
  // siblings of the gate, not children of it: a reset mounted inside the console's shell would
  // be green on all twelve rows above and absent from every page a stranger sees.
  it('/terms → /privacy, outside the auth gate entirely: the top is requested', async () => {
    window.history.pushState({}, '', '/terms')
    render(<App />)
    await screen.findByText(/terms/i)
    scrollTo.mockClear()

    const privacy = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (a) => new URL(a.href, window.location.origin).pathname === '/privacy',
    )
    if (!privacy) throw new Error('/terms offered no link to /privacy — the case did not run')
    fireEvent.click(privacy)

    await waitFor(() => expect(window.location.pathname).toBe('/privacy'))
    expect(
      scrollCalls(scrollTo),
      'the legal pages are reached by a client-side link like everything else, and this one ' +
        'opened the policy at whatever line the previous page was scrolled to',
    ).toEqual([TOP])
  })
})

describe('a pop navigation is left to the browser, which restores the offset itself', () => {
  beforeEach(mockBff)

  it('going back does not request the top — measured in Chrome, the browser restores it', async () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    await screen.findByRole('navigation', { name: /sections/i })
    // ⚠ CLEARED AFTER THE MOUNT, SO THE FLOOR BELOW MEASURES THE PUSH AND ONLY THE PUSH. Without
    // this line a mutation that scrolls on every navigation reds this case through the FLOOR
    // (mount + push = two calls) and the back-button assertion below is never reached — the case
    // would go red for a true reason while the branch it exists for stayed unmeasured. Measured:
    // C3 in w11-scroll-reset-controls.py did exactly that until this line was added.
    scrollTo.mockClear()

    fireEvent.click(destination('/ledger'))
    await waitFor(() => expect(window.location.pathname).toBe('/ledger'))
    // FLOOR: the push must have scrolled, in THIS test, or "back did not scroll" is a fact
    // about a spy that was never going to record anything.
    expect(
      scrollCalls(scrollTo),
      'the push that sets this case up did not scroll — the assertion below would pass for a ' +
        'product that never scrolls at all',
    ).toEqual([TOP])

    scrollTo.mockClear()
    window.history.back()

    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(
      scrollCalls(scrollTo),
      'the back button was overridden with a jump to the top — the browser had the reader’s ' +
        'place on that page and this threw it away',
    ).toEqual([])
  })

  it('a first load is a pop: arriving at a deep address does not scroll the fresh document', async () => {
    window.history.pushState({}, '', '/settings')
    render(<App />)
    await screen.findByRole('navigation', { name: /sections/i })

    expect(
      scrollCalls(scrollTo),
      'mounting at an address scrolled the document — a fresh document is already at the top, ' +
        'and a reload the browser restored the position of would be dragged away from it',
    ).toEqual([])
  })
})
