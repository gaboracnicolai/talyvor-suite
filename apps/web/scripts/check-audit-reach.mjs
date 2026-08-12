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
// This used to read apps/web's shards ALONE. That is one of this repo's TWO vitest projects, and
// every sentence here saying "no test renders it" was a claim about the product made from one
// project. `224bdee` measured it: BOTH components this table classified were rendered by a test —
// components.test.tsx:46 renders HoldBar with a real hold window, promotions.test.tsx:34 renders
// FixtureNotice — in packages/ui, whose setup installed no audits at all. Each entry's CONCLUSION
// was right and its REASON was false, and the false reason is what hid the fact that the fixture
// HoldBar's entry said nobody would write already existed.
//
// That merge closed the audits' half and left this one open in writing: "the two projects' reach
// shards are not unioned … reach measures apps/web and says apps/web". It now reads BOTH. Each
// project clears and writes its OWN directory — a shared one would be cleared out from under
// packages/ui, which `pnpm -r test` runs FIRST — and each is held to its OWN floors before the
// union, so a dead half cannot be vouched for by a live one.
//
// ⚠ THE UNION EMPTIED THE TABLE, WHICH IS THE SECOND DIRECTION WORKING. With packages/ui's shards
// read, both entries reported STALE and were deleted. The two facts they carried are not lost and
// are not this guard's to hold:
//   · HoldBar is deliberately unwired — it needs a hold window (elapsed/total) and the Lens ledger
//     exposes none. Its own header and README §Blocked components carry that, and the held STATE
//     reaches the product through <Pill status="held">.
//   · FixtureNotice's REMOVAL CONDITION is met — "the day no screen renders one, delete it".
//     MEASURED at aa0421b and still true: no apps/web module references it. A test renders it; no
//     screen does. Deleting a shared design-system component is a scope call, so it is reported
//     and left. See the W1.1 queue entry.
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
// ── ⚠ WHO INVOKES THIS, AND WHY IT IS NOT apps/web ───────────────────────────
//
// It reads TWO directories and neither is written by the caller alone: each project clears and
// writes its OWN, once per ITS OWN vitest run. So this is a claim about a run of BOTH projects,
// and it is invoked from the ROOT `test` script — `pnpm -r test && node …` — which is the only
// command that produces both halves, in either order, before asking.
//
// It used to hang off `apps/web`'s own `test` script, which cannot satisfy that precondition.
// MEASURED on `ed0425d` with `git status` EMPTY, in both directions:
//   · `cd apps/web && npm run test` EXITED 1 on a tree nobody had touched, blaming packages/ui's
//     DevTools hook — FALSELY: that project had simply last run something else. A gate red for a
//     reason unrelated to the diff is a gate the next session learns to ignore.
//   · Worse, with packages/ui's shards fresh and then HoldBar's ONLY render DELETED from the
//     source, it printed "73 rendered under the audits in 2 projects" and EXITED 0. Re-running
//     packages/ui alone turned it red on the same source. The verdict about the other project was
//     a function of when that project last ran. .gitignore's per-run clearing exists to stop
//     precisely that and cannot reach across a project boundary.
// apps/web/src/reachGateScope.test.ts pins both halves of the rule.
//
// ⚠ RUNNING IT BY HAND IS STILL AS TRUSTWORTHY AS THE LAST RUN OF EACH PROJECT. Nothing here can
// tell a shard written a second ago from one written yesterday — the two projects are two vitest
// invocations and share no run identity. Run the ROOT `pnpm test`, never this script alone.
//
// Usage:  node apps/web/scripts/check-audit-reach.mjs   (from the root `test` script, after both)
// Reads .reach/*.json, written once per worker by each project's test setup.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const appRoot = resolve(new URL('..', import.meta.url).pathname)

/**
 * THE TWO SHARD DIRECTORIES, EACH WITH ITS OWN FLOORS.
 *
 * ⚠ THE FLOORS ARE PER-SOURCE, AND WHAT THAT BUYS WAS MEASURED RATHER THAN ASSERTED. The first
 * version of this comment said the per-source floors are what stands between a dead half and a
 * green run — union first, and apps/web's shards alone satisfy "Button was committed" while
 * packages/ui recorded nothing. R4 of scripts/w11-reach-union-controls.py was written to prove
 * that and REFUTED IT: with packages/ui's hook blinded and the floor asked of the union, the run
 * still fails, on UNAUDITED, because emptying the classification table left HoldBar and
 * FixtureNotice with no cover.
 *
 * ⚠ AND THE SECOND VERSION WAS WRONG TOO. It then claimed the FLOOR line would be absent on the
 * union. It is not: packages/ui's literals below name HoldBar and FixtureNotice, which apps/web
 * NEVER commits, so no live half can vouch for them however the loop is written.
 *
 * WHAT IS ACTUALLY TRUE, and what the literals below are chosen for: the ui half is unfakeable
 * because its floor names components ONLY this project renders. The per-source loop is what makes
 * that hold for the literal the two projects SHARE — `packages/ui#Button` — and R4 isolates it by
 * narrowing the ui floor to Button alone: on the union the checker then blames the PRODUCT
 * ("HoldBar is exported and NO test renders it", false — a test does) and never names the
 * instrument that recorded nothing. A wrong diagnosis is what costs the next session an hour.
 *
 * ⚠ AND EACH IS NAMED BY LITERAL STRING, never derived from the registry or from a count: a guard
 * that asks a set about itself passes for every value of that set.
 *
 * packages/ui's floor names the two components that exist ONLY in its project — they are what a
 * dead ui half would silently drop, and they are exactly the two this table used to classify as
 * rendered by nothing.
 */
const SOURCES = [
  {
    label: 'apps/web',
    dir: resolve(appRoot, '.reach'),
    /** Two from each half: the registry is built from a package import AND an eager glob, and
     *  either can fail alone. */
    mustRegister: [
      'packages/ui#Button',
      'packages/ui#MuNumeral',
      'apps/web/src/areas/lens/Overview.tsx#Overview',
      'apps/web/src/areas/marketing/Landing.tsx#Landing',
    ],
    /** Registration alone proves the glob ran; these prove the HOOK ran, the independent half. */
    mustCommit: [
      'packages/ui#Button',
      'packages/ui#MuNumeral',
      'apps/web/src/areas/lens/Overview.tsx#Overview',
      'apps/web/src/areas/marketing/Landing.tsx#Landing',
    ],
  },
  {
    label: 'packages/ui',
    dir: resolve(appRoot, '../../packages/ui/.reach'),
    mustRegister: ['packages/ui#Button', 'packages/ui#HoldBar'],
    mustCommit: ['packages/ui#Button', 'packages/ui#HoldBar', 'packages/ui#FixtureNotice'],
  },
]

/**
 * COMPONENTS NO TEST IN EITHER PROJECT RENDERS, each with the reason it is not a defect.
 *
 * A reason is a claim about the product, not an excuse. Any entry here must be checkable by
 * reading the file named in it, which is the point: the day it stops being true, someone removing
 * the entry is what makes the guard speak.
 *
 * ⚠ EMPTY, AND EMPTY IS A RESULT RATHER THAN A DEFAULT. Both entries this table used to hold were
 * deleted BY the STALE direction once packages/ui's shards were read — see the header. An empty
 * table means every component this product exports is rendered under the audits by some test in
 * some project; it does NOT mean nobody has looked.
 */
const UNREACHED = {}

const registered = new Set()
const committed = new Set()
const problems = []
let totalShards = 0

for (const source of SOURCES) {
  let shards
  try {
    shards = readdirSync(source.dir).filter((f) => f.endsWith('.json'))
  } catch {
    console.error(
      `audit-reach: ${source.dir} does not exist. It is written by ${source.label}'s test setup ` +
        'during a vitest run; run `vitest run` over BOTH projects before this script.',
    )
    process.exit(1)
  }
  if (shards.length === 0) {
    console.error(
      `audit-reach: ${source.dir} holds no shards. ${source.label} recorded nothing, which is ` +
        'what a hook installed after react-dom looks like — see the ORDER note in ' +
        'src/reachAudit.ts.',
    )
    process.exit(1)
  }
  totalShards += shards.length

  const here = { registered: new Set(), committed: new Set() }
  for (const shard of shards) {
    const d = JSON.parse(readFileSync(resolve(source.dir, shard), 'utf8'))
    for (const c of d.registered ?? []) here.registered.add(c)
    for (const c of d.committed ?? []) here.committed.add(c)
  }

  // ⚠ ASKED OF THIS SOURCE ALONE, BEFORE ANYTHING IS UNIONED — see the SOURCES header.
  for (const name of source.mustRegister) {
    if (!here.registered.has(name)) {
      problems.push(
        `FLOOR      ${name} is not in ${source.label}'s registry. That project stopped seeing ` +
          'part of the product; every "unreached" answer below is unsafe until it is fixed.',
      )
    }
  }
  for (const name of source.mustCommit) {
    if (!here.committed.has(name)) {
      problems.push(
        `FLOOR      ${name} was registered by ${source.label} but never recorded as committed. ` +
          "That project's DevTools hook is not receiving commits — an empty record reads as " +
          '"everything is reached".',
      )
    }
  }

  for (const c of here.registered) registered.add(c)
  for (const c of here.committed) committed.add(c)
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
    'audit-reach: the seven DOM audits do not reach every component this product exports:\n  ' +
      problems.join('\n  '),
  )
  process.exit(1)
}

console.log(
  `audit-reach: ${registered.size} components exported, ${committed.size} rendered under the ` +
    `audits in ${SOURCES.length} projects, ${Object.keys(UNREACHED).length} classified ` +
    `(${totalShards} workers).`,
)
