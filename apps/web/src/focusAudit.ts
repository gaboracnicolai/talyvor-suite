/**
 * THE FOCUS AUDIT — the accent is the product's focus signal, and it must be the ONLY one.
 *
 * packages/ui/src/lib/focus.ts writes the rule down and hands enforcement to nobody:
 *
 *     The quality-floor focus ring: a 2px accent outline at 2px offset, only on
 *     keyboard focus (focus-visible). Applied to every interactive element.
 *
 * "Applied to every interactive element" is a claim about the PRODUCT made in a file that can
 * only describe a STRING. Six design-system components import it. Nine hand-rolled controls did
 * not, and nothing anywhere was red — the #93/#97/#99 shape a fourth time: the file that states
 * the rule is the one file that cannot enforce it.
 *
 * ── WHAT IT COSTS, MEASURED IN A REAL ENGINE RATHER THAN REASONED ABOUT ──────────────────────
 *
 * Chrome 151, the real built stylesheet, each control given keyboard focus and its COMPUTED
 * outline read (`:focus-visible` confirmed matching in every row):
 *
 *     system ring        solid 2px  rgb(58,214,192)   offset 2px   ← --accent, dark theme
 *     hand-rolled Row    solid 1px  rgb(58,214,192)   offset 0     ← right hue, half the width
 *     bare control       auto  1px  rgb(153,200,255)  offset 0     ← CHROME'S BLUE
 *
 * and in the light theme the bare control is `rgb(0,95,204)`, against an accent of #0F7A6C.
 * Measured identically for textarea, text input, select, range and button.
 *
 * So this is not "a missing nicety". A design language whose stated premise is ONE electric
 * accent painted the BROWSER'S BLUE on nine controls, in both themes — a second focus hue in a
 * system that declares one, on exactly the surfaces a keyboard user moves through. The controls
 * are not invisible (measured: zero elements carry `outline-none` without a replacement, so
 * nothing was made unfocusable); they are wearing a colour that is not in the palette.
 *
 * ── WHY IT READS THE DOM AND NOT THE SOURCE ──────────────────────────────────────────────────
 *
 * `Button` accepts `asChild` and renders through Radix `Slot`, which MERGES its className onto
 * its child — thirteen call sites do `<Button asChild><Link …/></Button>`. The resulting <a>
 * carries the full ring while the source element that produced it (`<Link to=…>`) has no
 * className at all. A rule that read class attributes would report every one of those anchors as
 * unringed and would have to grow an exemption for the component it is supposed to be checking.
 * The class and the element meet in the DOM and nowhere else — the same argument caseAudit.ts
 * makes for an inherited `text-transform`.
 *
 * ── THE EXEMPTION, NARROW AND PINNED ─────────────────────────────────────────────────────────
 *
 * An UNDERLINED <a> is a link in a run of prose, not a control, and the UA ring on it is a
 * deliberate recorded choice rather than an oversight: measured, 76 of the 184 focusable
 * elements this suite renders are underlined text links, and giving all 76 a 2px offset outline
 * is a design conversation about how prose looks, not a defect being fixed. focus.ts's sentence
 * has been corrected to say what is actually covered, because a comment that overstates its
 * reach is the thing this repo keeps catching.
 *
 * ⚠ THE EXEMPTION IS A SHAPE, NOT A TAG. An <a> that is NOT underlined is a link wearing
 * control clothing — a tile, a card, a button-shaped thing — and it is NOT exempt. That is the
 * half that keeps the carve-out from quietly widening into "anchors do not need focus rings".
 */

/**
 * The system ring, spelled out.
 *
 * ⚠ THESE ARE LITERALS AND NOT AN IMPORT OF `focusRing`, DELIBERATELY. A guard that reads the
 * constant it is checking compares the constant to itself and passes for every value it could
 * ever hold. focusAudit.test.tsx parses `focus.ts` and requires this list to match it token for
 * token, both directions — so changing the ring in one place and not the other is red, and the
 * two can only agree by actually agreeing.
 *
 * ⚠ SPELLING THEM HERE SHIPS NO NEW CSS: all five already reach the sheet from focus.ts, which
 * is in the same content set. Measured before and after — the emitted class set is unchanged.
 */
export const FOCUS_RING_CLASSES = [
  'outline-none',
  'focus-visible:outline',
  'focus-visible:outline-2',
  'focus-visible:outline-offset-2',
  'focus-visible:outline-accent',
] as const

/** Underline utilities. An <a> carrying one of these is prose, not a control. */
export const UNDERLINE_CLASSES = ['underline', 'hover:underline'] as const

/**
 * Elements that take keyboard focus. `[tabindex]` is included because this product builds a
 * focusable row out of a <div> (SpaceList's space row: role="link", tabIndex 0, its own key
 * handler) — a control the tag name alone cannot find.
 */
const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]'

export interface FocusOffender {
  tag: string
  /** `type` for inputs — a range slider and a text field fail for the same reason but read differently. */
  type: string
  className: string
  /** Trimmed own-or-descendant text, enough to name the control in the failure message. */
  text: string
  /** Which of the five ring classes it does carry, if any — a partial ring is its own defect. */
  present: string[]
}

function classesOf(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

/**
 * Can a keyboard reach this element? A disabled control and a `tabindex="-1"` element are
 * removed from the tab order, so a missing ring on either is not a defect a user can meet.
 */
export function isKeyboardFocusable(el: Element): boolean {
  if (!el.matches(FOCUSABLE_SELECTOR)) return false
  if (el.hasAttribute('disabled')) return false
  if ((el.getAttribute('tabindex') ?? '') === '-1') return false
  return true
}

/** Does this element carry the WHOLE system ring? A partial ring is not the ring. */
export function carriesFocusRing(el: Element): boolean {
  const cs = classesOf(el)
  return FOCUS_RING_CLASSES.every((c) => cs.includes(c))
}

/** An underlined <a> — a link in prose, exempt with its reason recorded above. */
export function isProseLink(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'a') return false
  const cs = classesOf(el)
  return UNDERLINE_CLASSES.some((c) => cs.includes(c))
}

/** Every keyboard-reachable element under `root` that does not wear the accent on focus. */
export function focusOffendersIn(root: ParentNode): FocusOffender[] {
  const out: FocusOffender[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!isKeyboardFocusable(el)) continue
    if (carriesFocusRing(el)) continue
    if (isProseLink(el)) continue
    const cs = classesOf(el)
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') ?? '',
      className: el.getAttribute('class') ?? '',
      text: (el.textContent ?? '').trim().slice(0, 60),
      present: FOCUS_RING_CLASSES.filter((c) => cs.includes(c)),
    })
  }
  return out
}

// ── THE RUNNING AUDIT ────────────────────────────────────────────────────────────────────────
//
// ⚠ CAPTURE IS AT COMMIT TIME, for the reason figureAudit.ts records and caseAudit.ts repeats:
// Testing Library's auto-cleanup is registered when the TEST FILE imports it — after this setup
// file — and vitest runs `afterEach` last-registered-first, so a setup-file `afterEach` scans an
// EMPTY body and reports every surface clean.
//
// ⚠ AND THE MICROTASK LIMIT IS INHERITED WHOLE: a control rendered and replaced inside one
// synchronous block is never sampled, so a test that steps through states must yield between
// them. Landing's stepper is exactly that shape and its test already yields for caseAudit.

const records: FocusOffender[] = []
const ringSightings: { file: string; ringed: number }[] = []
let offenders: FocusOffender[] = []
let currentFile = ''

/**
 * The floor's own counter, and it is DELIBERATELY NOT `carriesFocusRing`.
 *
 * A floor exists to catch the audit going blind, so it must not be computed by the thing that
 * could be blind. `carriesFocusRing` returning true for everything silences every offender —
 * and would ALSO satisfy a floor that asked it "how many are ringed". This asks a dumber
 * question of the raw attribute instead: two implementations, one vocabulary, the shape #99
 * used for the casing rule.
 */
function ringedByRawAttribute(root: ParentNode): number {
  let n = 0
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const raw = el.getAttribute('class') ?? ''
    if (raw.includes('focus-visible:outline-accent')) n++
  }
  return n
}

function scan(): void {
  for (const o of focusOffendersIn(document.body)) {
    const key = `${o.tag}|${o.type}|${o.className}|${o.text}`
    if (records.some((r) => `${r.tag}|${r.type}|${r.className}|${r.text}` === key)) continue
    records.push(o)
    offenders.push(o)
  }
  const ringed = ringedByRawAttribute(document.body)
  if (ringed > 0) ringSightings.push({ file: currentFile, ringed })
}

/** Start recording. Called once per test file, from test-setup.ts. */
export function installFocusAudit(): void {
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })
}

export function setFocusAuditFile(file: string): void {
  currentFile = file
}

export function auditedFocusOffenders(): readonly FocusOffender[] {
  return records
}

/** The offenders seen since the last call, and clears them. */
export function takeFocusOffenders(): FocusOffender[] {
  const out = offenders
  offenders = []
  return out
}

/**
 * Test files that MUST render at least one element wearing the system ring.
 *
 * ⚠ A FLOOR ASKS "DID THIS FILE RENDER ONE OF THESE", NEVER "DID IT RENDER THIS ONE" — the
 * lesson `0292cf0` paid for. So this cannot check that a PARTICULAR control kept its ring; the
 * offender rule does that.
 *
 * ⚠ AND IT CATCHES LESS THAN I FIRST WROTE DOWN — corrected by control C6, not by review. What
 * this floor sees is the RECORD going empty: a dead observer, or a fixture that stopped
 * rendering. It does NOT see `isKeyboardFocusable` blinded, because `ringedByRawAttribute` never
 * asks that predicate — the independence that makes it a floor is the same independence that
 * makes it blind here. That edit is caught by this file's direct unit tests instead, and
 * `focusRing` leaving the design system is caught by the offender rule before any floor runs.
 * Three defects, three different catchers, each observed red rather than assumed.
 *
 * A floor, not a census: a new surface is audited the moment its test renders it, listed or not.
 */
export const MUST_RENDER_FOCUS_RING: Record<string, string> = {
  'src/areas/docs/DocsArea.test.tsx': 'the space rows, the create-space field and the page editor',
  'src/areas/track/IssueList.test.tsx': 'the new-issue field and the per-row status select',
  'src/areas/track/IssueDetail.test.tsx': 'the description editor and its save/cancel buttons',
  'src/areas/marketing/Landing.test.tsx': 'the public page: the worked-hit stepper and the pool slider',
  'src/areas/lens/TopUp.test.tsx': 'the buy buttons — pressed immediately before spending money',
  'src/areas/lens/Keys.test.tsx': 'the mint and revoke controls',
  'src/areas/auth/Entry.test.tsx': 'the way in: the sign-in and sign-up actions',
}

/** Did this file render at least one ringed element? */
export function satisfiesFocusFloor(file: string): boolean {
  return ringSightings.some((s) => s.file === file && s.ringed > 0)
}
