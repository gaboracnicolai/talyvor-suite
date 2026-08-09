/**
 * THE RENDERED-PLACEHOLDER AUDIT — the one text in the product that is painted by the browser.
 *
 * `Input.tsx` declares `placeholder:text-faint`. Nothing has ever asked whether a field that is
 * NOT an `<Input>` declares anything, and the answer is that a bare `<input placeholder="…">`
 * gets its placeholder from the USER AGENT.
 *
 * ⚠ MEASURED IN A REAL ENGINE, not reasoned about (Chrome 151, computed `::placeholder` colour on
 * the real token values, `color-scheme` set for each theme):
 *
 *     token placeholder   rgb(90,110,133)  light   rgb(107,127,150)  dark   ← --faint, both themes
 *     UA placeholder      rgb(117,117,117) light   rgb(117,117,117)  dark   ← CHROME'S GREY
 *
 * The UA colour is BYTE-IDENTICAL IN BOTH THEMES. It is not derived from `currentColor` (the
 * element's own colour measured #0B1220 light / #E6EEF7 dark beside it) and it is not composited
 * — `::placeholder` opacity is 1 — so it is a flat neutral grey with none of the palette's blue
 * undertone, painted the same on a #F3F6FA canvas and a #060A12 one.
 *
 * ⚠ AND IT FAILS THE FLOOR THIS REPO ALREADY HOLDS EVERY TEXT TOKEN TO. `contrast.test.ts` scores
 * every text token against every background at AA body (4.5:1) and exists because `faint` at
 * 2.98:1 "had been shipping". Scored with that same instrument, on `bg-canvas`, which is what all
 * three offenders sit on:
 *
 *     #757575 (UA)    on canvas   4.25:1 light   4.30:1 dark   ← BELOW 4.5:1 IN BOTH THEMES
 *     --faint (token) on canvas   4.84:1 light   4.81:1 dark
 *
 * So the guard that proves the palette clears AA proves it about TOKENS, and this text is not a
 * token. A curated pair list cannot ask "is there text on screen wearing no token at all" — that
 * is the #91 lesson, in the one property whose value the DOM does not carry.
 *
 * ── WHY IT READS THE DOM ─────────────────────────────────────────────────────────────────────
 *
 * A source rule would have to decide, at each `placeholder=` site, whether the element is a raw
 * `<input>` or an `<Input>` that spreads the prop through to one — `Keys.tsx:96` passes
 * `placeholder={k.key_prefix}` to the component, so the attribute and the class list are written
 * in two different files. Measured: 5 `placeholder=` sites in the source, 2 of them on the
 * component. The DOM is where the attribute and the class meet, which is the same argument
 * focusAudit.ts makes for `asChild`.
 *
 * ⚠ THE CLASS MUST BE THE ELEMENT'S OWN, and that is a fact about CSS rather than a choice:
 * `placeholder:text-faint` compiles to `.placeholder\:text-faint::placeholder{color:…}`, which
 * matches nothing but that element's own pseudo-element. An ancestor carrying it does not reach a
 * descendant's placeholder, so — unlike the figure face, where `font-figure` inherits and the
 * audit walks up the tree — walking up here would report a green that the browser does not paint.
 * Pinned by a unit test and by control C6.
 */

/** The system's placeholder colour, as `Input.tsx` declares it. */
export const PLACEHOLDER_CLASS = 'placeholder:text-faint'

export interface UnstyledPlaceholder {
  /** the placeholder text the user reads, e.g. "What needs doing?" */
  placeholder: string
  /** the element's own class attribute, which is what a fix would change */
  className: string
  tag: string
}

/** Does this element declare the system's placeholder colour on ITSELF? See the note above. */
export function declaresPlaceholderColour(el: Element): boolean {
  return (el.getAttribute('class') ?? '').split(/\s+/).includes(PLACEHOLDER_CLASS)
}

/** Every placeholder-bearing field under `root` that leaves its placeholder to the user agent. */
export function unstyledPlaceholdersIn(root: ParentNode): UnstyledPlaceholder[] {
  const out: UnstyledPlaceholder[] = []
  for (const el of Array.from(root.querySelectorAll('[placeholder]'))) {
    // ⚠ An EMPTY placeholder paints nothing, so it is not an offender. `placeholder=""` and no
    // placeholder at all are the same thing on screen, and a rule that cannot tell them apart
    // would demand a colour for text that does not exist.
    const placeholder = el.getAttribute('placeholder') ?? ''
    if (placeholder === '') continue
    if (declaresPlaceholderColour(el)) continue
    out.push({ placeholder, className: el.getAttribute('class') ?? '', tag: el.tagName.toLowerCase() })
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
// ⚠ THIS ONE ALSO OBSERVES `attributes`, WHICH THE OTHER FOUR DO NOT, AND THE DIFFERENCE IS THE
// SUBJECT: a placeholder is an ATTRIBUTE. A field whose placeholder is swapped in place — same
// element, no child and no text node touched — is a mutation the other audits' filter does not
// deliver, and this audit would never re-read it. `attributeFilter` keeps it to the two attributes
// that can change the answer rather than every attribute in the tree.

const records: UnstyledPlaceholder[] = []
const seenPlaceholders = new Map<string, Set<string>>()
let offenders: UnstyledPlaceholder[] = []
let currentFile = ''

function scan(): void {
  // ⚠ The FLOOR counts every placeholder rendered, not just the offenders — otherwise a file
  // whose fields are all correct would satisfy nothing and the floor could not tell "this fixture
  // stopped rendering its field" from "everything here is fine".
  for (const el of Array.from(document.body.querySelectorAll('[placeholder]'))) {
    const text = el.getAttribute('placeholder') ?? ''
    if (text === '') continue
    let seen = seenPlaceholders.get(currentFile)
    if (!seen) seenPlaceholders.set(currentFile, (seen = new Set()))
    seen.add(text)
  }
  for (const p of unstyledPlaceholdersIn(document.body)) {
    const key = `${p.tag}|${p.className}|${p.placeholder}`
    if (records.some((r) => `${r.tag}|${r.className}|${r.placeholder}` === key)) continue
    records.push(p)
    offenders.push(p)
  }
}

/** Start recording. Called once per test file, from test-setup.ts. */
export function installPlaceholderAudit(): void {
  new MutationObserver(scan).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'class'],
  })
}

/** Which test file is running, so the floor can be read per file. */
export function setPlaceholderAuditFile(file: string): void {
  currentFile = file
}

/** The unstyled placeholders seen since the last call, and clears them. */
export function takePlaceholderOffenders(): UnstyledPlaceholder[] {
  const out = offenders
  offenders = []
  return out
}

/**
 * THE FLOOR — the files that must have audited a placeholder, and what each renders.
 *
 * ⚠ IT ASKS FOR A PLACEHOLDER, NOT FOR AN OFFENDER. A rule whose only output is a list of
 * offenders passes perfectly when it sees nothing at all — a dead observer, a fixture that stopped
 * mounting the form, a key that never matches. Measured: with the observer never installed, every
 * offender rule in this repo goes green and this table is the only thing that goes red.
 *
 * ⚠ KEYED BY THE PATH VITEST REPORTS (`src/areas/lens/Keys.test.tsx`), NOT BY BASENAME. #101's C3
 * found MUST_AUDIT_MONO_TEXT keyed by basename against a full-path lookup: every entry returned
 * undefined and the floor had never fired once. Control C4 is what proves these keys, by blinding
 * the observer and requiring these exact files to be the ones that red.
 *
 * ⚠ WHAT IT DOES NOT CATCH, MEASURED RATHER THAN REASONED ABOUT. C8's first form deleted ONE of
 * DocsArea.test.tsx's two placeholders and came back **NOT CAUGHT**: SpaceView's field still
 * renders into that file, so the entry stays satisfied and SpaceList is silently guarded by
 * nothing. That is not a hole to be patched, it is what a floor IS — `0292cf0` recorded the
 * identical shape for MUST_RENDER_QUANTITY, where every listed file kept rendering some OTHER
 * quantity. A FLOOR ASKS "did this file audit one of these", NEVER "did it audit THIS one". The
 * catcher for a single fixture losing its field is the surface test that asserts the field, not
 * this table, and C8 now deletes both so it tests the claim actually being made.
 */
export const MUST_RENDER_PLACEHOLDER: Record<string, string> = {
  'src/Legal.test.tsx': "the Keys surface's create-key name field",
  'src/SessionExpired.test.tsx': 'the create fields on Keys, Track and Docs',
  'src/areas/docs/DocsArea.test.tsx': 'the create-space and create-page title fields',
  'src/areas/lens/Keys.test.tsx': "the create-key name field and each row's key-prefix field",
  'src/areas/track/IssueList.test.tsx': 'the create-issue title field',
  'src/areas/track/TrackArea.test.tsx': 'the create-issue title field',
}

/** Did this file audit at least one rendered placeholder? */
export function satisfiesPlaceholderFloor(file: string): boolean {
  return (seenPlaceholders.get(file)?.size ?? 0) > 0
}

/** Every placeholder this test file has rendered so far. Exported for the audit's own tests. */
export function auditedPlaceholders(file: string): readonly string[] {
  return [...(seenPlaceholders.get(file) ?? [])]
}
