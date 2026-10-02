import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// B26.25 — a run started through a linked folder (/tmp on macOS, for one) runs: given no flags it
// refuses them and exits 2, where it used to run nothing and exit 0.

it('runs when started through a symlinked folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-link-'))
  try {
    symlinkSync(fileURLToPath(new URL('..', import.meta.url)), join(dir, 'e2e'), 'dir')
    const env = { ...process.env }
    for (const name of ['E2E_APP_URL', 'E2E_LENS_URL', 'LENS_SYNTHETIC_KEY']) delete env[name]
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(dir, 'e2e', 'src', 'run.ts')],
      { env, encoding: 'utf8', timeout: 30_000 })
    expect(r.stderr).toContain('e2e: ')
    expect(r.status).toBe(2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
