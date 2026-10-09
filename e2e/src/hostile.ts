// B28.289 — HOSTILE PULL REQUESTS. Each night the testers write the pull requests an attacker or a careless change would
// open, and check CI would refuse each one: a dependency whose postinstall runs code on install, a security gate taken out
// while the tests around it stay green, a compose file that hands a secret a default. Each runs against the repo's main
// in a copy of its own: the guard CI runs must pass on main as it is (or its red would prove nothing), then go red on the
// hostile change, naming the guard; and the repo's workflow must still run that guard on every pull request. A hostile
// pull request CI would let through files one build item for its repo, once (filing.ts's rule). A change that no longer
// applies to main says so and files one for the testers' harness, since it has stopped testing anything.

import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

export type Repo = 'talyvor-suite' | 'talyvor-lens' | 'talyvor-track' | 'talyvor-docs'

/** Runs a command to its end and answers its exit code and output; throws only when it cannot be run or did not finish. */
export type Exec = (file: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeout: number }) => Promise<{ code: number; out: string }>

export const execCLI: Exec = async (file, args, opts) => {
  try {
    const r = await promisify(execFile)(file, args, { ...opts, maxBuffer: 64 * 1024 * 1024 })
    return { code: 0, out: `${r.stdout}${r.stderr}` }
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string }
    if (err.killed === true) throw new Error(`\`${file} ${args.join(' ')}\` did not finish within ${opts.timeout / 1000}s`)
    if (typeof err.code !== 'number') throw e
    return { code: err.code, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

/** The hostile change no longer applies to main: the line it changes has moved. */
export class Stale extends Error {}

/** Replaces the one `from` in `file` with `to`; a string must be there exactly once, a pattern at least once (its first is changed). */
export async function changeOnce(dir: string, file: string, from: string | RegExp, to: string): Promise<void> {
  const path = join(dir, file)
  const src = await readFile(path, 'utf8').catch(() => {
    throw new Stale(`${file} is not on main`)
  })
  const n = typeof from === 'string' ? src.split(from).length - 1 : [...src.matchAll(new RegExp(from.source, 'g'))].length
  if (typeof from === 'string' ? n !== 1 : n === 0) {
    throw new Stale(`${file} holds ${n} of the line it changes, not ${typeof from === 'string' ? 'one' : 'any'}: ${String(from).slice(0, 100)}`)
  }
  await writeFile(path, src.replace(from, to))
}

export interface HostilePR {
  /** Its line in the report and, as `hostile-pr-<id>`, its build item's e2e-scenario. */
  id: string
  repo: Repo
  /** What the pull request does, in a sentence. */
  what: string
  /** The guard that must stop it, as CI's log names it. */
  guard: string
  /** The workflow in the repo that must run the guard on every pull request, and the step that runs it. */
  workflow: string
  step: RegExp
  /** The guard, run in the copy as CI runs it. */
  check: { file: string; args: string[]; env?: Record<string, string>; timeoutMs: number }
  /** What its red must name. */
  names: string[]
  apply: (dir: string, exec: Exec) => Promise<void>
  /** After the guard went red: why it still did not stop the change, if it did not. */
  after?: (dir: string) => Promise<string | undefined>
}

const MARKER = 'postinstall-ran'
const INSTALL_MS = 5 * 60_000
const GO_TEST_MS = 10 * 60_000

/** The night's hostile pull requests. */
export const HOSTILE_PRS: HostilePR[] = [
  {
    id: 'postinstall-suite',
    repo: 'talyvor-suite',
    what: 'adds a dependency to the web app whose postinstall runs code on install, with the lockfile updated as a real pull request would',
    guard: 'pnpm install --frozen-lockfile (allowBuilds in pnpm-workspace.yaml)',
    workflow: '.github/workflows/ci.yml',
    step: /^\s*- run: pnpm install --frozen-lockfile\s*$/m,
    check: { file: 'pnpm', args: ['install', '--frozen-lockfile'], timeoutMs: INSTALL_MS },
    names: ['ERR_PNPM_IGNORED_BUILDS', 'hostile-postinstall'],
    apply: async (dir, exec) => {
      const write = `require('fs').writeFileSync('${join(dir, MARKER)}', 'ran')`
      await mkdir(join(dir, 'hostile-postinstall'), { recursive: true })
      await writeFile(join(dir, 'hostile-postinstall/package.json'),
        JSON.stringify({ name: 'hostile-postinstall', version: '1.0.0', scripts: { postinstall: `node -e "${write}"` } }, null, 2) + '\n')
      const pkg = join(dir, 'apps/web/package.json')
      const web = JSON.parse(await readFile(pkg, 'utf8').catch(() => {
        throw new Stale('apps/web/package.json is not on main')
      })) as { dependencies?: Record<string, string> }
      web.dependencies = { ...web.dependencies, 'hostile-postinstall': 'file:../../hostile-postinstall' }
      await writeFile(pkg, JSON.stringify(web, null, 2) + '\n')
      const lock = await exec('pnpm', ['install', '--lockfile-only'], { cwd: dir, env: cleanEnv(), timeout: INSTALL_MS })
      if (lock.code !== 0) throw new Error(`pnpm could not write the pull request's lockfile: ${lastLines(lock.out)}`)
    },
    after: async (dir) => (await access(join(dir, MARKER)).then(() => true, () => false)) ? 'its postinstall ran on install' : undefined,
  },
  {
    id: 'admin-gate-lens',
    repo: 'talyvor-lens',
    what: 'takes requireAdmin off POST /v1/admin/lxc/grant, the route that mints LXC; the admin-route classification tests stay green',
    guard: 'TestEveryAdminRegistrationReachesAnAuthorizationDecision (go test ./...)',
    workflow: '.github/workflows/ci.yaml',
    step: /^\s*run: go test .*\.\/\.\.\.\s*$/m,
    // cgo is off: the guard reads the source, and this Mac's toolchain cannot link cgo.
    check: { file: 'go', args: ['test', '-count=1', '-run', '^TestEveryAdminRegistrationReachesAnAuthorizationDecision$', './cmd/lens/'], env: { CGO_ENABLED: '0' }, timeoutMs: GO_TEST_MS },
    names: ['FAIL: TestEveryAdminRegistrationReachesAnAuthorizationDecision', '/v1/admin/lxc/grant'],
    apply: (dir) => changeOnce(dir, 'cmd/lens/main.go',
      'authed.Post("/v1/admin/lxc/grant", requireAdmin(authManager, newAdminLXCGrantHandler(dualToken)))',
      'authed.Post("/v1/admin/lxc/grant", newAdminLXCGrantHandler(dualToken))'),
  },
  ...([
    ['talyvor-lens', 'LENS_DATABASE_URL', 'POSTGRES_PASSWORD', 'changeme'],
    ['talyvor-track', 'TRACK_DATABASE_URL', 'POSTGRES_PASSWORD', 'changeme'],
    ['talyvor-docs', 'GATEWAY_AUTH_SECRET', 'GATEWAY_AUTH_SECRET', 'dev-only-shared-secret'],
  ] as const).map(([repo, line, secret, value]): HostilePR => ({
    id: `compose-secret-${repo.slice('talyvor-'.length)}`,
    repo,
    what: `gives ${secret} a default in docker-compose.yaml (\${${secret}:-${value}} where compose refused to start without it)`,
    guard: 'scripts/check-compose-secrets.sh',
    workflow: '.github/workflows/ci.yaml',
    step: /^\s*run: \.\/scripts\/check-compose-secrets\.sh\s*$/m,
    check: { file: './scripts/check-compose-secrets.sh', args: [], timeoutMs: 60_000 },
    names: [`secret-shaped variable '${secret}'`],
    apply: (dir) => changeOnce(dir, 'docker-compose.yaml',
      new RegExp(`(${line}=[^\\n]*?)\\$\\{${secret}:\\?[^}]*\\}`), `$1\${${secret}:-${value}}`),
  })),
]

export interface HostileVerdict {
  id: string
  repo: Repo
  what: string
  guard: string
  /** caught: red on the change, naming the guard. not caught: CI would let it through. not run: no verdict. stale: the change no longer applies. */
  state: 'caught' | 'not caught' | 'not run' | 'stale'
  detail: string
  /** The repo's main, as the copy was made from it. */
  commit?: string
  /** The build item that holds it, filed this night or already open. */
  item?: string
  /** Not run because a checkout, or a file in it, is not on disk: the testers' harness is broken, so it files an item. */
  missing?: true
}

export interface HostileReport {
  read_at: string
  prs: HostileVerdict[]
}

const lastLines = (out: string, n = 3): string => out.trim().split('\n').filter((l) => l.trim() !== '').slice(-n).join(' / ')

/** The run's environment without the npm_ settings a `pnpm run` parent leaves in it, which a pnpm in the copy would obey. */
const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)))

/** One hostile pull request against `src`, a checkout of its repo's main. Never throws. */
export async function judge(pr: HostilePR, src: string, exec: Exec = execCLI): Promise<HostileVerdict> {
  const v: HostileVerdict = { id: pr.id, repo: pr.repo, what: pr.what, guard: pr.guard, state: 'not run', detail: '' }
  let dir: string | undefined
  try {
    const must = async (file: string, args: string[], cwd: string): Promise<string> => {
      const r = await exec(file, args, { cwd, timeout: 120_000 })
      if (r.code !== 0) throw new Error(`\`${file} ${args.join(' ')}\` exited ${r.code}: ${lastLines(r.out)}`)
      return r.out
    }
    if (!(await access(src).then(() => true, () => false))) {
      v.missing = true
      v.detail = `there is no checkout of ${pr.repo} at ${src}`
      return v
    }
    v.commit = (await must('git', ['-C', src, 'rev-parse', '--short', 'HEAD'], src)).trim()
    const workflow = await readFile(join(src, pr.workflow), 'utf8').catch(() => '')
    if (!/^\s*pull_request:|^on:.*\bpull_request\b/m.test(workflow) || !pr.step.test(workflow)) {
      v.state = 'not caught'
      v.detail = `${pr.repo}'s ${pr.workflow} does not run ${pr.guard} on a pull request, so nothing in CI stands in its way`
      return v
    }
    dir = await mkdtemp(join(tmpdir(), `talyvor-hostile-${pr.id}-`))
    const tar = join(dir, '..', `${dir.split('/').pop()}.tar`)
    await must('git', ['-C', src, 'archive', '-o', tar, 'HEAD'], src)
    await must('tar', ['-xf', tar, '-C', dir], dir)
    await rm(tar, { force: true })
    const guard = () => exec(pr.check.file, pr.check.args, { cwd: dir as string, env: { ...cleanEnv(), ...pr.check.env }, timeout: pr.check.timeoutMs })

    const control = await guard()
    if (control.code !== 0) {
      v.detail = `${pr.guard} is already red on main at ${v.commit}, so its red on the change would prove nothing: ${lastLines(control.out)}`
      return v
    }
    await pr.apply(dir, exec)
    const red = await guard()
    const missing = pr.names.filter((n) => !red.out.includes(n))
    const why = red.code === 0 ? `${pr.guard} stayed green` : missing.length > 0
      ? `${pr.guard} went red (exit ${red.code}) without naming ${missing.map((n) => `"${n}"`).join(' or ')}: ${lastLines(red.out)}`
      : await pr.after?.(dir)
    v.state = why === undefined ? 'caught' : 'not caught'
    v.detail = why ?? `red on the change, exit ${red.code}: ${[...new Set(red.out.split('\n').filter((l) => pr.names.some((n) => l.includes(n))).map((l) => l.trim()))].slice(0, 2).join(' / ')}`
  } catch (e) {
    v.state = e instanceof Stale ? 'stale' : 'not run'
    if (v.state === 'not run' && /No such file or directory/.test(String(e))) v.missing = true
    v.detail = e instanceof Stale ? `the hostile change no longer applies to main${v.commit === undefined ? '' : ` at ${v.commit}`}: ${e.message}`
      : (e as { code?: string }).code === 'ENOENT' ? `a tool it needs is not on this machine's PATH: ${(e as Error).message}` : (e instanceof Error ? e.message : String(e)).split('\n')[0]
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  return v
}

/** Every hostile pull request, each against its repo's checkout in `src` ('none' or a reason in `behind` leaves it not run). Never throws. */
export async function runHostile(src: Record<Repo, string>, behind: Partial<Record<Repo, string>> = {}, exec: Exec = execCLI,
  prs: HostilePR[] = HOSTILE_PRS, now: Date = new Date()): Promise<HostileReport> {
  const out: HostileReport = { read_at: now.toISOString(), prs: [] }
  // B34.11 — absolute once, here: judge runs git with the checkout as its cwd, where a relative path names nothing.
  const at = (repo: Repo): string => (src[repo] === 'none' ? 'none' : resolve(src[repo]))
  for (const pr of prs) {
    const why = behind[pr.repo] ?? (src[pr.repo] === 'none' ? `no checkout of ${pr.repo} was given` : undefined)
    out.prs.push(why !== undefined ? { id: pr.id, repo: pr.repo, what: pr.what, guard: pr.guard, state: 'not run', detail: why } : await judge(pr, at(pr.repo), exec))
  }
  return out
}

/** The build-item marker a hostile pull request's verdict is filed under. */
export const hostileMarker = (v: Pick<HostileVerdict, 'id'>): string => `hostile-pr-${v.id}`

// ── The report ──────────────────────────────────────────────────────────────────────────────────────

const cell = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

/** The report's hostile pull requests section: each one, the guard that must stop it, and whether it did. */
export function renderHostile(h: HostileReport | undefined): string[] {
  if (h === undefined) return []
  return ['', '### Hostile pull requests — does CI stop them', '',
    "Each is made against the repo's main in a copy of its own. The guard must pass on main, go red on the change naming " +
      'what it caught, and be run by the repo\'s workflow on every pull request.', '',
    '| Pull request | Repo | Guard | Verdict |', '|---|---|---|---|',
    ...h.prs.map((v) => `| \`${v.id}\` ${cell(v.what)} | ${v.repo}${v.commit === undefined ? '' : ` at ${v.commit}`} | ${cell(v.guard)} | ` +
      `${v.state === 'caught' ? 'caught' : `**${v.state.toUpperCase()}**`}: ${cell(v.detail)}${v.item === undefined ? '' : ` — build item ${v.item}`} |`), '']
}

/** The section in one line, for TESTERS.md. */
export function hostileLine(h: HostileReport | undefined): string[] {
  if (h === undefined) return []
  const caught = h.prs.filter((v) => v.state === 'caught').length
  const rest = h.prs.filter((v) => v.state !== 'caught').map((v) => `\`${v.id}\` ${v.state.toUpperCase()}${v.item === undefined ? '' : ` (${v.item})`}`)
  return [`- **Hostile pull requests**: ${caught} of ${h.prs.length} stopped by CI${rest.length === 0 ? '' : `; ${rest.join(', ')}`}.`]
}
