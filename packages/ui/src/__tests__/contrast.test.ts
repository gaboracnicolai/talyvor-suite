import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../lib/contrast'
import { tokens, type TokenName } from '../tokens'

/**
 * THE PALETTE, MEASURED.
 *
 * A colour token set is the one place where "it reads fine" and "it fails AA for a
 * large minority of readers" look identical to the author. This scores every sanctioned
 * pairing and fails on the number, not the impression.
 *
 * ⚠ IT FOUND SOMETHING THE MOMENT IT WAS WRITTEN. On the palette this replaced, `faint`
 * — the µ-tail of every money figure, at 12.5px — measured 2.98:1 on the light canvas
 * and 3.83:1 on the dark surface. Both fail AA for body text (4.5:1); the light pair
 * fails even the 3:1 large-text floor. It had been shipping.
 *
 * ⚠ EVERY TOKEN MUST BE CLASSIFIED. The three roles below must partition `TokenName`
 * exactly — a token in none of them, or in two, fails `the classification is total`.
 * That is deliberate: a new token must be argued into a role, because the alternative
 * is that it defaults into the unchecked set and nobody notices for a year.
 */

// Text roles: words render in these, so AA body applies (4.5:1).
const TEXT_ROLES = ['ink', 'muted', 'faint', 'accent'] as const
// Backgrounds: the opaque planes text and affordances land on.
const BACKGROUNDS = ['canvas', 'surface', 'sidebar'] as const
// Affordance roles: dots, 2px ticks, 4px bars, pills — non-text, so the 3:1 UI floor.
const AFFORDANCE_ROLES = ['lens', 'lxc', 'tier1', 'tier3', 'settled', 'held', 'slashed'] as const
// Ink that lands ON the accent fill (the primary button label). Scored against the fill.
const ON_ACCENT = ['accent-ink'] as const
// The accent fill's pressed/hover step — scored as a background for accent-ink.
const ACCENT_STATES = ['accent-hover', 'accent-tint'] as const
/**
 * DECORATIVE — exempt from a contrast floor, and this is the one exemption, so it is
 * argued rather than assumed. `rule` / `rule-strong` are separators. WCAG 1.4.11 applies
 * to a graphic that is REQUIRED to understand the content; every rule in this system sits
 * beside the thing it separates (a card has a label, a row has text, a table has headers),
 * so no rule is the sole carrier of any information. Raising them to 3:1 would produce the
 * heavy-boxed console this design language exists to avoid.
 *
 * ⚠ If a rule ever becomes the ONLY indicator of a state — a selected row marked by nothing
 * but its border, say — it stops being decorative and must move to AFFORDANCE_ROLES.
 */
const DECORATIVE = ['rule', 'rule-strong'] as const

describe('the instrument, before it measures anything', () => {
  // Published WCAG values. If these drift, every assertion below is decoration.
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
  })
  it('white on white is 1:1', () => {
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
  })
  it('#767676 on white is 4.54:1 — the canonical smallest passing grey', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2)
  })
  it('the ratio is symmetric', () => {
    expect(contrastRatio('#3AD6C0', '#060A12')).toBeCloseTo(contrastRatio('#060A12', '#3AD6C0'), 10)
  })
  it('a translucent foreground is composited, not read as opaque', () => {
    // 50% white over black composites to #808080-ish, nowhere near white's 21:1.
    const composited = contrastRatio('rgba(255,255,255,.5)', '#000000')
    expect(composited).toBeLessThan(21)
    expect(composited).toBeGreaterThan(1)
  })
  it('a colour form it cannot read throws rather than scoring as a pass', () => {
    expect(() => contrastRatio('hsl(180 50% 50%)', '#FFFFFF')).toThrow(/unreadable/)
  })
})

describe('the classification is total', () => {
  const classified = [
    ...TEXT_ROLES,
    ...BACKGROUNDS,
    ...AFFORDANCE_ROLES,
    ...ON_ACCENT,
    ...ACCENT_STATES,
    ...DECORATIVE,
  ] as readonly string[]
  const declared = Object.keys(tokens.light) as TokenName[]

  it('every token has exactly one role', () => {
    const missing = declared.filter((t) => !classified.includes(t))
    expect(missing, `unclassified token(s): ${missing.join(', ')} — give each a role above`).toEqual([])
    const counts = new Map<string, number>()
    for (const c of classified) counts.set(c, (counts.get(c) ?? 0) + 1)
    const doubled = [...counts].filter(([, n]) => n > 1).map(([n]) => n)
    expect(doubled, `token(s) in two roles: ${doubled.join(', ')}`).toEqual([])
  })
  it('no role names a token that does not exist', () => {
    const phantom = classified.filter((c) => !(c in tokens.light))
    expect(phantom, `role names a non-token: ${phantom.join(', ')}`).toEqual([])
  })
  it('light and dark declare the same token names', () => {
    expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort())
  })
})

for (const theme of ['light', 'dark'] as const) {
  const t = tokens[theme]
  describe(`${theme}: text meets AA body (4.5:1)`, () => {
    for (const role of TEXT_ROLES) {
      for (const bg of BACKGROUNDS) {
        it(`${role} on ${bg}`, () => {
          const r = contrastRatio(t[role], t[bg])
          expect(r, `${role} (${t[role]}) on ${bg} (${t[bg]}) = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  })

  describe(`${theme}: affordances meet the 3:1 non-text floor`, () => {
    for (const role of AFFORDANCE_ROLES) {
      for (const bg of BACKGROUNDS) {
        it(`${role} on ${bg}`, () => {
          const r = contrastRatio(t[role], t[bg])
          expect(r, `${role} (${t[role]}) on ${bg} (${t[bg]}) = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
        })
      }
    }
  })

  describe(`${theme}: the accent fill carries its own ink`, () => {
    it('accent-ink on accent meets AA body', () => {
      const r = contrastRatio(t['accent-ink'], t.accent)
      expect(r, `accent-ink on accent = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })
    it('accent-ink on accent-hover meets AA body — the pressed state is not a blind spot', () => {
      const r = contrastRatio(t['accent-ink'], t['accent-hover'])
      expect(r, `accent-ink on accent-hover = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })
    it('ink on accent-tint meets AA body — the tint is a hover/selected BACKGROUND for ink text', () => {
      const r = contrastRatio(t.ink, t['accent-tint'])
      expect(r, `ink on accent-tint = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })
    it('the tint is separable from the full fill (>= 3:1) so a hover is not mistaken for a press', () => {
      const r = contrastRatio(t.accent, t['accent-tint'])
      expect(r, `accent on accent-tint = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    })
  })
}
