// Guard against silent test loss (the #7 regression: a rebase conflict quietly
// replaced a 10-test file with a 1-test file, and every gate stayed green —
// a deleted test is indistinguishable from a passing one).
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
// Usage:  node scripts/check-test-manifest.mjs           (check; exit 1 on drift)
//         node scripts/check-test-manifest.mjs --update  (accept current counts)
// Reads .vitest-report.json written by `vitest run --reporter=json`.

import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const appRoot = resolve(new URL('..', import.meta.url).pathname)
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
  console.log(`test-manifest: accepted ${Object.keys(sorted).length} files, ${Object.values(sorted).reduce((a, b) => a + b, 0)} tests`)
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
  console.error('test-manifest: the test population changed without an accepted manifest:\n  ' + problems.join('\n  '))
  console.error('If every line above is deliberate: `pnpm test:accept` and commit the test-manifest.json diff.')
  process.exit(1)
}
console.log(`test-manifest: ok (${Object.keys(manifest).length} files, ${Object.values(manifest).reduce((a, b) => a + b, 0)} tests)`)
