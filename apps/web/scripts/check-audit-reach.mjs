// EVERY COMPONENT THIS PRODUCT EXPORTS IS EITHER AUDITED OR CLASSIFIED — nothing is neither.
//
// ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
//
// test-setup.ts installs seven DOM audits (figure, case, focus, glyph, placeholder, plane,
// eyebrow) and states
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
// ── ⚠ THE SCOPE OF "NO TEST", MEASURED AFTER THIS SCRIPT HAD STATED IT WRONG ─────────────────
//
// This reads apps/web's shards. It is one of this repo's TWO vitest projects, and every sentence
// here that said "no test renders it" was a claim about the product made from one project. BOTH
// classified entries below are rendered by a test: components.test.tsx:46 renders HoldBar with a
// real hold window and promotions.test.tsx:34 renders FixtureNotice, both in packages/ui. The
// CONCLUSION each entry drew was right — at `3a96294` no audit had seen either, because
// packages/ui installed none — but the reason was false, and the false reason is what hid the
// fact that the fixture HoldBar's entry says nobody would write already existed.
//
// packages/ui now installs the same seven audits (packages/ui/src/__tests__/setup.ts) and
// check-audit-gate.mjs proves both projects' gates are armed. Unioning the two projects' reach
// shards is NOT done: reach-global-setup.ts clears the shard directory per vitest invocation and
// these are two invocations, so a union needs a shared directory and a clearing owner. Until
// then this measures apps/web, and the wording below says apps/web wherever it means apps/web.
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
 * COMPONENTS NO apps/web TEST RENDERS, each with the reason it is not a defect.
 *
 * A reason is a claim about the product, not an excuse. Both entries below are checkable by
 * reading the file named in them, which is the point: the day either stops being true, someone
 * removing the entry is what makes the guard speak.
 *
 * ⚠ AND BOTH REASONS HAD TO BE CORRECTED, WHICH IS THE ARGUMENT FOR THE RULE RATHER THAN AGAINST
 * IT: each one generalised from "no apps/web test commits it" to "nothing renders it", and both
 * ARE rendered — in packages/ui's project, whose setup installed no audits until this merge.
 */
const UNREACHED = {
  'packages/ui#HoldBar':
    'deliberately unwired. Its own header states the block: it needs a hold window ' +
    '(elapsed/total) and the Lens ledger exposes none — a held row has no start, end or ' +
    'finalize_after, and the window lives in Lens tables with no read endpoint. The held STATE ' +
    'reaches the product through <Pill status="held">. ⚠ THE FIXTURE THIS ENTRY ONCE SAID ' +
    'NOBODY WOULD WRITE ALREADY EXISTS: packages/ui/src/__tests__/components.test.tsx:46 renders ' +
    '<HoldBar elapsed={3} total={4} remainingLabel="1d left" />, and since that project gained ' +
    'the seven audits it is the ONLY place in this repo where they see this component at all.',
  'packages/ui#FixtureNotice':
    "REMOVAL CONDITION MET, and reported rather than acted on. Its own header says: \"The day " +
    'no screen renders one, delete it — an unproducible marker is dead surface.\" MEASURED at ' +
    'aa0421b: no apps/web module references it at all, and areas/docs/components.tsx has ' +
    'already invoked that same doctrine to delete FixtureChip and FixtureNote. Deleting a ' +
    'shared design-system component is a scope call for whoever owns the build-out period, so ' +
    'this records the fact and leaves the decision. See the W1.1 entry for this merge. ⚠ NO ' +
    'SCREEN renders one, which is what the removal condition asks; a TEST does — ' +
    'packages/ui/src/__tests__/promotions.test.tsx:34 — and that render is audited there.',
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
      `UNAUDITED  ${name} is exported and NO apps/web test renders it, so the seven DOM audits ` +
        'installed in THIS project have never looked at it. Render it on a surface test, or ' +
        'classify it in UNREACHED with the reason it cannot be. ⚠ Check packages/ui first — a ' +
        'component can be rendered by that project instead, which is a different answer from ' +
        'nothing rendering it and was the mistake both existing entries made.',
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
    "audit-reach: apps/web's tests do not reach every component this product exports:\n  " +
      problems.join('\n  '),
  )
  process.exit(1)
}

console.log(
  `audit-reach: ${registered.size} components exported, ${committed.size} rendered under ` +
    `apps/web's audits, ${Object.keys(UNREACHED).length} classified (${shards.length} workers).`,
)
