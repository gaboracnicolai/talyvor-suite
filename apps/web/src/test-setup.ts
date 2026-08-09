import '@testing-library/jest-dom/vitest'

import { afterAll, afterEach, beforeEach } from 'vitest'

import { MUST_RENDER_CURRENCY, auditedFigures, installFigureAudit, takeOffenders } from './figureAudit'

/**
 * EVERY CURRENCY FIGURE THIS SUITE RENDERS IS AUDITED, on every surface, in every test.
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
  const lines = off.map((f) => `  <${f.tag} class="${f.className}"> renders ${JSON.stringify(f.text)}`)
  throw new Error(
    `currency figure(s) rendered in the body sans — add font-figure:\n${lines.join('\n')}\n` +
      '(the rule, and why it reads the DOM rather than the source, is in src/figureAudit.ts)',
  )
})

afterAll(() => {
  const why = MUST_RENDER_CURRENCY[currentFile]
  if (!why) return
  if (auditedFigures().length > 0) return
  throw new Error(
    `${currentFile} audited NO currency figure. It is listed in MUST_RENDER_CURRENCY because it ` +
      `renders ${why}. Either the fixture stopped rendering money — in which case this file no ` +
      'longer guards it — or the audit stopped seeing it. Do not delete the entry to go green.',
  )
})
