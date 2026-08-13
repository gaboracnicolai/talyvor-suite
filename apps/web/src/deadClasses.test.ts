import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import tailwindConfig, { buildContent, contentTransform } from '../tailwind.config'
// Deep relative import on purpose: one implementation of the comment stripper, with ONE set of
// positive controls (packages/ui/src/__tests__/typeface.test.tsx). Two copies of a scanner is
// two chances for only one of them to be right.
import { stripComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * A CLASS THAT IS NOT A CLASS.
 *
 * `local/no-arbitrary-value` stops a component from BYPASSING the design system. It cannot
 * see the opposite failure: a class that looks like a token, reads like a token in review,
 * and generates no CSS whatsoever. Tailwind does not warn — an unrecognised candidate is
 * simply not emitted — so the element renders unstyled and nobody notices, because nothing
 * anywhere is red.
 *
 * ⚠ IT HAD ALREADY HAPPENED, TWICE, AND FOR A LONG TIME:
 *
 *   `text-mono`  ×7 — there is no `mono` in the fontSize scale (the family utility is
 *                     `font-mono`). Landing.tsx's Figure even carried the comment "Mono and
 *                     tabular" while never once rendering in mono, and Setup.tsx set five
 *                     identifiers and a whole <pre> of shell snippets in the body sans.
 *   `bg-bg`      ×1 — there is no `bg` colour token. Setup.tsx's code block had no
 *                     background at all: a bordered box the same colour as the card.
 *
 * Both were found by reading the EMITTED stylesheet rather than the source — `.text-mono`
 * and `.bg-bg` produce zero rules in dist/assets/index-*.css. This test is that check, made
 * automatic: Tailwind is run over the real config and the real content, and every class
 * token the source actually writes must appear in what Tailwind produced.
 *
 * Dead ⟺ Tailwind saw the token as a candidate and emitted nothing for it. There is no
 * namespace modelling here and there deliberately isn't any: the generator is the authority
 * on what is a utility, not a table in a test that would drift from it.
 */

const appRoot = resolve(import.meta.dirname, '..')
const roots = [resolve(appRoot, 'src'), resolve(appRoot, '../../packages/ui/src')]

/**
 * MARKER CLASSES — the only names allowed to generate nothing, and there are two.
 * `group` and `peer` are Tailwind's relationship markers: they carry no declarations by
 * design, and the CSS lives in the `group-*` / `peer-*` variants that reference them.
 * Named forms (`group/row`) included. Anything else that emits nothing is a defect.
 */
const MARKERS = /^(group|peer)(\/[a-z0-9-]+)?$/

/** Remove `${…}` regions: inside a template class list, that is CODE, not class tokens. */
function stripInterpolations(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') depth--
        i++
      }
      i--
      out += ' '
      continue
    }
    out += text[i]
  }
  return out
}

/**
 * Class names defined by HAND-WRITTEN CSS rather than by Tailwind — `styles.css`,
 * `theme.css`, and the inline <style> block the marketing page ships its animations in.
 * Derived from the source, never a hard-coded allowlist: a typo in `tal-stagger` must
 * still be caught, and it is, because the misspelling appears in exactly one of the two
 * places.
 */
function handWrittenClassNames(): Set<string> {
  const names = new Set<string>()
  const files = [resolve(appRoot, 'src/styles.css'), resolve(appRoot, '../../packages/ui/src/theme.css')]
  const collect = (text: string) => {
    for (const m of text.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)\s*(?=[\s,{:>+~])/g)) names.add(m[1])
  }
  for (const f of files) collect(readFileSync(f, 'utf8'))
  // Inline <style> blocks in components (Landing.tsx ships its keyframes this way).
  const walkStyles = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name)
      if (entry.isDirectory()) walkStyles(p)
      else if (/\.tsx$/.test(entry.name)) {
        const src = readFileSync(p, 'utf8')
        for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) collect(m[1])
      }
    }
  }
  for (const r of roots) walkStyles(r)
  return names
}

/**
 * Class tokens the source actually writes, from two harvests with different rules.
 *
 * ⚠ SCOPE WAS THE FIRST THING THIS GOT WRONG, TWICE, IN OPPOSITE DIRECTIONS.
 *
 * Reading only `className=` / `cn(...)` — the surface `local/no-arbitrary-value` reads —
 * misses every class held in a LOOKUP TABLE, and that is where a design system keeps its
 * most important ones: `Button`'s variants, `Pill`'s statuses, `MuNumeral`'s unit ticks are
 * module-level records reached by `cn(base, table[key])`. Blind to the whole component layer.
 *
 * Reading every string literal instead reports English. "a alongside", "an and",
 * `'auth-me'`, `'2-digit'`, `'claude-code'` — prose and API paths are full of hyphens, and a
 * guard that cries wolf once is a guard someone deletes.
 *
 * So:
 *   A. In a CLASS POSITION (`className=`, `class=`, `cn`/`clsx`/`cva`/… arguments) every
 *      token is harvested. A lone dead class in an attribute — `className="text-mono"` —
 *      is only visible here.
 *   B. ANYWHERE ELSE a literal is harvested only if at least one of its tokens is a class
 *      Tailwind actually emitted. Self-calibrating: a variant table always contains real
 *      classes, a sentence never does. No prefix table to drift.
 */
/**
 * Every file the walk below actually READ, recorded by the walk itself. Not a second traversal:
 * a walk written here to produce the expected set would be free to drift from the one under
 * test, which is the whole defect. See THE SWEEP'S OTHER INPUT below.
 */
const swept = new Set<string>()

function collectUsedTokens(emitted: Set<string>): Map<string, string[]> {
  const used = new Map<string, string[]>()
  const SHAPE = /^[a-z0-9][a-z0-9:/._-]*$/
  const add = (token: string, where: string) => {
    // Arbitrary values are out of scope — already a CI failure via local/no-arbitrary-value.
    if (!token || !SHAPE.test(token) || token.includes('[')) return
    const at = used.get(token) ?? []
    if (!at.includes(where)) at.push(where)
    used.set(token, at)
  }

  const attr = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{'([^']*)'\}|\{"([^"]*)"\})/g
  const call = /\b(?:cn|clsx|classNames|twMerge|cva|ctl)\s*\(([\s\S]{0,1600}?)\)/g
  const literal = /(?:'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`)/g

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        swept.add(p)
        // Comments are prose. A sentence quoting "4 charges" is not a class list.
        const src = stripComments(readFileSync(p, 'utf8'))
        const where = p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)

        // A — class positions: harvest unconditionally.
        for (const m of src.matchAll(attr)) {
          for (const t of stripInterpolations(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').split(/\s+/)) {
            add(t, where)
          }
        }
        for (const m of src.matchAll(call)) {
          for (const lit of m[1].matchAll(literal)) {
            // ⚠ A LITERAL THAT IS A COMPARISON OPERAND IS NOT A CLASS LIST.
            // `cn(base, role === 'owner' ? 'font-semibold' : 'text-muted')` holds three
            // literals and only two are classes; without this, `owner` reports as dead.
            if (/[=!]==?$/.test(m[1].slice(0, lit.index).trimEnd())) continue
            for (const t of stripInterpolations(lit[1] ?? lit[2] ?? lit[3] ?? '').split(/\s+/)) {
              add(t, where)
            }
          }
        }

        // B — everywhere else: only literals demonstrably made of classes.
        for (const m of src.matchAll(literal)) {
          const tokens = stripInterpolations(m[1] ?? m[2] ?? m[3] ?? '').trim().split(/\s+/).filter(Boolean)
          if (!tokens.length || !tokens.every((t) => SHAPE.test(t))) continue
          if (!tokens.some((t) => emitted.has(t))) continue
          for (const t of tokens) add(t, where)
        }
      }
    }
  }
  for (const r of roots) walk(r)
  return used
}

/** Class names Tailwind actually emitted, unescaped. */
async function generatedClassNames(extraContent?: string): Promise<Set<string>> {
  // ⚠ `buildContent`, not a bare glob list: the build TRANSFORMS its input (comments are
  // stripped before extraction) and an instrument that skips that step reasons about a sheet
  // the browser never receives. Same argument as `absoluteContent` — one composer.
  const content = extraContent
    ? { files: [{ raw: extraContent, extension: 'html' }], transform: contentTransform }
    : buildContent(appRoot)
  const css = await postcss([
    tailwind({ ...tailwindConfig, content: content as never }),
  ]).process('@tailwind utilities;', { from: undefined })
  const names = new Set<string>()
  // `.hover\:bg-accent-tint:hover` → the class name stops at the first UNescaped `:`.
  // ⚠ THE ESCAPE ALTERNATIVE MUST COME FIRST. With the class-character branch first, the
  // lone backslash in `.w-1\.5` matches it, the following `.` then ends the match, and the
  // class is read as `w-1` — every escaped class (`w-1.5`, `wide:w-60`, `hover:bg-*`) scores
  // as dead. That was the first version of this regex, and it reported 40 false positives.
  for (const m of css.css.matchAll(/\.((?:\\.|[^\s{,:.>+~()])+)/g)) {
    names.add(m[1].replace(/\\(.)/g, '$1'))
  }
  return names
}

describe('the generator is asked, not a table', () => {
  it('a real token is emitted and a plausible-looking invention is not', async () => {
    const names = await generatedClassNames(
      '<div class="text-body font-mono bg-canvas text-mono bg-bg text-nonesuch-9"></div>',
    )
    // Positive control: these exist, so the check can see a live one.
    expect(names.has('text-body')).toBe(true)
    expect(names.has('font-mono')).toBe(true)
    expect(names.has('bg-canvas')).toBe(true)
    // Negative control: these are exactly the shapes that shipped, and they are nothing.
    expect(names.has('text-mono')).toBe(false)
    expect(names.has('bg-bg')).toBe(false)
    expect(names.has('text-nonesuch-9')).toBe(false)
  })

  it('variants survive the unescaping — a prefixed class is not read as dead', async () => {
    const names = await generatedClassNames('<div class="hover:bg-accent-tint wide:w-60 last:border-b-0"></div>')
    expect(names.has('hover:bg-accent-tint')).toBe(true)
    expect(names.has('wide:w-60')).toBe(true)
    expect(names.has('last:border-b-0')).toBe(true)
  })
})

/**
 * THE SWEEP'S OTHER INPUT: WHICH FILES IT READS, AND IT WAS THE UNCONTROLLED ONE.
 *
 * The generator is asked rather than a table, and that half is controlled above on known answers
 * in both directions. The other half is `collectUsedTokens`, and its FIRST decision is which
 * files to open. Nothing controlled that, and this sweep's output for "read nothing" is
 * byte-identical to its output for "read everything and found no dead class": `[]`.
 *
 * MEASURED at db85e4d on the real tree, not reasoned about
 * (`~/talyvor-queue/w11-blindwalk-controls-9e73.py` and `w11-blindwalk-armed-9e73.py`, every
 * mutation anchor-count-asserted before the edit, restored in a `finally` and verified back by
 * sha256, verdicts read from vitest's own per-test lines):
 *   A1  `text-mono` — the exact shape that shipped seven times, and which this file exists to
 *       catch — put into a real screen at `areas/lens/Ledger.tsx`: REDS `every class the source
 *       writes is a class Tailwind emits`, and only that case. The comparison is armed on real
 *       production files.
 *   A2  THE HOLE: the same dead class, plus ONE line so the walk does not descend into `areas` —
 *       rc=0, GREEN. 43 of the 70 production files under apps/web/src live there, which is every
 *       product screen — including `Setup.tsx` and `Landing.tsx`, where BOTH original defects were.
 *   C3  the skip ALONE, no dead class: GREEN. Nothing anywhere notices the population shrank.
 *
 * That is #183's C1/C2/C3, in this file. #183 closed it in `lib/awaiting.test.ts` and named the
 * three sweeps it had not been run against; this is one of them.
 *
 * THE REPAIR IS #183's AND IT IS THRESHOLD-FREE — an INDEPENDENT ENUMERATION, not a bigger floor.
 * The `>150` floor below is already substantive and is satisfied by the 27 files that survive the
 * skip, so raising a number would be a threshold nobody measured. `import.meta.glob` is resolved
 * by Vite at transform time and touches `node:fs` not at all, so a skip map, a changed extension
 * filter or a wrong `roots` cannot move both instruments the same way. Compared BOTH DIRECTIONS,
 * with a floor for the one failure that CAN move both: an anchor resolving to an empty tree
 * leaves the two enumerations agreeing on nothing.
 *
 * ⚠ IT PASSED ON ITS FIRST RUN, so every assertion in it has its own control and every verdict is
 * read from the FAILING TEST NAME rather than from the file's exit code
 * (`~/talyvor-queue/w11-blindwalk-guard-controls-9e73.py`, 7/7):
 *   P1 walk skips `areas/` → the SET comparison reds and it is the ONLY newly-failing case, so the
 *      catch is this block's and not something else noticing.
 *   P2 the glob pattern pointed at a directory that does not exist → the FLOOR *and* the SET red,
 *      so the floor is armed rather than decorative.
 *   P3 the walk widened to keep `.test.*` → the SET reds AS EXPECTED, and it also reds the sweep
 *      below. ⚠ RECORDED RATHER THAN PREDICTED AWAY, and it is a coupling worth knowing: the
 *      generator control above hands Tailwind `text-mono bg-bg text-nonesuch-9` — three classes it
 *      asserts are NOT emitted — inside a `class=` attribute. Widening the walk pulls this file
 *      into its own swept population and those fixtures report as dead classes, which is the right
 *      answer for the wrong reason. The sweep is kept off its own negative controls by the walk's
 *      test-file exclusion and by NOTHING ELSE.
 *   P4 the `text-mono` defect with the walk intact → the ORIGINAL guard reds ALONE and the SET
 *      stays green, so the repair was ADDED to the sweep rather than swapped in for it.
 *   P5 the A2 combination → CAUGHT. The flip is the finding.
 *   P6 BLINDING: this block skipped and the A2 defect restored → rc=0, NOT CAUGHT. Nothing else
 *      in the repo was watching.
 *   G1 a new production file that both instruments can see → STAYS GREEN. It is a set comparison,
 *      not a snapshot of a file list somebody would have to re-baseline.
 *
 * ⚠ `walkStyles` ABOVE IS A SECOND WALK AND IT IS DELIBERATELY NOT GUARDED HERE, because it fails
 * in the opposite direction. It builds the hand-written-CSS ALLOWLIST: a walk that reads fewer
 * files hands the sweep fewer excuses, so a class defined in a missed `<style>` block is reported
 * as dead. That is a loud false positive, not a silent pass — the failure mode this block exists
 * for cannot happen through it.
 */
describe('the sweep reads the whole tree', () => {
  // Keys only — the glob is lazy, so nothing here imports a module or runs a side effect. BOTH
  // roots, because `roots` has two: a comparison that saw only `apps/web/src` would be green
  // while packages/ui — where the component layer keeps its variant tables — went unread.
  const globbed = Object.keys(
    import.meta.glob(['./**/*.{ts,tsx}', '../../../packages/ui/src/**/*.{ts,tsx}']),
  )
    .filter((k) => !/\.test\.tsx?$/.test(k))
    .map((k) => resolve(import.meta.dirname, k))

  it('finds a substantial tree across both roots, so an empty anchor cannot pass', () => {
    // Deliberately far below the 102 counted at db85e4d: this catches an anchor that resolves to
    // nothing, not a refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(60)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', async () => {
    swept.clear()
    // The REAL sweep, called exactly as the guard below calls it. Reading `swept` afterwards is
    // what makes this an assertion about the walk under test rather than about a copy of it.
    collectUsedTokens(await generatedClassNames())
    const glob = new Set(globbed)
    const rel = (p: string) =>
      p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
    expect(
      [...glob].filter((f) => !swept.has(f)).map(rel).sort(),
      'Vite sees production files this walk never read. The sweep below checks whatever the walk ' +
        'returns, so a dead class in any of these would render unstyled with nothing red.',
    ).toEqual([])
    expect(
      [...swept].filter((f) => !glob.has(f)).map(rel).sort(),
      'the walk read files Vite does not see. Either it left the two roots, or the two disagree ' +
        'about what a production source file is.',
    ).toEqual([])
  })
})

describe('the sweep', () => {
  it('finds classes to check — it must not pass by finding nothing', async () => {
    const used = collectUsedTokens(await generatedClassNames())
    expect(used.size).toBeGreaterThan(150)
    // and it still sees the classes that live INSIDE cn(), which is where most of them are —
    // the comparison-operand rule above must not have swallowed the whole call.
    // and it still reaches class strings held in LOOKUP TABLES, which is where the
    // component layer keeps its variants — the blind spot this sweep was first written with.
    expect(used.has('active:bg-accent-tint'), "Button's variant table is not being read").toBe(true)
    expect(used.has('bg-lens'), "MuNumeral's unit-tick table is not being read").toBe(true)
    // and it must reach BOTH packages, not just the app it lives in
    const files = [...used.values()].flat()
    expect(files.some((f) => f.startsWith('apps/'))).toBe(true)
    expect(files.some((f) => f.startsWith('packages/'))).toBe(true)
  })

  it('every class the source writes is a class Tailwind emits', async () => {
    const emitted = await generatedClassNames()
    const used = collectUsedTokens(emitted)
    const handWritten = handWrittenClassNames()
    const dead = [...used.entries()]
      .filter(([token]) => !emitted.has(token) && !handWritten.has(token) && !MARKERS.test(token))
      .map(([token, where]) => `${token} (${where.join(', ')})`)
      .sort()
    expect(dead, `class token(s) that generate no CSS:\n  ${dead.join('\n  ')}`).toEqual([])
  })
})
