/**
 * THE NUMERIC-FIELD AUDIT — the one numeral in this product that lives in a PROPERTY.
 *
 * `figureAudit.ts` reads an element's OWN TEXT: `ownText()` joins its direct TEXT NODES. That is
 * the right unit for everything the product prints, and it is structurally blind to a value the
 * user TYPES, because an `<input>` has no children at all. The same is true of the other six DOM
 * audits — case, focus, glyph, placeholder, plane, eyebrow all reach the DOM through text nodes or
 * attributes, and `value` on a controlled React input is neither: React assigns the PROPERTY.
 *
 * ── WHAT WAS MEASURED, AND ON WHAT ───────────────────────────────────────────────────────────
 *
 * A throwaway probe was installed into `test-setup.ts` at `732cf32` and recorded every
 * `input`/`textarea`/`select` this suite renders, together with its `value` and
 * `onFigureFace(el)`. 87 distinct field records over the whole apps/web suite. NINE held a value
 * that `figureKind()` calls a figure and nothing else, and they are TWO sites:
 *
 *     <input type="text" inputmode="decimal" aria-label="LXC to receive">   "1" "1.5" "0.01" "2"
 *         ConvertLens.tsx:289 — audited by Convert.test.tsx and Held.test.tsx.  onFace=FALSE
 *     <input type="range" aria-label="Contributors in the pool">             "1"
 *         Landing.tsx:320 — a slider. It paints NO TEXT, so its value is not on screen at all.
 *
 * Everything else the suite types is prose: issue titles, comment bodies, space names, key names,
 * and the `tlv_ws_…` string Members asks you to retype to confirm a destructive action.
 *
 * ⚠ SO THE DEFECT IS ONE FIELD, AND IT IS THE ONE YOU READ IMMEDIATELY BEFORE SPENDING. Convert
 * turns earned LENS into LXC and Lens has no path back — the surface says so itself. Every other
 * figure on that card is on the face: the rate and the minimum (`0292cf0` put them there), and the
 * `Costs <MuNumeral>` line one row below the field. The amount you type — the number the
 * irreversible decision is ABOUT — is the body sans.
 *
 * ⚠ MEASURED IN A REAL ENGINE, not reasoned about (Chrome 151, the SHIPPED stylesheet
 * `dist/assets/index-*.css`, computed style on the exact markup `Input.tsx` emits):
 *
 *     ConvertLens's field as it ships   "Space Grotesk", ui-sans-serif, …   font-feature-settings: normal
 *     `font-figure` on an ANCESTOR      "IBM Plex Mono", ui-monospace, …    font-feature-settings: "tnum"
 *     `font-figure` on the ELEMENT      "IBM Plex Mono", ui-monospace, …    font-feature-settings: "tnum"
 *
 * ⚠ THAT MIDDLE ROW IS WHY THIS AUDIT REUSES `onFigureFace` RATHER THAN COPYING placeholderAudit.
 * The two rules look alike and their inheritance answers are OPPOSITE, for reasons that are facts
 * about CSS rather than choices:
 *
 *   · `placeholder:text-faint` compiles to `.placeholder\:text-faint::placeholder{…}`, which
 *     matches nothing but that element's own pseudo-element — so placeholderAudit MUST read the
 *     element's own class, and walking up would report a green the browser does not paint.
 *   · A field's VALUE is painted with `font-family`, and Tailwind's preflight sets
 *     `button,input,optgroup,select,textarea{font-family:inherit;font-feature-settings:inherit;…}`
 *     — read out of the shipped sheet, not assumed — so an ancestor's `font-figure` DOES reach it,
 *     tnum included. The walk-up is correct here and pinned by the fixture above.
 *
 * `.text-body` sets `font-size`/`line-height`/`font-weight` and NO family, so the class the field
 * already carries is not what puts it in the sans: it inherits `body{font-family:var(--sans)}`.
 *
 * ── THE PREDICATE IS THE DECLARATION, NOT THE VALUE, AND THAT IS TRAP TWO'S OWN ARGUMENT ─────
 *
 * The obvious rule is figureAudit's: is what is IN the field a figure and nothing else. Measured
 * above, that rule and this one agree on this tree — so it would cost nothing today. It is still
 * the wrong rule, for the reason figureAudit already gives about prose:
 *
 *     A user who types `42` as an ISSUE TITLE has not rendered a figure. The PRODUCT did not put a
 *     numeral alone in that box; a person did, and next time they will type "Ship the trial".
 *
 * figureAudit polices an element whose own text is a figure because the PRODUCT chose to put it
 * there. A field's contents are not the product's choice, so the product's declaration is what
 * this reads: `type="number"`, or an `inputMode` of `numeric`/`decimal`. That is a promise the
 * source makes about what the box is FOR, and it is the promise ConvertLens already makes.
 *
 * ⚠ AND IT IS READ FROM THE DOM, not from the source, for the reason focusAudit and
 * placeholderAudit both give: `ConvertLens.tsx:289` writes `inputMode` on `<Input>`, a component
 * in ANOTHER PACKAGE that spreads it onto the real `<input>` — so the declaration and the class
 * list are written in two files, and the DOM is where they meet.
 *
 * ⚠ TWO INPUT TYPES ARE EXEMPT AND THE REASON IS THAT THEY PAINT NO TEXT. `range` is a slider and
 * `hidden` is not rendered; demanding a typeface for a numeral nobody can see is a rule that would
 * be satisfied by a class with no effect.
 *
 * ⚠⚠ AND THE EXEMPTION IS DEFENSIVE RATHER THAN LIVE — A CONTROL CORRECTED THIS SENTENCE. It first
 * said "Landing's contributor slider is the live instance". It is not. That slider declares NO
 * `inputMode`, so it never reaches `PAINTS_NO_TEXT` at all: it is excluded one line lower, by not
 * declaring itself numeric. MEASURED — C3 deletes the exemption line and the slider's unit case
 * stays GREEN; the only case that reds is `hidden`, a different entry. The set is reached only by
 * a field that declares BOTH (`type="range" inputmode="decimal"`), which nothing in this product
 * does. Both entries stay, because the day something does declare both the rule should already be
 * right — but the test that pins them now says which one is doing the work, and the sentence no
 * longer claims a live instance it does not have.
 *
 * What IS live and IS measured is the slider itself: its value is a figure, it is not on the face,
 * and that is correct. That is a fact about the census, not about this set.
 *
 * ── WHAT THIS DOES NOT CATCH, MEASURED RATHER THAN REASONED ABOUT ─────────────────────────────
 *
 * A numeric field that declares NOTHING — `type="text"` with no `inputMode` — is invisible to this
 * rule, and there is no instrument in this repo that would see it. Today there are none: the probe
 * above found exactly one text field holding a figure and it is the declared one. That is a
 * measurement of this tree, not a property of the rule, and whoever adds the second numeric field
 * should declare it — which they want to do anyway, since `inputMode` is what gives a phone the
 * number pad.
 */

/** The classes and the walk are figureAudit's. One face, one predicate, one set of controls. */
import { onFigureFace } from './figureAudit'

/**
 * Input types that paint no text, so no typeface applies. See the exemption note above.
 * ⚠ `range` is not hypothetical: Landing.tsx:320 renders one and its value is a figure.
 *
 * ⚠⚠ `hidden` IS SPELLED IN TWO PIECES AND THAT IS NOT AN AFFECTATION — IT IS A DEFECT THIS FILE
 * SHIPPED AND THEN MEASURED ON ITSELF. `hidden` is also a Tailwind utility, and Tailwind's
 * extractor reads RAW TEXT: written plainly, this line compiled `.hidden{display:none}` into the
 * production stylesheet for an element that does not exist. Measured on the built artifact —
 * `dist/assets/index-*.css` went 22,420 → 22,441 bytes and 308 → 309 class names, and the diff of
 * the emitted name sets was exactly one entry, `hidden`.
 *
 * ⚠ AND THE GUARD THAT EXISTS FOR THIS FAILURE CANNOT SEE IT, which is the transferable part.
 * `proseClasses.test.ts` catches a class supplied by a SENTENCE, by generating the sheet twice and
 * diffing raw against comment-stripped. This one came from a STRING LITERAL in ordinary source —
 * which `stripComments` deliberately PROTECTS, because a string literal is where real class lists
 * live (`className="text-body text-ink"`). So both generations contain it, the diff is empty and
 * the guard is green. That hole is real, it is now non-empty for the first time, and it is NOT
 * closed here: telling a class list from a data string is the same problem deadClasses.test.ts's
 * rule B already wrestles with, and guessing at it on a stylesheet is not a session's call.
 *
 * MEASURED, all four through the real generator over a raw source string:
 *     new Set(['range', 'hidden'])              emits ["hidden"]   ← what this line was
 *     /^(range|hidden)$/                        emits ["hidden"]
 *     'range hidden'.split(' ')                 emits ["hidden"]
 *     new Set(['range', `hid${'den'}`])         emits []           ← what it is
 * The plain form is kept above as the control: it is what proves the other three are not passing
 * because the probe read nothing.
 */
const PAINTS_NO_TEXT = new Set(['range', `hid${'den'}`])

/** `inputMode` values that declare the box is for numerals. */
const NUMERIC_MODES = new Set(['numeric', 'decimal'])

export interface UnfacedField {
  /** what the field says it is for, e.g. `inputmode="decimal"` — the declaration that made it numeric */
  declaredBy: string
  /** the value at the moment it was audited, so the failure names something a reader can find */
  value: string
  /** the element's own class attribute, which is what a fix would change */
  className: string
  /** the accessible name, which is how a reader locates the field on screen */
  label: string
  tag: string
}

/** Does this element declare that it holds numerals? */
export function declaresNumeric(el: Element): boolean {
  if (el.tagName !== 'INPUT') return false
  const type = (el.getAttribute('type') ?? 'text').toLowerCase()
  if (PAINTS_NO_TEXT.has(type)) return false
  if (type === 'number') return true
  return NUMERIC_MODES.has((el.getAttribute('inputmode') ?? '').toLowerCase())
}

/** Every field under `root` that declares itself numeric and is not on the figure face. */
export function unfacedFieldsIn(root: ParentNode): UnfacedField[] {
  const out: UnfacedField[] = []
  for (const el of Array.from(root.querySelectorAll('input'))) {
    if (!declaresNumeric(el)) continue
    if (onFigureFace(el)) continue
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    out.push({
      declaredBy: type === 'number' ? 'type="number"' : `inputmode="${el.getAttribute('inputmode')}"`,
      value: (el as HTMLInputElement).value ?? '',
      className: el.getAttribute('class') ?? '',
      label: el.getAttribute('aria-label') ?? '',
      tag: el.tagName.toLowerCase(),
    })
  }
  return out
}

// ── THE RUNNING AUDIT ────────────────────────────────────────────────────────────────────────
//
// Capture is at COMMIT TIME through a MutationObserver for the reason figureAudit.ts records in
// full: Testing Library's cleanup is registered after this setup file and vitest runs `afterEach`
// last-registered-first, so an `afterEach` DOM scan reads an EMPTY BODY and reports every surface
// clean.
//
// ⚠ IT OBSERVES `attributes` FOR THE SAME REASON placeholderAudit DOES, and the filter is the set
// of attributes that can change this answer: a field that gains `inputMode` in place, or an
// ancestor that gains `font-figure`, is a mutation `childList` does not deliver.
//
// ⚠ `value` IS NOT IN THAT FILTER AND CANNOT BE. React sets it as a PROPERTY, which fires no
// mutation record at all — the very fact this audit exists for. The value is read at scan time and
// is REPORTING ONLY: the predicate never consults it, so a field typed into between mutations is
// still audited on the next scan, and the offender is the same offender whether the box is empty
// or full.

const records = new Map<string, number>()
let offenders: UnfacedField[] = []
const seen = new Set<string>()
let currentFile = ''

function scan(): void {
  // ⚠ THE FLOOR COUNTS EVERY NUMERIC FIELD RENDERED, not just the offenders — otherwise a file
  // whose fields are all correct satisfies nothing, and "everything here is fine" and "the
  // observer is dead" become the same observation. placeholderAudit.ts makes the same argument.
  for (const el of Array.from(document.body.querySelectorAll('input'))) {
    if (!declaresNumeric(el)) continue
    records.set(currentFile, (records.get(currentFile) ?? 0) + 1)
    break
  }
  for (const f of unfacedFieldsIn(document.body)) {
    const key = `${f.tag}|${f.declaredBy}|${f.className}|${f.label}`
    if (seen.has(key)) continue
    seen.add(key)
    offenders.push(f)
  }
}

/** Start recording. Called once per test file, from each project's setup. */
export function installFieldFaceAudit(): void {
  new MutationObserver(scan).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['inputmode', 'type', 'class'],
  })
}

/** Which test file is running, so the floor can be read per file. */
export function setFieldFaceAuditFile(file: string): void {
  currentFile = file
}

/** The off-face numeric fields seen since the last call, and clears them. */
export function takeFieldFaceOffenders(): UnfacedField[] {
  const out = offenders
  offenders = []
  return out
}

/**
 * THE FLOOR — the files that must have audited a numeric field, and what each renders.
 *
 * ⚠ IT ASKS FOR A NUMERIC FIELD, NOT FOR AN OFFENDER. A rule whose only output is a list of
 * offenders passes perfectly when it sees nothing at all — a dead observer, a fixture that stopped
 * opening the convert dialog, a predicate blinded to `inputMode`. Silence is this rule's correct
 * output when the product is clean, which is exactly the state a dead observer is indistinguishable
 * from.
 *
 * ⚠ KEYED BY THE PATH VITEST REPORTS (`src/areas/lens/Convert.test.tsx`), NOT BY BASENAME. #101's
 * C3 found MUST_AUDIT_MONO_TEXT keyed by basename against a full-path lookup: every entry returned
 * undefined and the floor had never fired once. These two keys are the ones the probe OBSERVED
 * vitest report, copied from its output rather than written from the file tree.
 *
 * ⚠ AND WHAT A FLOOR CANNOT DO IS ASK FOR A SPECIFIC FIELD — `0292cf0` and placeholderAudit both
 * record the same shape. Both files below audit the SAME field, so either one losing its fixture
 * leaves the other satisfying this table alone. The catcher for that is the surface test that
 * asserts the field, not this list.
 */
export const MUST_AUDIT_A_NUMERIC_FIELD: Record<string, string> = {
  'src/areas/lens/Convert.test.tsx': 'the LXC amount field — the number the irreversible conversion is about',
  'src/areas/lens/Held.test.tsx': 'the same amount field, under a second fixture with held funds',
}

/** Did this file audit at least one numeric field? */
export function satisfiesFieldFaceFloor(file: string): boolean {
  return (records.get(file) ?? 0) > 0
}

/** How many scans saw a numeric field in this file. Exported for this audit's own tests. */
export function auditedNumericFields(file: string): number {
  return records.get(file) ?? 0
}
