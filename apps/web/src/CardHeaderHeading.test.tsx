import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Card, CardHeader, MuNumeral } from '@talyvor/ui'

import { App, CONSOLE_ROUTES } from './App'

/**
 * EVERY SECTION TITLE BEHIND THE GATE WAS A `<div>`, ON PAGES WITH UP TO NINE OF THEM.
 *
 * `a19c18f` (#126) measured that the signed-in console rendered ZERO heading elements and fixed
 * it by promoting the page name to `<h1>`. It stopped there. MEASURED IN REAL CHROME on the
 * built artifact at `397b11d`, one level down, across the ten top-level gated addresses:
 *
 *     address     heading elements     cards on the page
 *     /                   1                   6
 *     /setup              1                   9
 *     /spend              1                   3
 *     /settings           1                   2
 *     /ledger /billing /keys /members /track /docs   1 each, 1 card each
 *
 * Forty elements carry `text-head` — the token whose own definition in preset.ts reads "a card
 * header and the shell title bar". Ten are the page `<h1>`, ten are the sidebar wordmark, and
 * the remaining TWENTY are card headers. Not one of them was a heading element. So on /setup, a
 * screen-reader user pressing H got "Setup" and then nothing, on a page with nine titled
 * sections; the headings rotor listed one entry for the whole screen.
 *
 * ⚠ THE PRODUCT HAD ALREADY DECIDED THE ANSWER, ON THE PAGES A STRANGER SEES. `legalParts.tsx`
 * writes its section titles `<h2 className="text-head text-ink">`, which is why the same census
 * reads `1>2>2>2>2>2>2>2` on /privacy and `1>2>2>…` on /terms while every screen behind the gate
 * reads `1`. The rule is this product's own; it had been applied to the two legal documents and
 * to nothing else.
 *
 * ⚠ ONE SEAM, THIRTY-NINE CALL SITES. Every card header in the console goes through
 * `CardHeader` in packages/ui — Card.tsx emitted one `<div className="text-head text-ink">` and
 * that div is on 39 call sites across Lens, Track and Docs. The fix is the element, not the
 * classes: preflight sets `h1,…,h6{font-size:inherit;font-weight:inherit}` and `…{margin:0}`,
 * which is exactly why #126's promotion was byte-identical, and it is why this one is too.
 *
 * ⚠ `text-head` IS NOT THE RULE, AND THE LAST TWO CASES REFUSE THE OBVIOUS OVER-CORRECTION.
 * Two other things wear that token and neither is a section title: the sidebar wordmark
 * ("Talyvor", a brand mark that names the product, not a region) and `MuNumeral`'s whole-number
 * span (a FIGURE — a heading element around a balance would put "2,350" in the rotor). A sweep
 * written as "everything carrying text-head is a heading" would pass this file's other cases and
 * be wrong; it is asserted from the other side instead.
 *
 * ⚠⚠ AND THAT REFUSAL TOOK TWO DRAFTS, BOTH CAUGHT BY CONTROLS RATHER THAN BY READING.
 * The first was `querySelectorAll('span.text-head')` asserting each was a SPAN — constant-true,
 * because the moment one BECAME a heading it left the selector and the loop ran over what was
 * left. The second was a heading COUNT at `/`, which is not dodgeable — and still scored 0 red,
 * because this file's BFF fake 404s the balance reads, so no `MuNumeral` renders at ANY address
 * here. An address-shaped assertion cannot see a component the fixture never mounts. The figure
 * is rendered directly for that reason, and the count is over the render.
 *
 * ⚠ NOT CLAIMED, AND NOT MEASURED: whether a card header should ever be an `h3`. On
 * `/track/issues/<id>` the outline now reads h1 → h2 → h2 → h2 → h2 — the issue title and then
 * its three cards, which are sections OF that issue and would be h3 in an outline that named
 * the relationship. No level is SKIPPED, which is the defect ConsoleDeepHeading.test.tsx exists
 * to catch and still catches; the cards simply sit beside the title rather than under it.
 * Giving `CardHeader` a level is an API decision across 39 call sites and is not made here.
 */

/** Address (what a person types) from a route path (what `<Route path>` takes). */
const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '')

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      // disabled mode: the gate passes straight through, which is the signed-in shell.
      return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

async function at(address: string) {
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

/**
 * The card headers ON the page, located STRUCTURALLY rather than by tag — the whole point is
 * that the tag is what is under test, so a selector naming it would answer its own question.
 * `CardHeader` renders one bordered row (`border-b border-rule px-gutter py-2.5`) whose single
 * child carries `text-head text-ink`; that child is the title element.
 */
function cardHeaderTitles(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('div.border-b.border-rule > .text-head'))
}

/**
 * THE CENSUS, PER ADDRESS — the record of the margin above the floor below, and the thing four
 * screen-rebuild items are told to reason from.
 *
 * It is a CONSTANT that a test compares to a measurement, not a sentence in a comment, because
 * the comment that used to hold this number said "20 card headers" and was wrong the day it was
 * written: the same instrument, run at `b17a6ac` (the commit that wrote it), reads 24. It then
 * drifted a second time — `1b58635` (#251, W1.7) added `FeatureSpendCard`, giving /spend a fourth
 * header — and nothing said so, because nothing could.
 *
 * ⚠ A ROW CHANGING IS NOT A DEFECT. A screen rebuild that adds or removes a card is expected to
 * update its row; the failing test prints the whole measured table to paste. What is a defect is
 * the number being wrong while every reader believes it. And the red arrives in the FIRST such
 * merge's own CI rather than in main after the second, which is the failure W0.3 named.
 */
const CARD_HEADER_CENSUS: Readonly<Record<string, number>> = {
  '/': 6,
  '/ledger': 1,
  // ⚠ 0 IS STRUCTURAL HERE, NOT THE 404-FIXTURE FLOOR W1.1.17b WARNS ABOUT. /chat renders no
  // Card at all — it is built from Region, and its two regions carry their own headings. A
  // reader comparing this row with /docs's 0 should know they mean different things.
  '/chat': 0,
  '/billing': 2,
  '/billing/success': 0,
  '/billing/cancel': 0,
  '/keys': 2,
  '/setup': 5,
  // 4, not 3: `1b58635` (#251) added `FeatureSpendCard` — "Spend by feature". The card arrived as
  // a NEW FILE that Spend.tsx renders, so `grep -c '<CardHeader' Spend.tsx` reads 2 before and
  // after and would have argued the opposite.
  '/spend': 4,
  '/members': 1,
  '/settings': 2,
  '/track': 2,
  // 0, not 1: W1.1.9 rebuilt the `/docs` front door as REGIONS, so the one card header this
  // address had — the "Spaces" card the whole screen sat inside — became a named landmark whose
  // accessible name is the region's eyebrow. ⚠ THE OTHER TWO CARDS AT THIS ADDRESS (AskAI,
  // SearchDocs) ARE NOT COUNTED HERE AND NEVER WERE, and the reason is worth writing down because
  // it makes this row look wrong: both are gated on the spaces read SUCCEEDING, and this file's
  // fixture answers 404 to everything, so the census has always measured the OFF state of /docs.
  // A row of 0 therefore means "the off state of this screen has no cards", not "this screen has
  // no cards". The total across all twelve is 25 (it was 26 before this merge); the floor below
  // is 15.
  '/docs': 0,
}

beforeEach(mockBff)
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('a card header is a section title, so it is a heading element', () => {
  it('CardHeader emits a heading, not a div', () => {
    render(
      <Card>
        <CardHeader>Recent activity</CardHeader>
      </Card>,
    )
    const title = screen.getByText('Recent activity')
    expect(
      title.tagName,
      'CardHeader is the ONE seam every section title behind the gate goes through. As a `div` ' +
        'it is an anonymous box to assistive technology: /setup renders nine of them and the ' +
        'headings rotor listed one entry for the page.',
    ).toBe('H2')
    // The element moved, the type did not: `.text-head` supplies the size either way, and
    // preflight neutralises a heading's own font-size, weight and margin.
    expect(title.className).toContain('text-head')
    expect(title.className).toContain('text-ink')
  })

  it('h2 is the right LEVEL — it sits under the page name the shell already writes', async () => {
    await at('/setup')
    const h1s = document.querySelectorAll('h1')
    expect(h1s.length, 'the shell writes exactly one h1 per address (#126, #127)').toBe(1)
    const titles = cardHeaderTitles(document.body)
    expect(titles.length, '/setup renders nine cards; a sweep that found none would be vacuous').toBeGreaterThan(4)
    for (const t of titles) {
      expect(
        t.tagName,
        `"${t.textContent?.trim()}" on /setup is a section title under "${h1s[0].textContent?.trim()}" ` +
          'and must be a heading one level down — not two (a skipped level is its own defect) and ' +
          'not none',
      ).toBe('H2')
    }
  })

  it.each(CONSOLE_ROUTES.map((r) => addressOf(r.path)))(
    '%s renders every card header it has as a heading',
    async (address) => {
      await at(address)
      const titles = cardHeaderTitles(document.body)
      for (const t of titles) {
        expect(t.tagName, `"${t.textContent?.trim()}" at ${address} is a card header rendered as <${t.tagName.toLowerCase()}>`).toBe('H2')
      }
      // Recorded per address so the sweep cannot go quietly vacuous everywhere at once; the
      // floor across the whole set is the next case.
      expect(Number.isInteger(titles.length)).toBe(true)
    },
  )

  it('the census is the number, not a remembered one — per address, and complete', async () => {
    const measured: Record<string, number> = {}
    for (const route of CONSOLE_ROUTES) {
      const address = addressOf(route.path)
      await at(address)
      measured[address] = cardHeaderTitles(document.body).length
      document.body.replaceChildren()
    }
    const table = (t: Record<string, number>) =>
      Object.entries(t)
        .map(([a, n]) => `      ['${a}', ${n}],`)
        .join('\n')

    // Every address must have a row and every row an address: a route added without a census row
    // is the case where a number "still reads right" because it silently stopped covering a page.
    const routes = CONSOLE_ROUTES.map((r) => addressOf(r.path)).sort()
    const declared = Object.keys(CARD_HEADER_CENSUS).sort()
    expect(
      declared,
      'CARD_HEADER_CENSUS and CONSOLE_ROUTES describe different address sets. Paste the measured ' +
        `census:\n${table(measured)}`,
    ).toEqual(routes)

    for (const address of routes) {
      expect(
        measured[address],
        `${address} renders ${measured[address]} card headers; CARD_HEADER_CENSUS says ` +
          `${CARD_HEADER_CENSUS[address]}. One of the two is stale — re-derive, do not guess. ` +
          `Measured census:\n${table(measured)}`,
      ).toBe(CARD_HEADER_CENSUS[address])
    }
  })

  it('the sweep actually reaches card headers — a floor over the whole gated set', async () => {
    // The floor is the SECOND instrument, and deliberately independent of the census above: it
    // survives a census row being wrong, and it is what catches a selector that stopped matching
    // — the failure mode a per-address assertion cannot see, because it makes every case pass by
    // finding nothing. The margin above it is CARD_HEADER_CENSUS's total, which is checked rather
    // than remembered; the number that used to live in this comment said 20 and was never true.
    let found = 0
    for (const route of CONSOLE_ROUTES) {
      await at(addressOf(route.path))
      found += cardHeaderTitles(document.body).length
      document.body.replaceChildren()
    }
    expect(
      found,
      'the card-header selector matched (almost) nothing across every gated address — the sweep ' +
        'above is passing because it has no subject, not because the product is right',
    ).toBeGreaterThan(15)
  })

  it('nothing ELSE on the page became a heading — the over-correction this file refuses', async () => {
    // The over-correction: `text-head` is a SIZE, a heading is a STRUCTURE, and two other things
    // wear that token — the sidebar wordmark and MuNumeral's whole-number span.
    //
    // ⚠ THIS IS A COUNT, AND THE FIRST DRAFT WAS A TAG FILTER THAT COULD NOT FAIL. It read
    // `querySelectorAll('span.text-head')` and asserted each was a SPAN — so the moment one
    // BECAME a heading it left the selector, the loop ran over what was left, and the case
    // passed. Control C3 (scripts/w11-card-heading-controls.py) turned MuNumeral's figure into
    // an `<h2>` and scored 0 red. A selector that filters on the property under test answers its
    // own question; the total is the thing that cannot be dodged.
    await at('/')
    const titles = cardHeaderTitles(document.body)
    expect(titles.length, '/ renders six cards; a count against zero would prove nothing').toBeGreaterThan(4)
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    // ⚠ W1.1.1 PUT A SECOND KIND OF HEADING ON THIS ADDRESS, and it is NAMED here rather than
    // absorbed into a looser count. Overview now opens with its own heading at the page scale —
    // `text-page`, the console's one display step (W1.1.0; it was `text-title`) — because the
    // screen had no heading of its own at
    // all: the sticky banner said "Overview" and six anonymous panels followed it. That heading is
    // a section title (it names the region the screen opens with), so it belongs in the rotor; a
    // balance, a wordmark or a badge still does not, which is what the total below refuses.
    const pageScale = headings.filter((h) => h.className.includes('text-page'))
    expect(
      pageScale.map((h) => h.tagName),
      'the screen opens with exactly ONE page-scale heading and it is an h2 — two would be a ' +
        'second claim about what the page is, and an h1 would be a second page name',
    ).toEqual(['H2'])
    expect(
      headings.map((h) => `${h.tagName}:${h.textContent?.trim().slice(0, 24)}`),
      'the console shell writes exactly one h1, the screen writes one page-scale heading and every ' +
        'card header is an h2, so the page holds exactly that many headings. A different number ' +
        'means something that is not a section title has entered the headings rotor — a balance, ' +
        'a wordmark, a badge.',
    ).toHaveLength(1 + pageScale.length + titles.length)
    const wordmark = Array.from(document.querySelectorAll('.text-head')).find(
      (e) => e.textContent?.trim() === 'Talyvor',
    )
    expect(wordmark, 'the sidebar wordmark is gone — this case no longer measures anything').toBeTruthy()
    expect(
      wordmark!.tagName,
      'the wordmark names the PRODUCT, not a region of this page. As a heading it would appear in ' +
        'the rotor on every screen, above the page name, as a section nobody can navigate to.',
    ).not.toMatch(/^H[1-6]$/)
  })

  it('a money FIGURE wearing the head step is not a heading either', () => {
    // ⚠ MEASURED SEPARATELY BECAUSE THE ADDRESS SWEEP CANNOT REACH IT. The console's balances
    // come from the BFF, and this file's fake answers /auth/me and 404s everything else — so no
    // `MuNumeral` renders at any address here, and control C3 (turn its whole-number span into
    // an `<h2>`) scored ZERO red against the count above. That is a fact about the fixture, not
    // about the product: the component is rendered directly instead, and the assertion is a
    // COUNT over the render rather than a filter on its tag.
    render(<MuNumeral micros={2_350_340_567} unit="lxc" />)
    const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6')
    expect(
      Array.from(headings).map((h) => h.textContent?.trim()),
      'a balance is a FIGURE, not a section title. As a heading it enters the rotor — a reader ' +
        'moving by heading would land on "2,350" as if it named a region of the page.',
    ).toEqual([])
  })
})
