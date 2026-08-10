import { contrastRatio } from './lib/contrast'
import { tokens, type TokenName } from './tokens'

/**
 * THE PLANES TEXT LANDS ON, AND WHICH ROLES MAY LAND ON EACH.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 *
 * theme.css says, about the guard that was already here:
 *
 *     contrast.test.ts holds every text token to AA body (4.5:1) against every BACKGROUND TOKEN
 *
 * That sentence is true of the MATRIX `contrast.test.ts` scores — four text roles against
 * `canvas`, `surface`, `sidebar` — and the product does not stay inside it. MEASURED at `7513c91`
 * by recording, for every element that renders its own text in the whole apps/web suite, the
 * nearest text token and the nearest background token above it: TEN rendered sites put text on a
 * FOURTH plane, `accent-tint` — the selected sidebar row, which is each of the console's ten
 * navigation destinations in turn (NavItem's `active` branch is `bg-accent-tint text-ink`), plus
 * every hovered row and the pressed state of every default and danger Button
 * (`active:bg-accent-tint` over `text-ink`). Four declarations in two components.
 *
 * ⚠ THAT COUNT WAS TEN AND I FIRST WROTE EIGHT, which is worth one line because the number is a
 * fact about the INSTRUMENT before it is a fact about the product. The probe deduplicated by
 * (role, plane) inside a module that vitest re-instantiates per test FILE, so "8" was the number
 * of test files that rendered the pair, not the number of sites. Re-measured without the dedupe:
 * 126 observations, 9 test files, 10 distinct product elements — the ten sidebar destinations.
 *
 * ⚠ AND THE TINT IS NOT UNSCORED — IT IS SCORED FOR ONE ROLE, WHICH IS THE ACTUAL DEFECT SHAPE.
 * `contrast.test.ts` carries a hand-written case, `ink on accent-tint meets AA body`, sitting
 * outside the matrix in the accent block. It is correct and it is a single named pair: nothing
 * asks whether a role OTHER than `ink` lands on that plane. This is `9e03e50`'s finding again in
 * a different medium — a curated list guards the cases someone thought of and says nothing about
 * the rest — and here the rest is where the numbers go bad. The plane is DARKER than the canvas
 * it sits on, so it eats the margin of the two dimmest roles:
 *
 *              light   dark      on canvas, for comparison
 *     ink      14.16   12.78      17.27 / 16.92
 *     muted     5.51    4.74       6.72 /  6.27
 *     faint     3.97    3.63       4.84 /  4.81     ← below AA body 4.5 on the tint, BOTH themes
 *     accent    3.95    8.24       4.82 / 10.91     ← below AA body 4.5 on the tint, light
 *
 * `faint` clears the floor on every plane the matrix scores and fails on the one it does not.
 * A guard that scores a curated matrix cannot ask whether the product renders text somewhere
 * outside it — the same shape `placeholderAudit.ts` was written for, one level up: that guard
 * asked "does some text wear no token at all", this one asks "does some text wear its token on a
 * plane nobody scored for that role".
 *
 * ⚠ AND THE REFUSED PAIR IS ALREADY DECLARED IN THE DESIGN SYSTEM. `NavItem`'s `icon` slot was
 * `text-faint`, unconditionally, INSIDE the row whose selected and hovered states are both
 * `bg-accent-tint` — so `faint` on the tint, 3.97:1, shipped as a public prop of the console's
 * navigation. No surface passes an `icon` today, which is exactly why no DOM audit could see it
 * and why five audits and a reach census all stayed green over it. The fix is in NavItem.tsx.
 *
 * ── THE TABLE IS A CLASSIFICATION, NOT AN EXEMPTION LIST ─────────────────────────────────────
 *
 * Every (plane, role) pair is in exactly one of two states, and BOTH are checked in
 * `contrast.test.ts`, which is what stops this becoming a place to put things that fail:
 *
 *   · PERMITTED — must measure at or above its floor in BOTH themes.
 *   · REFUSED   — must measure BELOW the floor in at least one theme. A refusal has to be a
 *                 FACT about the palette; a pair that would pass cannot be refused here, so this
 *                 table cannot be used to express a preference.
 *
 * ⚠ AND THE SET OF PLANES IS PINNED FROM THE OTHER SIDE. `apps/web/src/planeAudit.test.tsx`
 * asserts that the planes the running product actually renders text on are EXACTLY these keys —
 * a plane that appears and is not here fails as unclassified, and a plane listed here that stops
 * appearing fails as stale. This file cannot answer that question (it has no DOM) and the audit
 * cannot answer this one (it has no floor), so each closes the other's hole.
 */

/** WCAG 2.2 AA for body text. The same floor `contrast.test.ts` has always applied. */
export const AA_BODY = 4.5

/** The roles words render in. `accent-ink` is the label ON the accent fill, not a body role. */
export const TEXT_ROLES = ['ink', 'muted', 'faint', 'accent', 'accent-ink'] as const
export type TextRole = (typeof TEXT_ROLES)[number]

/**
 * Plane → the roles permitted on it.
 *
 * ⚠ `accent` AND `accent-hover` ARE PLANES, not only fills. The primary Button is
 * `bg-accent text-accent-ink` and its hover/press step is `bg-accent-hover`, so both carry a
 * label and both are scored here rather than only as the accent's states.
 *
 * ⚠ `accent-tint` PERMITS TWO ROLES, and the two it refuses are refused BY MEASUREMENT (3.97 and
 * 3.95, both under 4.5). The product's own fix for the one place that declared a refused pair is
 * in NavItem.tsx — see its icon.
 */
export const ROLES_ON_PLANE = {
  canvas: ['ink', 'muted', 'faint', 'accent'],
  surface: ['ink', 'muted', 'faint', 'accent'],
  sidebar: ['ink', 'muted', 'faint', 'accent'],
  'accent-tint': ['ink', 'muted'],
  accent: ['accent-ink'],
  'accent-hover': ['accent-ink'],
} as const satisfies Record<string, readonly TextRole[]>

export type TextPlane = keyof typeof ROLES_ON_PLANE

export const TEXT_PLANES = Object.keys(ROLES_ON_PLANE) as TextPlane[]

export function isTextRole(name: string): name is TextRole {
  return (TEXT_ROLES as readonly string[]).includes(name)
}

export function isTextPlane(name: string): name is TextPlane {
  return (TEXT_PLANES as readonly string[]).includes(name)
}

export function permits(plane: TextPlane, role: TextRole): boolean {
  return (ROLES_ON_PLANE[plane] as readonly string[]).includes(role)
}

/**
 * The measured ratio for one pair, in one theme, from the token values themselves.
 *
 * ⚠ IT COMPUTES RATHER THAN LISTING. A table of "the numbers we measured" is a second copy of a
 * fact that already exists in `tokens.ts`, and the copy is the one that goes stale the day someone
 * edits a hex — `c71ca9c`'s two-copies-of-one-measurement, in contrast. The numbers in this file's
 * header are prose for a reader; nothing is asserted against them.
 */
export function ratio(theme: 'light' | 'dark', fg: TokenName, bg: TokenName): number {
  return contrastRatio(tokens[theme][fg], tokens[theme][bg])
}

/** The worse of the two themes — a pair ships in both, so the weaker one is the answer. */
export function worstRatio(fg: TokenName, bg: TokenName): number {
  return Math.min(ratio('light', fg, bg), ratio('dark', fg, bg))
}
