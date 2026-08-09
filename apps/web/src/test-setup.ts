import '@testing-library/jest-dom/vitest'

import { afterAll, afterEach, beforeEach } from 'vitest'

import {
  MUST_PROTECT_MICRO_SIGN,
  installCaseAudit,
  satisfiesMicroFloor,
  setCaseAuditFile,
  takeCaseOffenders,
} from './caseAudit'
import {
  MUST_RENDER_CURRENCY,
  MUST_RENDER_QUANTITY,
  auditedFigures,
  installFigureAudit,
  satisfiesFloor,
  takeOffenders,
} from './figureAudit'

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

let currentFile = ''
beforeEach((ctx) => {
  currentFile = ctx.task.file?.name ?? ''
  setCaseAuditFile(currentFile)
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
        `normal-case span (MuNumeral.tsx:19 is the shape):\n${lines.join('\n')}\n` +
        '(the rule, the engine measurement and the hole it leaves are in src/caseAudit.ts)',
    )
  }

  if (problems.length > 0) throw new Error(problems.join('\n\n'))
})

afterAll(() => {
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

  // ⚠ THE FLOOR ASKS FOR A PROTECTED µ, NOT MERELY A µ. Most µ in this product sit in ordinary
  // body text with no transform in effect, so "rendered a µ" would stay green with the audit
  // switched off. See MUST_PROTECT_MICRO_SIGN.
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
