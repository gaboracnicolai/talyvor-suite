import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { MuNumeral, caseSafeRuns, replacesCharacter as replacesInComponent } from '@talyvor/ui'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { stripComments } from '../../../packages/ui/src/lib/sourceText'

import {
  MICRO_SIGN,
  MUST_PROTECT_MICRO_SIGN,
  TRANSFORM_CLASSES,
  type Transform,
  auditedCaseOffenders,
  caseOffendersIn,
  codePointOf,
  protectedCharactersIn,
  replacesCharacter,
  replacedIn,
  transformInEffect,
} from './caseAudit'

afterEach(cleanup)

/** Build DETACHED DOM. ⚠ Never attach an offending fixture to document.body: the running audit in
 *  test-setup.ts watches the document, so an offending fixture would fail THIS file. */
function fixture(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

// ── RULE 2: THE VOCABULARY, PINNED BY HAND ───────────────────────────────────────────────────
//
// Rule 1 is the predicate: it COMPUTES whether a transform replaces a character, so it needs no
// list and covers characters nobody has thought of. Rule 2 is this table, written out by hand from
// the measurement, and it exists because rule 1 can be narrowed. Both implementations —
// caseAudit.ts's and packages/ui's CaseSafe — are held to it, so narrowing them TOGETHER (which is
// the only way to blind the audit without leaving the fix obviously broken) is still red.
//
// This is the same "one corpus, two implementations" shape talyvor-code uses for the command guard,
// for the same reason: the guard must not ask the fix what the answer is.

const REPLACED: [string, string, string][] = [
  ['µ', 'Μ', 'U+00B5 MICRO SIGN → U+039C GREEK CAPITAL MU. The SI prefix this product renders.'],
  ['ß', 'SS', 'one character becomes two'],
  ['ﬁ', 'FI', 'the fi ligature decomposes'],
  ['ŉ', 'ʼN', 'a letter becomes punctuation plus a letter'],
  ['ı', 'I', 'dotless i loses its identity — I lowercases back to i, not ı'],
  ['ς', 'Σ', 'final sigma is not recoverable from the capital'],
]

/**
 * U+03BC GREEK SMALL LETTER MU, built from its codepoint and NEVER written as a literal.
 *
 * ⚠ THIS IS NOT FASTIDIOUSNESS, IT IS THE ONLY WAY THE RULE BELOW STAYS UNIVERSAL. The last test in
 * this file forbids U+03BC in the code of either package. A guard has to name the thing it forbids,
 * which normally forces an exemption for the guard's own file — and an exemption for the one file
 * that tests the rule is exactly the hole a rule like this dies of. Constructing the character
 * instead means the sweep needs no exemption at all and this file is policed like every other.
 */
const GREEK_SMALL_MU = String.fromCodePoint(0x3bc)
const GREEK_CAPITAL_MU = String.fromCodePoint(0x39c)

const RE_CASED: [string, string][] = [
  ['a', 'A'],
  ['z', 'Z'],
  ['é', 'É'],
  ['ü', 'Ü'],
  [GREEK_SMALL_MU, GREEK_CAPITAL_MU],
]

const UNCHANGED = ['A', 'Z', '0', '9', '$', '%', '≈', '.', ',', '-', '_', '/', ' ', 'Μ', 'L', 'X', 'C']

describe('the casing predicate', () => {
  it('names every character a casing transform REPLACES, with what it becomes', () => {
    for (const [ch, becomes, why] of REPLACED) {
      expect(replacesCharacter(ch, 'uppercase'), `${codePointOf(ch)} — ${why}`).toBe(true)
      expect(ch.toUpperCase(), `${codePointOf(ch)} maps to ${becomes}`).toBe(becomes)
    }
  })

  it('does NOT fire on a character that is merely re-cased — the eyebrow must keep working', () => {
    for (const [ch, upper] of RE_CASED) {
      expect(replacesCharacter(ch, 'uppercase'), codePointOf(ch)).toBe(false)
      expect(ch.toUpperCase()).toBe(upper)
    }
    // The whole point: `uppercase` on the letters of a unit is the INTENDED effect. A rule that
    // flagged this would have to be deleted to ship anything, which is how guards die.
    expect(replacedIn('lxc', 'uppercase')).toEqual([])
    expect(replacedIn('lens', 'uppercase')).toEqual([])
    expect(replacedIn('CONTRIBUTORS IN THE POOL', 'uppercase')).toEqual([])
  })

  it('does NOT fire on a character the transform leaves alone', () => {
    for (const ch of UNCHANGED) {
      expect(replacesCharacter(ch, 'uppercase'), codePointOf(ch)).toBe(false)
    }
  })

  it('agrees with the independent implementation in packages/ui, character for character', () => {
    // ⚠ DRIFT IS THE FAILURE THIS CATCHES. Two implementations exist so the guard does not ask the
    // fix what counts as hazardous; that only helps if they are held together.
    for (const [ch] of REPLACED) expect(replacesInComponent(ch)).toBe(true)
    for (const [ch] of RE_CASED) expect(replacesInComponent(ch)).toBe(false)
    for (const ch of UNCHANGED) expect(replacesInComponent(ch)).toBe(false)
  })

  it('is inert under the transform the fix applies', () => {
    // `normal-case` sets text-transform:none, so nothing may be reported under it — otherwise the
    // fix would be an offender and the guard would have to be deleted to ship.
    expect(replacedIn('µLXC list', 'none')).toEqual([])
    expect(replacesCharacter(MICRO_SIGN, 'none')).toBe(false)
  })
})

/**
 * TAILWIND HAS FOUR CASING UTILITIES AND THE AUDIT MODELS TWO. This is what makes that honest.
 *
 * ⚠ THE REASON FOR THE REFUSAL IS A MEASUREMENT, NOT A PREFERENCE. Listing all four in caseAudit.ts
 * meant merely SPELLING `capitalize` and `lowercase` in a file inside the Tailwind content set, and
 * Tailwind's extractor reads raw text — so the words compiled `.capitalize` and `.lowercase` into
 * the shipped stylesheet with nothing rendering either. Measured against a clean worktree at
 * `dc0bd07`: 344 → 346 emitted class names, +74 bytes. That is W1.8's exact shape, and this merge
 * would have added two instances of the open item it was not fixing.
 *
 * So the audit models what exists and this sweep refuses what does not, in BOTH directions: a
 * casing utility appearing in either package fails until somebody classifies it in TRANSFORM_CLASSES
 * (where it belongs, with whatever the µ consequence turns out to be), and a name classified there
 * that no longer appears in the product fails as stale. Naming the two forbidden utilities is free
 * HERE because the content globs exclude `*.test.tsx` — verified by the same before/after build.
 *
 * ⚠ FOR WHOEVER CLASSIFIES ONE: `capitalize` IS a hazard for µ and `lowercase` is not.
 * µ.toUpperCase() is Μ; µ.toLowerCase() is µ. And `capitalize` only maps a WORD-INITIAL character,
 * which is exactly where µLXC's µ sits — so "µLXC list" under capitalize renders "ΜLXC List".
 */
// ⚠ THIS FILE SWEEPS TWICE, OVER TWO DIFFERENT POPULATIONS, AND BOTH WALKS USED TO BE WRITTEN
// INLINE INSIDE THE `it()` THAT USED THEM. Lifted here unchanged so the population assertion
// below can compare THE WALK UNDER TEST rather than a third walk written next to it, which would
// be free to drift from both. The two differ in exactly one way and it is deliberate: the casing
// vocabulary is a claim about the PRODUCT, while the U+03BC rule is a claim about every source
// byte in either package — a test file that types U+03BC is as much a way past the audit as a
// component that does.
const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const SWEEP_ROOTS = [resolve(REPO_ROOT, 'apps/web/src'), resolve(REPO_ROOT, 'packages/ui/src')]

function sweepFiles(includeTests: boolean): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) return walk(p)
      if (!/\.tsx?$/.test(e.name)) return []
      return includeTests || !/\.test\.tsx?$/.test(e.name) ? [p] : []
    })
  return SWEEP_ROOTS.flatMap(walk)
}

/**
 * ⚠ THE POPULATION IS ASSERTED, BECAUSE A COMPLETE WALK IS NOT A GUARANTEED ONE. Measured at
 * `033d0a5` by recording every path this test opens — `node:fs` wrapped inside the vitest worker,
 * `~/talyvor-queue/w11-population-census-4b2e.py` — this file reads 102 of the 102 production
 * files under its two roots. Its population is WHOLE today. Nothing here said so, and the two
 * floors it already carries (`files.length > 40`, twice) cannot say it: with the walk made to
 * skip `areas/docs` and nothing else changed, this file stayed GREEN
 * (`~/talyvor-queue/w11-stoppedwalk-controls-4b2e.py`, where all five sweeps in this class were
 * green on the same mutation). The two `some(... includes('/packages/ui/src/components/'))`
 * anchors below cannot say it either: ONE surviving file in each of two directories satisfies
 * membership by prefix, which is the weaker shape tab-3a6d measured on `glyphAudit`.
 *
 * `import.meta.glob` is resolved by Vite at TRANSFORM time and touches `node:fs` not at all, so a
 * wrong root, a changed extension filter or a walk that stops descending cannot move both
 * enumerations the same way. BOTH populations are compared, BOTH DIRECTIONS — checking only the
 * production one would leave the U+03BC rule, the stricter of the two, unasserted.
 *
 * ⚠ THE CALL IS LITERAL ON PURPOSE. Vite rewrites `import.meta.glob` by matching the SYNTAX at
 * transform time; hoisting the patterns into a variable typechecks and then dies at runtime.
 */
describe('the sweep reads the whole tree', () => {
  // ⚠ `import.meta.glob` never returns the module that CONTAINS the call, so Vite cannot see this
  // file while the tests-included walk can. Subtracted by name from the walk side, with the rule
  // below asserting the walk really does still hold it so the subtraction cannot become a hole.
  const SELF = 'apps/web/src/caseAudit.test.tsx'
  const rel = (p: string) => p.slice(REPO_ROOT.length + 1)
  const globbed = Object.keys(
    import.meta.glob(['./**/*.{ts,tsx}', '../../../packages/ui/src/**/*.{ts,tsx}']),
  ).map((k) => rel(resolve(import.meta.dirname, k)))

  it('finds a substantial tree across both roots, so an empty anchor cannot pass', () => {
    // Far below the count at `033d0a5`: this catches a root that resolves to nothing, not a
    // refactor that moves files. The set comparisons below are what catch a skip.
    expect(globbed.length).toBeGreaterThan(120)
  })

  it('the tests-included walk still reads this file, so subtracting it stays honest', () => {
    expect(sweepFiles(true).map(rel)).toContain(SELF)
  })

  for (const [label, includeTests] of [
    ['the production sweep — the casing vocabulary', false],
    ['the every-source sweep — the U+03BC rule', true],
  ] as const) {
    it(`${label}: the fs walk and Vite’s glob agree, both directions`, () => {
      const swept = new Set(sweepFiles(includeTests).map(rel).filter((p) => p !== SELF))
      const glob = new Set(
        globbed.filter((p) => (includeTests ? true : !/\.test\.tsx?$/.test(p)) && p !== SELF),
      )
      expect(
        [...glob].filter((f) => !swept.has(f)).sort(),
        'Vite sees files this walk never read. Every rule here is applied to whatever the walk ' +
          'returns, so a file missing from it is one the audit has never been run against.',
      ).toEqual([])
      expect(
        [...swept].filter((f) => !glob.has(f)).sort(),
        'the walk read files Vite does not see. Either it left the two roots, or the two ' +
          'disagree about what a source file is.',
      ).toEqual([])
    })
  }
})

describe('the casing vocabulary, both directions', () => {
  const CLASSIFIED = Object.keys(TRANSFORM_CLASSES)
  const UNCLASSIFIED = ['capitalize', 'lowercase']

  const sources = () => sweepFiles(false)

  it('the sweep reaches both packages — it must not pass by looking at nothing', () => {
    const files = sources()
    expect(files.length).toBeGreaterThan(40)
    expect(files.some((f) => f.includes('/packages/ui/src/components/'))).toBe(true)
    expect(files.some((f) => f.includes('/apps/web/src/areas/'))).toBe(true)
  })

  it('no product file uses an UNCLASSIFIED casing utility', () => {
    const offenders: string[] = []
    for (const f of sources()) {
      const code = stripComments(readFileSync(f, 'utf8'))
      for (const cls of UNCLASSIFIED) {
        if (new RegExp(`\\b${cls}\\b`).test(code)) offenders.push(`${f.split('/src/')[1]}: ${cls}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every CLASSIFIED utility is still used by the product — a stale entry fails', () => {
    const code = sources()
      .map((f) => stripComments(readFileSync(f, 'utf8')))
      .join('\n')
    for (const cls of CLASSIFIED) {
      expect(new RegExp(`\\b${cls}\\b`).test(code), `${cls} is classified but nothing uses it`).toBe(
        true,
      )
    }
  })
})

describe('the transform in effect', () => {
  it('is inherited, and the NEAREST declaration wins — which is what makes the fix work', () => {
    const root = fixture(
      '<div class="uppercase"><span id="bare">µ</span><span id="safe" class="normal-case">µ</span></div>',
    )
    expect(transformInEffect(root.querySelector('#bare')).transform).toBe('uppercase')
    expect(transformInEffect(root.querySelector('#safe')).transform).toBe('none')
  })

  it('is "none" when no ancestor declares one, so ordinary prose is not policed', () => {
    const root = fixture('<p><span id="t">822 µLENS held</span></p>')
    expect(transformInEffect(root.querySelector('#t')).transform).toBe('none')
    expect(caseOffendersIn(root)).toEqual([])
  })

  it('matches whole classes only — a class merely CONTAINING "uppercase" is not the utility', () => {
    const root = fixture('<div class="tal-uppercase-note"><span id="t">µLXC</span></div>')
    expect(transformInEffect(root.querySelector('#t')).transform).toBe('none')
  })
})

describe('the audit over rendered DOM', () => {
  it('catches the shape the marketing page shipped, and names the codepoint', () => {
    const root = fixture(
      '<span class="font-figure text-eyebrow uppercase text-faint">µLXC list</span>',
    )
    const off = caseOffendersIn(root)
    expect(off).toHaveLength(1)
    expect(off[0].codePoint).toBe('U+00B5')
    expect(off[0].becomes).toBe('Μ')
    expect(off[0].transform).toBe('uppercase')
    expect(off[0].text).toBe('µLXC list')
  })

  it('passes the MuNumeral shape — a normal-case span inside an uppercase label', () => {
    const root = fixture(
      '<span class="font-figure text-eyebrow uppercase text-muted">' +
        '<span class="normal-case">µ</span>lxc</span>',
    )
    expect(caseOffendersIn(root)).toEqual([])
    expect(protectedCharactersIn(root, MICRO_SIGN)).toBe(1)
  })

  it('reads OWN text, so a µ in a child is attributed to the child that carries the class', () => {
    // If it read textContent instead, the outer uppercase span would be blamed for a µ that its
    // normal-case child has already protected — a false positive on the correct code.
    const root = fixture(
      '<span class="uppercase"><span class="normal-case">µ</span>lxc</span>',
    )
    expect(caseOffendersIn(root)).toEqual([])
  })

  it('counts a protected µ as protected only while a transform is actually in effect', () => {
    // ⚠ THIS IS THE FLOOR'S TEETH. A µ in untransformed prose must NOT count, or the floor would be
    // satisfiable with the audit switched off — most µ in this product are exactly that.
    const prose = fixture('<p>822 µLENS held</p>')
    expect(protectedCharactersIn(prose, MICRO_SIGN)).toBe(0)
    const guarded = fixture('<span class="uppercase"><span class="normal-case">µ</span>lens</span>')
    expect(protectedCharactersIn(guarded, MICRO_SIGN)).toBe(1)
  })
})

describe('CaseSafe, the fix', () => {
  it('keeps the visible text byte-identical while splitting it', () => {
    for (const s of ['µLXC list', 'µLENS earned', 'lxc', '', 'µ', 'per µLXC and µLENS']) {
      expect(caseSafeRuns(s).map((r) => r.text).join('')).toBe(s)
    }
  })

  it('protects exactly the replaced characters and nothing else', () => {
    const runs = caseSafeRuns('µLXC list')
    expect(runs).toEqual([
      { text: 'µ', protect: true },
      { text: 'LXC list', protect: false },
    ])
    expect(caseSafeRuns('lxc').every((r) => !r.protect)).toBe(true)
  })

  /**
   * ⚠ A MEASURED CONSEQUENCE, PINNED SO NOBODY "FIXES" IT BY DELETING THE PROTECTION.
   *
   * CaseSafe splits the label, so no element's OWN text is "µLXC list" any more — and Testing
   * Library's default text matcher reads own text. Measured: `getByText(/µLXC list/)` now fails
   * with "the text is broken up by multiple elements". The honest response is to assert on
   * `textContent`, which is what Landing.test.tsx does.
   *
   * Checked rather than assumed: NO pre-existing test matched a protected label by text — every
   * µLXC/µLENS occurrence in every test file in both packages was a comment. So this cost was paid
   * by one new test, not by loosening an old one.
   */
  it('splits the label, so an OWN-TEXT query no longer matches it', () => {
    const root = fixture('<span class="uppercase">µLXC list</span>')
    const before = root.querySelector('span')
    expect(before?.textContent).toBe('µLXC list')

    const own = (el: Element) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.nodeValue)
        .join('')
    // The pre-fix element answers an own-text query; the post-fix wrapper does not.
    expect(own(before as Element)).toBe('µLXC list')
    const { container } = render(
      <span className="uppercase">
        <span className="normal-case">µ</span>
        <span>LXC list</span>
      </span>,
    )
    const after = container.querySelector('span') as Element
    expect(own(after)).toBe('')
    expect(after.textContent).toBe('µLXC list')
  })
})

describe('the running audit cannot go blind', () => {
  /**
   * ⚠ TRAP THREE, INHERITED FROM figureAudit.ts AND RE-PINNED HERE RATHER THAN TRUSTED. Testing
   * Library's cleanup is registered after this setup file and vitest runs afterEach hooks
   * last-registered-first, so a setup-file afterEach scans an EMPTY body. Capture is at commit time
   * through a MutationObserver; these two tests prove the record outlives the DOM that produced it.
   */
  it('records a protected µ while it is on screen', () => {
    render(<MuNumeral micros={64} unit="lxc" />)
    expect(protectedCharactersIn(document.body, MICRO_SIGN)).toBeGreaterThan(0)
  })

  it('and the record survives into the next test, with the body verifiably empty', () => {
    expect(document.body.textContent).toBe('')
    // Nothing to assert about offenders — the product has none — so the observable is that the
    // audit ran at all and its record is readable here.
    expect(Array.isArray(auditedCaseOffenders() as unknown[])).toBe(true)
    expect(protectedCharactersIn(document.body, MICRO_SIGN)).toBe(0)
  })
})

describe('the floor', () => {
  it('every file in MUST_PROTECT_MICRO_SIGN exists, with a reason', () => {
    const appRoot = resolve(import.meta.dirname, '..')
    const missing = Object.keys(MUST_PROTECT_MICRO_SIGN).filter(
      (f) => !existsSync(resolve(appRoot, f)),
    )
    expect(missing).toEqual([])
    expect(Object.values(MUST_PROTECT_MICRO_SIGN).every((r) => r.length > 10)).toBe(true)
    expect(Object.keys(MUST_PROTECT_MICRO_SIGN).length).toBeGreaterThanOrEqual(4)
  })

  it('does not list this file — a guard must not be its own floor', () => {
    expect(MUST_PROTECT_MICRO_SIGN['src/caseAudit.test.tsx']).toBeUndefined()
  })
})

describe('the hole in the predicate, closed from the other side', () => {
  /**
   * ⚠ STATED IN caseAudit.ts AND ENFORCED HERE. `μ` U+03BC (GREEK SMALL LETTER MU) uppercases to
   * Μ and back to μ, so it round-trips and the predicate correctly calls it safe — flagging it
   * would flag Greek prose. A µ typed as U+03BC would therefore be uppercased with nothing
   * reported. So the product may not contain U+03BC at all: it is not the micro sign, it is
   * silently unequal to it in every string comparison, and it is the one way past this audit.
   */
  it('no source file in either package writes U+03BC in CODE', () => {
    const repoRoot = REPO_ROOT
    const files = sweepFiles(true)
    // ⚠ The sweep must not pass by reading nothing — the `grep -a` lesson from W4.5.
    expect(files.length).toBeGreaterThan(40)

    // ⚠ THE FIRST VERSION OF THIS TEST FAILED ON THE THREE FILES OF THIS MERGE, AND WAS RIGHT TO.
    // caseAudit.ts, CaseSafe.tsx and this file all DOCUMENT the U+03BC hole, so they all contain
    // U+03BC — the W1.8 trap, in a rule's own explanation of itself. `stripComments` is the repo's
    // one stripper, positive-controlled in typeface.test.tsx; it is reused rather than re-written.
    const carriers = files.filter((f) =>
      stripComments(readFileSync(f, 'utf8')).includes(GREEK_SMALL_MU),
    )
    expect(carriers.map((f) => f.replace(repoRoot, ''))).toEqual([])

    // TWO POSITIVE CONTROLS, because "zero after stripping" is also what a stripper that deletes
    // everything returns. (1) the same swept, stripped set still finds U+00B5 in CODE, so the
    // reader opened real files and the stripper left code standing.
    const micro = files.filter((f) => stripComments(readFileSync(f, 'utf8')).includes('µ'))
    expect(micro.length).toBeGreaterThan(5)
    // (2) and the stripper really does hide a comment while keeping code — asserted here rather
    // than assumed from another file's tests. Built from the codepoint for the reason above.
    const m = GREEK_SMALL_MU
    expect(stripComments(`const a = "${m}" // ${m} in a comment`)).toContain(`"${m}"`)
    expect(stripComments(`// only ${m} here`).includes(m)).toBe(false)
  })
})

describe('the classified utilities resolve to the right transform', () => {
  it('maps each classified class to the text-transform it actually sets', () => {
    const expected: Record<string, Transform> = { uppercase: 'uppercase', 'normal-case': 'none' }
    // Both directions against the module, so a renamed key or a re-pointed value fails here.
    expect(Object.keys(TRANSFORM_CLASSES).sort()).toEqual(Object.keys(expected).sort())
    const root = fixture(
      Object.keys(expected)
        .map((c) => `<span class="${c}" id="${c}">x</span>`)
        .join(''),
    )
    for (const [cls, transform] of Object.entries(expected)) {
      expect(transformInEffect(root.querySelector(`#${CSS.escape(cls)}`)).transform).toBe(transform)
      expect(TRANSFORM_CLASSES[cls as keyof typeof TRANSFORM_CLASSES]).toBe(transform)
    }
  })
})
