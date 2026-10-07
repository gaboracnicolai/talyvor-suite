import { describe, expect, it } from 'vitest'
import { b28Line, b28Report, renderB28 } from '../src/b28.ts'
import { b28ItemsFor } from '../src/filing.ts'
import { scenarioItems } from '../src/scenarios.ts'

const QUEUE = `# queue

## B28.24 — hourly and weekly spend caps
repo: talyvor-suite · deps: B28.300 · status: DONE 4c90df4 — caps on the screen

## B28.300 — talyvor-lens side of B28.24: hourly and weekly spend caps
repo: talyvor-lens · deps: none · status: DONE 1a2b3c4

## B28.19 — the statement names every kind of line correctly
repo: talyvor-suite · deps: none · status: DONE 04c27d0

## B28.446 — Docs team grants take effect
repo: talyvor-docs · deps: none · status: DONE 822091c

## B28.450 — e2e: a Docs team grant follows who is on the team
repo: talyvor-suite · deps: B28.446 · status: OPEN

## B28.11 — Lens README and docs lead with wallets
repo: talyvor-lens · deps: none · status: DONE f4f76af

## B28.200 — Kind cluster backups
repo: edge-infra · deps: none · status: DONE 9e9e9e9

## B28.292 — a weekly deep red-team pass
repo: talyvor-e2e · deps: none · status: DONE 549c490

## B28.120 — not built yet
repo: talyvor-suite · deps: none · status: OPEN
`

const NAMED = new Map([['agent-hourly-limit', ['B28.24', 'B28.300']]])
const ran = (status: 'PASS' | 'FAIL') => [{ scenario: 'agent-hourly-limit', status }, { scenario: 'known-answer', status: 'PASS' as const }]

describe('B28.293 — every DONE B28 feature, with the scenarios that test it', () => {
  it("lists each DONE feature with its scenarios' verdicts; tests, edge-infra and words no request reaches are not features to test", () => {
    const r = b28Report(QUEUE, NAMED, ran('PASS'), '2026-10-08T03:00:00Z')
    expect(r.features.map((f) => [f.id, f.state, f.item ?? f.why?.slice(0, 20) ?? ''])).toEqual([
      ['B28.11', 'cannot', "words in Lens's READ"],
      ['B28.19', 'no scenario', ''],
      ['B28.24', 'tested', ''],
      ['B28.200', 'cannot', 'edge-infra is never '],
      ['B28.300', 'tested', ''],
      ['B28.446', 'waiting', 'B28.450'],
    ])
    expect(renderB28(r).join('\n')).toContain('| B28.24 hourly and weekly spend caps | talyvor-suite | `agent-hourly-limit` | PASS 1 |')
    expect(b28Line(r)).toEqual(['- **B28 features**: 2 of 6 DONE tested this run by 1 scenario; no scenario: B28.19.'])
  })

  it('a feature that breaks or goes away FAILs by name, with the build item its scenario filed', () => {
    const r = b28Report(QUEUE, NAMED, ran('FAIL'))
    const shown = renderB28(r, { 'agent-hourly-limit': 'B17.120' }).join('\n')
    expect(shown).toContain('| B28.24 hourly and weekly spend caps | talyvor-suite | `agent-hourly-limit` | **FAIL** 1 — build item B17.120 |')
    expect(b28Line(r)[0]).toContain('FAIL: B28.24 (agent-hourly-limit), B28.300 (agent-hourly-limit)')
  })

  it('a feature whose scenario is taken out reads NO SCENARIO and files one item for the testers, once', () => {
    const r = b28Report(QUEUE, new Map(), [])
    expect(r.features.find((f) => f.id === 'B28.24')?.state).toBe('no scenario')
    const first = b28ItemsFor(QUEUE, r, 'docs/e2e/report.md')
    expect(first.filed).toEqual([
      { id: 'B17.1', scenario: 'b28-untested-B28.19' },
      { id: 'B17.2', scenario: 'b28-untested-B28.24' },
      { id: 'B17.3', scenario: 'b28-untested-B28.300' },
    ])
    expect(first.append).toContain('\n## B17.2 — the testers have no scenario for B28.24 — hourly and weekly spend caps\nrepo: talyvor-e2e · deps: B28.24 · status: OPEN\n')
    const after = QUEUE + first.append
    expect(b28ItemsFor(after, r, 'docs/e2e/report.md')).toMatchObject({ filed: [], covered: [{ scenario: 'b28-untested-B28.19', by: 'B17.1' }, {}, {}] })
    // The next night the open item holds the feature, so it reads as waiting on it.
    expect(b28Report(after, new Map(), []).features.find((f) => f.id === 'B28.24')).toMatchObject({ state: 'waiting', item: 'B17.2' })
  })

  it("every item a scenario in the catalog names is a build item's id", () => {
    const named = [...scenarioItems().values()].flat()
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((id) => !/^B\d+\.\d+$/.test(id))).toEqual([])
  })
})
