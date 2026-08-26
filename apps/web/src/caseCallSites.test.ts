import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { blankComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * A COUNT IN A SENTENCE IS A FACT ABOUT THE QUERY BEFORE IT IS ONE ABOUT THE PRODUCT.
 *
 * `89bd58d` (#99) wrote the number of `uppercase` call sites down FOUR TIMES IN THREE FILES and
 * wrote THREE DIFFERENT NUMBERS, in one commit:
 *
 *     caseAudit.ts   "there are TWENTY uppercase call sites in the two packages"
 *     caseAudit.ts   "`uppercase` (25 call sites) and `normal-case` (1) are spelled out"
 *     CaseSafe.tsx   "while twenty other `uppercase` class lists took their text from props"
 *     MuNumeral.tsx  "while twenty other `uppercase` class lists took their text from props"
 *
 * None of the four says WHAT IT COUNTED, and that — not the arithmetic — is the defect. Measured
 * at `dc0bd07`, the tree #99 was looking at when it wrote all three, by running the census below
 * against `git archive dc0bd07 | tar -x`:
 *
 *     every occurrence of the word `uppercase`, tests excluded, COMMENTS KEPT      25 / 13 files
 *     every occurrence of the word `uppercase`, tests excluded, comments blanked   21 / 12 files
 *     occurrences that APPLY the class — a quoted class list                       21 / 12 files
 *     … the same, minus MuNumeral's own, which the sentence is contrasting against 20
 *
 * So all three numbers are the SAME MEASUREMENT under three unstated queries: 25 counts the
 * PARAGRAPHS ABOUT the class alongside the uses of it, 21 counts the uses, and 20 is 21 minus the
 * one being contrasted. "twenty other" (CaseSafe, MuNumeral) is exactly right. "TWENTY … call
 * sites in the two packages" is the same figure with the word `other` dropped, so it is wrong by
 * one. "25" is right for a query nobody would want here.
 *
 * ⚠ AND THE DISAGREEMENT WAS UNFALSIFIABLE BECAUSE THE HONEST NUMBER NEVER MOVES. Measured at
 * three SHAs with the census below:
 *
 *                                              dc0bd07   89bd58d   5ba9846
 *     class-list call sites                        21        21        21
 *     word `uppercase`, comments blanked           21        25        29
 *     word `uppercase`, comments kept              25        54        71
 *
 * The product has not gained an `uppercase` call site in three merges. What grew is the PROSE
 * about it — this file's subject matter is a class whose whole story is written in comments, so
 * the raw-word count decays with documentation rather than with the product. A reader re-deriving
 * "25" today gets 71, and would conclude the count had tripled.
 *
 * ── THE UNIT, DECIDED AND STATED RATHER THAN LEFT TO THE READER ──────────────────────────────
 *
 * An `uppercase` CALL SITE is one occurrence of the token `uppercase`, whitespace-delimited,
 * inside a QUOTED FRAGMENT in comment-blanked source of the two packages with test files
 * excluded — a place that APPLIES the class, as opposed to one that NAMES it. That is the only
 * unit under which caseAudit.ts's sentence ("it is applied at the call site … and that is the
 * whole problem") means anything: counting the paragraphs that discuss the class inflates the
 * problem with its own documentation.
 *
 * The seven occurrences that NAME the class are classified in NAMES_THE_CLASS below rather than
 * filtered out, so narrowing the census cannot silently under-report.
 *
 * ── WHY THE PIN READS THE NUMBER OUT OF THE FILE ─────────────────────────────────────────────
 *
 * Each claim's cardinal is PARSED FROM THE SOURCE LINE and compared to the live census. A table
 * that merely restated the number would compare a constant to itself and pass for every value —
 * this repo has shipped that guard once already. `states` in the table is the expected PARSE, so
 * editing the sentence's number reds against the table AND against the census, from both ends.
 *
 * ── LIVE vs PAST, AND WHY PAST IS NOT A FREE PASS ────────────────────────────────────────────
 *
 * CaseSafe.tsx and MuNumeral.tsx narrate the world BEFORE the fix ("was the ONLY site … while
 * twenty other class lists took their text from props"). A past-tense count cannot be checked
 * against today's census — if a 22nd call site lands, "twenty other" stays true about `dc0bd07`
 * and a live assertion would red on correct prose. So a PAST claim is checked against the number
 * this merge MEASURED at its SHA and recorded here, and the bytes of those two sentences are left
 * alone: they are correct, and the queue's own precedent for a correct past measurement is to
 * leave it (`planes.ts` and `NavItem.tsx` still say "five" for the same reason).
 *
 * The pin is not a free pass either. A PAST entry must still match its sentence verbatim, so any
 * edit to one of those two sentences reds and has to be re-argued; and the SWEEP below means a
 * claim cannot be filed as PAST by simply not listing it.
 *
 * ── THE FLOOR, BOTH DIRECTIONS ───────────────────────────────────────────────────────────────
 *
 * The sweep finds every count-of-uppercase-call-sites sentence in the two packages and is
 * compared to the table as a SET. A new one anywhere is unclassified and fails; a deleted one
 * leaves a stale entry and fails. A source-derived sweep cannot see a deletion and a pinned list
 * cannot see an addition, so this holds both — `5ba9846`'s shape, met again.
 *
 * ── LIMITS, STATED RATHER THAN IMPLIED ───────────────────────────────────────────────────────
 *
 *  · This pins the NUMBER a sentence states. It does not pin the rest of the sentence: "took
 *    their text from props" is a characterisation of the same 20 sites and nothing here checks it.
 *  · The PAST measurements are RECORDED, not re-derived — CI checks out one commit and cannot
 *    read `dc0bd07`. They were taken at merge time with this file's own census over
 *    `git archive`, and the command is written above so anyone can repeat it.
 *  · The census reads QUOTED fragments. A class list assembled at runtime (`'text-' + 'eyebrow'`)
 *    is invisible to it, exactly as it is to eyebrowAudit's source half.
 */

const WEB_SRC = resolve(import.meta.dirname)
const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const REPO = resolve(import.meta.dirname, '../../..')

/**
 * ⚠ THIS FILE EXCLUDES ITSELF FROM THE SWEEP, AND THE EXCLUSION IS ASSERTED RATHER THAN ASSUMED.
 *
 * The header above quotes all four claims verbatim, so a sweep that read this file would find
 * every claim twice and score its own source as product. It is excluded by being a `.test.ts` —
 * the same rule that keeps the census off test files — and the test at the bottom asserts this
 * path is on disk and is NOT in the swept set, so renaming it cannot turn the exclusion into a
 * filter that matches nothing.
 */
const SELF = 'apps/web/src/caseCallSites.test.ts'

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

const CASE_CLASS = 'uppercase'
const TOKEN = new RegExp(`(^|\\s)${CASE_CLASS}(\\s|$)`)

export interface CallSite {
  file: string
  line: number
  fragment: string
}

/**
 * Quoted fragments that NAME `uppercase` rather than APPLY it to an element.
 *
 * ⚠ A CLASSIFICATION, NOT AN EXEMPTION LIST — eyebrowAudit.test.tsx's NAMES_THE_CLASS shape, and
 * held to it the same way: an entry matching nothing fails as stale, and an unlisted naming
 * occurrence fails as unclassified. Keyed by (file, exact fragment).
 */
const NAMES_THE_CLASS: Record<string, string> = {
  'apps/web/src/caseAudit.ts|uppercase':
    'TRANSFORM_CLASSES maps the class NAME to the `text-transform` it sets, and the two ' +
    'predicates below compare against that name. caseAudit.ts renders nothing.',
  'apps/web/src/eyebrowAudit.ts|uppercase':
    'the eyebrow audit reads the same class name OFF rendered elements to decide whether the ' +
    'casing transform is in effect. A name, not a list applied to anything.',
  'apps/web/src/test-setup.ts|eyebrow(s) rendered without an uppercase transform in effect — 11px mono at 0.24em':
    'a developer-facing CI failure message. The word is English prose inside a string, which is ' +
    'why the census cannot simply blank comments and count what is left.',
  'apps/web/src/test-setup.ts|${currentFile} audited NO eyebrow with an uppercase transform in effect. It is listed in':
    'the second half of the same failure path — the floor message, also English prose.',
  'packages/ui/src/__tests__/setup.ts|eyebrow(s) rendered without an uppercase transform in effect — 11px mono at 0.24em':
    'the SAME failure message in the second vitest project, which installs the same seven audits ' +
    'and reports them itself. The identical sentence in two files is what check-audit-gate.mjs ' +
    'requires: it matches each audit by the opening phrase of its report block, in each project.',
}

/** Every place in the two packages that APPLIES `uppercase` to an element. */
export function uppercaseCallSites(): CallSite[] {
  const out: CallSite[] = []
  for (const file of FILES) {
    const rel = relative(REPO, file)
    blankComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/['"`]([^'"`]*)['"`]/g)) {
          const fragment = m[1].replace(/\s+/g, ' ').trim()
          if (!TOKEN.test(fragment)) continue
          if (NAMES_THE_CLASS[`${rel}|${fragment}`] !== undefined) continue
          out.push({ file: rel, line: i + 1, fragment })
        }
      })
  }
  return out
}

/** Every quoted fragment naming the class, applied or not — the input the classification splits. */
function allUppercaseFragments(): CallSite[] {
  const out: CallSite[] = []
  for (const file of FILES) {
    const rel = relative(REPO, file)
    blankComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/['"`]([^'"`]*)['"`]/g)) {
          const fragment = m[1].replace(/\s+/g, ' ').trim()
          if (TOKEN.test(fragment)) out.push({ file: rel, line: i + 1, fragment })
        }
      })
  }
  return out
}

// ── THE SWEEP: EVERY SENTENCE IN THE TWO PACKAGES THAT COUNTS THESE CALL SITES ────────────────

const WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'twenty-one',
  'twenty-two',
  'twenty-three',
  'twenty-four',
  'twenty-five',
  'thirty',
]

export function cardinal(word: string): number {
  const n = Number(word)
  if (Number.isInteger(n)) return n
  const i = WORDS.indexOf(word.toLowerCase())
  if (i < 0) throw new Error(`not a cardinal this table knows: ${word}`)
  return i + 1
}

const CARD = `\\d+|${WORDS.join('|')}`
const NOUN = '(?:call sites?|class lists?)'
/** `… TWENTY uppercase call sites …` — the cardinal, then the class, then the counted noun. */
const BEFORE = new RegExp(`\\b(${CARD})\\b[^.]{0,60}?\\b${CASE_CLASS}\\b[^.]{0,40}?\\b${NOUN}\\b`, 'i')
/** `` … `uppercase` (25 call sites) … `` — the class, then the cardinal and the counted noun. */
const AFTER = new RegExp(`\\b${CASE_CLASS}\\b[^.]{0,10}?\\(?\\s*\\b(${CARD})\\b\\s+${NOUN}\\b`, 'i')

/** The comment text of `src`, with code blanked — the inverse of `blankComments`, same offsets. */
function commentsOnly(src: string): string {
  const blanked = blankComments(src)
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\n') {
      out += '\n'
      continue
    }
    out += blanked[i] === ' ' && ch !== ' ' ? ch : ' '
  }
  return out
}

/** A comment line without its `*` / `//` furniture, so a two-line window reads as one sentence. */
function unfurnish(line: string): string {
  return line.replace(/^\s*(?:\/\/+|\*+|\/\*+)/, ' ')
}

export interface CountClaim {
  file: string
  line: number
  /** The matched sentence fragment, whitespace normalised — the key, so a reflow does not rot it. */
  sentence: string
  /** The cardinal as written, read out of the source. */
  written: string
}

/** Every sentence in the two packages that states a count of `uppercase` call sites. */
export function countClaimsInSource(): CountClaim[] {
  const out: CountClaim[] = []
  for (const file of FILES) {
    const rel = relative(REPO, file)
    const lines = commentsOnly(readFileSync(file, 'utf8')).split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!new RegExp(`\\b${CASE_CLASS}\\b`, 'i').test(lines[i])) continue
      const window = [unfurnish(lines[i]), unfurnish(lines[i + 1] ?? '')].join(' ').replace(/\s+/g, ' ').trim()
      const m = BEFORE.exec(window) ?? AFTER.exec(window)
      if (!m) continue
      out.push({ file: rel, line: i + 1, sentence: m[0], written: m[1] })
    }
  }
  return out
}

// ── THE PINS ─────────────────────────────────────────────────────────────────────────────────

type Kind = 'LIVE' | 'PAST'

interface Pin {
  kind: Kind
  /** What the cardinal counts: every call site, or every one but the site being contrasted. */
  of: 'TOTAL' | 'ALL_BUT_ONE'
  /** The cardinal this sentence is expected to state — compared to the one PARSED from source. */
  states: number
  /** PAST only: the SHA the claim describes, and the census measured there by this merge. */
  measured?: { sha: string; callSites: number }
  why: string
}

/**
 * Every count-of-uppercase-call-sites sentence in the two packages, keyed by `<file>|<sentence>`.
 *
 * The sentence is the key rather than the line, deliberately: these rot when somebody inserts a
 * line above them, and keying by line would turn every insertion into a failure about nothing.
 * pointerAudit.test.ts pins WHERE; this pins WHAT THE NUMBER IS.
 */
const PINS: Record<string, Pin> = {
  // ⚠ 21 → 23: W1.1.1 rebuilt Overview into labelled regions, and the two new class lists are the
  // region eyebrow and the first-run step label — both of them uses of the class, not paragraphs
  // about it, so they move the honest number. This is the FIRST time the class-list census has
  // moved at all (it read 21 at three consecutive SHAs above), which is exactly the property the
  // file argues for: the count tracks the product and not the prose about it.
  // ⚠ 23 → 24: W1.1.4 rebuilt Billing the same way. Exactly ONE new class list — the step label
  // on the empty state's "how a balance arrives" list (areas/lens/TopUp.tsx §WaysToGetCredit).
  // The region eyebrows on all three /billing* addresses go through components/Region.tsx, which
  // was already counted, so a screen rebuild moves this by the number of NEW labels it writes and
  // not by the number of regions it draws — which is the second time that has now been true.
  // ⚠ 24 → 26: W1.1.5 rebuilt Keys, and it adds TWO where Billing added one — the empty state's
  // two step labels are written out as literal JSX rather than mapped from an array, so each is
  // its own class list. That is the honest reading of the same rule: the census counts class
  // LISTS, and one `.map` over two steps is one list while two hand-written steps are two.
  // ⚠ 27 → 30: W4.6.1 step 6 added /chat, and it adds THREE — the two field labels ("Model",
  // "Your message") and the per-turn speaker label. Its two region eyebrows go through
  // components/Region.tsx, which was already counted, so the fifth consecutive rebuild again moves
  // this by the number of NEW labels the screen writes rather than by the number of regions it draws.
  // ⚠ 26 → 27: W1.1.6 rebuilt Members, and it adds exactly ONE — the "You" marker on the row whose
  // email is the session's (areas/lens/Members.tsx). The row's ROLE span was already counted and
  // the three region eyebrows go through components/Region.tsx, which was too, so once again a
  // screen rebuild moves this by the number of NEW labels it writes rather than by the number of
  // regions it draws. That is now the fourth consecutive rebuild for which that has held.
  //
  // 30 → 32 at W4.6.1 step 7: /earnings adds TWO — the per-row `kind` label and its breakdown
  // table's head row — and its three region eyebrows again go through components/Region.tsx. Fifth
  // consecutive rebuild, same rule. The prediction is now worth stating as one: a screen built from
  // Region moves this census by the number of labels it writes ITSELF, so a rebuild that moves it
  // by more than that is applying the transform by hand somewhere and should be looked at.
  'apps/web/src/caseAudit.ts|<N> uppercase class lists': {
    kind: 'LIVE',
    of: 'TOTAL',
    states: 32,
    why: "the argument for why the rule cannot live in the token — #99 wrote TWENTY here, the 'twenty other' figure with `other` dropped",
  },
  'apps/web/src/caseAudit.ts|uppercase (<N> class lists': {
    kind: 'LIVE',
    of: 'TOTAL',
    states: 32,
    why: '#99 wrote 25 here: every occurrence of the WORD in non-test source with comments kept, which counts the paragraphs about the class',
  },
  'packages/ui/src/components/CaseSafe.tsx|<N> other uppercase class lists': {
    kind: 'PAST',
    of: 'ALL_BUT_ONE',
    states: 20,
    measured: { sha: 'dc0bd07', callSites: 21 },
    why: 'narrates the world before the fix — correct as written, and left byte-identical',
  },
  'packages/ui/src/components/MuNumeral.tsx|<N> other uppercase class lists': {
    kind: 'PAST',
    of: 'ALL_BUT_ONE',
    states: 20,
    measured: { sha: 'dc0bd07', callSites: 21 },
    why: 'the same sentence at the component the contrast is about — correct as written, and left byte-identical',
  },
}

/**
 * The pin key: file plus the sentence with quoting furniture dropped and THE CARDINAL REPLACED
 * BY `<N>`.
 *
 * ⚠ THE NUMBER IS OUT OF THE KEY ON PURPOSE. Keyed WITH it, changing a number changes the key,
 * and every wrong count would surface as "an unpinned claim" — the set test would swallow the
 * finding and the message would name the wrong defect. Out of the key, the set test asks only
 * "is this sentence classified" and the number tests do the arithmetic and say what it should be.
 */
function keyOf(c: { file: string; sentence: string; written: string }): string {
  const sentence = c.sentence.replace(/[`'"]/g, '').replace(new RegExp(`\\b${c.written}\\b`, 'i'), '<N>')
  return `${c.file}|${sentence}`
}

describe('the number of uppercase call sites is a fact about a query, and every sentence that states one is checked', () => {
  // ── THE CENSUS ─────────────────────────────────────────────────────────────────────────────

  it('reads both packages — a census that lost a root reports a smaller product, not an error', () => {
    const sites = uppercaseCallSites()
    expect(sites.filter((s) => s.file.startsWith('apps/web/')).length).toBeGreaterThan(0)
    expect(sites.filter((s) => s.file.startsWith('packages/ui/')).length).toBeGreaterThan(0)
    // The site the whole rule is about: MuNumeral's label, the `uppercase` CaseSafe sits inside.
    expect(sites.map((s) => s.file)).toContain('packages/ui/src/components/MuNumeral.tsx')
    expect(sites.map((s) => s.file)).toContain('apps/web/src/areas/marketing/Landing.tsx')
  })

  it('partitions every quoted fragment naming the class into applied and named, with no remainder', () => {
    const all = allUppercaseFragments()
    const applied = uppercaseCallSites()
    const named = all.filter((s) => NAMES_THE_CLASS[`${s.file}|${s.fragment}`] !== undefined)
    const appliedKeys = new Set(applied.map((s) => `${s.file}:${s.line}|${s.fragment}`))
    const unclassified = all
      .filter((s) => !appliedKeys.has(`${s.file}:${s.line}|${s.fragment}`))
      .filter((s) => NAMES_THE_CLASS[`${s.file}|${s.fragment}`] === undefined)
    expect(unclassified.map((s) => `${s.file}:${s.line} «${s.fragment}»`)).toEqual([])
    // A partition, not two overlapping filters: a classified fragment must not also be counted.
    expect(applied.length + named.length).toBe(all.length)
  })

  it('has no stale classification — an entry matching nothing on disk is a lie about the product', () => {
    const seen = new Set(allUppercaseFragments().map((s) => `${s.file}|${s.fragment}`))
    const stale = Object.keys(NAMES_THE_CLASS).filter((k) => !seen.has(k))
    expect(stale).toEqual([])
  })

  // ── THE SWEEP AND THE TABLE, AS A SET, BOTH DIRECTIONS ─────────────────────────────────────

  it('pins every count claim in the two packages, and nothing that is not one', () => {
    const found = countClaimsInSource().map(keyOf).sort()
    expect(found).toEqual(Object.keys(PINS).sort())
  })

  it('excludes itself by being a test file, and the path it excludes is really on disk', () => {
    expect(statSync(resolve(REPO, SELF)).isFile()).toBe(true)
    expect(countClaimsInSource().map((c) => c.file)).not.toContain(SELF)
    expect(FILES.map((f) => relative(REPO, f))).not.toContain(SELF)
  })

  // ── THE NUMBERS ────────────────────────────────────────────────────────────────────────────

  /**
   * ⚠ EVERY OFFENDER, NOT THE FIRST. A bare `expect` inside the loop throws on the first wrong
   * number and the rest of the run says nothing — which is how #99's two disagreeing sentences
   * could have been fixed one at a time, each merge believing it had finished. The three tests
   * below collect and assert a LIST.
   */
  it('reads each claim’s cardinal out of the source rather than restating it', () => {
    const wrong: string[] = []
    for (const c of countClaimsInSource()) {
      const pin: Pin | undefined = PINS[keyOf(c)]
      if (pin === undefined) {
        wrong.push(`${c.file}:${c.line} UNPINNED «${c.sentence}»`)
        continue
      }
      if (cardinal(c.written) !== pin.states) {
        wrong.push(`${c.file}:${c.line} reads ${c.written} (${cardinal(c.written)}), pinned at ${pin.states} «${c.sentence}»`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('holds every LIVE claim to the live census', () => {
    const census = uppercaseCallSites().length
    const wrong: string[] = []
    for (const c of countClaimsInSource()) {
      const pin: Pin | undefined = PINS[keyOf(c)]
      if (pin?.kind !== 'LIVE') continue
      const expected = pin.of === 'TOTAL' ? census : census - 1
      if (cardinal(c.written) === expected) continue
      wrong.push(
        `${c.file}:${c.line} states ${c.written} ${pin.of === 'TOTAL' ? 'call sites' : 'OTHER call sites'}; ` +
          `the census finds ${census}, so it should read ${expected} «${c.sentence}»`,
      )
    }
    expect(wrong).toEqual([])
  })

  it('holds every PAST claim to the census measured at the SHA it describes', () => {
    const wrong: string[] = []
    for (const c of countClaimsInSource()) {
      const pin: Pin | undefined = PINS[keyOf(c)]
      if (pin?.kind !== 'PAST') continue
      if (pin.measured === undefined) {
        wrong.push(`${c.file}:${c.line} is filed as PAST with no measurement, which is uncheckable`)
        continue
      }
      const then = pin.measured.callSites
      const expected = pin.of === 'TOTAL' ? then : then - 1
      if (cardinal(c.written) === expected) continue
      wrong.push(
        `${c.file}:${c.line} states ${c.written} for \`${pin.measured.sha}\`, ` +
          `where this file’s census finds ${then}, so it should read ${expected} «${c.sentence}»`,
      )
    }
    expect(wrong).toEqual([])
  })

  it('names a SHA for every PAST claim, so an undated count cannot hide as history', () => {
    for (const [key, pin] of Object.entries(PINS)) {
      if (pin.kind !== 'PAST') continue
      expect(pin.measured?.sha, `PAST pin without a SHA: ${key}`).toMatch(/^[0-9a-f]{7,40}$/)
    }
  })
})
