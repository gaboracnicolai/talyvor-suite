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
import { type CoverageMap, type Row, tallyLine } from './coverage.ts'
import type { ExplorerSummary, Finding } from './explore.ts'
import type { Evidence } from './scenarios.ts'

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
  }[]
  explorers?: ExplorerSummary[]
  findings?: Finding[]
  /** B25.5 — the map of every screen and route, and its state. */
  coverage?: CoverageMap
  /** Each failing scenario's build item (B17.4): filed by this run, or already open. */
  filed?: Record<string, string>
}

type Outcome = ReportedRun['outcomes'][number]

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

/** The same note on the same screen is one lead, however often and by however many it was seen. */
function leads(findings: Finding[]): string[] {
  const m = new Map<string, { f: Finding; times: number; who: Set<number> }>()
  for (const f of findings) {
    const key = `${f.source}|${f.where}|${f.note}`
    const l = m.get(key) ?? { f, times: 0, who: new Set<number>() }
    l.times++
    l.who.add(f.explorer)
    m.set(key, l)
  }
  const lines: string[] = []
  for (const { f, times, who } of m.values()) {
    const by = `explorer${who.size > 1 ? 's' : ''} ${[...who].sort((a, b) => a - b).join(', ')}`
    lines.push(`- **${f.severity}** ${f.source === 'browser' ? `the browser of ${by}` : by} on ` +
      `\`${f.where}\`${times > 1 ? ` (${times} times)` : ''}: ${cell(f.note)}`)
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

/** The explorers' sessions: where each started and why it stopped. */
function explorerTable(run: ReportedRun): string[] {
  const explorers = run.explorers ?? []
  if (explorers.length === 0) return []
  const lines = ['', `### Explorers — ${(run.findings ?? []).length} finding(s) to check, each under its feature above`, '',
    '| Explorer | Started at | Steps | Stopped | |', '|---:|---|---:|---|---|',
    ...explorers.map((e) => `| ${e.explorer} | ${e.start ?? ''} | ${e.steps} | ${e.stopped} | ${cell(e.detail)} |`), '']
  if (explorers.some((e) => e.stopped === 'cap')) lines.push('The explorers stopped at the spend cap.', '')
  return lines
}

const byText = (r: Row): string => {
  const top = Object.entries(r.by).sort((a, b) => b[1] - a[1])
  const shown = top.slice(0, 4).map(([s, n]) => `${s} ×${n}`)
  return [...shown, ...(top.length > 4 ? [`+${top.length - 4} more`] : []), ...(r.explorers > 0 ? [`explorers ×${r.explorers}`] : [])].join(', ')
}
const answersText = (r: Row): string => Object.entries(r.answers).sort().map(([s, n]) => `${s === '0' ? 'none' : s} ×${n}`).join(', ')
const stateText = (r: Row): string => (r.why !== undefined ? `${r.state}: ${r.why}` : r.state)

/** B25.5 (1) — every screen, BFF route and Lens route, with its state. */
export function renderMap(map: CoverageMap): string[] {
  const lines = ['', '### Coverage map', '',
    'Every screen the web app mounts, every route the BFF registers and every route Lens registers, read from the code at the',
    'time of the run. **covered**: a scenario with an oracle reached it (×users). **explorers only**: only an explorer did, so',
    'nothing checked it. **cannot be tested yet**: with why. **not covered**: nothing reached it. A Lens route reached through',
    'the app is counted through the BFF route that leads to it (the Through column); one the BFF reaches by a path it builds',
    'another way is not linked, so Lens coverage can read low.', '',
    `#### Screens — ${tallyLine(map.screens)}`, '',
    '| Screen | Feature | State | Covered by | Opens in |', '|---|---|---|---|---|',
    ...map.screens.map((r) => `| \`${r.path}\` | ${cell(r.feature)} | ${cell(stateText(r))} | ${cell(byText(r))} | ${timingText(r)} |`),
    '', `#### BFF routes — ${tallyLine(map.bff)}`, '',
    '| Route | State | Covered by | Called from | Answers | Time |', '|---|---|---|---|---|---|',
    ...map.bff.map((r) => `| \`${r.method} ${r.path}\` | ${cell(stateText(r))} | ${cell(byText(r))} | ${cell(r.from.join(', '))} | ${answersText(r)} | ${timingText(r)} |`),
    '', `#### Lens routes — ${map.lensMissing !== undefined ? `NOT LISTED: ${map.lensMissing}` : tallyLine(map.lens)}`, '']
  if (map.lens.length > 0) {
    lines.push('| Route | State | Covered by | Through | Answers | Time |', '|---|---|---|---|---|---|',
      ...map.lens.map((r) => `| \`${r.method} ${r.path}\` | ${cell(stateText(r))} | ${cell(byText(r))} | ${cell(r.through.join(', '))} | ${answersText(r)} | ${timingText(r)} |`))
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
    `Cost: about $${run.spent_usd.toFixed(4)} of a $${run.cap_usd.toFixed(2)} cap` +
      (run.stopped_at_cap ? ' — STOPPED AT THE CAP; everything after it was skipped.' : '.') +
      ` Finished ${run.finished_at}.`,
    '',
    ...(map === undefined ? [] : [
      `Coverage: screens ${tallyLine(map.screens)}; BFF routes ${tallyLine(map.bff)}; Lens routes ` +
        `${map.lensMissing !== undefined ? `not listed (${map.lensMissing})` : tallyLine(map.lens)}. The map is at the end.`, '']),
    '| Scenario | Pass | Fail | Error | Skip | What it checks |',
    '|---|---:|---:|---:|---:|---|',
  ]
  for (const [id, os] of byScenario(run.outcomes)) {
    const n = { PASS: 0, FAIL: 0, ERROR: 0, SKIP: 0 }
    for (const o of os) n[o.status]++
    lines.push(`| \`${id}\` | ${n.PASS} | ${n.FAIL} | ${n.ERROR} | ${n.SKIP} | ${cell(os[0].title)} |`)
  }

  // The features in the order the app mounts them, then any a scenario named for itself.
  const features = [...new Set([...(map?.screens.map((r) => r.feature) ?? []), ...run.outcomes.flatMap(featuresOf),
    ...(run.findings ?? []).map((f) => f.feature ?? '(no screen)')])]
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
  for (const o of run.outcomes) {
    lines.push(`<details><summary>${o.status} ${o.scenario} — user ${o.user}: ${escapeHTML(o.detail)}</summary>`, '')
    lines.push(...(o.evidence.length > 0 ? evidenceLines(o.evidence) : ['- no evidence recorded']), '', '</details>')
  }
  if (map !== undefined) lines.push(...renderMap(map))
  return lines.join('\n') + '\n'
}

const escapeHTML = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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
    `- **Coverage**: ${map === undefined ? 'no map' : `screens ${tallyLine(map.screens)}; BFF routes ${tallyLine(map.bff)}; Lens routes ` +
      `${map.lensMissing !== undefined ? `not listed (${map.lensMissing})` : tallyLine(map.lens)}`}.`,
    `- **Works**: ${c.PASS} checks passed across ${passing.length} scenario(s).`,
    `- **Broken**: ${failing.length === 0 ? 'nothing failed' : failing.map(([id, os]) =>
      `\`${id}\` (${os.filter((o) => o.status === 'FAIL').length} of ${os.length}${run.filed?.[id] !== undefined ? `, ${run.filed[id]}` : ''})`).join(', ')}` +
      `${c.ERROR > 0 ? `; ${c.ERROR} errored` : ''}.`,
    `- **New findings**: ${newItems.length > 0 ? `build items ${newItems.join(', ')}` : 'no new build item'}; ` +
      `${findings.length} explorer lead(s)${findings.length > 0 ? ` on ${[...new Set(findings.map((f) => f.feature ?? '(no screen)'))].join(', ')}` : ''}.`,
    `- **Cost**: $${run.spent_usd.toFixed(2)} of the $${run.cap_usd.toFixed(2)} cap${run.stopped_at_cap ? ' — stopped at the cap' : ''}.`,
    `- **Report**: ${report}`,
    '',
  ].join('\n')
}

/** Puts the run's summary at the top of TESTERS.md, under its heading; earlier runs stay below. */
export async function writeTesters(path: string, run: ReportedRun, report: string, newItems: string[]): Promise<void> {
  const existing = await readFile(path, 'utf8').catch(() => '')
  const earlier = existing.startsWith(TESTERS_HEAD) ? existing.slice(TESTERS_HEAD.length) : existing
  await writeFile(path, `${TESTERS_HEAD}\n${renderSummary(run, report, newItems)}${earlier.replace(/^\n+/, '\n')}`)
}
