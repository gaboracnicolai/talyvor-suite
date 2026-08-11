// Guard against silent test loss (the #7 regression: a rebase conflict quietly
// replaced a 10-test file with a 1-test file, and every gate stayed green —
// a deleted test is indistinguishable from a passing one).
//
// ── ⚠ A TEST DOES NOT HAVE TO BE DELETED TO BE LOST, AND THE COUNT CANNOT SEE THE OTHER WAY ──
//
// The counts below come from `assertionResults.length`, and a SKIPPED test is still an
// assertionResult. So `.skip` removes a test's assertions from the run and moves NO number here.
//
// MEASURED at `389eff9`, one word changed — `describe(` → `describe.skip(` on Convert.test.tsx's
// "the conversion says what it actually cost", the three cases merged in #155 that state what the
// IRREVERSIBLE money action actually charged:
//
//     Tests  1060 passed | 3 skipped (1063)
//     test-manifest: ok (85 files, 1063 tests)
//     audit-reach: 72 components exported, 72 rendered ...
//     audit-gate: apps/web ok ... packages/ui ok
//     pnpm test   EXIT 0
//
// Every gate in this repo green, with the money assertions disabled. And it is WORSE than the
// deletion this file was written for: deleting them moves the count and produces the reviewable
// diff line in test-manifest.json that the design leans on — skipping them produces NO DIFF AT
// ALL, so there is nothing for a reviewer to see either.
//
// The rule added below is therefore not a second count. It is a claim about STATUS: a test that
// did not RUN is not a test that passed. It is written as an ALLOWLIST (`status !== 'passed'`)
// rather than a denylist of `skipped`/`todo`/`pending`, because a denylist is blind to the fourth
// status string, and vitest reports these two through DIFFERENT fields (`numPendingTests` for
// `.skip`, `numTodoTests` for `.todo`) — evidence that the set is not closed.
//
// ⚠ `--update` IS DELIBERATELY UNCHANGED and cannot bless a skip: the counts include skipped
// tests, so accepting a tree with one writes the SAME numbers and the check below still fires on
// the next `pnpm test`. It exits before this rule rather than being exempted from it.
//
// Form: a committed PER-FILE test-count manifest with lockfile semantics.
//   · Per-file, not a total — a total lets +5 here mask −5 there.
//   · Exact equality, not a floor — a floor permits silent loss down to it,
//     and a stale under-counting manifest IS a floor. Growth without a regen
//     fails too, which keeps the manifest honest.
//   · Counts come from the vitest JSON report (runtime tests), so `it.each`
//     expansion is measured truthfully — source-grepping `it(` would not.
//   · Any legitimate change is one command (`pnpm test:accept`) producing a
//     REVIEWABLE DIFF LINE in test-manifest.json. The "brittleness" of an
//     exact count is the feature: the diff line is the alert.
//
// ── ⚠ AND IT GUARDED ONE OF THIS REPO'S TWO VITEST PROJECTS ──────────────────────────────────
//
// This lived in apps/web/scripts and its manifest's 85 files were all apps/web's. `packages/ui`'s
// `test` script was a bare `vitest run` — 350 tests, no JSON report, no manifest, nothing counting
// them.
//
// MEASURED at `8ed03da`: one `it(...)` block deleted from
// packages/ui/src/__tests__/theme-storage.test.tsx —
//
//     packages/ui test:  Tests  349 passed (349)
//     apps/web  test:  test-manifest: ok (85 files, 1063 tests, all run)
//     pnpm test   EXIT 0
//
// — the #7 regression itself, verbatim, alive in the other project. `check-audit-gate.mjs` and
// `check-audit-reach.mjs` each learned that this repo has TWO projects and were widened; this
// guard, older than both, never was. Its own header said "silent test loss" without saying whose.
//
// So it takes the project directory as an ARGUMENT and lives at the repo root beside
// build-release.sh, which both apps already share for the same reason. It is not a helper apps/web
// lends to packages/ui: a package that reaches into an app's scripts directory has the dependency
// backwards.
//
// ⚠ THE DIRECTORY IS ASSERTED, NOT ASSUMED. A wrong or missing argument must fail LOUDLY: resolved
// against a directory with no package.json, every path below would simply be absent and the two
// honest outcomes — "the manifest is missing" and "you pointed me at nothing" — would be the same
// message. An instrument that reads nothing must never be able to report a clean product.
//
// Usage:  node ../../scripts/check-test-manifest.mjs .           (check; exit 1 on drift)
//         node ../../scripts/check-test-manifest.mjs . --update  (accept current counts)
// Run from the project directory. Reads its .vitest-report.json (`vitest run --reporter=json`).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const projectArg = process.argv[2]
if (projectArg === undefined || projectArg.startsWith('--')) {
  console.error(
    'test-manifest: needs the project directory as its first argument, e.g. ' +
      '`node ../../scripts/check-test-manifest.mjs .` — see the TWO PROJECTS note in this file.',
  )
  process.exit(1)
}
const appRoot = resolve(process.cwd(), projectArg)
if (!existsSync(resolve(appRoot, 'package.json'))) {
  console.error(
    `test-manifest: ${appRoot} holds no package.json, so it is not a project I can check. ` +
      'Every path below would be absent there and a missing manifest would read the same as a ' +
      'wrong argument.',
  )
  process.exit(1)
}
const label = relative(resolve(appRoot, '../..'), appRoot) || appRoot
const reportPath = resolve(appRoot, '.vitest-report.json')
const manifestPath = resolve(appRoot, 'test-manifest.json')

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch {
  console.error(`test-manifest: cannot read ${reportPath} — run vitest with --reporter=json first`)
  process.exit(1)
}

const actual = {}
for (const tr of report.testResults ?? []) {
  const file = relative(appRoot, tr.name)
  actual[file] = (actual[file] ?? 0) + (tr.assertionResults?.length ?? 0)
}

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(actual).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`test-manifest: ${label}: accepted ${Object.keys(sorted).length} files, ${Object.values(sorted).reduce((a, b) => a + b, 0)} tests`)
  process.exit(0)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch {
  console.error(`test-manifest: ${manifestPath} missing — run \`pnpm test:accept\` once and commit it`)
  process.exit(1)
}

const problems = []
let anyNotRun = false

// A test that did not RUN is not a test that passed — see the STATUS note in the header. Named
// one per test, with the status vitest gave it, because "SHRANK 12 → 9" would read as a deletion
// and send the next reader looking for a diff that does not exist.
for (const tr of report.testResults ?? []) {
  const file = relative(appRoot, tr.name)
  for (const a of tr.assertionResults ?? []) {
    if (a.status !== 'passed') {
      anyNotRun = true
      problems.push(
        `NOT RUN   ${file} > ${a.fullName ?? a.title} — vitest reports it "${a.status}". ` +
          'Its assertions did not execute; the count above cannot see that, and a skip leaves no ' +
          'manifest diff for a reviewer to see either.',
      )
    }
  }
}

for (const [file, want] of Object.entries(manifest)) {
  const got = actual[file]
  if (got === undefined) problems.push(`VANISHED  ${file}: ${want} tests in the manifest, file not in the run`)
  else if (got < want) problems.push(`SHRANK    ${file}: ${want} → ${got} tests`)
  else if (got > want) problems.push(`GREW      ${file}: ${want} → ${got} tests (accept with \`pnpm test:accept\`)`)
}
for (const file of Object.keys(actual)) {
  if (!(file in manifest)) problems.push(`NEW       ${file}: ${actual[file]} tests, not in the manifest (accept with \`pnpm test:accept\`)`)
}

if (problems.length > 0) {
  console.error(`test-manifest: ${label}: the test population changed without an accepted manifest:\n  ` + problems.join('\n  '))
  // ⚠ THE ADVICE IS PER-KIND. `pnpm test:accept` clears a count line; it CANNOT clear a NOT RUN
  // line — the counts include skipped tests, so accepting writes the same numbers and this fires
  // again. Saying "accept it" under a NOT RUN would send a reader to a command that does nothing.
  if (anyNotRun) {
    console.error(
      'A NOT RUN line is not accepted, it is un-skipped: remove the `.skip`/`.todo`, or delete ' +
        'the test outright and accept THAT — a deletion at least leaves a diff line to review.',
    )
  }
  console.error('If every COUNT line above is deliberate: `pnpm test:accept` and commit the test-manifest.json diff.')
  process.exit(1)
}
// "all run" is earned rather than decorative: any status other than `passed` is a problem above,
// so reaching this line is what proves it.
console.log(`test-manifest: ${label}: ok (${Object.keys(manifest).length} files, ${Object.values(manifest).reduce((a, b) => a + b, 0)} tests, all run)`)
