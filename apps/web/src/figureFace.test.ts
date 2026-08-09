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
 *      rendered into JSX must land on the figure face. This is what reaches `costLabel`, a
 *      LOCAL helper in IssueDetail.tsx that no module exports and no import list mentions.
 *   B. CLASSIFIED. Every `format*` exported by the three format modules is classified below as
 *      A FIGURE or NOT ONE, WITH ITS REASON, and the classification is checked against the
 *      modules in both directions. A formatter nobody classifies fails this file rather than
 *      defaulting into "not a figure" — the #407 move, and the one that stops rule A from
 *      quietly missing a new `formatBalance` that happens not to match the name shape.
 */

const appRoot = resolve(import.meta.dirname, '..')
const roots = [resolve(appRoot, 'src'), resolve(appRoot, '../../packages/ui/src')]
const formatModules = [
  'src/areas/lens/format.ts',
  'src/areas/track/format.ts',
  '../../packages/ui/src/lib/format.ts',
].map((p) => resolve(appRoot, p))

/**
 * Every exported `format*`, and whether its output is a FIGURE — a quantity whose digits
 * should line up — or something else. The value is `true` for a figure, or the REASON it is
 * not one. Do not delete an entry to make this file pass; say why.
 */
const FORMATTERS: Record<string, true | string> = {
  // apps/web/src/areas/lens/format.ts
  formatUSD: true,
  formatWhen: 'a timestamp rendered as prose ("3 minutes ago", "12 Aug"), not a column of digits',
  // apps/web/src/areas/track/format.ts — a second formatWhen, same shape, same answer.
  // packages/ui/src/lib/format.ts
  formatDay: 'a date label; dates are set in the sans everywhere in this product, deliberately',
}

/** `format*` names the modules actually export, which is what the table must match. */
function exportedFormatters(): string[] {
  const names = new Set<string>()
  for (const f of formatModules) {
    for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(/export\s+(?:async\s+)?function\s+(format[A-Za-z0-9_]*)/g)) {
      names.add(m[1])
    }
    for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(/export\s+const\s+(format[A-Za-z0-9_]*)\s*[:=]/g)) {
      names.add(m[1])
    }
  }
  return [...names].sort()
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

const MONEY_NAME = /usd|cents|cost|price/i

function sourceFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) {
        const rel = p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
        out.push({ path: rel, text: readFileSync(p, 'utf8') })
      }
    }
  }
  for (const r of roots) walk(r)
  return out
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
    const found = figureSites([{ path: 'f.tsx', text: '<span className="text-body">{formatUSD(x)}</span>' }], MONEY_NAME.test.bind(MONEY_NAME))
    expect(found.offFace).toHaveLength(1)
  })

  it('accepts the same call on the face', () => {
    const found = figureSites([{ path: 'f.tsx', text: '<span className="font-figure text-body">{formatUSD(x)}</span>' }], MONEY_NAME.test.bind(MONEY_NAME))
    expect(found.offFace).toEqual([])
    expect(found.onFace).toHaveLength(1)
  })

  it('does not police an attribute — a title has no typeface', () => {
    const found = figureSites([{ path: 'f.tsx', text: '<span title={formatUSD(x)}>hi</span>' }], MONEY_NAME.test.bind(MONEY_NAME))
    expect(found.offFace).toEqual([])
    expect(found.onFace).toEqual([])
  })

  it('does not read a commented-out example as code', () => {
    const found = figureSites([{ path: 'f.tsx', text: '<b className="x">{/* {formatUSD(x)} */}ok</b>' }], MONEY_NAME.test.bind(MONEY_NAME))
    expect(found.offFace).toEqual([])
  })

  it('the declaration of a money helper is not a render site', () => {
    // `function costLabel(usd: number)` sits outside JSX; only its USES are figures.
    const found = figureSites([{ path: 'f.tsx', text: 'function costLabel(usd: number) { return "$" + usd }' }], MONEY_NAME.test.bind(MONEY_NAME))
    expect(found.offFace).toEqual([])
    expect(found.onFace).toEqual([])
  })
})

describe('the formatter classification is total', () => {
  it('finds the formatters — it must not pass by reading an empty module', () => {
    expect(exportedFormatters().length).toBeGreaterThanOrEqual(3)
  })

  it('every exported format* is classified, and nothing is classified that does not exist', () => {
    const exported = exportedFormatters()
    const unclassified = exported.filter((n) => !(n in FORMATTERS))
    const stale = Object.keys(FORMATTERS).filter((n) => !exported.includes(n))
    expect(unclassified, `new formatter(s) nobody classified: ${unclassified.join(', ')}`).toEqual([])
    expect(stale, `classified but no longer exported: ${stale.join(', ')}`).toEqual([])
  })

  it('every formatter classified as a figure renders on the figure face', () => {
    const figures = new Set(Object.entries(FORMATTERS).filter(([, v]) => v === true).map(([k]) => k))
    expect(figures.size).toBeGreaterThan(0)
    const { offFace } = figureSites(sourceFiles(), (n) => figures.has(n))
    expect(offFace, `figure formatter(s) rendered in the sans:\n  ${report(offFace).join('\n  ')}`).toEqual([])
  })
})

describe('every money figure in the product is on the figure face', () => {
  it('finds money to check — it must not pass by finding none', () => {
    const { onFace, offFace } = figureSites(sourceFiles(), (n) => MONEY_NAME.test(n))
    expect(onFace.length + offFace.length, 'no money-shaped render sites found at all').toBeGreaterThanOrEqual(5)
    // and the local helper no module exports is one of them — rule A's whole reason to exist
    expect([...onFace, ...offFace].some((s) => s.fn === 'costLabel')).toBe(true)
  })

  it('none of it renders in the sans', () => {
    const { offFace } = figureSites(sourceFiles(), (n) => MONEY_NAME.test(n))
    expect(offFace, `money rendered in the body sans:\n  ${report(offFace).join('\n  ')}`).toEqual([])
  })
})
