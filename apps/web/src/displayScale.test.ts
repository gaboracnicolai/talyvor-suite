import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { stripComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * THE MARKETING SCALE STOPS AT THE GATE — the rule preset.ts wrote about itself and never swept for.
 *
 * `preset.ts` §DISPLAY declares six type steps for the public page and then states the boundary in
 * its own words:
 *
 *     ⚠ NOT FOR THE APP. Nothing behind the AuthGate should reach for these; if a console screen
 *     ever wants display type, that is a design conversation, not an import.
 *
 * MEASURED at `c71ca9c`, with every other design guard green: no test in either package so much as
 * NAMES `text-display-1..4` or `text-lede`, and one console surface had reached for them anyway —
 *
 *     apps/web/src/areas/track/IssueDetail.tsx:154
 *       <h1 className="text-display-3 text-ink">{it.title}</h1>
 *
 * `/track/*` is routed inside `<AuthGate>` in App.tsx, so that is a hero headline in a settings
 * screen — the exact outcome the comment above was written to prevent. Measured as RENDERED, not
 * merely as written (a MutationObserver over all 45 test files, 490 tests): 25 elements carry
 * `text-display-3`, 24 of them Landing's section headings across the four test files that render
 * the marketing page, and the 25th is this `<h1>`.
 *
 * ⚠ THE SIZE IS THE POINT, AND THE CONSOLE ALREADY HAD AN ANSWER. `display-3` is
 * clamp(23px, 3.2vw, 33px) at weight 500; the console scale tops out at `title` = 24px/640, and
 * the product writes its own document-title ramp down in `areas/docs/pm.tsx`:
 * h1 → `text-title`, h2 → `text-head`, h3 → `text-body font-semibold`. So a Docs page's own H1
 * rendered at 24px while a Track issue title rendered at up to 33px — two document titles, one
 * console, two scales, and the larger one sat on a baseline row beside its `TAL-1` identifier at
 * 12px. Fixed by using the answer that was already written, not by inventing a seventh step.
 *
 * ── WHY THIS READS THE ROUTER RATHER THAN A LIST OF SURFACES ─────────────────────────────────────
 *
 * "Behind the AuthGate" is a fact about ROUTING, and App.tsx states it exactly once: a root
 * `<Routes>` whose public entries sit beside one `<AuthGate>` route, and the shell `<Routes>`
 * inside it holding every console surface. A curated list of app files would guard the surfaces
 * someone thought of and say nothing about the next one (the #91 lesson), so both sets are derived
 * — the entry components are read out of those two blocks, and each set is closed over its own
 * local imports. A new console route is swept the moment it is routed, and a shared
 * `packages/ui` component lands in BOTH closures, which is correct: anything the app renders is
 * behind the gate no matter which package it lives in.
 *
 * ⚠ A DERIVED SWEEP CANNOT SEE WHAT IS NO LONGER THERE, so it is paired with floors that can:
 * the step classification is checked against `preset.ts` in BOTH directions (a new step fails
 * until it is classified as console or marketing, a deleted one fails as stale), the gated closure
 * must still reach named files, and the public hero must still render `text-display-1` — a rule
 * about a scale nobody uses any more is a rule about nothing, and it should say so rather than
 * pass.
 *
 * ⚠⚠ AND THAT PARAGRAPH WAS TRUE OF THE WRONG SET FOR THREE MERGES. It says "the gated closure
 * must still reach named files", which reads as cover for the sweep at the bottom of this file.
 * It was not: the floor and the sweep each built their OWN closure from a different reader, so the
 * floor vouched only for itself. `7513c91` emptied the reader the SWEEP used and every instrument
 * in both packages stayed green. Measured at `298b659` — floor 67 files, sweep 0. Both now read
 * one memoised `gatedFiles()` (§THE GATED CLOSURE below) and the sweep carries its own floor as
 * well, because the lesson is not "add a floor", it is "a floor over a set nobody else reads is a
 * fact about that set". Reproduced under control (scripts/w11-display-sweep-controls.py, C1c).
 */

const WEB_SRC = resolve(import.meta.dirname)
const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const APP = resolve(WEB_SRC, 'App.tsx')
const PRESET = resolve(UI_SRC, 'preset.ts')
const REPO = resolve(import.meta.dirname, '../../..')

const show = (f: string): string => relative(REPO, f)

/**
 * The console scale: the five steps a control panel needs, plus the eyebrow. Free everywhere —
 * the boundary this file polices is one-directional, so a public page may use console type.
 */
const CONSOLE_STEPS: Record<string, string> = {
  /**
   * ⚠ THE ONE FLUID STEP ON THIS SIDE OF THE GATE, and it is deliberately NOT a marketing step.
   *
   * The paragraph above ends "if a console screen ever wants display type, that is a design
   * conversation, not an import." W1.1.0 had that conversation and its answer was a console-owned
   * step — clamp(24px, 3vw, 38px), floored on `title` and ceilinged on `display-2` — rather than
   * letting `text-display-2` past this boundary. So the rule below is UNCHANGED in what it
   * refuses: the six marketing steps still stop here. `page` is on the free side because the
   * console owns it, and apps/web/src/pageScale.test.tsx is where its bounds are pinned.
   */
  page: 'the console’s one display step — the heading that opens a screen, clamp(24px, 3vw, 38px)',
  title: 'the top of the console ramp, 24px — what a document title renders at behind the gate',
  head: 'a card header and the shell title bar',
  body: 'the paragraph step, and by count the product',
  caption: 'the small label beside a value',
  micro: 'the µ-tail under a money figure',
  eyebrow: 'the one small uppercase label in the system',
}

/**
 * The marketing scale — preset.ts §DISPLAY, "⚠ NOT FOR THE APP". These six are what this file
 * refuses to find behind the gate.
 */
const MARKETING_STEPS: Record<string, string> = {
  'display-1': 'the hero, clamp(34px, 6vw, 58px)',
  'display-2': 'the closing line',
  'display-3': 'a section heading on the public page',
  'display-4': 'a sub-section heading on the public page',
  lede: 'the paragraph directly under a display heading',
  figure: 'a measured figure quoted at reading size — the ledger numbers on the public page',
}

/**
 * ⚠ `text-figure` IS A SIZE AND `font-figure` IS A FAMILY, and the whole product wears the family:
 * eight money surfaces render `font-figure`. A detector written as /figure/ would report every one
 * of them as a marketing-scale violation and this guard would have to be deleted to ship anything.
 * The `text-` prefix is load-bearing; the control below pins it.
 */
const MARKETING_RE = new RegExp(`\\btext-(?:${Object.keys(MARKETING_STEPS).join('|')})\\b`)

// ── THE ROUTER, READ ONCE ────────────────────────────────────────────────────────────────────────

const appSource = stripComments(readFileSync(APP, 'utf8'))

/** The `<Routes>` blocks App.tsx declares. Not nested, so a non-greedy scan is exact. */
const routeBlocks = [...appSource.matchAll(/<Routes>([\s\S]*?)<\/Routes>/g)].map((m) => m[1])
const rootBlock = routeBlocks.find((b) => /<AuthGate>/.test(b))
const shellBlock = routeBlocks.find((b) => !/<AuthGate>/.test(b))

/** Route elements are React components, so a capital initial — this skips the `<div>` catch-all. */
function routedComponents(block: string): string[] {
  return [...new Set([...block.matchAll(/element=\{<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))]
}

/**
 * THE CONSOLE'S ROUTES ARE NO LONGER JSX IN THE `<Routes>` BLOCK, and this guard found that out
 * the hard way — which is the argument for the floor it already carried.
 *
 * `w11-console-title` moved every gated page into a `CONSOLE_ROUTES` table so the router and the
 * header title could not hold two copies of the path list. The shell block then reads
 * `{CONSOLE_ROUTES.map(...)}` and `element={<X />}` matches NOTHING inside it. MEASURED, by
 * raising the floor until it printed the number: the gated closure is 65 files at `c9e1e8a`, was
 * 0 with the table in place and this reader absent, and is 65 again with it. The only reason
 * this test spoke instead of sweeping an empty set was `expect(gated.size).toBeGreaterThan(25)`.
 * A source-derived guard whose seam moves goes quiet, not red, unless something asserts it read
 * anything at all.
 *
 * Scoped by bracket matching rather than a global `element:` scan, so an `element:` written
 * anywhere else in App.tsx cannot enter the gated closure.
 */
function consoleRouteComponents(): string[] {
  // ⚠ ANCHORED ON THE ASSIGNMENT, NOT THE NAME. The first `[` after `CONSOLE_ROUTES` is the one
  // in its own TYPE — `readonly ConsoleRoute[]` — so `indexOf('[')` matched an empty pair and
  // this returned []. Measured: the floor two tests up caught it, which is the only reason the
  // wrong anchor is a paragraph here instead of a silent zero in the closure.
  const decl = /CONSOLE_ROUTES[^=]*=\s*\[/.exec(appSource)
  if (decl === null) throw new Error('App.tsx no longer declares CONSOLE_ROUTES — the router moved again; point this at its new shape rather than letting the closure empty.')
  const open = decl.index + decl[0].length - 1
  let depth = 0
  let close = -1
  for (let i = open; i < appSource.length; i++) {
    if (appSource[i] === '[') depth++
    else if (appSource[i] === ']' && --depth === 0) {
      close = i
      break
    }
  }
  if (close < 0) throw new Error('unbalanced brackets in App.tsx CONSOLE_ROUTES')
  const block = appSource.slice(open + 1, close)
  return [...new Set([...block.matchAll(/element:\s*<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))]
}

/** name → module specifier, from App.tsx's own imports. */
const importedFrom = new Map<string, string>()
for (const m of appSource.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
  for (const raw of m[1].split(',')) {
    const name = raw.trim().split(/\s+as\s+/).pop()?.trim()
    if (name) importedFrom.set(name, m[2])
  }
}

/**
 * A module specifier to a file in one of our two packages, or null for a dependency we do not own.
 * ⚠ A LOCAL SPECIFIER THAT DOES NOT RESOLVE THROWS rather than returning null: the usual way a
 * file-reading guard goes quiet is a moved path turning its sweep into an empty set.
 */
function resolveModule(spec: string, fromFile: string): string | null {
  if (/\.(css|svg|png|jpg|json)$/.test(spec)) return null
  let base: string
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else if (spec === '@talyvor/ui') base = resolve(UI_SRC, 'index.ts')
  else if (spec.startsWith('@talyvor/ui/')) base = resolve(UI_SRC, spec.slice('@talyvor/ui/'.length))
  else return null
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  throw new Error(`${show(fromFile)} imports '${spec}', which resolves to no file. Fix the path — a sweep that cannot follow an import silently stops sweeping.`)
}

/** Every source file reachable from `entries` by local import. `export … from` counts as one. */
function closure(entries: string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...entries]
  while (stack.length > 0) {
    const file = stack.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const next = resolveModule(m[1], file)
      if (next !== null && !seen.has(next)) stack.push(next)
    }
  }
  return seen
}

/**
 * THE GATED CLOSURE, DEFINED ONCE — and the reason that is a rule rather than a tidy-up.
 *
 * This file used to spell "behind the gate" TWICE: the floor test unioned the JSX reader with the
 * `CONSOLE_ROUTES` reader, and the sweep at the bottom used the JSX reader alone. `8555e1e` (#97)
 * wrote both when they meant the same thing. `7513c91` (#108) moved every console page into the
 * `CONSOLE_ROUTES` table, which empties the JSX reader — `git log -L` on the sweep line shows it
 * was never touched again — and from that merge on the sweep ran over ZERO files. MEASURED at
 * `298b659`, three merges later: the floor test's closure was 67 files and the sweep's was 0, so
 * `expect(offenders).toEqual([])` was true of every possible state of the product. The rule this
 * whole file exists to enforce was unenforced and green.
 *
 * ⚠ A FLOOR IN A NEIGHBOURING TEST CANNOT VOUCH FOR THIS SWEEP. #108 fixed the reader in the two
 * tests that named it and left the third, and every instrument stayed green because each test's
 * floor guarded only the set that test built. The structural fix is not a better floor, it is ONE
 * set: both readers are unioned here, memoised, and every consumer below reads this. The sweep also
 * keeps its OWN floor, so re-splitting the definition reds immediately rather than going quiet.
 */
let gatedCache: Set<string> | null = null
function gatedFiles(): Set<string> {
  if (gatedCache === null) {
    // Both halves: anything still routed as JSX in the shell block, plus every page in the table.
    // The union is what actually renders behind the gate, whichever shape the router is in today.
    gatedCache = closure(
      entryFiles([...new Set([...routedComponents(shellBlock ?? ''), ...consoleRouteComponents()])]),
    )
  }
  return gatedCache
}

let publicCache: Set<string> | null = null
function publicFiles(): Set<string> {
  publicCache ??= closure(entryFiles(routedComponents(rootBlock ?? '').filter((n) => n !== 'AuthGate')))
  return publicCache
}

function entryFiles(names: string[]): string[] {
  return names.map((n) => {
    const spec = importedFrom.get(n)
    if (spec === undefined) throw new Error(`App.tsx routes <${n}> but imports no such name — the router and the import list have drifted.`)
    const f = resolveModule(spec, APP)
    if (f === null) throw new Error(`App.tsx routes <${n}> from '${spec}', which is not one of our packages.`)
    return f
  })
}

describe('the marketing type scale stops at the AuthGate', () => {
  it('reads both route blocks out of App.tsx — it must not pass by finding no routes', () => {
    expect(routeBlocks).toHaveLength(2)
    expect(rootBlock).toBeDefined()
    expect(shellBlock).toBeDefined()
    // The root block holds exactly one gate; everything else beside it is public by construction.
    expect([...(rootBlock ?? '').matchAll(/<AuthGate>/g)]).toHaveLength(1)
    // ⚠ AND THE GATED PAGES, which no longer live in that block at all. Named as literals, not
    // counted from the table: a reader that returns [] is the failure this whole test exists to
    // make impossible, and a count derived from the thing being checked cannot see it.
    const console = consoleRouteComponents()
    expect(console.length, 'CONSOLE_ROUTES yielded no components — the gated closure would be empty').toBeGreaterThanOrEqual(10)
    for (const name of ['Overview', 'TrackArea', 'DocsArea', 'TopUp']) {
      expect(console, `${name} is a console page but the table reader missed it`).toContain(name)
    }
  })

  it('the detector tells a class from a sentence about one, and a size from a family', () => {
    // Both directions, the same control invariant.test.ts runs before trusting its own regex.
    expect(MARKETING_RE.test(stripComments('<h1 className="text-display-3 text-ink" />'))).toBe(true)
    expect(MARKETING_RE.test(stripComments('// never reach for text-display-3 in a console'))).toBe(false)
    expect(MARKETING_RE.test(stripComments('/* text-lede is for the public page */'))).toBe(false)
    // ⚠ THE ONE THAT MATTERS: the family every money surface wears is not the marketing size.
    expect(MARKETING_RE.test(stripComments('<span className="font-figure text-body text-muted" />'))).toBe(false)
    expect(MARKETING_RE.test(stripComments('<span className="font-figure text-figure" />'))).toBe(true)
    // and a console step is never a violation, on any surface
    expect(MARKETING_RE.test(stripComments('<h1 className="text-title text-ink" />'))).toBe(false)
  })

  it('every step preset.ts declares is classified — a new one fails until someone places it', () => {
    const src = stripComments(readFileSync(PRESET, 'utf8'))
    const at = src.indexOf('fontSize:')
    expect(at, 'preset.ts no longer declares a fontSize scale').toBeGreaterThan(-1)
    const open = src.indexOf('{', at)
    let depth = 0
    let close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) {
        close = i
        break
      }
    }
    expect(close, 'unbalanced braces in preset.ts fontSize').toBeGreaterThan(open)
    const block = src.slice(open + 1, close)
    // Inside fontSize, only the steps are `key: [` — the nested lineHeight/letterSpacing/fontWeight
    // keys all take strings.
    const declared = [...block.matchAll(/(?:^|\n)\s*'?([a-zA-Z][a-zA-Z0-9-]*)'?:\s*\[/g)].map((m) => m[1]).sort()
    const classified = [...Object.keys(CONSOLE_STEPS), ...Object.keys(MARKETING_STEPS)].sort()
    expect(declared).toEqual(classified)
  })

  it('the two closures reach real files, and the shared package lands in both', () => {
    // The ONE gated set — the same object the sweep at the bottom filters. See §THE GATED CLOSURE.
    const gated = gatedFiles()
    const publik = publicFiles()
    // Floors: a closure that collapsed to nothing would make the sweep below vacuous.
    expect(gated.size).toBeGreaterThan(25)
    expect(publik.size).toBeGreaterThan(5)
    for (const f of ['areas/track/IssueDetail.tsx', 'areas/lens/Overview.tsx', 'areas/docs/DocsArea.tsx']) {
      expect([...gated].some((p) => p.endsWith(f)), `${f} is routed behind the gate but the closure missed it`).toBe(true)
    }
    expect([...publik].some((p) => p.endsWith('areas/marketing/Landing.tsx'))).toBe(true)
    // A design-system component is rendered on both sides; that is why the rule is per-file and
    // not per-directory.
    expect([...gated].some((p) => p.includes('/packages/ui/src/components/'))).toBe(true)
    expect([...publik].some((p) => p.includes('/packages/ui/src/components/'))).toBe(true)
  })

  it('the scale is still in use on the public page — this rule is not about nothing', () => {
    // ⚠ CANNOT PASS BY ABSENCE. Delete the hero's step and every "no violations" assertion below
    // goes green over a scale no one uses; that is a deleted rule wearing a passing test.
    const landing = stripComments(readFileSync(resolve(WEB_SRC, 'areas/marketing/Landing.tsx'), 'utf8'))
    expect(/\btext-display-1\b/.test(landing)).toBe(true)
    expect(/\btext-lede\b/.test(landing)).toBe(true)
  })

  it('no console surface reaches for it', () => {
    const gated = [...gatedFiles()].sort()
    // ⚠ THE SWEEP CARRIES ITS OWN FLOOR. A floor in a NEIGHBOURING test reads a set this line
    // never sees, so it cannot vouch for this one — that is exactly how this sweep went vacuous.
    expect(gated.length, 'the sweep below reached no files — it would report "no offenders" over an empty set').toBeGreaterThan(25)
    for (const f of ['areas/track/IssueDetail.tsx', 'areas/lens/Overview.tsx']) {
      expect(gated.some((p) => p.endsWith(f)), `${f} is routed behind the gate but the SWEEP's closure missed it`).toBe(true)
    }
    const offenders = gated
      .filter((f) => MARKETING_RE.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => {
        const line = stripComments(readFileSync(f, 'utf8'))
          .split('\n')
          .findIndex((l) => MARKETING_RE.test(l))
        return `${show(f)}:${line + 1}`
      })
    expect(
      offenders,
      'preset.ts §DISPLAY: "⚠ NOT FOR THE APP. Nothing behind the AuthGate should reach for these; ' +
        'if a console screen ever wants display type, that is a design conversation, not an import." ' +
        'The console ramp is in areas/docs/pm.tsx: h1 → text-title, h2 → text-head.',
    ).toEqual([])
  })
})
