// B17.4 — the report Nicolai reads: one Markdown file a day, docs/e2e/report-YYYY-MM-DD.md, with the
// run's summary and cost, every scenario's verdict, and each failure with its evidence. A second run
// the same day is appended below the first; a report is never overwritten or deleted.

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  }[]
}

/** A Markdown table cell: one line, pipes escaped. */
const cell = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

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

/** One run as a report section. */
export function renderRun(run: ReportedRun): string {
  const c = run.counts
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
    '| Scenario | Pass | Fail | Error | Skip | What it checks |',
    '|---|---:|---:|---:|---:|---|',
  ]
  const byScenario = new Map<string, { title: string; n: Record<string, number> }>()
  for (const o of run.outcomes) {
    const s = byScenario.get(o.scenario) ?? { title: o.title, n: { PASS: 0, FAIL: 0, ERROR: 0, SKIP: 0 } }
    s.n[o.status]++
    byScenario.set(o.scenario, s)
  }
  for (const [id, s] of byScenario) {
    lines.push(`| \`${id}\` | ${s.n.PASS} | ${s.n.FAIL} | ${s.n.ERROR} | ${s.n.SKIP} | ${cell(s.title)} |`)
  }

  const bad = run.outcomes.filter((o) => o.status === 'FAIL' || o.status === 'ERROR')
  lines.push('', `### Failures (${bad.length})`, '')
  if (bad.length === 0) lines.push('None.')
  for (const o of bad) {
    lines.push(`**${o.status} \`${o.scenario}\`** — user ${o.user} (${o.workspace}): ${cell(o.detail)}`, '', ...evidenceLines(o.evidence), '')
  }

  lines.push('', '### Every verdict', '')
  for (const o of run.outcomes) {
    lines.push(`<details><summary>${o.status} ${o.scenario} — user ${o.user}: ${escapeHTML(o.detail)}</summary>`, '')
    lines.push(...(o.evidence.length > 0 ? evidenceLines(o.evidence) : ['- no evidence recorded']), '', '</details>')
  }
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
