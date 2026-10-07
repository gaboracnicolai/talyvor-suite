// B34.3 — TALYVOR EDGE IN THE NIGHTLY REPORT. edge-infra is never deployed: its features are proven on kind, and
// every one of its workflows runs each night on main on GitHub (B28.199). Each night the testers read, with gh, the
// latest scheduled run on main of every edge-infra workflow, and Kind E2E's log. Each "==> PHASE n — title" in that
// log is one Edge feature: passed if the run went past it, failed where an "X" line stopped it, not reached after
// that. The phases are mapped to the rows of docs/self-host-claims.md. A run older than 36 hours is stale, never
// green. A failed phase or workflow files one build item for edge-infra, once (filing.ts's rule).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const EDGE_REPO = 'gaboracnicolai/edge-infra'
/** A nightly run older than this is reported as stale, never as green. */
export const STALE_HOURS = 36
const KIND_E2E = 'Kind E2E'
const UP_SH = 'deploy/local/up.sh'
const CLAIMS_MD = 'docs/self-host-claims.md'
const FAILED = new Set(['failure', 'timed_out', 'startup_failure'])

export type PhaseState = 'passed' | 'failed' | 'not reached' | 'not in the run' | 'not read'

export interface Phase {
  n: number
  title: string
  state: PhaseState
  /** The "X" line that stopped the run, for the failed phase. */
  why?: string
}

export interface Claim {
  row: number
  claim: string
  /** The step column as the doc words it. */
  step: string
  phases: number[]
  state: string
}

export interface Workflow {
  name: string
  path: string
  /** success, failure, … as GitHub concludes it; undefined when there is no completed nightly run on main. */
  conclusion?: string
  url?: string
  sha?: string
  started?: string
  stale: boolean
  /** The jobs that failed, each with its failed step. */
  failedJobs?: string[]
  /** For Kind E2E: the phase it stopped in. */
  phase?: number
  /** The build item that holds its failure, filed this night or already open. */
  item?: string
}

export interface EdgeReport {
  repo: string
  read_at: string
  /** Why the runs could not be read at all. */
  error?: string
  workflows: Workflow[]
  phases: Phase[]
  /** Why Kind E2E's phases could not be read, when they could not. */
  phases_error?: string
  claims: Claim[]
  claims_error?: string
}

interface Run { id: number; status: string; conclusion: string | null; created_at: string; run_started_at?: string; html_url: string; head_sha: string }

/** Runs gh with these arguments and answers what it printed. */
export type Gh = (args: string[]) => Promise<string>

export const ghCLI: Gh = async (args) =>
  (await promisify(execFile)('gh', args, { maxBuffer: 256 * 1024 * 1024, timeout: 180_000 })).stdout

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
/** What a line of `gh run view --log` says: its job, step and timestamp taken off, and its colour codes. */
const GH_PREFIX = /^[^\t]*\t[^\t]*\t\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/
export const logText = (line: string): string => line.replace(GH_PREFIX, '').replace(ANSI, '')

const PHASE = /^==> PHASE (\d+) — (.*)$/
const X_LINE = /^\s*X (.*)$/

/** Every phase up.sh on main declares, in number order; a phase declared twice (PHASE 3: build or pull) once. */
export function phasesDeclared(upSh: string): { n: number; title: string }[] {
  const out = new Map<number, string>()
  for (const m of upSh.matchAll(/section "PHASE (\d+) — ([^"]*)"/g)) if (!out.has(Number(m[1]))) out.set(Number(m[1]), m[2])
  return [...out].sort((a, b) => a[0] - b[0]).map(([n, title]) => ({ n, title }))
}

/**
 * Kind E2E's phases from its log: each passed once the run went past it, the one an "X" line stopped failed, and every
 * phase `declared` names that the run never reached is not reached. `passedRun` is a run GitHub concluded green: a
 * phase it did not print is then one main has and its commit did not have yet — not in the run.
 */
export function parseKindLog(log: string, declared: { n: number; title: string }[], passedRun: boolean): Phase[] {
  const seen: Phase[] = []
  let stopped = false
  for (const raw of log.split('\n')) {
    const line = logText(raw)
    const p = PHASE.exec(line)
    if (p !== null && !stopped) {
      if (seen.length > 0) seen[seen.length - 1].state = 'passed'
      seen.push({ n: Number(p[1]), title: p[2].trim(), state: 'not reached' })
      continue
    }
    const x = X_LINE.exec(line)
    if (x !== null && !stopped && seen.length > 0) {
      seen[seen.length - 1].state = 'failed'
      seen[seen.length - 1].why = x[1].trim()
      stopped = true
    }
  }
  const last = seen[seen.length - 1]
  if (last !== undefined && !stopped) {
    if (passedRun) last.state = 'passed'
    else {
      last.state = 'failed'
      last.why = 'the run stopped here without an X line'
    }
  }
  const byN = new Map(seen.map((p) => [p.n, p]))
  for (const d of declared) if (!byN.has(d.n)) byN.set(d.n, { n: d.n, title: d.title, state: passedRun ? 'not in the run' : 'not reached' })
  return [...byN.values()].sort((a, b) => a.n - b.n)
}

/** The phase numbers a claim's step names: "Phases 1–7", "Phases 9, 12, 15", "Phases 10–11, 16", "Phase 15". */
export function phasesNamed(step: string): number[] {
  const m = /Phases?\s+([\d\s,–-]+)/.exec(step)
  if (m === null) return []
  const out: number[] = []
  for (const part of m[1].split(',')) {
    const [a, b] = part.split(/[–-]/).map((s) => Number(s.trim()))
    if (!Number.isFinite(a) || a === 0) continue
    for (let n = a; n <= (Number.isFinite(b) && b > 0 ? b : a); n++) out.push(n)
  }
  return out
}

/** The state of a claim whose step runs these phases. */
function stateOf(phases: number[], byN: Map<number, Phase>): string {
  const states = phases.map((n) => byN.get(n)?.state ?? 'not reached')
  if (states.includes('failed')) return `failed (phase ${phases.filter((n) => byN.get(n)?.state === 'failed').join(', ')})`
  if (states.includes('not read')) return 'not read'
  if (states.some((s) => s !== 'passed')) return `not reached (phase ${phases.filter((n) => byN.get(n)?.state !== 'passed').join(', ')})`
  return 'proven'
}

/** Every row of docs/self-host-claims.md's table, with its state from Kind E2E's phases. */
export function claimsOf(md: string, phases: Phase[]): Claim[] {
  const byN = new Map(phases.map((p) => [p.n, p]))
  const rows: Claim[] = []
  const asserts = new Map<number, string>()
  for (const line of md.split('\n')) {
    const cells = /^\|\s*(\d+)\s*\|(.*)\|\s*$/.exec(line)
    if (cells === null) continue
    const [claim, step, what] = cells[2].split(/(?<!\\)\|/).map((c) => c.trim())
    rows.push({ row: Number(cells[1]), claim, step, phases: phasesNamed(step), state: '' })
    asserts.set(Number(cells[1]), (what ?? '').replace(/`/g, ''))
  }
  for (const r of rows) {
    const plain = r.step.replace(/\*/g, '')
    const partly = /^partly\b.*rows? (\d+)\s*[–-]\s*(\d+)/.exec(plain)
    if (/^not run\b/.test(plain)) r.state = `not run: ${asserts.get(r.row) || 'no step runs it'}`
    else if (partly !== null) {
      const of = rows.filter((x) => x.row >= Number(partly[1]) && x.row <= Number(partly[2]))
      r.phases = [...new Set(of.flatMap((x) => x.phases))].sort((a, b) => a - b)
      r.state = `partly: rows ${partly[1]}–${partly[2]} ${stateOf(r.phases, byN)}`
    } else r.state = r.phases.length === 0 ? 'no phase named' : stateOf(r.phases, byN)
  }
  return rows
}

const hoursSince = (iso: string, now: Date): number => (now.getTime() - Date.parse(iso)) / 3_600_000
export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const firstLine = (e: unknown): string => {
  const err = e as { stderr?: string; message?: string }
  return ((err.stderr ?? '').trim() || (err.message ?? String(e))).split('\n')[0]
}

/** The latest scheduled run on main of every edge-infra workflow, Kind E2E's phases, and the claims they prove. */
export async function readEdge(repo: string, now: Date = new Date(), gh: Gh = ghCLI): Promise<EdgeReport> {
  const out: EdgeReport = { repo, read_at: now.toISOString(), workflows: [], phases: [], claims: [] }
  const api = async <T>(path: string): Promise<T> => JSON.parse(await gh(['api', path])) as T
  const raw = (path: string) => gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${path}?ref=main`])
  let list: { name: string; path: string; id: number }[]
  try {
    list = (await api<{ workflows: { name: string; path: string; id: number }[] }>(`repos/${repo}/actions/workflows?per_page=100`)).workflows
  } catch (e) {
    out.error = `gh could not list ${repo}'s workflows: ${firstLine(e)}`
    return out
  }
  let kindRun: Workflow | undefined
  let kindRunID: number | undefined
  for (const w of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
    const wf: Workflow = { name: w.name, path: w.path, stale: false }
    out.workflows.push(wf)
    try {
      // GitHub's filtered list has answered empty for a workflow it listed a minute before, so an empty answer is asked again.
      const ask = async () => (await api<{ workflow_runs: Run[] }>(`repos/${repo}/actions/workflows/${w.id}/runs?branch=main&event=schedule&per_page=10`)).workflow_runs
      let runs = await ask()
      if (runs.length === 0) runs = await ask()
      const r = runs.find((x) => x.status === 'completed')
      if (r === undefined) continue
      wf.conclusion = r.conclusion ?? 'unknown'
      wf.url = r.html_url
      wf.sha = r.head_sha.slice(0, 7)
      wf.started = r.run_started_at ?? r.created_at
      wf.stale = hoursSince(wf.started, now) > STALE_HOURS
      if (FAILED.has(wf.conclusion)) {
        const jobs = (await api<{ jobs: { name: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] }[] }>(
          `repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`)).jobs
        wf.failedJobs = jobs.filter((j) => j.conclusion !== null && FAILED.has(j.conclusion))
          .map((j) => `${j.name}${(j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => `: ${s.name}`).join('')}`)
      }
      if (w.name === KIND_E2E) {
        kindRun = wf
        kindRunID = r.id
      }
    } catch (e) {
      wf.conclusion = `not read: ${firstLine(e)}`
    }
  }

  let declared: { n: number; title: string }[] = []
  try {
    declared = phasesDeclared(await raw(UP_SH))
  } catch (e) {
    out.phases_error = `${UP_SH} on main not read: ${firstLine(e)}`
  }
  if (kindRun === undefined || kindRunID === undefined) {
    out.phases_error ??= list.some((w) => w.name === KIND_E2E) ? `${KIND_E2E} has no completed nightly run on main` : `${repo} has no ${KIND_E2E} workflow`
    out.phases = declared.map((d) => ({ ...d, state: 'not read' }))
  } else {
    try {
      out.phases = parseKindLog(await gh(['run', 'view', String(kindRunID), '-R', repo, '--log']), declared, kindRun.conclusion === 'success')
      kindRun.phase = out.phases.find((p) => p.state === 'failed')?.n
    } catch (e) {
      out.phases_error = `${KIND_E2E}'s log not read: ${firstLine(e)}`
      out.phases = declared.map((d) => ({ ...d, state: 'not read' }))
    }
  }
  try {
    out.claims = claimsOf(await raw(CLAIMS_MD), out.phases)
  } catch (e) {
    out.claims_error = `${CLAIMS_MD} on main not read: ${firstLine(e)}`
  }
  return out
}

/** The marker of a failed workflow's item: `edge-<workflow>-<phase>`, or its failed job when it has no phase. */
export const edgeMarker = (w: Workflow): string =>
  `edge-${slug(w.name)}-${w.phase !== undefined ? `phase-${w.phase}` : slug(w.failedJobs?.[0]?.split(':')[0] ?? 'run')}`

export const failedNow = (w: Workflow): boolean => w.conclusion !== undefined && FAILED.has(w.conclusion)

// ── The report ──────────────────────────────────────────────────────────────────────────────────────

const cell = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
const when = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')}Z`

/** A workflow's result as the report says it: a stale run is never green. */
export function resultOf(w: Workflow): string {
  if (w.conclusion === undefined) return '**no nightly run on main**'
  if (w.conclusion.startsWith('not read')) return `**${w.conclusion}**`
  const said = w.conclusion === 'success' ? 'green' : `**${w.conclusion}**`
  const where = w.phase !== undefined ? ` in PHASE ${w.phase}` : (w.failedJobs ?? []).length > 0 ? ` (${(w.failedJobs ?? []).join('; ')})` : ''
  return `${w.stale ? `**STALE** — last ${said}` : said}${where}${w.item !== undefined ? ` — build item ${w.item}` : ''}`
}

const phaseText = (p: Phase, run: Workflow | undefined): string =>
  p.state === 'failed' ? `**failed**: X ${cell(p.why ?? '')}`
    : p.state === 'passed' && run?.stale === true ? 'passed, in a **stale** run'
      : p.state === 'not in the run' ? `not in the run: newer on main than its commit ${run?.sha ?? ''}` : p.state

/** The report's Talyvor Edge section: every workflow with its result and run, every Kind E2E phase, every claim. */
export function renderEdge(edge: EdgeReport | undefined): string[] {
  if (edge === undefined) return []
  const lines = ['', '### Talyvor Edge — last night on main', '']
  if (edge.error !== undefined) return [...lines, `**Not read**: ${edge.error}.`, '']
  const kind = edge.workflows.find((w) => w.name === KIND_E2E)
  lines.push(`The latest scheduled run on main of each of ${edge.repo}'s ${edge.workflows.length} workflows, read ${when(edge.read_at)}. ` +
    `A run older than ${STALE_HOURS} hours is stale, never green.`, '',
  '| Workflow | Result | Run | Commit | Started |', '|---|---|---|---|---|',
  ...edge.workflows.map((w) => `| ${cell(w.name)} | ${cell(resultOf(w))} | ${w.url === undefined ? '' : `[${w.url.split('/').pop()}](${w.url})`} | ` +
    `${w.sha ?? ''} | ${w.started === undefined ? '' : when(w.started)} |`), '')

  const passed = edge.phases.filter((p) => p.state === 'passed').length
  lines.push(`#### Kind E2E — ${passed} of ${edge.phases.length} phases passed`, '')
  if (edge.phases_error !== undefined) lines.push(`**Not read**: ${edge.phases_error}.`, '')
  if (edge.phases.length > 0) {
    lines.push('Each phase is one Edge feature, as deploy/local/up.sh on main declares it: passed if the run went past it, failed where an X line stopped it.', '',
      '| Phase | Edge feature | State |', '|---:|---|---|',
      ...edge.phases.map((p) => `| ${p.n} | ${cell(p.title)} | ${phaseText(p, kind)} |`), '')
  }
  lines.push(`#### The self-host page's claims — docs/self-host-claims.md`, '')
  if (edge.claims_error !== undefined) lines.push(`**Not read**: ${edge.claims_error}.`, '')
  if (edge.claims.length > 0) {
    lines.push('| # | Claim | Step | State |', '|---:|---|---|---|',
      ...edge.claims.map((c) => `| ${c.row} | ${cell(c.claim)} | ${cell(c.step)} | ${kind?.stale === true && c.state === 'proven' ? 'proven in a **stale** run' : cell(c.state)} |`), '')
  }
  return lines
}

/** The Edge section in one line, for TESTERS.md. */
export function edgeLine(edge: EdgeReport | undefined): string[] {
  if (edge === undefined) return []
  if (edge.error !== undefined) return [`- **Talyvor Edge**: not read — ${edge.error}.`]
  const count = (pred: (w: Workflow) => boolean) => edge.workflows.filter(pred)
  const green = count((w) => w.conclusion === 'success' && !w.stale).length
  const failed = count(failedNow).map((w) => `${w.name}${w.phase !== undefined ? ` PHASE ${w.phase}` : ''}${w.item !== undefined ? `, ${w.item}` : ''}`)
  const stale = count((w) => w.stale).map((w) => w.name)
  const none = count((w) => w.conclusion === undefined).map((w) => w.name)
  const passed = edge.phases.filter((p) => p.state === 'passed').length
  return [`- **Talyvor Edge**: ${green} of ${edge.workflows.length} workflows green` +
    `${failed.length > 0 ? `; failed: ${failed.join(', ')}` : ''}${stale.length > 0 ? `; stale: ${stale.join(', ')}` : ''}` +
    `${none.length > 0 ? `; no nightly run: ${none.join(', ')}` : ''}; Kind E2E ${passed} of ${edge.phases.length} phases passed; ` +
    `claims: ${edge.claims.filter((c) => c.state === 'proven').length} of ${edge.claims.length} proven.`]
}
