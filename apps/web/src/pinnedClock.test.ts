import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { stripComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * A TEST THAT RENDERS A CLOCK-TAKING SCREEN WITHOUT PINNING THE CLOCK IS A TEST WITH AN EXPIRY DATE.
 *
 * ⚠ THIS ONE HAD ALREADY GONE OFF, ON MAIN, WITH CI GREEN. Measured at `e3b65ef`:
 *
 *     apps/web/src/areas/lens/lxcSplitCoverage.test.tsx:136
 *       renderScreen(<Overview />)          // ← no `now`
 *
 * `Overview({ now = new Date() })` falls back to the WALL CLOCK, and every LXC row that test stubs
 * is `created_at: '2026-07-21T10:00:00Z'`. The screen sums a 30-DAY WINDOW, so the fixture sat
 * inside it until 2026-08-20 and outside it from 2026-08-21 — `lxc-debit-total` renders `2,100µlxc`
 * on one day and `0µlxc` on the next, with NO COMMIT IN BETWEEN.
 *
 * ⚠ AND THE INSTRUMENT AGREED IT WAS FINE, WHICH IS THE PART WORTH KEEPING. `gh run list` on
 * `e3b65ef` reports ci=success, created 2026-08-19T17:07:03Z — the last day the assertion could
 * pass. From 2026-08-21 the tree was red and every session that read "main is green" read a fact
 * about WHEN CI LAST RAN, not about the tree it was branching from. STEP 0 says "report main AND
 * its CI conclusion"; this file exists because that conclusion has a shelf life and nothing said so.
 *
 * ⚠ THE OTHER ONE HAD NOT GONE OFF YET, AND THAT IS WHY THIS IS A SWEEP RATHER THAN TWO PATCHES.
 * `Held.test.tsx` renders `<Overview />` unpinned too, and it passes today only because its
 * fixture stubs an EMPTY ledger, so no row can fall out of a window — it is the same defect
 * holding a blank round, and it arms itself the moment anyone gives that fixture a dated row.
 * Measured population at `e3b65ef`: 20 renders of a clock-taking component across the test tree,
 * 18 pinned, 2 not.
 *
 * ── WHY THE COMPONENT SET IS DERIVED ─────────────────────────────────────────────────────────────
 *
 * A hardcoded ['Overview', 'Spend'] would guard the two screens someone thought of and say nothing
 * about the third. The set is read out of the SOURCE — any component whose signature defaults a
 * `now` parameter to `new Date()` — so a new clock-taking screen is swept the day it is written,
 * and a screen that STOPS taking a clock drops out without leaving a stale rule behind.
 *
 * ⚠ PAIRED WITH FLOORS IN BOTH DIRECTIONS, because a derived sweep's usual failure is finding
 * nothing and reporting no violations: the component set must be non-empty AND must still contain
 * the two screens this was measured on, and the render census must still find renders. If someone
 * renames the prop, this file goes RED rather than quiet.
 */

const WEB_SRC = resolve(import.meta.dirname)
const REPO = resolve(import.meta.dirname, '../../..')

const show = (f: string): string => relative(REPO, f)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

const allFiles = walk(WEB_SRC)
const sourceFiles = allFiles.filter((f) => !/\.test\.tsx?$/.test(f))

/**
 * ⚠ THIS FILE IS NOT PART OF ITS OWN CENSUS, and it reported ITSELF before it reported anything
 * else. The predicate control below feeds `'  render(<Overview />)'` to the reader as a STRING to
 * prove it can tell pinned from unpinned — and the sweep, reading every test file's text, found
 * that literal and named THIS FILE an offender — four "violations", two of them its own fixtures.
 *
 * That is the same shape as the bug tailwind.config.ts documents at length — a class named in a
 * FIXTURE compiled into the shipped stylesheet — one directory over: a scanner that reads raw text
 * cannot tell a demonstration of a thing from the thing. The exclusion is by exact path, and the
 * test below asserts it is exactly this one file, so it cannot quietly become a place to put
 * inconvenient results.
 */
const SELF = resolve(WEB_SRC, 'pinnedClock.test.ts')
const testFiles = allFiles.filter((f) => /\.test\.tsx?$/.test(f) && f !== SELF)

/**
 * Components that default a `now` parameter to the wall clock. Comments are stripped first — a
 * paragraph ABOUT `now = new Date()` is prose, not a signature, and this repo has shipped a
 * stylesheet built from its own comments once already.
 */
function clockTakingComponents(): string[] {
  const names = new Set<string>()
  for (const f of sourceFiles) {
    const src = stripComments(readFileSync(f, 'utf8'))
    for (const m of src.matchAll(/(?:export\s+)?function\s+([A-Z]\w*)\s*\([^)]*now\s*=\s*new Date\(\)/gs)) {
      names.add(m[1])
    }
  }
  return [...names].sort()
}

type Render = { file: string; line: number; text: string; pinned: boolean }

/**
 * ⚠ A RENDER IS CODE, NOT A QUOTED STRING — and the second guard this file collided with is the
 * reason that is enforced rather than assumed.
 *
 * Comments are already stripped, which handles prose. It does NOT handle a STRING LITERAL, and
 * `pointerAudit.test.ts` must hold one: its registry pins each pointer with the fragment the
 * quoting sentence promises, and the entry for the defect this file documents is literally
 *
 *     fragment: 'renderScreen(<Overview />)',
 *
 * The census read that as an unpinned render in `pointerAudit.test.ts` and reported a guard's
 * registry as a bug. Same class as the self-exclusion above, one file over: a scanner over raw
 * text cannot tell a QUOTATION of a thing from the thing.
 *
 * The test is "is this match inside an open quote on its own line" — cheap, and exactly right for
 * the shape that occurs here (a single-line fragment in a registry). Both directions are pinned in
 * the predicate control below, because a string check that returned `true` for everything would
 * empty the census and pass this whole file by finding nothing.
 */
function insideStringLiteral(line: string, at: number): boolean {
  const before = line.slice(0, at)
  return ["'", '"', '`'].some((q) => {
    const n = before.split('').filter((c, i) => c === q && before[i - 1] !== '\\').length
    return n % 2 === 1
  })
}

/**
 * THE READER, OVER ONE LINE — and it is the ONLY one. The predicate control below probes THIS
 * function, and the sweep is a loop around it. That is deliberate: this file's first draft had a
 * separate `renderCensusOnText` for the control, so the control vouched for a reader the sweep did
 * not use — and it said so immediately, by passing the quoted-fragment case the sweep still failed.
 * Two copies of a scanner is two chances for only one of them to be right; the repo has paid for
 * that lesson in three neighbouring instruments (see displayScale §THE GATED CLOSURE).
 */
function readLine(line: string, components: string[], file = '<probe>', lineNo = 1): Render[] {
  if (components.length === 0) return []
  const re = new RegExp(`<(${components.join('|')})(\\s[^>]*?)?/?>`, 'g')
  const out: Render[] = []
  for (const m of line.matchAll(re)) {
    if (insideStringLiteral(line, m.index)) continue
    out.push({ file, line: lineNo, text: m[0].trim(), pinned: /\bnow\s*=/.test(m[2] ?? '') })
  }
  return out
}

function renderCensus(components: string[]): Render[] {
  const out: Render[] = []
  if (components.length === 0) return out
  for (const f of testFiles) {
    stripComments(readFileSync(f, 'utf8'))
      .split('\n')
      .forEach((l, i) => out.push(...readLine(l, components, f, i + 1)))
  }
  return out
}

describe('a rendered clock is pinned, or the test has an expiry date', () => {
  const components = clockTakingComponents()
  const census = renderCensus(components)

  it('finds the clock-taking components by signature — it must not pass by finding none', () => {
    expect(components.length, 'no component defaults `now` to `new Date()` — the prop was renamed and this whole file went quiet').toBeGreaterThan(0)
    // The two this was measured on. Named as literals, not counted: a count derived from the thing
    // being checked cannot tell "the reader broke" from "the product changed".
    expect(components).toContain('Overview')
    expect(components).toContain('Spend')
  })

  it('finds renders of them in the test tree — the sweep below must not be over an empty set', () => {
    expect(census.length, 'no test renders a clock-taking component — the assertion below would be vacuous').toBeGreaterThan(10)
    expect(census.some((r) => r.file.endsWith('lxcSplitCoverage.test.tsx'))).toBe(true)
    expect(census.some((r) => r.file.endsWith('Held.test.tsx'))).toBe(true)
  })

  it('the sweep excludes exactly one file — its own — and that exemption is not a dumping ground', () => {
    const excluded = allFiles.filter((f) => /\.test\.tsx?$/.test(f)).filter((f) => !testFiles.includes(f))
    expect(excluded.map(show)).toEqual(['apps/web/src/pinnedClock.test.ts'])
    // and the exclusion is really doing something: this file DOES contain the offending shape,
    // as string literals in the control below. If it ever stops, the exemption is stale.
    expect(/<Overview \/>/.test(readFileSync(SELF, 'utf8'))).toBe(true)
  })

  it('the reader tells a pinned render from an unpinned one', () => {
    // Both directions, on known answers, before trusting the sweep's verdict.
    const probe = (line: string) => readLine(line, ['Overview'])
    expect(probe('  render(<Overview />)')[0]?.pinned).toBe(false)
    expect(probe('  render(<Overview now={NOW} />)')[0]?.pinned).toBe(true)
    expect(probe('  render(<Overview now={new Date("2026-07-22")} />)')[0]?.pinned).toBe(true)
    // an unrelated prop is not a clock
    expect(probe('  render(<Overview className="x" />)')[0]?.pinned).toBe(false)

    // ⚠ AND A QUOTED RENDER IS NOT A RENDER — both directions, because a string check that said
    // "yes" to everything would empty the census and make the sweep below pass over nothing.
    expect(probe("    fragment: 'renderScreen(<Overview />)',"), 'a fragment in a registry is a quotation, not a render').toHaveLength(0)
    expect(probe('  const s = "<Overview />"')).toHaveLength(0)
    expect(probe('  render(<Overview />)'), 'a real render must still be seen').toHaveLength(1)
  })

  it('every render pins its clock', () => {
    const unpinned = census.filter((r) => !r.pinned).map((r) => `${show(r.file)}:${r.line}  ${r.text}`)
    expect(
      unpinned,
      'These render a screen whose `now` defaults to `new Date()`, so what they assert depends on ' +
        'the day they run. The LXC split-coverage test was exactly this and it flipped red on ' +
        '2026-08-21 with no commit — main’s last CI run was 2026-08-19, so "main is green" was a ' +
        'fact about that date. Pass `now={NOW}`.',
    ).toEqual([])
  })
})
