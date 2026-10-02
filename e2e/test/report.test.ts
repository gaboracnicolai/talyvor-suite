import { describe, expect, it } from 'vitest'
import type { Finding } from '../src/explore.ts'
import { type ReportedRun, renderRun, renderSummary } from '../src/report.ts'

// B26.18 — a run that was cut short still says, in the report and in TESTERS.md, why it stopped, what went
// wrong under it, and what it spent before then.
const cutShort: ReportedRun = {
  started_at: '2026-10-02T03:00:00.000Z', finished_at: '2026-10-02T03:20:00.000Z', app: 'https://app', lens: 'https://lens',
  users: 10, model: 'Claude Haiku 4.5', cap_usd: 5, spent_usd: 0.42, stopped_at_cap: false,
  stopped_by: 'Lens stopped answering at 2026-10-02T03:19:00.000Z (fetch failed (connect ECONNREFUSED 127.0.0.1:9911)) while the users ran their journeys',
  incidents: ['2026-10-02T03:10:00.000Z the browser went away mid-run (it crashed or was killed); the users in it errored and the rest had a new one'],
  counts: { PASS: 1, FAIL: 0, SKIP: 1, ERROR: 0 },
  outcomes: [
    { scenario: 'known-answer', title: 'arithmetic', user: 0, workspace: 'ws0', status: 'PASS', detail: '1 + 1 = 2', evidence: [] },
    { scenario: 'known-answer', title: 'arithmetic', user: 1, workspace: 'ws1', status: 'SKIP', detail: 'not run: Lens stopped answering', evidence: [] },
  ],
}

describe('a run that stopped early', () => {
  it('names the cause, the incidents and the spend so far in the report and in the summary', () => {
    const report = renderRun(cutShort)
    expect(report).toContain('**STOPPED EARLY** — Lens stopped answering at 2026-10-02T03:19:00.000Z (fetch failed (connect ECONNREFUSED')
    expect(report).toContain('- 2026-10-02T03:10:00.000Z the browser went away mid-run')
    expect(report).toContain('Cost: about $0.4200 of a $5.00 cap.')

    const summary = renderSummary(cutShort, 'docs/e2e/report-2026-10-02.md', [])
    expect(summary).toContain('- **STOPPED EARLY**: Lens stopped answering at 2026-10-02T03:19:00.000Z')
    expect(summary).toContain('- **Incident**: 2026-10-02T03:10:00.000Z the browser went away mid-run')
    expect(summary).toContain('- **Cost**: $0.42 of the $5.00 cap, spent before it stopped.')
  })
})

// B26.19 — each distinct lead once, with how many explorers saw it.
describe("the explorers' leads", () => {
  it('lists a lead once with the explorers who saw it, the most seen first', () => {
    const f = (explorer: number, lead: number, note: string): Finding =>
      ({ explorer, source: 'explorer', severity: 'high', where: '/keys', note, trail: [], at: '', feature: 'API keys', screen: '/keys', lead })
    const report = renderRun({ ...cutShort, explorers: [{ explorer: 0, steps: 5, stopped: 'done', detail: '' }],
      findings: [f(0, 1, 'a one-off'), f(0, 2, 'the list is stuck on Loading…'), f(4, 2, 'the list is stuck on Loading…'), f(7, 2, 'the list is stuck on Loading…')] })
    expect(report).toContain('### Explorers — 2 distinct lead(s) to check, from 4 note(s)')
    const keys = report.slice(report.indexOf('#### API keys'))
    expect(keys.match(/stuck on Loading/g)).toHaveLength(1)
    expect(keys.indexOf('- **high** 3 explorers (0, 4, 7) on `/keys`: the list is stuck on Loading…')).toBeLessThan(keys.indexOf('a one-off'))
    expect(report).toContain('The most notes one explorer made on one screen: 2.')
  })
})
