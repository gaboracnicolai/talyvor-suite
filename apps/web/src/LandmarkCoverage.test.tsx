import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { blankComments } from '../../../packages/ui/src/lib/sourceText'
import { App, CONSOLE_ROUTES, queryClient } from './App'

/**
 * LandmarkCoverage.test.tsx — EVERY SCREEN A PERSON SEES BEFORE THEY HAVE A SESSION PUT ITS WHOLE
 * BODY IN NO LANDMARK REGION, AND THE ONE THEY SEE MOST HAD NO LANDMARK AT ALL.
 *
 * ── WHAT WAS MEASURED, IN THE DOM, AS A PROPORTION ───────────────────────────────────
 *
 * A throwaway probe drove the real `<App />` to every address and walked its text nodes, asking of
 * each: is any ancestor a landmark region (main/banner/navigation/contentinfo/complementary/form/
 * search, by element or by role)? `<script>`, `<style>` and `<template>` text excluded, because a
 * keyframes block is not something a reader navigates to.
 *
 *     the twelve gated addresses, signed in     0% of characters outside a landmark
 *     /marketing                                0%
 *     /signin                                  93%   (4 of 5 interactive controls, too)
 *     /signup                                  97%   (4 of 5)
 *     /privacy                                 98%   (6,447 of 6,584 characters)
 *     /terms                                   98%   (6,252 of 6,377)
 *     the refused-session card, at EVERY       100%  (215 of 215) — and ZERO landmark elements
 *       gated address                                of ANY kind on the page
 *
 * The console is not the product's weak half here; it is the reference. `Shell` gives every gated
 * address `aside`, `nav`, `header` and `main`, and 100% of the text lands inside one. The marketing
 * page has `header`/`main`/`footer`. The five surfaces that DID NOT are exactly the ones a person
 * meets BEFORE they are signed in — the two front doors, the two policy documents a person reads to
 * decide whether to sign up at all, and the card that replaces every gated page when the session is
 * refused.
 *
 * ⚠ THE LAST ROW IS THE ONE THAT MATTERS AND IT IS NOT AN ADDRESS. `AuthGate`'s signed-out card is
 * a STATE, not a route: it is what `/`, `/ledger`, `/keys` — every gated address — renders when
 * /auth/me says the session is refused. Address-shaped sweeps cannot see it, which is why this file
 * asserts it as a state and why it went unmeasured while twelve addresses were being swept.
 *
 * ── WHY THIS IS A DEFECT AND NOT A PREFERENCE ────────────────────────────────────────
 *
 * Landmark navigation is one of the two ways a screen-reader user moves through a page (the other
 * is headings, which `a19c18f`/#126 and `90a942a`/#127 dealt with). On these five surfaces the
 * region list is empty or holds one region containing 2% of the words, so "jump to the main
 * content" has nothing to jump to and the body is reachable only by reading from the top.
 *
 * The rule being applied is the product's own, already shipped twice: `Shell` and `Landing` both
 * put their content in `<main>`. Thirteen surfaces do it; five did not. This is not a session
 * choosing a convention.
 *
 * ── THE FIX PROMOTES ELEMENTS THAT WERE ALREADY THERE, AND IT IS ZERO-PIXEL ──────────
 *
 * No element is added and no class moves. Four `<div>`s that already wrapped exactly the content
 * in question become `<main>`:
 *
 *     Entry.tsx      the EntryFrame body under the header   (/signin, /signup)
 *     AuthGate.tsx   the SignedOut card's centring wrapper  (the refused-session card)
 *     Privacy.tsx    the page container
 *     Terms.tsx      the page container
 *
 * Measured out of the BUILT stylesheet rather than assumed: it contains NO rule whose selector
 * names `main`, `header`, `footer`, `section`, `article` or `aside` — every box on these screens is
 * drawn by utility classes, and those are unchanged. A `<main>` carrying the same classes paints
 * the same pixels as the `<div>` did.
 *
 * ⚠ ONE CONSEQUENCE, STATED RATHER THAN HIDDEN: on `/privacy` and `/terms` the container that
 * becomes `<main>` CONTAINS `LegalHeader`'s `<header>`, and a `<header>` inside `main` is no longer
 * a `banner`. So those two pages trade one region holding 2% of the page for one holding 100% of
 * it. That block is a document title — the page name, the date, the way back — not site chrome;
 * `Landing`'s sticky top bar is what a banner is for, and it keeps its own.
 *
 * ── WHAT THIS FILE ASSERTS ───────────────────────────────────────────────────────────
 *
 * ⚠ THE INSTRUMENT IS CONTROLLED IN THE TEST, IN BOTH DIRECTIONS, BEFORE IT IS POINTED AT THE
 * PRODUCT. A counter that reports zero is indistinguishable from a page with nothing to report —
 * this queue's oldest trap, and this instrument's first version fell into the mirror image of it:
 * it counted a `<style>` element's keyframes as uncovered text and reported `/marketing`, which is
 * correctly structured, at 9%. So `outsideLandmark` is run against a synthetic DOM first: text
 * outside a region must be counted, the same text inside one must not, and `<style>` text must be
 * ignored wherever it sits.
 *
 * ⚠ AND EVERY CASE CARRIES A FLOOR. "0 characters outside a landmark" is also what a page that
 * rendered NOTHING reports. Each address asserts it drew a plausible amount of text first, so a
 * blank screen fails instead of passing perfectly.
 *
 * ⚠ THE PUBLIC ROUTE SET IS DERIVED FROM `App.tsx`, NOT LISTED HERE FROM MEMORY. Every literal
 * `<Route path="…">` in that file — the only place a public page can be declared — must appear
 * below, so a sixth public surface cannot be added without this sweep noticing.
 */

const LANDMARK_SELECTOR = [
  'main',
  '[role="main"]',
  'header',
  '[role="banner"]',
  'nav',
  '[role="navigation"]',
  'footer',
  '[role="contentinfo"]',
  'aside',
  '[role="complementary"]',
  'form[aria-label]',
  'form[aria-labelledby]',
  '[role="form"]',
  '[role="search"]',
].join(', ')

const NOT_READABLE = ['SCRIPT', 'STYLE', 'TEMPLATE']

/**
 * `<header>` and `<footer>` map to banner/contentinfo ONLY when they are not inside
 * main/article/section/aside/nav — so a nested one is not a region and must not be credited with
 * covering anything.
 */
function landmarksIn(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll(LANDMARK_SELECTOR)).filter((el) => {
    if (el.tagName !== 'HEADER' && el.tagName !== 'FOOTER') return true
    return !el.parentElement?.closest('main, article, section, aside, nav')
  })
}

/** Characters of readable text with no landmark ancestor, and a sample of where they are. */
function outsideLandmark(root: HTMLElement): { total: number; outside: number; samples: string[] } {
  const landmarks = landmarksIn(root)
  let total = 0
  let outside = 0
  const samples: string[] = []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = (node as Text).parentElement
    if (parent && NOT_READABLE.includes(parent.tagName)) continue
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    total += text.length
    if (!landmarks.some((l) => l.contains(node as Node))) {
      outside += text.length
      if (samples.length < 4) samples.push(text.slice(0, 48))
    }
  }
  return { total, outside, samples }
}

/** The interactive controls with no landmark ancestor. */
function controlsOutside(root: HTMLElement): string[] {
  const landmarks = landmarksIn(root)
  return Array.from(root.querySelectorAll('button, a[href], input, select, textarea'))
    .filter((c) => !landmarks.some((l) => l.contains(c)))
    .map((c) => `<${c.tagName.toLowerCase()}> ${(c.textContent ?? '').trim().slice(0, 30)}`)
}

const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '')

/** The public addresses, checked against App.tsx below rather than trusted. */
const PUBLIC = ['/marketing', '/privacy', '/terms', '/signup', '/signin'] as const
/** `/*` is the gate itself and `*` is the not-found page INSIDE the shell; both are swept as gated. */
const NOT_A_PUBLIC_PAGE = ['/*', '*']

/** Text floors: below this a page did not render, and "0 outside" would be vacuous. */
const FLOOR = 100

function mockBff(authenticated: boolean) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      const body = authenticated
        ? { mode: 'disabled', authenticated: false, user: null }
        : { mode: 'oidc', authenticated: false, user: null, signup_open: true }
      return new Response(JSON.stringify(body), {
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

describe('the instrument, before it is pointed at the product', () => {
  const dom = (html: string) => {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    return root
  }

  it('counts readable text that sits outside every region', () => {
    const root = dom('<main>inside</main><p>orphaned</p>')
    expect(outsideLandmark(root).outside, 'text outside a landmark was not counted').toBe(
      'orphaned'.length,
    )
  })

  it('counts none of the same text once a region contains it', () => {
    const root = dom('<main>inside<p>orphaned</p></main>')
    expect(
      outsideLandmark(root).outside,
      'text INSIDE a landmark was counted as outside one — the instrument reports every page as ' +
        'broken and its zeroes mean nothing',
    ).toBe(0)
  })

  it('ignores style and script text wherever it sits', () => {
    const root = dom('<style>@keyframes x { from { opacity: 0 } }</style><main>seen</main>')
    expect(
      outsideLandmark(root).outside,
      'a <style> block was counted as page text — this is exactly how the first version of this ' +
        'instrument reported /marketing, which is correctly structured, at 9% uncovered',
    ).toBe(0)
  })

  it('does not credit a <header> nested inside main with covering anything', () => {
    const root = dom('<main><header>title</header></main><p>orphaned</p>')
    expect(
      outsideLandmark(root).outside,
      'a nested <header> is not a banner region; crediting it would let a page claim coverage it ' +
        'does not have',
    ).toBe('orphaned'.length)
  })
})

describe('every public surface puts its content in a landmark region', () => {
  beforeEach(() => mockBff(true))

  it('the public addresses swept here are exactly the ones App.tsx declares', () => {
    const app = blankComments(readFileSync(resolve(__dirname, 'App.tsx'), 'utf8'))
    const declared = Array.from(app.matchAll(/path="([^"]+)"/g))
      .map((m) => m[1])
      .filter((p) => !NOT_A_PUBLIC_PAGE.includes(p))
      .map(addressOf)
      .sort()
    expect(
      declared,
      'App.tsx declares a public route this file does not sweep (or sweeps one it no longer ' +
        'declares) — a surface added outside the gate would silently escape the coverage check',
    ).toEqual([...PUBLIC].sort())
  })

  for (const address of PUBLIC) {
    it(`${address} has no text outside a landmark`, async () => {
      window.history.pushState({}, '', address)
      render(<App />)
      await screen.findByRole('heading', { level: 1 })

      const { total, outside, samples } = outsideLandmark(document.body)
      expect(
        total,
        `${address} rendered ${total} characters of text, which is less than this page has — ` +
          'a page that drew nothing reports perfect coverage, so the assertion below would be ' +
          'vacuous',
      ).toBeGreaterThan(FLOOR)
      expect(
        outside === 0 ? [] : samples,
        `${address} has ${outside} of ${total} characters of text in NO landmark region. ` +
          'Landmark navigation cannot reach it and "skip to the main content" has no target.',
      ).toEqual([])
      expect(
        controlsOutside(document.body),
        `${address} has interactive controls in no landmark region`,
      ).toEqual([])
    })
  }
})

describe('the refused-session card is a STATE, not an address, and no sweep saw it', () => {
  beforeEach(() => mockBff(false))

  for (const route of CONSOLE_ROUTES.slice(0, 3)) {
    const address = addressOf(route.path)
    it(`refused at ${address}: the card renders inside a landmark region`, async () => {
      window.history.pushState({}, '', address)
      render(<App />)
      // The gate's own words, from the shared SignInCard — proof this is the refused card and not
      // the page, so "0 outside" cannot come from a screen that never appeared.
      await screen.findByText(/Sign in to Talyvor/i)

      const { total, outside, samples } = outsideLandmark(document.body)
      expect(
        total,
        `the refused card at ${address} rendered ${total} characters — too few to be the card, so ` +
          'the coverage reading below would be a fact about an empty page',
      ).toBeGreaterThan(FLOOR)
      expect(
        outside === 0 ? [] : samples,
        `the card that replaces ${address} for every person without a session has ${outside} of ` +
          `${total} characters in NO landmark region — this is the most-seen screen in the ` +
          'product for a signed-out reader, and it is reachable only by reading from the top',
      ).toEqual([])
    })
  }
})

describe('the gated console, which is the reference the five surfaces failed to meet', () => {
  beforeEach(() => mockBff(true))

  for (const route of CONSOLE_ROUTES) {
    const address = addressOf(route.path)
    it(`${address} keeps 100% of its text inside a region`, async () => {
      window.history.pushState({}, '', address)
      render(<App />)
      await screen.findByRole('navigation', { name: /sections/i })

      const { total, outside, samples } = outsideLandmark(document.body)
      expect(total, `${address} rendered ${total} characters`).toBeGreaterThan(FLOOR)
      expect(
        outside === 0 ? [] : samples,
        `${address} has ${outside} of ${total} characters outside every landmark — the Shell's ` +
          'aside/nav/header/main no longer cover the page',
      ).toEqual([])
    })
  }
})
