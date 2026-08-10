// ⚠ reachAudit MUST BE FIRST. It installs the React DevTools hook, which React reads once at
// react-dom's own module init; anything above it that pulls React in makes the hook silently
// record nothing. reachRegistry pulls React in and therefore must come after it. The two are
// split for exactly this reason — see the ORDER note in reachAudit.ts.
import './reachAudit'
import './reachRegistry'

import '@testing-library/jest-dom/vitest'

import { afterAll, afterEach, beforeEach, inject } from 'vitest'

import { flushReach } from './reachAudit'
import {
  MUST_PROTECT_MICRO_SIGN,
  installCaseAudit,
  satisfiesMicroFloor,
  setCaseAuditFile,
  takeCaseOffenders,
} from './caseAudit'
import {
  MUST_RENDER_FOCUS_RING,
  installFocusAudit,
  satisfiesFocusFloor,
  setFocusAuditFile,
  takeFocusOffenders,
} from './focusAudit'
import {
  MUST_RENDER_CURRENCY,
  MUST_RENDER_QUANTITY,
  auditedFigures,
  installFigureAudit,
  satisfiesFloor,
  takeOffenders,
} from './figureAudit'
import {
  MUST_AUDIT_MONO_TEXT,
  installGlyphAudit,
  satisfiesMonoFloor,
  setGlyphAuditFile,
  takeGlyphOffenders,
} from './glyphAudit'
import {
  MUST_RENDER_EYEBROW,
  installEyebrowAudit,
  satisfiesEyebrowFloor,
  setEyebrowAuditFile,
  takeEyebrowOffenders,
} from './eyebrowAudit'
import {
  MUST_AUDIT_A_DECLARED_PLANE,
  installPlaneAudit,
  satisfiesPlaneFloor,
  setPlaneAuditFile,
  takePlaneOffenders,
} from './planeAudit'
import {
  MUST_RENDER_PLACEHOLDER,
  installPlaceholderAudit,
  satisfiesPlaceholderFloor,
  setPlaceholderAuditFile,
  takePlaceholderOffenders,
} from './placeholderAudit'
import {
  MUST_AUDIT_A_NUMERIC_FIELD,
  installFieldFaceAudit,
  satisfiesFieldFaceFloor,
  setFieldFaceAuditFile,
  takeFieldFaceOffenders,
} from './fieldFaceAudit'

/**
 * EVERY FIGURE THIS SUITE RENDERS IS AUDITED, on every surface, in every test.
 *
 * The rule and its three traps are documented in figureAudit.ts. The wiring is here rather than
 * in one test file on purpose: the money surfaces already have tests with real fetch mocks, so
 * riding them audits the product as it is actually rendered instead of re-mocking it beside a
 * second copy of the fixtures. A surface with no test is audited by nothing — which is exactly
 * what MUST_RENDER_CURRENCY exists to say out loud rather than leave implied.
 */
installFigureAudit()

/**
 * AND EVERY CASING TRANSFORM IS AUDITED FOR WHAT IT REPLACES, on the same ride.
 *
 * `text-transform: uppercase` maps µ (U+00B5) to Greek capital Mu, so an uppercase eyebrow renders
 * µLXC as MLXC — a different SI prefix, twelve orders of magnitude out, on the page whose figures
 * exist to be checked against the ledger. preset.ts states the rule and cannot enforce it; the
 * class and the character meet in the DOM and nowhere else. caseAudit.ts carries the measurement,
 * the predicate and the one hole it leaves.
 */
installCaseAudit()

/**
 * AND EVERY CONTROL IS AUDITED FOR THE HUE IT WEARS ON KEYBOARD FOCUS, on the same ride.
 *
 * focus.ts declares a 2px accent outline and says it is "applied to every interactive element";
 * only a component that imports it has one, and a hand-rolled control gets the BROWSER'S default
 * ring instead — measured in Chrome 151 as rgb(153,200,255) dark / rgb(0,95,204) light, against
 * an accent of #3AD6C0 / #0F7A6C. A string constant cannot check its own reach, and `asChild`
 * merges the ring onto an element the source never names, so the DOM is the only place to ask.
 */
installFocusAudit()

/**
 * AND EVERY CHARACTER IS ASKED OF THE FACE THAT HAS TO DRAW IT, on the same ride.
 *
 * theme.css warns that a missing font FILE falls back to the system stack silently; a missing
 * GLYPH does exactly the same thing, one character at a time, and typeface.test.tsx checks only
 * that each url() resolves to something whose first four bytes are `wOF2`. glyphAudit.ts reads the
 * cmaps out of the shipped binaries and asks whether the product's own copy is inside them.
 */
installGlyphAudit()

/**
 * AND EVERY PLACEHOLDER IS ASKED WHICH COLOUR PAINTS IT, on the same ride.
 *
 * `Input.tsx` declares `placeholder:text-faint`; a hand-rolled `<input placeholder="…">` declares
 * nothing and Chrome paints rgb(117,117,117) — measured, the SAME grey in both themes, not derived
 * from currentColor — which scores 4.25:1 light and 4.30:1 dark on `bg-canvas`, below the 4.5:1
 * AA body floor `contrast.test.ts` holds every text token to. That guard scores TOKEN PAIRS and
 * cannot ask whether some text on screen wears no token at all. placeholderAudit.ts carries the
 * engine measurement and why the class must be the element's own.
 */
installPlaceholderAudit()

/**
 * AND EVERY LINE OF TEXT IS SCORED AGAINST THE PLANE IT LANDS ON, on the same ride.
 *
 * `contrast.test.ts` scores a MATRIX — four text roles against `canvas`, `surface`, `sidebar` —
 * plus one hand-written case for `ink` on `accent-tint`. The product renders text on that fourth
 * plane at ten sites and NOTHING asks whether a role other than `ink` lands there: measured,
 * `faint` on it is 3.97:1 light / 3.63:1 dark, under the 4.5:1 AA body floor the same file holds
 * every other pair to, and `NavItem` declared exactly that pair on its icon. A curated matrix
 * cannot ask what the product actually renders; planes.ts carries the numbers and planeAudit.ts
 * the ancestor walk that finds the plane.
 */
installPlaneAudit()

/**
 * AND EVERY EYEBROW IS ASKED WHETHER ITS UPPERCASE ARRIVED, on the same ride.
 *
 * preset.ts §THE EYEBROW keeps `text-transform` OUT of the token deliberately — it maps µ to Greek
 * capital Mu — and applies it at the call site instead. caseAudit guards the half where the
 * transform HURTS a character; nothing asked whether it is there at all. Measured at `ff17b41`:
 * dropping `uppercase` from one rendered eyebrow left all 678 tests green, because
 * `text-transform` is paint-time and `textContent` is identical either way.
 */
installEyebrowAudit()

/**
 * AND EVERY NUMERIC FIELD IS ASKED WHICH FACE PAINTS WHAT YOU TYPE, on the same ride.
 *
 * The other seven reach the DOM through TEXT NODES or ATTRIBUTES. An `<input>` has no children and
 * React assigns `value` as a PROPERTY, so a numeral a user types is invisible to all of them by
 * construction. Measured at `732cf32` with a throwaway probe over the whole suite: of 87 field
 * records, the only one on screen holding a figure off the face is Convert's LXC amount — the
 * number the irreversible conversion is about, in the body sans, one row above a `Costs` line on
 * the face. fieldFaceAudit.ts carries the Chrome measurement, and why the face may be INHERITED
 * here when the placeholder colour may not.
 */
installFieldFaceAudit()

let currentFile = ''
beforeEach((ctx) => {
  currentFile = ctx.task.file?.name ?? ''
  setCaseAuditFile(currentFile)
  setFocusAuditFile(currentFile)
  setGlyphAuditFile(currentFile)
  setPlaceholderAuditFile(currentFile)
  setPlaneAuditFile(currentFile)
  setEyebrowAuditFile(currentFile)
  setFieldFaceAuditFile(currentFile)
})

// ⚠ BOTH audits are read in ONE hook and reported together. Two `afterEach` registrations would
// make "does the second still run when the first throws" a question this file's correctness rests
// on; collecting both first means neither can be masked by the other.
afterEach(() => {
  const problems: string[] = []

  const off = takeOffenders()
  if (off.length > 0) {
    const lines = off.map(
      (f) => `  [${f.kind}] <${f.tag} class="${f.className}"> renders ${JSON.stringify(f.text)}`,
    )
    problems.push(
      `figure(s) rendered in the body sans — add font-figure:\n${lines.join('\n')}\n` +
        '(the rule, and why it reads the DOM rather than the source, is in src/figureAudit.ts)',
    )
  }

  const cased = takeCaseOffenders()
  if (cased.length > 0) {
    const lines = cased.map(
      (c) =>
        `  ${c.codePoint} ${JSON.stringify(c.char)} becomes ${JSON.stringify(c.becomes)} under ` +
        `text-transform:${c.transform} (from class="${c.fromClassName}")\n` +
        `    <${c.tag} class="${c.className}"> renders ${JSON.stringify(c.text)}`,
    )
    problems.push(
      'character(s) REPLACED by a casing transform, not re-cased — wrap them in a ' +
        `normal-case span (CaseSafe.tsx:85 is the shape):\n${lines.join('\n')}\n` +
        '(the rule, the engine measurement and the hole it leaves are in src/caseAudit.ts)',
    )
  }

  const unringed = takeFocusOffenders()
  if (unringed.length > 0) {
    const lines = unringed.map(
      (o) =>
        `  <${o.tag}${o.type ? ` type="${o.type}"` : ''}> ${JSON.stringify(o.text)}` +
        `${o.present.length ? ` (carries only ${o.present.join(' ')})` : ''}\n` +
        `    class="${o.className}"`,
    )
    problems.push(
      'keyboard-focusable element(s) with no accent focus ring — add `focusRing` from ' +
        `@talyvor/ui:\n${lines.join('\n')}\n` +
        '(the rule, the Chrome measurement and the one exemption are in src/focusAudit.ts)',
    )
  }

  const unserved = takeGlyphOffenders()
  if (unserved.length > 0) {
    const lines = unserved.map(
      (g) =>
        `  ${g.codePoint} ${JSON.stringify(g.char)} is ${g.coverage} by the ${g.family} faces\n` +
        `    <${g.tag} class="${g.className}"> renders ${JSON.stringify(g.text)}`,
    )
    problems.push(
      'character(s) no served face can draw — the browser falls through to the system stack for ' +
        `each one:\n${lines.join('\n')}\n` +
        '(the rule, the binaries it reads and the two characters still awaiting a decision are ' +
        'in src/glyphAudit.ts)',
    )
  }

  const unpainted = takePlaceholderOffenders()
  if (unpainted.length > 0) {
    const lines = unpainted.map(
      (p) =>
        `  <${p.tag} placeholder=${JSON.stringify(p.placeholder)}> leaves its placeholder to the ` +
        `user agent\n    class="${p.className}"`,
    )
    problems.push(
      `placeholder(s) painted by the browser, not by the palette — add \`placeholder:text-faint\` ` +
        `to the element itself:\n${lines.join('\n')}\n` +
        '(the Chrome measurement, the two contrast scores and why the class cannot be inherited ' +
        'are in src/placeholderAudit.ts)',
    )
  }

  const uncased = takeEyebrowOffenders()
  if (uncased.length > 0) {
    const lines = uncased.map(
      (e) =>
        `  <${e.tag} class="${e.className}"> renders ${JSON.stringify(e.text)}\n` +
        `    text-transform in effect: ${e.transform}` +
        (e.fromClassName ? ` (declared by class="${e.fromClassName}")` : ' (nothing declares one)'),
    )
    problems.push(
      'eyebrow(s) rendered without an uppercase transform in effect — 11px mono at 0.24em ' +
        `tracking is a label shape carrying text that is not in label case:\n${lines.join('\n')}\n` +
        '(the rule, why the token withholds the transform and why this reads the DOM are in ' +
        'src/eyebrowAudit.ts)',
    )
  }

  const unfaced = takeFieldFaceOffenders()
  if (unfaced.length > 0) {
    const lines = unfaced.map(
      (f) =>
        `  <${f.tag} ${f.declaredBy}${f.label ? ` aria-label=${JSON.stringify(f.label)}` : ''}> ` +
        `holds ${JSON.stringify(f.value)} in the body sans\n    class="${f.className}"`,
    )
    problems.push(
      'numeric field(s) whose value is painted in the body sans — add `font-figure` to the field ' +
        `or to an ancestor:\n${lines.join('\n')}\n` +
        '(the Chrome measurement, why the face may be inherited here and why the predicate is the ' +
        'declaration rather than the value are in src/fieldFaceAudit.ts)',
    )
  }

  const unscored = takePlaneOffenders()
  if (unscored.length > 0) {
    const lines = unscored.map((p) => {
      const score =
        p.light === null || p.dark === null
          ? ''
          : ` (${p.light.toFixed(2)}:1 light, ${p.dark.toFixed(2)}:1 dark)`
      return (
        `  [${p.reason}] text token \`${p.role}\` on plane \`${p.plane}\`${score}\n` +
        `    <${p.tag} class="${p.className}"> renders ${JSON.stringify(p.text)}\n` +
        `    plane declared by: ${p.planeFrom}`
      )
    })
    problems.push(
      'text scored against the plane it renders on and did not clear AA body (4.5:1) — or landed ' +
        `on a plane nobody classified:\n${lines.join('\n')}\n` +
        '(the four measured numbers and the classification are in @talyvor/ui planes.ts; the ' +
        'ancestor walk and its limits are in src/planeAudit.ts)',
    )
  }

  if (problems.length > 0) throw new Error(problems.join('\n\n'))
})

afterAll(() => {
  // ⚠ WRITTEN HERE, ONCE PER FILE, NOT ONCE PER COMMIT. An early draft wrote a shard from the
  // commit callback and produced 1,267 writes for one run. `process.on('exit')` was tried first
  // and produced NO file at all — vitest tears its workers down without running exit handlers,
  // which is the same silent zero this instrument exists to make impossible.
  flushReach(inject('reachDir'))

  // ⚠ Each floor asks for ITS OWN KIND. `auditedFigures().length > 0` would let a file listed for
  // rendering money satisfy the floor with a bare `1` — a weaker guard under the same name.
  for (const [kind, table, name] of [
    ['currency', MUST_RENDER_CURRENCY, 'MUST_RENDER_CURRENCY'],
    ['quantity', MUST_RENDER_QUANTITY, 'MUST_RENDER_QUANTITY'],
  ] as const) {
    const why = table[currentFile]
    if (!why) continue
    if (satisfiesFloor(auditedFigures(), kind)) continue
    throw new Error(
      `${currentFile} audited NO ${kind} figure. It is listed in ${name} because it renders ` +
        `${why}. Either the fixture stopped rendering it — in which case this file no longer ` +
        'guards it — or the audit stopped seeing it. Do not delete the entry to go green.',
    )
  }

  // ⚠ The focus floor asks only "did this file render ONE ringed control" — never "did THIS
  // control keep its ring", which is the offender rule's job.
  //
  // ⚠ WHAT IT CATCHES IS NARROWER THAN THE FIRST VERSION OF THIS COMMENT CLAIMED, and a control
  // is the only reason I know. I had written that it catches "a blinded `isKeyboardFocusable`, a
  // dead observer, or `focusRing` stripped out of the design system". MEASURED (C6): blinding
  // `isKeyboardFocusable` to return false leaves this floor GREEN — it is computed from
  // `ringedByRawAttribute`, which reads the class attribute directly and never asks that
  // predicate, which is exactly the independence that makes it a floor and exactly why it cannot
  // see that particular edit. The three catches, each observed:
  //   · a dead observer          → this floor, red (C13)
  //   · a blinded predicate      → focusAudit.test.tsx's direct unit tests, red (C6)
  //   · focusRing left the system → the OFFENDER rule, red, because every Button becomes an
  //                                 offender before any floor is consulted (C12)
  const whyFocus = MUST_RENDER_FOCUS_RING[currentFile]
  if (whyFocus && !satisfiesFocusFloor(currentFile)) {
    throw new Error(
      `${currentFile} audited NO element wearing the accent focus ring. It is listed in ` +
        `MUST_RENDER_FOCUS_RING because it renders ${whyFocus}. Either the fixture stopped ` +
        'rendering it — in which case this file no longer guards it — or the audit stopped ' +
        'seeing it. Do not delete the entry to go green.',
    )
  }

  // ⚠ THE FLOOR ASKS FOR A PROTECTED µ, NOT MERELY A µ. Most µ in this product sit in ordinary
  // body text with no transform in effect, so "rendered a µ" would stay green with the audit
  // switched off. See MUST_PROTECT_MICRO_SIGN.
  // ⚠ THE GLYPH FLOOR ASKS FOR A MONO CHARACTER, NOT A CHARACTER. Every test renders some text,
  // so "audited anything" would stay green with the family walk blinded — and the family walk is
  // the half that decides which font files are consulted. See MUST_AUDIT_MONO_TEXT.
  const whyMono = MUST_AUDIT_MONO_TEXT[currentFile]
  if (whyMono && !satisfiesMonoFloor(currentFile)) {
    throw new Error(
      `${currentFile} audited NO character on the mono family. It is listed in ` +
        `MUST_AUDIT_MONO_TEXT because it renders ${whyMono}. Either the fixture stopped ` +
        'rendering it — in which case this file no longer guards it — or the audit stopped ' +
        'seeing it. Do not delete the entry to go green.',
    )
  }

  // ⚠ THE PLACEHOLDER FLOOR ASKS FOR A PLACEHOLDER, NOT AN OFFENDER — see the table's own note.
  // The offender rule is silent by design when everything is correct, which is exactly the state
  // a dead observer is indistinguishable from.
  const whyPlaceholder = MUST_RENDER_PLACEHOLDER[currentFile]
  if (whyPlaceholder && !satisfiesPlaceholderFloor(currentFile)) {
    throw new Error(
      `${currentFile} audited NO rendered placeholder. It is listed in MUST_RENDER_PLACEHOLDER ` +
        `because it renders ${whyPlaceholder}. Either the fixture stopped rendering it — in which ` +
        'case this file no longer guards it — or the audit stopped seeing it. Do not delete the ' +
        'entry to go green.',
    )
  }

  // ⚠ THE PLANE FLOOR ASKS FOR A DECLARED PLANE, NOT A PAIR — see the table's own note. Every
  // test renders text on the body default, so "audited a pair" stays green with the ancestor walk
  // blinded, and the ancestor walk is the only half a source rule could not have done.
  const whyPlane = MUST_AUDIT_A_DECLARED_PLANE[currentFile]
  if (whyPlane && !satisfiesPlaneFloor(currentFile)) {
    throw new Error(
      `${currentFile} scored NO text against a DECLARED plane. It is listed in ` +
        `MUST_AUDIT_A_DECLARED_PLANE because ${whyPlane}. Either the fixture stopped rendering ` +
        'it — in which case this file no longer guards it — or the audit stopped seeing it. Do ' +
        'not delete the entry to go green.',
    )
  }

  const whyEyebrow = MUST_RENDER_EYEBROW[currentFile]
  if (whyEyebrow && !satisfiesEyebrowFloor(currentFile)) {
    throw new Error(
      `${currentFile} audited NO eyebrow with an uppercase transform in effect. It is listed in ` +
        `MUST_RENDER_EYEBROW because it renders ${whyEyebrow}. Either the fixture stopped ` +
        'rendering it — in which case this file no longer guards it — or the audit stopped ' +
        'seeing it. Do not delete the entry to go green.',
    )
  }

  // ⚠ THE FIELD FLOOR ASKS FOR A NUMERIC FIELD, NOT AN OFFENDER — see the table's own note. This
  // rule's correct output on a clean product is silence, which is what a dead observer also emits.
  const whyField = MUST_AUDIT_A_NUMERIC_FIELD[currentFile]
  if (whyField && !satisfiesFieldFaceFloor(currentFile)) {
    throw new Error(
      `${currentFile} audited NO numeric field. It is listed in MUST_AUDIT_A_NUMERIC_FIELD ` +
        `because it renders ${whyField}. Either the fixture stopped rendering it — in which case ` +
        'this file no longer guards it — or the audit stopped seeing it. Do not delete the entry ' +
        'to go green.',
    )
  }

  const whyMicro = MUST_PROTECT_MICRO_SIGN[currentFile]
  if (whyMicro && !satisfiesMicroFloor(currentFile)) {
    throw new Error(
      `${currentFile} audited NO µ under a live casing transform. It is listed in ` +
        `MUST_PROTECT_MICRO_SIGN because ${whyMicro}. Either the fixture stopped rendering it — ` +
        'in which case this file no longer guards it — or the audit stopped seeing it. Do not ' +
        'delete the entry to go green.',
    )
  }
})
