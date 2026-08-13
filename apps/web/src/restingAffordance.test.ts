import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { blankComments, stripComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * A LINK WHOSE ONLY AFFORDANCE IS `hover:underline` HAS NO AFFORDANCE ON A PHONE.
 *
 * The product already made this argument, in its own voice, and fixed it in ONE place.
 * `areas/docs/components.tsx` §Crumbs:
 *
 *     ⚠ UNDERLINED AT REST, not on hover. This was the only Link in the app without a resting
 *     affordance: it rendered as muted text indistinguishable from the prose beside it, so the
 *     way out of a page was invisible to anyone who had not already guessed it was there. Worse,
 *     `hover:underline` is the one affordance a touch device cannot produce at all — on a phone
 *     the control had no visible state ever. It was reported as "there is no way back", and the
 *     links were working the whole time.
 *
 * ⚠ "THE ONLY LINK IN THE APP" WAS NOT TRUE WHEN IT WAS WRITTEN, and nothing could have said so.
 * MEASURED at `1351de9` over both packages with comments blanked: `hover:underline` occurs three
 * times in the repo — Crumbs' paragraph above (prose), `focusAudit.ts`'s vocabulary list (a class
 * NAMED, not applied — pinned below), and one class list that APPLIES it:
 *
 *     apps/web/src/areas/track/IssueList.tsx:357
 *       <Link className="underline-offset-2 hover:underline" to={`/track/issues/${it.id}`}>
 *
 * — the ISSUE TITLE, which is the Track list's way into every issue it lists. Its cell is
 * `<td class="py-2 pr-3 text-ink">` and the link is the cell's only content, so at rest it is
 * `text-ink` text in a row of text: the identifier beside it is mono/muted and the status beside
 * that is a Pill, and the one cell that navigates is the one cell with no mark on it. This is the
 * Crumbs defect, one directory over, on a list rather than a breadcrumb — reported as fixed
 * because the fix was applied where it was found and the same shape elsewhere was never sought.
 *
 * ⚠ WHAT THIS RULE IS, SAID NARROWLY. It is not "every link must be underlined". It is: a
 * `hover:underline` may not be an element's ONLY underline, because the hover state is exactly
 * the state a touch device never enters. A class list carrying a resting `underline` with a
 * `hover:underline` on top of it is fine and is not what this looks for.
 *
 * ⚠ AND IT MUST BLANK COMMENTS BEFORE IT LOOKS. The paragraph that explains why the class is
 * forbidden contains the class — `sourceText.ts` exists for this, and `1351de9` paid for the
 * lesson a second time when a floor table's REASON STRING went red in deadClasses. Without the
 * blanking, Crumbs' own explanation is an offender and the guard reports the documentation as
 * the defect.
 *
 * ── WHY IT BLANKS RATHER THAN STRIPS, AND HOW THAT IS KEPT HONEST ────────────────────────────
 *
 * `stripComments` REMOVES comment bytes, so every line after a block comment shifts. The first
 * draft of this file reported the offender at IssueList.tsx:325 — a line that exists, holds
 * different code, and would have sent the next reader to the wrong place. A wrong line number in
 * a failure message is the same class of defect this repo keeps finding, so the local
 * `blankComments` replaces comment bytes with spaces and keeps every offset exact.
 *
 * ⚠ A SECOND IMPLEMENTATION IS A SECOND THING THAT CAN BE WRONG, so it is not trusted on its own
 * word: `stripComments` is positive-controlled in both directions in typeface.test.tsx, and the
 * test below asserts the two agree on the QUOTED FRAGMENTS of every file in both packages. They
 * can only agree by actually agreeing.
 *
 * ── THE LIMIT, STATED RATHER THAN IMPLIED ────────────────────────────────────────────────────
 *
 * This reads SOURCE, not the DOM, so it sees what is WRITTEN in a class list rather than what is
 * RENDERED. A class assembled at runtime out of fragments would escape it. That is the cheap
 * instrument's price, and it is acceptable here because the token is a literal in every
 * occurrence the repo has ever had — while the failure mode this repo actually keeps meeting is
 * an instrument that read nothing and reported zero, which the floor below is aimed at.
 */

const WEB_SRC = resolve(import.meta.dirname)
const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const REPO = resolve(import.meta.dirname, '../../..')

/**
 * Occurrences that NAME this class rather than APPLY it to an element.
 *
 * ⚠ A CLASSIFICATION, NOT AN EXEMPTION LIST, and held to that by three checks below rather than by
 * intent: an entry whose fragment no longer occurs in that file fails as STALE; an entry whose
 * fragment is not the forbidden shape fails as MISFILED; and an entry on a `.tsx` file fails
 * outright, because a class list reaches an element through JSX and TypeScript only accepts JSX in
 * `.tsx`. Keyed by (file, exact class list), so another class list in the same file is still judged.
 *
 * ⚠ THE RESIDUAL HOLE, SAID RATHER THAN IMPLIED: a `.ts` file CAN export a class list that
 * components apply — `packages/ui/src/lib/focus.ts` is exactly that — so the `.tsx` check narrows
 * this table without closing it. What it does close is the case that would actually be reached for,
 * which is silencing an offending component. C6 in the control log measures that: filing
 * IssueList's real class list here fails instead of passing.
 */
const NAMES_THE_CLASS: Record<string, string> = {
  'apps/web/src/focusAudit.ts|hover:underline':
    "UNDERLINE_CLASSES is the focus audit's vocabulary — the underline utilities it reads OFF " +
    'rendered elements to decide whether an <a> is a link in prose. It is a list of class NAMES, ' +
    'not a class list applied to anything; focusAudit.ts renders nothing.',
}

/** Every .ts/.tsx the product ships, both packages, tests excluded — a test is not the product. */
function sourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const p = resolve(dir, name)
      if (statSync(p).isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.tsx?$/.test(name)) continue
      if (/\.test\.tsx?$/.test(name)) continue
      out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

const FILES = [...sourceFiles(WEB_SRC), ...sourceFiles(UI_SRC)]

/**
 * THE WALK'S OWN POPULATION, ASSERTED AGAINST AN INSTRUMENT THAT DOES NOT SHARE ITS MACHINERY.
 *
 * ⚠ MEASURED, NOT SUSPECTED (`~/talyvor-queue/w11-areasprune-census-3a6d.py`). The floor below
 * already says an absence sweep is green on an instrument that read nothing — and it is the RIGHT
 * shape, but its five named files are in `areas/track`, `areas/docs` and `packages/ui`, so it
 * cannot speak for any other area. Armed with a real `hover:underline` carrying no resting
 * underline, planted in a real file under `apps/web/src/areas/lens`:
 *   A1  the defect with the tree whole            → this file REDS.
 *   A2  the same defect, `areas/lens` unreachable → GREEN. 23 of the 69 production files under
 *       apps/web/src (33%) stopped being read; `FILES.length > 60` still held and every named
 *       anchor still resolved, so the floor passed while a third of the product went unread.
 * NAMING A SIXTH FILE IS THE WRONG REPAIR: it arms this rule for `areas/lens` and leaves the next
 * area exactly as blind. The comparison below is threshold-free and needs no list.
 *
 * ⚠ AND NO SECOND INSTRUMENT WAS WATCHING: this file's test count is FIXED at 7, so unlike
 * `packages/ui/src/__tests__/invariant.test.ts` — which generates one `it()` per file and whose
 * 104 → 81 drop test-manifest.json catches — losing a whole product area moved nothing here.
 *
 * `import.meta.glob` is resolved by Vite at transform time and touches `node:fs` not at all, so a
 * wrong root, a changed extension filter or a walk that stops descending cannot move both
 * instruments the same way. Compared BOTH DIRECTIONS. The floor is for the one failure that CAN
 * move both: an anchor resolving to an empty tree leaves the two enumerations agreeing on nothing.
 */
describe('the sweep reads the whole tree', () => {
  // Keys only — the glob is lazy, so nothing here imports a module or runs a side effect. BOTH
  // roots, because `FILES` has two: a comparison seeing only `apps/web/src` would be green while
  // the design system's own package went unread.
  //
  // ⚠ THE CALL IS LITERAL ON PURPOSE. Vite rewrites `import.meta.glob` by matching the SYNTAX at
  // transform time; hoisting it into a variable typechecks and then dies at runtime.
  const globbed = Object.keys(
    import.meta.glob(['./**/*.{ts,tsx}', '../../../packages/ui/src/**/*.{ts,tsx}']),
  )
    .filter((k) => !/\.test\.tsx?$/.test(k))
    .map((k) => relative(REPO, resolve(import.meta.dirname, k)))

  it('finds a substantial tree across both roots, so an empty anchor cannot pass', () => {
    // Deliberately far below the count at b940d57: this catches an anchor that resolves to
    // nothing, not a refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(60)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', () => {
    // FILES is the sweep's own output — the very array every rule below reads — so this is an
    // assertion about the walk under test, not about a second walk written here that could drift.
    const swept = new Set(FILES.map((p) => relative(REPO, p)))
    const glob = new Set(globbed)
    expect(
      [...glob].filter((f) => !swept.has(f)).sort(),
      'Vite sees production files this walk never read. The offender rule checks whatever the ' +
        'walk returns, so anything missing here is a file no underline check has looked at.',
    ).toEqual([])
    expect(
      [...swept].filter((f) => !glob.has(f)).sort(),
      'the walk read files Vite does not see. Either it left the two roots, or the two disagree ' +
        'about what a production source file is.',
    ).toEqual([])
  })
})

/**
 * Every quoted run in a source text. The unit both comment-blankers are compared on.
 *
 * ⚠ WHITESPACE IS COLLAPSED, AND THAT IS THE ONE DIFFERENCE THE TWO ARE ALLOWED. `stripComments`
 * DELETES a comment's bytes; `blankComments` replaces them with spaces. Where the naive quote
 * pairing runs a "fragment" across a comment — an apostrophe in prose is enough — the two texts
 * then differ by exactly that run of spaces and by nothing else. Collapsing it compares the
 * DECISIONS rather than the padding; any other divergence still fails.
 */
function quotedFragments(text: string): string[] {
  return [...text.matchAll(/['"`]([^'"`]*)['"`]/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
}

/** The rule itself, on one class list. Exported shape so the controls can exercise it directly. */
export function lacksRestingUnderline(fragment: string): boolean {
  if (!/(^|\s)hover:underline(\s|$)/.test(fragment)) return false
  return !/(^|\s)underline(\s|$)/.test(fragment)
}

interface Offender {
  file: string
  line: number
  classList: string
}

/**
 * ⚠ IT JUDGES THE QUOTED FRAGMENT, NOT THE WHOLE CALL, so `cn('a b', cond && 'hover:underline')`
 * is read as the fragment it is — a fragment carrying the hover class and no resting one is an
 * offender even when another fragment in the same call has an `underline`. That is the strict
 * reading on purpose: the two fragments need not both apply.
 */
function offendersIn(file: string): Offender[] {
  const rel = relative(REPO, file)
  const out: Offender[] = []
  blankComments(readFileSync(file, 'utf8'))
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(/['"`]([^'"`]*)['"`]/g)) {
        const frag = m[1].trim()
        if (!lacksRestingUnderline(frag)) continue
        if (NAMES_THE_CLASS[`${rel}|${frag}`] !== undefined) continue
        out.push({ file: rel, line: i + 1, classList: frag })
      }
    })
  return out
}

describe('a link needs an affordance at rest, not only under a pointer', () => {
  it('no class list makes `hover:underline` its only underline', () => {
    const offenders = FILES.flatMap(offendersIn)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : 'class list(s) whose ONLY underline is on :hover — a touch device never enters that ' +
            'state, so the control has no visible affordance ever. Underline at rest (Crumbs in ' +
            `areas/docs/components.tsx is the shape):\n${offenders
              .map((o) => `  ${o.file}:${o.line}  "${o.classList}"`)
              .join('\n')}`,
    ).toEqual([])
  })

  /**
   * THE FLOOR — the sweep must prove it read the product.
   *
   * ⚠ A GUARD THAT MATCHES NOTHING PASSES, and this repo has shipped that twice. The offender
   * rule above is SILENT when the product is correct, which is the same output a walker rooted at
   * an empty directory produces. So the walk is asserted against files that must be inside it.
   */
  it('the sweep reads both packages and reaches the files this rule was measured on', () => {
    const rels = FILES.map((p) => relative(REPO, p))
    expect(FILES.length).toBeGreaterThan(60)
    for (const f of [
      'apps/web/src/areas/track/IssueList.tsx',
      'apps/web/src/areas/docs/components.tsx',
      'apps/web/src/focusAudit.ts',
      'packages/ui/src/lib/focus.ts',
      'packages/ui/src/components/Button.tsx',
    ]) {
      expect(rels, `${f} is outside the sweep`).toContain(f)
    }
  })

  /**
   * THE OTHER DIRECTION — the predicate must still say YES to the shape it forbids.
   *
   * ⚠ WITHOUT THIS, BLINDING THE PREDICATE IS INVISIBLE. `lacksRestingUnderline` returning false
   * for every input passes the offender rule AND the floor above, which asserts the WALK and
   * never the MATCH. Exercised on strings, so it stays meaningful while the product is clean —
   * the state the offender rule cannot be trusted in.
   */
  it('the predicate catches the forbidden shape and clears the permitted one', () => {
    expect(lacksRestingUnderline('underline-offset-2 hover:underline')).toBe(true)
    expect(lacksRestingUnderline('hover:underline')).toBe(true)
    expect(lacksRestingUnderline('text-caption hover:underline text-muted')).toBe(true)

    expect(lacksRestingUnderline('underline underline-offset-2 hover:underline')).toBe(false)
    expect(lacksRestingUnderline('underline underline-offset-2')).toBe(false)
    expect(lacksRestingUnderline('no-underline')).toBe(false)
    expect(lacksRestingUnderline('group-hover:underline')).toBe(false)
  })

  /**
   * THE COMMENT BLANKER IS LOAD-BEARING AND IS NOT TRUSTED ON ITS OWN WORD.
   *
   * `stripComments` is the positive-controlled one (typeface.test.tsx, both directions). This
   * asserts the local offset-preserving copy makes the SAME decisions on every file in both
   * packages, judged on the quoted fragments each yields — the unit this guard actually consumes.
   */
  it('blankComments agrees with stripComments on every file in both packages', () => {
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8')
      expect(quotedFragments(blankComments(src)), relative(REPO, f)).toEqual(
        quotedFragments(stripComments(src)),
      )
    }
  })

  it('blankComments preserves line numbers, which is the whole reason it exists', () => {
    const src = 'const a = 1\n/* two\n   three */\nconst b = "hover:underline"\n'
    expect(blankComments(src).split('\n').length).toBe(src.split('\n').length)
    expect(blankComments(src).split('\n')[3]).toContain('hover:underline')
    // and the stripping half still happened
    expect(blankComments('/* hover:underline */').trim()).toBe('')
  })

  /**
   * Crumbs explains the rule in a comment that contains the class. Read RAW that paragraph is an
   * offender; read BLANKED it is prose. Pinned so nobody can drop the blanking and stay green.
   */
  it('Crumbs’ explanation is prose, not an offender', () => {
    const p = resolve(WEB_SRC, 'areas/docs/components.tsx')
    const raw = readFileSync(p, 'utf8')
    expect(raw, 'components.tsx no longer explains the rule — re-point this pin').toContain(
      'hover:underline',
    )
    expect(blankComments(raw)).not.toContain('hover:underline')
    expect(offendersIn(p)).toEqual([])
  })

  /**
   * ⚠ THE CLASSIFICATION IS CHECKED BOTH WAYS. An entry whose fragment no longer occurs in that
   * file is STALE and fails — otherwise this table is a place to put things that fail, which is
   * exactly what `9e03e50` and `planes.ts` were written to prevent.
   */
  it('every NAMES_THE_CLASS entry still names a class that is really there', () => {
    for (const key of Object.keys(NAMES_THE_CLASS)) {
      const [rel, frag] = key.split('|')
      expect(
        rel.endsWith('.tsx'),
        `${rel} is a .tsx file, so it can apply a class list to an element. This table classifies ` +
          'occurrences that NAME the class; it is not a place to silence one that applies it.',
      ).toBe(false)
      const src = blankComments(readFileSync(resolve(REPO, rel), 'utf8'))
      expect(
        quotedFragments(src).map((s) => s.trim()),
        `${rel} no longer contains the fragment "${frag}" in code — this entry is stale, delete it`,
      ).toContain(frag)
      expect(lacksRestingUnderline(frag), `${frag} is not the shape this table classifies`).toBe(
        true,
      )
    }
  })
})
