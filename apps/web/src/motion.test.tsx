import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import { Button, Switch, ThemeToggle } from '@talyvor/ui'
import tailwindConfig, { absoluteContent } from '../tailwind.config'
// Deep relative import, the same one deadClasses.test.ts takes and for the same reason:
// ONE comment stripper with ONE set of positive controls (packages/ui/src/__tests__/
// typeface.test.tsx). Two copies of a scanner is two chances for only one to be right.
import { stripComments } from '../../../packages/ui/src/lib/sourceText'

/**
 * MOTION ON STATE CHANGE — the last line of the site's language the console had not ported,
 * and the one with a trap in it.
 *
 * ⚠ MEASURED OFF THE SERVED SITE, 2026-08-09, eleven pages fetched from
 * talyvor.higgsfield.app (home, economy, pricing, lens, track, docs, code, self-host,
 * attribution, roadmap, terms):
 *
 *     transition-colors        174   duration-200   151   ← the modal duration, by a mile
 *     transition-transform      52   duration-300    69
 *     transition-all            22   duration-500    32
 *     transition-none           72   duration-700     9
 *     active:scale-[0.98]        3   motion-reduce:transition-none  72
 *
 * And measured on this repo at 9e03e50: `active:scale` appeared ZERO times — no press
 * feedback anywhere — and NOT ONE of the nine `transition-*` class lists carried a
 * `duration-*`, so every one of them ran at Tailwind's default. That default is not the
 * site's number; asked directly, the generator emits `transition-duration: 150ms` for a
 * bare `transition-colors`. Fifty milliseconds fast on every control in the product.
 *
 * ⚠ THE TRAP, AND THE REASON THIS FILE EXISTS RATHER THAN A LINE IN A COMMIT MESSAGE.
 * theme.css's reduced-motion block forces `transition-duration: .001ms !important` and
 * stops there. A transition-duration of zero does not remove a transform — it removes the
 * TWEEN. `active:scale-98` under that block is not "no motion", it is the same 2% shrink
 * arriving INSTANTLY, delivered to exactly the people who asked for less of it. The block
 * has to neutralise the scale itself.
 *
 * ⚠ AND THE TRAP INSIDE THE TRAP, which is why the fourth guard below exists. The obvious
 * neutralisation — `transform: none !important` on the universal selector — is wrong, and
 * wrong in a way nothing else in this repo would catch. The Switch's ON state is
 * `data-[state=checked]:translate-x-3.5` on its thumb: a TRANSFORM carrying STATE, not
 * decoration. Kill transform wholesale and the thumb sits at the off position while
 * `aria-checked="true"`, leaving the accent track as the only signal — a hue, alone,
 * for the one user group most likely to also need a non-colour one. So the neutralisation
 * is scoped to the two scale variables, and this file pins that it stays scoped.
 *
 * WHAT THIS FILE CAN AND CANNOT SEE. It reads the SHIPPED stylesheet — theme.css plus
 * what Tailwind generates from the real config and the real content — and reasons about
 * one two-rule cascade in it (below). It does not run a browser, so it cannot watch a
 * button shrink. Everything it claims is a claim about declarations, and it says so.
 */

const appRoot = resolve(import.meta.dirname, '..')
const roots = [resolve(appRoot, 'src'), resolve(appRoot, '../../packages/ui/src')]
const themeCssPath = resolve(appRoot, '../../packages/ui/src/theme.css')

// ── the stylesheet the browser actually gets ────────────────────────────────────────────
//
// main.tsx imports `@talyvor/ui/theme.css` and then `./styles.css` (which is the three
// @tailwind directives), so this concatenation is the bundle's order. Order does not decide
// any question below — importance does — but mirroring it keeps the artifact honest.
let shipped: string | undefined
/** The exact globs handed to the generator, kept so a test can assert they are the BUILD's. */
let shippedContent: string[] | undefined
async function shippedCss(): Promise<string> {
  if (shipped) return shipped
  // ⚠ `absoluteContent`, NEVER `content.map((g) => resolve(root, g))` — see tailwind.config.ts.
  // This file used the second form until `w11-press-guard`, which made it the THIRD copy of a
  // seam `dc0bd07` fixed in two places while its own docstring claimed "one implementation".
  // Measured on this tree: the mapped form generated 30,321 bytes where the build generates
  // 28,351, because the destroyed `!` negations pulled every test file back into the content
  // set — including this one, whose docstring names `active:scale-[0.98]`. A guard that reads
  // its own prose back as product is `dc0bd07`'s finding, and it had survived here.
  const content = absoluteContent(appRoot)
  shippedContent = content
  const generated = await postcss([tailwind({ ...tailwindConfig, content: content as never })]).process(
    readFileSync(resolve(appRoot, 'src/styles.css'), 'utf8'),
    { from: undefined },
  )
  shipped = readFileSync(themeCssPath, 'utf8') + '\n' + generated.css
  return shipped
}

interface Decl {
  prop: string
  value: string
  important: boolean
  selector: string
  reducedMotion: boolean
}

/** Every declaration in a stylesheet, tagged with whether a reduced-motion query encloses it. */
function declarations(css: string): Decl[] {
  const out: Decl[] = []
  postcss.parse(css).walkDecls((d) => {
    let reducedMotion = false
    for (let p: postcss.Container | postcss.Document | undefined = d.parent; p; p = p.parent) {
      if (p.type === 'atrule') {
        const at = p as postcss.AtRule
        if (at.name === 'media' && /prefers-reduced-motion\s*:\s*reduce/.test(at.params)) reducedMotion = true
      }
    }
    out.push({
      prop: d.prop,
      value: d.value.trim(),
      important: Boolean(d.important),
      selector: d.parent?.type === 'rule' ? (d.parent as postcss.Rule).selector : '',
      reducedMotion,
    })
  })
  return out
}

/**
 * THE PRESS SCALE AND ITS NEUTRALISATION — one cascade, decided by importance alone.
 *
 * `active:scale-98` sets `--tw-scale-x/y: 0.98` from a class selector, unimportant. The
 * reduced-motion block sets them back to 1 from the universal selector, IMPORTANT. Those
 * are the only two rules in the sheet that touch these variables (preflight's defaults are
 * also unimportant and also 1), and `!important` beats unimportant regardless of
 * specificity or order — so the winner under reduced motion is 1, and the press is a no-op
 * rather than a jump. That is the whole argument, and it holds without a layout engine.
 *
 * Returns the problems, so the same function can be pointed at a deliberately broken sheet.
 */
function pressScaleProblems(css: string): string[] {
  const problems: string[] = []
  const scale = declarations(css).filter((d) => d.prop === '--tw-scale-x' || d.prop === '--tw-scale-y')

  // ⚠⚠ THIS IS NOT THE VACUITY GUARD, AND IT CANNOT BE ONE. IT SAID IT WAS UNTIL
  // `w11-press-guard`, in these words: "without this the file would go green if someone DELETED
  // the press feedback". MEASURED, by deleting `active:scale-98` from all three product sites
  // (Button, ThemeToggle, the Landing stepper) and regenerating:
  //
  //     sheet bytes            30,321 -> 30,321   BYTE-IDENTICAL
  //     unimportant 0.98 decls      6 ->      6   (4 with the negations intact; the floor is 2)
  //
  // Nothing moved, because Tailwind's extractor reads RAW TEXT and cannot tell a class from a
  // sentence about a class: `preset.ts:119` writes `active:scale-[0.98]` in a COMMENT and
  // `Button.tsx:37` writes `active:scale-98` in a COMMENT, so the sentences EXPLAINING the press
  // compile the press into the stylesheet. The feature can leave the product entirely and this
  // check keeps counting the prose. It is W1.8's mechanism turning a guard into a no-op.
  //
  // ⚠ AND ITS POSITIVE CONTROL COULD NOT HAVE SHOWN THAT: the control below mutates the SHEET
  // STRING, so it proves this function REACTS to an input the product is incapable of producing.
  // A control that edits the instrument's input is not a control on the product.
  //
  // What this check still legitimately asserts is that the sheet EMITS the rule at all. The real
  // vacuity guard is `pressSitesInCode` below, which reads comment-stripped SOURCE.
  const press = scale.filter((d) => !d.important && d.value === '0.98')
  if (press.length < 2) {
    problems.push(`no press scale in the sheet: expected --tw-scale-x and --tw-scale-y at 0.98, found ${press.length}`)
  }

  const overrides = scale.filter((d) => d.important)
  if (overrides.length === 0) {
    problems.push('nothing neutralises the press scale — reduced motion would get the shrink instantly')
  }
  for (const o of overrides) {
    if (!o.reducedMotion) {
      problems.push(`${o.prop} is forced to ${o.value} !important OUTSIDE reduced motion (${o.selector}) — that kills the press for everyone`)
    }
    if (o.value !== '1') {
      problems.push(`${o.prop} is forced to ${o.value} !important, not 1 — the identity scale is 1`)
    }
    if (!/(^|[\s,])\*/.test(o.selector)) {
      problems.push(`${o.prop} is neutralised on "${o.selector}", which is not the universal selector — a control that is not that selector still jumps`)
    }
  }
  const props = new Set(overrides.map((o) => o.prop))
  for (const p of ['--tw-scale-x', '--tw-scale-y']) {
    if (!props.has(p)) problems.push(`${p} is not neutralised under reduced motion — one axis still shrinks`)
  }
  return problems
}

/**
 * THE OTHER DIRECTION: what the reduced-motion block must NOT reach.
 *
 * `transform: none` or a neutralised `--tw-translate-*` would take the Switch's thumb with
 * it. Reduced motion means do not ANIMATE the change; it does not mean do not SHOW the state.
 */
function reducedMotionOverreachProblems(css: string): string[] {
  const problems: string[] = []
  for (const d of declarations(css).filter((x) => x.reducedMotion)) {
    if (d.prop === 'transform' || d.prop === 'translate') {
      problems.push(`reduced motion sets ${d.prop}: ${d.value} on "${d.selector}" — that also cancels the Switch's checked thumb, which is state, not motion`)
    }
    if (d.prop.startsWith('--tw-translate')) {
      problems.push(`reduced motion forces ${d.prop}: ${d.value} on "${d.selector}" — the Switch's checked thumb is a translate`)
    }
  }
  return problems
}

// ── the source scan: a transition must say how long it takes ────────────────────────────

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

/** Read a balanced `(`…`)` or `{`…`}` region starting AT the opening character. */
function balanced(text: string, start: number, open: string, close: string): string {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      depth--
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return text.slice(start + 1)
}

/**
 * Every CLASS LIST the file builds, as one string per list.
 *
 * ⚠ THE UNIT IS THE LIST, NOT THE LITERAL, and that is the whole correctness of this scan.
 * `cn('… transition-colors', 'duration-200')` is ONE class list arriving on ONE element in
 * two literals; scanning literal-by-literal would report it as a bare transition and the
 * guard would cry wolf on correct code. Balanced-paren reading rather than a lazy regex for
 * the same reason in reverse: a lazy `\(([\s\S]*?)\)` stops at the first inner `)` and
 * silently drops the rest of the list, which loses REAL findings.
 */
function classLists(text: string): string[] {
  const src = stripComments(text)
  const lists: string[] = []
  for (const m of src.matchAll(/\bclass(?:Name)?\s*=\s*/g)) {
    const i = m.index + m[0].length
    const c = src[i]
    if (c === '{') {
      const inner = balanced(src, i, '{', '}')
      // `className={cn(…)}` is ONE list, and the cn() sweep below already has it. Counting it
      // twice reported every component twice — sixteen lines for eight class lists, which is
      // the shape of a guard people stop reading.
      if (/^\s*(?:cn|clsx|classNames|twMerge|cva|ctl)\s*\(/.test(inner)) continue
      lists.push(inner)
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1)
      lists.push(src.slice(i + 1, end < 0 ? src.length : end))
    }
  }
  for (const m of src.matchAll(/\b(?:cn|clsx|classNames|twMerge|cva|ctl)\s*\(/g)) {
    lists.push(balanced(src, m.index + m[0].length - 1, '(', ')'))
  }
  return lists
}

/** Class tokens inside a class list: every string literal in it, `${…}` regions removed. */
function tokensOf(list: string): string[] {
  const tokens: string[] = []
  for (const m of list.matchAll(/(?:'([^'\n]*)'|"([^"\n]*)"|`([\s\S]*?)`)/g)) {
    const lit = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ')
    for (const t of lit.split(/\s+/)) if (t) tokens.push(t)
  }
  // A bare attribute value (className="a b c") is not quoted inside the captured region.
  if (!/['"`]/.test(list)) for (const t of list.split(/\s+/)) if (t) tokens.push(t)
  return tokens
}

/** `hover:transition-colors` → `transition-colors`. Variants do not change what the utility is. */
const base = (token: string) => token.split(':').pop() ?? token

const TRANSITION = /^transition(-(all|colors|opacity|shadow|transform))?$/
const DURATION = /^duration-\d+$/

/**
 * A `transition-*` with no `duration-*` beside it is not a neutral omission — it is a
 * silent vote for Tailwind's 150ms, cast by someone who was thinking about colour, not
 * timing. The site says 200. Say a number.
 */
function transitionsWithoutDuration(files: SourceFile[]): string[] {
  const problems = new Set<string>()
  for (const f of files) {
    for (const list of classLists(f.text)) {
      const tokens = tokensOf(list).map(base)
      const transitions = tokens.filter((t) => TRANSITION.test(t))
      if (transitions.length === 0) continue
      if (tokens.some((t) => DURATION.test(t))) continue
      problems.add(`${f.path}: "${transitions.join(' ')}" with no duration-* in the same class list`)
    }
  }
  return [...problems].sort()
}

// ── the press, asked of the CODE rather than of the sheet ───────────────────────────────

const PRESS = 'active:scale-98'

/**
 * EVERY FILE WHOSE CODE PUTS THE PRESS ON AN ELEMENT.
 *
 * ⚠ THE UNIT IS A CLASS LIST, WHICH IS WHY THIS CAN ANSWER WHAT THE SHEET CANNOT. `classLists`
 * runs `stripComments` first, so a sentence about the press contributes nothing here — the exact
 * property the stylesheet lacks. Deleting the class from the code moves this set; deleting it
 * from a comment does not.
 */
function pressSitesInCode(files: SourceFile[]): string[] {
  const out = new Set<string>()
  for (const f of files) {
    for (const list of classLists(f.text)) {
      if (tokensOf(list).includes(PRESS)) out.add(f.path)
    }
  }
  return [...out].sort()
}

/**
 * THE PRESS SITES, CLASSIFIED WITH THE REASON EACH ONE PRESSES.
 *
 * ⚠ CHECKED BOTH DIRECTIONS, because a derived sweep cannot see what is no longer there (#97).
 * A new press site fails until somebody classifies it; a classified one that stops pressing
 * fails as stale. That second direction is the one that was missing: `active:scale-98` is on
 * THREE elements and only two of them — Button and ThemeToggle — had a render assertion, so the
 * Landing stepper's press could be deleted with the whole suite green. MEASURED before this
 * table existed, at `a6e66ff`: apps/web's entire suite, 51 files / 591 tests, ALL GREEN with the
 * stepper's press removed. Nothing in packages/ui can cover it — Landing is an apps/web file.
 *
 * preset.ts §THE PRESS calls this "the one motion token in the system" and the site itself uses
 * it three times, so the restraint is the port. A fourth site is a design decision, not a typo,
 * and it should arrive with a sentence here saying why.
 */
const PRESS_SITES: Record<string, string> = {
  'packages/ui/src/components/Button.tsx':
    'the design-system button — every primary action in the product presses through this one class list',
  'packages/ui/src/components/ThemeToggle.tsx':
    'a hand-rolled <button>, not a Button, so it inherits nothing and must carry the press itself',
  'apps/web/src/areas/marketing/Landing.tsx':
    'the public stepper — the only press on a surface reached before signing in, and the one no render assertion covered',
}

// ════════════════════════════════════════════════════════════════════════════════════════

describe('the scanner can tell a real finding from a correct class list', () => {
  it('reports a bare transition', () => {
    const found = transitionsWithoutDuration([{ path: 'fixture.tsx', text: '<div className="transition-colors hover:text-ink" />' }])
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('transition-colors')
  })

  it('accepts one that names its duration', () => {
    expect(transitionsWithoutDuration([{ path: 'fixture.tsx', text: '<div className="transition-colors duration-200" />' }])).toEqual([])
  })

  it('accepts a duration contributed by a SIBLING argument of the same cn() call', () => {
    // The literal-by-literal version of this scan reported this line. It is correct code.
    expect(
      transitionsWithoutDuration([{ path: 'fixture.tsx', text: "cn('border transition-colors', 'duration-200 text-ink')" }]),
    ).toEqual([])
  })

  it('does not ask transition-none for a duration — there is no transition to time', () => {
    expect(transitionsWithoutDuration([{ path: 'fixture.tsx', text: '<div className="motion-reduce:transition-none" />' }])).toEqual([])
  })

  it('sees through a variant prefix', () => {
    expect(transitionsWithoutDuration([{ path: 'fixture.tsx', text: '<div className="hover:transition-transform" />' }])).toHaveLength(1)
  })

  it('does not read a comment as code', () => {
    expect(transitionsWithoutDuration([{ path: 'fixture.tsx', text: '// className="transition-colors"\nconst x = 1' }])).toEqual([])
  })

  it('reads past a nested call rather than stopping at its closing paren', () => {
    // The lazy-regex version returned '…transition-colors' and never saw the duration,
    // which is the failure mode that loses findings instead of inventing them.
    expect(
      transitionsWithoutDuration([{ path: 'fixture.tsx', text: "cn(base(variant), 'transition-colors', 'duration-200')" }]),
    ).toEqual([])
  })
})

describe('every transition in the product names its duration', () => {
  it('finds class lists to check — it must not pass by scanning nothing', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(40)
    const lists = files.flatMap((f) => classLists(f.text))
    expect(lists.length).toBeGreaterThan(150)
    // and it reaches BOTH packages, not just the app it lives in
    expect(files.some((f) => f.path.startsWith('apps/'))).toBe(true)
    expect(files.some((f) => f.path.startsWith('packages/'))).toBe(true)
    // and it sees the class lists held inside cn(), which is where the component layer keeps them
    expect(lists.some((l) => l.includes('rounded-control'))).toBe(true)
  })

  it('no class list carries a transition without one', () => {
    const found = transitionsWithoutDuration(sourceFiles())
    expect(found, `transition without a stated duration:\n  ${found.join('\n  ')}`).toEqual([])
  })
})

describe('the press affordance is a token, and it is on the things you press', () => {
  it('active:scale-98 is a class Tailwind emits, at 0.98 — an EXTENDED token, not an escaped one', async () => {
    // scale-[0.98] is what the site writes and what `local/no-arbitrary-value` refuses here.
    // The scale is extended in preset.ts instead, so asking the generator is the proof it took.
    const press = declarations(await shippedCss()).filter((d) => d.selector === '.active\\:scale-98:active')
    const vars = press.filter((d) => d.prop.startsWith('--tw-scale')).map((d) => `${d.prop}=${d.value}`).sort()
    expect(vars).toEqual(['--tw-scale-x=0.98', '--tw-scale-y=0.98'])
    expect(press.some((d) => d.prop === 'transform')).toBe(true)
  })

  it('Button presses', () => {
    render(<Button>Save</Button>)
    const cls = screen.getByRole('button', { name: 'Save' }).className
    expect(cls).toContain('active:scale-98')
    expect(cls).toContain('duration-200')
  })

  it('ThemeToggle presses — it is a hand-rolled button, not a Button', () => {
    render(<ThemeToggle />)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('active:scale-98')
  })

  // ── the vacuity guard that can actually fail ──────────────────────────────────────────

  it('the press is found in CODE, in both packages — it must not pass by scanning nothing', () => {
    const sites = pressSitesInCode(sourceFiles())
    expect(sites.length, 'no class list in either package carries the press').toBeGreaterThan(0)
    expect(sites.some((p) => p.startsWith('packages/')), 'the design-system half is unscanned').toBe(true)
    expect(sites.some((p) => p.startsWith('apps/')), 'the app half is unscanned').toBe(true)
  })

  it('the scanner reads code, not prose — the exact blindness the sheet check has', () => {
    // This is the whole difference between this guard and the one above it. Both fixtures
    // mention the press; only one puts it on an element.
    expect(pressSitesInCode([{ path: 'fixture.tsx', text: `// ${PRESS} is the press\nconst x = 1` }])).toEqual([])
    expect(pressSitesInCode([{ path: 'fixture.tsx', text: `<button className="${PRESS}" />` }])).toEqual(['fixture.tsx'])
  })

  it('every classified press site still presses — the direction nothing held', () => {
    const sites = pressSitesInCode(sourceFiles())
    const missing = Object.keys(PRESS_SITES).filter((p) => !sites.includes(p))
    expect(missing, `a classified press site no longer presses:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('every press site in the code is classified — a fourth one is a decision, not a typo', () => {
    const sites = pressSitesInCode(sourceFiles())
    const unclassified = sites.filter((p) => !(p in PRESS_SITES))
    expect(unclassified, `an unclassified press site:\n  ${unclassified.join('\n  ')}`).toEqual([])
    for (const [, why] of Object.entries(PRESS_SITES)) expect(why.length).toBeGreaterThan(20)
  })

  /**
   * ⚠ THE INSTRUMENT MUST ASK THE BUILD'S QUESTION — tokenDoor.test.ts's pin, which this file
   * needed and did not have. Pinned structurally rather than by a byte count, because a count
   * moves whenever anybody writes a class and gets re-baselined rather than read.
   */
  it('the sheet this file reasons over is generated from the BUILD\'s content set', async () => {
    await shippedCss()
    expect(shippedContent, 'shippedCss did not record the globs it used').toBeDefined()
    const globs = shippedContent as string[]
    // the substantive property first, so a revert reds with a sentence rather than a glob diff
    const negated = globs.filter((g) => g.startsWith('!'))
    expect(negated.length, 'the test-file exclusions are gone — this file is reading itself').toBe(2)
    expect(globs.filter((g) => g.includes('/!')), 'a `!` was smuggled into a path segment').toEqual([])
    expect(globs, 'the globs are not the build\'s').toEqual(absoluteContent(appRoot))
  })
})

describe('reduced motion', () => {
  it('neutralises the press scale', async () => {
    expect(pressScaleProblems(await shippedCss())).toEqual([])
  })

  it('positive control: delete the neutraliser and the check goes red', async () => {
    const broken = (await shippedCss()).replace(/--tw-scale-[xy]:\s*1\s*!important;?/g, '')
    expect(pressScaleProblems(broken).join(' ')).toContain('nothing neutralises the press scale')
  })

  it('positive control: move the neutraliser out of the media query and the check goes red', async () => {
    const broken = (await shippedCss()).replace(
      /@media \(prefers-reduced-motion: reduce\)/,
      '@media (min-width: 1px)',
    )
    expect(pressScaleProblems(broken).join(' ')).toContain('OUTSIDE reduced motion')
  })

  it('positive control: remove the press scale and the check goes red rather than passing by absence', async () => {
    const broken = (await shippedCss()).replace(/--tw-scale-([xy]):\s*0\.98/g, '--tw-scale-$1: 1')
    expect(pressScaleProblems(broken).join(' ')).toContain('no press scale in the sheet')
  })

  it('does not reach the Switch — a checked thumb is state, not motion', async () => {
    expect(reducedMotionOverreachProblems(await shippedCss())).toEqual([])
  })

  it('positive control: transform:none in the block is caught', async () => {
    const broken = (await shippedCss()).replace(
      /(@media \(prefers-reduced-motion: reduce\)\s*\{\s*[^{]*\{)/,
      '$1 transform: none !important;',
    )
    expect(reducedMotionOverreachProblems(broken).join(' ')).toContain("cancels the Switch's checked thumb")
  })

  it('the thing being protected is real: the Switch shows ON with a translate', () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="Pooling" />)
    const thumb = screen.getByRole('switch').firstElementChild
    expect(thumb?.className).toContain('data-[state=checked]:translate-x-3.5')
  })
})
