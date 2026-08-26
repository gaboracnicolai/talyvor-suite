import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { blankComments } from '../../../packages/ui/src/lib/sourceText'
import { App, CONSOLE_ROUTES, queryClient } from './App'

/**
 * ConsoleNavLinks.test.tsx — TEN OF THE TWELVE DESTINATIONS IN THE CONSOLE'S PRIMARY NAVIGATION
 * WERE NOT LINKS. They were `<button>`s that called `navigate()`, so they carried no `href`.
 *
 * ── WHAT WAS MEASURED, IN THE DOM AND BY ACTIVATION ──────────────────────────────────
 *
 * A throwaway probe drove the real `<App />` to all twelve gated addresses. At each one it clicked
 * every `<button>` on the page in turn, from a freshly mounted app, and recorded which ones changed
 * `location.pathname`:
 *
 *     every gated address        9 or 10 buttons change the address on click, and none has an href
 *     nav[aria-label=Sections]   2 of 12 destinations were `<a href>`   (Privacy, Terms)
 *                               10 of 12 were `<button>`               (Overview, Ledger, Billing,
 *                                                                       Setup, API keys, Spend &
 *                                                                       routing, Members, Settings,
 *                                                                       Track, Docs)
 *
 * The two that were links are the two legal documents in the footer of the sidebar. The ten that
 * were not are every product destination in the application.
 *
 * ── WHY THIS IS A DEFECT AND NOT A PREFERENCE, IN THE PRODUCT'S OWN WORDS ────────────
 *
 * The rule is not one this file invented. It is written down twice in the codebase already, and
 * applied both times to something smaller than the primary navigation:
 *
 *   · `App.tsx`, on the Privacy/Terms pair: "Link, not <a href>: same-tab client-side navigation,
 *     and it keeps a real href so the link is a link to assistive tech and to a middle-click."
 *   · `areas/docs/components.tsx`, on `BackButton`: "A REAL <button>, not a Link wearing button
 *     styling. … the crumb beside it is already the link, and already carries the link semantics
 *     worth having (cmd-click, open in a new tab)."
 *
 * So the product argues, in two places, that a destination should be a link and that cmd-click and
 * open-in-a-new-tab are the semantics worth having — while the ten destinations every person uses
 * on every screen had none of them. What a `<button onClick={navigate}>` cannot do, measured as
 * capability rather than as markup: it cannot be cmd/ctrl-clicked into a new tab, it cannot be
 * middle-clicked at all (middle click raises `auxclick`, never `click`), it has no context-menu
 * "Open link in new tab" or "Copy link address", it shows no destination in the status bar, and it
 * is announced as a button — so a screen reader's LINKS list, on every screen behind the gate,
 * offered Privacy and Terms and no way to reach any part of the product.
 *
 * ── THE FIX USES THE COMPONENT'S OWN ESTABLISHED SEAM ────────────────────────────────
 *
 * `Button` in the same package has carried `asChild` (Radix `Slot`) since it was written. `NavItem`
 * gains exactly that, and `App.tsx` renders `<NavItem asChild><Link to={…}/></NavItem>`. No class
 * moves and no element is added: the same class string lands on an `<a href>` instead of a
 * `<button>`, and react-router's `Link` is what already decides that a plain click is a client-side
 * navigation while a modified click is the browser's to handle.
 *
 * ── WHAT THIS FILE ASSERTS, AND WHY IT IS NOT A TAG-NAME CHECK ───────────────────────
 *
 * ⚠ THE LAST DESCRIBE BLOCK IS THE ONE THAT MATTERS. Asserting `<a href>` would pass for an anchor
 * that navigates on every click including a cmd-click — which is a button in an anchor's clothing
 * and delivers none of the capability above. So the capability is asserted directly, by activation:
 * a plain click must navigate WITHOUT leaving the app, and a meta/ctrl-modified click must NOT
 * navigate in-app at all, because that click belongs to the browser. A `<button onClick>` fails the
 * second case for the reason the reader cares about — it steals the modified click.
 *
 * ⚠ AND EVERY COUNT CARRIES A FLOOR. "every destination is a link" is also what a sidebar that
 * rendered nothing reports. The destination count is pinned by the LIST below rather than by a
 * number in this sentence, and the pinned list is cross-checked against `App.tsx`'s own call
 * sites, so neither adding a destination nor deleting one leaves this sweep quietly reporting on a
 * set it no longer covers. (It read "pinned at twelve" until W4.6.1 step 7 added /earnings and made
 * that thirteen — a cardinal in prose beside a list that already states it is one more thing to
 * keep true, so it is gone rather than incremented.)
 */

/** Every destination the sidebar offers, pinned. A literal, so a deletion moves it too. */
const SIDEBAR_DESTINATIONS = [
  '/',
  '/ledger',
  // W4.6.1 step 7. ⚠ THE THIRTEENTH, AND IT IS IN THE SIDEBAR ON PURPOSE: /chat (step 6) is a
  // route with no sidebar entry, so it is reachable only by typing the address. An earnings screen
  // nobody can find answers a question nobody gets to ask — the same defect Members.tsx was
  // rebuilt for, one level up.
  '/earnings',
  '/billing',
  '/setup',
  '/keys',
  '/spend',
  '/members',
  '/settings',
  '/track',
  '/docs',
  '/privacy',
  '/terms',
] as const

/**
 * A destination affordance is anything in the sections nav a keyboard reaches. If it is focusable
 * and it is in the navigation, it is offered as a way to go somewhere.
 */
const FOCUSABLE =
  'a[href], a, button:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="link"], [role="button"]'

function sectionsNav(): HTMLElement {
  const nav = document.querySelector<HTMLElement>('nav[aria-label="Sections"]')
  if (!nav) throw new Error('the sections nav did not render — nothing below is a fact about it')
  return nav
}

/** Each affordance as `<tag href>` — the shape the reader's browser gets, not the source's. */
function affordances(root: HTMLElement): string[] {
  return Array.from(new Set(root.querySelectorAll<HTMLElement>(FOCUSABLE))).map((el) => {
    const href = el.getAttribute('href')
    const label = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${label} <${el.tagName.toLowerCase()}${href === null ? ' NO-HREF' : ` href=${href}`}>`
  })
}

/** The ones that are real links, by path, in DOM order. */
function linkPaths(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).map(
    (a) => new URL(a.href, window.location.origin).pathname,
  )
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

afterEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '')

describe('the instrument, before it is pointed at the product', () => {
  // DETACHED on purpose. test-setup.ts runs a focus-ring audit over the document after every
  // test; a synthetic control appended to the body is a real finding for that audit, and these
  // three cases would fail for a reason that has nothing to do with what they measure.
  const dom = (html: string) => {
    const root = document.createElement('div')
    root.innerHTML = html
    return root
  }

  it('reports an href-less affordance as NO-HREF', () => {
    expect(
      affordances(dom('<button>Ledger</button>')),
      'a button was not reported as href-less — every reading below would then flatter the page',
    ).toEqual(['Ledger <button NO-HREF>'])
  })

  it('reports an anchor without an href as href-less too, not as a link', () => {
    expect(
      affordances(dom('<a role="link" tabindex="0">Ledger</a>')),
      'an <a> with no href was credited as a link; it is not one to a browser or to a rotor',
    ).toEqual(['Ledger <a NO-HREF>'])
  })

  it('counts a real link once, not once per matching selector', () => {
    const root = dom('<a href="/ledger" role="link" tabindex="0">Ledger</a>')
    expect(affordances(root)).toEqual(['Ledger <a href=/ledger>'])
    expect(linkPaths(root)).toEqual(['/ledger'])
  })
})

describe('every destination in the console navigation is a link', () => {
  beforeEach(mockBff)

  it('the destinations pinned here are exactly the ones App.tsx puts in the sidebar', () => {
    const app = blankComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8'))
    // Every `item('/x', …)` call in Sidebar(), plus every `to="/x"` Link it renders.
    const declared = [
      ...Array.from(app.matchAll(/\bitem\('([^']+)'/g)).map((m) => m[1]),
      ...Array.from(app.matchAll(/\bto="([^"]+)"/g)).map((m) => m[1]),
    ]
    expect(
      [...new Set(declared)].sort(),
      'App.tsx offers a sidebar destination this file does not pin (or no longer offers one it ' +
        'does) — a thirteenth destination could otherwise be added as a button and never be swept',
    ).toEqual([...SIDEBAR_DESTINATIONS].sort())
  })

  for (const route of CONSOLE_ROUTES) {
    const address = addressOf(route.path)
    it(`${address}: no destination in the sidebar is href-less`, async () => {
      window.history.pushState({}, '', address)
      render(<App />)
      await screen.findByRole('navigation', { name: /sections/i })

      const found = affordances(sectionsNav())
      expect(
        found.length,
        `the sidebar at ${address} offered ${found.length} focusable destinations, not ` +
          `${SIDEBAR_DESTINATIONS.length} — a sidebar that drew nothing has no href-less ` +
          'destination either, so the assertion below would be a fact about an empty box',
      ).toBe(SIDEBAR_DESTINATIONS.length)
      expect(
        found.filter((f) => f.includes('NO-HREF')),
        `${address}: these destinations in the primary navigation carry no href. They cannot be ` +
          'cmd-clicked into a new tab, cannot be middle-clicked at all, have no "copy link ' +
          'address", and are announced as buttons — so the links list behind the gate does not ' +
          'contain the product.',
      ).toEqual([])
      expect(
        linkPaths(sectionsNav()).sort(),
        `${address}: the sidebar's links do not address the destinations it offers`,
      ).toEqual([...SIDEBAR_DESTINATIONS].sort())
    })
  }
})

describe('the capability, not the tag: activation is what the reader gets', () => {
  beforeEach(mockBff)

  /** Mount at `/` and hand back the sidebar link for `to`. */
  async function sidebarLink(to: string): Promise<HTMLAnchorElement> {
    window.history.pushState({}, '', '/')
    render(<App />)
    await screen.findByRole('navigation', { name: /sections/i })
    const link = Array.from(sectionsNav().querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (a) => new URL(a.href, window.location.origin).pathname === to,
    )
    if (!link) {
      throw new Error(
        `the sidebar offers no LINK to ${to} — its affordance is ` +
          `${affordances(sectionsNav()).join(', ')}`,
      )
    }
    return link
  }

  it('a plain click navigates, and does it inside the app rather than reloading', async () => {
    const link = await sidebarLink('/ledger')
    fireEvent.click(link, { button: 0 })
    expect(window.location.pathname, 'a plain click did not navigate').toBe('/ledger')
    expect(
      document.querySelector('nav[aria-label="Sections"]'),
      'the shell was torn down by the click — this became a full page load, which is what the ' +
        'client-side handler exists to prevent',
    ).not.toBeNull()
  })

  it('a cmd/ctrl-clicked destination is left to the browser, not stolen by the app', async () => {
    const link = await sidebarLink('/ledger')
    fireEvent.click(link, { button: 0, metaKey: true })
    expect(
      window.location.pathname,
      'a meta-clicked destination navigated the CURRENT tab. The reader asked for a new tab and ' +
        'lost the page they were on: this is what a <button onClick={navigate}> does with every ' +
        'modified click, and it is the capability the href exists to give back.',
    ).toBe('/')

    fireEvent.click(link, { button: 0, ctrlKey: true })
    expect(window.location.pathname, 'a ctrl-clicked destination navigated the current tab').toBe(
      '/',
    )
  })

  it('the destination is on the element itself, where the browser and the rotor read it', async () => {
    const link = await sidebarLink('/keys')
    expect(link.getAttribute('href')).toBe('/keys')
    expect(
      link.getAttribute('target'),
      'a target would take the same-tab navigation away again',
    ).toBeNull()
  })

  it('the active destination still announces itself as the current page', async () => {
    window.history.pushState({}, '', '/keys')
    render(<App />)
    await screen.findByRole('navigation', { name: /sections/i })
    const current = Array.from(sectionsNav().querySelectorAll('[aria-current="page"]'))
    expect(
      current.map((el) => (el.textContent ?? '').trim()),
      'aria-current moved off the destination when it stopped being a button — the selected row ' +
        'is then a tick a sighted reader sees and nothing else',
    ).toEqual(['API keys'])
  })
})
