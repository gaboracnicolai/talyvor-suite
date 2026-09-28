import { describe, expect, it } from 'vitest'
import { itemsFor } from '../src/filing.ts'
import { type ReportedRun, renderRun } from '../src/report.ts'

const QUEUE = `# queue

## B17.9 — an earlier item
repo: talyvor-suite · deps: none · status: DONE 04b46a2 — done
Body.
`

function run(failing: string[]): ReportedRun {
  const outcomes: ReportedRun['outcomes'] = [
    { scenario: 'known-answer', title: 'arithmetic', user: 0, workspace: 'ws0', status: 'PASS', detail: '1 + 1 = 2', evidence: [] },
  ]
  for (const [i, scenario] of failing.entries()) {
    outcomes.push({ scenario, title: `the ${scenario} check`, user: i + 1, workspace: `ws${i + 1}`, status: 'FAIL',
      detail: 'the reduced output lost "warehouse"', evidence: [{ note: 'reduced', question: 'q', answer: 'a', footer: 'f' }] })
    outcomes.push({ scenario, title: `the ${scenario} check`, user: i + 11, workspace: `ws${i + 11}`, status: 'FAIL', detail: 'again', evidence: [] })
  }
  return {
    started_at: '2026-09-28T20:00:00.000Z', finished_at: '2026-09-28T20:10:00.000Z', app: 'https://app', lens: 'https://lens',
    users: 20, model: 'Claude Haiku 4.5', cap_usd: 5, spent_usd: 1.25, stopped_at_cap: false,
    counts: { PASS: 1, FAIL: failing.length * 2, SKIP: 0, ERROR: 0 }, outcomes,
  }
}

describe('filing a build item for each failing scenario', () => {
  it('files one item per failing scenario, numbered next in B17, in the queue format, for the owning repo', () => {
    const f = itemsFor(QUEUE, run(['try-tare', 'docs-ai']), 'docs/e2e/report-2026-09-28.md')
    expect(f.filed).toEqual([
      { id: 'B17.10', scenario: 'try-tare', repo: 'talyvor-lens' },
      { id: 'B17.11', scenario: 'docs-ai', repo: 'talyvor-docs' },
    ])
    expect(f.append).toContain('\n## B17.10 — the testers found it: the try-tare check\nrepo: talyvor-lens · deps: none · status: OPEN\n')
    expect(f.append).toContain('FAILED for 2 of 2 synthetic user(s)')
    expect(f.append).toContain('\ne2e-scenario: try-tare\n')
  })

  it('a second run files nothing for a scenario an open item already covers', () => {
    const first = QUEUE + itemsFor(QUEUE, run(['try-tare']), 'r.md').append
    const second = itemsFor(first, run(['try-tare']), 'r.md')
    expect(second.append).toBe('')
    expect(second.covered).toEqual([{ scenario: 'try-tare', by: 'B17.10' }])
  })

  it('files again when the covering item is DONE and the scenario fails anew', () => {
    const done = (QUEUE + itemsFor(QUEUE, run(['try-tare']), 'r.md').append)
      .replace('repo: talyvor-lens · deps: none · status: OPEN', 'repo: talyvor-lens · deps: none · status: DONE abc1234 — fixed')
    expect(itemsFor(done, run(['try-tare']), 'r.md').filed).toEqual([{ id: 'B17.11', scenario: 'try-tare', repo: 'talyvor-lens' }])
  })
})

describe('the report', () => {
  it('states the cost and gives each failure one line, with its evidence', () => {
    const md = renderRun(run(['try-tare']))
    expect(md).toContain('Cost: about $1.2500 of a $5.00 cap.')
    expect(md.split('\n').filter((l) => l.startsWith('**FAIL `try-tare`**'))).toHaveLength(2)
    expect(md).toContain('| `try-tare` | 0 | 2 | 0 | 0 | the try-tare check |')
    expect(md).toContain('  - asked: q')
  })
})
