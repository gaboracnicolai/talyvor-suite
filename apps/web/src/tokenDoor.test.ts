import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import tailwindConfig, { absoluteContent, buildContent } from '../tailwind.config'
import preset from '@talyvor/ui/preset'
// Deep relative import on purpose, exactly as deadClasses.test.ts does it: ONE implementation
// of the comment stripper with ONE set of positive controls. Two copies of a scanner is two
// chances for only one of them to be right.
import { stripComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * THE OTHER DOOR.
 *
 * preset.ts opens by saying, of itself: "Every value the components may use is a NAMED token
 * here; arbitrary values (text-[#…], p-[13px]) are forbidden by local/no-arbitrary-value so
 * THIS FILE IS THE ONLY DOOR to the palette, scale, spacing and radii."
 *
 * ⚠ THE LOCK FORBIDS INVENTING A VALUE AND PERMITS REACHING PAST THE TOKEN TO TAILWIND'S OWN.
 * `local/no-arbitrary-value` fails on a `[...]` group — an ESCAPE. `rounded-lg` carries no
 * brackets, is a perfectly ordinary Tailwind utility, and lints clean. The preset uses
 * `theme.extend`, so every Tailwind default survives underneath the tokens: the door is the
 * only door nobody may CARVE, and it stands beside a door that was always open.
 *
 * MEASURED at 8555e1e, by asking the generator rather than by reading: Tailwind was run twice
 * over the same real content, once with the preset and once without, and every class the
 * source writes was classified. Three of the closed families held and one did not.
 *
 *   palette      0 bypasses.  Not one Tailwind hue anywhere in either package.
 *   type scale   0 bypasses.  Confirms `0292cf0`'s hand measurement, mechanically.
 *   radii       13 bypasses.  Five corner radii in a system that declares three.
 *
 * ⚠ AND THE SHAPE OF THE THIRTEEN IS THE FINDING, NOT THE COUNT. Every one is a hand-rolled
 * twin of a design-system component that differs from the component ONLY by reaching past the
 * radius token:
 *
 *   Card.tsx      `overflow-hidden rounded-card border border-rule bg-surface`      10px
 *   Landing.tsx   `overflow-hidden rounded-lg   border border-rule bg-surface`  ×2   8px
 *
 *   Input.tsx     `h-8 w-full rounded-control border border-rule bg-surface px-2.5`  6px
 *   five hand-rolled text inputs and textareas, `rounded`                            4px
 *
 *   Pill.tsx      `h-1.5 w-1.5 shrink-0 rounded-pill`                            9999px
 *   Entry.tsx     `mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent`             9999px
 *
 * The Landing pair is byte-identical to Card's class list apart from the radius. The Entry dot
 * is byte-identical to Pill's dot apart from the radius and the fill. Same element, twice, one
 * on the scale and one beside it — the shape `7e2e9fc` found in the money figures, in corners.
 *
 * ⚠ THIS TEST WILL PASS BY FINDING NOTHING THE MOMENT THE THIRTEEN ARE FIXED, which is exactly
 * the condition the queue says to distrust. So the classification itself is asserted first, in
 * both directions and on known answers, and the sweep carries a floor: see NON-VACUITY below.
 *
 * ⚠ WHAT THE FIX DID TO THE SHIPPED SHEET, MEASURED RATHER THAN CLAIMED — 347 names to 345.
 * `rounded-lg` and `rounded-full` are gone. `rounded` IS NOT: six comments and one line of JSX
 * prose contain the English word "rounded" ("never rounded up into a friendlier number", "the
 * Talyvor mark: a rounded hairline tile"), and Tailwind's extractor reads raw text, so the
 * class survives with ZERO elements using it. That is W1.8, with a name on it — this merge
 * removes the last USE of a 4px corner and cannot remove the RULE, and says so rather than
 * selling a saving it did not make.
 *
 * ⚠ AND THE MEASUREMENT THAT ALMOST WENT THE OTHER WAY. The first before/after showed the
 * emitted set UNCHANGED, 369 both sides, which read as "the fix does nothing". It was the
 * INSTRUMENT: the guards resolve the config's content globs with `resolve()`, which destroys
 * the `!` negations, so both runs were scanning every test file — including this one, whose
 * docstring names `rounded-lg`. The guard was reading its own prose back as product. Fixed in
 * tailwind.config.ts (`absoluteContent`), used by deadClasses.test.ts too, and pinned by the
 * negation test below.
 *
 * POSITIVE CONTROLS — eight, each anchor-count-asserted BEFORE the edit, each observed, each
 * restored sha256-identical: regress a fixed site · a Tailwind type step · a Tailwind hue · a
 * radius nobody used before · blind the classifier · drop a closed family · widen the
 * exemption to a real hue · revert the glob fix. Eight red, none blind. ⚠ TWO OF THEM DID NOT
 * RUN THE FIRST TIME — the anchor assertion caught counts of 5 and 0 where I had written 1, so
 * they would have been a no-op and a wrong edit reported as evidence (#71's lesson, and it has
 * now paid for itself twice in this repo). ⚠ AND THE EXEMPTION CONTROL WAS GREEN-FOR-NOTHING
 * until the glob fix: it asked whether `border-black` is caught, and the only reason the class
 * was ever generated is that the broken content set was scanning this file's own source.
 */

const appRoot = resolve(import.meta.dirname, '..')
const roots = [resolve(appRoot, 'src'), resolve(appRoot, '../../packages/ui/src')]

/**
 * EVERY FAMILY THE PRESET EXTENDS IS CLASSIFIED, WITH ITS REASON, AND THE CLASSIFICATION IS
 * TOTAL. A new `theme.extend` key fails here until somebody decides which kind it is; a
 * deleted one fails as stale. A source-derived sweep cannot see what is no longer there, so
 * the keys are pinned against the preset both ways.
 *
 * CLOSED — the tokens are the WHOLE vocabulary. Tailwind's built-in members of the family
 * carry no meaning in this system, and using one is the bypass this file exists to catch.
 */
const CLOSED: Record<string, string> = {
  colors:
    'every entry is a CSS variable that flips with the theme; a Tailwind hue is a frozen hex ' +
    'that would look right in one theme and wrong in the other',
  borderColor: 'the rule colours, same variables, same reason',
  outlineColor: 'the focus ring is one colour and it is the accent',
  ringColor: 'as outlineColor — the focus ring is the accent and there is no second one',
  fontFamily: 'three faces — sans, mono, and the figure face. There is no fourth',
  fontSize:
    'the locked scale. Each step carries its own leading AND weight, so a Tailwind step is ' +
    'not merely a different size — it silently drops the weight the step exists to carry',
  borderRadius: 'three corners: control 6px, card 10px, pill. Tailwind ships nine others',
}

/**
 * OPEN — the preset ADDS a named member to a scale that legitimately keeps its other members.
 * These are aliases, not vocabularies, and flagging them would report several hundred correct
 * class lists. A guard that cries wolf once is a guard somebody deletes.
 */
const OPEN: Record<string, string> = {
  spacing:
    'gutter (16px) and row (38px) are SEMANTIC NAMES added to Tailwind\'s numeric scale, ' +
    'which stays in use and should: gap-2 alone appears in 24 files',
  height: 'row (38px), the same semantic name over the same numeric scale as spacing',
  minHeight: 'row, as spacing — and min-h-screen/min-h-full are not spacing values at all',
  screens: 'wide is an ADDED breakpoint; sm:/md:/lg: remain Tailwind\'s and remain correct',
  scale:
    'one added step, 98, the press. Tailwind\'s scale-95/100 remain reachable and ' +
    'apps/web/src/motion.test.tsx is what pins the press to one step',
}

/**
 * COLOUR KEYWORDS THAT ARE NOT PALETTE ENTRIES. `transparent` is the ABSENCE of a colour, not
 * a hue chosen instead of a token: Button and Switch use it to hold a border's WIDTH while
 * declining its colour, so the control does not jump by 1px when it gains one. Narrow on
 * purpose — `border-black` would still fail — and checked in both directions below, because an
 * exemption nothing uses is an exemption nobody has re-read.
 */
const NOT_A_HUE = new Set(['transparent', 'current', 'inherit'])

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
 * Class tokens the source actually writes. Same two-harvest shape as deadClasses.test.ts and
 * for the same measured reasons: reading only `className=` is blind to the LOOKUP TABLES the
 * component layer keeps its variants in, and reading every literal reports English.
 */
function collectUsedTokens(emitted: Set<string>): Map<string, string[]> {
  const used = new Map<string, string[]>()
  const SHAPE = /^[a-z0-9][a-z0-9:/._-]*$/
  const add = (token: string, where: string) => {
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
        const src = stripComments(readFileSync(p, 'utf8'))
        const where = p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
        for (const m of src.matchAll(attr)) {
          for (const t of stripInterpolations(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').split(/\s+/)) {
            add(t, where)
          }
        }
        for (const m of src.matchAll(call)) {
          for (const lit of m[1].matchAll(literal)) {
            if (/[=!]==?$/.test(m[1].slice(0, lit.index).trimEnd())) continue
            for (const t of stripInterpolations(lit[1] ?? lit[2] ?? lit[3] ?? '').split(/\s+/)) add(t, where)
          }
        }
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

type Emitted = { props: Set<string>; decls: string }

/** Every class Tailwind emits over the real content, with what it declares — props AND values. */
async function generate(withPreset: boolean, extra?: string): Promise<Map<string, Emitted>> {
  // ⚠ `buildContent` — the build's files AND its transformers. Reading the globs alone made
  // this instrument answer for a sheet 20 classes larger than the one the browser downloads.
  const content = buildContent(appRoot, extra ? [{ raw: extra, extension: 'html' }] : [])
  const cfg = withPreset ? { ...tailwindConfig, content } : { content }
  const css = await postcss([tailwind(cfg as never)]).process('@tailwind utilities;', { from: undefined })
  const byClass = new Map<string, Emitted>()
  postcss.parse(css.css).walkRules((rule) => {
    const props = new Set<string>()
    const decls: string[] = []
    rule.walkDecls((d) => {
      props.add(d.prop)
      decls.push(`${d.prop}:${d.value}`)
    })
    if (!props.size) return
    // Same unescaping as deadClasses: the escape alternative MUST come first, or the lone
    // backslash in `.w-1\.5` matches the character class and the class reads as `w-1`.
    for (const m of rule.selector.matchAll(/\.((?:\\.|[^\s{,:.>+~()])+)/g)) {
      const name = m[1].replace(/\\(.)/g, '$1')
      if (!byClass.has(name)) byClass.set(name, { props, decls: decls.sort().join(';') })
    }
  })
  return byClass
}

/** `wide:py-20` is a preset SCREEN over a Tailwind utility. Classify the base utility. */
const base = (c: string) => c.slice(c.lastIndexOf(':') + 1)

type Door = {
  /** classes the preset OWNS — the tokens themselves */
  tokenClasses: Map<string, Set<string>>
  /** token classes belonging to a CLOSED family, as prefix → declared properties */
  closedPrefixes: Map<string, Set<string>>
  withPreset: Map<string, Emitted>
  isToken: (cls: string) => boolean
}

async function readDoor(extra?: string): Promise<Door> {
  const withPreset = await generate(true, extra)
  const withoutPreset = await generate(false, extra)
  const stock = new Map([...withoutPreset].map(([k, v]) => [base(k), v]))

  /**
   * ⚠ A TOKEN CAN WEAR A TAILWIND NAME, AND THE FIRST RUN OF THIS TEST PROVED IT.
   * Classifying by NAME — "emitted only when the preset is present" — reported `font-mono` as
   * a bypass in ten files. It is not: `fontFamily.mono` SHADOWS Tailwind's key, so the class
   * survives the preset's removal while its VALUE does not (`var(--mono)` becomes
   * ui-monospace, SFMono-Regular, …). Same for `font-sans` and for the DEFAULT border colour.
   * A guard that fails on the correct use of a token is a guard somebody deletes, so the
   * question is not whether Tailwind also ships the NAME — it is whose VALUE is being served.
   */
  const tokenClasses = new Map<string, Set<string>>()
  const isToken = (cls: string) => {
    const b = base(cls)
    const mine = withPreset.get(cls)
    const theirs = stock.get(b)
    if (!mine) return false
    return !theirs || theirs.decls !== mine.decls
  }
  for (const [name, e] of withPreset) if (isToken(name)) tokenClasses.set(base(name), e.props)

  /**
   * WHICH FAMILY DOES A TOKEN CLASS BELONG TO? Answered from the preset's own keys, never from
   * a table of utility prefixes: `rounded-card` is borderRadius because `card` is a
   * borderRadius key. The utility PREFIX (`rounded-`) falls out of the same match, so the
   * prefix set is derived rather than typed — a new colour token teaches this test the
   * `decoration-` prefix the day Tailwind starts emitting one.
   */
  const closedPrefixes = new Map<string, Set<string>>()
  for (const [family, keys] of Object.entries(preset.theme.extend)) {
    if (!(family in CLOSED)) continue
    for (const key of Object.keys(keys as Record<string, unknown>)) {
      const suffix = key === 'DEFAULT' ? '' : key
      for (const [cls, props] of tokenClasses) {
        if (suffix === '' ? false : cls === suffix || cls.endsWith(`-${suffix}`)) {
          const prefix = cls.slice(0, cls.length - suffix.length)
          const at = closedPrefixes.get(prefix) ?? new Set<string>()
          for (const p of props) at.add(p)
          closedPrefixes.set(prefix, at)
        }
      }
    }
  }
  return { tokenClasses, closedPrefixes, withPreset, isToken }
}

/**
 * A used class reaches past a closed door iff BOTH hold, and neither alone is enough —
 * measured, not assumed:
 *   PREFIX  it shares a utility prefix with a token of a closed family. Prefix alone flags
 *           `text-center`, which is an alignment and no business of the type scale.
 *   PROPERTY it declares a property that token declares. Property alone flags `tracking-wide`,
 *           whose letter-spacing the eyebrow step also carries — a real overlap that
 *           typeface.test.tsx already polices for its own better reason.
 */
function bypasses(door: Door, used: Map<string, string[]>): string[] {
  const out: string[] = []
  for (const [cls, where] of used) {
    const b = base(cls)
    const emitted = door.withPreset.get(cls)
    if (!emitted) continue // dead class — deadClasses.test.ts owns that failure
    if (door.isToken(cls)) continue
    const props = emitted.props
    for (const [prefix, tokenProps] of door.closedPrefixes) {
      const inFamily = b === prefix.replace(/-$/, '') || b.startsWith(prefix)
      if (!inFamily) continue
      const value = b.slice(prefix.length)
      if (NOT_A_HUE.has(value)) continue
      if (![...props].some((p) => tokenProps.has(p))) continue
      out.push(`${cls}  (${where.join(', ')})`)
      break
    }
  }
  return out.sort()
}

describe('the classification is total and the instrument works', () => {
  /**
   * ⚠ THE INSTRUMENT MUST ASK THE BUILD'S QUESTION. Every generator-reading guard in this repo
   * is only as good as the content set it hands Tailwind, and the obvious way to make those
   * globs absolute drops the negations silently — see tailwind.config.ts. Pinned structurally
   * rather than by counting emitted classes, because a count moves whenever anybody writes a
   * class and would be re-baselined rather than read.
   */
  it('the content globs keep their negations when made absolute', () => {
    const globs = absoluteContent(appRoot)
    const negated = globs.filter((g) => g.startsWith('!'))
    expect(negated.length, 'the test-file exclusions are gone').toBe(2)
    for (const g of negated) expect(g).toMatch(/^!\/.+\.test\.\{ts,tsx\}$/)
    // and no `!` was smuggled into a path segment, which is how the exclusion silently became
    // a positive include of a directory that does not exist
    expect(globs.filter((g) => g.includes('/!'))).toEqual([])
    for (const g of globs) expect(g.replace(/^!/, '').startsWith('/'), `${g} is not absolute`).toBe(true)
  })

  it('every family the preset extends is classified exactly once', () => {
    const extended = Object.keys(preset.theme.extend).sort()
    const classified = [...Object.keys(CLOSED), ...Object.keys(OPEN)].sort()
    expect(classified, 'a preset family is unclassified, or a classification is stale').toEqual(extended)
    for (const k of Object.keys(CLOSED)) expect(k in OPEN, `${k} is classified twice`).toBe(false)
    for (const [, why] of Object.entries({ ...CLOSED, ...OPEN })) expect(why.length).toBeGreaterThan(20)
  })

  it('no token key is claimed by both a closed and an open family', () => {
    const keysOf = (names: string[]) =>
      new Set(names.flatMap((n) => Object.keys((preset.theme.extend as Record<string, object>)[n] ?? {})))
    const closed = keysOf(Object.keys(CLOSED))
    const open = keysOf(Object.keys(OPEN))
    const both = [...closed].filter((k) => open.has(k))
    expect(both, `ambiguous token key(s): ${both.join(', ')}`).toEqual([])
  })

  it('token and default are told apart on known answers', async () => {
    const door = await readDoor()
    // Tokens — the preset serves their value.
    for (const t of ['rounded-card', 'rounded-control', 'rounded-pill', 'text-body', 'text-eyebrow', 'bg-canvas', 'font-figure']) {
      expect(door.tokenClasses.has(t), `${t} should be token-derived`).toBe(true)
    }
    // ⚠ AND THE SHADOWED CASE, which the first run of this file got wrong: Tailwind ships
    // this NAME, the preset replaces its VALUE, and it is a token. Classifying by name alone
    // reported font-mono as a bypass in ten files.
    expect(door.tokenClasses.has('font-mono'), "font-mono is the preset's value under a Tailwind name").toBe(true)
    // Defaults — these are Tailwind's and would survive the preset being deleted.
    for (const d of ['rounded-lg', 'rounded-full', 'text-sm', 'flex', 'gap-2', 'w-full']) {
      expect(door.tokenClasses.has(d), `${d} should NOT be token-derived`).toBe(false)
    }
    // The closed prefixes are DERIVED. If this comes back empty the whole sweep is inert.
    expect(door.closedPrefixes.has('rounded-'), 'borderRadius prefix not derived').toBe(true)
    expect(door.closedPrefixes.get('rounded-')?.has('border-radius')).toBe(true)
    expect(door.closedPrefixes.has('text-'), 'type/colour prefix not derived').toBe(true)
  })
})

describe('the sweep', () => {
  it('finds classes to check — it must not pass by finding nothing', async () => {
    const door = await readDoor()
    const used = collectUsedTokens(new Set(door.withPreset.keys()))
    expect(used.size).toBeGreaterThan(150)
    expect(door.tokenClasses.size).toBeGreaterThan(40)
    expect(door.closedPrefixes.size).toBeGreaterThan(3)
    // and it reaches BOTH packages, and the lookup tables inside cn()
    const files = [...used.values()].flat()
    expect(files.some((f) => f.startsWith('apps/'))).toBe(true)
    expect(files.some((f) => f.startsWith('packages/'))).toBe(true)
    expect(used.has('bg-lens'), "MuNumeral's unit-tick table is not being read").toBe(true)
  })

  it('is a rule about something — the closed families are really in use', async () => {
    const door = await readDoor()
    const used = collectUsedTokens(new Set(door.withPreset.keys()))
    // ⚠ THE FLOOR. Once the thirteen are fixed this test's headline assertion is `[]`, and an
    // empty answer is what a BROKEN sweep also returns. So the tokens the fix moves TO must be
    // demonstrably present: a guard that would stay green over a product with no radii at all
    // is a guard about nothing.
    const present = (c: string) => expect(used.has(c), `${c} is not rendered anywhere`).toBe(true)
    present('rounded-control')
    present('rounded-card')
    present('rounded-pill')
    present('text-body')
    present('text-ink')
  })

  it('the exemption is narrow and is not stale', async () => {
    const door = await readDoor()
    const used = collectUsedTokens(new Set(door.withPreset.keys()))
    // In use — otherwise NOT_A_HUE is guarding nothing and should go.
    expect(used.has('border-transparent'), 'the transparent exemption is stale').toBe(true)

    // And it does not WIDEN: a real hue is still a bypass.
    // ⚠ THIS CONTROL SUPPLIES ITS OWN FIXTURE, and the reason is the bug this merge fixed.
    // Written as `bypasses(door, {'border-black': …})` against the ordinary door it PASSED —
    // but only because the broken glob resolution was scanning THIS FILE, so the word
    // `border-black` in the control's own source made Tailwind emit the class it was testing
    // for. With the negations restored the class is not emitted, `bypasses` skips it, and the
    // control went green-for-nothing. A control that reaches its verdict through a defect in
    // the harness is the failure mode this repo keeps catching one level up.
    const control = await readDoor('<div class="border-black border-transparent"></div>')
    const asked = new Map<string, string[]>([
      ['border-black', ['(control)']],
      ['border-transparent', ['(control)']],
    ])
    expect(bypasses(control, asked)).toEqual(['border-black  ((control))'])
  })

  it('nothing reaches past a closed door', async () => {
    const door = await readDoor()
    const used = collectUsedTokens(new Set(door.withPreset.keys()))
    const found = bypasses(door, used)
    expect(
      found,
      `class(es) using a Tailwind default where the preset declares the vocabulary:\n  ${found.join('\n  ')}`,
    ).toEqual([])
  })
})
