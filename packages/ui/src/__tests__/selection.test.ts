import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { contrastRatio } from '../lib/contrast'
import { tokens } from '../tokens'

/**
 * THE SELECTION PLANE — the background this palette never declared, and the one every
 * reader paints for themselves the moment they drag across a figure to copy it.
 *
 * `contrast.test.ts` scores every TEXT token against every BACKGROUND token and exists
 * because `faint` "had been shipping" at 2.98:1. Its classification is total over the
 * tokens. It cannot ask what happens when the plane under the text is NOT a token — and
 * `::selection` is exactly that: a background supplied by the user agent, applied to
 * arbitrary text, invisible to `getComputedStyle` and invisible to `textContent`.
 * `fe36452` made the same argument one property over for `::placeholder`; there the TEXT
 * wore no token, here the BACKGROUND does.
 *
 * ⚠ MEASURED IN A REAL ENGINE, not reasoned about, and not read off a system colour
 * either (Chrome 151, real selected text, painted pixels sampled from a screenshot with
 * `color-scheme` and the token planes exactly as theme.css sets them):
 *
 *     theme  plane      canvas/surface below  →  PAINTED SELECTION BACKGROUND
 *     light  --canvas   #F3F6FA                  rgb(174,211,252)
 *     light  --surface  #FFFFFF                  rgb(179,215,254)
 *     dark   --canvas   #060A12                  rgb(52,81,115)
 *     dark   --surface  #0B1220                  rgb(53,83,118)
 *
 * and the text keeps its own token colour — Chrome does NOT repaint it to `HighlightText`.
 *
 * ⚠ THE SYSTEM COLOUR IS NOT A SUBSTITUTE FOR THE PIXEL, and that is worth writing down
 * because resolving `Highlight` in JS is the cheap way to "measure" this. In the LIGHT
 * theme the keyword resolves to rgba(128,188,254,.6) and composites to exactly the painted
 * value (.6×128 + .4×243 = 174.0 ✓). In the DARK theme it resolves to rgba(179,215,255,.8),
 * which over #060A12 would be rgb(144,174,207) — and the pixel is rgb(52,81,115). The
 * keyword and the paint disagree by 92 in the red channel. Only one of them is what a
 * reader sees.
 *
 * ── THE DEFECT, SCORED WITH THIS REPO'S OWN INSTRUMENT AND ITS OWN FLOOR ─────────────
 *
 * TEN of the sixteen text-token/plane pairs fall below the 4.5:1 AA body floor
 * `contrast.test.ts` holds every text token to. Every one of them PASSES on the token
 * plane and FAILS the instant the text is selected:
 *
 *     dark   faint   #6B7F96  on rgb(52,81,115)   = 1.98:1   (on --canvas  = 4.81:1)
 *     dark   faint            on rgb(53,83,118)   = 1.92:1   (on --surface = 4.55:1)
 *     dark   muted   #7E93AB  on rgb(52,81,115)   = 2.59:1   (on --canvas  = 6.27:1)
 *     dark   muted            on rgb(53,83,118)   = 2.51:1   (on --surface = 5.93:1)
 *     dark   accent  #3AD6C0  on rgb(52,81,115)   = 4.50:1 / rgb(53,83,118) = 4.36:1
 *     light  faint   #5A6E85  on rgb(174,211,252) = 3.38:1 / rgb(179,215,254) = 3.51:1
 *     light  accent  #0F7A6C  on rgb(174,211,252) = 3.36:1 / rgb(179,215,254) = 3.50:1
 *
 * ⚠ AND THE HIGHLIGHT ITSELF FAILS THE OTHER FLOOR. The selection plane is the SOLE
 * indicator of what is selected, which is the exact trigger `contrast.test.ts` writes into
 * its own DECORATIVE exemption ("if a rule ever becomes the ONLY indicator of a state … it
 * stops being decorative"). Scored against the canvas it covers, the browser's plane is
 * 1.43:1 in light and 2.43:1 in dark — below the 3:1 non-text floor this repo already
 * applies to a 2px tick.
 *
 * No threshold was set or moved here. 4.5:1 and 3:1 are both `contrast.test.ts`'s.
 *
 * ── WHY THE PLANE IS `--accent` AND NOT `--accent-tint` ──────────────────────────────
 *
 * The tint is the obvious answer — it is already documented as "a hover/selected
 * BACKGROUND for ink text" and `ink on accent-tint` is already asserted at AA. MEASURED,
 * it fails the OTHER floor and is therefore wrong: `accent-tint` against the canvas it
 * would cover is 1.22:1 light and 1.32:1 dark, so the selection would be harder to SEE
 * than the browser's. `--accent` + `--accent-ink` clears both floors in both themes, and
 * it is the pair `contrast.test.ts` already scores as the primary button's fill and label.
 * No new token, no value invented.
 *
 * ── WHY ONE RULE AND NOT ONE PER THEME ───────────────────────────────────────────────
 *
 * ⚠ VERIFIED IN THE ENGINE rather than assumed, because a highlight pseudo-element is
 * exactly where custom-property resolution is worth doubting: a single
 * `::selection { background-color: var(--accent); color: var(--accent-ink) }` resolves
 * against the ORIGINATING element, so the painted pixels are rgb(15,122,108) under
 * `[data-theme='light']` and rgb(58,214,192) under `[data-theme='dark']` — the two
 * `--accent` values byte for byte, from one declaration. A per-theme copy would be a
 * second statement of a measurement with nothing between them (`c71ca9c`'s finding).
 *
 * ── WHY BOTH HALVES ARE REQUIRED ─────────────────────────────────────────────────────
 *
 * Declaring only `background-color` is the tempting half-fix and it does not close this:
 * the foreground stays whatever token the text already wears, so the pair set stays at
 * four text roles × two themes and `faint` keeps failing. Requiring `color` collapses
 * sixteen pairs to ONE, and that one is already guarded. Control C4 makes exactly that
 * edit and is red.
 */

const themeCss = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')

/**
 * THE THEMES THAT MUST BE SCORED — pinned, not derived from `tokens`.
 *
 * ⚠ A guard that derives its own subject cannot see a deletion. If this list were
 * `Object.keys(tokens)` then dropping the dark theme would drop the dark assertions with
 * it and the file would stay green while the product lost half its palette. Pinned here
 * and checked against `tokens` in BOTH directions below, so a new theme fails until
 * somebody scores it and a deleted one fails as stale.
 */
const THEMES = ['light', 'dark'] as const

/** The planes text lands on. Same list `contrast.test.ts` scores against. */
const BACKGROUNDS = ['canvas', 'surface', 'sidebar'] as const

/** AA body, for text. `contrast.test.ts`'s floor, not a new one. */
const AA_BODY = 4.5
/** The non-text floor, for the highlight itself. `contrast.test.ts`'s floor, not a new one. */
const NON_TEXT = 3

/**
 * WHAT THE BROWSER PAINTS TODAY, so the fix can be compared to something rather than
 * merely asserted. Sampled pixels, Chrome 151 — see the header.
 *
 * ⚠ These are RECORDED, never the subject of the pass/fail. A test that scored the
 * measurement against itself would pass for every value (`a guard that references its own
 * constant`). They are used only to assert the chosen plane BEATS them, which is a claim
 * about the fix.
 */
const BROWSER_PLANE: Record<(typeof THEMES)[number], string> = {
  light: 'rgb(174,211,252)',
  dark: 'rgb(52,81,115)',
}

interface SelectionRule {
  /** the token named by `background-color: var(--x)` */
  plane: string
  /** the token named by `color: var(--x)` */
  ink: string
}

/**
 * Read the `::selection` rule out of theme.css.
 *
 * ⚠ It reads the FILE rather than a constant this test also defines. A rule stated twice
 * — once where it ships and once where it is checked — is two copies of one measurement
 * with nothing between them, and the check keeps passing after the shipped half changes.
 */
export function selectionRuleIn(css: string): SelectionRule | null {
  const rule = /(^|\})\s*::selection\s*\{([^}]*)\}/m.exec(css)
  if (!rule) return null
  const body = rule[2]
  const bg = /background-color:\s*var\(--([a-z-]+)\)/.exec(body)
  const fg = /(^|[;{\s])color:\s*var\(--([a-z-]+)\)/.exec(body)
  if (!bg || !fg) return null
  return { plane: bg[1], ink: fg[2] }
}

/**
 * The rule, or a failure that SAYS WHY.
 *
 * ⚠ The first draft of this file let the scoring tests dereference a null and they reddened
 * with `TypeError: Cannot read properties of null`. That is a red for the right reason by
 * accident: a parser broken in some unrelated way produces the identical crash, so the
 * message could not tell "the product declares nothing" from "this test stopped working".
 * `78822bb`'s harness lesson, inside the guard rather than around it.
 */
function requireRule(): SelectionRule {
  const rule = selectionRuleIn(themeCss)
  if (rule) return rule
  throw new Error(
    'theme.css declares no `::selection { background-color: var(--…); color: var(--…) }`. ' +
      'Every selection in the product is therefore painted by the user agent — measured in ' +
      'Chrome 151 as rgb(174,211,252) on the light canvas and rgb(52,81,115) on the dark one, ' +
      'against which `faint` scores 3.38:1 and 1.98:1. See the header of this file.',
  )
}

describe('the palette declares the plane under selected text', () => {
  it('theme.css declares a ::selection rule at all', () => {
    expect(
      /::selection/.test(themeCss),
      'theme.css declares no ::selection, so every selection in the product is painted by ' +
        'the user agent — measured in Chrome 151 as rgb(174,211,252) light / rgb(52,81,115) dark',
    ).toBe(true)
  })

  it('it names BOTH halves, and names them as tokens rather than as values', () => {
    const rule = selectionRuleIn(themeCss)
    expect(
      rule,
      'the ::selection rule must set background-color AND color, each as var(--token). ' +
        'Setting only the background leaves the foreground as whatever token the text wears, ' +
        'which is the sixteen-pair problem this rule exists to collapse to one.',
    ).not.toBeNull()
    expect(Object.keys(tokens.light)).toContain(rule!.plane)
    expect(Object.keys(tokens.light)).toContain(rule!.ink)
  })

  // ⚠ BOTH DIRECTIONS. Derived-from-`tokens` would go quiet if a theme were deleted.
  it('every theme in tokens.ts is scored here, and every theme scored here exists', () => {
    expect([...THEMES].sort()).toEqual(Object.keys(tokens).sort())
  })

  for (const theme of THEMES) {
    describe(theme, () => {
      it(`selected text meets AA body (${AA_BODY}:1) on the selection plane`, () => {
        const rule = requireRule()
        const t = tokens[theme]
        const r = contrastRatio(t[rule.ink as keyof typeof t], t[rule.plane as keyof typeof t])
        expect(
          r,
          `${rule.ink} (${t[rule.ink as keyof typeof t]}) on ${rule.plane} ` +
            `(${t[rule.plane as keyof typeof t]}) = ${r.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_BODY)
      })

      // The highlight is the only thing saying "this is selected", so it is an affordance,
      // not decoration — contrast.test.ts's own rule for leaving the DECORATIVE set.
      for (const bg of BACKGROUNDS) {
        it(`the highlight is separable from ${bg} (${NON_TEXT}:1 non-text floor)`, () => {
          const rule = requireRule()
          const t = tokens[theme]
          const r = contrastRatio(t[rule.plane as keyof typeof t], t[bg])
          expect(
            r,
            `${rule.plane} (${t[rule.plane as keyof typeof t]}) on ${bg} (${t[bg]}) = ${r.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(NON_TEXT)
        })
      }

      it('the declared plane is more visible than the one the browser paints', () => {
        const rule = requireRule()
        const t = tokens[theme]
        const ours = contrastRatio(t[rule.plane as keyof typeof t], t.canvas)
        const theirs = contrastRatio(BROWSER_PLANE[theme], t.canvas)
        expect(
          ours,
          `${rule.plane} is ${ours.toFixed(2)}:1 on canvas; the browser's measured plane ` +
            `${BROWSER_PLANE[theme]} is ${theirs.toFixed(2)}:1`,
        ).toBeGreaterThan(theirs)
      })
    })
  }

  /**
   * THE FLOOR. Every test above reads `selectionRuleIn`, so a parser that silently returns
   * a WRONG-BUT-VALID rule would keep them all green — it would simply score a different
   * pair. This asks the file directly for the two token names, so the parser and the
   * assertions cannot fail in the same direction.
   */
  it('the shipped rule really names the tokens the scores above were computed for', () => {
    const block = /::selection\s*\{([^}]*)\}/.exec(themeCss)
    expect(block, 'no ::selection block in theme.css').not.toBeNull()
    const body = block![1]
    expect(body).toMatch(/background-color:\s*var\(--accent\)/)
    expect(body).toMatch(/[;{\s]color:\s*var\(--accent-ink\)/)
  })
})
