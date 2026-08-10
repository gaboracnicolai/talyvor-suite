import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import preset from '../../../packages/ui/src/preset'

/**
 * THE READER'S FONT SIZE IS A SETTING THIS PRODUCT DOES NOT READ.
 *
 * Every browser has a default-font-size preference — Chrome's Appearance ▸ Font size, Firefox's
 * Fonts ▸ Size, Safari's, Edge's. It is the setting a person who cannot read 14px type changes
 * FIRST, before they reach for zoom, because it is the one that follows them across every site.
 * With no author rule on the root element, that preference IS `font-size` on `<html>`, which is
 * what `rem` resolves against. Declare a type scale in `px` and the preference reaches nothing.
 *
 * MEASURED IN REAL CHROME on the built artifact at `c4a7aa4`, served over HTTP with a BFF stub,
 * by moving the root font-size from 16px (the default) to 24px (Chrome's "Very Large") and
 * recomputing `font-size` on every element carrying a text node:
 *
 *     /            48 text elements     0 changed        /docs        20    0 changed
 *     /ledger      26                   0 changed        /privacy     68    0 changed
 *     /billing     26                   0 changed        /terms       57    0 changed
 *     /setup       88                   0 changed        /marketing  106    0 changed
 *     /keys        28   /spend  34   /members  20   /settings  44   /track  29   — 0 changed
 *
 * 488 elements behind the gate and on the public pages, and NOT ONE of them moved.
 *
 * ⚠ THE POSITIVE CONTROL IS IN THE SAME SAMPLE. A `<div style="font-size:1rem">` appended to
 * each page read 16px before and 24px after, on every address — so the instrument reads a
 * response when there is one to read, and the zero above is the product's answer, not the
 * probe's.
 *
 * ⚠ AND THE LAYOUT DID RESPOND, WHICH IS WHY THIS IS AN OVERSIGHT RATHER THAN A DECISION.
 * Tailwind's spacing scale is in `rem` and this product uses it everywhere, so on /marketing the
 * same root change moved 27 boxes and grew the document from 5392px to 6301px (+17%) — the gaps
 * inflate, the type does not. A console that had deliberately pinned its density would have
 * pinned its spacing too.
 *
 * ── WHAT THIS FILE ASSERTS ───────────────────────────────────────────────────────────────────
 *
 * Two declarations decide the answer for the whole product:
 *
 *   · `preset.ts` §fontSize — the six CONSOLE steps, which every screen behind the gate, both
 *     front doors and both legal pages are written in.
 *   · `theme.css` `body { font-size }` — the base every element WITHOUT a `text-*` class
 *     inherits. Five of /setup's 88 text elements were exactly that case: converting the six
 *     steps alone left them at 14px.
 *
 * Both must be ROOT-RELATIVE, and each must still resolve to the px it resolved to before at a
 * 16px root — the point is that the design is unchanged for a reader who changed nothing.
 *
 * ⚠ `em` IS NOT ROOT-RELATIVE AND IS REFUSED HERE. It resolves against the PARENT, so a token
 * used inside another token's element compounds; `rem` is the only unit that means "the reader's
 * size" wherever it is written.
 *
 * ── THE MARKETING STEPS STAY IN px, AND THAT IS MEASURED, NOT ASSUMED ────────────────────────
 *
 * The other six steps are the public page's display scale (preset.ts §DISPLAY, "⚠ NOT FOR THE
 * APP"). Converting them TOO was measured in the same session, at 320px CSS width with a 24px
 * root: /marketing's document scrollWidth went to 346 against a 320 client width, from a
 * `flex-1 whitespace-nowrap` section tab 388px wide. So they are classified here as px-anchored
 * with the measurement attached rather than converted on the way past. Every step in the scale
 * must appear in exactly one of the two tables below — a new step fails until someone places it,
 * a deleted one fails as stale, and a step that changes side fails with the number to re-measure.
 *
 * ⚠ WHAT NO TEST IN THIS REPO CAN SEE, MEASURED RATHER THAN ASSUMED: jsdom does not resolve
 * lengths. `getComputedStyle(el).fontSize` returns the SPECIFIED string — `'0.875rem'` stays
 * `'0.875rem'` and `'14px'` stays `'14px'`, at any root size. A rendered-size assertion in this
 * project would therefore pass identically before and after this fix. The last case below
 * measures that and pins it, so nobody writes one believing it guards this. The Chrome rows
 * above are the proof; this file guards the two declarations they trace back to.
 */

const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const THEME_CSS = resolve(UI_SRC, 'theme.css')

/** The browser default this product's scale was drawn against. `rem` × this = the old px. */
const DEFAULT_ROOT_PX = 16

/**
 * The six console steps and the px each one rendered at BEFORE this fix, at a 16px root.
 * Hardcoded literals, not read back out of the preset: a table that derived its expectation
 * from the value under test would pass for every value.
 */
const CONSOLE_STEPS_PX: Record<string, number> = {
  title: 24,
  head: 17,
  body: 14,
  caption: 12,
  micro: 12.5,
  eyebrow: 11,
}

/**
 * The public page's display scale. Still px-anchored, each with the reason it was not converted
 * with the rest. `figure` and `lede` are sizes, not the `font-figure` FAMILY every money surface
 * wears — see displayScale.test.ts on why the `text-` prefix is load-bearing.
 */
const MARKETING_STEPS_PX: Record<string, string> = {
  'display-1': 'the hero — a clamp whose floor would scale with the root while the viewport does not',
  'display-2': 'the closing line, same clamp shape',
  'display-3': 'a section heading on the public page, same clamp shape',
  'display-4': 'a sub-section heading on the public page, same clamp shape',
  lede: 'the paragraph directly under a display heading, same clamp shape',
  figure: 'a measured figure quoted at reading size — the ledger numbers on the public page',
}

/** The scale as the BUILD reads it: the preset object Tailwind is handed, not a regex over it. */
const fontSize = preset.theme.extend.fontSize as Record<string, [string, Record<string, string>]>

/** `12.5px` → 0.78125rem, printed the way a stylesheet would carry it. */
const remFor = (px: number): string => `${px / DEFAULT_ROOT_PX}rem`

/** The rem multiple a declaration states, or null if it does not state one. */
function remValue(decl: string): number | null {
  const m = /^([0-9]*\.?[0-9]+)rem$/.exec(decl.trim())
  return m ? Number(m[1]) : null
}

describe('the console type scale is root-relative, so the reader s font size reaches it', () => {
  it.each(Object.entries(CONSOLE_STEPS_PX))(
    '`%s` is declared in rem and still resolves to its old px at a 16px root',
    (step, px) => {
      const declared = fontSize[step]?.[0]
      expect(declared, `preset.ts no longer declares a \`${step}\` step`).toBeTypeOf('string')
      const rem = remValue(declared)
      expect(
        rem,
        `\`${step}\` is declared \`${declared}\` — a console step must be in rem, the only unit ` +
          `that resolves against the reader's browser font size. em resolves against the PARENT ` +
          `and compounds; px resolves against nothing.`,
      ).not.toBeNull()
      expect(
        rem! * DEFAULT_ROOT_PX,
        `\`${step}\` is ${declared} = ${rem! * DEFAULT_ROOT_PX}px at a 16px root, and it rendered ` +
          `at ${px}px before. Changing the UNIT must not change the SIZE — a reader who has not ` +
          `touched the setting must see the same product. ${remFor(px)} is the equivalent.`,
      ).toBe(px)
    },
  )

  it('the base every unclassed element inherits is root-relative too', () => {
    // theme.css, not the preset: `body { font-size }` is what an element with no `text-*` class
    // gets, and five of /setup's 88 text elements are exactly that.
    const css = readFileSync(THEME_CSS, 'utf8')
    const body = /(^|\n)body\s*\{([\s\S]*?)\}/.exec(css)
    expect(body, 'theme.css no longer declares a `body` rule').not.toBeNull()
    const decl = /font-size:\s*([^;]+);/.exec(body![2])
    expect(decl, 'theme.css `body` no longer declares a font-size — the base is unpinned').not.toBeNull()
    const rem = remValue(decl![1])
    expect(
      rem,
      `theme.css declares \`body { font-size: ${decl![1].trim()} }\`. Every element without a ` +
        `\`text-*\` class inherits it, so a px here pins the product's floor whatever the six ` +
        `steps say. ${remFor(CONSOLE_STEPS_PX.body)} is the equivalent of ${CONSOLE_STEPS_PX.body}px.`,
    ).not.toBeNull()
    expect(rem! * DEFAULT_ROOT_PX, 'the base must still be the `body` step at a 16px root').toBe(
      CONSOLE_STEPS_PX.body,
    )
  })

  it('the marketing steps are still px-anchored, and this is the measurement to redo', () => {
    for (const [step, why] of Object.entries(MARKETING_STEPS_PX)) {
      const declared = fontSize[step]?.[0]
      expect(declared, `preset.ts no longer declares a \`${step}\` step`).toBeTypeOf('string')
      expect(
        /\dpx/.test(declared),
        `\`${step}\` (${why}) is declared \`${declared}\`, which is no longer px-anchored. That may ` +
          `well be right — but it was MEASURED at 320px CSS width with a 24px root and /marketing ` +
          `overflowed, scrollWidth 346 against a 320 client width, from a 388px-wide ` +
          `\`flex-1 whitespace-nowrap\` section tab. Re-measure /marketing at 320×24 before moving ` +
          `this table, and put the new number here.`,
      ).toBe(true)
    }
  })

  it('every step in the scale is on exactly one of the two tables', () => {
    // The floor. A source-derived expectation cannot see a step that was deleted, and a curated
    // list cannot see one that was added — comparing the two SETS sees both.
    const declared = Object.keys(fontSize).sort()
    const classified = [...Object.keys(CONSOLE_STEPS_PX), ...Object.keys(MARKETING_STEPS_PX)].sort()
    expect(
      declared,
      'a type step was added or removed in preset.ts without being classified here — every step ' +
        'is either root-relative (the console) or px-anchored with a measurement (the public page)',
    ).toEqual(classified)
  })

  it('jsdom cannot tell these apart, which is why this file reads declarations', () => {
    // NOT a guard on the product — a measurement of the instrument, kept so that nobody replaces
    // this file with a rendered-size assertion that could never fail.
    const style = document.createElement('style')
    style.textContent = '.rem-probe{font-size:0.875rem}.px-probe{font-size:14px}'
    document.head.appendChild(style)
    const rem = document.createElement('div')
    rem.className = 'rem-probe'
    const px = document.createElement('div')
    px.className = 'px-probe'
    document.body.append(rem, px)
    try {
      document.documentElement.style.fontSize = '24px'
      expect(getComputedStyle(rem).fontSize, 'jsdom now resolves rem — a rendered-size assertion has become possible, and this file could be stronger than it is').toBe('0.875rem')
      expect(getComputedStyle(px).fontSize).toBe('14px')
    } finally {
      document.documentElement.style.fontSize = ''
      rem.remove()
      px.remove()
      style.remove()
    }
  })
})
