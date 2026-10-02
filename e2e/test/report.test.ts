import { describe, expect, it } from 'vitest'
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
