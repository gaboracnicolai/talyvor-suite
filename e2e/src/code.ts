// B34.10 — TALYVOR CODE IN THE NIGHTLY. Talyvor Code ships a CLI agent (agent/, in Go), a VS Code extension and a
// JetBrains plugin. Each night the run builds the CLI from talyvor-code's main and runs `ask` and `review` on a small
// fixture repository, on the own key of a synthetic agent it makes and funds in Agent Wallets. Each call must be one
// charge on that agent's statement — a spend line, or a stream's hold and the settle that closes it — and none on the
// workspace: the workspace's unallocated balance does not move. `ask` must answer from the fixture's file, with a number
// only that file holds and that is new each night, so no stored answer can stand in for it. The report also shows the
// extension's and the plugin's jobs in the latest CI run on main, read with gh. A broken `ask` files one build item for
// talyvor-code, once (filing.ts's rule).

import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Hold, SpendCap } from './budget.ts'
import { refreshLensCheckout } from './coverage.ts'
import { type Gh, ghCLI } from './edge.ts'
import { type AgentLine, type LensClient, type SyntheticUser, describe } from './lens.ts'

export const CODE_REPO = 'gaboracnicolai/talyvor-code'
/** The CLI's cheapest model, by the id its own catalogue validates; `ask` uses it by default. */
export const CODE_MODEL = 'claude-haiku-4-5'
/** What the agent is funded with: the most its two calls can cost, since Lens refuses it more. */
export const FUND_ULXC = 2_000_000
const CI_WORKFLOW = 'ci.yaml'
/** The jobs of talyvor-code's CI that build and test the extension and the plugin. */
export const CI_PARTS = [{ part: 'VS Code extension', job: 'extension' }, { part: 'JetBrains plugin', job: 'jetbrains' }] as const
/** How long a call's lines may take to reach the agent's statement once the CLI has exited. */
const CHARGE_WAIT_MS = 15_000
const CALL_MS = 180_000
const BUILD_MS = 10 * 60_000
export const ASK_MARKER = 'talyvor-code-ask'

export type Command = 'ask' | 'review'

export interface CodeCall {
  command: Command
  state: 'passed' | 'failed' | 'not run'
  /** What the CLI answered: ask's first line, or review's verdict and its counts. */
  said?: string
  /** What the call cost the agent, and its platform fee, in µLXC. */
  charged_ulxc?: number
  fee_ulxc?: number
  detail: string
}

export interface CodeCI {
  part: string
  job: string
  /** success, failure, … as GitHub concludes the job; 'not in the run' when the run has no such job. */
  conclusion?: string
  url?: string
}

export interface CodeReport {
  repo: string
  read_at: string
  /** talyvor-code's main, as the CLI was built from it. */
  commit?: string
  workspace?: string
  agent?: string
  calls: CodeCall[]
  /** The latest completed CI run on main. */
  ci_run?: { url: string; sha: string; finished: string }
  ci: CodeCI[]
  ci_error?: string
  /** The build item that holds a broken `ask`, filed this night or already open. */
  item?: string
}

interface Run { id: number; status: string; conclusion: string | null; html_url: string; head_sha: string; updated_at: string }

const firstLine = (e: unknown): string => {
  const err = e as { stderr?: string; message?: string }
  return ((err.stderr ?? '').trim() || (err.message ?? String(e))).split('\n')[0]
}

/** The extension's and the plugin's jobs in the latest completed CI run on talyvor-code's main. */
export async function readCodeCI(repo: string, gh: Gh): Promise<Pick<CodeReport, 'ci' | 'ci_run' | 'ci_error'>> {
  const api = async <T>(path: string): Promise<T> => JSON.parse(await gh(['api', path])) as T
  try {
    const runs = (await api<{ workflow_runs: Run[] }>(`repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?branch=main&per_page=10`)).workflow_runs
    const r = runs.find((x) => x.status === 'completed')
    if (r === undefined) return { ci: CI_PARTS.map((p) => ({ ...p })), ci_error: `${repo} has no completed CI run on main` }
    const jobs = (await api<{ jobs: { name: string; conclusion: string | null; html_url: string }[] }>(`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`)).jobs
    return {
      ci_run: { url: r.html_url, sha: r.head_sha.slice(0, 7), finished: r.updated_at },
      ci: CI_PARTS.map((p) => {
        const j = jobs.find((x) => x.name === p.job)
        return j === undefined ? { ...p, conclusion: 'not in the run' } : { ...p, conclusion: j.conclusion ?? 'unknown', url: j.html_url }
      }),
    }
  } catch (e) {
    return { ci: CI_PARTS.map((p) => ({ ...p })), ci_error: `gh could not read ${repo}'s CI on main: ${firstLine(e)}` }
  }
}

/**
 * What one call left on the agent's statement, from the lines before it and after it: exactly one charge — a spend
 * line, or a hold and the settle that closes it — and its platform fee. Anything else is said.
 */
export function chargeOf(before: AgentLine[], after: AgentLine[]): { charged: number; fee: number } | { why: string } {
  const seen = new Set(before.map((l) => l.entry_id))
  const fresh = after.filter((l) => !seen.has(l.entry_id))
  const text = (ls: AgentLine[]) => ls.map((l) => `${l.kind} ${l.amount_ulxc}`).join('; ')
  const holds = [...new Set(fresh.filter((l) => l.kind === 'hold').map((l) => l.ref ?? ''))]
  const spends = fresh.filter((l) => l.kind === 'spend')
  if (spends.length + holds.length === 0) return { why: `no charge on the agent's statement${fresh.length > 0 ? `, only ${text(fresh)}` : ''}` }
  if (spends.length + holds.length > 1) return { why: `${spends.length + holds.length} charges on the agent's statement for one call: ${text(fresh)}` }
  const other = fresh.filter((l) => !['spend', 'hold', 'settle', 'release', 'platform_fee'].includes(l.kind))
  if (other.length > 0) return { why: `beside its charge the agent's statement gained ${text(other)}` }
  if (holds.length === 1 && !fresh.some((l) => (l.kind === 'settle' || l.kind === 'release') && (l.ref ?? '') === holds[0])) {
    return { why: `the call's hold was never settled: ${text(fresh)}` }
  }
  const fee = -fresh.filter((l) => l.kind === 'platform_fee').reduce((s, l) => s + l.amount_ulxc, 0)
  const charged = -fresh.filter((l) => l.kind !== 'platform_fee').reduce((s, l) => s + l.amount_ulxc, 0)
  if (charged <= 0) return { why: `the call charged the agent ${charged} µLXC: ${text(fresh)}` }
  return { charged, fee }
}

/** A charge is complete once its spend is there, or its hold has been settled or released. */
export const complete = (before: AgentLine[], after: AgentLine[]): boolean => {
  const seen = new Set(before.map((l) => l.entry_id))
  const fresh = after.filter((l) => !seen.has(l.entry_id))
  return fresh.some((l) => l.kind === 'spend') || (fresh.some((l) => l.kind === 'hold') && fresh.some((l) => l.kind === 'settle' || l.kind === 'release'))
}

/** The fixture repository: one Go file whose Magic() returns `nonce`, and a Divide with no check for zero to review. */
export function fixtureSource(nonce: number): string {
  return [
    'package calc',
    '',
    '// Magic returns the number the testers ask for.',
    `func Magic() int { return ${nonce} }`,
    '',
    '// Divide divides a by b.',
    'func Divide(a, b int) int { return a / b }',
    '',
  ].join('\n')
}

export interface CodeDeps {
  /** Lens, for the synthetic workspace, its agent, its key and its statement. */
  lens: LensClient
  cap: SpendCap
  usdPerLXC: number
  outDir: string
  /** The checkout of talyvor-code the CLI is built from. */
  src: string
  /** Where src is cloned from and kept up to main; undefined leaves src as it is. */
  cloneURL: string | undefined
  repo: string
  /** Why the CLI is not run tonight (the run stopped first); the CI is still read. */
  skip?: string
  gh?: Gh
  now?: Date
}

const notRun = (why: string): CodeCall[] => (['ask', 'review'] as const).map((command) => ({ command, state: 'not run', detail: why }))

/** The section of a night whose CLI is not run (`why`): the CI alone. */
export async function codeSkipped(repo: string, why: string, gh: Gh = ghCLI, now: Date = new Date()): Promise<CodeReport> {
  return { repo, read_at: now.toISOString(), calls: notRun(why), ...(await readCodeCI(repo, gh)) }
}

/** The night's Talyvor Code section: the CLI from main, run on an agent's key and judged on its statement, and the CI. Never throws. */
export async function runCode(d: CodeDeps): Promise<CodeReport> {
  if (d.skip !== undefined) return codeSkipped(d.repo, d.skip, d.gh, d.now)
  const out: CodeReport = { repo: d.repo, read_at: (d.now ?? new Date()).toISOString(), calls: [], ...(await readCodeCI(d.repo, d.gh ?? ghCLI)) }
  const run = (file: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number }) =>
    promisify(execFile)(file, args, { ...opts, maxBuffer: 16 * 1024 * 1024 })

  // The CLI, from main. A checkout that cannot be brought up to main is never built: it would test old code.
  if (d.cloneURL !== undefined) {
    const behind = await refreshLensCheckout(d.src, d.cloneURL, 'Talyvor Code')
    if (behind !== undefined) {
      out.calls = notRun(behind)
      return out
    }
  }
  const bin = resolve(d.outDir, 'talyvor-code')
  try {
    out.commit = (await run('git', ['-C', d.src, 'rev-parse', '--short', 'HEAD'], { timeout: 30_000 })).stdout.trim()
    await run('go', ['build', '-o', bin, './cmd/agent'], { cwd: join(d.src, 'agent'), timeout: BUILD_MS })
  } catch (e) {
    const err = e as { code?: string; stderr?: string }
    out.calls = err.code === 'ENOENT' ? notRun(`no ${out.commit === undefined ? 'git' : 'Go toolchain'} on this machine's PATH`)
      : (['ask', 'review'] as const).map((command) => ({ command, state: 'failed', detail: `main at ${out.commit ?? '?'} does not build: ${(err.stderr ?? '').trim().split('\n').slice(0, 3).join(' / ') || firstLine(e)}` }))
    return out
  }

  // The fixture repository, new each night.
  const nonce = 10_000_000 + Math.floor(Math.random() * 89_999_999)
  const fixture = resolve(d.outDir, 'code-fixture')
  // The agent, its key and its funding, on a synthetic workspace of its own: nothing else spends there.
  let hold: Hold | undefined
  let user: SyntheticUser
  let agentID: string
  let key: string
  try {
    await rm(fixture, { recursive: true, force: true })
    await mkdir(fixture, { recursive: true })
    await writeFile(join(fixture, 'calc.go'), fixtureSource(nonce))
    const git = (...args: string[]) => run('git', ['-C', fixture, '-c', 'user.name=Talyvor testers', '-c', 'user.email=testers@talyvor.invalid', ...args], { timeout: 30_000 })
    await git('init', '-q')
    await git('add', '.')
    await git('commit', '-q', '-m', 'the testers\' fixture')
    hold = d.cap.reserve((FUND_ULXC / 1e6) * d.usdPerLXC)
    ;[user] = await d.lens.createUsers(1)
    out.workspace = user.workspaceID
    agentID = (await d.lens.createAgent(user, `Talyvor Code nightly ${nonce}`)).id
    out.agent = agentID
    const k = await d.lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agentID}/keys`, { name: 'talyvor-code' })
    if (!k.ok) throw new Error(`issuing the agent a key was refused: ${k.status} ${k.error}`)
    key = k.value.key
    await d.lens.fundAgent(user, agentID, FUND_ULXC)
  } catch (e) {
    if (hold !== undefined) d.cap.settle(hold, 0)
    out.calls = notRun(`setting up the agent: ${describe(e)}`)
    return out
  }

  // The CLI is given only what it needs: never the run's own keys (LENS_SYNTHETIC_KEY, a GitHub token).
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k]]]))),
    TALYVOR_LENS_URL: d.lens.baseURL,
    TALYVOR_LENS_API_KEY: key,
    TALYVOR_WORKSPACE_ID: user.workspaceID,
    NO_COLOR: '1',
  }
  const calls: { command: Command; args: string[]; said: (stdout: string) => { said: string; wrong?: string } }[] = [
    {
      command: 'ask',
      args: ['ask', '--model', CODE_MODEL, '--file', 'calc.go', 'What number does Magic() in calc.go return? Reply with the number only.'],
      said: (s) => ({ said: s.trim().split('\n')[0].slice(0, 120), wrong: s.includes(String(nonce)) ? undefined : `its answer does not hold ${nonce}, the number only calc.go holds` }),
    },
    {
      command: 'review',
      args: ['review', '--model', CODE_MODEL, '--output', 'json', 'calc.go'],
      said: (s) => {
        try {
          const r = JSON.parse(s) as { verdict?: string; critical_count?: number; warning_count?: number }
          if (typeof r.verdict !== 'string' || r.verdict === '') return { said: s.slice(0, 120), wrong: 'its JSON names no verdict' }
          return { said: `${r.verdict} — ${r.critical_count ?? 0} critical, ${r.warning_count ?? 0} warning(s)` }
        } catch {
          return { said: s.slice(0, 120), wrong: 'it did not print the JSON --output json asks for' }
        }
      },
    },
  ]
  let spent = 0
  for (const c of calls) {
    const call: CodeCall = { command: c.command, state: 'failed', detail: '' }
    out.calls.push(call)
    try {
      const before = await d.lens.agentLines(user, agentID)
      const bookBefore = await d.lens.agentBook(user)
      let wrong: string | undefined
      try {
        const r = await run(bin, c.args, { cwd: fixture, env, timeout: CALL_MS })
        const s = c.said(r.stdout)
        call.said = s.said
        wrong = s.wrong
      } catch (e) {
        const err = e as { code?: number | string; stderr?: string; killed?: boolean }
        wrong = err.killed === true ? `it did not finish within ${CALL_MS / 1000}s` : `it exited ${err.code ?? '?'}: ${(err.stderr ?? '').trim().split('\n').slice(-2).join(' / ') || firstLine(e)}`
      }
      let after = await d.lens.agentLines(user, agentID)
      for (const t0 = Date.now(); !complete(before, after) && Date.now() - t0 < CHARGE_WAIT_MS; after = await d.lens.agentLines(user, agentID)) {
        await new Promise((r) => setTimeout(r, 1000))
      }
      const charge = chargeOf(before, after)
      const bookAfter = await d.lens.agentBook(user)
      const moved = bookAfter.unallocated_ulxc - bookBefore.unallocated_ulxc
      if ('charged' in charge) {
        call.charged_ulxc = charge.charged
        call.fee_ulxc = charge.fee
        spent += charge.charged + charge.fee
      }
      const ledger = 'why' in charge ? charge.why : moved !== 0 ? `the workspace's own unallocated balance moved ${moved} µLXC` : undefined
      call.state = wrong === undefined && ledger === undefined ? 'passed' : 'failed'
      call.detail = [wrong, ledger].filter((x) => x !== undefined).join('; ') ||
        `one charge of ${call.charged_ulxc} µLXC and its ${call.fee_ulxc} µLXC fee on the agent's statement; none on the workspace`
    } catch (e) {
      call.state = 'not run'
      call.detail = `reading the agent's statement: ${describe(e)}`
    }
  }
  d.cap.settle(hold, (spent / 1e6) * d.usdPerLXC)
  return out
}

// ── The report ──────────────────────────────────────────────────────────────────────────────────────

const cell = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
const when = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')}Z`
const result = (c: string | undefined): string => (c === undefined ? '**not read**' : c === 'success' ? 'green' : `**${c}**`)

/** The report's Talyvor Code section: each CLI call with its verdict and what it charged, and the CI's two jobs. */
export function renderCode(code: CodeReport | undefined): string[] {
  if (code === undefined) return []
  const lines = ['', '### Talyvor Code — the CLI from main, its extension and its plugin', '',
    `The CLI built from ${code.repo}'s main${code.commit === undefined ? '' : ` at ${code.commit}`}, run on a fixture repository on the own key of a ` +
    `synthetic agent${code.agent === undefined ? '' : ` (${code.agent}, workspace ${code.workspace})`}. Each call must be one charge on the agent's statement ` +
    'and none on the workspace.', '',
    '| Command | Verdict | What it said | Charged to the agent |', '|---|---|---|---|',
    ...code.calls.map((c) => `| \`talyvor-code ${c.command}\` | ${c.state === 'passed' ? 'passed' : `**${c.state}**: ${cell(c.detail)}`}` +
      `${c.command === 'ask' && code.item !== undefined ? ` — build item ${code.item}` : ''} | ${cell(c.said ?? '')} | ` +
      `${c.charged_ulxc === undefined ? '' : `${c.charged_ulxc} µLXC + ${c.fee_ulxc ?? 0} µLXC fee`} |`), '']
  lines.push(code.ci_run === undefined ? `**CI not read**: ${code.ci_error ?? 'no run'}.`
    : `The latest CI run on main, [${code.ci_run.url.split('/').pop()}](${code.ci_run.url}) at ${code.ci_run.sha}, finished ${when(code.ci_run.finished)}:`, '')
  if (code.ci_run !== undefined) {
    lines.push('| Part | Job | Result |', '|---|---|---|',
      ...code.ci.map((c) => `| ${c.part} | ${c.url === undefined ? c.job : `[${c.job}](${c.url})`} | ${result(c.conclusion)} |`), '')
  }
  return lines
}

/** The Talyvor Code section in one line, for TESTERS.md. */
export function codeLine(code: CodeReport | undefined): string[] {
  if (code === undefined) return []
  const calls = code.calls.map((c) => `${c.command} ${c.state}${c.command === 'ask' && code.item !== undefined ? ` (${code.item})` : ''}`).join(', ')
  const ci = code.ci_run === undefined ? `CI not read (${code.ci_error ?? 'no run'})`
    : `${code.ci.map((c) => `${c.part} ${c.conclusion === 'success' ? 'green' : c.conclusion ?? 'not read'}`).join(', ')} on main's latest CI`
  return [`- **Talyvor Code**: ${calls}${code.commit === undefined ? '' : ` (main at ${code.commit})`}; ${ci}.`]
}
