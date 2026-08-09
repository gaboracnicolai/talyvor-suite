import '@testing-library/jest-dom/vitest'

import { afterAll, afterEach, beforeEach } from 'vitest'

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

let currentFile = ''
beforeEach((ctx) => {
  currentFile = ctx.task.file?.name ?? ''
})

afterEach(() => {
  const off = takeOffenders()
  if (off.length === 0) return
  const lines = off.map(
    (f) => `  [${f.kind}] <${f.tag} class="${f.className}"> renders ${JSON.stringify(f.text)}`,
  )
  throw new Error(
    `figure(s) rendered in the body sans — add font-figure:\n${lines.join('\n')}\n` +
      '(the rule, and why it reads the DOM rather than the source, is in src/figureAudit.ts)',
  )
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
})
