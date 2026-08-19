import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { blankComments } from '../../../packages/ui/src/lib/sourceText'
import { App, CONSOLE_ROUTES } from './App'

/**
 * ConsoleDeepHeading.test.tsx — `/track/issues/<id>` RENDERED TWO `<h1>` ELEMENTS, AND IT IS THE
 * ONE ADDRESS IN THE PRODUCT THE NEW HEADING SWEEP CANNOT REACH.
 *
 * ── WHAT WAS MEASURED, IN THE DOM, WITH THE ISSUE ACTUALLY SERVED ────────────────────
 *
 * A throwaway probe drove the real `<App />` to every address BELOW the twelve in
 * `CONSOLE_ROUTES`, with a BFF fake that answers the area's own reads, and counted
 * `document.querySelectorAll('h1')`:
 *
 *     /track/issues/iss-1              h1 = 2   "Track" | "Cache stampede on cold start"
 *     /docs/spaces/sp-1                h1 = 1   "Docs"
 *     /docs/spaces/sp-1/pages/pg-1     h1 = 1   "Docs"
 *
 * ⚠ THE ISSUE HAD TO BE SERVED FOR THE DEFECT TO EXIST AT ALL. The same address with a 404-ing
 * fake counts h1 = 1: IssueDetail renders "That issue could not be read." and its heading never
 * mounts. A census taken against a failing BFF would have reported this page clean, which is why
 * the premise case below asserts the issue's title is on the screen before anything counts
 * headings — an instrument that read an error card cannot see this.
 *
 * ── WHY TWO IS THE DEFECT, AND WHY THIS IS NOT A NEW DESIGN DECISION ─────────────────
 *
 * `a19c18f` (#126) promoted the banner's page name from a `<div>` to the console's one heading,
 * because a probe over all twelve `CONSOLE_ROUTES` addresses had counted ZERO heading elements
 * behind the gate. `ConsoleHeading.test.tsx` pins that at each of the twelve and says why one is
 * the number: "two top-level headings on one screen is a second claim about what the page is."
 *
 * `/track/issues/<id>` matches `/track/*`, so it gets the same banner `<h1>` ("Track") — and
 * IssueDetail has carried an `<h1>` of its own since `776b5aa` (#83), the merge that made an issue
 * openable at all, which is 43 merges before the banner became a heading. The address is
 * DEEPER than any entry in `CONSOLE_ROUTES`, so the sweep that adopted the rule cannot see the one
 * page that breaks it. #126 wrote this down as unmeasured; this file is the measurement.
 *
 * The rule is the repo's own, already merged and already enforced twelve times. Applying it to the
 * thirteenth address is not a session inventing a preference.
 *
 * ── THE FIX IS A LEVEL, NOT AN ELEMENT, AND IT IS MEASURED ZERO-PIXEL ────────────────
 *
 * IssueDetail's heading keeps its text, its classes and its position; it becomes `<h2>`. The
 * outline at that address is then h1 "Track" → h2 "<issue title>", which is what the screen has
 * always shown: the issue is a thing INSIDE Track, not a second page.
 *
 * Read out of the BUILT artifact (`dist/assets/index-psvODmTs.css`, sha256 6ac40c1be2bc…, 22,420
 * bytes) rather than assumed from what Tailwind is believed to emit — every rule in the shipped
 * sheet whose selector list carries any of `h1`…`h6` as a token:
 *
 *     h1,h2,h3,h4,h5,h6                        { font-size:inherit; font-weight:inherit }
 *     blockquote,dl,dd,h1,…,h6,hr,figure,p,pre { margin:0 }
 *
 * Both name h1 and h2 in the same selector list, and there is no h1-only or h2-only rule anywhere
 * in the sheet. `.text-title` supplies 24px/1.2/640 either way, so the two elements paint the same
 * pixels and the stylesheet cannot change.
 *
 * ── WHAT THIS FILE ASSERTS, AND THE HOLE IT CLOSES BEHIND ITSELF ─────────────────────
 *
 * A pinned list of deep addresses is a CURATED list, and a curated list cannot ask "is there a
 * page nobody named" — the `4195fba`/#91 lesson, still live. So the DOM sweep is paired with a
 * SOURCE CENSUS over the three area directories the console's routes are served from: no file
 * that renders inside the console shell may contain an `<h1>`, because the shell already provides
 * the page's one heading. A new console page that ships its own `<h1>` fails that census even
 * though no address in this file visits it.
 *
 * ⚠ THE CENSUS IS POSITIVE-CONTROLLED INSIDE THE TEST, in the direction that matters. A matcher
 * that finds nothing is indistinguishable from a product with nothing to find — this queue's
 * oldest trap. So the same matcher is run over `src/areas/auth`, whose three `<h1>`s are CORRECT
 * (those pages render outside the shell and have no banner), and it must find them. An empty
 * console census is only evidence because the same instrument is non-empty one directory over.
 *
 * ⚠ ITS LIMITS, STATED. The census reads JSX literally, with comments blanked (`blankComments`),
 * so a heading built as `createElement('h1')` or `<Tag>` with a computed tag would pass it — the
 * DOM sweep is what covers the addresses it visits. The scanned directories ARE a written-down
 * list — but it is a CHECKED one: every `CONSOLE_ROUTES` component must be exported from inside it,
 * asserted below, so a page moved out of them fails loudly instead of quietly leaving the census.
 *
 * ⚠ WHAT IS NOT CLAIMED. This gives the deep Track address ONE top-level heading and a correct
 * two-level outline. It does NOT give the console a heading outline generally.
 *
 * ⚠ AND THAT PARAGRAPH USED TO END "so the cards' own titles ('Description', 'Details', 'Status')
 * are anonymous `<div>`s and 'navigate by heading' still reaches the page and stops there. Giving
 * the console an outline means making a shared component render a heading, and that is not this
 * file." THAT DECISION WAS TAKEN AFTERWARDS AND THIS PARAGRAPH DID NOT HEAR: `CardHeader` renders
 * a heading today, which is exactly why the outline assertion below is a six-element literal and
 * not `[1, 2]`. The two halves of this one file disagreed — the prose said the cards are divs
 * while the comment on the assertion said they stopped being divs. Corrected in place rather than
 * left, because a stale claim next to the assertion that falsifies it is worse than no claim.
 * What is still true is the narrower sentence: the outline is FLAT (h1 → h2 → h2), so heading
 * navigation reaches the cards but not their relationship — see the ⚠ on the assertion below.
 */

/** Address (what a person types) from a route path (what `<Route path>` takes). */
const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '')

/**
 * The addresses BELOW the console's twelve, and what the one `<h1>` must say at each.
 *
 * The name is the page the banner is on — Track, Docs — not the row you opened, because the
 * banner is what titles the browser tab and the landmark. The issue's own title is asserted
 * separately, as the h2 it should be.
 */
const ISSUE_TITLE = 'Cache stampede on cold start'

const DEEP: ReadonlyArray<{ address: string; h1: string; parent: string; renders: string }> = [
  { address: '/track/issues/iss-1', h1: 'Track', parent: '/track/*', renders: ISSUE_TITLE },
  { address: '/docs/spaces/sp-1', h1: 'Docs', parent: '/docs/*', renders: 'Engineering' },
  { address: '/docs/spaces/sp-1/pages/pg-1', h1: 'Docs', parent: '/docs/*', renders: 'Runbook' },
]

const ISSUE = {
  id: 'iss-1',
  workspace_id: 'ws1',
  team_id: 'team-1',
  number: 7,
  identifier: 'ENG-7',
  title: ISSUE_TITLE,
  description: 'Original description.',
  status: 'in_progress',
  priority: 3,
  assignee_id: undefined as string | undefined,
  creator_id: 'u-1',
  lens_feature: '',
  ai_cost_usd: 0.4213,
  ai_tokens: 18342,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

/**
 * A BFF fake that ANSWERS the deep pages' own reads. A 404-ing fake renders the "could not be
 * read" card at `/track/issues/iss-1`, whose h1 count is 1 — the clean reading, from a page that
 * never drew the heading. The fixture is the instrument here.
 */
function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input)
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    if (path === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (path === '/api/members')
      return json([
        { id: 'u-1', name: 'Ada' },
        { id: 'u-2', name: 'Grace' },
      ])
    if (path === '/api/track/teams')
      return json([{ id: 'team-1', identifier: 'ENG', name: 'Engineering' }])
    if (path.endsWith('/comments')) return json([])
    if (path === '/api/track/issues/iss-1') return json(ISSUE)
    if (path.startsWith('/api/track/issues')) return json([ISSUE])
    if (path === '/api/docs/spaces') return json([{ id: 'sp-1', key: 'ENG', name: 'Engineering' }])
    if (path === '/api/docs/spaces/sp-1')
      return json({ id: 'sp-1', key: 'ENG', name: 'Engineering' })
    if (path === '/api/docs/spaces/sp-1/pages')
      return json([{ id: 'pg-1', space_id: 'sp-1', title: 'Runbook', parent_id: null }])
    if (path === '/api/docs/spaces/sp-1/pages/pg-1')
      return json({ id: 'pg-1', space_id: 'sp-1', title: 'Runbook', body: '', updated_at: '' })
    return new Response('null', { status: 404 })
  })
}

/**
 * Drive the real `<App />` to an address and wait for the PAGE'S OWN CONTENT, not just the shell.
 * Waiting on the nav alone settles while the area is still loading, and a page that has not drawn
 * its heading yet counts the same as a page that has none.
 */
async function at(address: string, renders: string) {
  window.history.pushState({}, '', address)
  render(<App />)
  // The gate probes /auth/me before the shell exists; the nav is the shell's settled state.
  await screen.findByRole('navigation', { name: /sections/i })
  await screen.findAllByText(renders)
}

beforeEach(mockBff)
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('the addresses below the console still have exactly one top-level heading', () => {
  it('every deep address is served by a splat route in CONSOLE_ROUTES, and is deeper than the twelve', () => {
    const splats = CONSOLE_ROUTES.map((r) => r.path).filter((p) => p.endsWith('/*'))
    const swept = CONSOLE_ROUTES.map((r) => addressOf(r.path))
    for (const { address, parent } of DEEP) {
      expect(
        splats,
        `${address} is pinned here as a deep address but ${parent} is not a splat route in ` +
          'CONSOLE_ROUTES — the banner would not name it and this sweep would be asserting ' +
          'against a page that no longer exists',
      ).toContain(parent)
      expect(
        swept,
        `${address} is one of the twelve addresses ConsoleHeading.test.tsx already sweeps — ` +
          'this file exists for the ones it cannot reach',
      ).not.toContain(address)
    }
  })

  for (const { address, renders } of DEEP) {
    it(`${address} draws its own content — otherwise the census reads a failure card`, async () => {
      window.history.pushState({}, '', address)
      render(<App />)
      await screen.findByRole('navigation', { name: /sections/i })
      // ⚠ THE `catch` IS THE POINT, and it was written after a control proved the need. A bare
      // `await findAllByText` THROWS Testing Library's own "unable to find an element" — so when
      // the fixture was blinded on purpose, this case failed with a message that never mentions
      // the fixture, and the sentence below (the only reason this case exists) was unreachable
      // decoration. Swallowing the lookup and asserting on the count is what lets it speak.
      const found = await screen.findAllByText(renders).catch(() => [])
      expect(
        found.length,
        `the BFF fake did not serve ${address}, so the area rendered its failure card instead of ` +
          'its content, and every heading count below would be a measurement of a page that was ' +
          'never drawn',
      ).toBeGreaterThan(0)
    })
  }

  for (const { address, h1, renders } of DEEP) {
    it(`${address} renders exactly one h1, and it names the page`, async () => {
      await at(address, renders)

      const h1s = Array.from(document.querySelectorAll('h1'))
      expect(
        h1s.map((h) => h.textContent),
        `${address} rendered ${h1s.length} <h1> elements, want exactly 1. Two top-level headings ` +
          'on one screen is a second claim about what the page is, and the banner already made ' +
          'the first one.',
      ).toEqual([h1])
    })
  }

  it('the issue title is the page’s h2 — inside Track, not a second page', async () => {
    await at('/track/issues/iss-1', ISSUE_TITLE)

    const heading = screen.getByRole('heading', { name: ISSUE_TITLE })
    expect(
      heading.tagName,
      'the issue title is a heading at the wrong level: the banner h1 says which page you are on ' +
        'and the issue is a thing inside it, so the outline must read h1 → h2',
    ).toBe('H2')

    const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
      Number(h.tagName.slice(1)),
    )
    // ⚠ NINE, NOT TWO, SINCE CardHeader BECAME A HEADING. The seven extra 2s are this page's
    // card headers — Search issues, Description, Details, AI summary, Possible duplicates,
    // Triage suggestion, Comments — which were
    // `<div>`s when this line read `[1, 2]` and are now section titles like every other card
    // header behind the gate. "AI summary" is Track's thread summary, the first browser control
    // for any Track AI feature (areas/track/AISummary.tsx); "Search issues" is the newest and is
    // the reason this outline is SEVEN rather than six — it is mounted at the TRACK AREA level,
    // not inside the list, so it is present on the ticket too (deliberately: the moment someone
    // wants the related issue is while they are reading one). areas/track/SearchIssues.tsx.
    // "Possible duplicates" is Track's find-duplicates AI, the third of its five features to
    // reach a browser and the one that costs per press (areas/track/FindDuplicates.tsx).
    // "Triage suggestion" is the fourth, and it is the reason this outline is NINE rather than
    // eight — the read half of a route whose write half this app deliberately cannot reach
    // (areas/track/TriageIssue.tsx, apps/bff/track_triage.go).
    //
    // ⚠ AND THE FLATNESS IS RECORDED RATHER THAN BLESSED. Description/Details/AI summary/Comments
    // are sections OF the issue, so an outline that named their relationship would read
    // h1 → h2 → h3. It reads h1 → h2 → h2: no level is SKIPPED (which is the defect this
    // assertion exists to catch, and it still catches one), but the three cards sit beside the
    // issue title rather than under it. Giving `CardHeader` a level would be an API decision
    // across 39 call sites and it was not made on the way past — see the ⚠ at the end of
    // CardHeaderHeading.test.tsx. The literal below is the outline as measured, so the day
    // somebody does make that decision this line is what tells them it moved.
    expect(
      levels,
      'the heading outline at /track/issues/<id> moved — a level was skipped, dropped or ' +
        'duplicated, or a card header stopped being one',
    ).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 2])
  })
})

/**
 * The census. `CONSOLE_ROUTES` names twelve components; each one is exported from one of these
 * directories, and that is asserted rather than assumed.
 */
const WEB_SRC = resolve(__dirname)
const CONSOLE_AREAS = ['areas/lens', 'areas/track', 'areas/docs'] as const
/** Renders OUTSIDE the shell, so its `<h1>`s are correct — the census's positive control. */
const OUTSIDE_THE_SHELL = 'areas/auth'

function tsxFilesUnder(dir: string): string[] {
  const root = resolve(WEB_SRC, dir)
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = resolve(d, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx') && !p.includes('.test.')) out.push(p)
    }
  }
  walk(root)
  return out
}

/** Every `<h1` that survives comment-blanking, as `path:line`. */
function h1CallSites(dirs: readonly string[]): string[] {
  const hits: string[] = []
  for (const dir of dirs) {
    for (const file of tsxFilesUnder(dir)) {
      blankComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (/<h1[\s/>]/.test(line)) hits.push(`${relative(WEB_SRC, file)}:${i + 1}`)
        })
    }
  }
  return hits
}

describe('no page inside the console shell renders its own h1', () => {
  it('every CONSOLE_ROUTES page is exported from one of the scanned directories', () => {
    const sources = CONSOLE_AREAS.flatMap((d) =>
      tsxFilesUnder(d).map((f) => readFileSync(f, 'utf8')),
    ).join('\n')
    for (const route of CONSOLE_ROUTES) {
      const name = (route.element.type as { name?: string }).name
      expect(name, `${route.path} renders an anonymous component, so it cannot be located`).toBeTruthy()
      expect(
        sources.includes(`export function ${name}`) || sources.includes(`export const ${name}`),
        `${route.path} renders <${name} />, which is not exported from any of ${CONSOLE_AREAS.join(
          ', ',
        )} — the census below would not read the file that page lives in`,
      ).toBe(true)
    }
  })

  it('the matcher finds the h1s that SHOULD exist one directory over', () => {
    // Inverted control: an empty console census means nothing unless this instrument is
    // demonstrably able to find an <h1> in a file that has one. The threshold is ONE, not the
    // three that live there today — a curated count would decay into a second thing to maintain,
    // and one hit is the whole claim being made here.
    expect(
      h1CallSites([OUTSIDE_THE_SHELL]),
      `the census found no <h1> under ${OUTSIDE_THE_SHELL}, whose sign-in and sign-up cards each ` +
        'render one — so the matcher is broken, or it read no files, and the empty console result ' +
        'below is not evidence of anything',
    ).not.toEqual([])
  })

  it('the console areas render none', () => {
    expect(
      h1CallSites(CONSOLE_AREAS),
      'a page served inside the console shell renders its own <h1>. The shell already gives every ' +
        'address one top-level heading (the banner names the page); a second one is a second claim ' +
        'about what the page is, and at a deep address no sweep in ConsoleHeading.test.tsx visits ' +
        'it. Use <h2> for a heading inside the page.',
    ).toEqual([])
  })
})
