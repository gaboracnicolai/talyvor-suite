import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// ONE comment stripper with ONE set of positive controls, the same deep import
// motion.test.tsx and deadClasses.test.ts take, and for the same reason.
import { stripComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * THE HAND-ROLLED TWINS OF THE ONE COMPONENT THAT DEFINES A TEXT FIELD.
 *
 * `dc0bd07` found this shape in corners: a hand-rolled element BYTE-IDENTICAL to a design-system
 * component apart from one class. `fe36452` found it in placeholders and fixed three fields.
 * `a6e66ff` measured that those same three are ALSO missing
 * `transition-colors duration-200 hover:border-rule-strong` and `disabled:*`, and handed it over.
 *
 * ⚠ I RE-MEASURED RATHER THAN INHERITING THE THREE, AND THE POPULATION IS FIVE. The handed-over
 * count came from the `placeholder=` sweep, so it saw the three `<input>`s that carry one. The two
 * `<textarea>`s are twins of the same class list and were never in the frame:
 *
 *     IssueList.tsx      <input>     create-issue title
 *     SpaceList.tsx      <input>     create-space name
 *     SpaceView.tsx      <input>     create-page title
 *     IssueDetail.tsx    <textarea>  issue description      ← not in the handed-over three
 *     PageView.tsx       <textarea>  page body draft        ← not in the handed-over three
 *
 * ⚠ WHAT THIS FILE ENFORCES IS INTERACTION PARITY, NOT APPEARANCE, and the line matters. A field
 * that does not respond to hover when every design-system field does is a defect. A field painted
 * on a different plane may be an inset-on-a-card decision. The first is checked here; the second
 * is MEASURED AND REPORTED at the bottom of this docstring and deliberately not merged.
 *
 * ⚠ THE REQUIRED SET IS DERIVED FROM `Input.tsx`, NEVER LISTED HERE. A curated list guards the
 * properties somebody thought of (#91) and goes stale the moment the component gains one. Read
 * from the component, both directions: a twin missing one fails, and a required token nothing
 * requires any more fails as stale.
 *
 * ⚠ MEASURED, REPORTED, NOT FIXED — APPEARANCE DIVERGENCES, because each needs a design answer:
 *   · `Input.tsx` declares `bg-surface`. THE TWO TEXTAREAS DISAGREE WITH EACH OTHER —
 *     IssueDetail's is `bg-surface`, PageView's is `bg-canvas` — and all three `<input>`s are
 *     `bg-canvas`. Same control type, two planes, in one product. Whether a field inset on a card
 *     should read `canvas` is a design call, not a typo, and it is nobody's yet.
 *   · `Input.tsx` declares `h-8` (32px) and `px-2.5`; every twin uses `px-2 py-1` and no height,
 *     so a hand-rolled field is a different HEIGHT from a design-system one on the same screen.
 *   · The obvious fix for all three `<input>`s is to USE `<Input>`, which deletes the divergence
 *     rather than tracking it. That changes plane and height on three live surfaces, so it is a
 *     design decision with a screenshot attached, not a session's call.
 */

const appRoot = resolve(import.meta.dirname, '..')
const roots = [resolve(appRoot, 'src'), resolve(appRoot, '../../packages/ui/src')]
const inputComponent = resolve(appRoot, '../../packages/ui/src/components/Input.tsx')

interface SourceFile {
  path: string
  text: string
}

function sourceFiles(): SourceFile[] {
  const out: SourceFile[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const rel = p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
        out.push({ path: rel, text: readFileSync(p, 'utf8') })
      }
    }
  }
  for (const r of roots) walk(r)
  return out
}

/**
 * The opening tag starting at `<`, read to its own `>`.
 *
 * ⚠ NOT A LAZY `<[^>]*>` — #93 paid for that one. An arrow function inside an attribute contains
 * a `>` (`onChange={(e) => …}`), which truncates the tag and silently mis-reads everything after
 * it. Brace and quote depth are tracked, so the `>` that ends the tag is the only one that counts.
 */
function openingTag(src: string, start: number): string {
  let depth = 0
  let quote = ''
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

/** The class tokens on one element: every string literal in its className, `${…}` removed. */
function classTokens(tag: string): string[] {
  const m = /\bclassName\s*=\s*/.exec(tag)
  if (!m) return []
  const rest = tag.slice(m.index + m[0].length)
  let region = rest
  if (rest[0] === '{') {
    let depth = 0
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '{') depth++
      else if (rest[i] === '}') { depth--; if (depth === 0) { region = rest.slice(1, i); break } }
    }
  } else if (rest[0] === '"' || rest[0] === "'") {
    const end = rest.indexOf(rest[0], 1)
    region = end < 0 ? rest : rest.slice(1, end)
  }
  const tokens: string[] = []
  const literals = [...region.matchAll(/(?:'([^'\n]*)'|"([^"\n]*)"|`([\s\S]*?)`)/g)]
  const source = literals.length
    ? literals.map((l) => (l[1] ?? l[2] ?? l[3] ?? '')).join(' ')
    : region
  for (const t of source.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (t) tokens.push(t)
  return tokens
}

interface RawControl {
  path: string
  tag: string
  tokens: string[]
}

/** Every raw <input>/<textarea> the product writes, with the classes on it. */
function rawControls(files: SourceFile[]): RawControl[] {
  const out: RawControl[] = []
  for (const f of files) {
    const src = stripComments(f.text)
    for (const m of src.matchAll(/<(input|textarea)\b/g)) {
      const tag = openingTag(src, m.index)
      out.push({ path: f.path, tag: m[1], tokens: classTokens(tag) })
    }
  }
  return out
}

const STATE_VARIANT = /^(hover|focus|focus-visible|active|disabled|checked)$/
const TRANSITION = /^transition(-(all|colors|opacity|shadow|transform))?$/
const DURATION = /^duration-\d+$/

/**
 * What a text field must do, read off the component that defines one.
 *
 * State-variant tokens are the interaction contract; the transition and its duration are what
 * make the state CHANGE rather than snap, and `5d65b3e`/`6fbf669` already hold both halves of
 * that rule everywhere else.
 */
function requiredOfATextField(): string[] {
  // The component's class list lives in a `cn()` call rather than on the tag, so the region to
  // read is that call's balanced argument list.
  const src = stripComments(readFileSync(inputComponent, 'utf8'))
  const at = src.indexOf('cn(')
  let depth = 0
  let body = ''
  for (let i = at + 2; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) { body = src.slice(at + 3, i); break } }
  }
  const declared: string[] = []
  for (const l of body.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
    for (const t of (l[1] ?? l[2] ?? '').split(/\s+/)) if (t) declared.push(t)
  }
  return declared.filter((t) => {
    const parts = t.split(':')
    if (parts.length > 1 && parts.slice(0, -1).some((v) => STATE_VARIANT.test(v))) return true
    return TRANSITION.test(t) || DURATION.test(t)
  })
}

/**
 * NOT HELD TO THE TEXT-FIELD CONTRACT, each with its reason.
 * ⚠ Both directions: an entry that stops being a raw control fails as stale.
 */
const NOT_A_TEXT_FIELD: Record<string, string> = {
  'packages/ui/src/components/Input.tsx':
    'the component itself — it IS the contract, and holding the definition to its own derived requirements is circular',
  'apps/web/src/areas/marketing/Landing.tsx':
    'an <input type="range"> pool slider wearing the tal-range treatment; a slider is not a text field and shares none of its affordances',
}

function parityGaps(files: SourceFile[]): string[] {
  const required = requiredOfATextField()
  const gaps: string[] = []
  for (const c of rawControls(files)) {
    if (c.path in NOT_A_TEXT_FIELD) continue
    const missing = required.filter((r) => !c.tokens.includes(r))
    if (missing.length) gaps.push(`${c.path} <${c.tag}>: missing ${missing.join(' ')}`)
  }
  return [...new Set(gaps)].sort()
}

// ════════════════════════════════════════════════════════════════════════════════════════

describe('the instrument', () => {
  it('reads a tag past an arrow function in an attribute — #93 paid for the lazy regex', () => {
    const tag = openingTag('<input onChange={(e) => setX(e)} className="a b" />', 0)
    expect(tag).toContain('className="a b"')
    expect(classTokens(tag)).toEqual(['a', 'b'])
  })

  it('reads a template class list and drops the ${…} regions', () => {
    const tag = openingTag('<input className={`a b ${focusRing}`} />', 0)
    expect(classTokens(tag)).toEqual(['a', 'b'])
  })

  it('reads a cn() class list spread over several literals', () => {
    const tag = openingTag("<input className={cn('a b', 'c', className)} />", 0)
    expect(classTokens(tag)).toEqual(['a', 'b', 'c'])
  })

  it('finds the real controls in both packages — it must not pass by scanning nothing', () => {
    const controls = rawControls(sourceFiles())
    expect(controls.length, 'no raw <input>/<textarea> was found at all').toBeGreaterThan(4)
    expect(controls.some((c) => c.tag === 'textarea'), 'the textareas are unscanned').toBe(true)
    expect(controls.some((c) => c.path.startsWith('packages/')), 'the design system is unscanned').toBe(true)
  })

  it('derives the contract from Input.tsx, and it is not empty', () => {
    const required = requiredOfATextField()
    expect(required.length, 'no interaction contract was derived from the component').toBeGreaterThan(2)
    // the component really does declare these — read, not assumed
    expect(required).toContain('transition-colors')
    expect(required).toContain('hover:border-rule-strong')
    expect(required.some((t) => t.startsWith('disabled:'))).toBe(true)
    // and it is a DERIVED set, not the whole class list: appearance stays out
    expect(required).not.toContain('bg-surface')
    expect(required).not.toContain('h-8')
  })
})

describe('every hand-rolled text field honours the component contract', () => {
  it('none is missing an interaction the design system guarantees', () => {
    const gaps = parityGaps(sourceFiles())
    expect(gaps, `a hand-rolled text field diverges from Input.tsx:\n  ${gaps.join('\n  ')}`).toEqual([])
  })

  it('the scanner reports a real divergence rather than passing everything', () => {
    const gaps = parityGaps([{ path: 'fixture.tsx', text: '<input className="w-full" />' }])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toContain('missing')
  })

  it('every exemption is still a raw control — a stale exemption fails', () => {
    const paths = new Set(rawControls(sourceFiles()).map((c) => c.path))
    const stale = Object.keys(NOT_A_TEXT_FIELD).filter((p) => !paths.has(p))
    expect(stale, `exempted, but no longer writes a raw control:\n  ${stale.join('\n  ')}`).toEqual([])
    for (const [, why] of Object.entries(NOT_A_TEXT_FIELD)) expect(why.length).toBeGreaterThan(40)
  })
})
