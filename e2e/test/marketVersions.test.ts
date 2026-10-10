import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { versionsHold } from '../src/marketVersions.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B28.162 — market-versions' Lens checks against the stub Lens (selftest/stub-bank.ts), with version 2 posted as the app's New
// version form posts it through the BFF: they pass on a Lens that keeps every version of a listing and runs the version a use
// names, and FAIL when a use runs the latest whatever it names. The form itself is the self-test's (selftest/selftest.sh).

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
  const ctx = { env: { lens }, evidence: [] } as unknown as ScenarioCtx
  const [seller, buyer] = await lens.createUsers(2)
  const v1 = await lens.act<{ id: string }>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title: 'Versioned',
    description: '', price_per_use_ulxc: 0, visibility: 'public', artifact: { template: 'Reply with the single word: ALPHA', model: 'claude-haiku-4-5' } })
  if (!v1.ok) throw new Error(`publishing version 1: ${v1.status}`)
  const v2 = await lens.act(seller, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${v1.value.id}/versions`,
    { artifact: { template: 'Reply with the single word: BRAVO', model: 'claude-haiku-4-5' }, changelog: 'Answers BRAVO now', parents: [] })
  if (!v2.ok) throw new Error(`uploading version 2: ${v2.status}`)
  return versionsHold(ctx, seller, buyer, v1.value.id)
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
