import {
  AA_BODY,
  ROLES_ON_PLANE,
  isTextPlane,
  isTextRole,
  permits,
  ratio,
  worstRatio,
  type TextPlane,
  type TextRole,
} from '@talyvor/ui'

import { ownText } from './figureAudit'

/**
 * EVERY LINE OF TEXT IS SCORED AGAINST THE PLANE IT ACTUALLY LANDS ON, on every surface.
 *
 * `packages/ui/src/planes.ts` carries the measurement, the four numbers and why the plane set is
 * a classification rather than an exemption list. This file is the half that can see the DOM.
 *
 * ── WHY IT IS NOT A SOURCE RULE, AND THE REASON IS NOT THE USUAL ONE ─────────────────────────
 *
 * The colour and the plane are declared in different places and neither knows about the other.
 * `NavItem`'s icon carries its own text token; the background it sits on is decided by the
 * BUTTON above it, and by whether that button is the selected one. `background-color` does not
 * inherit — but the plane a character is painted over is still whatever the nearest ancestor that
 * declares one is, which is the same ancestor walk `caseAudit.transformInEffect` and
 * `glyphAudit.effectiveFamily` each do for their own property. A grep for "a text token near a bg
 * token" connects nothing: they are 20 lines and one component boundary apart.
 *
 * ── WHAT IT ASKS ─────────────────────────────────────────────────────────────────────────────
 *
 * For every element whose OWN TEXT is non-empty:
 *   · the nearest ancestor-or-self text token  (default `ink` — theme.css sets `color: var(--ink)`
 *     on `body`, so untokened text is ink, not unknown)
 *   · the nearest ancestor-or-self background token (default `canvas` — same rule, `background:
 *     var(--canvas)` on `body`)
 * and then three questions, in order, because a later one is meaningless if an earlier one fails:
 *   1. is the plane CLASSIFIED at all? An unclassified plane is an offender, not a pass — the
 *      `9e03e50` direction: a table that only ever grows quietly is a table that is not read.
 *   2. does the plane PERMIT that role? The refusal is a measured fact; see ROLES_ON_PLANE.
 *   3. does the pair clear AA body in BOTH themes? A pair ships in both, so the weaker theme is
 *      the answer, and the score is computed from `tokens.ts` rather than listed anywhere.
 *
 * ⚠ QUESTION 3 IS NOT REDUNDANT WITH QUESTION 2 AND THAT IS DELIBERATE. `contrast.test.ts` proves
 * every PERMITTED pair clears the floor today, so 3 can only fire on a pair that 2 already let
 * through — which is precisely what happens if somebody edits a hex in `tokens.ts` and updates the
 * classification to match. Two independent readings of the same fact, one from the table and one
 * from the palette, so neither can go quietly wrong alone.
 *
 * ⚠ STATED LIMITS, NOT IMPLIED:
 *   (a) IT CANNOT SEE A STATE JSDOM DOES NOT ENTER. `:hover` and `:active` never apply in a test,
 *       so a `hover:`-prefixed plane is invisible here. That is not a hole this audit can close
 *       from the DOM, and it is why the NavItem fix uses ONE token that clears the floor on every
 *       plane the row can be on rather than a token per state — a state-dependent answer would be
 *       unverifiable by the only instrument that can see the plane at all. The class lists that
 *       carry a variant plane are pinned in planeAudit.test.tsx instead, by name and with numbers.
 *   (b) IT SCORES TOKENS, NOT PIXELS. An element whose colour comes from anywhere but a token is
 *       `placeholderAudit.ts`'s question, not this one.
 *   (c) it rides apps/web's setup, so a surface with no test is audited by nothing — the limit
 *       test-setup.ts already states for the other five, inherited rather than new.
 */

export interface PlaneOffender {
  role: string
  plane: string
  /** 'unclassified' | 'refused' | 'below-floor' */
  reason: 'unclassified' | 'refused' | 'below-floor'
  light: number | null
  dark: number | null
  text: string
  tag: string
  className: string
  /** the class list of the element the plane was inherited FROM */
  planeFrom: string
}

/**
 * `body` declares both of these in theme.css, so untokened text is not "unknown" — it is ink on
 * canvas, and scoring it as such is the honest answer rather than skipping it.
 */
export const DEFAULT_ROLE: TextRole = 'ink'
export const DEFAULT_PLANE: TextPlane = 'canvas'

/** Utility class names carry variants as `hover:bg-x`; a variant is a STATE, not the resting plane. */
function bareUtilities(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c !== '' && !c.includes(':'))
}

/** The nearest ancestor-or-self declaration of `prefix-<token>`, unprefixed by any variant. */
function nearestToken(el: Element | null, prefix: 'text' | 'bg'): { token: string; from: Element } | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    for (const c of bareUtilities(e)) {
      if (!c.startsWith(`${prefix}-`)) continue
      const token = c.slice(prefix.length + 1)
      if (prefix === 'text' ? isTextRole(token) : isTextPlane(token) || token in ROLES_ON_PLANE) {
        return { token, from: e }
      }
      // A `bg-` utility naming something that is NOT a classified plane still ENDS the walk: it is
      // an opaque fill and the text is painted over it, so continuing would score the pair against
      // a plane two levels further up that the reader can no longer see. Reported as unclassified.
      if (prefix === 'bg' && /^[a-z][a-z0-9-]*$/.test(token) && !token.includes('[')) {
        return { token, from: e }
      }
    }
  }
  return null
}

export function roleOf(el: Element): { token: string; from: Element | null } {
  const found = nearestToken(el, 'text')
  return found ?? { token: DEFAULT_ROLE, from: null }
}

export function planeOf(el: Element): { token: string; from: Element | null } {
  const found = nearestToken(el, 'bg')
  return found ?? { token: DEFAULT_PLANE, from: null }
}

/** Score one (role, plane) pair, or say why it cannot be scored. */
export function judge(role: string, plane: string): Omit<PlaneOffender, 'text' | 'tag' | 'className' | 'planeFrom'> | null {
  if (!isTextPlane(plane)) {
    return { role, plane, reason: 'unclassified', light: null, dark: null }
  }
  if (!isTextRole(role) || !permits(plane, role)) {
    return {
      role,
      plane,
      reason: 'refused',
      light: isTextRole(role) ? ratio('light', role, plane) : null,
      dark: isTextRole(role) ? ratio('dark', role, plane) : null,
    }
  }
  if (worstRatio(role, plane) < AA_BODY) {
    return { role, plane, reason: 'below-floor', light: ratio('light', role, plane), dark: ratio('dark', role, plane) }
  }
  return null
}

/** Every element under `root` whose text does not clear its plane. */
export function planeOffendersIn(root: ParentNode): PlaneOffender[] {
  const out: PlaneOffender[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const text = ownText(el).trim()
    if (text === '') continue
    const role = roleOf(el)
    const plane = planeOf(el)
    const verdict = judge(role.token, plane.token)
    if (!verdict) continue
    out.push({
      ...verdict,
      text,
      tag: el.tagName.toLowerCase(),
      className: el.getAttribute('class') ?? '',
      planeFrom: plane.from?.getAttribute('class') ?? '(body)',
    })
  }
  return out
}

// ── THE RUNNING AUDIT ────────────────────────────────────────────────────────────────────────
//
// ⚠ CAPTURE IS AT COMMIT TIME, for the reason figureAudit.ts records as TRAP THREE: Testing
// Library's cleanup is registered after this setup file and vitest runs afterEach
// last-registered-first, so an afterEach DOM scan reads an EMPTY body and reports every surface
// clean. `afterEach` here only reads what the observer already recorded.

const seen = new Set<string>()
let offenders: PlaneOffender[] = []
/** Every (role, plane) pair the product was OBSERVED rendering — the census the pin is checked against. */
const census = new Set<string>()
const explicitPlaneByFile = new Map<string, number>()
let currentFile = ''

function scan(): void {
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const text = ownText(el).trim()
    if (text === '') continue
    const role = roleOf(el)
    const plane = planeOf(el)
    census.add(`${role.token}|${plane.token}`)
    if (plane.from) {
      explicitPlaneByFile.set(currentFile, (explicitPlaneByFile.get(currentFile) ?? 0) + 1)
    }
    const verdict = judge(role.token, plane.token)
    if (!verdict) continue
    const key = `${currentFile}|${role.token}|${plane.token}|${el.tagName}|${el.getAttribute('class') ?? ''}|${text}`
    if (seen.has(key)) continue
    seen.add(key)
    offenders.push({
      ...verdict,
      text,
      tag: el.tagName.toLowerCase(),
      className: el.getAttribute('class') ?? '',
      planeFrom: plane.from?.getAttribute('class') ?? '(body)',
    })
  }
}

/** Start recording. Called once per test file, from test-setup.ts. */
export function installPlaneAudit(): void {
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })
}

export function setPlaneAuditFile(file: string): void {
  currentFile = file
}

/** Every `role|plane` pair observed so far, for the census pin. */
export function auditedPairs(): readonly string[] {
  return [...census]
}

/** The offenders seen since the last call, and clears them. */
export function takePlaneOffenders(): PlaneOffender[] {
  const out = offenders
  offenders = []
  return out
}

/**
 * THE FLOOR — a file listed here must have scored text against a plane some element DECLARED,
 * not against the body default.
 *
 * ⚠ IT ASKS FOR AN EXPLICIT PLANE, NOT FOR "A PAIR", and the difference is the whole value. Every
 * test renders some text, so "audited ≥1 pair" stays green with `planeOf` blinded to return the
 * default — the single edit that switches the interesting half of this audit off, since every
 * finding it can produce comes from an ancestor's `bg-` utility. Requiring a DECLARED plane
 * exercises the ancestor walk, which is the part a source rule could not do.
 *
 * ⚠ AND IT CANNOT CATCH EVERYTHING, said rather than implied — the `f9f35ab` lesson. Four
 * failures, four catchers, each OBSERVED red by `scripts/w11-plane-controls.py` against a target
 * that contains no test of this module, so no verdict here names a test that did not run:
 *   · a dead observer            → THIS FLOOR (C4b, and the message it printed was this floor's
 *                                  own, on src/ConsoleTitle.test.tsx)
 *   · a blinded `judge`          → planeAudit.test.tsx's direct unit tests on real token values
 *                                  (C3); the floor cannot see this edit, which is the same
 *                                  independence focusAudit.ts records about its own predicate
 *   · a plane dropped from the classification → the OFFENDER rule on a real surface (C7b)
 *   · a blinded ancestor walk    → ⚠ THE OFFENDER RULE, NOT THIS FLOOR, and I had written the
 *                                  opposite before running it. With `planeOf` blinded to the body
 *                                  default, the primary Button's `accent-ink` label is suddenly
 *                                  scored against `canvas` — a pair the classification refuses at
 *                                  1.1:1 — so an offender is reported before any floor is
 *                                  consulted (C2b). The floor is a SECOND reader of that edit,
 *                                  not the first, and the distinction is only visible by reading
 *                                  which message the control actually printed.
 */
export const MUST_AUDIT_A_DECLARED_PLANE: Record<string, string> = {
  // ⚠ FULL RELATIVE PATHS. `currentFile` is vitest's `ctx.task.file.name`, e.g.
  // 'src/areas/lens/Overview.test.tsx'. glyphAudit's sibling table shipped with bare basenames and
  // THE FLOOR NEVER FIRED ONCE; that is recorded in MUST_AUDIT_MONO_TEXT and not re-learned here.
  // ⚠ NO REASON HERE MAY NAME A CLASS, and this table cost one red to learn it — the same trap
  // glyphAudit.ts records at `woff2Codepoints`. deadClasses.test.ts harvests any string literal
  // whose tokens all LOOK like classes and one of which Tailwind emits; the first version of the
  // line below said "a bg-surface plane", which is a real utility, so the other eight words in the
  // sentence were reported as dead classes. The extractor cannot tell a class from a sentence
  // about one — `89bd58d`'s finding, arriving again in the guard written for a different one.
  'src/areas/lens/Overview.test.tsx': 'every balance card is a raised plane over the canvas',
  'src/ConsoleTitle.test.tsx': 'the console shell renders the sidebar plane and the selected row',
  'src/planeAudit.test.tsx': 'its own fixtures render text on a declared plane in both directions',
}

export function satisfiesPlaneFloor(file: string): boolean {
  return (explicitPlaneByFile.get(file) ?? 0) > 0
}
