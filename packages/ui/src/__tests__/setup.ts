/**
 * THE SEVEN DOM AUDITS RUN HERE TOO — this project renders the design system and audited none of it.
 *
 * ── WHAT WAS MEASURED ────────────────────────────────────────────────────────────────────────
 *
 * `apps/web/src/test-setup.ts` installs seven audits that read the DOM as it is rendered (figure,
 * case, focus, glyph, placeholder, plane, eyebrow) and `apps/web/scripts/check-audit-gate.mjs`
 * proves they throw. Both are wired into ONE of this repo's TWO vitest projects. This file — the
 * other project's setup — held a single line, `import '@testing-library/jest-dom/vitest'`, so the
 * 335 tests in this directory rendered Button, Pill, NavItem, MuNumeral, Switch, TierDot, Mark,
 * HoldBar and FixtureNotice under no audit at all.
 *
 * Measured at `3a96294`, before this file changed: the EXACT fixture check-audit-gate.mjs uses to
 * red apps/web — money in the body sans, µ under an uppercase transform, an unringed button, a
 * character no served face can draw, a browser-painted placeholder, an eyebrow that never shouts,
 * and text on an unclassified plane — was written into `src/__tests__/` and ran GREEN here.
 *
 * ⚠ AND THE TWO COMPONENTS THE REACH TABLE CALLED UNRENDERED ARE BOTH RENDERED IN THIS PROJECT.
 * `apps/web/scripts/check-audit-reach.mjs` classifies `packages/ui#HoldBar` and
 * `packages/ui#FixtureNotice` as reached by no test, and its own failure text reads "is exported
 * and NO test renders it". components.test.tsx:46 renders HoldBar with a real hold window and
 * promotions.test.tsx:34 renders FixtureNotice. The classification's CONCLUSION was right — no
 * audit had seen either — but its stated reason was false, and being false is what hid the fact
 * that the fixture the entry says nobody would write already existed.
 *
 * ⚠ NO OFFENDER WAS FOUND. Running all seven over every test in this project reports zero — 335
 * of them at `224bdee`, 337 now, because invariant.test.ts generates one test per source file
 * and this merge adds two. That is
 * the result: this closes a hole rather than fixing a defect, and it is worth having because the
 * design system's own tests are where a component's UNSHIPPED states are rendered — HoldBar's
 * only render anywhere in the repo is here.
 *
 * ── WHY THE IMPORTS POINT UP INTO apps/web ───────────────────────────────────────────────────
 *
 * The audits read this package's rules and would be at home here, but moving them is not a small
 * change: pointerAudit.test.ts pins `caseAudit.ts` BY SOURCE LINE, caseCallSites.test.ts pins
 * both packages' call sites by path, and check-audit-gate.mjs reads test-setup.ts. Reaching up is
 * the same direction invariant.test.ts:26 and selection.test.ts:255 already take — they scan
 * `../../../../apps/web/src` — and it is test-only: nothing under `src/components` imports it, so
 * the shipped design system still depends on nothing.
 *
 * ── WHY THE MESSAGES ARE A SECOND COPY ───────────────────────────────────────────────────────
 *
 * The report blocks below are a deliberate second copy, not a helper shared with apps/web, and
 * the duplication is CHECKED rather than trusted: check-audit-gate.mjs counts `problems.push(`
 * in EACH project's setup against its pinned list of seven, and requires every audit to name
 * itself IN EACH PROJECT'S armed run by its opening phrase. An eighth audit wired into one setup
 * and forgotten here fails that count. The messages here are terse — the long-form rule, its
 * measurement and its limits live once, in the audit module each block names.
 *
 * ── WHAT IS NOT HERE, AND WHY ────────────────────────────────────────────────────────────────
 *
 * · THE FLOORS. apps/web's setup ends with per-file floors (MUST_RENDER_CURRENCY and six more)
 *   that catch a dead observer, which an offender rule cannot: silence is its correct output. The
 *   floors are keyed by apps/web test-file name and would be a curated list of this project's
 *   files if copied. The armed half of check-audit-gate.mjs is what stands in for them here —
 *   a run in which nothing observes anything fails it.
 *
 * ⚠ REACH IS NOW MEASURED HERE TOO, and it was NOT when the seven audits arrived. That merge said
 * plainly what it had not done: "the two projects' reach shards are not unioned … reach measures
 * apps/web and says apps/web". It does both now — this project writes its own shard directory
 * (reach-global-setup.ts explains why a SECOND directory rather than a shared one) and
 * check-audit-reach.mjs holds each directory to its own floor before unioning them.
 */

// ⚠ reachAudit MUST BE FIRST, ABOVE EVERY OTHER IMPORT IN THIS FILE. It installs the React
// DevTools hook, which React reads once at react-dom's own module init. `planeAudit` imports
// `@talyvor/ui`, which imports every component, which imports React — so an audit import above
// this line makes the hook silently record NOTHING. reach-registry pulls React in deliberately
// and therefore comes second. See the ORDER note in apps/web/src/reachAudit.ts.
import { flushReach } from '../../../../apps/web/src/reachAudit'
import './reach-registry'

import '@testing-library/jest-dom/vitest'

import { afterAll, afterEach, beforeEach, inject } from 'vitest'

import { installCaseAudit, setCaseAuditFile, takeCaseOffenders } from '../../../../apps/web/src/caseAudit'
import { installFigureAudit, takeOffenders } from '../../../../apps/web/src/figureAudit'
import {
  installFocusAudit,
  setFocusAuditFile,
  takeFocusOffenders,
} from '../../../../apps/web/src/focusAudit'
import {
  installGlyphAudit,
  setGlyphAuditFile,
  takeGlyphOffenders,
} from '../../../../apps/web/src/glyphAudit'
import {
  installPlaceholderAudit,
  setPlaceholderAuditFile,
  takePlaceholderOffenders,
} from '../../../../apps/web/src/placeholderAudit'
import {
  installPlaneAudit,
  setPlaneAuditFile,
  takePlaneOffenders,
} from '../../../../apps/web/src/planeAudit'
import {
  installEyebrowAudit,
  setEyebrowAuditFile,
  takeEyebrowOffenders,
} from '../../../../apps/web/src/eyebrowAudit'

installFigureAudit()
installCaseAudit()
installFocusAudit()
installGlyphAudit()
installPlaceholderAudit()
installPlaneAudit()
installEyebrowAudit()

beforeEach((ctx) => {
  const file = ctx.task.file?.name ?? ''
  setCaseAuditFile(file)
  setFocusAuditFile(file)
  setGlyphAuditFile(file)
  setPlaceholderAuditFile(file)
  setPlaneAuditFile(file)
  setEyebrowAuditFile(file)
})

// ⚠ ONE HOOK, ONE THROW — apps/web's reason, which applies unchanged: two `afterEach`
// registrations would make "does the second still run when the first throws" a question this
// file's correctness rests on. Every audit is drained before any of them is reported.
afterEach(() => {
  const problems: string[] = []

  const off = takeOffenders()
  if (off.length > 0) {
    problems.push(
      'figure(s) rendered in the body sans — add font-figure:\n' +
        off
          .map((f) => `  [${f.kind}] <${f.tag} class="${f.className}"> renders ${JSON.stringify(f.text)}`)
          .join('\n') +
        '\n(the rule is in apps/web/src/figureAudit.ts)',
    )
  }

  const cased = takeCaseOffenders()
  if (cased.length > 0) {
    problems.push(
      'character(s) REPLACED by a casing transform, not re-cased — wrap them in a normal-case ' +
        'span (CaseSafe.tsx is the shape):\n' +
        cased
          .map(
            (c) =>
              `  ${c.codePoint} ${JSON.stringify(c.char)} becomes ${JSON.stringify(c.becomes)} ` +
              `under text-transform:${c.transform}\n    <${c.tag} class="${c.className}"> renders ` +
              JSON.stringify(c.text),
          )
          .join('\n') +
        '\n(the rule is in apps/web/src/caseAudit.ts)',
    )
  }

  const unringed = takeFocusOffenders()
  if (unringed.length > 0) {
    problems.push(
      'keyboard-focusable element(s) with no accent focus ring — add `focusRing` from lib/focus:\n' +
        unringed
          .map((o) => `  <${o.tag}> ${JSON.stringify(o.text)}\n    class="${o.className}"`)
          .join('\n') +
        '\n(the rule is in apps/web/src/focusAudit.ts)',
    )
  }

  const unserved = takeGlyphOffenders()
  if (unserved.length > 0) {
    problems.push(
      'character(s) no served face can draw — the browser falls through to the system stack for ' +
        'each one:\n' +
        unserved
          .map(
            (g) =>
              `  ${g.codePoint} ${JSON.stringify(g.char)} is ${g.coverage} by the ${g.family} ` +
              `faces\n    <${g.tag} class="${g.className}"> renders ${JSON.stringify(g.text)}`,
          )
          .join('\n') +
        '\n(the rule, and the binaries it reads out of this package, are in ' +
        'apps/web/src/glyphAudit.ts)',
    )
  }

  const unpainted = takePlaceholderOffenders()
  if (unpainted.length > 0) {
    problems.push(
      'placeholder(s) painted by the browser, not by the palette — add `placeholder:text-faint` ' +
        'to the element itself:\n' +
        unpainted
          .map(
            (p) =>
              `  <${p.tag} placeholder=${JSON.stringify(p.placeholder)}>\n    class="${p.className}"`,
          )
          .join('\n') +
        '\n(the Chrome measurement is in apps/web/src/placeholderAudit.ts)',
    )
  }

  const uncased = takeEyebrowOffenders()
  if (uncased.length > 0) {
    problems.push(
      'eyebrow(s) rendered without an uppercase transform in effect — 11px mono at 0.24em ' +
        'tracking is a label shape carrying text that is not in label case:\n' +
        uncased
          .map(
            (e) =>
              `  <${e.tag} class="${e.className}"> renders ${JSON.stringify(e.text)}\n` +
              `    text-transform in effect: ${e.transform}`,
          )
          .join('\n') +
        '\n(the rule, and why the token withholds the transform, are in ' +
        'apps/web/src/eyebrowAudit.ts)',
    )
  }

  const unscored = takePlaneOffenders()
  if (unscored.length > 0) {
    problems.push(
      'text scored against the plane it renders on and did not clear AA body (4.5:1) — or landed ' +
        'on a plane nobody classified:\n' +
        unscored
          .map((p) => {
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
          .join('\n') +
        '\n(the measured numbers are in planes.ts; the ancestor walk is in ' +
        'apps/web/src/planeAudit.ts)',
    )
  }

  if (problems.length > 0) throw new Error(problems.join('\n\n'))
})

afterAll(() => {
  // ⚠ WRITTEN ONCE PER FILE, and unconditionally even when nothing was recorded — apps/web's two
  // measurements, inherited rather than re-derived: `process.on('exit')` produces NO file at all
  // because vitest tears its workers down without running exit handlers, and skipping the write
  // when nothing was committed makes a blinded hook look like a missing directory instead of
  // "Button was registered and never committed".
  flushReach(inject('reachDir'))
})
