/**
 * THE EYEBROW AUDIT — the token carries the size and the tracking; the CALL SITE carries the case,
 * and until now nobody checked that it did.
 *
 * preset.ts §THE EYEBROW states the rule and hands enforcement to nobody:
 *
 *     ⚠ THE UPPERCASE IS NOT IN HERE, deliberately. `text-transform: uppercase` maps
 *     µ (U+00B5) to Greek capital Mu, and µLENS/µLXC sit inside these labels. It is applied
 *     at the call site, where MuNumeral can keep its µ in a `normal-case` span.
 *
 * caseAudit.ts took the DANGEROUS half of that sentence — a transform must not REPLACE a character
 * — and left the other half open, because the two rules read in opposite directions: caseAudit asks
 * "is this uppercase hurting a character", this asks "is the uppercase there at all".
 *
 * ── WHY THIS IS A RULE AND NOT A PREFERENCE ──────────────────────────────────────────────────
 *
 * preset.ts's own argument for putting the tracking IN the token applies unchanged to the case:
 * "a caller who applies the size and forgets the tracking gets small mono text, not an eyebrow."
 * An eyebrow that forgets the uppercase is 11px mono at 0.24em — letter-spacing wide enough to be
 * legible only as a label, carrying text that is not in label case. It does not read as a smaller
 * heading; it reads as broken spacing.
 *
 * ── MEASURED BEFORE IT WAS WRITTEN, AND THE NUMBER IS THE REASON THIS EXISTS ─────────────────
 *
 * At `ff17b41`, dropping `uppercase` from ONE rendered eyebrow — Overview.tsx:181, on the console's
 * densest eyebrow surface — left 56 test files and 678 tests GREEN. Not one assertion in either
 * package could see it. That is the same shape as the µ half: `text-transform` is a PAINT-TIME
 * transform, so `textContent` is identical with and without it and every text assertion passes over
 * it. A rendered-text audit could not have found this and never will.
 *
 * ── WHY THE DOM AND NOT THE SOURCE, MEASURED ─────────────────────────────────────────────────
 *
 * Two reasons, both observed rather than argued:
 *
 *  1. THE CLASS LIST IS ASSEMBLED AT RUNTIME AT REAL SITES. Members.tsx builds it with `cn` and a
 *     conditional (`m.role === 'owner' ? 'font-semibold text-ink' : 'text-muted'`) and Pill.tsx does
 *     the same. A source rule reads the literal; only the DOM sees what was assembled.
 *  2. `text-transform` INHERITS, so the answer depends on the nearest ANCESTOR that declares one.
 *     An eyebrow is allowed to take its uppercase from a parent. Source cannot answer that.
 *
 * Measured over the whole web suite at `ff17b41`: 21 source call sites in the two packages collapse
 * to 14 distinct rendered (tag, class list) pairs, and all 14 have `uppercase` in effect.
 *
 * ── WHY IT CANNOT DISAGREE WITH caseAudit, VERIFIED RATHER THAN INHERITED ────────────────────
 *
 * The obvious fear is that this rule demands an uppercase that caseAudit forbids. It cannot, and
 * the reason is structural: this judges the element whose OWN class list names `text-eyebrow`;
 * MuNumeral's protection is a `normal-case` span rendered by CaseSafe as a CHILD of that element
 * (MuNumeral.tsx:23 opens the eyebrow, line 25 puts CaseSafe inside it). Different elements, so
 * both rules are satisfiable at once — and the shipped product satisfies both today.
 *
 * ⚠ It shares `transformInEffect` with caseAudit ON PURPOSE. "The transform in effect" must mean
 * exactly one thing across the two rules, or a µ could be protected under one definition and
 * uppercased under the other. That function is positive-controlled in caseAudit.test.tsx.
 *
 * ── THE LIMIT, STATED RATHER THAN IMPLIED ────────────────────────────────────────────────────
 *
 * This sees what a test RENDERS. `check-audit-reach.mjs` makes that stronger than it sounds — it
 * fails CI when an exported component is never rendered by any test — but reach is enforced per
 * COMPONENT, not per BRANCH. A `cond ? 'text-eyebrow' : …` arm that no fixture takes is rendered by
 * nobody and invisible here. Measured, so the size of that gap is known rather than guessed: two of
 * the 14 rendered sites appear only TWICE in the entire suite (pm.tsx's fence label and Members'
 * owner row), so they hang on a single fixture each. eyebrowAudit.test.tsx closes that from the
 * other side with a SOURCE rule over both packages, which reads the literal and needs no fixture.
 *
 * ── THE CONTROLS, AND THE TWO THEY CORRECTED ─────────────────────────────────────────────────
 *
 * 13/14 CAUGHT — scripts/w11-eyebrow-controls.py. Every control asserts its anchor count BEFORE
 * writing, verifies the bytes changed ON DISK, and names a must-red target AND a must-stay-green
 * companion, so a control that reds both is reported SUSPECT rather than counted.
 *
 * ⚠ THE DIVISION OF LABOUR BETWEEN THE TWO RULES IS MEASURED, NOT ASSERTED. Three controls exist
 * only to show that neither rule subsumes the other:
 *   · C2  an eyebrow in a branch no fixture takes  → source RED, Members surface GREEN
 *   · C14 an eyebrow whose token is assembled (`'text-' + 'eyebrow'`), so no literal carries it
 *                                                  → Members surface RED, source GREEN
 *   · C3  an eyebrow that genuinely INHERITS its uppercase from a wrapper
 *                                                  → source RED (it is strict), surface GREEN
 * C3 is the one that earns the sentence above about inheritance: the DOM rule stays green on a
 * real product change where the transform arrives from an ancestor. Asserting that on a fixture
 * only proves the fixture.
 *
 * ⚠ C3 FIRST RAN AS A BROKEN BUILD AND WOULD HAVE SCORED AS A CATCH. The first version added an
 * opening `<span>` without its closing tag; esbuild failed, both targets went red, and the harness
 * reported SUSPECT rather than CAUGHT — which is the only reason it was not written down as
 * evidence. It is now built from the file's own bytes and asserts the tags balance.
 *
 * ⚠ C13 IS NOT CAUGHT, AND IT IS SHIPPED THAT WAY DELIBERATELY. Disabling the offender REPORT in
 * test-setup.ts (the audit still runs; nobody reads it) reds nothing, because the report is silent
 * while the product is clean. C14 is what makes that statement precise rather than a shrug: the
 * report is the ONLY catcher for an eyebrow whose class list is assembled at runtime, so what C13
 * costs is exactly that class of defect and nothing else. Every one of the other six audits has
 * the same unguarded reporting path; this is a property of the shared wiring, not of this rule.
 */
import { transformInEffect } from './caseAudit'

/** The token that makes an element an eyebrow. */
export const EYEBROW_CLASS = 'text-eyebrow'

export interface EyebrowOffender {
  /** The own-text of the eyebrow, for naming it in the failure. */
  text: string
  tag: string
  className: string
  /** What `text-transform` is actually in effect on it — 'none' when nothing declares one. */
  transform: string
  /** The class list of the element the transform was inherited FROM, or '' when none. */
  fromClassName: string
}

/** Does this element's OWN class list make it an eyebrow? */
export function isEyebrow(el: Element): boolean {
  return (el.getAttribute('class') ?? '').split(/\s+/).includes(EYEBROW_CLASS)
}

/** An element's OWN text — direct text children only, the smallest unit that carries a class. */
function ownText(el: Element): string {
  let s = ''
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 /* TEXT_NODE */) s += n.nodeValue ?? ''
  return s
}

/**
 * Every eyebrow under `root` that does NOT have an uppercase transform in effect on it.
 *
 * ⚠ IT DOES NOT REQUIRE THE `uppercase` CLASS ON THE ELEMENT ITSELF, and that is deliberate rather
 * than lax: `text-transform` inherits, so an eyebrow nested inside an uppercase region is correct
 * and pinning the class to the element would red it. The question is what the browser will paint.
 */
export function eyebrowOffendersIn(root: ParentNode): EyebrowOffender[] {
  const out: EyebrowOffender[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!isEyebrow(el)) continue
    const { transform, from } = transformInEffect(el)
    if (transform === 'uppercase') continue
    out.push({
      text: ownText(el).trim(),
      tag: el.tagName.toLowerCase(),
      className: el.getAttribute('class') ?? '',
      transform,
      fromClassName: from?.getAttribute('class') ?? '',
    })
  }
  return out
}

// ── THE RUNNING AUDIT ────────────────────────────────────────────────────────────────────────
//
// ⚠ CAPTURE IS AT COMMIT TIME, for the reason figureAudit.ts and caseAudit.ts both record: Testing
// Library's auto-cleanup is registered when the TEST FILE imports it, after this setup file, and
// vitest runs `afterEach` hooks last-registered-first — so a setup-file `afterEach` scans an EMPTY
// body and reports every surface clean.

const records: EyebrowOffender[] = []
const sightings: { file: string; eyebrows: number }[] = []
let offenders: EyebrowOffender[] = []
let currentFile = ''

function scan(): void {
  for (const o of eyebrowOffendersIn(document.body)) {
    const key = `${o.tag}|${o.className}|${o.text}`
    if (records.some((r) => `${r.tag}|${r.className}|${r.text}` === key)) continue
    records.push(o)
    offenders.push(o)
  }
  // ⚠ THE FLOOR COUNTS CORRECT EYEBROWS, NOT EYEBROWS. A file that rendered an eyebrow satisfies
  // "this file exercised the audit" even when the audit is switched off, because an OFFENDING
  // eyebrow is still an eyebrow. Counting only the ones with the transform genuinely in effect
  // means the floor can only be met by the mechanism the rule is about — the same correction
  // caseAudit's MUST_PROTECT_MICRO_SIGN records paying for.
  let n = 0
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (!isEyebrow(el)) continue
    if (transformInEffect(el).transform === 'uppercase') n += 1
  }
  if (n > 0) sightings.push({ file: currentFile, eyebrows: n })
}

/** Start recording. Called once per test file, from test-setup.ts. */
export function installEyebrowAudit(): void {
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })
}

/** Told which file is running, so the floor can name it. */
export function setEyebrowAuditFile(file: string): void {
  currentFile = file
}

export function auditedEyebrowOffenders(): readonly EyebrowOffender[] {
  return records
}

/** The offenders seen since the last call, and clears them. */
export function takeEyebrowOffenders(): EyebrowOffender[] {
  const out = offenders
  offenders = []
  return out
}

/**
 * Test files that MUST render at least one eyebrow with the transform genuinely in effect.
 *
 * ⚠ CHOSEN FROM A MEASUREMENT, NOT FROM INTUITION. 27 of the 56 web test files render an eyebrow.
 * These five were picked because between them they cover every distinct SHAPE the product renders
 * — and two of them are the FRAGILE ones, the sites that appear only twice in the whole suite and
 * would vanish silently if a fixture changed:
 *
 *   Overview   the console's densest eyebrow surface (1,005 observations)
 *   Landing    the public page's eyebrows, including the ones over quoted ledger figures
 *   Ledger     MuNumeral's unit labels — the eyebrow that contains a protected µ
 *   Members    the owner/member weight distinction preset.ts names as its reason for weight 400
 *   pm         Docs' code-fence language label and its pill
 *
 * A floor, not a census: a new surface is audited the moment its test renders it, listed or not.
 */
export const MUST_RENDER_EYEBROW: Record<string, string> = {
  'src/areas/lens/Overview.test.tsx': 'the console surface with the most eyebrows in the product',
  'src/areas/marketing/Landing.test.tsx': 'the public page eyebrows, over the quoted ledger figures',
  'src/areas/lens/Ledger.test.tsx': 'MuNumeral unit labels — an eyebrow wrapping a protected µ',
  'src/areas/lens/Members.test.tsx': 'the owner/member weight distinction, one of two fragile sites',
  'src/areas/docs/pm.test.tsx': 'the code-fence language label, the other fragile site',
}

/** Does this file's record satisfy the floor? */
export function satisfiesEyebrowFloor(file: string): boolean {
  return sightings.some((s) => s.file === file && s.eyebrows > 0)
}
