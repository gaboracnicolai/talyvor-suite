import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { blankComments, stripComments } from '../../../packages/ui/src/lib/sourceText'

import {
  EYEBROW_CLASS,
  MUST_RENDER_EYEBROW,
  eyebrowOffendersIn,
  isEyebrow,
} from './eyebrowAudit'

/**
 * THE EYEBROW RULE, FROM BOTH SIDES.
 *
 * The running audit in eyebrowAudit.ts reads the DOM every test renders. This file holds the two
 * things that audit cannot supply about itself:
 *
 *  1. THE PREDICATE, EXERCISED ON FIXTURES. The offender rule is SILENT while the product is
 *     correct, which is the same output a blinded predicate produces. Every assertion below runs
 *     on a hand-built fixture, so it stays meaningful in exactly the state the running audit
 *     cannot be trusted in. This is the direction the floor cannot see: `satisfiesEyebrowFloor` is
 *     computed from a SEPARATE walk that asks for the transform directly, so blinding
 *     `eyebrowOffendersIn` leaves the floor green — one catcher each, neither alone.
 *
 *  2. THE SOURCE HALF, WHICH NEEDS NO FIXTURE. `check-audit-reach.mjs` fails CI when an exported
 *     component is never rendered, so the DOM audit's reach is enforced per COMPONENT — but not
 *     per BRANCH. Measured at `ff17b41`: two of the 14 rendered eyebrow shapes appear only TWICE
 *     in the whole suite, so they hang on one fixture each, and a `cond ? …` arm nobody renders is
 *     invisible to the DOM entirely. The source rule reads the literal and closes that.
 */

const WEB_SRC = resolve(import.meta.dirname)
const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const REPO = resolve(import.meta.dirname, '../../..')

/**
 * Occurrences that NAME this class rather than APPLY it to an element.
 *
 * ⚠ A CLASSIFICATION, NOT AN EXEMPTION LIST, held to that by the three checks at the bottom of
 * this file rather than by intent — stale, misfiled, and `.tsx` all fail. Keyed by (file, exact
 * fragment), so another fragment in the same file is still judged.
 *
 * ⚠ THE AUDIT NAMES THE CLASS IT LOOKS FOR, which makes it an offender against its own rule — the
 * shape `1351de9` met when focusAudit's vocabulary list was condemned by the underline rule, and
 * the shape W1.8 is about. It is classified here rather than skipped, so that if the audit ever
 * grows a real class list the entry fails as misfiled instead of silencing it.
 */
const NAMES_THE_CLASS: Record<string, string> = {
  'apps/web/src/eyebrowAudit.ts|text-eyebrow':
    'EYEBROW_CLASS is the audit’s own vocabulary — the token it reads OFF rendered elements to ' +
    'decide whether one is an eyebrow. It is a class NAME, not a class list applied to anything; ' +
    'eyebrowAudit.ts renders nothing.',
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
 * ⚠ THE POPULATION IS ASSERTED, BECAUSE A COMPLETE WALK IS NOT A GUARANTEED ONE. Measured at
 * `033d0a5` by recording every path this test opens — `node:fs` wrapped inside the vitest worker,
 * `~/talyvor-queue/w11-population-census-4b2e.py` — this file reads 102 of the 102 production
 * files under its two roots. Its population is WHOLE today. Nothing here said so, and the floor
 * further down (`FILES.length > 60`) cannot say it: with the walk made to skip `areas/docs` and
 * nothing else changed, this file stayed GREEN — 102 files became 96 and the floor never moved
 * (`~/talyvor-queue/w11-stoppedwalk-controls-4b2e.py`, where all five sweeps in this class were
 * green on the same mutation). That is the shape tab-3a6d measured across this whole class: the
 * floors are satisfied by the survivors, so RAISING one is a threshold nobody measured.
 *
 * `import.meta.glob` is resolved by Vite at TRANSFORM time and touches `node:fs` not at all, so a
 * wrong root, a changed extension filter, a `startsWith('.')` skip that widens, or a walk that
 * stops descending cannot move both enumerations the same way. Compared BOTH DIRECTIONS.
 *
 * ⚠ THE CALL IS LITERAL ON PURPOSE. Vite rewrites `import.meta.glob` by matching the SYNTAX at
 * transform time; hoisting the patterns into a variable typechecks and then dies at runtime.
 */
describe('the sweep reads the whole tree', () => {
  const globbed = Object.keys(
    import.meta.glob(['./**/*.{ts,tsx}', '../../../packages/ui/src/**/*.{ts,tsx}']),
  )
    .filter((k) => !/\.test\.tsx?$/.test(k))
    .map((k) => relative(REPO, resolve(import.meta.dirname, k)))

  it('finds a substantial tree across both roots, so an empty anchor cannot pass', () => {
    // Far below the 102 at `033d0a5`: this catches a root that resolves to nothing, not a
    // refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(60)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', () => {
    const swept = new Set(FILES.map((p) => relative(REPO, p)))
    const glob = new Set(globbed)
    expect(
      [...glob].filter((f) => !swept.has(f)).sort(),
      'Vite sees production files this walk never read. Every rule here is applied to whatever ' +
        'FILES holds, so an eyebrow class in a file missing from it has never been checked.',
    ).toEqual([])
    expect(
      [...swept].filter((f) => !glob.has(f)).sort(),
      'the walk read files Vite does not see. Either it left the two roots, or the two disagree ' +
        'about what a production source file is.',
    ).toEqual([])
  })
})

function quotedFragments(text: string): string[] {
  return [...text.matchAll(/['"`]([^'"`]*)['"`]/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
}

/**
 * The source rule on ONE quoted fragment: a fragment that names the eyebrow token must name the
 * casing utility too.
 *
 * ⚠ IT JUDGES THE FRAGMENT, NOT THE WHOLE CALL. `cn('font-figure text-eyebrow uppercase', cond &&
 * 'font-semibold')` is read as two fragments and only the first is an eyebrow. That is the strict
 * reading on purpose — the two fragments need not both apply, so an eyebrow token that travels
 * without its case in the SAME literal is the thing being forbidden.
 *
 * ⚠ THIS IS STRICTER THAN THE DOM RULE AND THAT IS DELIBERATE. The DOM rule permits an eyebrow to
 * inherit `uppercase` from an ancestor, because that is what the browser does. Source cannot see an
 * ancestor, so it demands the literal — which every one of the 21 call sites in this repo satisfies
 * today. If a surface ever genuinely wants to inherit it, this rule reds and the classification
 * table above is where that gets argued in writing, which is the point.
 */
export function eyebrowWithoutCase(fragment: string): boolean {
  if (!new RegExp(`(^|\\s)${EYEBROW_CLASS}(\\s|$)`).test(fragment)) return false
  return !/(^|\s)uppercase(\s|$)/.test(fragment)
}

interface SourceOffender {
  file: string
  line: number
  fragment: string
}

function sourceOffendersIn(file: string): SourceOffender[] {
  const rel = relative(REPO, file)
  const out: SourceOffender[] = []
  blankComments(readFileSync(file, 'utf8'))
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(/['"`]([^'"`]*)['"`]/g)) {
        const frag = m[1].trim()
        if (!eyebrowWithoutCase(frag)) continue
        if (NAMES_THE_CLASS[`${rel}|${frag}`] !== undefined) continue
        out.push({ file: rel, line: i + 1, fragment: frag })
      }
    })
  return out
}

/** A detached fixture — parsed, never mounted, so the running audit never sees it. */
function fixture(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('the eyebrow’s uppercase is applied at the call site, and something checks that it was', () => {
  // ── THE PREDICATE ──────────────────────────────────────────────────────────────────────────

  it('reports an eyebrow with no casing transform anywhere', () => {
    const off = eyebrowOffendersIn(fixture('<span class="font-figure text-eyebrow text-muted">spent</span>'))
    expect(off).toHaveLength(1)
    expect(off[0].transform).toBe('none')
    expect(off[0].text).toBe('spent')
  })

  it('clears an eyebrow that declares the transform itself', () => {
    expect(
      eyebrowOffendersIn(fixture('<span class="font-figure text-eyebrow uppercase text-muted">spent</span>')),
    ).toEqual([])
  })

  /**
   * ⚠ INHERITANCE IS THE HALF A SOURCE RULE CANNOT ANSWER, so it is pinned here. `text-transform`
   * inherits; an eyebrow inside an uppercase region is already uppercase and reporting it would be
   * a false positive on correct code.
   */
  it('clears an eyebrow that inherits the transform from an ancestor', () => {
    expect(
      eyebrowOffendersIn(fixture('<div class="uppercase"><span class="text-eyebrow">spent</span></div>')),
    ).toEqual([])
  })

  /**
   * ⚠ AND `normal-case` OVER AN EYEBROW IS AN OFFENDER, because the nearest declaration wins. This
   * is the case that separates "has an uppercase ancestor somewhere" from "uppercase is in effect".
   */
  it('reports an eyebrow whose nearest declaration cancels an uppercase further up', () => {
    const off = eyebrowOffendersIn(
      fixture(
        '<div class="uppercase"><div class="normal-case"><span class="text-eyebrow">spent</span></div></div>',
      ),
    )
    expect(off).toHaveLength(1)
    expect(off[0].transform).toBe('none')
  })

  /**
   * ⚠ THE SHAPE THIS RULE AND caseAudit BOTH JUDGE, AND THE REASON THEY CANNOT DISAGREE.
   * MuNumeral opens the eyebrow with `uppercase` and puts CaseSafe's `normal-case` span INSIDE it.
   * The eyebrow element is uppercase (this rule, satisfied); the µ is not (caseAudit, satisfied).
   * If either rule were stated on the wrong element, one of these two assertions would fail.
   */
  it('passes the MuNumeral shape — an uppercase eyebrow with a normal-case child', () => {
    const el = fixture(
      '<span class="font-figure text-eyebrow uppercase text-muted"><span class="normal-case">µ</span>lxc</span>',
    )
    expect(eyebrowOffendersIn(el)).toEqual([])
    // and the child, which is NOT an eyebrow, is not judged by this rule at all
    expect(isEyebrow(el.querySelector('.normal-case')!)).toBe(false)
  })

  it('does not mistake another token that merely contains the word', () => {
    expect(isEyebrow(fixture('<span class="text-eyebrow-ish">x</span>').firstElementChild!)).toBe(false)
    expect(isEyebrow(fixture('<span class="not-text-eyebrow">x</span>').firstElementChild!)).toBe(false)
    expect(isEyebrow(fixture('<span class="text-eyebrow">x</span>').firstElementChild!)).toBe(true)
  })

  it('finds every offender under a root, not merely the first', () => {
    const off = eyebrowOffendersIn(
      fixture(
        '<div><span class="text-eyebrow">a</span><span class="text-eyebrow">b</span>' +
          '<span class="text-eyebrow uppercase">c</span></div>',
      ),
    )
    expect(off.map((o) => o.text)).toEqual(['a', 'b'])
  })

  // ── THE SOURCE HALF ────────────────────────────────────────────────────────────────────────

  it('no class list in either package names the eyebrow without its case', () => {
    const offenders = FILES.flatMap(sourceOffendersIn)
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : 'class list(s) applying `text-eyebrow` with no `uppercase` in the same literal. The ' +
            'token deliberately withholds text-transform (it would map µ to Greek capital Mu), ' +
            `so the call site must supply it:\n${offenders
              .map((o) => `  ${o.file}:${o.line}  "${o.fragment}"`)
              .join('\n')}`,
    ).toEqual([])
  })

  /**
   * THE FLOOR FOR THE SOURCE SWEEP — it must prove it read the product.
   *
   * ⚠ A GUARD THAT MATCHES NOTHING PASSES, and this repo has shipped that more than twice. The
   * rule above is silent when the product is correct, which is what a walker rooted at an empty
   * directory also produces.
   */
  it('the source sweep reads both packages and reaches the files the rule was measured on', () => {
    const rels = FILES.map((p) => relative(REPO, p))
    expect(FILES.length).toBeGreaterThan(60)
    for (const f of [
      'apps/web/src/areas/lens/Members.tsx',
      'apps/web/src/areas/lens/Overview.tsx',
      'apps/web/src/areas/marketing/Landing.tsx',
      'apps/web/src/caseAudit.ts',
      'packages/ui/src/components/MuNumeral.tsx',
      'packages/ui/src/components/Pill.tsx',
    ]) {
      expect(rels, `${f} is outside the sweep`).toContain(f)
    }
  })

  /**
   * ⚠ THE PREDICATE, THE OTHER DIRECTION. Without this, `eyebrowWithoutCase` returning false for
   * everything passes the sweep AND its floor — the floor asserts the WALK and never the MATCH.
   */
  it('the source predicate catches the forbidden shape and clears the permitted one', () => {
    expect(eyebrowWithoutCase('font-figure text-eyebrow text-muted')).toBe(true)
    expect(eyebrowWithoutCase('text-eyebrow')).toBe(true)
    expect(eyebrowWithoutCase('px-3 pb-1 font-figure text-eyebrow font-semibold text-faint')).toBe(true)

    expect(eyebrowWithoutCase('font-figure text-eyebrow uppercase text-muted')).toBe(false)
    expect(eyebrowWithoutCase('text-eyebrow uppercase')).toBe(false)
    expect(eyebrowWithoutCase('font-figure text-caption uppercase')).toBe(false)
    expect(eyebrowWithoutCase('text-eyebrow-ish')).toBe(false)
    expect(eyebrowWithoutCase('')).toBe(false)
  })

  /**
   * ⚠ THE COMMENT BLANKING IS LOAD-BEARING AND THE OFFENDER IS REAL, NOT PLANTED. caseAudit.ts
   * quotes Landing's eyebrow class list inside a doc comment to explain why the rule is not a
   * source rule. Read RAW that paragraph is an offender; read BLANKED it is prose. This is the
   * `sourceText.ts` trap with an actual instance in the tree, so the pin cannot go stale quietly.
   */
  it('caseAudit’s explanation is prose, not an offender', () => {
    const p = resolve(WEB_SRC, 'caseAudit.ts')
    const raw = readFileSync(p, 'utf8')
    expect(raw, 'caseAudit.ts no longer quotes an eyebrow class list — re-point this pin').toContain(
      EYEBROW_CLASS,
    )
    expect(blankComments(raw)).not.toContain(EYEBROW_CLASS)
    expect(sourceOffendersIn(p)).toEqual([])
  })

  /**
   * ⚠ AND THE BLANKER IS NOT TRUSTED ON ITS OWN WORD HERE EITHER. `blankComments` now lives beside
   * `stripComments` in sourceText.ts so there is ONE stripper; this asserts the two still make the
   * same decisions on the fragments THIS guard consumes, over both packages.
   */
  it('blankComments agrees with stripComments on every file this rule reads', () => {
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8')
      expect(quotedFragments(blankComments(src)), relative(REPO, f)).toEqual(
        quotedFragments(stripComments(src)),
      )
    }
  })

  // ── THE TABLES ─────────────────────────────────────────────────────────────────────────────

  /**
   * ⚠ THE CLASSIFICATION IS CHECKED BOTH WAYS — otherwise the table is a place to put things that
   * fail, which is what it must never become.
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
      expect(eyebrowWithoutCase(frag), `${frag} is not the shape this table classifies`).toBe(true)
    }
  })

  /**
   * ⚠ THE FLOOR TABLE NAMES FILES THAT MUST EXIST. A renamed test file would otherwise silently
   * stop being a floor — the entry would simply never match, which is the failure mode a floor
   * exists to prevent in the first place.
   */
  it('every MUST_RENDER_EYEBROW entry names a test file that exists', () => {
    for (const rel of Object.keys(MUST_RENDER_EYEBROW)) {
      expect(() => statSync(resolve(WEB_SRC, '..', rel)), `${rel} is listed as a floor but is not a file`)
        .not.toThrow()
    }
  })
})
