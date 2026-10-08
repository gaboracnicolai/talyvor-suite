// B28.296 — KEEP FIXING UNTIL IT WORKS. A FAIL is filed as a build item (filing.ts) and the loop builds the fix; a
// scenario still FAILing three runs running is not waiting its turn at the bottom of the queue any more. After filing,
// each run counts, for every scenario it FAILed, the runs running that FAILed it — this one and those before it, read
// from their results in `--out`, nightly and light passes alike — and moves the item that covers a scenario at
// STREAK runs or more to FIRST_SECTION, at the top of BUILD.md, where the loop claims first (it takes the first OPEN
// item in file order). A run that did not play a scenario, or only SKIPped or ERRORed it, neither counts nor breaks
// its streak; a PASS for every user who played it breaks it.

import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { coveredScenarios } from './filing.ts'
import type { ReportedRun } from './report.ts'

/** This many runs running FAILing a scenario raise its item to the top of the queue. */
export const STREAK = 3

/** The section at the top of BUILD.md the raised items are moved to, oldest raised first. */
export const FIRST_SECTION = '# FIRST IN THE QUEUE — SCENARIOS THE TESTERS HAVE SEEN FAIL THREE RUNS RUNNING (B28.296)'

export const FIRST_INTRO = 'Moved here by the e2e run (e2e/src/streak.ts) when a scenario has FAILED three runs running. Build these first.'

type Run = Pick<ReportedRun, 'started_at' | 'outcomes'>

/** A scenario FAILing STREAK runs running or more, and the item that covers it. */
export interface Raised {
  scenario: string
  /** The runs running that FAILed it, this one included. */
  runs: number
  /** When the first of them started. */
  since: string
  /** The OPEN, CLAIMED or BLOCKED item carrying its marker; undefined when none does. */
  item?: string
  /** True when this run moved the item to the top; false when it was there already. */
  moved: boolean
}

/** What a run made of a scenario: FAIL if a user FAILed it, PASS if one PASSed and none FAILed, undefined if it played none. */
export function verdictOf(run: Run, scenario: string): 'FAIL' | 'PASS' | undefined {
  const os = run.outcomes.filter((o) => o.scenario === scenario)
  if (os.some((o) => o.status === 'FAIL')) return 'FAIL'
  return os.some((o) => o.status === 'PASS') ? 'PASS' : undefined
}

/** Each scenario `latest` FAILed, with the runs running that FAILed it: `earlier` holds the runs before it, newest first. */
export function streaks(latest: Run, earlier: Iterable<Run>): Map<string, { runs: number; since: string }> {
  const out = new Map<string, { runs: number; since: string }>()
  for (const o of latest.outcomes) if (o.status === 'FAIL') out.set(o.scenario, { runs: 1, since: latest.started_at })
  const open = new Set(out.keys())
  for (const run of earlier) {
    if (open.size === 0) break
    for (const s of [...open]) {
      const v = verdictOf(run, s)
      if (v === 'PASS') open.delete(s)
      if (v !== 'FAIL') continue
      const st = out.get(s) as { runs: number; since: string }
      out.set(s, { runs: st.runs + 1, since: run.started_at })
    }
  }
  return out
}

/** The runs whose results are in `outDir` and started before `before`, newest first, each read only when it is reached. */
export async function* runsBefore(outDir: string, before: string): AsyncGenerator<Run> {
  const names = (await readdir(outDir).catch(() => [] as string[])).filter((n) => /^run-.*\.json$/.test(n)).sort().reverse()
  for (const name of names) {
    const r = await readFile(join(outDir, name), 'utf8').then((t) => JSON.parse(t) as Partial<Run>).catch(() => undefined)
    if (r === undefined || typeof r.started_at !== 'string' || !Array.isArray(r.outcomes) || !(r.started_at < before)) continue
    yield { started_at: r.started_at, outcomes: r.outcomes }
  }
}

const HEAD = /^## (B\d+\.\d+) —/
const HEADING = /^#{1,2} /

/** Where the block of item `id` starts and ends in `lines` (the next heading, or the end), or undefined. */
function blockOf(lines: string[], id: string): { start: number; end: number } | undefined {
  const start = lines.findIndex((l) => HEAD.exec(l)?.[1] === id)
  if (start < 0) return undefined
  let end = start + 1
  while (end < lines.length && !HEADING.test(lines[end])) end++
  return { start, end }
}

/** FIRST_SECTION's heading and where it ends (the next `# ` heading, or the end), adding it above the first section when absent. */
function firstSection(lines: string[]): { head: number; end: number } {
  let head = lines.indexOf(FIRST_SECTION)
  if (head < 0) {
    let at = lines.findIndex((l) => /^# B\d+/.test(l))
    if (at < 0) at = lines.findIndex((l) => HEAD.test(l))
    if (at < 0) at = lines.length
    lines.splice(at, 0, FIRST_SECTION, '', FIRST_INTRO, '')
    head = at
  }
  let end = head + 1
  while (end < lines.length && !/^# /.test(lines[end])) end++
  return { head, end }
}

/**
 * BUILD.md with each of `raise`'s items moved to the end of FIRST_SECTION, a line under its `repo:` line saying why. An item
 * already in the section stays where it is. Pure; only the moved blocks and the section change.
 */
export function raiseItems(buildMd: string, raise: { item: string; why: string }[]): { text: string; moved: string[] } {
  const lines = buildMd.split('\n')
  const moved: string[] = []
  for (const { item, why } of raise) {
    if (moved.includes(item)) continue
    if (blockOf(lines, item) === undefined) continue
    const section = firstSection(lines)
    const again = blockOf(lines, item) as { start: number; end: number }
    if (again.start > section.head && again.start < section.end) continue
    const block = lines.splice(again.start, again.end - again.start)
    while (block.length > 0 && block[block.length - 1].trim() === '') block.pop()
    block.splice(Math.min(2, block.length), 0, why)
    const { end } = firstSection(lines)
    let last = end
    while (last > 0 && lines[last - 1].trim() === '') last--
    lines.splice(last, 0, '', ...block)
    const after = last + 1 + block.length
    if (after < lines.length && lines[after].trim() !== '') lines.splice(after, 0, '')
    moved.push(item)
  }
  return { text: lines.join('\n'), moved }
}

/**
 * Raises the item of every scenario `run` FAILed STREAK runs running or more to the top of BUILD.md at `path`, the runs
 * before it read from `outDir`. Each such scenario is returned, with its item and whether it moved. A missing BUILD.md
 * moves nothing. BUILD.md is read just before it is written, and replaced whole, so the loop never reads half of it.
 */
export async function raiseFailing(path: string, outDir: string, run: ReportedRun): Promise<Raised[]> {
  const counted = [...streaks(run, await collect(runsBefore(outDir, run.started_at), run))].filter(([, s]) => s.runs >= STREAK)
  if (counted.length === 0) return []
  let buildMd: string
  try {
    buildMd = await readFile(path, 'utf8')
  } catch {
    return []
  }
  const covered = coveredScenarios(buildMd)
  const date = run.started_at.slice(0, 10)
  const raise = counted.sort((a, b) => b[1].runs - a[1].runs).flatMap(([scenario, s]) => {
    const item = covered.get(scenario)
    return item === undefined ? [] : [{ item, why: `⚠ First in the queue (B28.296): the e2e run of ${date} moved this here — \`${scenario}\` has FAILED ` +
      `${s.runs} runs running, since the run of ${s.since}.` }]
  })
  const { text, moved } = raiseItems(buildMd, raise)
  if (moved.length > 0) {
    const tmp = `${path}.raise-${process.pid}.tmp`
    await writeFile(tmp, text)
    await rename(tmp, path)
  }
  return counted.map(([scenario, s]) => {
    const item = covered.get(scenario)
    return { scenario, runs: s.runs, since: s.since, ...(item === undefined ? {} : { item }), moved: item !== undefined && moved.includes(item) }
  })
}

/** The earlier runs `streaks` needs: read until every scenario `run` FAILed has met a PASS. */
async function collect(runs: AsyncGenerator<Run>, latest: Run): Promise<Run[]> {
  const open = new Set(latest.outcomes.filter((o) => o.status === 'FAIL').map((o) => o.scenario))
  const out: Run[] = []
  for await (const r of runs) {
    if (open.size === 0) break
    out.push(r)
    for (const s of [...open]) if (verdictOf(r, s) === 'PASS') open.delete(s)
  }
  return out
}
