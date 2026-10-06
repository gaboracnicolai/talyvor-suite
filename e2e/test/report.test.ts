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

// B29.21 — a scenario's screenshots appear in the report, each thumbnail linking to its file.
describe('screenshots in the report', () => {
  it('shows each screenshot under its verdict, linked beside the report', () => {
    const report = renderRun({ ...cutShort, outcomes: [{ scenario: 'brand-visual', title: 'the brand', user: 2, workspace: 'ws2', status: 'PASS', detail: '16 views',
      evidence: [{ note: '/marketing 1440×900 dark: the brand — logo svg mark', shot: 'shots/2026-10-05T03-00-00-000Z/marketing-1440-dark.jpg' }] }] })
    expect(report).toContain('### Screenshots')
    expect(report).toContain('<a href="shots/2026-10-05T03-00-00-000Z/marketing-1440-dark.jpg"><img src="shots/2026-10-05T03-00-00-000Z/marketing-1440-dark.jpg" height="180" alt="/marketing 1440×900 dark"')
    expect(report).toContain('  - screenshot: [marketing-1440-dark.jpg](shots/2026-10-05T03-00-00-000Z/marketing-1440-dark.jpg)')
  })
})

describe("the testers' environment and the second attempts (B35.8)", () => {
  it('lists each network drop with its time, the memory beside the timeouts, and both attempts', () => {
    const night: ReportedRun = {
      ...cutShort, stopped_by: undefined, incidents: [], counts: { PASS: 0, FAIL: 1, SKIP: 0, ERROR: 2 },
      outcomes: [
        { scenario: 'capital', title: 'capital', user: 3, workspace: 'ws3', status: 'FAIL', detail: 'expected Lima, got "Paris"', evidence: [], at: '2026-10-06T08:31:00.000Z' },
        { scenario: 'known-answer', title: 'sum', user: 5, workspace: 'ws5', status: 'ERROR', detail: 'the answer to "What is 1 + 2?" was refused for a network drop: Failed to fetch', evidence: [], at: '2026-10-06T08:33:00.000Z' },
        { scenario: 'agent-pause-all', title: 'pause', user: 2, workspace: 'ws2', status: 'ERROR', detail: 'locator.click: Timeout 30000ms exceeded.', evidence: [], at: '2026-10-06T08:36:00.000Z' },
      ],
      network_drops: [{ at: '2026-10-06T08:33:00.000Z', user: 5, scenario: 'known-answer', detail: 'the answer to "What is 1 + 2?" was refused for a network drop: Failed to fetch' }],
      memory: [
        { at: '2026-10-06T08:30:00.000Z', pressure: 'normal', swapUsedMB: 6144, swapTotalMB: 9216, width: 20 },
        { at: '2026-10-06T08:35:00.000Z', pressure: 'warn', swapUsedMB: 7900, swapTotalMB: 9216, width: 10 },
      ],
      second_attempts: [{ scenario: 'capital', title: 'capital', user: 3, workspace: 'ws3', status: 'PASS', detail: 'Peru → Lima', evidence: [] }],
    }
    const report = renderRun(night)
    expect(report).toContain('- 08:33:00Z user 5 `known-answer`: the answer to "What is 1 + 2?" was refused for a network drop: Failed to fetch')
    expect(report).toContain('| 08:30:00Z | normal | 6.0 of 9.0 GB (67%) | 20 | 0 |')
    expect(report).toContain('| 08:35:00Z | warn | 7.7 of 9.0 GB (86%) | 10 | 1 |')
    expect(report).toContain('| `capital` | 3 | FAIL: expected Lima, got "Paris" | PASS: Peru → Lima |')
    expect(report).toContain('PASS capital — user 3 (second attempt): Peru → Lima')
    const summary = renderSummary(night, 'docs/e2e/report-2026-10-06.md', [])
    expect(summary).toContain('- **Second attempts**: 1 of 1 passed the second time.')
    expect(summary).toContain('- **Environment**: 1 network drop(s), each an ERROR; swap up to 86% full, 10 users at once at the fewest.')
  })
})

// B34.2 — the report and the TESTERS.md entry name what was tested, and a deploy that landed during the run.
describe('what was tested', () => {
  it('names the harness, Lens\'s main at lens-src and production\'s versions, and a deploy during the run', () => {
    const run: ReportedRun = { ...cutShort, versions: { harness: '29272c1', lens_src: '2e09c95', app: '29272c1', lens: '2e09c95' },
      production_after: { app: '29272c1', lens: '7a1b2c3' } }
    const tested = "harness 29272c1; Lens's main at lens-src 2e09c95; production app 29272c1 (/api/version), Lens 2e09c95 → 7a1b2c3 (deployed during the run) (/healthz)."
    expect(renderRun(run)).toContain(`Tested: ${tested}`)
    expect(renderSummary(run, 'docs/e2e/report-2026-10-02.md', [])).toContain(`- **Tested**: ${tested}`)
  })
})
