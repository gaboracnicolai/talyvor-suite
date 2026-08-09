// EVERY COMPONENT THIS PRODUCT EXPORTS IS EITHER AUDITED OR CLASSIFIED — nothing is neither.
//
// ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
//
// test-setup.ts installs five DOM audits (figure, case, focus, glyph, placeholder) and states
// their reach in one sentence: "A surface with no test is audited by nothing." Every finding
// those audits have produced — money in the body sans, MLXC on the marketing page, nine controls
// wearing the browser's focus ring, three placeholders painted by Chrome — was found in a
// component that some test happened to render. Which components those are was never measured, so
// the audits' own coverage was the one claim in this system with no instrument behind it.
//
// src/reachAudit.ts records, by function identity, every component React COMMITS during the run.
// This script unions the per-worker shards and holds the answer to a rule with two directions:
//
//   · a registered component that no test renders FAILS until it is rendered or classified here
//   · a classified component that a test now renders FAILS as stale
//
// The second direction is the one that keeps the table honest. Without it a reason written once
// stays written after it stops being true, which is the shape `awaiting.ts` exists to close on
// the other side of the product.
//
// ── WHY THE FLOORS ARE HARDCODED LITERALS ────────────────────────────────────
//
// The dangerous failure is not a wrong answer, it is an empty one: a hook installed after
// react-dom, a registry whose glob stopped matching, a shard directory nobody wrote. Every one
// of those produces "0 registered, 0 committed", and `registered - committed` is then EMPTY —
// the guard's green state. So the floors below name components by literal string. They are
// deliberately not read from the registry, computed from a count, or derived from anything this
// script also checks: a guard that asks a set about itself passes for every value of that set.
//
// Usage:  node scripts/check-audit-reach.mjs        (after a FULL `vitest run`)
// Reads .reach/*.json, written once per worker by test-setup.ts's afterAll.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const appRoot = resolve(new URL('..', import.meta.url).pathname)
const reachDir = resolve(appRoot, '.reach')

/**
 * COMPONENTS NO TEST RENDERS, each with the reason it is not a defect.
 *
 * A reason is a claim about the product, not an excuse. Both entries below are checkable by
 * reading the file named in them, which is the point: the day either stops being true, someone
 * removing the entry is what makes the guard speak.
 */
const UNREACHED = {
  'packages/ui#HoldBar':
    'deliberately unwired. Its own header states the block: it needs a hold window ' +
    '(elapsed/total) and the Lens ledger exposes none — a held row has no start, end or ' +
    'finalize_after, and the window lives in Lens tables with no read endpoint. The held STATE ' +
    'reaches the product through <Pill status="held">. Rendering it in a test to satisfy this ' +
    'guard would audit a fixture nothing produces.',
  'packages/ui#FixtureNotice':
    "REMOVAL CONDITION MET, and reported rather than acted on. Its own header says: \"The day " +
    'no screen renders one, delete it — an unproducible marker is dead surface.\" MEASURED at ' +
    'aa0421b: no apps/web module references it at all, and areas/docs/components.tsx has ' +
    'already invoked that same doctrine to delete FixtureChip and FixtureNote. Deleting a ' +
    'shared design-system component is a scope call for whoever owns the build-out period, so ' +
    'this records the fact and leaves the decision. See the W1.1 entry for this merge.',
}

/** Components that must be REGISTERED, named literally. Two from each half: the registry is
 *  built from a package import AND an eager glob, and either can fail alone. */
const MUST_REGISTER = [
  'packages/ui#Button',
  'packages/ui#MuNumeral',
  'apps/web/src/areas/lens/Overview.tsx#Overview',
  'apps/web/src/areas/marketing/Landing.tsx#Landing',
]

/** Components that must be COMMITTED, named literally. Registration alone proves the glob ran;
 *  these prove the HOOK ran, which is the independent half. */
const MUST_COMMIT = [
  'packages/ui#Button',
  'packages/ui#MuNumeral',
  'apps/web/src/areas/lens/Overview.tsx#Overview',
  'apps/web/src/areas/marketing/Landing.tsx#Landing',
]

let shards
try {
  shards = readdirSync(reachDir).filter((f) => f.endsWith('.json'))
} catch {
  console.error(
    `audit-reach: ${reachDir} does not exist. It is written by test-setup.ts during a vitest ` +
      'run; run `vitest run` over the whole suite before this script.',
  )
  process.exit(1)
}

if (shards.length === 0) {
  console.error(
    `audit-reach: ${reachDir} holds no shards. The run recorded nothing, which is what a hook ` +
      'installed after react-dom looks like — see the ORDER note in src/reachAudit.ts.',
  )
  process.exit(1)
}

const registered = new Set()
const committed = new Set()
for (const shard of shards) {
  const d = JSON.parse(readFileSync(resolve(reachDir, shard), 'utf8'))
  for (const c of d.registered ?? []) registered.add(c)
  for (const c of d.committed ?? []) committed.add(c)
}

const problems = []

for (const name of MUST_REGISTER) {
  if (!registered.has(name)) {
    problems.push(
      `FLOOR      ${name} is not in the registry. src/reachRegistry.ts stopped seeing part of ` +
        'the product; every "unreached" answer below is unsafe until that is fixed.',
    )
  }
}
for (const name of MUST_COMMIT) {
  if (!committed.has(name)) {
    problems.push(
      `FLOOR      ${name} was registered but never recorded as committed. The DevTools hook is ` +
        'not receiving commits — an empty record reads as "everything is reached".',
    )
  }
}

for (const name of [...registered].sort()) {
  const why = UNREACHED[name]
  const rendered = committed.has(name)
  if (!rendered && why === undefined) {
    problems.push(
      `UNAUDITED  ${name} is exported and NO test renders it, so none of the five DOM audits ` +
        'has ever looked at it. Render it on a surface test, or classify it in UNREACHED with ' +
        'the reason it cannot be.',
    )
  }
  if (rendered && why !== undefined) {
    problems.push(
      `STALE      ${name} is listed in UNREACHED but a test now renders it. Delete its entry — ` +
        'the reason stopped being true and a reason nobody re-reads is the thing this guard is ' +
        'for.',
    )
  }
}

for (const name of Object.keys(UNREACHED)) {
  if (!registered.has(name)) {
    problems.push(
      `GONE       ${name} is listed in UNREACHED but is not exported any more. Delete its entry.`,
    )
  }
}

if (problems.length > 0) {
  console.error(
    'audit-reach: the five DOM audits do not reach every component this product exports:\n  ' +
      problems.join('\n  '),
  )
  process.exit(1)
}

console.log(
  `audit-reach: ${registered.size} components exported, ${committed.size} rendered under the ` +
    `audits, ${Object.keys(UNREACHED).length} classified (${shards.length} workers).`,
)
