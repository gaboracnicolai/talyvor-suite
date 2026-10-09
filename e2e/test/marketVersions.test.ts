import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { marketVersions } from '../src/marketVersions.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B28.162 — market-versions against the stub Lens (selftest/stub-bank.ts): it passes on a Lens that keeps every version of a
// listing and runs the version a use names, and FAILs when a use runs the latest whatever it names.

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

let stub: ChildProcess | undefined
afterEach(() => {
  stub?.kill()
  stub = undefined
})

async function runAgainstStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'versions-key', STUB_MODERATOR_KEY: 'tlv_mod_versions', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'versions-key', undefined, undefined, undefined, 'tlv_mod_versions')
  const ctx = { env: { lens, judgeModel: 'claude-haiku-4-5' }, evidence: [] } as unknown as ScenarioCtx
  return marketVersions(0).run(ctx)
}

describe('market-versions (B28.162)', () => {
  it('passes on a Lens that keeps version 1 and runs the version a use names', async () => {
    const verdict = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^version 2 uploaded with "Answers BRAVO now" and read back beside version 1, unchanged; a use pinned to version 1 \(use_\w+\) ran version 1 and answered ALPHA; an unpinned use \(use_\w+\) ran version 2 and answered BRAVO$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a use pinned to version 1 runs the latest', async () => {
    const verdict = await runAgainstStub('version-pin-ignored')
    expect(verdict).toEqual({ pass: false, detail: 'a use pinned to version 1 should run version 1 and answer ALPHA; it ran version 2 and answered "BRAVO"' })
  })
})
