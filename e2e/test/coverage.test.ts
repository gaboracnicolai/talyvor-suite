import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type Inventory, Recorder, buildMap, inventory, leastCovered, lensRoutesFromGo, refreshLensCheckout } from '../src/coverage.ts'
import { type ReportedRun, renderRun, writeTesters } from '../src/report.ts'
import { customerReads } from '../src/tour.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('the inventory is read from the code', () => {
  it('lists every screen the web app mounts and every route the BFF registers', async () => {
    const inv = await inventory(REPO, 'none')
    const screens = inv.screens.map((s) => `${s.path} ${s.feature}`)
    // A console page, a page an area mounts under its splat, a public page, and one only an operator sees.
    expect(screens).toEqual(expect.arrayContaining(['/chat Chat', '/track/issues/:id Track', '/docs/spaces/:spaceId/pages/:pageId Docs',
      '/signin Sign In', '/operator Operator']))
    expect(new Set(inv.screens.map((s) => s.path)).size).toBe(inv.screens.length)
    expect(inv.bff.map((b) => b.path)).toEqual(expect.arrayContaining(['/auth/synthetic', '/api/agents/{id}/fund', '/api/lxc/balance']))
    expect(inv.bff.find((b) => b.path === '/api/lxc/balance')?.names).toEqual(['/lxc/balance'])
    expect(inv.lensMissing).toBe('no Lens checkout was given (--lens-src none)')
  })

  it('reads Lens routes from its Go source, its own registrars and loop-built paths included', () => {
    const src = `
      r.Get("/v1/workspaces/{wsID}/lxc/balance", h)
      r.Handle("/metrics", requireAdmin(m))
      r.Method("PATCH", "/v1/budgets/{id}", h)
      econ.post(authed, "/v1/admin/pool-royalty/adjudicate", h)
      q.Get("window")
      for _, mt := range []string{"eval_mints", "node_mints"} {
        econ.post(authed, "/v1/admin/held-mints/"+mt+"/adjudicate", h)
      }
      for _, dir := range []string{"in", "out"} {
        r.Post("/v1/pots/{potID}/"+dir, h)
      }`
    expect(lensRoutesFromGo(src).map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /v1/workspaces/{wsID}/lxc/balance', 'ANY /metrics', 'PATCH /v1/budgets/{id}', 'POST /v1/admin/pool-royalty/adjudicate',
      'POST /v1/admin/held-mints/eval_mints/adjudicate', 'POST /v1/admin/held-mints/node_mints/adjudicate',
      'POST /v1/pots/{potID}/in', 'POST /v1/pots/{potID}/out',
    ])
  })
})

describe('the run keeps its own checkout of Lens', () => {
  it('clones Lens\'s main the first time and brings it up to main on the next run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lens-src-'))
    const origin = join(root, 'lens')
    const git = (...a: string[]) => execFileSync('git', ['-C', origin, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a])
    execFileSync('git', ['init', '-q', '-b', 'main', origin])
    const commit = async (route: string) => {
      await writeFile(join(origin, 'main.go'), `r.Get("${route}", h)\n`)
      git('add', '.')
      git('commit', '-q', '-m', route)
    }
    await commit('/v1/one')
    const dir = join(root, 'lens-src')
    expect(await refreshLensCheckout(dir, `file://${origin}`)).toBeUndefined()
    expect(await readFile(join(dir, 'main.go'), 'utf8')).toContain('/v1/one')
    await commit('/v1/two')
    expect(await refreshLensCheckout(dir, `file://${origin}`)).toBeUndefined()
    expect(await readFile(join(dir, 'main.go'), 'utf8')).toContain('/v1/two')
    expect(await refreshLensCheckout(join(root, 'elsewhere'), `file://${root}/missing`)).toMatch(/^could not bring .* up to Lens's main/)
  })
})

const INV: Inventory = {
  screens: [
    { kind: 'screen', path: '/', method: 'GET', feature: 'Overview' },
    { kind: 'screen', path: '/agents', method: 'GET', feature: 'Agent Wallets' },
    { kind: 'screen', path: '/track/issues/:id', method: 'GET', feature: 'Track' },
    { kind: 'screen', path: '/operator', method: 'GET', feature: 'Operator' },
  ],
  bff: [
    { kind: 'bff', path: '/api/lxc/balance', method: 'ANY', feature: '', names: ['/lxc/balance'] },
    { kind: 'bff', path: '/api/agents/{id}/fund', method: 'ANY', feature: '', names: [] },
    { kind: 'bff', path: '/api/', method: 'ANY', feature: '', names: [] },
    { kind: 'bff', path: '/api/admin/workspaces', method: 'ANY', feature: '', names: [] },
  ],
  lens: [
    { kind: 'lens', path: '/v1/workspaces/{wsID}/lxc/balance', method: 'GET', feature: '' },
    { kind: 'lens', path: '/v1/workspaces/{wsID}/agents/{agentID}/fund', method: 'POST', feature: '' },
    { kind: 'lens', path: '/v1/admin/workspaces', method: 'ANY', feature: '' },
    { kind: 'lens', path: '/v1/proxy/anthropic/*', method: 'POST', feature: '' },
    { kind: 'lens', path: '/v1/workspaces/{wsID}/earnings', method: 'GET', feature: '' },
    { kind: 'lens', path: '/v1/workspaces/{wsID}/budgets/{id}', method: 'GET', feature: '' },
  ],
}

function recorded(): Recorder {
  const rec = new Recorder()
  for (const user of [1, 2]) {
    const t = { scenario: 'every-screen', user }
    rec.hit(t, { kind: 'screen', method: 'GET', path: '/', status: 200, ms: 800 })
    rec.hit(t, { kind: 'bff', method: 'GET', path: '/api/lxc/balance', status: 200, ms: 120, from: '/' })
  }
  rec.hit({ scenario: 'agent-open-fund', user: 3 }, { kind: 'bff', method: 'POST', path: '/api/agents/a1/fund', status: 502, ms: 4000, from: '/agents' })
  rec.hit({ scenario: 'explorer', user: 0 }, { kind: 'screen', method: 'GET', path: '/track/issues/abc', status: 200 })
  rec.hit({ scenario: 'known-answer', user: 1 }, { kind: 'lens', method: 'POST', path: '/v1/proxy/anthropic/v1/messages', status: 200, ms: 900 })
  rec.pageError({ scenario: 'every-screen', user: 1 }, '/agents', 'TypeError: x is undefined')
  return rec
}

describe('the coverage map', () => {
  it('gives every entry its state: covered (by users), explorers only, cannot be tested yet (why), not covered', () => {
    const map = buildMap(INV, recorded())
    const state = (rows: typeof map.screens) => Object.fromEntries(rows.map((r) => [`${r.method} ${r.path}`, r.state]))
    expect(state(map.screens)).toEqual({ 'GET /': 'covered', 'GET /agents': 'not covered', 'GET /track/issues/:id': 'explorers only',
      'GET /operator': 'cannot be tested yet' })
    expect(map.screens[0].by).toEqual({ 'every-screen': 2 })
    expect(map.screens[3].why).toMatch(/operator only/)
    expect(map.bff[0]).toMatchObject({ state: 'covered', from: ['Overview'], answers: { 200: 2 } })
    // Through the BFF, with the method it was called with; the Lens proxy by the harness's own call.
    expect(state(map.lens)).toEqual({
      'GET /v1/workspaces/{wsID}/lxc/balance': 'covered', 'POST /v1/workspaces/{wsID}/agents/{agentID}/fund': 'covered',
      'ANY /v1/admin/workspaces': 'cannot be tested yet', 'POST /v1/proxy/anthropic/*': 'covered',
      'GET /v1/workspaces/{wsID}/earnings': 'not covered', 'GET /v1/workspaces/{wsID}/budgets/{id}': 'not covered',
    })
    expect(map.lens[1].through).toEqual(['POST /api/agents/{id}/fund'])
    expect(map.errors).toEqual([{ feature: 'Agent Wallets', where: '/agents', message: 'TypeError: x is undefined', count: 1, scenarios: ['every-screen'] }])
  })

  it('sends the explorers to the least covered feature first, never to one that cannot be tested', () => {
    const map = buildMap(INV, recorded())
    expect(leastCovered(map, new Map([['Overview', 5], ['Agent Wallets', 1]]))).toEqual([
      { feature: 'Agent Wallets', path: '/agents' }, { feature: 'Overview', path: '/' },
    ])
  })

  it('reads only what a customer key can: GET, with no parameter but the workspace', () => {
    expect(customerReads(INV.lens).map((e) => e.path)).toEqual(['/v1/workspaces/{wsID}/lxc/balance', '/v1/workspaces/{wsID}/earnings'])
  })
})

function run(): ReportedRun {
  const o = (scenario: string, user: number, status: 'PASS' | 'FAIL' | 'ERROR', features: string[], detail: string) =>
    ({ scenario, title: `the ${scenario} check`, user, workspace: `ws${user}`, status, detail, evidence: [{ note: `note ${user}` }], seconds: 3, features })
  return {
    started_at: '2026-09-30T02:00:00.000Z', finished_at: '2026-09-30T02:40:00.000Z', app: 'https://app', lens: 'https://lens',
    users: 500, model: 'Claude Haiku 4.5', cap_usd: 30, spent_usd: 11.5, stopped_at_cap: false,
    counts: { PASS: 2, FAIL: 1, SKIP: 0, ERROR: 1 },
    outcomes: [o('every-screen', 1, 'PASS', ['Overview', 'Agent Wallets'], 'all named'), o('every-screen', 2, 'PASS', ['Overview'], 'all named'),
      o('agent-open-fund', 3, 'FAIL', ['Agent Wallets'], 'the balance did not move'), o('agent-limit', 4, 'ERROR', ['Agent Wallets'], 'timed out')],
    explorers: [{ explorer: 0, steps: 12, stopped: 'time', detail: '10 minutes up', start: 'Agent Wallets' }],
    findings: [{ explorer: 0, source: 'explorer', severity: 'low', where: '/agents', note: 'the forecast says NaN', trail: [], at: '', feature: 'Agent Wallets' }],
    coverage: buildMap(INV, recorded()),
    filed: { 'agent-open-fund': 'B17.30' },
  }
}

describe('the report, per feature, ending with the map', () => {
  it('says per feature what works, what is broken (with its item), errors, what is slow and what the explorers noted', () => {
    const md = renderRun(run())
    const wallets = md.slice(md.indexOf('#### Agent Wallets'), md.indexOf('#### Track'))
    expect(wallets).toContain('- `every-screen` passed for 1 of 1 user(s), median 3.0 s — e.g. user 1: all named')
    expect(wallets).toContain('`agent-open-fund` failed for 1 of 1 user(s) — build item B17.30:')
    expect(wallets).toContain('**FAIL `agent-open-fund`** — user 3 (ws3): the balance did not move')
    expect(wallets).toContain('- **ERROR `agent-limit`** — user 4 (ws4): timed out')
    expect(wallets).toContain('- page error on `/agents` (1 time(s), during every-screen): TypeError: x is undefined')
    expect(wallets).toContain('- `ANY /api/agents/{id}/fund` answered 502 ×1')
    expect(wallets).toContain('- `ANY /api/agents/{id}/fund`: p50 4.0 s · p95 4.0 s · max 4.0 s (n=1)')
    expect(wallets).toContain('- **low** 1 explorer (0) on `/agents`: the forecast says NaN')
    expect(md).toContain('#### Operator\n\nNot tested: operator only')
    expect(md.indexOf('### Coverage map')).toBeGreaterThan(md.indexOf('### Every verdict'))
    expect(md).toContain('#### Screens — 1 of 4 covered, 1 explorers only, 1 cannot be tested yet, 1 not covered')
    expect(md).toContain('| `GET /v1/workspaces/{wsID}/lxc/balance` | covered | every-screen ×2 | GET /api/lxc/balance |')
  })
})

describe('TESTERS.md', () => {
  it('puts each run\'s summary on top — coverage, works, broken, new findings, cost — and keeps the earlier runs', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'testers-')), 'TESTERS.md')
    const first = run()
    await writeTesters(file, { ...first, started_at: '2026-09-29T02:00:00.000Z' }, 'docs/e2e/report-2026-09-29.md', [])
    await writeTesters(file, first, 'docs/e2e/report-2026-09-30.md', ['B17.30'])
    const md = await readFile(file, 'utf8')
    expect(md.match(/^# Testers/gm)).toHaveLength(1)
    expect(md.indexOf('## 2026-09-30T02:00:00.000Z')).toBeLessThan(md.indexOf('## 2026-09-29T02:00:00.000Z'))
    expect(md).toContain('- **Coverage**: screens 1 of 4 covered, 1 explorers only, 1 cannot be tested yet, 1 not covered; BFF routes')
    expect(md).toContain('- **Works**: 2 checks passed across 1 scenario(s).')
    expect(md).toContain('- **Broken**: `agent-open-fund` (1 of 1, B17.30); 1 errored.')
    expect(md).toContain('- **New findings**: build items B17.30; 1 explorer lead(s) on Agent Wallets.')
    expect(md).toContain('- **Cost**: $11.50 of the $30.00 cap.')
  })
})
