/**
 * WCAG 2.1 relative luminance and contrast ratio, over the token colour forms this
 * system actually uses: `#rrggbb`, `#rrggbbaa` and `rgba(r,g,b,a)`.
 *
 * This exists so the palette can be ASSERTED rather than eyeballed. A token set is the
 * one part of a design system where "it looks fine on my monitor" is indistinguishable
 * from "it fails AA for a third of readers" — the numbers are the only honest witness,
 * and `__tests__/contrast.test.ts` runs them over every sanctioned pairing.
 *
 * ⚠ The instrument is positive-controlled in that test against the pairs whose ratios
 * are published in WCAG itself (black/white = 21, white/white = 1, #767676/#FFFFFF =
 * 4.54 — the canonical "smallest passing grey"). A measuring device nobody has checked
 * against a known quantity measures nothing.
 */

/** sRGB channel (0–255) → linear light. */
function toLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export type Rgba = readonly [r: number, g: number, b: number, a: number]

/** Parse the three colour forms tokens.ts uses. Throws on anything else — a token
 *  written in a form this cannot read must not silently score as passing. */
export function parseColour(css: string): Rgba {
  const s = css.trim()
  const hex6 = /^#([0-9a-f]{6})$/i.exec(s)
  if (hex6) {
    const n = parseInt(hex6[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const hex8 = /^#([0-9a-f]{8})$/i.exec(s)
  if (hex8) {
    const n = parseInt(hex8[1], 16)
    return [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, (n & 255) / 255]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (rgb) {
    const parts = rgb[1].split(',').map((p) => Number(p.trim()))
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) throw new Error(`unreadable colour: ${css}`)
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
  }
  throw new Error(`unreadable colour: ${css}`)
}

/** Composite a possibly-translucent colour over an opaque one (simple source-over). */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}

export function luminance(colour: Rgba): number {
  return 0.2126 * toLinear(colour[0]) + 0.7152 * toLinear(colour[1]) + 0.0722 * toLinear(colour[2])
}

/**
 * Contrast ratio of `foreground` against an OPAQUE `background`. A translucent
 * foreground is composited first — which is how `rule` (an rgba hairline) is scored
 * as what a reader actually sees rather than as an unrenderable colour.
 */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColour(background)
  if (bg[3] !== 1) throw new Error(`background must be opaque, got ${background}`)
  const fg = over(parseColour(foreground), bg)
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
