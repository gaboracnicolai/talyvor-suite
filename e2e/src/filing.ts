// B17.4 — every FAIL becomes a build item the loop then fixes: appended to ~/talyvor-queue/BUILD.md in
// its format (`## B<n>.<n> — …`, then `repo: … · deps: … · status: OPEN`), numbered next in the B17
// series, for the repo that owns the defect. One item per failing scenario, however many users hit it.
//
// DEDUPLICATION is by a marker line each filed item carries, `e2e-scenario: <id>`. A scenario whose
// marker is on an item that is not DONE is already covered and files nothing; one whose item is DONE
// failed again, and files a new item. A hand-written item about the same defect has no marker and is
// not recognised — the marker is the whole contract.

import { appendFile, readFile } from 'node:fs/promises'
import type { ReportedRun } from './report.ts'

/** Where a scenario's failure is looked for first: the repo that does the work it checks. */
const OWNER: Record<string, string> = {
  'sidebar-stays-hidden': 'talyvor-suite',
  streaming: 'talyvor-suite',
  'features-switches': 'talyvor-suite',
  'track-export': 'talyvor-suite',
  'docs-ai': 'talyvor-docs',
  'track-ai': 'talyvor-track',
}
const ownerOf = (scenario: string): string => OWNER[scenario] ?? 'talyvor-lens'

const MARKER = /^e2e-scenario: (\S+)\s*$/

/** The scenarios an open (not DONE) item already covers, each with that item's id. */
export function coveredScenarios(buildMd: string): Map<string, string> {
  const covered = new Map<string, string>()
  let id = ''
  let done = false
  for (const line of buildMd.split('\n')) {
    const head = /^## (B\d+\.\d+) —/.exec(line)
    if (head !== null) {
      id = head[1]
      done = false
      continue
    }
    if (/^repo: .*· status: DONE\b/.test(line)) done = true
    const m = MARKER.exec(line)
    if (m !== null && !done && id !== '') covered.set(m[1], id)
  }
  return covered
}

/** The next unused number in the B17 series. */
export function nextB17(buildMd: string): number {
  let max = 0
  for (const m of buildMd.matchAll(/^## B17\.(\d+) —/gm)) max = Math.max(max, Number(m[1]))
  return max + 1
}

export interface Filing {
  /** Text to append to BUILD.md: one item per newly failing scenario. Empty when there is none. */
  append: string
  filed: { id: string; scenario: string; repo: string }[]
  covered: { scenario: string; by: string }[]
}

/** The items a run's FAILs call for, against BUILD.md as it stands. Pure: nothing is written. */
export function itemsFor(buildMd: string, run: ReportedRun, reportFile: string): Filing {
  const covered = coveredScenarios(buildMd)
  const failing = new Map<string, ReportedRun['outcomes']>()
  for (const o of run.outcomes) {
    if (o.status !== 'FAIL') continue
    failing.set(o.scenario, [...(failing.get(o.scenario) ?? []), o])
  }
  const out: Filing = { append: '', filed: [], covered: [] }
  let n = nextB17(buildMd)
  const date = run.started_at.slice(0, 10)
  for (const [scenario, fails] of failing) {
    const by = covered.get(scenario)
    if (by !== undefined) {
      out.covered.push({ scenario, by })
      continue
    }
    const ran = run.outcomes.filter((o) => o.scenario === scenario).length
    const first = fails[0]
    const id = `B17.${n++}`
    const repo = ownerOf(scenario)
    const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
    const shown = first.evidence.filter((e) => e.question !== undefined || e.error !== undefined).slice(-2)
      .map((e) => oneLine(`asked "${e.question ?? ''}" → ${e.error !== undefined ? `refused: ${e.error}` : `"${(e.answer ?? '').slice(0, 160)}" [${e.footer ?? ''}]`}`))
    out.append += [
      '',
      `## ${id} — the testers found it: ${oneLine(first.title)}`,
      `repo: ${repo} · deps: none · status: OPEN`,
      `Filed by the e2e run of ${date} (${reportFile}): the \`${scenario}\` scenario FAILED for ${fails.length} of ${ran} ` +
        `synthetic user(s). First, user ${first.user} (${first.workspace}): ${oneLine(first.detail)}`,
      ...(shown.length > 0 ? [`Evidence: ${shown.join('; ')}`] : []),
      `${repo} is where it is looked for first; the defect may sit in another repo on the path.`,
      `e2e-scenario: ${scenario}`,
      `DONE = the \`${scenario}\` scenario PASSes for every user in the next production run.`,
      '',
    ].join('\n')
    out.filed.push({ id, scenario, repo })
  }
  return out
}

/** Appends the run's new items to BUILD.md at `path`. A missing BUILD.md files nothing. */
export async function fileItems(path: string, run: ReportedRun, reportFile: string): Promise<Filing | undefined> {
  let buildMd: string
  try {
    buildMd = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  const filing = itemsFor(buildMd, run, reportFile)
  if (filing.append !== '') await appendFile(path, (buildMd.endsWith('\n') ? '' : '\n') + filing.append)
  return filing
}
