import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type Gh, logText, readEdge, renderEdge, resultOf } from '../src/edge.ts'
import { coveredScenarios, edgeItemsFor } from '../src/filing.ts'

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')
// A real Kind E2E log (edge-infra run 37407614407, `gh run view --log`): it stopped in PHASE 32 on an X line.
const FAILED_LOG = fixture('edge-kind-e2e-failed.log')
const UP_SH = fixture('edge-up-phases.sh')
const CLAIMS = fixture('edge-self-host-claims.md')
const REPO = 'gaboracnicolai/edge-infra'
const NOW = new Date('2026-10-07T01:00:00Z')

/** gh as GitHub answers it for a night whose Kind E2E failed and whose Test passed `startedAt`. */
function gh(startedAt = '2026-10-06T03:09:04Z'): Gh {
  const run = (id: number, conclusion: string) => JSON.stringify({ workflow_runs: [{ id, status: 'completed', conclusion, created_at: startedAt, run_started_at: startedAt,
    html_url: `https://github.com/${REPO}/actions/runs/${id}`, head_sha: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed' }] })
  return async (args) => {
    const path = args.at(-1) ?? ''
    if (path === `repos/${REPO}/actions/workflows?per_page=100`) {
      return JSON.stringify({ workflows: [{ id: 1, name: 'Kind E2E', path: '.github/workflows/kind-e2e.yaml' },
        { id: 2, name: 'Test', path: '.github/workflows/test.yaml' }, { id: 3, name: 'Kind Backup', path: '.github/workflows/kind-backup.yaml' }] })
    }
    if (path.startsWith(`repos/${REPO}/actions/workflows/1/runs?`)) return run(37407614407, 'failure')
    if (path.startsWith(`repos/${REPO}/actions/workflows/2/runs?`)) return run(37409729500, 'success')
    if (path.startsWith(`repos/${REPO}/actions/workflows/3/runs?`)) return JSON.stringify({ workflow_runs: [] })
    if (path === `repos/${REPO}/actions/runs/37407614407/jobs?per_page=100`) {
      return JSON.stringify({ jobs: [{ name: 'kind-e2e', conclusion: 'failure', steps: [{ name: 'make kind-e2e', conclusion: 'failure' }] }] })
    }
    if (args[0] === 'run' && args[2] === '37407614407') return FAILED_LOG
    if (path === `repos/${REPO}/contents/deploy/local/up.sh?ref=main`) return UP_SH
    if (path === `repos/${REPO}/contents/docs/self-host-claims.md?ref=main`) return CLAIMS
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }
}

describe('B34.3 — Talyvor Edge in the nightly report', () => {
  it('reads a saved failed Kind E2E log: every phase on main, passed up to the X line, failed there, not reached after', async () => {
    const edge = await readEdge(REPO, NOW, gh())
    expect(edge.phases.map((p) => p.n)).toEqual(Array.from({ length: 34 }, (_, i) => i + 1))
    expect(edge.phases.filter((p) => p.state === 'passed').map((p) => p.n)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1))
    expect(edge.phases.find((p) => p.n === 32)).toMatchObject({ state: 'failed', why: 'PHASE32 FAIL: no token got 000, want 401 (the route is not published, or not gated)' })
    expect(edge.phases.filter((p) => p.state === 'not reached').map((p) => p.n)).toEqual([33, 34])
    expect(edge.claims).toHaveLength(15)
    expect(edge.claims.find((c) => c.row === 4)).toMatchObject({ phases: [25, 12, 23], state: 'proven' })
    expect(edge.claims.find((c) => c.row === 9)?.state).toBe('not run: Provider keys are held by Lens. No chart here installs Lens.')
    expect(edge.claims.find((c) => c.row === 15)?.state).toBe('partly: rows 2–3 proven')

    const report = renderEdge(edge).join('\n')
    expect(report).toContain('| Kind E2E | **failure** in PHASE 32 | [37407614407](https://github.com/gaboracnicolai/edge-infra/actions/runs/37407614407) |')
    expect(report).toContain('| Test | green |')
    expect(report).toContain('| Kind Backup | **no nightly run on main** |')
    expect(report).toContain('| 32 | no internet at run time: every node cut off, the stack restarted cold, and not one DNS query for a name outside the cluster | **failed**: X PHASE32 FAIL')
  })

  it('files one build item for edge-infra for the failed phase, and a second run files none', async () => {
    const edge = await readEdge(REPO, NOW, gh())
    const queue = '# queue\n\n## B17.9 — an earlier item\nrepo: talyvor-suite · deps: none · status: DONE 04b46a2 — done\n'
    const first = edgeItemsFor(queue, edge, 'docs/e2e/report-2026-10-07.md')
    expect(first.filed).toEqual([{ id: 'B17.10', scenario: 'edge-kind-e2e-phase-32' }])
    expect(first.append).toContain("\n## B17.10 — the testers found it: Talyvor Edge's nightly Kind E2E stops in PHASE 32 — no internet at run time")
    expect(first.append).toContain('\nrepo: edge-infra · deps: none · status: OPEN\n')
    expect(first.append).toContain('\ne2e-scenario: edge-kind-e2e-phase-32\n')
    expect(coveredScenarios(queue + first.append).get('edge-kind-e2e-phase-32')).toBe('B17.10')

    const second = edgeItemsFor(queue + first.append, await readEdge(REPO, NOW, gh()), 'docs/e2e/report-2026-10-08.md')
    expect(second.append).toBe('')
    expect(second.covered).toEqual([{ scenario: 'edge-kind-e2e-phase-32', by: 'B17.10' }])
  })

  it('a run older than 36 hours is stale, never green', async () => {
    const edge = await readEdge(REPO, NOW, gh('2026-10-05T12:59:00Z'))
    expect(resultOf(edge.workflows.find((w) => w.name === 'Test') as never)).toBe('**STALE** — last green')
  })

  it('reads a line with its colour codes stripped', () => {
    expect(logText('kind-e2e\tmake kind-e2e\t2026-10-06T03:32:09.7704402Z \u001b[1;31m  X PHASE32 FAIL: no token\u001b[0m')).toBe('  X PHASE32 FAIL: no token')
  })
})
