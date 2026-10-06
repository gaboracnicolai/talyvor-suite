import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { coveredScenarios, itemsFor } from '../src/filing.ts'
import { type ReportedRun, renderRun } from '../src/report.ts'
import { OWNERS, journeyFor, scenarioOwners } from '../src/scenarios.ts'

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

describe('B35.9 — each defect once, in the repo that has it', () => {
  it('every scenario a night of 500 users runs names its owner, one of the six repos', () => {
    for (let i = 0; i < 500; i++) {
      for (const s of journeyFor(i, 500, [])) expect(OWNERS, `${s.id} names no owner`).toContain(s.owner)
    }
    expect(scenarioOwners().get('ledger-matches-answers')).toBe('talyvor-lens')
  })

  it('an item covers its scenarios while OPEN, CLAIMED or BLOCKED; DONE or SUPERSEDED, it does not', () => {
    const md = ['OPEN', 'CLAIMED tab 2026-10-06T12:00:00Z', 'BLOCKED — needs B1.1', 'DONE abc1234', 'SUPERSEDED by B35.7']
      .map((st, i) => `## B17.${i + 1} — x\nrepo: talyvor-lens · deps: none · status: ${st}\ne2e-scenario: s${i + 1}\n`).join('\n')
    expect([...coveredScenarios(md)]).toEqual([['s1', 'B17.1'], ['s2', 'B17.2'], ['s3', 'B17.3']])
  })

  it('three scenarios failing with the same refusal from Lens are one item, carrying each; two are two items', () => {
    const refused = (scenarios: string[], detail: (user: number) => string): ReportedRun => ({
      ...run([]),
      outcomes: scenarios.map((scenario, user) => ({ scenario, title: scenario, user, workspace: `ws${user}`, status: 'FAIL', detail: detail(user), evidence: [] })),
    })
    const gate = (u: number) => `creating Payer ${u} was refused: LENS_PLAN_GATES: the free plan allows 3 agents — the team plan allows 25 agents.`
    const three = itemsFor(QUEUE, refused(['agent-limit', 'wallet-card', 'chat-paid-by'], gate), 'r.md')
    expect(new Set(three.filed.map((f) => f.id))).toEqual(new Set(['B17.10']))
    expect(three.append).toContain('3 scenarios refused by Lens with LENS_PLAN_GATES')
    expect(three.append).toContain('\ne2e-scenario: agent-limit\ne2e-scenario: wallet-card\ne2e-scenario: chat-paid-by\n')
    expect(three.append).toContain('- `chat-paid-by` (talyvor-suite): 1 of 1. User 2 (ws2): creating Payer 2 was refused: LENS_PLAN_GATES')
    // The same sentence with other numbers is the same refusal; the testers' own network dropping is none.
    const sentence = itemsFor(QUEUE, refused(['agent-limit', 'wallet-card', 'chat-paid-by'], (u) => `request ${u} was refused: 402 over ${u} µLXC`), 'r.md')
    expect(new Set(sentence.filed.map((f) => f.id)).size).toBe(1)
    const drops = itemsFor(QUEUE, refused(['agent-limit', 'wallet-card', 'chat-paid-by'], () => 'refused: Failed to fetch'), 'r.md')
    expect(new Set(drops.filed.map((f) => f.id)).size).toBe(3)
    const two = itemsFor(QUEUE, refused(['agent-limit', 'wallet-card'], gate), 'r.md')
    expect(two.filed).toEqual([
      { id: 'B17.10', scenario: 'agent-limit', repo: 'talyvor-lens' },
      { id: 'B17.11', scenario: 'wallet-card', repo: 'talyvor-lens' },
    ])
  })

  // The 6 Oct nightly, filed again: BUILD.md as it stood (test/fixtures/build-2026-10-06.md), and as the run found it — the
  // same, without the B35 items and the B17.46-B17.103 it filed.
  const fx = JSON.parse(readFileSync(new URL('fixtures/run-2026-10-06.json', import.meta.url), 'utf8')) as {
    started_at: string; titles: Record<string, string>; others: Record<string, Record<string, number>>; fails: [string, number, string][]
  }
  const night: ReportedRun = { ...run([]), started_at: fx.started_at, outcomes: [
    ...fx.fails.map(([scenario, user, detail]) => ({ scenario, title: fx.titles[scenario], user, workspace: '', status: 'FAIL' as const, detail, evidence: [] })),
    ...Object.entries(fx.others).flatMap(([scenario, counts]) => Object.entries(counts).flatMap(([status, n]) =>
      Array.from({ length: n }, () => ({ scenario, title: fx.titles[scenario], user: -1, workspace: '', status: status as 'PASS', detail: '', evidence: [] })))),
  ] }
  const today = readFileSync(new URL('fixtures/build-2026-10-06.md', import.meta.url), 'utf8')
  const asFound = today.split(/(?=^## )/m).filter((item) => {
    const m = /^## B(\d+)\.(\d+) —/.exec(item)
    return m === null || !(m[1] === '35' || (m[1] === '17' && Number(m[2]) >= 46))
  }).join('')
  const PLAN_LIMIT = ['agent-approval-push', 'agent-limit-boost', 'agent-payee-daily-cap', 'agent-payee-lists', 'agent-rule-simulator',
    'agent-rule-template', 'agent-rules-rollback', 'approvals-badge', 'chat-approval-face-id', 'chat-ask-above', 'chat-launch-agent',
    'chat-live-statement', 'chat-paid-by', 'chat-plain-rule', 'chat-wallet-alerts', 'chat-wallet-buttons', 'wallet-card',
    'wallet-card-purchase', 'wallet-cash-out', 'wallet-give-back', 'wallet-loan-repay', 'wallet-request', 'wallet-send-refund']

  it('the 6 Oct run, filed as it found BUILD.md: each scenario in its own repo, the plan-limit scenarios one item', () => {
    const f = itemsFor(asFound, night, 'r.md')
    const repo = Object.fromEntries(f.filed.map((x) => [x.scenario, x.repo]))
    for (const s of ['app-shell', 'wallet-brand', 'pricing-board', 'pricing-truth', 'honest-pages', 'marketing-board', 'brand-visual',
      'every-screen', 'wallet-currency', 'spend-platform-fee', 'console-screens-draw', 'sent-before-identity']) expect(repo[s], s).toBe('talyvor-suite')
    expect([repo['docs-ai'], repo['track-ai'], repo['ledger-matches-answers'], repo['market-payout-connect']])
      .toEqual(['talyvor-docs', 'talyvor-track', 'talyvor-lens', 'talyvor-lens'])
    const gate = f.filed.filter((x) => PLAN_LIMIT.includes(x.scenario))
    expect(gate.map((x) => x.scenario).sort()).toEqual(PLAN_LIMIT)
    expect(new Set(gate.map((x) => x.id)).size).toBe(1)
    expect(f.append).toContain(`${PLAN_LIMIT.length} scenarios refused by Lens with LENS_PLAN_GATES`)
    // 59 scenarios failed: 36 items for the rest, one for the plan limit — not the 58 the run filed.
    expect(new Set(f.filed.map((x) => x.id)).size).toBe(37)
  })

  it('the 6 Oct run, filed against BUILD.md today: nothing an open B35 item carries; again what only a SUPERSEDED item carried', () => {
    const f = itemsFor(today, night, 'r.md')
    const by = Object.fromEntries(f.covered.map((x) => [x.scenario, x.by]))
    for (const s of PLAN_LIMIT) expect(by[s], s).toBe('B35.7')
    expect([by['agent-request-rate'], by['market-payout-connect']]).toEqual(['B35.2', 'B35.4'])
    const filed = f.filed.map((x) => x.scenario)
    for (const s of PLAN_LIMIT) expect(filed).not.toContain(s)
    // Each carried only by a B17 item marked SUPERSEDED (B17.56, B17.72-B17.76), so each is filed anew.
    for (const s of ['brand-visual', 'app-shell', 'wallet-brand', 'honest-pages', 'pricing-truth', 'pricing-board']) expect(filed, s).toContain(s)
    expect(f.filed.find((x) => x.scenario === 'app-shell')?.repo).toBe('talyvor-suite')
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
