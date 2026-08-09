import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

import { ownText } from './figureAudit'

/**
 * EVERY CHARACTER THIS PRODUCT RENDERS, ASKED OF THE FACES IT ACTUALLY SERVES.
 *
 * theme.css's own comment states the failure this guards, one level up from where it guards it:
 *
 *     ⚠ typeface.test.tsx asserts every url() below resolves to a file whose first four
 *     bytes are `wOF2`. A missing font file does not 404 loudly: the browser falls back
 *     to the system stack and the app renders in the wrong typeface forever.
 *
 * That is true of a missing FILE and equally true of a missing GLYPH, and only the first was
 * checked. A `@font-face` carries a `unicode-range`, the browser consults a face only for the
 * codepoints that range claims, and if the selected face's cmap has no glyph it falls through to
 * `ui-sans-serif, system-ui, …` / `ui-monospace, SFMono-Regular, …` for that one character. No
 * error, no 404, no console warning — a single character in a different typeface, mid-word.
 *
 * ⚠ WHAT IT FOUND ON THE FIRST RUN, at `f9f35ab` with every other design guard green: SIXTEEN
 * rendered occurrences of FOUR characters that no served face declares and none contains —
 *
 *     ≈  U+2248  ×6   Overview ×2, Spend, TopUp, BillingReturn, CacheCard
 *     ⚠  U+26A0  ×5   ConvertLens, Terms ×2, Privacy ×2
 *     ←  U+2190  ×3   IssueDetail "← Issues", docs "← Back", legal "← Back to Talyvor"
 *     →  U+2192  ×2   Setup, inside one instruction line
 *
 * ⚠ THE `≈` IS THE ONE THAT MATTERS AND IT IS INSIDE THE FIGURE FACE. Six money captions render
 * `<span class="font-figure …">≈ $12.35</span>`. The digits are IBM Plex Mono; the `≈` in front of
 * them is drawn by whatever the operating system supplies for `ui-monospace`. The element the whole
 * #93/#94/#95 architecture exists to put on ONE face renders its first character on another one.
 *
 * ⚠ AND THE `⚠` IS WORSE IN A DIFFERENT WAY: with no glyph in either face, most platforms fall
 * through to the EMOJI font and paint a multicolour glyph — on two legal pages and the Convert
 * warning, in a language whose stated premise is one electric accent used sparingly.
 *
 * ⚠ IT READS THE DOM, AND THE REASON IS NOT THE USUAL ONE. A source sweep can find a character in
 * a string literal, but it cannot tell a rendered `≈` from the one inside figureAudit.ts's own
 * `DECORATION` regex — which renders nothing and would have to be exempted BY FILE, the curated
 * list #91 exists to warn about. The DOM has no such ambiguity: what renders is what renders.
 * It also settles the FAMILY, which decides which faces are consulted, and the family comes from
 * an ANCESTOR (`font-figure` on the span, the character three nodes down) — a fact no line-based
 * rule holds.
 *
 * ⚠ STATED LIMITS, NOT IMPLIED:
 *   (a) it rides apps/web's setup, so a surface with no test is audited by nothing — the same
 *       limit test-setup.ts already states for the other three audits, inherited rather than new;
 *   (b) it asks whether a glyph EXISTS, never whether it is the right shape.
 *
 * ⚠ AND ONE LIMIT I WROTE HERE WAS WRONG, WHICH THE FIRST RED PROVED IN THE SAME RUN. I had
 * written that tenant data is out of scope because "what is audited is the copy the product itself
 * ships, which in a test run is all there is". IT IS NOT. Two of the offenders arrive as DATA:
 * three emoji from Docs space `icon` fields, and a `→` inside Lens's server-sent
 * `reversible_note`, which the suite renders verbatim and cannot edit. A DOM audit sees what
 * renders and cannot see where it came from — so provenance is CLASSIFIED rather than inferred,
 * in the two tables below, and the sentence that assumed otherwise is corrected rather than
 * deleted.
 */

// ── THE SERVED FACES, READ FROM THE BINARIES ─────────────────────────────────────────────────
//
// ⚠ THE COVERAGE IS PARSED OUT OF THE woff2 FILES, NOT DECLARED HERE. A hand-written list of
// "characters our fonts have" is a second copy of a fact that already exists, and the copy is the
// one that goes stale — `c71ca9c`'s two-copies-of-one-measurement, in glyphs. Re-subset a font and
// this guard's answer changes with it, because it re-reads the file.
//
// woff2 is a brotli-compressed sfnt with its own table directory. Only `glyf`/`loca` (and
// optionally `hmtx`) are TRANSFORMED; `cmap` is stored verbatim, so it can be sliced straight out
// of the decompressed stream at the sum of the preceding tables' stored lengths.
//
// ⚠ PROVENANCE OF THIS PARSER, because an instrument that quietly reads nothing is this repo's
// oldest trap and here it would fail in the SAFE direction (an empty cmap reds everything) while
// its opposite — a parser that over-reports — would go green for nothing. It was written against
// fontTools 4.63.0 as ground truth and agrees with it EXACTLY on all eight shipped files: not the
// counts, the SETS, all 2,090 codepoints, zero disagreement. glyphAudit.test.tsx pins both
// directions on real files (a character that is present, and one that is absent).

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
]

/**
 * One UNTRANSFORMED table, sliced out of a woff2's decompressed stream.
 *
 * Only `glyf`/`loca` (and optionally `hmtx`) are transformed, so `cmap` and `GSUB` are stored
 * verbatim at the sum of the preceding tables' stored lengths. Returns null when the font has no
 * such table — which for `GSUB` is a real answer, not a failure.
 */
export function woff2Table(file: string, want: string): Buffer | null {
  const b = readFileSync(file)
  if (b.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`not a woff2: ${file}`)
  const numTables = b.readUInt16BE(12)
  const p = { o: 48 }
  const base128 = (): number => {
    let v = 0
    for (let i = 0; i < 5; i++) {
      const byte = b[p.o++]
      v = (v << 7) | (byte & 0x7f)
      if (!(byte & 0x80)) return v
    }
    throw new Error(`malformed UIntBase128 in ${file}`)
  }

  let offset = -1
  let length = 0
  let running = 0
  for (let i = 0; i < numTables; i++) {
    const flags = b[p.o++]
    const index = flags & 0x3f
    const transform = (flags >> 6) & 0x03
    let tag: string
    if (index === 63) {
      tag = b.toString('latin1', p.o, p.o + 4)
      p.o += 4
    } else {
      tag = KNOWN_TAGS[index]
    }
    const original = base128()
    // The null transform is 3 for glyf/loca and 0 for everything else; a transformed table
    // carries its stored length separately.
    const nullTransform = tag === 'glyf' || tag === 'loca' ? 3 : 0
    const stored = transform !== nullTransform ? base128() : original
    if (tag === want && offset < 0) {
      offset = running
      length = stored
    }
    running += stored
  }
  if (offset < 0) return null
  const font = brotliDecompressSync(b.subarray(p.o))
  return font.subarray(offset, offset + length)
}

/**
 * The OpenType feature tags a face implements.
 *
 * ⚠ THIS EXISTS TO PIN A CLAIM THE PRODUCT MAKES ABOUT ITSELF. preset.ts defines `font-figure` as
 * `var(--mono)` plus `font-feature-settings: "tnum" 1`, and figureAudit.ts's rule turns on
 * `font-figure` being a DIFFERENT face from `font-mono`. Measured: the served IBM Plex Mono
 * subsets declare no `tnum` feature at all, so there is nothing for that setting to switch on —
 * see the test, which asserts it in both directions (absent on mono, PRESENT on the sans).
 */
export function woff2FeatureTags(file: string): Set<string> {
  const tags = new Set<string>()
  for (const which of ['GSUB', 'GPOS'] as const) {
    const t = woff2Table(file, which)
    if (!t) continue
    const featureListOffset = t.readUInt16BE(6)
    const count = t.readUInt16BE(featureListOffset)
    for (let i = 0; i < count; i++) {
      tags.add(t.toString('latin1', featureListOffset + 2 + i * 6, featureListOffset + 6 + i * 6))
    }
  }
  return tags
}

/**
 * The `OS/2` usWeightClass a face's binary declares about itself.
 *
 * ⚠ THIS EXISTS BECAUSE A CONTROL WENT GREEN. C7 repointed the 600 `@font-face` at the 500 BINARY
 * — every semibold mono in the product would have rendered one step light — and nothing in this
 * repo noticed: typeface.test.tsx checks the first four bytes are `wOF2`, and coverage is
 * identical between the two files. The stylesheet's `font-weight` descriptor is a CLAIM about a
 * file, and a claim about a file is checkable against the file.
 */
export function woff2WeightClass(file: string): number {
  const os2 = woff2Table(file, 'OS/2')
  if (!os2) throw new Error(`no OS/2 metrics — ${file} declares no weight class`)
  return os2.readUInt16BE(4)
}

/** The codepoints a woff2's cmap maps to a real glyph. Glyph 0 (.notdef) is not coverage. */
export function woff2Codepoints(file: string): Set<number> {
  // ⚠ THE EM DASH IS LOAD-BEARING AND IS NOT PUNCTUATION. deadClasses.test.ts harvests any
  // string literal whose tokens all LOOK like classes and one of which Tailwind emits; `table` is
  // a real utility, so "no cmap table in …" scored `no`, `cmap` and `in` as dead classes and this
  // file went red on its first run. That is `89bd58d`'s trap — the extractor cannot tell a class
  // from a sentence about one — arriving in the guard written to catch a different blindness.
  const c = woff2Table(file, 'cmap')
  if (!c) throw new Error(`no cmap — ${file} carries no character map`)
  const out = new Set<number>()
  const subtables = c.readUInt16BE(2)
  for (let i = 0; i < subtables; i++) {
    const rec = 4 + i * 8
    const platform = c.readUInt16BE(rec)
    const encoding = c.readUInt16BE(rec + 2)
    const off = c.readUInt32BE(rec + 4)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode) continue
    const format = c.readUInt16BE(off)
    if (format === 4) {
      const segCountX2 = c.readUInt16BE(off + 6)
      const endO = off + 14
      const startO = endO + segCountX2 + 2
      const deltaO = startO + segCountX2
      const rangeO = deltaO + segCountX2
      for (let s = 0; s < segCountX2 / 2; s++) {
        const end = c.readUInt16BE(endO + s * 2)
        const start = c.readUInt16BE(startO + s * 2)
        if (start === 0xffff) continue
        const delta = c.readInt16BE(deltaO + s * 2)
        const rangeOffset = c.readUInt16BE(rangeO + s * 2)
        for (let cp = start; cp <= end; cp++) {
          let glyph: number
          if (rangeOffset === 0) glyph = (cp + delta) & 0xffff
          else {
            const gi = rangeO + s * 2 + rangeOffset + (cp - start) * 2
            if (gi + 1 >= c.length) continue
            glyph = c.readUInt16BE(gi)
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff
          }
          if (glyph !== 0) out.add(cp)
        }
      }
    } else if (format === 12) {
      const groups = c.readUInt32BE(off + 12)
      for (let g = 0; g < groups; g++) {
        const go = off + 16 + g * 12
        const start = c.readUInt32BE(go)
        const end = c.readUInt32BE(go + 4)
        if (c.readUInt32BE(go + 8) === 0) continue
        for (let cp = start; cp <= end; cp++) out.add(cp)
      }
    } else {
      throw new Error(`unsupported cmap format ${format} in ${file}`)
    }
  }
  return out
}

export type Family = 'sans' | 'mono'

export interface ServedFace {
  family: Family
  /** the `font-weight` descriptor, verbatim — "400 700" for the variable sans. */
  weight: string
  file: string
  ranges: readonly (readonly [number, number])[]
  codepoints: Set<number>
}

const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')

/** `font-family` descriptor → the Tailwind family it backs. */
const FAMILY_OF: Record<string, Family> = {
  'Space Grotesk': 'sans',
  'IBM Plex Mono': 'mono',
}

let cachedFaces: ServedFace[] | null = null

/**
 * Every `@font-face` theme.css declares, with the coverage its file actually has.
 *
 * ⚠ IT PARSES theme.css RATHER THAN LISTING THE FILES. A directory listing would keep passing
 * after a face stopped being declared, and a hand-kept list would keep passing after one was
 * added — the both-directions failure `8555e1e` paid for. The stylesheet is what the browser
 * reads, so the stylesheet is what this reads.
 */
export function servedFaces(): ServedFace[] {
  if (cachedFaces) return cachedFaces
  const css = readFileSync(resolve(UI_SRC, 'theme.css'), 'utf8')
  const faces: ServedFace[] = []
  for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1]
    const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim()
    const url = /url\('([^']+)'\)/.exec(body)?.[1]
    const rangeText = /unicode-range:\s*([^;]+);/.exec(body)?.[1]
    if (!family || !weight || !url || !rangeText) {
      throw new Error(`@font-face in theme.css is missing a descriptor this guard reads:\n${body}`)
    }
    const mapped = FAMILY_OF[family]
    if (!mapped) {
      throw new Error(
        `theme.css declares @font-face '${family}', which FAMILY_OF does not classify. A new ` +
          'face must be argued into a family here — the alternative is that it renders unaudited.',
      )
    }
    const ranges = rangeText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => {
        const hex = t.replace(/^[Uu]\+/, '')
        const [lo, hi] = hex.includes('-') ? hex.split('-') : [hex, hex]
        return [parseInt(lo, 16), parseInt(hi, 16)] as const
      })
    const file = resolve(UI_SRC, url)
    faces.push({ family: mapped, weight, file, ranges, codepoints: woff2Codepoints(file) })
  }
  if (faces.length === 0) throw new Error('theme.css declared no @font-face — the guard read nothing')
  cachedFaces = faces
  return faces
}

export type Coverage = 'served' | 'undeclared' | 'declared-but-absent'

/**
 * Can `family` draw `cp`, or does the browser fall through to the system stack?
 *
 *   served              — some face declares it in range and every face that declares it has it
 *   undeclared          — no `unicode-range` claims it, so no served face is ever consulted
 *   declared-but-absent — a face is downloaded for it and then has no glyph
 *
 * ⚠ THE SECOND HALF OF `served` IS NOT PEDANTRY. The three mono weights are three separate files;
 * an element renders at ONE of them, chosen by weight, and the guard cannot know which. If a
 * character is in the 400 subset and missing from the 600, it renders in the system face on every
 * semibold surface. Requiring ALL declaring faces to have it is the only answer that holds for
 * whichever weight the element turns out to be.
 */
export function coverage(family: Family, cp: number): Coverage {
  const declaring = servedFaces().filter(
    (f) => f.family === family && f.ranges.some(([lo, hi]) => cp >= lo && cp <= hi),
  )
  if (declaring.length === 0) return 'undeclared'
  return declaring.every((f) => f.codepoints.has(cp)) ? 'served' : 'declared-but-absent'
}

// ── THE CHARACTERS THE SYSTEM DRAWS, CLASSIFIED ──────────────────────────────────────────────
//
// ⚠ TWO ENTRIES, EACH A DECISION SOMEBODY ELSE OWNS, AND NEITHER IS "TUNED AWAY". Both are
// measured defects; what they need is not a fix I can pick, it is a choice between fixes. They are
// listed here so the audit reports the product's real state instead of being deleted, and the
// table is checked BOTH DIRECTIONS below: a character that stops being rendered, or that becomes
// servable, fails as stale.
//
// ⚠ WHY THE OTHER TWO WERE NOT LISTED HERE. `←` and `→` had an answer already in the product —
// `›` U+203A, which docs/SpaceList has always used as its crumb separator and which every served
// face contains. Substituting an existing idiom is a port; inventing a mark for `≈` is not.
export const AWAITING_A_DECISION: Record<string, string> = {
  'U+2248': [
    'the derived-value mark on six money captions (Overview ×2, Spend, TopUp, BillingReturn,',
    'CacheCard). It is NOT a stray character: figureAudit.ts, Overview.tsx, Spend.tsx and',
    'CacheCard.tsx all document a U+2248-marked derived caption as the shape that distinguishes',
    'derived figure from a counted one. Neither served face has U+2248, so every one of the six',
    'renders it in the system mono while the digits beside it are IBM Plex Mono. The candidates',
    'are: subset the faces to include it (needs the upstream fonts, which are not in this repo),',
    'or move the six to a mark the faces have (`~`, ASCII). The second changes a documented visual',
    'convention on every money surface, which is a design decision and not a session\'s.',
  ].join(' '),
  'U+26A0': [
    'the warning mark on five headings (ConvertLens\'s reversibility note, Terms ×2, Privacy ×2).',
    'Neither face has U+26A0 and neither is likely to — it is a symbol, not a letter — so on most',
    'platforms it falls through to the EMOJI font and paints a multicolour glyph, in a language',
    'whose premise is one electric accent used sparingly. Removing it changes the emphasis of two',
    'legal pages; replacing it needs a mark or an affordance that does not exist yet. Both are',
    'copy decisions, so this reports rather than picks one.',
  ].join(' '),
}

/**
 * TWO TABLES, DELIBERATELY NOT ONE — the `9e03e50` shape. The table above holds characters THIS
 * REPO SHIPS and could change tomorrow if someone decided what to change them to. This one holds
 * characters that reach the DOM from DATA, where no edit in this repo is the fix. Merging them
 * would let "we chose not to decide" and "it is not ours" wear the same label, and the second is
 * the one that should be routed somewhere else rather than sat on.
 *
 * ⚠ EVERY ENTRY IS ALSO FORBIDDEN IN THIS REPO'S OWN SOURCE, checked in glyphAudit.test.tsx. That
 * is what stops the table becoming a loophole: `→` is exempt HERE because Lens sends it, and if
 * that alone were the rule, a new `→` typed into a suite label would inherit an exemption argued
 * for somebody else's string. Keyed by character, the DOM rule could not tell the two apart; the
 * source rule can, so the two run together and each closes the other's hole.
 */
export const ARRIVES_AS_DATA: Record<string, string> = {
  'U+1F4D8': 'a Docs space `icon` — free text the tenant sets, rendered verbatim by SpaceList.',
  'U+1F4C4': 'a Docs space `icon` — free text the tenant sets, rendered verbatim by SpaceList.',
  'U+1F6E0': 'a Docs space `icon` — free text the tenant sets, rendered verbatim by SpaceList.',
  'U+2192': [
    "inside Lens's `reversible_note`, which arrives with the convert quote and which ConvertLens",
    'renders verbatim. No served face has U+2192, so the arrow in its one-way sentence',
    'is drawn by the system on the one panel that exists to explain an irreversible spend. THE FIX',
    'IS IN LENS, NOT HERE — this repo cannot edit that string, and rewriting the fixture to hide it',
    'would make the test disagree with the deployment. Reported for a Lens session.',
  ].join(' '),
}

/**
 * ⚠ THE EMOJI ENTRIES ARE A MEASUREMENT WITH A DESIGN QUESTION BEHIND THEM, not a shrug. A space
 * icon is a free-text field, so no subset can ever cover it and this audit will report each new
 * one until somebody classifies it — which is the intended behaviour, because every one is a
 * multicolour glyph landing in a language whose premise is one accent used sparingly. Whether a
 * space icon should be a character at all belongs to the Docs surface merge.
 */

// ── THE RUNNING AUDIT ────────────────────────────────────────────────────────────────────────

export interface RenderedGlyph {
  char: string
  codePoint: string
  family: Family
  coverage: Coverage
  /** the element's own text, for locating it */
  text: string
  className: string
  tag: string
}

/**
 * The family an element renders in. The NEAREST of the three family utilities up the tree wins,
 * because that is what the cascade does; with none of them the body's `font-family: var(--sans)`
 * applies, which is why the default is sans rather than unknown.
 *
 * ⚠ `font-figure` AND `font-mono` ARE THE SAME FAMILY HERE, AND THAT IS A MEASUREMENT. Both
 * resolve to `var(--mono)`; `font-figure` adds `font-feature-settings: "tnum" 1`, and the served
 * IBM Plex Mono subsets declare NO `tnum` feature at all (measured: ccmp, dnom, frac, mark, numr)
 * while all ten digits already advance 600 units. The feature is inert and would be a no-op if it
 * were not. For CHOOSING WHICH FILES TO ASK they are one family, and treating them as two would
 * ask the wrong question of every `font-mono` identifier in the product.
 */
export function effectiveFamily(el: Element | null): Family {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cls = e.getAttribute('class') ?? ''
    if (/\bfont-(figure|mono)\b/.test(cls)) return 'mono'
    if (/\bfont-sans\b/.test(cls)) return 'sans'
  }
  return 'sans'
}

/**
 * A codepoint's canonical label, e.g. U+2248.
 *
 * ⚠ BOTH TABLES ARE KEYED BY THIS RATHER THAN BY THE CHARACTER, and that is not a style choice —
 * it is the only reason the source ban in glyphAudit.test.tsx needs no exemption for the file that
 * declares it. Keyed by the literal character, this module would SPELL every character it
 * classifies, the ban would find them here, and the fix would be an exemption for glyphAudit.ts —
 * which is the hole such a rule dies of. `89bd58d` paid for this once already, in a guard whose
 * fixtures had to build µ from its codepoint for the same reason. MEASURED, not reasoned about:
 * the tables were keyed by character first and the ban went red naming its own four keys.
 */
export function codePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Whitespace, control and FORMAT characters carry no glyph and are not asked about.
 *
 * ⚠ THE VARIATION SELECTORS ARE HERE BECAUSE THE FIRST RUN REPORTED ONE. `🛠️` is U+1F6E0 followed
 * by U+FE0F, and the audit named the selector as a second unservable character — a font is not
 * expected to contain it and no fix exists, so reporting it is noise that would train a reader to
 * skim the list. It is excluded for what it IS (a zero-width format character), not because it
 * was inconvenient: the emoji in front of it is still reported.
 */
function isRenderable(cp: number): boolean {
  if (cp <= 0x20) return false
  if (cp >= 0x7f && cp <= 0xa0) return false
  if (cp >= 0x200b && cp <= 0x200f) return false // zero-width + bidi marks
  if (cp >= 0x2060 && cp <= 0x2064) return false // word joiner and invisible operators
  if (cp >= 0xfe00 && cp <= 0xfe0f) return false // variation selectors
  if (cp === 0xfeff) return false // BOM / zero-width no-break space
  return true
}

/** Every character rendered under `root` that its own family cannot draw. */
export function unservedGlyphsIn(root: ParentNode): RenderedGlyph[] {
  const out: RenderedGlyph[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const text = ownText(el)
    if (!text) continue
    const family = effectiveFamily(el)
    for (const char of [...text]) {
      const cp = char.codePointAt(0)!
      if (!isRenderable(cp)) continue
      const cov = coverage(family, cp)
      if (cov === 'served') continue
      out.push({
        char,
        codePoint: codePointLabel(cp),
        family,
        coverage: cov,
        text: text.trim(),
        className: el.getAttribute('class') ?? '',
        tag: el.tagName.toLowerCase(),
      })
    }
  }
  return out
}

// ⚠ CAPTURE IS AT COMMIT TIME, for the reason figureAudit.ts records as TRAP THREE: Testing
// Library's cleanup is registered after this setup file and vitest runs afterEach
// last-registered-first, so an afterEach DOM scan reads an EMPTY body and reports every surface
// clean. `afterEach` here only reads what the observer already recorded.

const seen = new Set<string>()
let offenders: RenderedGlyph[] = []
const monoByFile = new Map<string, number>()
let currentFile = ''

function scan(): void {
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const text = ownText(el)
    if (!text) continue
    const className = el.getAttribute('class') ?? ''
    const family = effectiveFamily(el)
    const key = `${currentFile}|${family}|${className}|${text}`
    if (seen.has(key)) continue
    seen.add(key)
    let monoHere = 0
    for (const char of [...text]) {
      const cp = char.codePointAt(0)!
      if (!isRenderable(cp)) continue
      const cov = coverage(family, cp)
      if (cov === 'served') {
        if (family === 'mono') monoHere++
        continue
      }
      const key = codePointLabel(cp)
      if (AWAITING_A_DECISION[key] !== undefined || ARRIVES_AS_DATA[key] !== undefined) continue
      offenders.push({
        char,
        codePoint: codePointLabel(cp),
        family,
        coverage: cov,
        text: text.trim(),
        className,
        tag: el.tagName.toLowerCase(),
      })
    }
    if (monoHere > 0) monoByFile.set(currentFile, (monoByFile.get(currentFile) ?? 0) + monoHere)
  }
}

/** Start recording. Called once per test file, from test-setup.ts. */
export function installGlyphAudit(): void {
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })
}

export function setGlyphAuditFile(file: string): void {
  currentFile = file
}

/** The unservable characters seen since the last call, and clears them. */
export function takeGlyphOffenders(): RenderedGlyph[] {
  const out = offenders
  offenders = []
  return out
}

/**
 * THE FLOOR — a file listed here must have audited a character ON THE MONO FAMILY.
 *
 * ⚠ IT ASKS FOR MONO, NOT FOR "A CHARACTER", and the difference is the whole value. Every test
 * renders SOME text, so "audited ≥1 character" stays green with the family walk blinded, with the
 * coverage predicate inverted to always-served, and with most of this module broken. Requiring a
 * MONO character exercises the ancestor walk that decides which files are consulted — the one part
 * a source rule could not do and therefore the one part worth pinning.
 *
 * ⚠ AND IT CANNOT CATCH EVERYTHING, said rather than implied — the `f9f35ab` lesson, where a
 * floor was documented as catching a blinded predicate and MEASURED green. Three defects, three
 * different catchers, each observed red in the controls:
 *   · a dead observer            → this floor
 *   · a blinded coverage parser  → glyphAudit.test.tsx's direct unit tests on real files
 *   · a face dropped from theme.css → servedFaces() throws, before any floor is consulted
 */
export const MUST_AUDIT_MONO_TEXT: Record<string, string> = {
  // ⚠ FULL RELATIVE PATHS, AND THE FIRST VERSION OF THIS TABLE USED BARE BASENAMES. `currentFile`
  // is vitest's `ctx.task.file.name`, which is 'src/areas/lens/Overview.test.tsx' — so every
  // lookup returned undefined and THE FLOOR NEVER FIRED ONCE. It passed the whole suite, it
  // passed CI, and it was worth nothing. C3 is the only reason I know: blinding the observer
  // left the product GREEN. The three sibling tables in figureAudit/focusAudit/caseAudit were
  // right all along; this one copied their shape and not their keys.
  'src/areas/lens/Overview.test.tsx': 'the balance figures and their µ-tails, all on the figure face',
  'src/areas/lens/Spend.test.tsx': 'the month-USD caption on the figure face',
  'src/areas/lens/TopUp.test.tsx': 'the buy-button prices on the figure face',
  'src/areas/marketing/Landing.test.tsx': 'the four quoted ledger figures, font-figure text-figure',
  'src/areas/lens/Keys.test.tsx': 'the key prefixes, font-mono identifiers',
}

export function satisfiesMonoFloor(file: string): boolean {
  return (monoByFile.get(file) ?? 0) > 0
}
