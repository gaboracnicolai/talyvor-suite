import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../lib/contrast'
import { tokens, type TokenName } from '../tokens'
import { AA_BODY, TEXT_PLANES, TEXT_ROLES as PLANE_TEXT_ROLES, permits, ratio } from '../planes'

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
      // ⚠ THIS CASE IS CORRECT AND IT IS ONE PAIR. It was the only thing scoring the tint, and it
      // named the one role somebody thought of; `faint` on the same plane is 3.97:1 and nothing
      // asked. §"the tint is a plane, so every role is asked about it" below is the total form.
      const r = contrastRatio(t.ink, t['accent-tint'])
      expect(r, `ink on accent-tint = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })
    it('the tint is separable from the full fill (>= 3:1) so a hover is not mistaken for a press', () => {
      const r = contrastRatio(t.accent, t['accent-tint'])
      expect(r, `accent on accent-tint = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    })
  })
}

/**
 * THE PLANES, TOTAL — every role asked about every plane, in both directions.
 *
 * ── WHAT THE MATRIX ABOVE CANNOT ASK ─────────────────────────────────────────────────────────
 *
 * `TEXT_ROLES x BACKGROUNDS` scores four roles against three planes and is total over THOSE. The
 * product renders text on a fourth, `accent-tint` — NavItem's selected and hovered row, and every
 * default/danger Button's press — and the only thing scoring it was one hand-written case naming
 * one role. MEASURED at `7513c91` from the running DOM of the whole apps/web suite: 10 rendered
 * sites — the ten sidebar destinations, each of which is the selected row on its own view — and
 * `faint` on that plane is 3.97:1 light / 3.63:1 dark. The plane's own component declared exactly
 * that pair on its icon. (The count is 10 and not the 8 an earlier draft carried: the probe
 * deduplicated inside a module vitest re-instantiates per test FILE, so 8 was a fact about the
 * instrument. planes.ts records the re-measurement.)
 *
 * ── WHY THE REFUSALS ARE CHECKED TOO ─────────────────────────────────────────────────────────
 *
 * `ROLES_ON_PLANE` says which roles a plane permits, so a role can be left off a plane. Left
 * unchecked that is an exemption list, and an exemption list absorbs every future failure
 * silently. So a refusal must be a FACT: a pair that is refused has to MEASURE below the floor in
 * at least one theme. Widen the palette until `faint` clears the tint and this file fails until
 * somebody widens the classification to match — which is the direction that keeps it honest.
 *
 * ⚠ THE SET OF PLANES IS PINNED FROM THE DOM, NOT HERE. This file has no product to look at;
 * `apps/web/src/planeAudit.ts` scores what actually renders and reports a plane nobody classified.
 * Neither half can produce the other's answer, which is why both exist.
 */
describe('the tint is a plane, so every role is asked about it', () => {
  it('every plane in the classification is a real token', () => {
    const phantom = TEXT_PLANES.filter((p) => !(p in tokens.light))
    expect(phantom, `plane names a non-token: ${phantom.join(', ')}`).toEqual([])
  })

  it('every background the matrix scores is also a classified plane', () => {
    const missing = BACKGROUNDS.filter((b) => !(TEXT_PLANES as string[]).includes(b))
    expect(missing, `background(s) absent from ROLES_ON_PLANE: ${missing.join(', ')}`).toEqual([])
  })

  for (const plane of TEXT_PLANES) {
    for (const role of PLANE_TEXT_ROLES) {
      const allowed = permits(plane, role)
      it(`${role} on ${plane} — ${allowed ? 'permitted, so it must clear AA body' : 'refused, so it must MEASURE below it'}`, () => {
        const light = ratio('light', role, plane)
        const dark = ratio('dark', role, plane)
        const note = `${role} on ${plane} = ${light.toFixed(2)}:1 light, ${dark.toFixed(2)}:1 dark`
        if (allowed) {
          expect(Math.min(light, dark), note).toBeGreaterThanOrEqual(AA_BODY)
        } else {
          // A refusal is a measurement, never a preference — see the header.
          expect(Math.min(light, dark), `${note} — this pair PASSES; refusing it is a preference`)
            .toBeLessThan(AA_BODY)
        }
      })
    }
  }
})
