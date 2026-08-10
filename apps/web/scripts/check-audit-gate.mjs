// THE SEVEN DOM AUDITS HAVE ONE ENFORCEMENT POINT AND NOTHING CHECKED THAT IT THROWS.
//
// `test-setup.ts` collects offenders from all seven audits — figure, case, focus, glyph,
// placeholder, eyebrow, plane — into one `problems` array and ends with a single line:
//
//     if (problems.length > 0) throw new Error(problems.join('\n\n'))
//
// That line is the only thing that turns an audit's finding into a failing test. `319335c`
// recorded the hole for one rule and said it was general: "disabling the offender REPORT reds
// nothing while the product is clean … All six other audits share the same unguarded reporting
// path; it is a property of the wiring, not this rule."
//
// ── MEASURED, NOT REASONED ABOUT ─────────────────────────────────────────────────────────────
//
// At `4195fba`, with `<CaseSafe>` removed from Landing's unit label — the real µ→Μ defect #99
// exists to prevent, back on the public marketing page — and ONE predicate changed here
// (`problems.length > 0` → `false`):
//
//     pnpm typecheck   Done
//     pnpm lint        clean
//     pnpm test        59/59 files, 707 tests, manifest ok, audit-reach 70/68/2
//
// Every gate green, with the page rendering MLXC. With the throw intact the same defect reds
// FOUR test files. One character, seven audits, and no instrument in the repo could tell.
//
// ⚠ NO UNIT TEST CAN CLOSE THIS, which is why it is a script and not a `.test.ts`. The gate runs
// in an `afterEach` registered by the setup file; a test cannot observe its own afterEach, and a
// test that asserts the COLLECTOR works leaves `if (false)` untouched. The only instrument that
// can see it is a REAL vitest run that must fail — the same argument `build-release.sh` makes
// about the version stamp: nothing inside the run can see whether the run was armed.
//
// ── WHAT IT DOES ─────────────────────────────────────────────────────────────────────────────
//
//  1. NEGATIVE HALF FIRST. Runs a probe that renders NOTHING and requires it to PASS. Without
//     this, "the armed run failed" and "vitest is broken" are the same observation — the trap
//     `319335c`'s C3 paid for, where a broken build scored as a catch.
//  2. ARMED HALF. Runs a probe rendering ONE offender per audit and requires it to FAIL.
//  3. Requires every one of the seven audits to have NAMED ITSELF in the output, as a SET both
//     directions: the pinned list below is compared to the number of report blocks in
//     test-setup.ts, so an eighth audit that forgets to wire itself fails here, and a deleted
//     report block fails here too.
//
// ⚠ THE PROBE IS WRITTEN AND DELETED BY THIS SCRIPT. It lives under `src/` because that is the
// only place vitest's `include` reaches, so it must not survive the run — every exit path removes
// it and the removal is verified from the filesystem, not from an exit code.
//
// Usage:  node scripts/check-audit-gate.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const appRoot = resolve(new URL('..', import.meta.url).pathname)
const PROBE_REL = 'src/auditGateProbe.test.ts'
const PROBE = resolve(appRoot, PROBE_REL)
const SETUP = resolve(appRoot, 'src/test-setup.ts')

/**
 * The seven audits, each matched by the OPENING PHRASE OF ITS OWN REPORT BLOCK.
 *
 * ⚠ THE FIRST VERSION MATCHED ON THE FILE NAME EACH MESSAGE CITES (`src/caseAudit.ts`) AND WAS
 * READING THE STACK TRACE. vitest prints `at MutationObserver.scan (…/src/caseAudit.ts:260:35)`
 * for every audit that is INSTALLED, reported or not — so an audit whose report block had been
 * silenced still "named itself" and the check passed. Caught by C2 and C6 of
 * scripts/w11-audit-gate-controls.py, which is the only reason this is a phrase list: two
 * controls scored NOT CAUGHT against a guard whose green run looked correct.
 */
const AUDITS = [
  ['figure', 'figure(s) rendered in the body sans'],
  ['case', 'character(s) REPLACED by a casing transform'],
  ['focus', 'keyboard-focusable element(s) with no accent focus ring'],
  ['glyph', 'character(s) no served face can draw'],
  ['placeholder', 'placeholder(s) painted by the browser'],
  ['eyebrow', 'eyebrow(s) rendered without an uppercase transform in effect'],
  ['plane', 'text scored against the plane it renders on'],
]

/**
 * One offender per audit, in one fixture.
 *
 * ⚠ IT YIELDS BEFORE ASSERTING, AND THE YIELD IS MEASURED NON-LOAD-BEARING HERE RATHER THAN
 * ASSUMED NECESSARY. The audits scan from a MutationObserver callback, which is a MICROTASK, and
 * caseAudit.ts records a real shape it matters for — a stepper whose states are rendered and
 * replaced inside ONE synchronous block is sampled only at the last one. This fixture renders
 * ONCE, so removing the `setTimeout(0)` changes nothing: C4 of the control harness scores NOT
 * CAUGHT and is SHIPPED AS DOCUMENTED-INERT. The yield stays because a future probe that steps
 * through states would need it and would not red without it.
 */
const ARMED = `import { describe, expect, it } from 'vitest'

// WRITTEN BY scripts/check-audit-gate.mjs AND DELETED BY IT. If you are reading this in a diff,
// a run was interrupted — delete the file; nothing depends on it.
describe('audit gate probe', () => {
  it('renders one offender per audit', async () => {
    document.body.innerHTML = \`
      <div class="bg-canvas">
        <span>42</span>
        <span class="uppercase">µLXC</span>
        <button>Go</button>
        <span>a ☃ snowman</span>
        <input placeholder="key prefix" />
        <span class="text-eyebrow">spent</span>
        <div class="bg-lens"><span class="text-muted">on an unclassified plane</span></div>
      </div>\`
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.textContent).toContain('42')
  })
})
`

const CLEAN = `import { describe, expect, it } from 'vitest'

// WRITTEN BY scripts/check-audit-gate.mjs AND DELETED BY IT. The must-stay-green half: it renders
// nothing, so a failure here is a broken harness rather than a caught offender.
describe('audit gate probe', () => {
  it('renders nothing at all', () => {
    expect(document.body.textContent).toBe('')
  })
})
`

function runProbe(source) {
  writeFileSync(PROBE, source)
  const r = spawnSync('npx', ['vitest', 'run', PROBE_REL], { cwd: appRoot, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function fail(msg) {
  console.error(`audit-gate: ${msg}`)
  process.exitCode = 1
}

if (existsSync(PROBE)) {
  console.error(
    `audit-gate: ${PROBE_REL} already exists. This script owns that path and would overwrite it — ` +
      'an interrupted run leaves it behind. Delete it and re-run.',
  )
  process.exit(1)
}

// ⚠ THE PINNED SET AND THE SOURCE COUNT MUST AGREE. A pinned list cannot see an audit that was
// added and never wired; a source count cannot see one that was deleted from the list. Holding
// both is this repo's answer, and it is the reason `AUDITS` is not just grepped out of the setup.
const reportBlocks = (readFileSync(SETUP, 'utf8').match(/problems\.push\(/g) ?? []).length
if (reportBlocks !== AUDITS.length) {
  fail(
    `test-setup.ts holds ${reportBlocks} report blocks and this script pins ${AUDITS.length} audits.\n` +
      '  An audit was added or removed. Update AUDITS in this file and prove the new one reaches ' +
      'the probe fixture — an audit that never reports is a rule nothing enforces.',
  )
  process.exit(1)
}

try {
  const clean = runProbe(CLEAN)
  if (clean.status !== 0) {
    fail(
      'the EMPTY probe failed, so this run cannot tell a caught offender from a broken harness.\n' +
        clean.out.split('\n').slice(-25).join('\n'),
    )
  } else {
    const armed = runProbe(ARMED)
    if (armed.status === 0) {
      fail(
        'THE AUDIT GATE DID NOT THROW. A probe rendering one offender for each of the seven DOM ' +
          'audits passed.\n' +
          "  test-setup.ts's `if (problems.length > 0) throw` is the single enforcement point for " +
          'ALL of them; with it disabled the whole suite stays green while the product ships the ' +
          'defects each rule exists to prevent.',
      )
    } else {
      const silent = AUDITS.filter(([, phrase]) => !armed.out.includes(phrase)).map(([name]) => name)
      if (silent.length > 0) {
        fail(
          `the gate threw, but ${silent.length} audit(s) never named themselves in it: ${silent.join(', ')}.\n` +
            '  Either its report block was removed from test-setup.ts, or the probe fixture no ' +
            'longer contains an offender it can see. Both are holes; neither is a pass.',
        )
      } else {
        console.log(
          `audit-gate: ok — the empty probe passes, the armed probe fails, and all ${AUDITS.length} ` +
            'audits named themselves in the failure.',
        )
      }
    }
  }
} finally {
  rmSync(PROBE, { force: true })
  if (existsSync(PROBE)) {
    console.error(
      `audit-gate: could not remove ${relative(appRoot, PROBE)} — it is inside vitest's include ` +
        'glob and will fail the next run. Remove it by hand.',
    )
    process.exitCode = 1
  }
}
