import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// Deep relative import on purpose, the deadClasses.test.ts precedent: ONE implementation of the
// comment stripper, with one set of positive controls.
import { stripComments } from '../../../packages/ui/src/lib/sourceText'
import {
  ARRIVES_AS_DATA,
  AWAITING_A_DECISION,
  coverage,
  effectiveFamily,
  servedFaces,
  unservedGlyphsIn,
  woff2Codepoints,
  woff2FeatureTags,
  woff2WeightClass,
} from './glyphAudit'

const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const font = (name: string) => resolve(UI_SRC, 'fonts', name)
const SANS = font('space-grotesk-latin.woff2')
const MONO_400 = font('ibm-plex-mono-400-latin.woff2')
const MONO_EXT = font('ibm-plex-mono-400-latin-ext.woff2')

/**
 * A table key back to its codepoint.
 *
 * ⚠ THE TESTS BUILD EVERY CLASSIFIED CHARACTER FROM ITS CODEPOINT and never spell one, for the
 * same reason the tables are keyed that way: this file is inside the source set the ban below
 * sweeps, so a spelled `→` here would make the rule find itself and need an exemption for its own
 * test. The characters spelled in THIS file are the ones no table classifies — offenders planted
 * in fixtures, which the ban is supposed to ignore because they live in comments and markup rather
 * than in the product's copy.
 */
function codePointOf(label: string): number {
  const cp = parseInt(label.slice(2), 16)
  expect(Number.isFinite(cp), `table key ${label} is not a U+XXXX label`).toBe(true)
  return cp
}

/** Render a fragment without React — the audit reads a DOM, not a component tree. */
function dom(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('the instrument, before it measures anything', () => {
  /**
   * ⚠ AN INSTRUMENT THAT READS NOTHING IS THIS REPO'S OLDEST TRAP, and here it would fail in the
   * SAFE direction — an empty cmap makes every character an offender and CI screams. The dangerous
   * direction is the opposite: a parser that says "yes" to everything goes green for nothing and
   * looks exactly like a clean product. So both are controlled, on the real shipped binaries.
   *
   * PROVENANCE: this parser was written against fontTools 4.63.0 and agrees with it EXACTLY on all
   * eight shipped files — not the counts, the SETS, all 2,090 codepoints, zero disagreement.
   */
  it('finds characters a real subset HAS', () => {
    const cps = woff2Codepoints(MONO_400)
    for (const ch of 'aZ09$%.,-_/µ·—’…') {
      expect(cps.has(ch.codePointAt(0)!), `${JSON.stringify(ch)} should be in the mono subset`).toBe(true)
    }
  })

  it('reports characters a real subset LACKS — it does not say yes to everything', () => {
    const cps = woff2Codepoints(MONO_400)
    // ≈ is the finding this guard exists for; 漢 and ⚠ are simply not in a latin subset.
    for (const ch of '≈⚠→←漢') {
      expect(cps.has(ch.codePointAt(0)!), `${JSON.stringify(ch)} must NOT be in the mono subset`).toBe(false)
    }
  })

  it('the two subsets of one face differ, so the parser is reading the FILE and not a constant', () => {
    const latin = woff2Codepoints(MONO_400)
    const ext = woff2Codepoints(MONO_EXT)
    expect(latin.size).toBeGreaterThan(100)
    expect(ext.size).toBeGreaterThan(100)
    // Measured: the -ext subset carries no digits at all. If these ever came back equal, the
    // parser would be returning something other than what it was asked for.
    expect(latin.has(0x30)).toBe(true)
    expect(ext.has(0x30)).toBe(false)
    expect([...latin].sort().join()).not.toBe([...ext].sort().join())
  })

  it('a file that is not a woff2 throws rather than scoring as empty coverage', () => {
    // The silent-empty failure mode, closed: theme.css is a real file and readable, so a parser
    // that shrugged would return an empty set and red the entire product for the wrong reason.
    expect(() => woff2Codepoints(resolve(UI_SRC, 'theme.css'))).toThrow(/not a woff2/)
  })
})

describe('the served faces, read from theme.css and the binaries', () => {
  it('parses every @font-face the stylesheet declares, and reaches both families', () => {
    const faces = servedFaces()
    expect(faces.length).toBe(8)
    expect(faces.filter((f) => f.family === 'sans').length).toBe(2)
    expect(faces.filter((f) => f.family === 'mono').length).toBe(6)
    for (const f of faces) {
      expect(f.ranges.length, `${f.file} declared no unicode-range`).toBeGreaterThan(0)
      expect(f.codepoints.size, `${f.file} carried no glyphs`).toBeGreaterThan(100)
    }
  })

  /**
   * ⚠ THE MONO FAMILY IS THREE STATIC FILES AND THE SANS IS ONE VARIABLE RANGE, and that is the
   * fact behind `coverage()` requiring EVERY declaring face to have the character: an element
   * renders at one weight, chosen by the cascade, and this guard cannot know which.
   */
  /**
   * ⚠ THE DESCRIPTOR IS A CLAIM ABOUT THE FILE, AND C7 PROVED NOTHING WAS CHECKING IT. Repointing
   * the 600 face at the 500 binary passed every test in this repo — semibold mono would have
   * rendered one step light on every surface, silently, exactly the failure theme.css warns about
   * for a MISSING file. The static faces are asked what weight they actually are.
   *
   * The sans is excluded on purpose rather than by omission: it is a VARIABLE face declared
   * `400 700`, and its usWeightClass is 300 (the default instance), so the descriptor and the
   * binary are not supposed to agree there. Its range is covered by the test above.
   */
  it('each static mono face IS the weight theme.css declares it to be', () => {
    const statics = servedFaces().filter((f) => /^\d+$/.test(f.weight))
    expect(statics.length).toBe(6)
    for (const f of statics) {
      expect(woff2WeightClass(f.file), `${f.file} is declared ${f.weight}`).toBe(Number(f.weight))
    }
  })

  it('the mono weights are three separate files and the sans is a range', () => {
    const weights = (fam: 'sans' | 'mono') =>
      [...new Set(servedFaces().filter((f) => f.family === fam).map((f) => f.weight))].sort()
    expect(weights('mono')).toEqual(['400', '500', '600'])
    expect(weights('sans')).toEqual(['400 700'])
  })

  /**
   * ⚠ THE FIGURE FACE'S tnum IS INERT, MEASURED RATHER THAN ASSUMED — and this pins it because
   * three separate comments describe `font-figure` as a different face from `font-mono`.
   *
   * preset.ts defines `figure: ['var(--mono)', { fontFeatureSettings: '"tnum" 1' }]`, and the
   * served IBM Plex Mono subsets declare NO `tnum` feature, so the setting has nothing to enable.
   * (Supporting measurement, made out of band with fontTools and not asserted here because it
   * needs the transformed `hmtx`: all ten digits in the mono subsets already advance 600 units, so
   * tabular figures are what the face does anyway and `tnum` would be a no-op even if present.)
   *
   * ⚠ BOTH DIRECTIONS. The SANS has `tnum` — nine distinct digit advances, so it genuinely needs
   * it — which is what makes "mono has none" a measurement rather than a parser returning nothing.
   * The rule that keeps money on `font-figure` is NOT changed by this and must not be: one named
   * utility for figures is still worth having. What changes is the REASON written beside it.
   */
  it('the mono faces implement no tnum, and the sans does', () => {
    for (const f of servedFaces().filter((x) => x.family === 'mono')) {
      expect(woff2FeatureTags(f.file).has('tnum'), `${f.file} unexpectedly implements tnum`).toBe(false)
    }
    expect(woff2FeatureTags(SANS).has('tnum')).toBe(true)
  })
})

describe('the coverage verdict', () => {
  it('an ordinary character is served by both families', () => {
    for (const ch of 'A0$µ—') {
      expect(coverage('sans', ch.codePointAt(0)!)).toBe('served')
      expect(coverage('mono', ch.codePointAt(0)!)).toBe('served')
    }
  })

  it('the four found characters are undeclared by every face', () => {
    for (const ch of '≈⚠→←') {
      expect(coverage('sans', ch.codePointAt(0)!)).toBe('undeclared')
      expect(coverage('mono', ch.codePointAt(0)!)).toBe('undeclared')
    }
  })

  /**
   * ⚠ MEASURED, AND SAID RATHER THAN IMPLIED: no PRINTABLE character currently reaches this
   * verdict. The only codepoints these subsets declare and do not contain are the 33 C1 controls,
   * which `isRenderable` filters out before the audit ever asks. The branch is exercised here on a
   * real one so it is not dead code, and it becomes load-bearing the moment a re-subset drops a
   * glyph from one weight and not another.
   */
  it('declared-but-absent is a distinct verdict from undeclared', () => {
    expect(coverage('sans', 0x7f)).toBe('declared-but-absent')
    expect(coverage('sans', 0x2248)).toBe('undeclared')
  })
})

describe('the family an element renders in', () => {
  it('defaults to the sans, because the body sets it', () => {
    expect(effectiveFamily(dom('<span>x</span>').firstElementChild)).toBe('sans')
  })

  it('font-figure and font-mono are both the mono family', () => {
    expect(effectiveFamily(dom('<span class="font-figure">x</span>').firstElementChild)).toBe('mono')
    expect(effectiveFamily(dom('<span class="font-mono">x</span>').firstElementChild)).toBe('mono')
  })

  it('it comes from an ANCESTOR, which is the reason this reads a tree and not a line', () => {
    const root = dom('<div class="font-figure"><p><span>x</span></p></div>')
    expect(effectiveFamily(root.querySelector('span'))).toBe('mono')
  })

  it('the NEAREST family wins, as the cascade does', () => {
    const root = dom('<div class="font-figure"><span class="font-sans">x</span></div>')
    expect(effectiveFamily(root.querySelector('span'))).toBe('sans')
  })
})

describe('the audit over rendered markup', () => {
  it('names an unservable character, its family and the element that renders it', () => {
    const found = unservedGlyphsIn(dom('<span class="font-figure text-body">≈ $12.35</span>'))
    expect(found.length).toBe(1)
    expect(found[0].codePoint).toBe('U+2248')
    expect(found[0].family).toBe('mono')
    expect(found[0].coverage).toBe('undeclared')
    expect(found[0].text).toBe('≈ $12.35')
  })

  it('the SAME character in the sans is reported against the sans faces', () => {
    const found = unservedGlyphsIn(dom('<p>⚠ Deleting your account</p>'))
    expect(found.map((f) => [f.codePoint, f.family])).toEqual([['U+26A0', 'sans']])
  })

  it('markup the faces can draw reports nothing', () => {
    expect(unservedGlyphsIn(dom('<p>Balance — 12.34 µLXC · settled</p>'))).toEqual([])
  })

  /**
   * ⚠ IT MUST NOT PASS BY ABSENCE. A rule that reports nothing looks identical whether the product
   * is clean or the scanner is broken, so the clean case above is only trustworthy beside a
   * planted one the same call has to find.
   */
  it('a planted character is found in the same markup shape the product uses', () => {
    const found = unservedGlyphsIn(dom('<div class="font-figure"><span>1→2</span></div>'))
    expect(found.map((f) => f.codePoint)).toEqual(['U+2192'])
  })

  it('a zero-width format character is not reported — it carries no glyph', () => {
    // U+FE0F rides behind 🛠 and there is no font that would be expected to draw it.
    expect(unservedGlyphsIn(dom('<span>️</span>'))).toEqual([])
  })
})

// ── THE TWO TABLES, BOTH DIRECTIONS ──────────────────────────────────────────────────────────

/** Every non-test source file in both packages, comments stripped. */
function productSource(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push({ path: p, text: stripComments(readFileSync(p, 'utf8')) })
      }
    }
  }
  walk(resolve(import.meta.dirname))
  walk(UI_SRC)
  return out
}

describe('the classification is honest in both directions', () => {
  it('the sweep reaches both packages — it must not pass by looking at nothing', () => {
    const files = productSource()
    expect(files.length).toBeGreaterThan(40)
    expect(files.some((f) => f.path.includes('/packages/ui/src/components/'))).toBe(true)
    expect(files.some((f) => f.path.includes('/apps/web/src/areas/'))).toBe(true)
  })

  it('the two tables name different characters', () => {
    const both = Object.keys(AWAITING_A_DECISION).filter((c) => c in ARRIVES_AS_DATA)
    expect(both, `character(s) in both tables: ${both.join(' ')}`).toEqual([])
  })

  it('every classified character is genuinely unservable — none is stale', () => {
    for (const label of [...Object.keys(AWAITING_A_DECISION), ...Object.keys(ARRIVES_AS_DATA)]) {
      const cp = codePointOf(label)
      const ch = String.fromCodePoint(cp)
      expect(
        coverage('sans', cp) !== 'served' || coverage('mono', cp) !== 'served',
        `${JSON.stringify(ch)} is now SERVED by a face — the subsets changed, so remove its entry ` +
          'rather than leaving a classification that describes a defect nobody has any more',
      ).toBe(true)
    }
  })

  it('every character awaiting a decision is still one this repo ships', () => {
    // The other direction: if the copy stopped using it, the entry is describing nothing.
    for (const label of Object.keys(AWAITING_A_DECISION)) {
      const ch = String.fromCodePoint(codePointOf(label))
      const where = productSource().filter((f) => f.text.includes(ch))
      expect(
        where.length,
        `${JSON.stringify(ch)} is classified as awaiting a decision but no longer appears in any ` +
          'source file — the decision was taken, so delete the entry',
      ).toBeGreaterThan(0)
    }
  })

  /**
   * ⚠ THE LOOPHOLE-CLOSER, AND THE REASON THIS FILE READS SOURCE AT ALL. `→` is exempt because
   * LENS sends it inside `reversible_note`. Keyed by character, the DOM rule cannot tell that
   * arrow from one somebody types into a suite label tomorrow — it would inherit an exemption
   * argued for a different repo's string. So the data table is ALSO a ban on this repo's own copy:
   * whatever arrives as data may not be written here.
   */
  it('nothing this repo writes uses a character classified as arriving from data', () => {
    const offences: string[] = []
    for (const label of Object.keys(ARRIVES_AS_DATA)) {
      const ch = String.fromCodePoint(codePointOf(label))
      for (const f of productSource()) {
        if (f.text.includes(ch)) offences.push(`${JSON.stringify(ch)} in ${f.path.slice(f.path.indexOf('/src/') + 1)}`)
      }
    }
    expect(
      offences,
      `${JSON.stringify(offences)} — these characters are exempt only because DATA carries them. ` +
        'Writing one into this repo\'s own copy borrows an exemption argued for somebody else\'s ' +
        'string; use a character the served faces have.',
    ).toEqual([])
  })

  it('the detector behind that ban fires on the thing it forbids, and not on prose about it', () => {
    // Positive control, both directions — the invariant.test.ts shape.
    expect(stripComments('const a = "x → y"').includes('→')).toBe(true)
    expect(stripComments('// never write → here').includes('→')).toBe(false)
  })
})
