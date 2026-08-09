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
    const gated = closure(entryFiles(routedComponents(shellBlock ?? '')))
    const publik = closure(entryFiles(routedComponents(rootBlock ?? '').filter((n) => n !== 'AuthGate')))
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
    const gated = [...closure(entryFiles(routedComponents(shellBlock ?? '')))].sort()
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
