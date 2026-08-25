import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { describe, expect, it } from 'vitest'

import tailwindConfig, { buildContent } from '../tailwind.config'
// Deep relative import on purpose, the same one deadClasses/tokenDoor/motion take: ONE comment
// stripper with ONE set of positive controls.
import { stripComments } from '../../../packages/ui/src/lib/sourceText'
import { Region } from './components/Region'

/**
 * THE CONSOLE'S ONE DISPLAY STEP — `text-page`, and the three ways a type token lies.
 *
 * ⚠ WHAT THIS ITEM (W1.1.0) CLAIMED, AND WHAT WAS ACTUALLY TRUE. The item says a `page` step
 * "was written and then DELETED because nothing used it, and nothing has added it since", and
 * gives clamp(24px, 3vw, 38px) as "the site's SMALLEST display step, MEASURED from its served
 * stylesheet". BOTH halves were checked before building against them:
 *
 *   · `git log -S'text-page' --all` and `-S'page: ['` over packages/ui/src/preset.ts return
 *     ZERO commits on a 272-commit, NON-shallow history reaching the initial commit — and the
 *     instrument is positive-controlled: the same `-S` on the same file finds `display-1` at
 *     `7644d30`. The complete set of fontSize keys this file has EVER held is
 *     body/caption/display-1..4/eyebrow/figure/head/lede/micro/title. `page` is not among them.
 *     ⚠ IT WAS NEVER THERE. Nothing is being added BACK.
 *   · clamp(24px, 3vw, 38px) appears nowhere in this repo, in any captured stylesheet on the
 *     box, or in the queue's own log — only in the item's sentence. Its stated provenance is
 *     not reproducible here, so it is NOT the justification recorded below.
 *
 * ⚠ THE VALUE IS KEPT AND THE REASONING IS REPLACED WITH ONE THAT CAN BE RE-DERIVED, which is
 * the only kind that survives. The step is bounded by two numbers already in the preset:
 *   · its FLOOR is 24px = `title`, the top of the console ramp. At a narrow viewport `page`
 *     therefore renders at exactly the size the heading renders at today, so promoting the
 *     shared heading regresses NOTHING on a phone. That floor is asserted below.
 *   · its CEILING is 38px = `display-2`'s ceiling, the site's own second display step, so the
 *     console's largest type never exceeds the public page's.
 *
 * ── THE THREE WAYS THIS COULD BE GREEN AND WRONG ────────────────────────────────────────────
 *
 * (1) DECLARED BUT DEAD. A step in preset.ts that Tailwind never emits is a token that does
 *     nothing; the class would be absent from the sheet the browser downloads and every
 *     source-reading assertion would still pass. This file therefore runs the REAL generator
 *     over the build's OWN content set (`buildContent` — files AND transformers, the thing that
 *     made a neighbouring instrument answer for a sheet 20 classes larger than the shipped one)
 *     and asserts `.text-page` is in the output with a font-size declaration.
 * (2) EMITTED BUT IDENTICAL. A `page` whose computed size equals `title` is a rename, not a
 *     step. The floor/ceiling assertions below pin it as fluid and pin the ceiling ABOVE the
 *     console ramp, so a value that collapses to 24px everywhere reds.
 * (3) IN THE SCALE AND ON NOTHING. The token can be perfect and the heading still render
 *     `text-title`. That is asserted against the RENDERED DOM rather than Region.tsx's source,
 *     because the source is what a reader checks and the DOM is what a user gets.
 *
 * ⚠ EVERY ASSERTION HERE IS PAIRED WITH A FLOOR OR A CONTROL. A guard that reaches no files, or
 * whose regex matches nothing, reports "no violations" over an empty set — the failure this
 * repo has now paid for four times (displayScale §THE GATED CLOSURE is the written-up case).
 */

const appRoot = resolve(import.meta.dirname, '..')
const PRESET = resolve(import.meta.dirname, '../../../packages/ui/src/preset.ts')

/** The emitted stylesheet, keyed by class name, from the build's own content set. */
async function emitted(): Promise<Map<string, string>> {
  const css = await postcss([tailwind({ ...tailwindConfig, content: buildContent(appRoot) } as never)])
    .process('@tailwind utilities;', { from: undefined })
  const byClass = new Map<string, string>()
  postcss.parse(css.css).walkRules((rule) => {
    const decls: string[] = []
    // Block body, not a concise one: `walkDecls`'s callback is typed `false | void`, and
    // `decls.push(...)` returns a number — postcss reads a returned `false` as "stop walking".
    rule.walkDecls((d) => {
      decls.push(`${d.prop}:${d.value}`)
    })
    if (decls.length === 0) return
    // Same unescaping as deadClasses/tokenDoor: the escape alternative MUST come first, or the
    // lone backslash in `.w-1\.5` matches the character class and the class reads as `w-1`.
    for (const m of rule.selector.matchAll(/\.((?:\\.|[^\s{,:.>+~()])+)/g)) {
      const name = m[1].replace(/\\(.)/g, '$1')
      if (!byClass.has(name)) byClass.set(name, decls.sort().join(';'))
    }
  })
  return byClass
}

/**
 * The bounds of a `clamp(floor, preferred, ceiling)` font-size, keeping each one's UNIT.
 *
 * ⚠ THE UNIT IS THE POINT, not a formatting detail, and reading both as px is how the first
 * version of this file passed over an accessibility regression. See §THE FLOOR MUST TRACK THE
 * READER below.
 */
function clampBounds(decl: string): { floor: string; ceiling: string } | null {
  const m = /font-size:\s*clamp\(\s*([\d.]+(?:px|rem))\s*,[^,]+,\s*([\d.]+(?:px|rem))\s*\)/.exec(decl)
  return m === null ? null : { floor: m[1], ceiling: m[2] }
}

/** A css length in px at a given root. The only two units this scale uses. */
function px(len: string, rootPx = 16): number {
  const n = Number.parseFloat(len)
  return len.endsWith('rem') ? n * rootPx : n
}

describe('the console has one display step, and the screen heading wears it', () => {
  it('the generator ran and produced a real stylesheet — this file must not pass by finding nothing', async () => {
    const sheet = await emitted()
    // ⚠ THE FLOOR THAT MAKES THE REST MEAN ANYTHING. If `emitted()` returned an empty map —
    // a moved glob, a changed transformer, a generator error swallowed upstream — then
    // `sheet.get('text-page')` is undefined and a test written the obvious way would report
    // "the token is missing" for a reason that has nothing to do with the token.
    expect(sheet.size, 'the generator emitted no classes at all').toBeGreaterThan(200)
    // and it really is THIS product's sheet, not some default: console steps the app is written in
    for (const cls of ['text-title', 'text-body', 'text-eyebrow']) {
      expect(sheet.has(cls), `${cls} is a console step in daily use and the sheet does not have it`).toBe(true)
    }
  })

  it('`page` is declared in preset.ts as a real fontSize step', () => {
    const src = stripComments(readFileSync(PRESET, 'utf8'))
    // Anchored inside the fontSize block, so a `page:` written under any other key cannot satisfy
    // this. Same bracket walk displayScale.test.ts uses on the same file.
    const at = src.indexOf('fontSize:')
    expect(at, 'preset.ts no longer declares a fontSize scale').toBeGreaterThan(-1)
    const open = src.indexOf('{', at)
    let depth = 0
    let close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) {
        close = i
        break
      }
    }
    expect(close, 'unbalanced braces in preset.ts fontSize').toBeGreaterThan(open)
    const block = src.slice(open + 1, close)
    const declared = [...block.matchAll(/(?:^|\n)\s*'?([a-zA-Z][a-zA-Z0-9-]*)'?:\s*\[/g)].map((m) => m[1])
    // The reader itself must not be vacuous: it finds the steps that were already there.
    expect(declared, 'the fontSize reader found no known steps — it is reading the wrong block').toEqual(
      expect.arrayContaining(['title', 'body', 'display-1']),
    )
    expect(declared, 'preset.ts declares no `page` step').toContain('page')
  })

  /**
   * ⚠ WHAT THIS ACTUALLY ASSERTS IS "DECLARED **AND WORN**", and the control harness found that out
   * rather than the docstring claiming it. C5 takes `text-page` off the heading and expects only
   * the DOM assertion to red; the emitted check red too, because Tailwind's JIT emits only classes
   * its content set MENTIONS and Region.tsx is the one place this class is written. So an absent
   * `.text-page` rule has two possible causes — never declared, or declared and used nowhere — and
   * this assertion cannot tell them apart.
   *
   * That is a STRONGER guarantee than "the preset declares it", which is why the pairing is kept:
   * the preceding test reads preset.ts and answers "declared", and this one answers "and something
   * wears it". Together they separate the two. Alone, this one's name would oversell it.
   */
  it('⚠ `text-page` REACHES THE STYLESHEET — declared is not emitted (and unworn is not emitted either)', async () => {
    const sheet = await emitted()
    const decl = sheet.get('text-page')
    expect(decl, 'preset.ts declares `page` but Tailwind emits no `.text-page` rule — either the step is gone or nothing in the content set wears it').toBeDefined()
    expect(decl).toMatch(/font-size:/)
  })

  it('⚠ it is a STEP, not a rename of `title` — fluid, floored on the console ramp, ceilinged above it', async () => {
    const sheet = await emitted()
    const page = clampBounds(sheet.get('text-page') ?? '')
    expect(page, '`text-page` is not a clamp() — a console page title that cannot grow is the 24px ceiling this item exists to lift').not.toBeNull()
    if (page === null) return
    const title = sheet.get('text-title') ?? ''
    expect(title, 'text-title is not in the sheet — the comparison below would be against nothing').toMatch(/font-size:/)
    expect(title).toMatch(/font-size:\s*1\.5rem/)

    /**
     * ⚠ THE FLOOR MUST TRACK THE READER — and it did not, which was found in real Chrome and not
     * by any assertion in this file's first version.
     *
     * W1.1.0 specifies `clamp(24px, 3vw, 38px)`. At the DEFAULT 16px root that floor is exactly
     * `title`, so every check here passed. MEASURED at 320px CSS width across three roots:
     *
     *     root    title    clamp(24px,…)    clamp(1.5rem,…)
     *     16px    24px     24px  ✓          24px  ✓
     *     20px    30px     24px  ✗          30px  ✓
     *     24px    36px     24px  ✗          36px  ✓
     *
     * A reader on Chrome's "Very Large" saw the page heading SHRINK from 36px to 24px when it was
     * promoted from `title` — the opposite of what promoting it is for, and invisible at the
     * default root. So the floor is asserted as a UNIT-BEARING STRING equal to `title`'s own
     * declaration, not as a number that happens to match at one root.
     */
    expect(
      page.floor,
      "`text-page`'s clamp floor must be `title`'s OWN declaration — 1.5rem, not the 24px it " +
        'happens to equal at a 16px root. With a px floor a reader who enlarged their browser ' +
        'font sees this heading SHRINK when it is promoted from `title` (36px → 24px at a 24px ' +
        'root, measured in Chrome at 320px).',
    ).toBe('1.5rem')

    // AND IT MUST ACTUALLY GROW — a value collapsing onto its floor is a rename, not a step.
    expect(px(page.ceiling), '`page` ceilings at or below `title` — it is a rename, not a step').toBeGreaterThan(px(page.floor))
    // never past the public page's own second display step, 38px.
    expect(px(page.ceiling), '`page` exceeds display-2 (38px) — the console would out-shout the site').toBeLessThanOrEqual(38)
    // ⚠ THE CEILING STAYS px ON PURPOSE: in rem a large-root reader would push the console's
    // biggest type past the site's hard cap, which is the one thing the ceiling exists to prevent.
    expect(page.ceiling, 'the ceiling must be a hard px cap, not one that grows with the root').toMatch(/px$/)
  })

  it('⚠ THE HEADING RENDERS IT — measured on the DOM, not read off Region.tsx', () => {
    render(
      <Region index="00" label="Workspace" heading="Everything this workspace has, spends and earns.">
        <p>body</p>
      </Region>,
    )
    const h = screen.getByRole('heading', { name: 'Everything this workspace has, spends and earns.' })
    // The floor: the element exists at all. `getByRole` throws if not, so reaching here is the floor.
    expect(h.className, 'the screen heading still wears `text-title` — the token landed and nothing wears it').toContain('text-page')
    expect(h.className, '`text-title` is still on the heading beside `text-page` — two type steps on one element').not.toMatch(/\btext-title\b/)
  })
})
