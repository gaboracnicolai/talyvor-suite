// B17.4 — every FAIL becomes a build item the loop then fixes: appended to ~/talyvor-queue/BUILD.md in
// its format (`## B<n>.<n> — …`, then `repo: … · deps: … · status: OPEN`), numbered next in the B17
// series, for the repo that owns the defect. One item per failing scenario, however many users hit it.
//
// DEDUPLICATION is by a marker line each filed item carries, `e2e-scenario: <id>`. A scenario whose
// marker is on an item that is OPEN, CLAIMED or BLOCKED is already covered and files nothing; one whose
// item is DONE or SUPERSEDED failed again, and files a new item (B35.9: the item that superseded it
// carries the marker when it covers the scenario). A hand-written item about the same defect has no
// marker and is not recognised — the marker is the whole contract.
//
// B35.9 — the item goes to the repo the scenario names as its owner (Scenario.owner). When three or more
// scenarios FAIL with the same refusal from Lens — the same LENS_ setting named, or the same sentence once
// its numbers are taken out — they are one cause, and one item, carrying each scenario's marker.

import { appendFile, readFile } from 'node:fs/promises'
import { type B28Report, untestedMarker } from './b28.ts'
import { ASK_MARKER, type CodeReport } from './code.ts'
import { type EdgeReport, edgeMarker, failedNow } from './edge.ts'
import { type HostileReport, hostileMarker } from './hostile.ts'
import { networkDrop } from './oracles.ts'
import type { ReportedRun } from './report.ts'
import { scenarioOwners } from './scenarios.ts'

type Outcome = ReportedRun['outcomes'][number]

/** Where a scenario no longer in the catalog is filed: the testers' own harness, which ran it. */
const NO_OWNER = 'talyvor-e2e'

/** The repo Lens's refusals are looked for in first. */
const LENS = 'talyvor-lens'

/** B35.9 — this many scenarios failing with one refusal are one cause. */
const ONE_CAUSE = 3

const MARKER = /^e2e-scenario: (\S+)\s*$/

/** B35.9 — the statuses under which an item still covers its scenarios. */
const COVERING = new Set(['OPEN', 'CLAIMED', 'BLOCKED'])

/** The scenarios an OPEN, CLAIMED or BLOCKED item already covers, each with that item's id. */
export function coveredScenarios(buildMd: string): Map<string, string> {
  const covered = new Map<string, string>()
  let id = ''
  let covering = false
  for (const line of buildMd.split('\n')) {
    const head = /^## (B\d+\.\d+) —/.exec(line)
    if (head !== null) {
      id = head[1]
      covering = false
      continue
    }
    const status = /^repo: .*· status: ([A-Z]+)/.exec(line)
    if (status !== null) covering = COVERING.has(status[1])
    const m = MARKER.exec(line)
    if (m !== null && covering && id !== '') covered.set(m[1], id)
  }
  return covered
}

/** The next unused number in the B17 series. */
export function nextB17(buildMd: string): number {
  let max = 0
  for (const m of buildMd.matchAll(/^## B17\.(\d+) —/gm)) max = Math.max(max, Number(m[1]))
  return max + 1
}

/**
 * B35.9 — the refusal from Lens a FAIL reports: `key` groups one cause (the LENS_ setting named, else the sentence after
 * "refused:" or "Lens answered NNN:" with its numbers taken out), `text` is that refusal as it was seen. A network drop is
 * the testers' own, never Lens's refusal.
 */
export function refusalOf(detail: string): { key: string; text: string } | undefined {
  if (networkDrop(detail) !== undefined) return undefined
  const setting = /\bLENS_[A-Z0-9_]+\b/.exec(detail)
  if (setting !== null) return { key: setting[0], text: detail.slice(setting.index).trim() }
  const said = [...detail.matchAll(/(?:refused|Lens answered \d{3}):\s*/g)].pop()
  if (said === undefined) return undefined
  const text = detail.slice(said.index + said[0].length).trim()
  const key = text.replace(/\d+/g, '').replace(/\s+/g, ' ').trim()
  return key === '' ? undefined : { key, text }
}

/** The refusal most of a scenario's FAILs report, or undefined when most report none. */
function causeOf(fails: Outcome[]): { key: string; text: string; fails: Outcome[] } | undefined {
  const by = new Map<string, Outcome[]>()
  const text = new Map<string, string>()
  for (const f of fails) {
    const r = refusalOf(f.detail)
    const key = r?.key ?? ''
    by.set(key, [...(by.get(key) ?? []), f])
    if (r !== undefined && !text.has(key)) text.set(key, r.text)
  }
  const [key, most] = [...by].reduce((a, b) => (b[1].length > a[1].length ? b : a))
  return key === '' ? undefined : { key, text: text.get(key) as string, fails: most }
}

export interface Filing {
  /** Text to append to BUILD.md: one item per newly failing scenario or cause. Empty when there is none. */
  append: string
  /** One entry per scenario filed; the scenarios of one cause share its id. */
  filed: { id: string; scenario: string; repo: string }[]
  covered: { scenario: string; by: string }[]
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The last two questions or refusals of a verdict's evidence, one line each. */
function shownOf(o: Outcome): string[] {
  return o.evidence.filter((e) => e.question !== undefined || e.error !== undefined).slice(-2)
    .map((e) => oneLine(`asked "${e.question ?? ''}" → ${e.error !== undefined ? `refused: ${e.error}` : `"${(e.answer ?? '').slice(0, 160)}" [${e.footer ?? ''}]`}`))
}

/** B28.292 — the rounds of the weekly deep red-team pass that FAILed a scenario, and whether nothing else that night did. */
function deepNote(fails: Outcome[]): string[] {
  const rounds = [...new Set(fails.flatMap((f) => (f.deep === undefined ? [] : [f.deep])))]
  if (rounds.length === 0) return []
  return [`The weekly deep red-team pass (B28.292) caught it, in round ${rounds.join(', ')}` +
    (fails.every((f) => f.deep !== undefined) ? ": nothing else that night FAILED it, so it slipped through the nightly's own run." : '.')]
}

/** The items a run's FAILs call for, against BUILD.md as it stands. Pure: nothing is written. */
export function itemsFor(buildMd: string, run: ReportedRun, reportFile: string, owners: Map<string, string> = scenarioOwners()): Filing {
  const covered = coveredScenarios(buildMd)
  const failing = new Map<string, Outcome[]>()
  for (const o of run.outcomes) {
    if (o.status !== 'FAIL') continue
    failing.set(o.scenario, [...(failing.get(o.scenario) ?? []), o])
  }
  const out: Filing = { append: '', filed: [], covered: [] }
  const fresh = [...failing].filter(([scenario]) => {
    const by = covered.get(scenario)
    if (by !== undefined) out.covered.push({ scenario, by })
    return by === undefined
  })
  // One cause: the scenarios not covered yet whose FAILs mostly report the same refusal, when there are enough of them.
  const causes = new Map<string, { text: string; scenarios: { scenario: string; fails: Outcome[] }[] }>()
  for (const [scenario, fails] of fresh) {
    const c = causeOf(fails)
    if (c === undefined) continue
    const cause = causes.get(c.key) ?? { text: c.text, scenarios: [] }
    cause.scenarios.push({ scenario, fails: c.fails })
    causes.set(c.key, cause)
  }
  const causeOfScenario = new Map<string, string>()
  for (const [key, c] of causes) if (c.scenarios.length >= ONE_CAUSE) for (const s of c.scenarios) causeOfScenario.set(s.scenario, key)

  let n = nextB17(buildMd)
  const date = run.started_at.slice(0, 10)
  const ranFor = (scenario: string) => run.outcomes.filter((o) => o.scenario === scenario).length
  const ownerOf = (scenario: string) => owners.get(scenario) ?? NO_OWNER
  const filedCauses = new Set<string>()
  for (const [scenario, fails] of fresh) {
    const key = causeOfScenario.get(scenario)
    if (key !== undefined) {
      if (filedCauses.has(key)) continue
      filedCauses.add(key)
      const c = causes.get(key) as NonNullable<ReturnType<typeof causes.get>>
      const id = `B17.${n++}`
      out.append += [
        '',
        `## ${id} — the testers found it: ${c.scenarios.length} scenarios refused by Lens with ${oneLine(c.text).slice(0, 160)}`,
        `repo: ${LENS} · deps: none · status: OPEN`,
        `Filed by the e2e run of ${date} (${reportFile}): ${c.scenarios.length} scenarios FAILED with the same refusal from Lens, ` +
          `so they are one cause and this one item. Each, with how many of the synthetic users it ran for it refused, and its first:`,
        ...c.scenarios.map(({ scenario: s, fails: f }) => {
          const shown = shownOf(f[0])
          return `- \`${s}\` (${ownerOf(s)}): ${f.length} of ${ranFor(s)}. User ${f[0].user} (${f[0].workspace}): ${oneLine(f[0].detail)}` +
            (shown.length > 0 ? ` Evidence: ${shown.join('; ')}` : '')
        }),
        ...deepNote(c.scenarios.flatMap((s) => s.fails)),
        `${LENS} gives the refusal and is where it is looked for first; the cause may be in how a screen or the testers reached Lens.`,
        ...c.scenarios.map(({ scenario: s }) => `e2e-scenario: ${s}`),
        `DONE = none of these scenarios FAILs with this refusal in the next production run.`,
        '',
      ].join('\n')
      for (const s of c.scenarios) out.filed.push({ id, scenario: s.scenario, repo: LENS })
      continue
    }
    const first = fails[0]
    const id = `B17.${n++}`
    const repo = ownerOf(scenario)
    const shown = shownOf(first)
    out.append += [
      '',
      `## ${id} — the testers found it: ${oneLine(first.title)}`,
      `repo: ${repo} · deps: none · status: OPEN`,
      `Filed by the e2e run of ${date} (${reportFile}): the \`${scenario}\` scenario FAILED for ${fails.length} of ${ranFor(scenario)} ` +
        `synthetic user(s). First, user ${first.user} (${first.workspace}): ${oneLine(first.detail)}`,
      ...(shown.length > 0 ? [`Evidence: ${shown.join('; ')}`] : []),
      ...deepNote(fails),
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

// B34.3 — Talyvor Edge: a failed phase or workflow of edge-infra's nightly runs files one item for edge-infra, once.

export interface EdgeFiling {
  append: string
  filed: { id: string; scenario: string }[]
  covered: { scenario: string; by: string }[]
}

/** The items a night's failed Edge phases and workflows call for, against BUILD.md as it stands. Pure. */
export function edgeItemsFor(buildMd: string, edge: EdgeReport, reportFile: string): EdgeFiling {
  const covered = coveredScenarios(buildMd)
  const out: EdgeFiling = { append: '', filed: [], covered: [] }
  let n = nextB17(buildMd)
  const date = edge.read_at.slice(0, 10)
  for (const w of edge.workflows.filter(failedNow)) {
    const marker = edgeMarker(w)
    const by = covered.get(marker)
    if (by !== undefined) {
      out.covered.push({ scenario: marker, by })
      continue
    }
    const id = `B17.${n++}`
    const phase = edge.phases.find((p) => p.n === w.phase)
    const claims = edge.claims.filter((c) => w.phase !== undefined && c.phases.includes(w.phase)).map((c) => `row ${c.row}`)
    const after = phase === undefined ? [] : edge.phases.filter((p) => p.state === 'not reached')
    out.append += [
      '',
      `## ${id} — the testers found it: Talyvor Edge's nightly ${w.name}${phase === undefined ? ` (${w.conclusion})` : ` stops in PHASE ${phase.n} — ${phase.title}`}`,
      'repo: edge-infra · deps: none · status: OPEN',
      `Filed by the e2e run of ${date} (${reportFile}): the latest scheduled ${w.name} run on main (${w.url}, commit ${w.sha}, started ${w.started}) ` +
        `ended ${w.conclusion}` +
        (phase === undefined ? `${(w.failedJobs ?? []).length > 0 ? `; failed: ${(w.failedJobs ?? []).join('; ')}` : ''}.`
          : ` in PHASE ${phase.n}: "X ${phase.why ?? ''}". The phases before it passed; ${after.length} were not reached ` +
            `(${after.map((p) => p.n).join(', ')}).${claims.length > 0 ? ` docs/self-host-claims.md ${claims.join(', ')} rest on it.` : ''}`),
      `e2e-scenario: ${marker}`,
      phase === undefined ? `DONE = the next scheduled ${w.name} run on main is green.` : `DONE = the next scheduled ${w.name} run on main passes PHASE ${phase.n}.`,
      '',
    ].join('\n')
    out.filed.push({ id, scenario: marker })
  }
  return out
}

/** Appends the night's Edge items to BUILD.md at `path` and notes each failed workflow's item. A missing BUILD.md files nothing. */
export async function fileEdgeItems(path: string, edge: EdgeReport, reportFile: string): Promise<EdgeFiling | undefined> {
  let buildMd: string
  try {
    buildMd = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  const f = edgeItemsFor(buildMd, edge, reportFile)
  if (f.append !== '') await appendFile(path, (buildMd.endsWith('\n') ? '' : '\n') + f.append)
  const item = new Map([...f.filed, ...f.covered.map((c) => ({ id: c.by, scenario: c.scenario }))].map((x) => [x.scenario, x.id]))
  for (const w of edge.workflows.filter(failedNow)) w.item = item.get(edgeMarker(w))
  return f
}

// B34.10 — Talyvor Code: a broken `ask` files one item for talyvor-code, once.

/** The item a night's broken `ask` calls for, against BUILD.md as it stands. Pure. */
export function codeItemsFor(buildMd: string, code: CodeReport, reportFile: string): EdgeFiling {
  const out: EdgeFiling = { append: '', filed: [], covered: [] }
  const ask = code.calls.find((c) => c.command === 'ask')
  if (ask?.state !== 'failed') return out
  const by = coveredScenarios(buildMd).get(ASK_MARKER)
  if (by !== undefined) {
    out.covered.push({ scenario: ASK_MARKER, by })
    return out
  }
  const id = `B17.${nextB17(buildMd)}`
  out.append = [
    '',
    `## ${id} — the testers found it: Talyvor Code's \`ask\` is broken on main`,
    'repo: talyvor-code · deps: none · status: OPEN',
    `Filed by the e2e run of ${code.read_at.slice(0, 10)} (${reportFile}): talyvor-code's main${code.commit === undefined ? '' : ` at ${code.commit}`}, ` +
      `built and run as \`talyvor-code ask --file calc.go\` on the testers' fixture repository, on synthetic agent ${code.agent ?? '(none)'}'s own key ` +
      `in workspace ${code.workspace ?? '(none)'}: ${ask.detail}.`,
    `e2e-scenario: ${ASK_MARKER}`,
    "DONE = the next nightly's `ask` answers with the number only the fixture's file holds, as one charge on the agent's statement and none on the workspace.",
    '',
  ].join('\n')
  out.filed.push({ id, scenario: ASK_MARKER })
  return out
}

/** Appends a broken `ask`'s item to BUILD.md at `path` and notes it on the section. A missing BUILD.md files nothing. */
export async function fileCodeItems(path: string, code: CodeReport, reportFile: string): Promise<EdgeFiling | undefined> {
  let buildMd: string
  try {
    buildMd = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  const f = codeItemsFor(buildMd, code, reportFile)
  if (f.append !== '') await appendFile(path, (buildMd.endsWith('\n') ? '' : '\n') + f.append)
  code.item = f.filed[0]?.id ?? f.covered[0]?.by
  return f
}

// B28.289 — a hostile pull request CI would let through files one item for its repo, once; one that no longer applies to
// main files one for the testers' harness, which has stopped testing that guard.

/** The items a night's hostile pull requests call for, against BUILD.md as it stands. Pure. */
export function hostileItemsFor(buildMd: string, hostile: HostileReport, reportFile: string): EdgeFiling {
  const covered = coveredScenarios(buildMd)
  const out: EdgeFiling = { append: '', filed: [], covered: [] }
  let n = nextB17(buildMd)
  for (const v of hostile.prs.filter((x) => x.state === 'not caught' || x.state === 'stale')) {
    const marker = hostileMarker(v)
    const by = covered.get(marker)
    if (by !== undefined) {
      out.covered.push({ scenario: marker, by })
      continue
    }
    const id = `B17.${n++}`
    const stale = v.state === 'stale'
    out.append += [
      '',
      stale ? `## ${id} — the testers' hostile pull request \`${v.id}\` no longer applies to ${v.repo}'s main`
        : `## ${id} — the testers found it: CI lets through a pull request that ${v.what.split(';')[0]}`,
      `repo: ${stale ? NO_OWNER : v.repo} · deps: none · status: OPEN`,
      `Filed by the e2e run of ${hostile.read_at.slice(0, 10)} (${reportFile}): the hostile pull request \`${v.id}\` ${v.what}, made against ` +
        `${v.repo}'s main${v.commit === undefined ? '' : ` at ${v.commit}`}. The guard that must stop it: ${v.guard}. ${v.detail}.`,
      `e2e-scenario: ${marker}`,
      stale ? `DONE = the nightly's \`${v.id}\` applies to ${v.repo}'s main again and its guard goes red on it.`
        : `DONE = the nightly's hostile pull request \`${v.id}\` goes red in ${v.repo}'s CI naming the guard that caught it.`,
      '',
    ].join('\n')
    out.filed.push({ id, scenario: marker })
  }
  return out
}

/** Appends the night's hostile pull request items to BUILD.md at `path` and notes each verdict's item. A missing BUILD.md files nothing. */
export async function fileHostileItems(path: string, hostile: HostileReport, reportFile: string): Promise<EdgeFiling | undefined> {
  let buildMd: string
  try {
    buildMd = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  const f = hostileItemsFor(buildMd, hostile, reportFile)
  if (f.append !== '') await appendFile(path, (buildMd.endsWith('\n') ? '' : '\n') + f.append)
  const item = new Map([...f.filed, ...f.covered.map((c) => ({ id: c.by, scenario: c.scenario }))].map((x) => [x.scenario, x.id]))
  for (const v of hostile.prs) v.item = item.get(hostileMarker(v))
  return f
}

// B28.293 — a DONE B28 feature no scenario names files one item for the testers' harness, once.

/** The items a night's untested B28 features call for, against BUILD.md as it stands. Pure. */
export function b28ItemsFor(buildMd: string, b28: B28Report, reportFile: string): EdgeFiling {
  const covered = coveredScenarios(buildMd)
  const out: EdgeFiling = { append: '', filed: [], covered: [] }
  let n = nextB17(buildMd)
  for (const f of b28.features.filter((x) => x.state === 'no scenario')) {
    const marker = untestedMarker(f)
    const by = covered.get(marker)
    if (by !== undefined) {
      out.covered.push({ scenario: marker, by })
      continue
    }
    const id = `B17.${n++}`
    out.append += [
      '',
      `## ${id} — the testers have no scenario for ${f.id} — ${f.title}`,
      `repo: ${NO_OWNER} · deps: ${f.id} · status: OPEN`,
      `Filed by the e2e run of ${b28.read_at.slice(0, 10)} (${reportFile}): ${f.id} (${f.repo}) is DONE, and no scenario names it in its \`items\`, ` +
        'so neither the nightly testers nor the red team would see it break or go away (B28.293).',
      `e2e-scenario: ${marker}`,
      `DONE = a scenario in e2e/src exercises ${f.id} end to end as a person or an agent uses it — asserting the ledger row where money moves — ` +
        `names it in its \`items\`, and FAILs with the feature taken away (its stub broken in the self-test); or, if no scenario can reach it, ` +
        'NO_SCENARIO in e2e/src/b28.ts gives the true reason.',
      '',
    ].join('\n')
    out.filed.push({ id, scenario: marker })
  }
  return out
}

/** Appends the night's untested B28 features' items to BUILD.md at `path` and notes each on its feature. A missing BUILD.md files nothing. */
export async function fileB28Items(path: string, b28: B28Report, reportFile: string): Promise<EdgeFiling | undefined> {
  let buildMd: string
  try {
    buildMd = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  const f = b28ItemsFor(buildMd, b28, reportFile)
  if (f.append !== '') await appendFile(path, (buildMd.endsWith('\n') ? '' : '\n') + f.append)
  const item = new Map([...f.filed, ...f.covered.map((c) => ({ id: c.by, scenario: c.scenario }))].map((x) => [x.scenario, x.id]))
  for (const x of b28.features.filter((y) => y.state === 'no scenario')) x.item = item.get(untestedMarker(x))
  return f
}
