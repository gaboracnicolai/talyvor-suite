// THE EIGHT DOM AUDITS HAVE ONE ENFORCEMENT POINT AND NOTHING CHECKED THAT IT THROWS.
//
// `test-setup.ts` collects offenders from all eight audits — figure, case, focus, glyph,
// placeholder, eyebrow, plane, field — into one `problems` array and ends with a single line:
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
// ── AND IT RUNS AGAINST BOTH PROJECTS, BECAUSE ONE OF THEM HAD NO GATE AT ALL ────────────────
//
// This repo has TWO vitest projects. Everything above was wired into apps/web; `packages/ui`'s
// setup was one line (`import '@testing-library/jest-dom/vitest'`), so its 335 tests rendered
// Button, Pill, NavItem, MuNumeral, Switch, TierDot, Mark, HoldBar and FixtureNotice under no
// audit. MEASURED at `3a96294`: the ARMED fixture below — the same seven offenders — was written
// into packages/ui/src/__tests__/ and PASSED. Seven rules, an entire package, and the instrument
// that exists to prove they are armed was pointed at one project.
//
// ⚠ THE REACH GUARD COULD NOT HAVE SAID SO, and its wording claimed the opposite: it reads
// apps/web's shards only, and told anyone reading its failure text that a component "is exported
// and NO test renders it" — while components.test.tsx:46 rendered HoldBar and promotions.test.tsx:34
// rendered FixtureNotice, the two it classifies. See check-audit-reach.mjs.
//
// So PROJECTS below is a table, the probe runs in each, and each project's own setup must hold a
// report block for every audit in AUDITS. An eighth audit wired into one setup and forgotten in
// the other fails the count for that project by name.
//
// ── WHAT IT DOES ─────────────────────────────────────────────────────────────────────────────
//
//  1. NEGATIVE HALF FIRST. Runs a probe that renders NOTHING and requires it to PASS. Without
//     this, "the armed run failed" and "vitest is broken" are the same observation — the trap
//     `319335c`'s C3 paid for, where a broken build scored as a catch.
//  2. ARMED HALF. Runs a probe rendering ONE offender per audit and requires it to FAIL.
//  3. Requires every one of the eight audits to have NAMED ITSELF in the output, as a SET both
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

/**
 * The vitest projects that install the audits, and where each one keeps its enforcement point.
 *
 * ⚠ THE PROBE PATH MUST BE INSIDE THAT PROJECT'S `include` GLOB or the run passes by collecting
 * nothing — a green that means "no test matched". apps/web includes `src/**` and packages/ui
 * includes `src/**`, and each path below is checked against a real armed run, not read off the
 * config.
 */
const PROJECTS = [
  {
    label: 'apps/web',
    root: appRoot,
    setup: 'src/test-setup.ts',
    probe: 'src/auditGateProbe.test.ts',
  },
  {
    label: 'packages/ui',
    root: resolve(appRoot, '../../packages/ui'),
    setup: 'src/__tests__/setup.ts',
    probe: 'src/__tests__/auditGateProbe.test.ts',
  },
]

/**
 * The eight audits, each matched by the OPENING PHRASE OF ITS OWN REPORT BLOCK.
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
  ['field', 'numeric field(s) whose value is painted in the body sans'],
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
        <input inputmode="decimal" value="12.5" />
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

function fail(msg) {
  console.error(`audit-gate: ${msg}`)
  process.exitCode = 1
}

function checkProject(project) {
  const probePath = resolve(project.root, project.probe)
  const setupPath = resolve(project.root, project.setup)

  const runProbe = (source) => {
    writeFileSync(probePath, source)
    const r = spawnSync('npx', ['vitest', 'run', project.probe], {
      cwd: project.root,
      encoding: 'utf8',
    })
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }

  if (existsSync(probePath)) {
    fail(
      `${project.label}: ${project.probe} already exists. This script owns that path and would ` +
        'overwrite it — an interrupted run leaves it behind. Delete it and re-run.',
    )
    return
  }

  // ⚠ THE PINNED SET AND THE SOURCE COUNT MUST AGREE. A pinned list cannot see an audit that was
  // added and never wired; a source count cannot see one that was deleted from the list. Holding
  // both is this repo's answer, and it is the reason `AUDITS` is not just grepped out of the
  // setup. It is asked of EACH project: the two setups are deliberate copies of the reporting,
  // so an audit added to one and forgotten in the other is exactly the drift this catches.
  //
  // ⚠ THE ANCHOR IS LOAD-BEARING AND WAS PAID FOR. Unanchored, this matched the phrase inside a
  // PROSE SENTENCE — packages/ui's setup explains this very rule and named the call in it — and
  // reported 8 blocks for a file holding 7. A source count that reads documentation grows with
  // documentation. That sentence is still there on purpose: it is the fixture that keeps `^\s*`
  // honest, so deleting the anchor fails the run rather than passing quietly.
  const reportBlocks = (readFileSync(setupPath, 'utf8').match(/^\s*problems\.push\(/gm) ?? []).length
  if (reportBlocks !== AUDITS.length) {
    fail(
      `${project.label}: ${project.setup} holds ${reportBlocks} report blocks and this script ` +
        `pins ${AUDITS.length} audits.\n` +
        '  An audit was added or removed. Update AUDITS in this file and prove the new one reaches ' +
        'the probe fixture — an audit that never reports is a rule nothing enforces.',
    )
    return
  }

  try {
    const clean = runProbe(CLEAN)
    if (clean.status !== 0) {
      fail(
        `${project.label}: the EMPTY probe failed, so this run cannot tell a caught offender from ` +
          'a broken harness.\n' +
          clean.out.split('\n').slice(-25).join('\n'),
      )
      return
    }
    const armed = runProbe(ARMED)
    if (armed.status === 0) {
      fail(
        `${project.label}: THE AUDIT GATE DID NOT THROW. A probe rendering one offender for each ` +
          'of the eight DOM audits passed.\n' +
          `  ${project.setup}'s \`if (problems.length > 0) throw\` is the single enforcement point ` +
          'for ALL of them; with it disabled the whole suite stays green while the product ships ' +
          'the defects each rule exists to prevent.',
      )
      return
    }
    const silent = AUDITS.filter(([, phrase]) => !armed.out.includes(phrase)).map(([name]) => name)
    if (silent.length > 0) {
      fail(
        `${project.label}: the gate threw, but ${silent.length} audit(s) never named themselves ` +
          `in it: ${silent.join(', ')}.\n` +
          `  Either its report block was removed from ${project.setup}, or the probe fixture no ` +
          'longer contains an offender it can see. Both are holes; neither is a pass.',
      )
      return
    }
    console.log(
      `audit-gate: ${project.label} ok — the empty probe passes, the armed probe fails, and all ` +
        `${AUDITS.length} audits named themselves in the failure.`,
    )
  } finally {
    rmSync(probePath, { force: true })
    if (existsSync(probePath)) {
      console.error(
        `audit-gate: could not remove ${relative(project.root, probePath)} — it is inside ` +
          "vitest's include glob and will fail the next run. Remove it by hand.",
      )
      process.exitCode = 1
    }
  }
}

// ⚠ EVERY PROJECT IS CHECKED EVEN AFTER ONE FAILS. Stopping at the first would report the second
// project's state as unknown while printing a failure that looks complete.
for (const project of PROJECTS) checkProject(project)
