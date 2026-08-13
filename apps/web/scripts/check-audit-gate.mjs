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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

const appRoot = resolve(new URL('..', import.meta.url).pathname)

/**
 * How many times a setup file CALLS `problems.push`, counted from the parse tree.
 *
 * ⚠ THE FLOOR IS NOT DECORATION. A parse that yields nothing — a renamed file, a syntax error, a
 * future setup that collects through a helper instead — returns 0, and 0 is a number that would
 * sail through any "did it change" comparison against a pinned list only if the pinned list were
 * also 0. It is not: `AUDITS` is eight, so a hollow parse fails the comparison loudly. The
 * separate message below exists so the reader is told WHICH failure it is, because "holds 0 report
 * blocks" and "holds 7 report blocks" have completely different repairs.
 */
function countPushCalls(setupPath) {
  const sf = ts.createSourceFile(
    setupPath,
    readFileSync(setupPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  )
  let n = 0
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'problems' &&
      node.expression.name.text === 'push'
    ) {
      n += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return n
}

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

  // ⚠ THE PROBE IS A REAL VITEST RUN, SO IT CLEARS THAT PROJECT'S REACH SHARDS — the global setup
  // does it unconditionally, and it is right to. MEASURED at `ed0425d`: a full `pnpm -r test`
  // left 93/904 shards/commits in apps/web and 11/19 in packages/ui, and this script reduced BOTH
  // to one shard and zero commits. check-audit-reach.mjs then reads that and reports "that
  // project's DevTools hook is not receiving commits" — a false diagnosis of an emptiness this
  // script caused. It was invisible because reach ran one line EARLIER in the same script chain:
  // the union check's green was a property of its position in a command line.
  //
  // REACH_SHARD_DIR sends the probe's shards somewhere else. The probe still gets cleared and
  // recorded exactly as any run does; it just stops writing over the evidence of the real one.
  const probeShardDir = '.reach-probe'
  const runProbe = (source) => {
    writeFileSync(probePath, source)
    const r = spawnSync('npx', ['vitest', 'run', project.probe], {
      cwd: project.root,
      encoding: 'utf8',
      env: { ...process.env, REACH_SHARD_DIR: probeShardDir },
    })
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }

  // ⚠ AND THE REDIRECTION IS CHECKED, NEVER TRUSTED. A variable a setup stops reading, or a spawn
  // that stops passing it, restores the old behaviour silently — the run stays green and the NEXT
  // guard is the one that reports a false failure. So the real directory's shard listing is taken
  // before and after, and a change is this script's own failure to report.
  const realShardDir = resolve(project.root, '.reach')
  const shardListing = () => {
    try {
      return readdirSync(realShardDir).sort().join(',')
    } catch {
      return '<absent>'
    }
  }
  const shardsBefore = shardListing()

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
  // ⚠ THE `^\s*` ANCHOR EXCLUDED PROSE BY ACCIDENT OF POSITION, AND EXCLUDED REAL REPORTS WITH IT.
  // It was introduced for a true reason: packages/ui's setup EXPLAINS this rule and names the call
  // in prose, and unanchored the count read 8 blocks in a file holding 7. But `^\s*problems\.push\(`
  // asks "does a line BEGIN with the call", and the answer is no for
  //
  //     if (orphaned.length > 0) problems.push(`…`)
  //
  // which is ordinary JavaScript and a perfectly ordinary way to wire a ninth audit. MEASURED at
  // `f797d7d`: apps/web's setup held 8 line-anchored and 8 total; packages/ui's held 8 line-anchored
  // and 9 total, the ninth being the prose sentence — so the anchor was carrying the prose exclusion
  // and the one-line blindness on the same character. C3 of scripts/w11-audit-gate-controls.py is
  // the control for exactly this and it had been scoring NOT CAUGHT, unnoticed, because nothing
  // re-ran the harness after the anchor landed.
  //
  // ⚠ SO THE COUNT IS TAKEN FROM THE PARSE TREE, NOT FROM TEXT. `problems.push` is counted as CALL
  // EXPRESSIONS, which excludes comments and string literals BY CONSTRUCTION rather than by where
  // the token happens to sit. The prose sentence in packages/ui stays exactly where it is and stays
  // uncounted, and C9 plants the same shape in apps/web as a `//` line so that a future "simplify
  // this back to a regex" reds instead of passing quietly.
  const reportBlocks = countPushCalls(setupPath)
  if (reportBlocks === 0) {
    fail(
      `${project.label}: ${project.setup} holds 0 report blocks — the count read NOTHING.\n` +
        '  This is the hollow-instrument case, not the drift case: the file was renamed or moved, ' +
        'it no longer parses, or the audits stopped collecting through `problems.push`. Fix the ' +
        'reader before reading anything into the number.',
    )
    return
  }
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
    rmSync(resolve(project.root, probeShardDir), { recursive: true, force: true })
    // Asked on EVERY exit path, including the early returns above: a probe that failed still ran.
    if (shardListing() !== shardsBefore) {
      fail(
        `${project.label}: this script changed ${relative(project.root, realShardDir)} — the probe ` +
          'run wrote over the reach shards of the run that preceded it.\n' +
          '  check-audit-reach.mjs would then report that project\'s DevTools hook as broken, ' +
          'which would be this script\'s doing and not the product\'s. REACH_SHARD_DIR is meant to ' +
          `prevent it: check that ${project.setup}'s sibling reach-global-setup still reads it and ` +
          'that runProbe still passes it.',
      )
    }
  }
}

// ⚠ EVERY PROJECT IS CHECKED EVEN AFTER ONE FAILS. Stopping at the first would report the second
// project's state as unknown while printing a failure that looks complete.
for (const project of PROJECTS) checkProject(project)
