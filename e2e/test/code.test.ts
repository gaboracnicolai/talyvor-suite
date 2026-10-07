import { describe, expect, it } from 'vitest'
import { ASK_MARKER, type CodeReport, chargeOf, codeLine, readCodeCI, renderCode } from '../src/code.ts'
import type { Gh } from '../src/edge.ts'
import { codeItemsFor, coveredScenarios } from '../src/filing.ts'
import type { AgentLine } from '../src/lens.ts'

const REPO = 'gaboracnicolai/talyvor-code'
const line = (entry_id: string, kind: string, amount_ulxc: number, ref = ''): AgentLine =>
  ({ entry_id, kind, amount_ulxc, ref, counterparty: 'spend', balance_after_ulxc: 0, at: '2026-10-07T03:00:00Z' })

/** gh as GitHub answered for talyvor-code's CI run 37555036460 on main, with the plugin's job failed. */
const gh: Gh = async (args) => {
  const path = args.at(-1) ?? ''
  if (path === `repos/${REPO}/actions/workflows/ci.yaml/runs?branch=main&per_page=10`) {
    return JSON.stringify({ workflow_runs: [{ id: 37555036460, status: 'completed', conclusion: 'failure', head_sha: 'f633ba6a', updated_at: '2026-10-07T01:09:00Z',
      html_url: `https://github.com/${REPO}/actions/runs/37555036460` }] })
  }
  if (path === `repos/${REPO}/actions/runs/37555036460/jobs?per_page=100`) {
    return JSON.stringify({ jobs: [
      { name: 'agent', conclusion: 'success', html_url: 'https://github.com/x/job/1' },
      { name: 'extension', conclusion: 'success', html_url: 'https://github.com/x/job/2' },
      { name: 'jetbrains', conclusion: 'failure', html_url: 'https://github.com/x/job/3' },
    ] })
  }
  throw new Error(`unexpected gh ${args.join(' ')}`)
}

describe('B34.10 — Talyvor Code in the nightly', () => {
  it("judges a call on the agent's statement: a stream's hold and its settle are one charge; two charges for one call are not", () => {
    const before = [line('e0', 'fund', 2_000_000)]
    expect(chargeOf(before, [line('e3', 'platform_fee', -30, 'res-1'), line('e2', 'settle', 180_000, 'res-1'), line('e1', 'hold', -181_000, 'res-1'), ...before]))
      .toEqual({ charged: 1_000, fee: 30 })
    expect(chargeOf(before, [line('e1', 'spend', -900, 'req-1'), line('e2', 'platform_fee', -27, 'req-1'), ...before])).toEqual({ charged: 900, fee: 27 })
    expect(chargeOf(before, [line('e1', 'spend', -900, 'req-1'), line('e2', 'spend', -900, 'req-2'), ...before]))
      .toEqual({ why: "2 charges on the agent's statement for one call: spend -900; spend -900" })
    expect(chargeOf(before, before)).toEqual({ why: "no charge on the agent's statement" })
  })

  it("reports the CLI's verdicts and the extension's and the plugin's latest main CI", async () => {
    const code: CodeReport = { repo: REPO, read_at: '2026-10-07T03:40:00Z', commit: 'f633ba6', agent: 'agt_1', workspace: 'ws_1', ...(await readCodeCI(REPO, gh)),
      calls: [
        { command: 'ask', state: 'passed', said: '48213907', charged_ulxc: 1_000, fee_ulxc: 30, detail: 'one charge' },
        { command: 'review', state: 'passed', said: 'REQUEST CHANGES — 1 critical, 0 warning(s)', charged_ulxc: 4_000, fee_ulxc: 120, detail: 'one charge' },
      ] }
    const report = renderCode(code).join('\n')
    expect(report).toContain('### Talyvor Code')
    expect(report).toContain('| `talyvor-code ask` | passed | 48213907 | 1000 µLXC + 30 µLXC fee |')
    expect(report).toContain('| `talyvor-code review` | passed | REQUEST CHANGES — 1 critical, 0 warning(s) | 4000 µLXC + 120 µLXC fee |')
    expect(report).toContain('| VS Code extension | [extension](https://github.com/x/job/2) | green |')
    expect(report).toContain('| JetBrains plugin | [jetbrains](https://github.com/x/job/3) | **failure** |')
    expect(codeLine(code)).toEqual(["- **Talyvor Code**: ask passed, review passed (main at f633ba6); VS Code extension green, JetBrains plugin failure on main's latest CI."])
  })

  it('a broken ask files one build item for talyvor-code, and a second night files none', () => {
    const broken: CodeReport = { repo: REPO, read_at: '2026-10-07T03:40:00Z', commit: 'f633ba6', agent: 'agt_1', workspace: 'ws_1', ci: [],
      calls: [{ command: 'ask', state: 'failed', detail: 'it exited 1: lens: 401 Unauthorized' }, { command: 'review', state: 'passed', detail: 'one charge' }] }
    const queue = '# queue\n\n## B17.9 — an earlier item\nrepo: talyvor-suite · deps: none · status: DONE 04b46a2 — done\n'
    const first = codeItemsFor(queue, broken, 'docs/e2e/report-2026-10-07.md')
    expect(first.filed).toEqual([{ id: 'B17.10', scenario: ASK_MARKER }])
    expect(first.append).toContain("\n## B17.10 — the testers found it: Talyvor Code's `ask` is broken on main\nrepo: talyvor-code · deps: none · status: OPEN\n")
    expect(first.append).toContain('in workspace ws_1: it exited 1: lens: 401 Unauthorized.')
    expect(coveredScenarios(queue + first.append).get(ASK_MARKER)).toBe('B17.10')
    expect(codeItemsFor(queue + first.append, broken, 'docs/e2e/report-2026-10-08.md')).toEqual({ append: '', filed: [], covered: [{ scenario: ASK_MARKER, by: 'B17.10' }] })
    const skipped = { ...broken, calls: broken.calls.map((c) => ({ ...c, state: 'not run' as const })) }
    expect(codeItemsFor(queue, skipped, 'docs/e2e/report-2026-10-07.md').filed).toEqual([])
  })
})
