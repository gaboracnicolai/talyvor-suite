import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config.ts'
import { itemsFor } from '../src/filing.ts'
import { dayBudget, dayStart, leftOf } from '../src/day.ts'
import { lightJourneys } from '../src/light.ts'
import { cast } from '../src/plans.ts'
import { type ReportedRun, renderRun, renderSummary } from '../src/report.ts'
import { journeyFor } from '../src/scenarios.ts'

// B28.294 — the light pass between the nightly runs: the core money and auth paths for a few users, in a few minutes,
// under what is left of the day's one cap, its FAILs filed as the nightly's are.

const env = { LENS_SYNTHETIC_KEY: 'k', E2E_APP_URL: 'http://app', E2E_LENS_URL: 'http://lens' }

const CORE = ['known-answer', 'capital', 'spending-limit', 'agent-limit', 'wallet-send-refund', 'cross-company-test-money',
  'api-key-revoke', 'session-sign-out', 'csrf-refused', 'script-inert', 'keys-unlisted', 'webhook-unsigned',
  'ledger-moves-at-once', 'ledger-call-once', 'agent-rules-unbypassable']

describe('the light pass (B28.294)', () => {
  it('is its own six users and nothing slow: no explorers, deep pass, hostile pull requests, Talyvor Code or Edge', () => {
    const c = parseConfig(['--light'], { ...env, E2E_USERS: '500', E2E_EXPLORERS: '10', E2E_DEEP_ROUNDS: '3', E2E_DAY_CAP_USD: '30' })
    expect([c.light, c.users, c.explorers, c.deepRounds, c.hostilePRs, c.codeRepo, c.edgeRepo, c.dayCapUSD])
      .toEqual([true, 6, 0, 0, false, 'none', 'none', 30])
    expect(parseConfig([], { ...env, E2E_LIGHT: '1' }).light).toBe(true)
    expect(parseConfig([], env).dayCapUSD).toBeUndefined()
    expect(() => parseConfig([], { ...env, E2E_NIGHTLY_AT: '3am' })).toThrow('E2E_NIGHTLY_AT must be HH:MM')
  })

  it('plays the core money and auth paths, each a scenario the nightly plays, against another company of its own', () => {
    const light = lightJourneys()
    expect(light.flat().map((s) => s.id)).toEqual(CORE)
    // The same ids as the night's, so a FAIL is filed under the marker the nightly's would be.
    const night = new Set(Array.from({ length: 100 }, (_, i) => journeyFor(i, 100, [])).flat().map((s) => s.id))
    expect(CORE.filter((id) => !night.has(id))).toEqual([])
    expect(light.length).toBe(parseConfig(['--light'], env).users)
    expect(light[5]).toEqual([])
    expect(light.flat().filter((s) => s.partners !== undefined).map((s) => [s.id, s.partners])).toEqual([['wallet-send-refund', [5]], ['cross-company-test-money', [5]]])
    expect(cast(light).plans[5]).toBe('business')
  })

  it('has what the day\'s earlier runs left of its cap, the day starting at the nightly\'s hour', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-light-'))
    try {
      const now = new Date(2026, 9, 8, 14, 30)
      expect(dayStart(now, '03:00')).toEqual(new Date(2026, 9, 8, 3, 0))
      expect(dayStart(new Date(2026, 9, 8, 1, 0), '03:00')).toEqual(new Date(2026, 9, 7, 3, 0))
      const write = (name: string, started: Date, spent: number) =>
        writeFileSync(join(dir, `run-${name}.json`), JSON.stringify({ started_at: started.toISOString(), spent_usd: spent }))
      write('yesterday', new Date(2026, 9, 7, 3, 0), 14) // the day before: not this day's
      write('nightly', new Date(2026, 9, 8, 3, 0), 15.05)
      write('light', new Date(2026, 9, 8, 9, 0), 0.4)
      writeFileSync(join(dir, 'nightly.log'), 'not a run\n')
      const d = await dayBudget(30, dir, '03:00', now)
      expect(d).toEqual({ cap_usd: 30, since: new Date(2026, 9, 8, 3, 0).toISOString(), spent_before_usd: 15.45, runs_before: 2 })
      expect(leftOf(d)).toBeCloseTo(14.55, 6)
      expect(leftOf(await dayBudget(15, dir, '03:00', now))).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  const run: ReportedRun = {
    started_at: '2026-10-08T12:30:00.000Z', finished_at: '2026-10-08T12:34:00.000Z', app: 'https://app', lens: 'https://lens',
    users: 6, model: 'Claude Haiku 4.5', cap_usd: 14.55, spent_usd: 0.21, stopped_at_cap: false, light: true,
    day: { cap_usd: 30, since: '2026-10-08T01:00:00.000Z', spent_before_usd: 15.45, runs_before: 2 },
    counts: { PASS: 0, FAIL: 1, SKIP: 0, ERROR: 0 },
    outcomes: [{ scenario: 'csrf-refused', title: 'a write from another site is refused', user: 3, workspace: 'ws3', status: 'FAIL',
      detail: 'a POST with Origin https://evil.example was answered 200', evidence: [] }],
  }

  it('files a FAIL as the nightly does, saying the light pass caught it', () => {
    const f = itemsFor('# queue\n', run, 'docs/e2e/report-2026-10-08.md')
    expect(f.filed).toEqual([{ id: 'B17.1', scenario: 'csrf-refused', repo: 'talyvor-suite' }])
    expect(f.append).toContain('The light pass of 2026-10-08T12:30:00.000Z (B28.294), between the nightly runs, caught it.')
    expect(f.append).toContain('\ne2e-scenario: csrf-refused\n')
  })

  it('is named in the report and TESTERS.md, with the day\'s cap it ran under', () => {
    expect(renderRun(run)).toContain('## Light pass started 2026-10-08T12:30:00.000Z')
    const s = renderSummary(run, 'report.md', ['B17.1'])
    expect(s).toContain('## 2026-10-08T12:30:00.000Z — light pass, 6 users on https://app')
    expect(s).toContain("- **Cost**: $0.21 of the $14.55 cap, what was left of the day's $30.00 cap after $15.45 spent by 2 earlier run(s) since 2026-10-08T01:00:00.000Z.")
  })
})
