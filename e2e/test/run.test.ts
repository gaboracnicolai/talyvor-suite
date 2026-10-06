import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classify, secondAttemptsOf } from '../src/run.ts'

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

describe("the testers' own network (B35.8)", () => {
  it('makes an answer refused for a dropped connection an ERROR, and leaves a wrong answer a FAIL', () => {
    expect(classify('FAIL', 'expected Lima, got refused: Failed to fetch')).toEqual({ status: 'ERROR', drop: 'Failed to fetch' })
    expect(classify('ERROR', 'page.goto: net::ERR_INTERNET_DISCONNECTED at https://app.talyvor.com/chat')).toEqual({ status: 'ERROR', drop: 'net::ERR_INTERNET_DISCONNECTED' })
    expect(classify('FAIL', 'creating Payer 62 was refused: 502 lens upstream unreachable')).toEqual({ status: 'ERROR', drop: 'lens upstream unreachable' })
    expect(classify('FAIL', 'expected Lima, got "Paris"')).toEqual({ status: 'FAIL' })
    expect(classify('PASS', 'answered after a Failed to fetch')).toEqual({ status: 'PASS' })
  })
})

describe('second attempts (B35.8)', () => {
  it('runs again a scenario that failed for one or two users, for them only', () => {
    const fail = (scenario: string, user: number) => ({ scenario, user, status: 'FAIL' as const })
    const again = secondAttemptsOf([fail('capital', 3), fail('wallet-currency', 11), fail('wallet-currency', 21), { scenario: 'capital', user: 4, status: 'PASS' },
      fail('every-model', 0), fail('pricing-board', 9), fail('pricing-board', 19), fail('pricing-board', 29)])
    expect([...again]).toEqual([[3, ['capital']], [11, ['wallet-currency']], [21, ['wallet-currency']], [0, ['every-model']]])
  })
})
