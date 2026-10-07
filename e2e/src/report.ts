// B17.4 — the report Nicolai reads: one Markdown file a day, docs/e2e/report-YYYY-MM-DD.md. A second
// run the same day is appended below the first; a report is never overwritten or deleted.
//
// B25.5 — it is written PER FEATURE: for each, what works (with the evidence), what is broken (with the
// evidence and the build item that holds it), the errors the browsers saw, what was slow (with the
// timings), what worked well, and what the explorers noted there. It ends with the coverage map: every
// screen, BFF route and Lens route there is, and its state. A short summary of the same run goes to
// ~/talyvor-queue/TESTERS.md for the morning brief (writeTesters).

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type CodeReport, codeLine, renderCode } from './code.ts'
import { type CoverageMap, type Row, tallyLine } from './coverage.ts'
import { type EdgeReport, edgeLine, renderEdge } from './edge.ts'
import { type HostileReport, hostileLine, renderHostile } from './hostile.ts'
import type { ExplorerSummary, Finding } from './explore.ts'
import type { MemorySample } from './memory.ts'
import type { Evidence } from './scenarios.ts'
import { type Versions, versionsLine } from './versions.ts'

/** The parts of a run's result the report reads (run.ts RunResult). */
export interface ReportedRun {
  started_at: string
  finished_at: string
  app: string
  lens: string
  users: number
  model: string
  cap_usd: number
  spent_usd: number
  stopped_at_cap: boolean
  /** B26.18 — what ended the run before its end, and when (run.ts RunResult). */
  stopped_by?: string
  /** B26.18 — what went wrong under the run without ending it. */
  incidents?: string[]
  counts: Record<'PASS' | 'FAIL' | 'SKIP' | 'ERROR', number>
  outcomes: {
    scenario: string
    title: string
    user: number
    workspace: string
    status: 'PASS' | 'FAIL' | 'SKIP' | 'ERROR'
    detail: string
    evidence: Evidence[]
    seconds?: number
    /** B25.5 — the features it is reported under. */
    features?: string[]
    /** B35.8 — when its verdict came. */
    at?: string
    /** B35.7 — the plan of the workspace it ran on. */
    plan?: string
    /** B28.292 — the round of the weekly deep red-team pass it was played in; absent for the night's own scenarios. */
    deep?: number
  }[]
  explorers?: ExplorerSummary[]
  findings?: Finding[]
  /** B25.5 — the map of every screen and route, and its state. */
  coverage?: CoverageMap
  /** Each failing scenario's build item (B17.4): filed by this run, or already open. */
  filed?: Record<string, string>
  /** B35.8 — the verdicts the testers' own network explains, each an ERROR (run.ts). */
  network_drops?: { at: string; user: number; scenario: string; detail: string }[]
  /** B35.8 — the Mac's memory at the start and every 5 minutes. */
  memory?: MemorySample[]
  /** B35.8 — the scenarios that FAILed for one or two users, run again for them. */
  second_attempts?: ReportedRun['outcomes']
  /** B34.2 — what was tested, and production's versions again at the end (run.ts). */
  versions?: Versions
  production_after?: Pick<Versions, 'app' | 'lens'>
  /** B34.3 — edge-infra's nightly workflows on main, Kind E2E's phases and the self-host claims (edge.ts). */
  edge?: EdgeReport
  /** B34.10 — the CLI built from talyvor-code's main, run on a synthetic agent's key, and its extension's and plugin's CI (code.ts). */
  code?: CodeReport
  /** B28.289 — the hostile pull requests made against each repo's main, and whether CI stops each (hostile.ts). */
  hostile?: HostileReport
  /** B28.292 — the rounds of the weekly deep red-team pass the run was to play; absent on a night without one. */
  deep_rounds?: number
}

type Outcome = ReportedRun['outcomes'][number]

/** B34.2 — the harness, Lens's main and production's versions, or that the run recorded none. */
const testedText = (run: ReportedRun): string =>
  run.versions === undefined ? 'not recorded (the run stopped before it read them, or it is from before B34.2)' : versionsLine(run.versions, run.production_after)

/** A screen's p95 above this is slow; a BFF route's above ROUTE_SLOW_MS, or MODEL_SLOW_MS when it waits for a model. */
const SCREEN_SLOW_MS = 3_000
const ROUTE_SLOW_MS = 2_000
const MODEL_SLOW_MS = 30_000
const WAITS_FOR_A_MODEL = /^\/api\/(ai\/|docs\/ai\/|docs\/pages\/|docs\/spaces\/\{spaceID\}\/pages\/\{pageID\}\/changelog|track\/issues\/\{id\}\/(summary|find-duplicates|triage)|marketplace\/listings\/\{id\}\/use)/
/** The feature an outcome is reported under when the run did not say (a run from before B25.5). */
const UNPLACED = 'Chat'

/** A Markdown table cell: one line, pipes escaped. */
const cell = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
const median = (xs: number[]): number | undefined => (xs.length === 0 ? undefined : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)])

function evidenceLines(evidence: Evidence[]): string[] {
  const out: string[] = []
  for (const e of evidence) {
    if (e.note !== undefined) out.push(`- ${e.note}`)
    if (e.question !== undefined) out.push(`  - asked: ${e.question}`)
    if (e.answer !== undefined && e.answer !== '') out.push(`  - answer: ${e.answer.replace(/\s+/g, ' ').slice(0, 300)}`)
    if (e.footer !== undefined && e.footer !== '') out.push(`  - under it: ${e.footer}`)
    if (e.error !== undefined) out.push(`  - refused: ${e.error}`)
    if (e.shot !== undefined) out.push(`  - screenshot: [${e.shot.split('/').pop()}](${e.shot})`)
    if (e.ledger !== undefined) {
      out.push(`  - ledger (${e.ledger.length} rows, newest first): ` +
        e.ledger.slice(0, 12).map((r) => `${r.type} ${r.amount_ulxc} µLXC`).join('; ') + (e.ledger.length > 12 ? '; …' : ''))
    }
  }
  return out
}

const featuresOf = (o: Outcome): string[] => (o.features !== undefined && o.features.length > 0 ? o.features : [UNPLACED])

/** Each scenario's outcomes, in the order they first appear. */
function byScenario(outcomes: Outcome[]): Map<string, Outcome[]> {
  const m = new Map<string, Outcome[]>()
  for (const o of outcomes) m.set(o.scenario, [...(m.get(o.scenario) ?? []), o])
  return m
}

const slowAt = (r: Row): number => (r.kind === 'screen' ? SCREEN_SLOW_MS : WAITS_FOR_A_MODEL.test(r.path) ? MODEL_SLOW_MS : ROUTE_SLOW_MS)
const failedAnswers = (r: Row): number => Object.entries(r.answers).filter(([s]) => Number(s) >= 500 || s === '0').reduce((n, [, c]) => n + c, 0)
const timingText = (r: Row): string => (r.timing === undefined ? '' : `p50 ${secs(r.timing.p50)} · p95 ${secs(r.timing.p95)} · max ${secs(r.timing.max)} (n=${r.timing.n})`)

/** One distinct lead: its first note, how many notes were it, and the explorers who saw it. */
export interface LeadGroup {
  f: Finding
  times: number
  who: number[]
}

/**
 * Each distinct lead once, the most seen first. A note names its lead (B26.19); one from a run before
 * that is one lead with every note of the same words on the same screen.
 */
export function groupLeads(findings: Finding[]): LeadGroup[] {
  const m = new Map<string, { f: Finding; times: number; who: Set<number> }>()
  for (const f of findings) {
    const key = f.lead !== undefined ? `#${f.lead}` : `${f.source}|${f.where}|${f.note}`
    const l = m.get(key) ?? { f, times: 0, who: new Set<number>() }
    l.times++
    l.who.add(f.explorer)
    m.set(key, l)
  }
  return [...m.values()].map(({ f, times, who }) => ({ f, times, who: [...who].sort((a, b) => a - b) }))
    .sort((a, b) => b.who.length - a.who.length || b.times - a.times)
}

function leads(findings: Finding[]): string[] {
  const lines: string[] = []
  for (const { f, times, who } of groupLeads(findings)) {
    const by = `${who.length} explorer${who.length > 1 ? 's' : ''} (${who.join(', ')})`
    lines.push(`- **${f.severity}** ${f.source === 'browser' ? `the browsers of ${by}` : by} on ` +
      `\`${f.where}\`${times > who.length ? ` (${times} times)` : ''}: ${cell(f.note)}`)
    if (f.trail.length > 0) lines.push(`  - after: ${cell(f.trail.join(' → '))}`)
  }
  return lines
}

/** One feature's section: works, broken, errors seen, slow, worked well, and what the explorers noted. */
function featureSection(feature: string, run: ReportedRun, outcomes: Outcome[], map: CoverageMap | undefined): string[] {
  const lines = [`#### ${feature}`, '']
  const scenarios = byScenario(outcomes)
  const rows = map === undefined ? [] : [...map.screens.filter((r) => r.feature === feature), ...map.bff.filter((r) => r.from.includes(feature))]

  const works: string[] = []
  const worked: string[] = []
  for (const [id, os] of scenarios) {
    const pass = os.filter((o) => o.status === 'PASS')
    if (pass.length === 0) continue
    const ran = os.filter((o) => o.status !== 'SKIP').length
    const m = median(pass.flatMap((o) => (o.seconds === undefined ? [] : [o.seconds * 1000])))
    works.push(`- \`${id}\` passed for ${pass.length} of ${ran} user(s)${m === undefined ? '' : `, median ${secs(m)}`} — e.g. user ${pass[0].user}: ${cell(pass[0].detail)}`)
    if (pass.length === ran) worked.push(`\`${id}\` passed for every user who ran it (${ran})`)
  }
  for (const r of rows.filter((x) => x.kind === 'screen' && x.state === 'covered' && x.timing !== undefined)) {
    works.push(`- screen \`${r.path}\` opened for ${Object.values(r.by).reduce((a, b) => a + b, 0)} user run(s): ${timingText(r)}`)
  }
  lines.push('**Works**', '', ...(works.length > 0 ? works : ['- Nothing passed here.']), '')

  const broken: string[] = []
  for (const [id, os] of scenarios) {
    const fails = os.filter((o) => o.status === 'FAIL')
    if (fails.length === 0) continue
    const item = run.filed?.[id]
    broken.push(`\`${id}\` failed for ${fails.length} of ${os.filter((o) => o.status !== 'SKIP').length} user(s)` +
      `${item === undefined ? '' : ` — build item ${item}`}:`, '')
    for (const [i, o] of fails.entries()) {
      broken.push(`**FAIL \`${o.scenario}\`** — user ${o.user} (${o.workspace}): ${cell(o.detail)}`, '')
      if (i < 3) broken.push(...evidenceLines(o.evidence).slice(0, 40), '')
    }
  }
  lines.push('**Broken**', '', ...(broken.length > 0 ? broken : ['Nothing failed here.', '']))

  const errors: string[] = []
  for (const [id, os] of scenarios) {
    for (const o of os.filter((x) => x.status === 'ERROR')) errors.push(`- **ERROR \`${id}\`** — user ${o.user} (${o.workspace}): ${cell(o.detail)}`)
  }
  for (const e of map?.errors.filter((x) => x.feature === feature) ?? []) {
    errors.push(`- page error on \`${e.where}\` (${e.count} time(s), during ${e.scenarios.join(', ')}): ${cell(e.message)}`)
  }
  for (const r of rows.filter((x) => x.kind === 'bff' && failedAnswers(x) > 0)) {
    const bad = Object.entries(r.answers).filter(([s]) => Number(s) >= 500 || s === '0').map(([s, n]) => `${s === '0' ? 'no answer' : s} ×${n}`)
    errors.push(`- \`${r.method} ${r.path}\` answered ${bad.join(', ')}`)
  }
  lines.push('**Errors seen**', '', ...(errors.length > 0 ? errors : ['- None.']), '')

  const slow = rows.filter((r) => r.timing !== undefined && r.timing.p95 > slowAt(r))
  lines.push(`**Slow** (a screen past ${secs(SCREEN_SLOW_MS)}, a route past ${secs(ROUTE_SLOW_MS)} — ${secs(MODEL_SLOW_MS)} if it waits for a model — at p95)`, '',
    ...(slow.length > 0 ? slow.map((r) => `- ${r.kind === 'screen' ? `screen \`${r.path}\`` : `\`${r.method} ${r.path}\``}: ${timingText(r)}`) : ['- Nothing.']), '')

  const quick = rows.filter((r) => r.kind === 'bff' && r.timing !== undefined && r.timing.p95 <= slowAt(r) && failedAnswers(r) === 0)
  if (quick.length > 0) worked.push(`${quick.length} BFF route(s) behind it answered every call without a server error, within time`)
  lines.push('**Worked well**', '', ...(worked.length > 0 ? worked.map((w) => `- ${w}`) : ['- Nothing stood out.']), '')

  const found = (run.findings ?? []).filter((f) => (f.feature ?? '(no screen)') === feature)
  if (found.length > 0) lines.push('**The explorers noted** (leads to check, never filed: an explorer can be mistaken)', '', ...leads(found), '')
  return lines
}

/** The explorers' sessions: where each started, how far it went and why it stopped. */
function explorerTable(run: ReportedRun): string[] {
  const explorers = run.explorers ?? []
  if (explorers.length === 0) return []
  const findings = run.findings ?? []
  const lines = ['', `### Explorers — ${groupLeads(findings).length} distinct lead(s) to check, from ${findings.length} note(s), each under its feature above`, '',
    '| Explorer | Started at | Steps | Screens | Notes | Stopped | |', '|---:|---|---:|---:|---:|---|---|',
    ...explorers.map((e) => `| ${e.explorer} | ${e.start ?? ''} | ${e.steps} | ${e.screens ?? ''} | ${e.notes ?? ''} | ${e.stopped} | ${cell(e.detail)} |`), '']
  if (explorers.some((e) => e.stopped === 'cap')) lines.push('The explorers stopped at the spend cap.', '')
  // B26.19 — how far they spread, and the most one of them wrote on one screen.
  const screens = run.coverage?.screens ?? []
  if (screens.length > 0) {
    const not = screens.filter((r) => r.explorers === 0).map((r) => `\`${r.path}\``)
    lines.push(`Between them the explorers opened ${screens.length - not.length} of ${screens.length} screens` +
      `${not.length > 0 ? `; not ${not.join(', ')}` : ''}.`, '')
  }
  const per = new Map<string, number>()
  for (const f of findings) per.set(`${f.explorer}|${f.screen ?? f.where}`, (per.get(`${f.explorer}|${f.screen ?? f.where}`) ?? 0) + 1)
  if (per.size > 0) lines.push(`The most notes one explorer made on one screen: ${Math.max(...per.values())}.`, '')
  return lines
}

const byText = (r: Row): string => {
  const top = Object.entries(r.by).sort((a, b) => b[1] - a[1])
  const shown = top.slice(0, 4).map(([s, n]) => `${s} ×${n}`)
  return [...shown, ...(top.length > 4 ? [`+${top.length - 4} more`] : []), ...(r.explorers > 0 ? [`explorers ×${r.explorers}`] : [])].join(', ')
}
const answersText = (r: Row): string => Object.entries(r.answers).sort().map(([s, n]) => `${s === '0' ? 'none' : s} ×${n}`).join(', ')
const stateText = (r: Row): string => (r.why !== undefined ? `${r.state}: ${r.why}` : r.state)

/** B34.9 — Lens's, Track's and Docs' rows, each with why it is not listed when it is not. */
const services = (map: CoverageMap): { name: string; rows: Row[]; missing?: string }[] => [
  { name: 'Lens', rows: map.lens, missing: map.lensMissing },
  { name: 'Track', rows: map.track, missing: map.trackMissing },
  { name: 'Docs', rows: map.docs, missing: map.docsMissing },
]

/** "Lens routes 193 of 403 covered, …; Track routes …; Docs routes …". */
const servicesLine = (map: CoverageMap): string =>
  services(map).map((s) => `${s.name} routes ${s.missing !== undefined ? `not listed (${s.missing})` : tallyLine(s.rows)}`).join('; ')

/** B25.5 (1) — every screen, BFF route and Lens, Track and Docs route, with its state. */
export function renderMap(map: CoverageMap): string[] {
  const lines = ['', '### Coverage map', '',
    'Every screen the web app mounts, every route the BFF registers and every route Lens, Track and Docs register, read from',
    'the code at the time of the run. **covered**: a scenario with an oracle reached it (×users). **explorers only**: only an',
    'explorer did, so nothing checked it. **cannot be tested yet**: with why. **not covered**: nothing reached it. A Lens route',
    'reached through the app is counted through the BFF route that leads to it (the Through column); one the BFF reaches by a',
    'path it builds another way is not linked, so Lens coverage can read low. A Track or Docs route is counted through the BFF',
    'routes that send a request to it, read from the BFF\'s own calls to Track and Docs.', '',
    `#### Screens — ${tallyLine(map.screens)}`, '',
    '| Screen | Feature | State | Covered by | Opens in |', '|---|---|---|---|---|',
    ...map.screens.map((r) => `| \`${r.path}\` | ${cell(r.feature)} | ${cell(stateText(r))} | ${cell(byText(r))} | ${timingText(r)} |`),
    '', `#### BFF routes — ${tallyLine(map.bff)}`, '',
    '| Route | State | Covered by | Called from | Answers | Time |', '|---|---|---|---|---|---|',
    ...map.bff.map((r) => `| \`${r.method} ${r.path}\` | ${cell(stateText(r))} | ${cell(byText(r))} | ${cell(r.from.join(', '))} | ${answersText(r)} | ${timingText(r)} |`),
  ]
  for (const s of services(map)) {
    lines.push('', `#### ${s.name} routes — ${s.missing !== undefined ? `NOT LISTED: ${s.missing}` : tallyLine(s.rows)}`, '')
    if (s.name !== 'Lens' && s.rows.some((r) => r.state === 'not covered')) {
      // Why a route no BFF route sends a request to has no reason here: the map says it rather than guess.
      if (map.productsNotBehind !== undefined) lines.push(`Not given a reason when no BFF route sends a request to it: ${cell(map.productsNotBehind)}.`, '')
      for (const c of map.unreadCalls) lines.push(`- A call the BFF makes to Track or Docs whose path could not be read: \`${c}\``)
      if (map.unreadCalls.length > 0) lines.push('')
    }
    if (s.rows.length > 0) {
      lines.push('| Route | State | Covered by | Through | Answers | Time |', '|---|---|---|---|---|---|',
        ...s.rows.map((r) => `| \`${r.method} ${r.path}\` | ${cell(stateText(r))} | ${cell(byText(r))} | ${cell(r.through.join(', '))} | ${answersText(r)} | ${timingText(r)} |`))
    }
  }
  return lines
}

/** B35.8 — a wait that ran out: Playwright's, the run's own, or an answer that never came. */
const TIMED_OUT = /Timeout \d+ms exceeded|nothing within \d+|no answer and no error after/
const clock = (iso: string): string => `${iso.slice(11, 19)}Z`
const gb = (mb: number): string => (mb / 1024).toFixed(1)

/** B35.8 — the testers' environment: the network drops, each with its time, and the Mac's memory beside the night's timeouts. */
export function renderEnvironment(run: ReportedRun): string[] {
  const drops = run.network_drops ?? []
  const memory = run.memory ?? []
  if (drops.length === 0 && memory.length === 0) return []
  const lines = ['', "### The testers' environment", '']
  lines.push(drops.length === 0 ? 'No network drop.' : `Network drops — ${drops.length}, each an ERROR, nothing filed:`, '')
  for (const d of drops) lines.push(`- ${clock(d.at)} user ${d.user} \`${d.scenario}\`: ${cell(d.detail.split('\n')[0])}`)
  if (drops.length > 0) lines.push('')
  if (memory.length > 0) {
    const timeouts = run.outcomes.filter((o) => (o.status === 'FAIL' || o.status === 'ERROR') && o.at !== undefined && TIMED_OUT.test(o.detail))
    lines.push("The Mac's memory at the start and every 5 minutes, beside the waits that ran out until the next reading:", '',
      '| At | Memory pressure | Swap used | Users at once | Timeouts |', '|---|---|---|---:|---:|')
    for (const [i, m] of memory.entries()) {
      const until = memory[i + 1]?.at ?? '9999'
      const n = timeouts.filter((o) => (o.at as string) >= m.at && (o.at as string) < until).length
      const swap = m.swapUsedMB === undefined || m.swapTotalMB === undefined ? 'not read'
        : `${gb(m.swapUsedMB)} of ${gb(m.swapTotalMB)} GB${m.swapTotalMB > 0 ? ` (${Math.round((100 * m.swapUsedMB) / m.swapTotalMB)}%)` : ''}`
      lines.push(`| ${clock(m.at)} | ${m.pressure ?? 'not read'} | ${swap} | ${m.width} | ${n} |`)
    }
    lines.push('')
  }
  return lines
}

/** B35.8 — each scenario that FAILed for one or two users, both attempts side by side; the first attempt's FAIL is filed. */
export function renderSecondAttempts(run: ReportedRun): string[] {
  const again = run.second_attempts ?? []
  if (again.length === 0) return []
  const lines = ['', '### Second attempts', '',
    'A scenario that failed for one or two users ran again for them at the end of the night, before the ledger read-back. ' +
    "The first attempt's FAIL is the one filed.", '',
    '| Scenario | User | First attempt | Second attempt |', '|---|---:|---|---|']
  for (const o of again) {
    const first = run.outcomes.find((x) => x.scenario === o.scenario && x.user === o.user)
    lines.push(`| \`${o.scenario}\` | ${o.user} | ${first === undefined ? '' : `${first.status}: ${cell(first.detail)}`} | ${o.status}: ${cell(o.detail)} |`)
  }
  return lines
}

/** B28.292 — the weekly deep red-team pass: each red-team scenario's verdict in every round, and the item a FAIL is filed in. */
export function renderDeep(run: ReportedRun): string[] {
  const deep = run.outcomes.filter((o) => o.deep !== undefined)
  const rounds = Math.max(run.deep_rounds ?? 0, ...deep.map((o) => o.deep as number))
  if (rounds === 0) return []
  const each = Array.from({ length: rounds }, (_, r) => r + 1)
  const lines = ['', '### Weekly deep red-team pass', '',
    `${rounds} round(s), one after another, after the night's own scenarios and under the same cap: in each, an attacker created ` +
    'for the run played every red-team scenario back to back, each on a fresh workspace of its own, against a counterparty made ' +
    'for that round. A FAIL is filed like any other, under its scenario.', '']
  if (deep.length === 0) return [...lines, 'Nothing was played: the run stopped before it.']
  lines.push(`| Scenario | ${each.map((r) => `Round ${r}`).join(' | ')} | Build item |`, `|---|${each.map(() => '---|').join('')}---|`)
  for (const [id, os] of byScenario(deep)) {
    const verdicts = each.map((r) => os.filter((o) => o.deep === r).map((o) => o.status).join(', ') || '—')
    lines.push(`| \`${id}\` | ${verdicts.join(' | ')} | ${os.some((o) => o.status === 'FAIL') ? run.filed?.[id] ?? 'not filed' : ''} |`)
  }
  return lines
}

/** B28.292 — the weekly deep red-team pass in one line, on the night it ran. */
function deepLine(run: ReportedRun): string[] {
  const deep = run.outcomes.filter((o) => o.deep !== undefined)
  const rounds = Math.max(run.deep_rounds ?? 0, ...deep.map((o) => o.deep as number))
  if (rounds === 0) return []
  const n = { PASS: 0, FAIL: 0, ERROR: 0, SKIP: 0 }
  for (const o of deep) n[o.status]++
  const failing = [...byScenario(deep)].filter(([, os]) => os.some((o) => o.status === 'FAIL')).map(([id, os]) =>
    `\`${id}\` (round ${[...new Set(os.filter((o) => o.status === 'FAIL').map((o) => o.deep))].join(', ')}${run.filed?.[id] !== undefined ? `, ${run.filed[id]}` : ''})`)
  return [`- **Deep red-team pass**: ${rounds} round(s); ${n.PASS} of ${deep.length} verdicts passed` +
    `${n.ERROR > 0 ? `, ${n.ERROR} errored` : ''}${n.SKIP > 0 ? `, ${n.SKIP} skipped` : ''}; ` +
    `${failing.length === 0 ? 'no FAIL' : `FAILED: ${failing.join(', ')}`}.`]
}

/** B35.7 — per plan: the workspaces on it, what ran on them and what it found. */
export function renderPlans(run: ReportedRun): string[] {
  const on = new Map<string, Outcome[]>()
  for (const o of run.outcomes) if (o.plan !== undefined) on.set(o.plan, [...(on.get(o.plan) ?? []), o])
  if (on.size === 0) return []
  const lines = ['', '### By plan', '',
    'Each user ran on the largest plan its scenarios need; a scenario that tests a plan\'s own gate ran on a workspace of its own, on that plan.', '',
    '| Plan | Workspaces | Pass | Fail | Error | Skip | Failed or errored |', '|---|---:|---:|---:|---:|---:|---|']
  const order = ['free', 'team', 'business', 'enterprise']
  for (const plan of [...on.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))) {
    const os = on.get(plan) ?? []
    const n = { PASS: 0, FAIL: 0, ERROR: 0, SKIP: 0 }
    for (const o of os) n[o.status]++
    const bad = [...new Set(os.filter((o) => o.status === 'FAIL' || o.status === 'ERROR').map((o) => `\`${o.scenario}\``))]
    lines.push(`| ${plan} | ${new Set(os.map((o) => o.workspace)).size} | ${n.PASS} | ${n.FAIL} | ${n.ERROR} | ${n.SKIP} | ${bad.join(', ') || 'none'} |`)
  }
  return lines
}

/** One run as a report section. */
export function renderRun(run: ReportedRun): string {
  const c = run.counts
  const map = run.coverage
  const lines = [
    `## Run started ${run.started_at}`,
    '',
    `${c.PASS} passed, ${c.FAIL} failed, ${c.ERROR} errored, ${c.SKIP} skipped — ${run.users} synthetic users on ${run.app} ` +
      `(Lens ${run.lens}), model ${run.model}.`,
    '',
    `Tested: ${testedText(run)}.`,
    '',
    `Cost: about $${run.spent_usd.toFixed(4)} of a $${run.cap_usd.toFixed(2)} cap` +
      (run.stopped_at_cap ? ' — STOPPED AT THE CAP; everything after it was skipped.' : '.') +
      ` Finished ${run.finished_at}.`,
    '',
    ...(run.stopped_by === undefined ? [] : [`**STOPPED EARLY** — ${run.stopped_by}. What ran before that is below; what had not started was skipped.`, '']),
    ...((run.incidents ?? []).length === 0 ? [] : ['**Incidents** (the run went on):', '', ...(run.incidents ?? []).map((i) => `- ${cell(i)}`), '']),
    ...(map === undefined ? [] : [
      `Coverage: screens ${tallyLine(map.screens)}; BFF routes ${tallyLine(map.bff)}; ${servicesLine(map)}. The map is at the end.`, '']),
    '| Scenario | Pass | Fail | Error | Skip | What it checks |',
    '|---|---:|---:|---:|---:|---|',
  ]
  for (const [id, os] of byScenario(run.outcomes)) {
    const n = { PASS: 0, FAIL: 0, ERROR: 0, SKIP: 0 }
    for (const o of os) n[o.status]++
    lines.push(`| \`${id}\` | ${n.PASS} | ${n.FAIL} | ${n.ERROR} | ${n.SKIP} | ${cell(os[0].title)} |`)
  }
  lines.push(...renderDeep(run), ...renderPlans(run), ...renderSecondAttempts(run), ...renderEnvironment(run), ...renderEdge(run.edge), ...renderCode(run.code), ...renderHostile(run.hostile))

  // The features in the order the app mounts them, then any a scenario named for itself.
  const features = [...new Set([...(map?.screens.map((r) => r.feature) ?? []), ...run.outcomes.flatMap(featuresOf),
    ...(run.findings ?? []).map((f) => f.feature ?? '(no screen)')])]
  lines.push(...screenshots(run))

  lines.push('', '### By feature', '')
  for (const f of features) {
    const here = run.outcomes.filter((o) => featuresOf(o).includes(f))
    const shown = (map?.screens ?? []).filter((r) => r.feature === f)
    const opened = shown.some((r) => r.state === 'covered' || r.state === 'explorers only')
    if (here.length === 0 && !opened && !(run.findings ?? []).some((x) => (x.feature ?? '(no screen)') === f)) {
      lines.push(`#### ${f}`, '', shown.every((r) => r.state === 'cannot be tested yet') && shown.length > 0
        ? `Not tested: ${shown[0].why}.` : 'No scenario reached it this run.', '')
      continue
    }
    lines.push(...featureSection(f, run, here, map))
  }

  lines.push(...explorerTable(run))

  lines.push('', '### Every verdict', '')
  for (const [o, again] of [...run.outcomes.map((x) => [x, false] as const), ...(run.second_attempts ?? []).map((x) => [x, true] as const)]) {
    lines.push(`<details><summary>${o.status} ${o.scenario} — user ${o.user}${o.deep === undefined ? '' : `, deep round ${o.deep}`}${again ? ' (second attempt)' : ''}: ${escapeHTML(o.detail)}</summary>`, '')
    lines.push(...(o.evidence.length > 0 ? evidenceLines(o.evidence) : ['- no evidence recorded']), '', '</details>')
  }
  if (map !== undefined) lines.push(...renderMap(map))
  return lines.join('\n') + '\n'
}

const escapeHTML = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** B29.21 — every screenshot the run took, a row of thumbnails per verdict, each linking to its file. */
function screenshots(run: ReportedRun): string[] {
  const shot = run.outcomes.filter((o) => o.evidence.some((e) => e.shot !== undefined))
  if (shot.length === 0) return []
  const lines = ['', '### Screenshots', '']
  for (const o of shot) {
    lines.push(`**${o.status} \`${o.scenario}\`** — user ${o.user}`, '')
    for (const e of o.evidence.filter((x) => x.shot !== undefined)) {
      const said = escapeHTML(e.note ?? '').replace(/"/g, '&quot;')
      lines.push(`<a href="${e.shot}"><img src="${e.shot}" height="180" alt="${said.split(': ')[0]}" title="${said}"></a>`)
    }
    lines.push('')
  }
  return lines
}

/** The day's report file for a run, by the date (UTC) it started. */
export function reportPath(dir: string, startedAt: string): string {
  return join(dir, `report-${startedAt.slice(0, 10)}.md`)
}

/** Appends the run to its day's report, heading a new file. Answers the file's path. */
export async function writeReport(dir: string, run: ReportedRun): Promise<string> {
  const file = reportPath(dir, run.started_at)
  await mkdir(dir, { recursive: true })
  const existing = await readFile(file, 'utf8').catch(() => '')
  const head = existing === '' ? `# Talyvor end-to-end report — ${run.started_at.slice(0, 10)}\n\n` : '\n---\n\n'
  await appendFile(file, head + renderRun(run))
  return file
}

// ── TESTERS.md ──────────────────────────────────────────────────────────────────────────────────────

const TESTERS_HEAD = '# Testers — the latest run first\n\nWritten by e2e/src/run.ts after every run (B25.5). The full report is the file each run names.\n'

/** B25.5 (4) — the run in a few lines: coverage, works, broken, new findings, cost. */
export function renderSummary(run: ReportedRun, report: string, newItems: string[]): string {
  const c = run.counts
  const map = run.coverage
  const failing = [...byScenario(run.outcomes)].filter(([, os]) => os.some((o) => o.status === 'FAIL'))
  const passing = [...byScenario(run.outcomes)].filter(([, os]) => os.some((o) => o.status === 'PASS'))
  const findings = run.findings ?? []
  return [
    `## ${run.started_at} — ${run.users} users on ${run.app}`,
    '',
    `- **Coverage**: ${map === undefined ? 'no map' : `screens ${tallyLine(map.screens)}; BFF routes ${tallyLine(map.bff)}; ${servicesLine(map)}`}.`,
    `- **Tested**: ${testedText(run)}.`,
    `- **Works**: ${c.PASS} checks passed across ${passing.length} scenario(s).`,
    `- **Broken**: ${failing.length === 0 ? 'nothing failed' : failing.map(([id, os]) =>
      `\`${id}\` (${os.filter((o) => o.status === 'FAIL').length} of ${os.length}${run.filed?.[id] !== undefined ? `, ${run.filed[id]}` : ''})`).join(', ')}` +
      `${c.ERROR > 0 ? `; ${c.ERROR} errored` : ''}.`,
    `- **New findings**: ${newItems.length > 0 ? `build items ${newItems.join(', ')}` : 'no new build item'}; ` +
      `${groupLeads(findings).length} explorer lead(s)${findings.length > 0 ? ` on ${[...new Set(findings.map((f) => f.feature ?? '(no screen)'))].join(', ')}` : ''}.`,
    ...(run.stopped_by === undefined ? [] : [`- **STOPPED EARLY**: ${run.stopped_by}.`]),
    ...(run.incidents ?? []).map((i) => `- **Incident**: ${i}.`),
    ...deepLine(run),
    ...environmentLine(run),
    ...edgeLine(run.edge),
    ...codeLine(run.code),
    ...hostileLine(run.hostile),
    `- **Cost**: $${run.spent_usd.toFixed(2)} of the $${run.cap_usd.toFixed(2)} cap${run.stopped_at_cap ? ' — stopped at the cap' : ''}` +
      `${run.stopped_by === undefined ? '' : ', spent before it stopped'}.`,
    `- **Report**: ${report}`,
    '',
  ].join('\n')
}

/** B35.8 — the environment and the second attempts in one line each, when there was anything to say. */
function environmentLine(run: ReportedRun): string[] {
  const out: string[] = []
  const again = run.second_attempts ?? []
  if (again.length > 0) out.push(`- **Second attempts**: ${again.filter((o) => o.status === 'PASS').length} of ${again.length} passed the second time.`)
  const drops = run.network_drops?.length ?? 0
  const read = (run.memory ?? []).filter((m) => m.swapUsedMB !== undefined && m.swapTotalMB !== undefined && m.swapTotalMB > 0)
  const peak = read.length === 0 ? undefined : Math.max(...read.map((m) => (m.swapUsedMB as number) / (m.swapTotalMB as number)))
  const fewest = run.memory === undefined || run.memory.length === 0 ? undefined : Math.min(...run.memory.map((m) => m.width))
  if (drops > 0 || peak !== undefined) {
    out.push(`- **Environment**: ${drops} network drop(s), each an ERROR` +
      `${peak === undefined ? '' : `; swap up to ${Math.round(100 * peak)}% full, ${fewest} users at once at the fewest`}.`)
  }
  return out
}

/** Puts an entry at the top of TESTERS.md, under its heading; earlier ones stay below. */
async function prependTesters(path: string, entry: string): Promise<void> {
  const existing = await readFile(path, 'utf8').catch(() => '')
  const earlier = existing.startsWith(TESTERS_HEAD) ? existing.slice(TESTERS_HEAD.length) : existing
  await writeFile(path, `${TESTERS_HEAD}\n${entry}${earlier.replace(/^\n+/, '\n')}`)
}

/** Puts the run's summary at the top of TESTERS.md, under its heading; earlier runs stay below. */
export async function writeTesters(path: string, run: ReportedRun, report: string, newItems: string[]): Promise<void> {
  await prependTesters(path, renderSummary(run, report, newItems))
}

/** B34.2 — a night the checkout could not be brought to main's head: why, what it would have tested, and nothing run. */
export interface HeldNight {
  at: string
  why: string
  /** main's head, the commit the night would have tested, or why it is not known. */
  wouldTest: string
  versions: Versions
}

export function renderHeld(h: HeldNight): string {
  return [
    `## ${h.at} — HELD: nothing was run`,
    '',
    `- **Why**: ${h.why}.`,
    `- **Would have tested**: ${h.wouldTest}.`,
    `- **Checkout**: ${versionsLine(h.versions)}.`,
    '- **Next**: the next night tries again; it runs once the checkout can be brought to main.',
    '',
  ].join('\n')
}

export async function writeHeld(path: string, h: HeldNight): Promise<void> {
  await prependTesters(path, renderHeld(h))
}
