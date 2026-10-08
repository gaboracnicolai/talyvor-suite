import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coveredScenarios } from '../src/filing.ts'
import type { ReportedRun } from '../src/report.ts'
import { FIRST_INTRO, FIRST_SECTION, raiseFailing, raiseItems, streaks } from '../src/streak.ts'

type Status = ReportedRun['outcomes'][number]['status']

function run(at: string, verdicts: Record<string, Status[]>): ReportedRun {
  const outcomes = Object.entries(verdicts).flatMap(([scenario, ss]) =>
    ss.map((status, user) => ({ scenario, title: scenario, user, workspace: `ws${user}`, status, detail: status, evidence: [] })))
  return {
    started_at: at, finished_at: at, app: 'https://app', lens: 'https://lens', users: 2, model: 'm', cap_usd: 1, spent_usd: 0,
    stopped_at_cap: false, counts: { PASS: 0, FAIL: 0, SKIP: 0, ERROR: 0 }, outcomes,
  }
}

const QUEUE = `# TALYVOR BUILD QUEUE — FEATURES ONLY

Read BUILDPROMPT.txt first.

# B36 — NICOLAI'S REQUEST

## B36.1 — the hero photograph
repo: talyvor-suite · deps: none · status: OPEN
Body.

# B17 — THE TESTERS' FINDINGS

## B17.40 — the testers found it: a spending limit
repo: talyvor-lens · deps: none · status: OPEN
Filed by the e2e run.
e2e-scenario: spending-limit
DONE = it passes.

## B17.41 — the testers found it: the ledger
repo: talyvor-lens · deps: none · status: OPEN
e2e-scenario: ledger-call-once
DONE = it passes.
`

describe('B28.296 — a scenario FAILing three runs running is first in the queue', () => {
  it('counts the runs running that FAILed a scenario: one user is enough, a PASS breaks it, a run that skipped it does not', () => {
    const latest = run('2026-10-08T20:00:00.000Z', { 'spending-limit': ['PASS', 'FAIL'], 'ledger-call-once': ['FAIL'], 'known-answer': ['PASS'] })
    const earlier = [
      run('2026-10-08T12:00:00.000Z', { 'spending-limit': ['FAIL'], 'ledger-call-once': ['SKIP', 'ERROR'] }),
      run('2026-10-07T20:00:00.000Z', { 'spending-limit': ['FAIL'], 'ledger-call-once': ['PASS'] }),
      run('2026-10-06T20:00:00.000Z', { 'spending-limit': ['FAIL'], 'ledger-call-once': ['FAIL'] }),
      run('2026-10-05T20:00:00.000Z', { 'spending-limit': ['PASS'] }),
    ]
    expect(Object.fromEntries(streaks(latest, earlier))).toEqual({
      'spending-limit': { runs: 4, since: '2026-10-06T20:00:00.000Z' },
      'ledger-call-once': { runs: 1, since: '2026-10-08T20:00:00.000Z' },
    })
  })

  it('moves the item to a section above every other, under its repo line, and changes nothing else', () => {
    const why = '⚠ First in the queue (B28.296): `spending-limit` has FAILED 3 runs running.'
    const { text, moved } = raiseItems(QUEUE, [{ item: 'B17.40', why }])
    expect(moved).toEqual(['B17.40'])
    expect(text.indexOf(FIRST_SECTION)).toBeLessThan(text.indexOf('# B36 —'))
    expect(text.indexOf('## B17.40 —')).toBeLessThan(text.indexOf('## B36.1 —'))
    expect(text).toContain(`## B17.40 — the testers found it: a spending limit\nrepo: talyvor-lens · deps: none · status: OPEN\n${why}\nFiled by the e2e run.\n`)
    // The loop's own reading of the queue is unchanged but for the order: every item, its repo line, its markers.
    const items = (md: string) => [...md.matchAll(/^## (B\d+\.\d+)[^\n]*\nrepo: ([^\n]*)/gm)].map((m) => `${m[1]} ${m[2]}`).sort()
    expect(items(text)).toEqual(items(QUEUE))
    expect([...coveredScenarios(text)].sort()).toEqual([...coveredScenarios(QUEUE)].sort())
    const kept = (md: string) => md.split('\n').filter((l) => l.trim() !== '').sort()
    expect(kept(text)).toEqual(kept(QUEUE).concat(FIRST_SECTION, why, FIRST_INTRO).sort())
    // Raised again, it stays where it is; a second item goes below the first.
    const again = raiseItems(text, [{ item: 'B17.40', why }, { item: 'B17.41', why: 'second' }])
    expect(again.moved).toEqual(['B17.41'])
    expect(again.text.indexOf('## B17.40 —')).toBeLessThan(again.text.indexOf('## B17.41 —'))
    expect(again.text.indexOf('## B17.41 —')).toBeLessThan(again.text.indexOf('# B36 —'))
  })

  it('the run that sees the third FAIL in a row moves the item in BUILD.md; two in a row move nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'streak-'))
    const md = join(dir, 'BUILD.md')
    await writeFile(md, QUEUE)
    for (const at of ['2026-10-06T20:00:00.000Z', '2026-10-07T20:00:00.000Z']) {
      await writeFile(join(dir, `run-${at.replace(/[:.]/g, '-')}.json`), JSON.stringify(run(at, { 'spending-limit': ['FAIL'] })))
    }
    expect(await raiseFailing(md, dir, run('2026-10-07T20:00:00.001Z', { 'known-answer': ['PASS'] }))).toEqual([])
    const second = await raiseFailing(md, join(dir, 'none'), run('2026-10-08T20:00:00.000Z', { 'spending-limit': ['FAIL'] }))
    expect(second).toEqual([])
    expect(await readFile(md, 'utf8')).toBe(QUEUE)

    const raised = await raiseFailing(md, dir, run('2026-10-08T20:00:00.000Z', { 'spending-limit': ['FAIL'], 'ledger-call-once': ['FAIL'] }))
    expect(raised).toEqual([{ scenario: 'spending-limit', runs: 3, since: '2026-10-06T20:00:00.000Z', item: 'B17.40', moved: true }])
    const after = await readFile(md, 'utf8')
    expect(after.indexOf('## B17.40 —')).toBeLessThan(after.indexOf('## B36.1 —'))
    expect(after).toContain('the e2e run of 2026-10-08 moved this here — `spending-limit` has FAILED 3 runs running, since the run of 2026-10-06T20:00:00.000Z.')
  })
})
