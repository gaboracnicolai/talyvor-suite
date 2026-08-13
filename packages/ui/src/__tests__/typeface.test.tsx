import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MuNumeral } from '../components/MuNumeral'
import preset from '../preset'
import { stripComments } from '../lib/sourceText'

/**
 * THE TYPEFACE, AND THE NUMERAL FACE.
 *
 * The public site is set in Space Grotesk with IBM Plex Mono, and its `.font-instrument`
 * utility — the one it puts on every eyebrow label AND every quoted figure — is literally
 * `font-family: var(--font-mono); font-feature-settings: "tnum" 1`. Porting the language
 * without porting the faces would leave the most visible half of it undone.
 *
 * ⚠ A WEBFONT IS THE `text/html` 200 OF TYPOGRAPHY. An @font-face whose file 404s does
 * not error, does not warn, and does not look broken — the browser silently falls back to
 * the system stack and the page renders in the wrong typeface forever. So this asserts the
 * FILES, not the declaration: every url() in theme.css must resolve to something on disk
 * whose first four bytes are `wOF2`.
 */

const uiSrc = resolve(import.meta.dirname, '..')
const themeCssPath = resolve(uiSrc, 'theme.css')
const css = readFileSync(themeCssPath, 'utf8')

/**
 * THE TWO CODE SWEEPS' OTHER INPUT: WHICH FILES THEY READ, AND IT WAS THE UNCONTROLLED ONE.
 *
 * Both sweeps below carry a case named "the sweep is not passing by finding nothing" / "and the
 * sweep would still see one". Read them: each hands the PREDICATE a hand-written string and checks
 * it matches. That controls the regex. It says nothing whatever about the walk, and an absence
 * guard's output for "read nothing" is byte-identical to its output for "read everything and found
 * no offender": `[]`.
 *
 * ⚠ THIS FILE WAS EXPLICITLY CLEARED BY THE PREVIOUS CENSUS, AND THE STATED REASON WAS NOT WHAT IS
 * IN THE FILE. It recorded typeface.test.tsx as one that "walks packages/ui/src and never reads
 * apps/web/src at all, so removing areas/ COULD NOT have moved them". Both sweeps read
 * `[uiSrc, resolve(uiSrc, '../../../apps/web/src')]`. The census's CONCLUSION happened to hold
 * because its control was UNARMED — no mutation that only removes files can move an absence guard,
 * whatever it reads — but the reason it wrote down would have stopped the next tab re-asking.
 *
 * SO IT WAS RE-ASKED ARMED, at 4ed0e79 (`~/talyvor-queue/w11-uiwalk-controls-9e73.py`, every
 * mutation anchor-count-asserted before the edit, restored in a `finally` and verified back by
 * sha256, verdicts read from vitest's own per-test lines), 6/6 as predicted:
 *   T1 `tabular-nums` in a REAL screen at apps/web/src/areas/lens/Ledger.tsx -> REDS the sweep, so
 *      its population really does reach across the repo.
 *   T2 THE HOLE: the same class + ONE line so the walk does not descend into `areas` -> GREEN.
 *   T3/T4 the same pair for `tracking-wide` and the eyebrow sweep -> red, then GREEN.
 *   T5/T6 AND IT IS BLIND IN ITS OWN PACKAGE TOO: `tabular-nums` in a real
 *      packages/ui/src/components/Card.tsx -> red; plus one line skipping `components` -> GREEN.
 *      18 of the 32 production files in packages/ui/src live there.
 *
 * The repair is the one #183 shipped and #184 carried to the three sweeps over apps/web/src: an
 * INDEPENDENT ENUMERATION. `import.meta.glob` is resolved by Vite at transform time and touches
 * `node:fs` not at all, so a skip map, a changed extension filter or a wrong root cannot move both
 * instruments the same way. Compared BOTH DIRECTIONS, with one floor for the single failure that
 * CAN move both: a root resolving to an empty tree.
 *
 * ⚠ AND THERE IS NOW ONE WALK WHERE THERE WERE TWO. They were byte-identical apart from the
 * predicate, which is the shape this repo already refuses elsewhere — "two copies of a scanner is
 * two chances for only one of them to be right" (deadClasses.test.ts on `stripComments`). One walk
 * means the guard below speaks for both sweeps rather than for a copy of one of them.
 *
 * ⚠ IT PASSED ON ITS FIRST RUN, so every assertion in it has its own control and every verdict is
 * read from the FAILING TEST NAME rather than from the file's exit code
 * (`~/talyvor-queue/w11-uiwalk-guard-controls-9e73.py`, 8/8):
 *   P1 walk skips `areas/` → the SET comparison reds and it is the ONLY newly-failing case, so
 *      neither original sweep is the one answering.
 *   P2 the glob pointed at a directory that does not exist → the FLOOR *and* the SET red, so the
 *      floor is armed rather than decorative.
 *   P3 the walk widened to keep `.test.*` → the SET reds, AND SO DO BOTH ORIGINAL SWEEPS. Recorded
 *      because it CONFIRMS the exclusion's stated reason rather than merely repeating it:
 *      design-fixes.test.tsx really does name `tabular-nums` and `tracking-wide` in assertions that
 *      they are absent, so the sweeps are kept off their own fixtures by that filter and by nothing
 *      else.
 *   P4 the defect with the walk intact → the ORIGINAL sweep reds ALONE and the SET stays green, so
 *      the repair was ADDED to the sweeps rather than swapped in for them.
 *   P5 the T2 combination → CAUGHT. The flip is the finding.
 *   P6 BLINDING: this block skipped and the defect + skip restored → rc=0, NOT CAUGHT. Nothing else
 *      in either package was watching.
 *   P7 the own-package half: a defect in `components/` plus one line skipping `components` →
 *      CAUGHT, so T6 is closed as well as T2/T4.
 *   G1 a new production file that both instruments can see → STAYS GREEN. A set comparison, not a
 *      snapshot somebody would re-baseline.
 */
/**
 * ⚠ THE TYPE, NOT THE INSTRUMENT. This package does not depend on `vite` — vitest brings it
 * transitively, so the RUNTIME has the real transform-time glob, but `vite/client`'s types are not
 * resolvable from packages/ui/node_modules (apps/web, which does depend on vite, needs none of
 * this). The ONE method used is declared here rather than adding a dependency to the package graph
 * for the sake of a type. It is deliberately narrower than Vite's: the value is only ever handed to
 * `Object.keys`, so this signature cannot change what the guard below measures — and if it ever
 * drifted, the controls exercise the real glob, not this declaration.
 */
declare global {
  interface ImportMeta {
    glob(patterns: string[]): Record<string, unknown>
  }
}

function productionSources(): string[] {
  const roots = [uiSrc, resolve(uiSrc, '../../../apps/web/src')]
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      // NON-TEST SOURCE ONLY, for the same reason decision-expiry.sh's D7 landed there: a test may
      // legitimately NAME a forbidden class in an assertion that it is absent (design-fixes.test.tsx
      // does exactly that), and a test renders nothing a user sees. Production source is where the
      // class would actually ship.
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p)
    }
  }
  for (const r of roots) walk(r)
  return out
}

describe('the sweeps read the whole tree', () => {
  // Keys only — the glob is lazy, so nothing here imports a module or runs a side effect. BOTH
  // roots, because the walk has two: a comparison seeing only packages/ui would be green while
  // every product screen went unread, which is exactly the hole T2/T4 measured.
  // ⚠ WRITTEN AS A LITERAL `import.meta.glob(...)` CALL AND IT HAS TO BE. Vite rewrites this at
  // TRANSFORM time by matching the syntax, so hoisting it into a variable first — which is what the
  // first version did to satisfy the type — leaves a real `import.meta.glob` at runtime and the
  // case dies with "glob is not a function". Caught by running it, not by reading it; the type
  // above is declared instead, and that is the whole reason the declaration exists.
  const globbed = Object.keys(
    import.meta.glob(['../**/*.{ts,tsx}', '../../../../apps/web/src/**/*.{ts,tsx}']),
  )
    .filter((k) => !/\.test\.tsx?$/.test(k))
    .map((k) => resolve(import.meta.dirname, k))

  it('finds a substantial tree across both packages, so an empty root cannot pass', () => {
    // Deliberately far below the 102 counted at 4ed0e79: this catches a root that resolves to
    // nothing, not a refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(60)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', () => {
    const walked = new Set(productionSources()) // the REAL walk both sweeps use
    const glob = new Set(globbed)
    const rel = (p: string) =>
      p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
    expect(
      [...glob].filter((f) => !walked.has(f)).map(rel).sort(),
      'Vite sees production files these sweeps never read. A `tabular-nums` or a hand-rolled ' +
        'eyebrow in any of them would ship with nothing red.',
    ).toEqual([])
    expect(
      [...walked].filter((f) => !glob.has(f)).map(rel).sort(),
      'the walk read files Vite does not see. Either it left the two roots, or the two disagree ' +
        'about what a production source file is.',
    ).toEqual([])
  })
})

describe('the faces are declared', () => {
  it('--sans leads with Space Grotesk', () => {
    const m = /--sans:\s*([^;]+);/.exec(css)
    expect(m?.[1].trim().startsWith('"Space Grotesk"'), `--sans is ${m?.[1]}`).toBe(true)
  })
  it('--mono leads with IBM Plex Mono', () => {
    const m = /--mono:\s*([^;]+);/.exec(css)
    expect(m?.[1].trim().startsWith('"IBM Plex Mono"'), `--mono is ${m?.[1]}`).toBe(true)
  })
  it('both keep a system fallback — a font that fails to load must not take the text with it', () => {
    expect(/--sans:[^;]*system-ui[^;]*;/.test(css)).toBe(true)
    expect(/--mono:[^;]*ui-monospace[^;]*;/.test(css)).toBe(true)
  })
  it('every face is served locally — no third-party font host on an authenticated console', () => {
    expect(/fonts\.googleapis\.com|fonts\.gstatic\.com|https?:\/\//.test(css), 'theme.css reaches off-origin').toBe(
      false,
    )
  })
})

describe('the font files exist and are fonts', () => {
  const urls = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1])

  it('theme.css declares @font-face for both families', () => {
    expect((css.match(/@font-face/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(css).toContain("font-family: 'Space Grotesk'")
    expect(css).toContain("font-family: 'IBM Plex Mono'")
  })

  it('there is at least one url() to check — the check must not pass by finding nothing', () => {
    expect(urls.length).toBeGreaterThan(0)
  })

  for (const url of urls) {
    it(`${url} resolves to a real woff2`, () => {
      const file = resolve(dirname(themeCssPath), url)
      expect(existsSync(file), `${url} → ${file} does not exist; the browser would silently fall back`).toBe(true)
      const head = readFileSync(file).subarray(0, 4).toString('latin1')
      expect(head, `${url} is not a woff2 (magic bytes were "${head}")`).toBe('wOF2')
    })
  }

  it('no font file ships without its licence beside it', () => {
    const fontsDir = resolve(uiSrc, 'fonts')
    const files = readdirSync(fontsDir)
    expect(files.some((f) => /^LICENCE|^LICENSE/i.test(f) && /grotesk/i.test(f))).toBe(true)
    expect(files.some((f) => /^LICENCE|^LICENSE/i.test(f) && /plex/i.test(f))).toBe(true)
  })
})

describe('numerals are set in the figure face', () => {
  const families = preset.theme!.extend!.fontFamily as Record<string, unknown[]>

  it('the preset names a figure face, and it is the mono var carrying tabular figures', () => {
    expect(families.figure, 'no `figure` fontFamily in the preset').toBeTruthy()
    expect(families.figure[0]).toBe('var(--mono)')
    expect(JSON.stringify(families.figure[1])).toContain('tnum')
  })

  it('MuNumeral renders in the figure face', () => {
    const { container } = render(<MuNumeral micros={12_340_567} unit="lens" />)
    expect(container.firstElementChild!.className).toContain('font-figure')
  })

  /**
   * `tabular-nums` was how numerals got their column alignment while they were set in the
   * SANS face. Both mono faces are fixed-advance by construction and `font-figure` carries
   * `tnum` besides, so a surviving `tabular-nums` means a call site is still reasoning in
   * the old face — which is exactly how half a system ends up ported.
   *
   * ⚠ SCOPE IS THE WHOLE REPO ON PURPOSE. Narrowing it to packages/ui would have scored
   * green while eight app call sites kept the old face.
   *
   * ⚠ AND IT MATCHED ITS OWN PROSE ON THE FIRST RUN. The naive version searched raw file
   * text, so the paragraph in preset.ts explaining why the class is gone, and the comment
   * in design-fixes.test.tsx recording the reversal, both counted as violations. A detector
   * that fires on the documentation of the thing it forbids has to be narrowed — and the
   * narrowing is where these go quietly blind, so `codeOnly` is positive-controlled below
   * in both directions before it is trusted with a single file.
   */
  const codeOnly = stripComments

  it('the detector reads code and not prose — both directions', () => {
    expect(codeOnly('const a = "tabular-nums"')).toContain('tabular-nums')
    expect(codeOnly('// we removed tabular-nums')).not.toContain('tabular-nums')
    expect(codeOnly('/* tabular-nums, historically */')).not.toContain('tabular-nums')
    expect(codeOnly('/** \n * tabular-nums \n */\nconst x = 1')).not.toContain('tabular-nums')
    // a string that merely LOOKS like a comment opener must survive
    expect(codeOnly('const u = "https://x.test/a"')).toContain('https://x.test/a')
    expect(codeOnly('const t = `a tabular-nums b` // tabular-nums')).toContain('a tabular-nums b')
    expect(codeOnly("const s = 'tabular-nums' /* gone */")).toContain('tabular-nums')
  })

  it('no `tabular-nums` survives in code anywhere — the face carries the figures now', () => {
    // ⚠ THE POPULATION IS `productionSources()` AND IT IS GUARDED, which the case below is not a
    // substitute for: that one proves the PREDICATE still matches, this one is only as wide as the
    // walk. See THE TWO CODE SWEEPS' OTHER INPUT at the top of this file.
    const offenders = productionSources()
      .filter((p) => /\btabular-nums\b/.test(codeOnly(readFileSync(p, 'utf8'))))
      .map((p) => p.slice(p.indexOf('/src/') + 1))
    expect(offenders, `still setting numerals in the old face: ${offenders.join(', ')}`).toEqual([])
  })

  it('and it would still SEE one — the sweep is not passing by finding nothing', () => {
    // The positive control for the sweep itself: the same predicate, over a file that
    // does carry the class in code. If this ever stops failing, the sweep above is
    // reporting "clean" for a reason that has nothing to do with the codebase.
    expect(/\btabular-nums\b/.test(codeOnly('<span className="tabular-nums" />'))).toBe(true)
  })
})

describe('the small label is one thing', () => {
  /**
   * The eyebrow existed before it had a name: twenty-one hand-rolled labels in FOUR shapes
   * (`text-caption uppercase tracking-wide` with text-muted, with text-faint, with
   * font-semibold, and once with no colour at all). Nothing was wrong with any one of them,
   * which is exactly why there were four — a shape only converges when something makes it.
   *
   * ⚠ `tracking-wide` IS THE PART THAT MUST NOT SURVIVE, and not for tidiness. It is .025em;
   * the eyebrow token carries .24em. Both emit `letter-spacing`, and which one wins is decided
   * by the order Tailwind emits them, not by the order they appear in the className — so a
   * leftover `tracking-wide` beside `text-eyebrow` is a silent, invisible override of the very
   * property the token exists to carry.
   */
  it('no hand-rolled eyebrow survives in code', () => {
    // Same population as the tabular-nums sweep, and now literally the same walk — see THE TWO
    // CODE SWEEPS' OTHER INPUT at the top of this file.
    const offenders = productionSources()
      .filter((p) => /\btracking-wide\b/.test(stripComments(readFileSync(p, 'utf8'))))
      .map((p) => p.slice(p.indexOf('/src/') + 1))
    expect(offenders, `hand-rolled eyebrow(s) left: ${offenders.join(', ')}`).toEqual([])
  })

  it('and the sweep would still see one', () => {
    expect(/\btracking-wide\b/.test(stripComments('<b className="text-caption uppercase tracking-wide" />'))).toBe(true)
  })

  it('the token carries the tracking, and a weight that leaves font-semibold meaning something', () => {
    const sizes = preset.theme!.extend!.fontSize as Record<string, [string, Record<string, string>]>
    // 11px at the browser's default 16px root. The step is declared in `rem` so the reader's own
    // font-size preference reaches it (preset.ts §THE CONSOLE SCALE); the SIZE is the same 11 it
    // was, and that is what this line is about. The unit is guarded, both directions, by
    // apps/web/src/typeScaleUnits.test.ts.
    expect(sizes.eyebrow[0]).toBe('0.6875rem')
    expect(Number(/^([0-9]*\.?[0-9]+)rem$/.exec(sizes.eyebrow[0])![1]) * 16).toBe(11)
    expect(sizes.eyebrow[1].letterSpacing).toBe('0.24em')
    // Members distinguishes owner from member by WEIGHT. If the token were 600, `font-semibold`
    // would be a no-op and that distinction would vanish without a single test going red.
    expect(Number(sizes.eyebrow[1].fontWeight)).toBeLessThan(600)
  })
})
