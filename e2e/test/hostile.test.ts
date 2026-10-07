import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostileItemsFor } from '../src/filing.ts'
import { type Exec, type HostilePR, type HostileReport, changeOnce, execCLI, hostileLine, judge, renderHostile } from '../src/hostile.ts'

/** A one-commit repo whose compose file holds SAFE, and whose workflow runs `guard` on pull requests unless told not to. */
function repo(workflow = 'on:\n  pull_request:\njobs:\n  g:\n    steps:\n      - run: ./guard\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'hostile-test-'))
  writeFileSync(join(dir, 'compose.yaml'), 'SECRET=SAFE\n')
  writeFileSync(join(dir, 'ci.yaml'), workflow)
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args])
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'main')
  return dir
}

/** git and tar for real; the guard answers as `guard` says about the compose file in the copy. */
const exec = (guard: (compose: string) => { code: number; out: string }): Exec => async (file, args, opts) =>
  file === 'git' || file === 'tar' ? execCLI(file, args, opts) : guard(readFileSync(join(opts.cwd, 'compose.yaml'), 'utf8'))

const pr: HostilePR = {
  id: 'compose-secret-x', repo: 'talyvor-track', what: 'gives SECRET a default', guard: './guard',
  workflow: 'ci.yaml', step: /^\s*- run: \.\/guard\s*$/m, check: { file: './guard', args: [], timeoutMs: 10_000 },
  names: ["secret-shaped variable 'SECRET'"], apply: (dir) => changeOnce(dir, 'compose.yaml', 'SAFE', 'WEAK'),
}
const real = (c: string) => (c.includes('WEAK') ? { code: 1, out: "compose.yaml:1: ERROR: secret-shaped variable 'SECRET'\n" } : { code: 0, out: 'clean\n' })

describe('B28.289 — hostile pull requests', () => {
  it('caught only when the guard is green on main, red on the change naming it, and run by the workflow on pull requests', async () => {
    const src = repo()
    const cases: [string, HostilePR, Exec, string, string][] = [
      ['caught', pr, exec(real), 'caught', "secret-shaped variable 'SECRET'"],
      ['green on the change', pr, exec(() => ({ code: 0, out: '' })), 'not caught', './guard stayed green'],
      ['red without naming it', pr, exec((c) => (c.includes('WEAK') ? { code: 2, out: 'boom\n' } : { code: 0, out: '' })), 'not caught', 'without naming'],
      ['red on main already', pr, exec(() => ({ code: 1, out: 'broken\n' })), 'not run', 'already red on main'],
      ['the change no longer applies', { ...pr, apply: (d) => changeOnce(d, 'compose.yaml', 'GONE', 'WEAK') }, exec(real), 'stale', 'no longer applies'],
    ]
    for (const [name, p, e, state, says] of cases) {
      const v = await judge(p, src, e)
      expect([name, v.state], v.detail).toEqual([name, state])
      expect(v.detail).toContain(says)
    }
    const unguarded = await judge(pr, repo('on:\n  push:\njobs:\n  g:\n    steps:\n      - run: ./guard\n'), exec(real))
    expect([unguarded.state, unguarded.detail]).toEqual(['not caught', "talyvor-track's ci.yaml does not run ./guard on a pull request, so nothing in CI stands in its way"])
  })

  it('files a pull request CI lets through for its repo, once, and shows every verdict', () => {
    const h: HostileReport = { read_at: '2026-10-07T03:00:00Z', prs: [
      { id: 'compose-secret-lens', repo: 'talyvor-lens', what: 'gives POSTGRES_PASSWORD a default', guard: 'scripts/check-compose-secrets.sh', state: 'not caught', detail: 'not run by CI' },
      { id: 'compose-secret-track', repo: 'talyvor-track', what: 'gives POSTGRES_PASSWORD a default', guard: 'scripts/check-compose-secrets.sh', state: 'caught', detail: 'red' },
    ] }
    const first = hostileItemsFor('## B17.90 — x\nrepo: talyvor-e2e · deps: none · status: DONE abc\n', h, 'docs/e2e/report.md')
    expect(first.filed).toEqual([{ id: 'B17.91', scenario: 'hostile-pr-compose-secret-lens' }])
    expect(first.append).toContain('repo: talyvor-lens · deps: none · status: OPEN')
    expect(hostileItemsFor(first.append, h, 'docs/e2e/report.md').covered).toEqual([{ scenario: 'hostile-pr-compose-secret-lens', by: 'B17.91' }])
    expect(renderHostile(h).join('\n')).toContain('| **NOT CAUGHT**: not run by CI |')
    expect(hostileLine(h)).toEqual(['- **Hostile pull requests**: 1 of 2 stopped by CI; `compose-secret-lens` NOT CAUGHT.'])
  })
})
