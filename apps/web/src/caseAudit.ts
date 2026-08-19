/**
 * THE CASE AUDIT — a casing transform must not REPLACE a character it was only asked to re-case.
 *
 * preset.ts §THE EYEBROW writes this rule down and then hands enforcement to nobody:
 *
 *     ⚠ THE UPPERCASE IS NOT IN HERE, deliberately. `text-transform: uppercase` maps
 *     µ (U+00B5) to Greek capital Mu, and µLENS/µLXC sit inside these labels. It is applied
 *     at the call site, where MuNumeral can keep its µ in a `normal-case` span.
 *
 * "It is applied at the call site" is true and is the whole problem: 24 uppercase class lists in
 * the two packages apply it, against exactly ONE `normal-case` in the product (CaseSafe.tsx:85).
 * The rule was stated in the token that deliberately does NOT carry the transform, so the one
 * file that could not enforce it is the only file that documents it.
 *
 * ── WHAT IT COSTS, MEASURED IN A REAL ENGINE RATHER THAN REASONED ABOUT ──────────────────────
 *
 * Chrome 151, `text-transform: uppercase` over source `µLXC`, in a proportional face, measured by
 * the width of the text run and confirmed by screenshot:
 *
 *     uppercase, source µLXC              184.531px   renders MLXC
 *     no transform, source µLXC           162.250px   renders µLXC
 *     no transform, source ΜLXC (U+039C)  184.531px   renders MLXC   ← byte-identical to the first
 *     uppercase, µ in a normal-case span  162.250px   renders µLXC   ← the fix
 *     uppercase, source lxc               (LXC)                      ← the transform IS live
 *
 * So the shipped page does not render a stylised µ. It renders a DIFFERENT CHARACTER: U+039C
 * GREEK CAPITAL MU, which on a page quoting ledger amounts reads as the SI prefix `M`. µLXC is
 * 1e-6 LXC; MLXC reads as 1e+6 LXC. The public marketing page renders its four measured ledger
 * figures — the ones whose whole purpose is to be checkable against the ledger — labelled twelve
 * orders of magnitude away from the unit they are in.
 *
 * ⚠ AND textContent CANNOT SEE IT. `text-transform` is a paint-time transform; the DOM keeps the
 * source string. Measured above: the uppercase node's `textContent` is still "µLXC". So every
 * existing assertion in this suite that matches on text — `getByText('µLXC list')` and the whole
 * `MUST_RENDER_*` family — passes over this defect and always would have. That is why this rule
 * reads CLASSES and applies the transform itself, and it is the reason a rendered-text audit could
 * not have found it.
 *
 * ── WHY IT IS NOT A SOURCE RULE ──────────────────────────────────────────────────────────────
 *
 * The `uppercase` and the µ are in different places and neither knows about the other.
 * Landing.tsx:79 is `<span className="font-figure text-eyebrow uppercase text-faint">`, and line 80
 * hands its {unit} to CaseSafe — no µ near either. The µ arrives as a PROP from six call sites
 * (`unit="µLXC list"`, `"µLXC charged"`, `"µLXC saved"`, `"µLENS earned"`, `"µLXC you pay"`,
 * `"µLXC kept"`). No grep for "µ near uppercase" connects a prop to the class list that will
 * inherit onto it, and `text-transform` INHERITS, so the answer also depends on which ancestor is
 * nearest. The DOM is where the class and the character finally meet.
 *
 * ── THE PREDICATE, AND WHY IT IS NOT "uppercase IS BAD" ──────────────────────────────────────
 *
 * `uppercase` on `lxc` is correct and intended; the eyebrow exists to do exactly that. So the rule
 * cannot be "the transform changed the text". It is: the transform REPLACED a character instead of
 * re-casing it — the mapping does not round-trip, or produces more than one character:
 *
 *     replaces(c) := up(c) !== c  AND  ( up(c).length !== 1  OR  low(up(c)) !== c )
 *
 * Verified against the characters this product actually renders — a z A Z 0 9 $ % ≈ . , - _ /
 * space é ü Μ μ L X C are all SAFE — and against the known-lossy set: µ→Μ, ß→SS, ﬁ→FI, ŉ→ʼN,
 * ı→I, ς→Σ, ΐ→Ϊ́. 117 characters in U+0020..U+2FFF are lossy under uppercase; the rule needs no
 * list of them because it computes the answer.
 *
 * ⚠ THE ONE HOLE, STATED RATHER THAN LEFT IMPLIED: `μ` U+03BC (GREEK SMALL LETTER MU) uppercases
 * to Μ U+039C and BACK to μ, so it round-trips and this predicate calls it safe — correctly, since
 * flagging it would flag Greek prose. A µ typed as U+03BC would therefore be uppercased with no
 * offender reported. That hole is closed from the other side by a named case in caseAudit.test.tsx:
 * the product may not render U+03BC at all. Measured: it renders none today, and the two characters
 * are also silently unequal to every `getByText`, so mixing them is its own defect.
 */

/**
 * The casing utilities this product uses, and what each sets `text-transform` to.
 *
 * ⚠ TAILWIND SHIPS FOUR CASING UTILITIES AND THIS MAP HAS TWO, WHICH IS A MEASURED REFUSAL RATHER
 * THAN AN OMISSION. The first version listed all four — and Tailwind's extractor reads RAW TEXT from
 * every non-test file in the content set, of which this is one, so merely SPELLING the other two
 * compiled them into the shipped stylesheet as real rules with nothing in the product rendering
 * either. Measured against a clean worktree at `dc0bd07`: 344 → 346 emitted class names, +74 bytes.
 * That is W1.8 — the open item about a sheet carrying classes that exist only because prose mentions
 * them — so this merge would have added two instances of the defect it was not fixing.
 *
 * ⚠ WHICH IS WHY THE OTHER TWO ARE NOT NAMED ANYWHERE IN THIS FILE, NOT EVEN HERE. The second
 * attempt removed them from the map and left them in this comment, and the sheet still carried both:
 * the extractor cannot tell a class from a sentence about a class, which is W1.8's whole argument and
 * preset.ts's own opening sentence is its sharpest instance. Naming them costs nothing in a
 * `.test.tsx` file, which the content globs exclude, so THE NAMES, THE MEASUREMENT AND THE µ
 * CONSEQUENCE OF EACH LIVE IN caseAudit.test.tsx §"the casing vocabulary, both directions" — which
 * also REFUSES them: either appearing in a class list in either package fails until somebody
 * classifies it here, so narrowing this map cannot silently under-report.
 *
 * `uppercase` (24 class lists apply it) and `normal-case` (1) are spelled out because the product
 * renders both — CLASS LISTS, not occurrences of the word; the census is in caseCallSites.test.ts,
 * which also records why this sentence and the one at the top of this file used to disagree.
 */
export const TRANSFORM_CLASSES = {
  uppercase: 'uppercase',
  'normal-case': 'none',
} as const

export type Transform = (typeof TRANSFORM_CLASSES)[keyof typeof TRANSFORM_CLASSES]

export interface CaseOffender {
  /** The character the transform would replace, e.g. "µ". */
  char: string
  /** Its codepoint, e.g. "U+00B5" — the message must name it, since µ and μ look identical. */
  codePoint: string
  /** What the transform turns it into, e.g. "Μ". */
  becomes: string
  /** The transform in effect on it. */
  transform: Transform
  /** The own-text of the element carrying the character. */
  text: string
  tag: string
  className: string
  /** The class list of the element the transform was inherited FROM. */
  fromClassName: string
}

export function codePointOf(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
}

/** The casing transform this one element DECLARES, or null if it declares none. */
export function declaredTransformOn(el: Element): Transform | null {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/)
  for (const [cls, transform] of Object.entries(TRANSFORM_CLASSES)) {
    if (classes.includes(cls)) return transform as Transform
  }
  return null
}

/**
 * The transform in effect on `el`: the NEAREST ancestor-or-self that declares one wins, because
 * `text-transform` inherits and a closer declaration overrides a farther one. This is what makes
 * MuNumeral correct — its `normal-case` span sits INSIDE the `uppercase` label — and it is the half
 * a source rule cannot answer.
 */
export function transformInEffect(el: Element | null): { transform: Transform; from: Element | null } {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const declared = declaredTransformOn(e)
    if (declared !== null) return { transform: declared, from: e }
  }
  return { transform: 'none', from: null }
}

/** What a transform does to one character. */
function mapChar(ch: string, transform: Transform): string {
  return transform === 'uppercase' ? ch.toUpperCase() : ch
}

/**
 * Does this transform REPLACE `ch` rather than re-case it? A clean re-casing maps to exactly one
 * character and maps back. Anything else substitutes a different character for it.
 */
export function replacesCharacter(ch: string, transform: Transform = 'uppercase'): boolean {
  const mapped = mapChar(ch, transform)
  if (mapped === ch) return false
  if (mapped.length !== 1) return true
  return mapped.toLowerCase() !== ch
}

/** An element's OWN text — its direct text children only, the smallest unit that carries a class. */
export function ownText(el: Element): string {
  let s = ''
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 /* TEXT_NODE */) s += n.nodeValue ?? ''
  return s
}

/** Every character in `text` that `transform` would replace. */
export function replacedIn(text: string, transform: Transform): string[] {
  return Array.from(text).filter((ch) => replacesCharacter(ch, transform))
}

/** Every character under `root` that the transform in effect on it would replace. */
export function caseOffendersIn(root: ParentNode): CaseOffender[] {
  const out: CaseOffender[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const text = ownText(el)
    if (text === '') continue
    const { transform, from } = transformInEffect(el)
    if (transform === 'none') continue
    for (const ch of replacedIn(text, transform)) {
      out.push({
        char: ch,
        codePoint: codePointOf(ch),
        becomes: mapChar(ch, transform),
        transform,
        text: text.trim(),
        tag: el.tagName.toLowerCase(),
        className: el.getAttribute('class') ?? '',
        fromClassName: from?.getAttribute('class') ?? '',
      })
    }
  }
  return out
}

/**
 * Is `ch`, rendered on `el`, PROTECTED — meaning the mechanism this audit is about is doing work?
 *
 * ⚠ "A casing transform is in effect and left it alone" IS NOT ENOUGH, and the first version of
 * this function got it wrong in the direction that matters. `text-transform: none` is what
 * `normal-case` sets AND what a µ in ordinary prose has, so a predicate that only asked "does the
 * effective transform replace it" counted every µ in every paragraph as protected — which would
 * have made MUST_PROTECT_MICRO_SIGN satisfiable with this whole audit switched off, since most µ in
 * this product are prose. Caught by the test that exists to ask exactly that.
 *
 * So protection requires BOTH halves: the nearest declaration to the character does not replace it,
 * AND the nearest declaration ABOVE that one would have. A `normal-case` with no `uppercase` over
 * it is not protecting anything; it is decoration.
 */
export function isProtectedCharacter(el: Element, ch: string): boolean {
  const { transform, from } = transformInEffect(el)
  if (replacesCharacter(ch, transform)) return false // an offender, not a protection
  if (!from) return false // nothing declared anywhere: untouched prose
  for (let e: Element | null = from.parentElement; e; e = e.parentElement) {
    const declared = declaredTransformOn(e)
    if (declared === null) continue
    return replacesCharacter(ch, declared) // the threat the nearest override is answering
  }
  return false
}

/** Every occurrence of `ch` under `root` that a hazardous transform was overridden to protect. */
export function protectedCharactersIn(root: ParentNode, ch: string): number {
  let n = 0
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const text = ownText(el)
    if (!text.includes(ch)) continue
    if (isProtectedCharacter(el, ch)) n += text.split(ch).length - 1
  }
  return n
}

// ── THE RUNNING AUDIT ────────────────────────────────────────────────────────────────────────
//
// ⚠ CAPTURE IS AT COMMIT TIME, for the reason figureAudit.ts records at length and this file must
// not re-learn: Testing Library's auto-cleanup is registered when the TEST FILE imports it, after
// this setup file, and vitest runs `afterEach` hooks last-registered-first — so a setup-file
// `afterEach` scans an EMPTY body and reports every surface clean. caseAudit.test.tsx pins that
// the record survives into the next test with the body verifiably empty.
//
// ⚠ AND A LIMIT OF THAT MECHANISM, MEASURED HERE RATHER THAN DISCOVERED LATER: a MutationObserver
// callback is a MICROTASK, so a state this product renders and REPLACES inside one synchronous
// block is never sampled. Landing's worked-hit stepper is exactly that shape. Clicking its four
// beats synchronously, with the fix reverted, the audit named FOUR offenders — beats 2 and 3
// mounted and unmounted between checkpoints and `µLXC charged` and `µLXC saved` were invisible.
// Yielding once per step (`await new Promise(r => setTimeout(r, 0))`) makes it six. So a test that
// STEPS THROUGH STATES must yield between them or this audit sees only the last one; the count is
// recorded in Landing.test.tsx beside the loop, because "4 not 6" is the only way to notice.

const records: CaseOffender[] = []
const microSightings: { file: string; protected: number }[] = []
let offenders: CaseOffender[] = []
let currentFile = ''

/** The micro sign this product uses. U+00B5, never U+03BC — see the hole stated above. */
export const MICRO_SIGN = 'µ'

function scan(): void {
  for (const o of caseOffendersIn(document.body)) {
    const key = `${o.codePoint}|${o.transform}|${o.tag}|${o.className}|${o.text}`
    if (records.some((r) => `${r.codePoint}|${r.transform}|${r.tag}|${r.className}|${r.text}` === key)) continue
    records.push(o)
    offenders.push(o)
  }
  const safe = protectedCharactersIn(document.body, MICRO_SIGN)
  if (safe > 0) microSightings.push({ file: currentFile, protected: safe })
}

/** Start recording. Called once per test file, from test-setup.ts. */
export function installCaseAudit(): void {
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })
}

/** Told which file is running, so the floor can name it. */
export function setCaseAuditFile(file: string): void {
  currentFile = file
}

export function auditedCaseOffenders(): readonly CaseOffender[] {
  return records
}

/** Files in which at least one µ was rendered with a casing transform that left it intact. */
export function microSignSightings(): readonly { file: string; protected: number }[] {
  return microSightings
}

/** The offenders seen since the last call, and clears them. */
export function takeCaseOffenders(): CaseOffender[] {
  const out = offenders
  offenders = []
  return out
}

/**
 * Test files that MUST render at least one µ that a casing transform is in effect on and leaves
 * intact — the FLOOR, and it is a floor about the PROTECTED case rather than merely about µ.
 *
 * ⚠ THAT DISTINCTION IS THE WHOLE VALUE OF THE TABLE and was measured, not assumed. "This file
 * rendered a µ" is satisfied by a µ sitting in ordinary body text with no transform anywhere near
 * it — which is most of them — so it would stay green if `transformInEffect` were blinded to
 * return 'none', the single edit that switches this entire audit off. Asking instead for a µ under
 * a LIVE casing transform that did not replace it means the floor can only be met by the mechanism
 * the rule is about: MuNumeral's `normal-case` span inside its `uppercase` unit label.
 *
 * A floor, not a census: a new surface is audited the moment its test renders it, listed or not.
 */
export const MUST_PROTECT_MICRO_SIGN: Record<string, string> = {
  'src/areas/lens/Ledger.test.tsx': 'every µLENS and µLXC row amount is a MuNumeral unit label',
  'src/areas/lens/Overview.test.tsx': 'the LXC and LENS balance cards render MuNumeral unit labels',
  'src/areas/lens/Held.test.tsx': 'the held µLENS amount, under its own fixture',
  'src/areas/lens/spendHolds.test.tsx': 'Spend with holds — MuNumeral over a second fixture',
}

/** Does this file's record satisfy the floor? */
export function satisfiesMicroFloor(file: string): boolean {
  return microSightings.some((s) => s.file === file && s.protected > 0)
}
