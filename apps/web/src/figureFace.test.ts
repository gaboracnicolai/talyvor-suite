import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * MONOSPACE FOR EVERY NUMERAL — the rule `6aecb0d` (#88) wrote down and never swept for.
 *
 * #88 built the face: `font-figure` is `var(--mono)` plus `font-feature-settings: "tnum" 1`,
 * and the brief it came from says "MONOSPACE FOR EVERY NUMERAL". It ported Overview and left
 * the token available. Nothing ever asked whether the rest of the product used it.
 *
 * ⚠ MEASURED 2026-08-09 at `5d65b3e`: `formatUSD` had FIVE render sites and exactly ONE was on
 * the figure face. The other four were `text-body text-muted` — the body sans. Three of them
 * are the same shape, and it is the shape that makes this worth a guard rather than four
 * commits:
 *
 *     <MuNumeral micros={…balance_ulxc} unit="lxc" />          ← the figure face
 *     <span className="text-body text-muted">≈ {formatUSD(…)}</span>   ← the sans
 *
 * The dollar figure sits immediately beside the LXC figure it converts, at the same baseline,
 * in a different typeface. It is the same money twice, and only one of the two looks measured.
 * Overview, TopUp and BillingReturn all did it; a fourth put the balance in a sentence.
 *
 * TWO RULES, because one of them alone has a blind spot the other closes:
 *
 *   A. NAME-SHAPED. Any function whose name reads like money — /usd|cents|cost|price/i —
 *      rendered into JSX must land on the figure face. It is what reaches a LOCAL helper no
 *      module exports and no import list mentions, which rule B's census cannot see.
 *      ⚠ AS OF `2bee9fc` RULE A HAS NO INSTANCE OF ITS OWN, AND THAT IS SAID HERE RATHER THAN
 *      LEFT TO BE DISCOVERED. Its one real subject was `costLabel` in IssueDetail.tsx; that
 *      helper is now `areas/track/format.ts#formatCost`, an EXPORT, so rule B classifies it and
 *      rule B's face check already covers it. Measured with the whole suite green: every
 *      money-named function rendered into JSX in this product is now an exported `format*`
 *      (formatUSD, formatCents, formatCost), so rule A's unique coverage — money-shaped names
 *      that are not `format*` — is currently EMPTY. It stays because the next local helper is
 *      exactly what it exists to catch, but nothing in the product demonstrates it today.
 *   B. CLASSIFIED. Every `format*` exported ANYWHERE under the scanned roots is classified below
 *      as A FIGURE or NOT ONE, WITH ITS REASON, and the classification is checked against the
 *      source in both directions. A formatter nobody classifies fails this file rather than
 *      defaulting into "not a figure" — the #407 move, and the one that stops rule A from
 *      quietly missing a new `formatBalance` that happens not to match the name shape.
 *
 * ⚠⚠ RULE B'S CENSUS COULD NOT DELIVER THAT PROMISE, IN TWO INDEPENDENT WAYS, AND BOTH WERE
 * MEASURED WITH THE WHOLE SUITE GREEN AT `31095b7` (1010 tests, twice):
 *
 *   · ITS SCOPE WAS A HAND-KEPT LIST OF THREE FILE PATHS. Adding `export function formatBalance`
 *     to `areas/lens/topupApi.ts` — a module the list does not name — changed NOTHING: 1010
 *     passed. That is rule B's own stated reason to exist, arriving through the one door it did
 *     not watch. And the list was ALREADY STALE when this was written: `topupApi.ts` exports
 *     `formatCents`, a real money formatter on a buy button, and no entry classified it.
 *   · ITS KEY WAS THE FUNCTION NAME. `exportedFormatters()` accumulated into a `Set` of NAMES,
 *     so the three listed modules' FIVE exported functions collapsed into THREE entries. Adding
 *     a second `formatUSD` — a different unit contract under an already-classified name — also
 *     changed nothing: 1010 passed. The duplication was half-noticed (a comment acknowledged the
 *     second `formatWhen`) and never swept for; the unacknowledged collision is on MONEY, and
 *     the two `formatUSD` arguments differ by a factor of 10^6 (µUSD vs float USD).
 *
 * ⚠ AND A DELETION WAS INVISIBLE FOR THE SAME REASON: un-exporting track's `formatUSD` left
 * lens's namesake in the set, so the both-directions check saw NO change. The control still
 * scored CAUGHT — by `format.test.ts`, the mutated module's OWN unit test, which is not this
 * guard. A verdict read from a count would have recorded that hole as covered.
 *
 * The census is now DISCOVERED from the roots rather than listed, and keyed by `module#name`.
 */

const appRoot = resolve(import.meta.dirname, '..')
const roots = [resolve(appRoot, 'src'), resolve(appRoot, '../../packages/ui/src')]

/** Repo-relative path, the form the classification keys and the site report both use. */
function relOf(p: string): string {
  return p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
}

/** Every source file under the roots, tests excluded. */
function allSources(exts: RegExp): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (exts.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push({ path: relOf(p), text: readFileSync(p, 'utf8') })
    }
  }
  for (const r of roots) walk(r)
  return out
}

/**
 * ⚠ THE POPULATION IS ASSERTED, BECAUSE A COMPLETE WALK IS NOT A GUARANTEED ONE. Measured at
 * `033d0a5` by recording every path this test opens — `node:fs` wrapped inside the vitest worker,
 * `~/talyvor-queue/w11-population-census-4b2e.py` — this file reads 102 of the 102 production
 * files under its two roots. Its population is WHOLE today. Nothing here said so, and nothing
 * here would have noticed it stop being whole: with the walk made to skip `areas/docs` and
 * nothing else changed, this file stayed GREEN (`~/talyvor-queue/w11-stoppedwalk-controls-4b2e.py`,
 * where all five sweeps in this class were green on the same mutation).
 *
 * A FLOOR CANNOT DO THIS JOB and raising one would be a threshold nobody measured: rule B's
 * discovery is silent when the product is correct, which is byte-identical to what a walk that
 * stopped descending reports. `import.meta.glob` is resolved by Vite at TRANSFORM time and
 * touches `node:fs` not at all, so a wrong root, a changed extension filter or a walk that stops
 * descending cannot move both enumerations the same way. Compared BOTH DIRECTIONS.
 *
 * ⚠ THE CALL IS LITERAL ON PURPOSE. Vite rewrites `import.meta.glob` by matching the SYNTAX at
 * transform time; hoisting the patterns into a variable typechecks and then dies at runtime.
 */
describe('the sweep reads the whole tree', () => {
  // Keys only — the glob is lazy, so nothing here imports a module or runs a side effect. Both
  // roots, because `roots` has two and a comparison seeing only `apps/web/src` would be green
  // while the design system went unread.
  const globbed = Object.keys(
    import.meta.glob(['./**/*.{ts,tsx}', '../../../packages/ui/src/**/*.{ts,tsx}']),
  )
    .filter((k) => !/\.test\.tsx?$/.test(k))
    .map((k) => relOf(resolve(import.meta.dirname, k)))

  it('finds a substantial tree across both roots, so an empty anchor cannot pass', () => {
    // Far below the 102 at `033d0a5`: this catches a root that resolves to nothing, not a
    // refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(60)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', () => {
    // The REAL sweep, called with the same extensions rule rule B uses — an assertion about the
    // walk under test rather than about a second walk written here, which would be free to drift.
    const swept = new Set(allSources(/\.tsx?$/).map((f) => f.path))
    const glob = new Set(globbed)
    expect(
      [...glob].filter((f) => !swept.has(f)).sort(),
      'Vite sees production files this walk never read. Rule B classifies whatever the walk ' +
        'returns, so an exported `format*` in a file missing here is one nobody has to classify.',
    ).toEqual([])
    expect(
      [...swept].filter((f) => !glob.has(f)).sort(),
      'the walk read files Vite does not see. Either it left the two roots, or the two disagree ' +
        'about what a production source file is.',
    ).toEqual([])
  })
})

/**
 * The modules that export a `format*` — DISCOVERED, never listed.
 *
 * ⚠ A LIST HERE IS THE DEFECT THIS REPLACES. Whoever adds `areas/reports/format.ts` will not
 * think to add it to a census in another area's test file, and rule B would then be a promise
 * about three files wearing the words "every formatter in the product".
 */
function formatModules(): { path: string; text: string }[] {
  return allSources(/\.tsx?$/).filter((f) => EXPORTED_FORMAT.test(f.text))
}

const EXPORTED_FORMAT = /export\s+(?:async\s+)?function\s+(format[A-Za-z0-9_]*)|export\s+const\s+(format[A-Za-z0-9_]*)\s*[:=]/

/**
 * Every exported `format*`, and whether its output is a FIGURE — a quantity whose digits
 * should line up — or something else. The value is `true` for a figure, or the REASON it is
 * not one. Do not delete an entry to make this file pass; say why.
 *
 * ⚠ KEYED BY `module#name`, NOT BY NAME. Two modules ship a `formatWhen` and two ship a
 * `formatUSD`; under a name key the second of each pair was classified by the first one's
 * entry, and the money pair do not even take the same unit.
 */
const FORMATTERS: Record<string, true | string> = {
  'apps/web/src/areas/lens/format.ts#formatUSD': true,
  // ⚠ WAS EXEMPT, ON A DESCRIPTION OF ITS OUTPUT THAT WAS NOT ITS OUTPUT: 'a timestamp rendered
  // as prose ("3 minutes ago", "12 Aug"), not a column of digits'. It renders neither shape.
  // `formatWhen` returns "Jul 20, 04:52" — a numeric day and a zero-padded 24-hour clock — and
  // Ledger.tsx draws it as the FIRST COLUMN of the ledger table, already `font-figure`. The
  // exemption described something else and the face check believed it.
  //
  // MEASURED at 4bbf6d0: dropping `font-figure` from that `<td>` — the ledger's timestamp column
  // falling into the body sans, beside a MuNumeral that stays on the face — left 1072/1072 green.
  // The one guard written to catch "a figure rendered in the sans" was told this was not a figure.
  //
  // ⚠ THE TWO ENTRIES MOVE TOGETHER OR THE TABLE LIES. The face check's figure set is the NAME
  // half of every `true` entry (a call site names a function, not a module), so classifying one
  // `formatWhen` a figure classifies both. Track's copy is stated below rather than left to be
  // inferred.
  'apps/web/src/areas/lens/format.ts#formatWhen': true,
  // The money formatter that sat outside the old three-file list entirely: it prints the price
  // on /billing's buy buttons, the one numeral a stranger reads before spending money.
  'apps/web/src/areas/lens/topupApi.ts#formatCents': true,
  // Was `formatUSD` here — "A FIGURE BY ITS OUTPUT, AND NOTHING RENDERS IT … classified honestly
  // and enforced by nothing". That is now resolved rather than described: the dead export is
  // deleted and this is the rule IssueDetail.tsx actually renders (it was the local `costLabel`).
  // ⚠ THE "ENFORCED BY NOTHING" HALF IS A GUARD NOW, NOT A COMMENT: formatterReach.test.ts fails
  // when an exported `format*` has no production call site, so this table can no longer classify
  // a formatter nothing renders without someone pinning it and saying why.
  'apps/web/src/areas/track/format.ts#formatCost': true,
  // A figure by the same rule as lens's, and it must carry the same classification because the
  // face check keys by name. ⚠ ITS FACE CHECK IS VACUOUS AND SHIPS SAYING SO: this copy has ZERO
  // render sites — formatterReach.test.ts pins it dead with that reason — so the scan finds
  // nothing of its own to place. The classification is here to keep the table honest, not because
  // anything is being enforced on Track today.
  //
  // "same shape and same answer" was a claim about two modules that nothing compared; it is now
  // checked, in src/renderedClock.test.ts, as an exact string from both.
  'apps/web/src/areas/track/format.ts#formatWhen': true,
  'packages/ui/src/lib/format.ts#formatDay':
    'a date label; dates are set in the sans everywhere in this product, deliberately',
}

/** Every exported `format*` as `module#name` — the PAIR is the census key. */
function exportedFormatters(): string[] {
  const pairs = new Set<string>()
  for (const f of formatModules()) {
    const src = stripComments(f.text)
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(format[A-Za-z0-9_]*)/g)) pairs.add(`${f.path}#${m[1]}`)
    for (const m of src.matchAll(/export\s+const\s+(format[A-Za-z0-9_]*)\s*[:=]/g)) pairs.add(`${f.path}#${m[1]}`)
  }
  return [...pairs].sort()
}

interface Tag {
  start: number
  end: number
  text: string
  closing: boolean
  selfClosing: boolean
  name: string
}

/**
 * Read the JSX tags out of a file.
 *
 * ⚠ A LAZY `<[^>]*>` DOES NOT WORK HERE AND THE FAILURE IS SILENT. An arrow function in an
 * attribute — `onChange={(e) => setStatus(e)}` — contains a `>`, so the lazy form ends the tag
 * in the middle of it, and every element after that point is mis-nested. IssueList.tsx has
 * exactly that. So the scan tracks quotes and brace depth and ends a tag on a `>` that is
 * genuinely outside both. Positive-controlled below on that exact shape.
 */
function tags(src: string): Tag[] {
  const out: Tag[] = []
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue
    const after = src[i + 1]
    if (!after || !/[A-Za-z/]/.test(after)) continue
    let j = i + 1
    let depth = 0
    let quote = ''
    for (; j < src.length; j++) {
      const c = src[j]
      if (quote) {
        if (c === '\\') j++
        else if (c === quote) quote = ''
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    if (j >= src.length) break
    const text = src.slice(i, j + 1)
    const closing = text.startsWith('</')
    out.push({
      start: i,
      end: j,
      text,
      closing,
      selfClosing: text.endsWith('/>'),
      name: (text.match(/^<\/?\s*([A-Za-z][A-Za-z0-9_.]*)/) ?? [, ''])[1] ?? '',
    })
    i = j
  }
  return out
}

/**
 * The element that WRAPS a position — the top of the tag stack there.
 * Returns null when the position is inside a tag's own attributes (`title={formatUSD(x)}`):
 * an attribute is not rendered text and has no typeface to be wrong about.
 */
function wrappingTag(all: Tag[], at: number): Tag | null {
  const stack: Tag[] = []
  for (const t of all) {
    if (t.start > at) break
    if (t.start <= at && at <= t.end) return null // inside the tag itself → an attribute
    if (t.closing) stack.pop()
    else if (!t.selfClosing) stack.push(t)
  }
  return stack.length ? stack[stack.length - 1] : null
}

const ON_THE_FACE = (tag: Tag | null) => Boolean(tag && /\bfont-figure\b/.test(tag.text))

interface Site {
  file: string
  fn: string
  wrapper: string
}

/**
 * The money terms, matched against a SEGMENT of an identifier rather than against the whole thing.
 *
 * ⚠ THIS USED TO BE `/usd|cents|cost|price/i` TESTED ON THE BARE IDENTIFIER, WITH NO BOUNDARY OF ANY
 * KIND, so it matched a SUBSTRING — and `setFoc·usD·raft` contains `usd`. W1.1.8 hit it on a new
 * `useState(false)` and the sweep reported "money rendered in the body sans: setFocusDraft() inside
 * <HTMLTextAreaElement | null>", which is wrong twice over in one line.
 *
 * ⚠ AND `\b` ALONE IS THE WRONG REPAIR, which is why this is a function and not a tightened regex:
 * `formatUSD` has NO word boundary before `USD`, so word-bounding the pattern stops matching the
 * exact call the rule exists for. The boundary that matters here is a camelCase segment, not a word.
 *
 * The trailing `s?` widens rather than narrows — `costs`, `prices` — because this rule's failures are
 * LOUD and in the false-positive direction, so missing a real money name is the costlier mistake.
 */
const MONEY_SEGMENT = /^(usd|cents|cost|price)s?$/i

/**
 * Split an identifier into camelCase / snake_case segments, keeping acronym runs whole.
 *
 *   formatUSD      → format · USD
 *   lensCostForLXC → lens · Cost · For · LXC
 *   USDPrice       → USD · Price          (the run stops before the capital that starts a word)
 *   setFocusDraft  → set · Focus · Draft
 *   format_usd     → format · usd
 */
function segments(ident: string): string[] {
  return ident
    .split('_')
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+|[0-9]+/g) ?? [])
}

/**
 * Does this identifier NAME money? True when any segment IS a money term — never when one merely
 * contains the letters.
 */
function isMoneyName(ident: string): boolean {
  return segments(ident).some((seg) => MONEY_SEGMENT.test(seg))
}

/** The files that can hold a RENDER site. Only `.tsx` has JSX to be wrong about. */
function sourceFiles(): { path: string; text: string }[] {
  return allSources(/\.tsx$/)
}

/**
 * Every JSX-rendered call to a money-shaped function, and whether it landed on the face.
 * `isFigure` decides which names count, so the same walker serves rule A and rule B.
 */
function figureSites(
  files: { path: string; text: string }[],
  isFigure: (name: string) => boolean,
): { onFace: Site[]; offFace: Site[] } {
  const onFace: Site[] = []
  const offFace: Site[] = []
  for (const f of files) {
    const src = stripComments(f.text)
    const all = tags(src)
    for (const m of src.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const fn = m[1]
      if (!isFigure(fn)) continue
      const wrapper = wrappingTag(all, m.index)
      if (wrapper === null) continue // an attribute, or not inside JSX at all
      const site: Site = { file: f.path, fn, wrapper: wrapper.text.replace(/\s+/g, ' ').slice(0, 90) }
      ;(ON_THE_FACE(wrapper) ? onFace : offFace).push(site)
    }
  }
  return { onFace, offFace }
}

const report = (s: Site[]) => s.map((x) => `${x.file}: ${x.fn}() inside ${x.wrapper}`).sort()

// ════════════════════════════════════════════════════════════════════════════════════════

describe('the tag scan survives the things that break a lazy regex', () => {
  it('an arrow function in an attribute does not end the tag early', () => {
    // ⚠ THE CLASS MUST COME AFTER THE ARROW, or this control does not control anything.
    // The first version of this test put `font-figure` on a CHILD element, and swapping the
    // reader for the lazy regex it warns about STILL PASSED: truncating `<button onClick={(e) >`
    // leaves the child intact, so the verdict was identical either way. It only discriminates
    // when the truncation eats the very attribute the check reads. TopUp's buy button is this
    // exact shape. Caught by running the mutation, not by reading the test.
    const src = '<button onClick={(e) => go(e)} className="font-figure">{costOf(1)}</button>'
    const found = figureSites([{ path: 'f.tsx', text: src }], (n) => n === 'costOf')
    expect(found.offFace, 'the tag was truncated at the arrow — font-figure was never seen').toEqual([])
    expect(found.onFace).toHaveLength(1)
    // and the <button> really was read as ONE tag, not two
    expect(tags(src).filter((t) => t.name === 'button' && !t.closing)).toHaveLength(1)
  })

  it('finds a money call in the sans', () => {
    const found = figureSites([{ path: 'f.tsx', text: '<span className="text-body">{formatUSD(x)}</span>' }], isMoneyName)
    expect(found.offFace).toHaveLength(1)
  })

  it('accepts the same call on the face', () => {
    const found = figureSites([{ path: 'f.tsx', text: '<span className="font-figure text-body">{formatUSD(x)}</span>' }], isMoneyName)
    expect(found.offFace).toEqual([])
    expect(found.onFace).toHaveLength(1)
  })

  it('does not police an attribute — a title has no typeface', () => {
    const found = figureSites([{ path: 'f.tsx', text: '<span title={formatUSD(x)}>hi</span>' }], isMoneyName)
    expect(found.offFace).toEqual([])
    expect(found.onFace).toEqual([])
  })

  it('does not read a commented-out example as code', () => {
    const found = figureSites([{ path: 'f.tsx', text: '<b className="x">{/* {formatUSD(x)} */}ok</b>' }], isMoneyName)
    expect(found.offFace).toEqual([])
  })

  it('the declaration of a money helper is not a render site', () => {
    // `function costLabel(usd: number)` sits outside JSX; only its USES are figures.
    const found = figureSites([{ path: 'f.tsx', text: 'function costLabel(usd: number) { return "$" + usd }' }], isMoneyName)
    expect(found.offFace).toEqual([])
    expect(found.onFace).toEqual([])
  })
})

describe('the formatter classification is total', () => {
  it('finds the formatters — it must not pass by reading an empty module', () => {
    // Literals, never `Object.keys(FORMATTERS).length`: a floor compared against the constant
    // it is protecting passes for every value, including zero.
    expect(formatModules().length, 'no module exporting a format* was discovered at all').toBeGreaterThanOrEqual(3)
    expect(exportedFormatters().length, 'no exported format* was discovered at all').toBeGreaterThanOrEqual(5)
  })

  it('every exported format* is classified, and nothing is classified that does not exist', () => {
    const exported = exportedFormatters()
    const unclassified = exported.filter((n) => !(n in FORMATTERS))
    const stale = Object.keys(FORMATTERS).filter((n) => !exported.includes(n))
    expect(unclassified, `new formatter(s) nobody classified: ${unclassified.join(', ')}`).toEqual([])
    expect(stale, `classified but no longer exported: ${stale.join(', ')}`).toEqual([])
  })

  it('a name two modules both export is two entries, not one', () => {
    // THE SPECIFIC CASE THE TOTALITY CHECK ABOVE CANNOT SEE, and the only one it cannot:
    // if the census key goes back to a bare NAME and the table goes back with it, the
    // both-directions check is satisfied by three names matching three entries and stays
    // GREEN — which is precisely the shipped state this merge replaces. That full revert is
    // the one mutation this test alone catches; anything smaller the totality check gets
    // first (measured — C7 had to be rewritten twice before it isolated this test).
    const pairs = exportedFormatters()
    const bare = pairs.filter((p) => !p.includes('#'))
    expect(bare, `the census key is a bare name again, so a namesake classifies for another module: ${bare.join(', ')}`).toEqual([])
    const byName = new Map<string, string[]>()
    for (const pair of exportedFormatters()) {
      const [mod, name] = pair.split('#')
      byName.set(name, [...(byName.get(name) ?? []), mod])
    }
    const shared = [...byName].filter(([, mods]) => mods.length > 1)
    expect(shared.length, 'no formatter name is exported by two modules — this check has no subject').toBeGreaterThan(0)
    // ⚠ THAT FLOOR CARRIES ITS OWN EXPIRY. If both namesake pairs are ever renamed apart this
    // reds with no defect present: delete this test and say so in the header, do not weaken it.
    for (const [name, mods] of shared) {
      for (const mod of mods) {
        // toContain, not toHaveProperty: a key holding `.` and `#` is a PATH to that matcher.
        expect(Object.keys(FORMATTERS), `${mod}#${name} is covered only by another module's entry`).toContain(`${mod}#${name}`)
      }
    }
  })

  it('every formatter classified as a figure renders on the figure face', () => {
    // The face scan matches a CALL, and a call site names a function, not a module — so the
    // figure set is the NAME half of every entry classified true. Two modules exporting the
    // same name are checked together here; that is a limit of a source scan, and it is safe in
    // the direction that matters (both must be on the face, so either one in the sans reds).
    const figures = new Set(
      Object.entries(FORMATTERS).filter(([, v]) => v === true).map(([k]) => k.split('#')[1]),
    )
    expect(figures.size).toBeGreaterThan(0)
    const { offFace } = figureSites(sourceFiles(), (n) => figures.has(n))
    expect(offFace, `figure formatter(s) rendered in the sans:\n  ${report(offFace).join('\n  ')}`).toEqual([])
  })
})

describe('a money NAME is a segment, not a substring (W1.1.18)', () => {
  // ⚠ BOTH DIRECTIONS, AND THE FIRST LIST IS THE ONE THAT MATTERS. Narrowing this rule until the
  // false positives disappear is how a detector stops finding the real ones — this file says so
  // twenty lines up about a different pattern — so every name the rule EXISTS for is pinned here
  // and a repair that drops one of them reds.
  const MONEY = [
    'formatUSD', // ⚠ the exact shape `\b` would have broken: no word boundary before USD
    'formatCents',
    'formatCost',
    'lensCostForLXC', // an acronym at the end, a money segment in the middle
    'costState',
    'CostNote',
    'IssueCostProbe',
    'USD',
    'costOf',
    'costLabel',
    'format_usd', // snake_case, because the call-site scan accepts underscores in an identifier
    'formatCosts', // the plural the `s?` is for
  ]

  // ⚠ WHICH OF THESE ARE OCCURRENCES AND WHICH ARE SHAPES, BECAUSE THE DIFFERENCE MATTERS AND
  // W1.1.18's OWN TEXT BLURS IT. Measured across both packages, 2026-08-26:
  //
  //   · `setFocusDraft` is REAL — it is the one that actually fired, in IssueDetail.tsx (W1.1.8).
  //   · `statusDot`, `plusData`, `bonusDay` are called "the next ones waiting" by W1.1.18. They
  //     do NOT occur in this repository — the only file containing any of them is THIS one. They
  //     are the right SHAPE (each holds `usD` across a segment boundary) and that is all, so they
  //     are kept as shapes and labelled as shapes rather than promoted to findings.
  //   · `costumeBadge` / `accostUser` exercise a different property: a segment that CONTAINS a
  //     money term without BEING one, which is what the `^…$` anchoring is for. ⚠ MEASURED: ZERO
  //     identifiers in either package have such a segment today, so the anchoring is correct and
  //     currently UNEXERCISED by real code. It is pinned anyway — it costs nothing and it is the
  //     difference between "cost" and "costume" — but nobody should read these two as sightings.
  const NOT_MONEY = [
    'setFocusDraft', // REAL: the one that fired
    'statusDot',
    'plusData',
    'bonusDay',
    'focusRing',
    'campusMap',
    'costumeBadge', // shape: `costume` contains `cost`
    'accostUser', // shape: `accost` contains `cost`
  ]

  it('catches every name the rule exists for', () => {
    const missed = MONEY.filter((n) => !isMoneyName(n))
    expect(missed, `money names the rule no longer catches: ${missed.join(', ')}`).toEqual([])
  })

  it('does not catch a name that merely CONTAINS the letters', () => {
    const wrong = NOT_MONEY.filter((n) => isMoneyName(n))
    expect(wrong, `not money, but matched: ${wrong.join(', ')}`).toEqual([])
  })

  // ⚠ THE CONTROL ON THE CONTROL. If the two lists above ever stop discriminating — because the
  // predicate went to `() => true` or `() => false` — both assertions above still pass in one of
  // the two directions and the pair reads as healthy. This asserts they disagree.
  it('the two lists are actually discriminated, not both answered the same way', () => {
    expect(MONEY.every(isMoneyName)).toBe(true)
    expect(NOT_MONEY.some(isMoneyName)).toBe(false)
    expect(MONEY.length).toBeGreaterThan(5)
    expect(NOT_MONEY.length).toBeGreaterThan(3)
  })

  it('segments identifiers the way the money rule needs', () => {
    expect(segments('formatUSD')).toEqual(['format', 'USD'])
    expect(segments('lensCostForLXC')).toEqual(['lens', 'Cost', 'For', 'LXC'])
    expect(segments('USDPrice')).toEqual(['USD', 'Price'])
    expect(segments('setFocusDraft')).toEqual(['set', 'Focus', 'Draft'])
    expect(segments('format_usd')).toEqual(['format', 'usd'])
    expect(segments('costOf2')).toEqual(['cost', 'Of2'])
  })

  // ⚠ THE POPULATION, MEASURED AGAINST THE REAL SOURCE — because the lists above are hand-written
  // and a hand-written list cannot tell you what the rule does to the code that actually exists.
  it('over the real source, catches the money names and none of the known false shapes', () => {
    const idents = new Set<string>()
    for (const f of allSources(/\.tsx?$/)) {
      for (const m of stripComments(f.text).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        idents.add(m[1])
      }
    }
    // FLOOR: a census that read nothing would pass every assertion below.
    expect(idents.size, 'the identifier census found nothing to classify').toBeGreaterThan(200)

    const caught = [...idents].filter(isMoneyName).sort()
    // ANCHORS — these exist in this repository today and are money.
    for (const anchor of ['formatUSD', 'formatCents', 'formatCost']) {
      expect(caught, `${anchor} exists in the source and the rule must still catch it`).toContain(anchor)
    }
    // and none of the shapes the substring rule got wrong
    for (const bad of NOT_MONEY) {
      expect(caught, `${bad} is not money`).not.toContain(bad)
    }
    expect(caught.length, 'the money census went empty — the rule is inert').toBeGreaterThanOrEqual(3)
  })
})

describe('the fake-JSX-wrapper reader is a KNOWN limit, pinned rather than fixed (W1.1.18)', () => {
  // ⚠ THIS IS BLINDNESS (2) FROM W1.1.18, AND IT IS PINNED HERE ON PURPOSE RATHER THAN REPAIRED.
  //
  // `tags()` looks for `<` followed by [A-Za-z/], so a TypeScript type-argument list —
  // `useRef<HTMLTextAreaElement | null>(null)` — opens a "tag" that never closes, and every
  // statement after it in the function body is scored as RENDERED, wrapped by that fake element.
  //
  // WHY IT IS NOT FIXED HERE. The direction is what decides it: a fake wrapper carries no
  // `font-figure`, so a site under it lands in offFace and the sweep FAILS LOUDLY. It can only ever
  // ADD sites, never hide one. The obvious repair — "a `<` preceded by an identifier character is a
  // generic, not JSX" — would skip a real opening tag written straight after text (`items<br />`),
  // and REMOVING sites from a guard is the wrong direction to trade into. So the limit is recorded,
  // with the shape that triggers it, and a future repair has this test to disagree with.
  it('reads a TS generic as an unclosed tag, so a call OUTSIDE JSX is scored as rendered', () => {
    // ⚠ THIS IS W1.1.8's FAILURE LINE REPRODUCED: "setFocusDraft() inside <HTMLTextAreaElement |
    // null>". The call was not inside any JSX at all — the generic opened a tag that never closed,
    // so `wrappingTag` handed back the fake element instead of the `null` that means "not rendered".
    //
    // ⚠ MY FIRST VERSION OF THIS CONTROL ASSERTED THE WRONG MECHANISM and this file caught it: I
    // put the money call inside a real <span className="font-figure"> and expected the fake tag to
    // win. It does not — the span opens later and is nested, so it is the top of the stack and the
    // site scores correctly ON the face. The fake wrapper only matters where there is no real one.
    const withGeneric =
      'function F() { const r = useRef<HTMLTextAreaElement | null>(null); const c = formatUSD(x); return null }'
    const withoutGeneric =
      'function F() { const r = useRef(null); const c = formatUSD(x); return null }'

    const fake = tags(withGeneric).find((t) => t.text.startsWith('<HTMLTextAreaElement'))
    expect(
      fake,
      'the generic no longer opens a fake tag — if that is a deliberate repair, replace this test with one that pins the repair',
    ).toBeTruthy()

    const bad = figureSites([{ path: 'f.tsx', text: withGeneric }], isMoneyName)
    const good = figureSites([{ path: 'f.tsx', text: withoutGeneric }], isMoneyName)

    // ⚠ BOTH DIRECTIONS. The second half is what makes the first mean anything: the identical call,
    // with only the generic removed, is correctly skipped as "not inside JSX".
    expect(
      bad.onFace.length + bad.offFace.length,
      'the generic should have put a non-rendered call in scope — this limit is what the test pins',
    ).toBe(1)
    expect(
      good.onFace.length + good.offFace.length,
      'without the generic the same call must be skipped entirely, or the comparison above says nothing',
    ).toBe(0)
    // and the direction: it ADDS a (false) off-face site, it never hides a real one.
    expect(bad.offFace.length).toBe(1)
  })
})

describe('every money figure in the product is on the figure face', () => {
  it('finds money to check — it must not pass by finding none', () => {
    const { onFace, offFace } = figureSites(sourceFiles(), isMoneyName)
    expect(onFace.length + offFace.length, 'no money-shaped render sites found at all').toBeGreaterThanOrEqual(5)
    // and Track's per-issue AI cost is one of them. ⚠ THIS NAMED `costLabel` UNTIL `2bee9fc`, and
    // it is the assertion that SPOKE when that helper was consolidated into an export — a
    // renamed seam empties a scan silently, and this line is the only thing in the file that
    // would have noticed. Keep it naming a real render site, never a category.
    expect([...onFace, ...offFace].some((s) => s.fn === 'formatCost')).toBe(true)
  })

  it('none of it renders in the sans', () => {
    const { offFace } = figureSites(sourceFiles(), isMoneyName)
    expect(offFace, `money rendered in the body sans:\n  ${report(offFace).join('\n  ')}`).toEqual([])
  })
})
