import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// B34.2 — a checkout that cannot be brought to main's head runs nothing: the night puts an entry at the top of
// TESTERS.md saying why and which commit it would have tested, and exits 2.

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..')
const who = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }

it('holds a night whose checkout has moved off main: a TESTERS.md entry, no scenario, exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-nightly-'))
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env: { ...process.env, ...who }, encoding: 'utf8' }).trim()
  try {
    git(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
    const seed = join(dir, 'seed')
    mkdirSync(join(seed, 'scripts'), { recursive: true })
    cpSync(join(REPO, 'scripts/e2e-nightly.sh'), join(seed, 'scripts/e2e-nightly.sh'))
    cpSync(join(REPO, 'e2e/src'), join(seed, 'e2e/src'), { recursive: true })
    git(seed, 'init', '-q', '-b', 'main')
    git(seed, 'add', '.')
    git(seed, 'commit', '-qm', 'the harness')
    git(seed, 'push', '-q', join(dir, 'origin.git'), 'main')
    git(dir, 'clone', '-q', join(dir, 'origin.git'), 'testers')
    const testers = join(dir, 'testers')
    // The testers' checkout gets a commit of its own, and main moves on without it.
    writeFileSync(join(testers, 'local.txt'), 'mine\n')
    git(testers, 'add', '.')
    git(testers, 'commit', '-qm', 'a commit main does not have')
    writeFileSync(join(seed, 'later.txt'), 'later\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-qm', 'main moves on')
    git(seed, 'push', '-q', join(dir, 'origin.git'), 'main')
    const head = git(seed, 'rev-parse', '--short=7', 'HEAD')

    const testersMd = join(dir, 'TESTERS.md')
    writeFileSync(join(dir, 'e2e.env'), [`LENS_SYNTHETIC_KEY=k`, 'E2E_APP_URL=http://127.0.0.1:9', 'E2E_LENS_URL=http://127.0.0.1:9',
      'E2E_LENS_SRC=none', `E2E_TESTERS_MD=${testersMd}`, `E2E_BUILD_MD=none`].join('\n') + '\n')
    const r = spawnSync('bash', [join(testers, 'scripts/e2e-nightly.sh'), '--now'],
      { env: { ...process.env, E2E_ENV_FILE: join(dir, 'e2e.env') }, encoding: 'utf8', timeout: 60_000 })

    expect(r.status).toBe(2)
    const entry = readFileSync(testersMd, 'utf8')
    expect(entry).toMatch(/^# Testers — the latest run first\n\n.*\n\n## \S+ — HELD: nothing was run\n/)
    expect(entry).toContain('- **Why**: main could not be fast-forwarded into the checkout')
    expect(entry).toContain(`- **Would have tested**: main at ${head} "main moves on".`)
    expect(entry).toContain(`- **Checkout**: harness ${git(testers, 'rev-parse', '--short=7', 'HEAD')}; Lens's main at lens-src none (--lens-src none); ` +
      'production app not read: http://127.0.0.1:9/api/version')
    const log = readFileSync(join(testers, 'e2e/out/nightly.log'), 'utf8')
    expect(log).toContain('HELD — main could not be fast-forwarded')
    expect(log).not.toMatch(/run starting|pnpm install/)
    expect(log).toContain('run finished: exit 2')
    expect(existsSync(join(testers, 'local.txt'))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
