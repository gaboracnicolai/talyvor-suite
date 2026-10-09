import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { capabilityTerms } from '../src/capabilityTerms.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.122 — capability-terms against the stub Lens (selftest/stub-terms.ts): it passes on a Lens whose new workspace has
// accepted no terms, and FAILs when a new workspace's list reads fx as already accepted.

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

async function runAgainstStub(broken: string): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'terms-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'terms-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await capabilityTerms().run(ctx), evidence }
}

describe('capability-terms (B30.122)', () => {
  it("passes on a Lens that lists every B30 capability's terms unaccepted, accepts fx's version and refuses the next 409", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^all 19 B30 capabilities' terms listed, versioned and unaccepted; fx's version 1 is a draft for legal review; accepting it answered 201 naming \S+ and the list reads it accepted; version 2 answered 409$/)
    expect(verdict.pass).toBe(true)
    expect(evidence.at(-1)?.answer).toMatch(/^refused 409: /)
  })

  it('FAILs when a new workspace reads fx as already accepted', async () => {
    const { verdict } = await runAgainstStub('terms-fx-accepted')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^of the 19 B30 capabilities' terms on a new workspace: fx reads accepted \(version 1 by \S+\) on a workspace that has accepted nothing$/)
  })
}, 60_000)
