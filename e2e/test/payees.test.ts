import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { outsidePayees } from '../src/payees.ts'

// B30.126 — outside-payees against the stub Lens (selftest/stub-payees.ts), which verifies a confirmation's passkey
// signature as Lens does: it passes when a no-match payee is confirmed only by the passkey's assertion, and FAILs when
// Lens confirms one with no assertion.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'payee-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'payee-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await outsidePayees().run(ctx), evidence }
}

describe('outside-payees (B30.126)', () => {
  it('passes on a Lens that confirms a no-match payee only with a passkey signed over its challenge', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toBe('exact_match, close_match (holder "Nightly Payee Ltd") and no_match payees saved, the last two needing confirmation; ' +
      'the no-match confirmed with no assertion refused 403, then confirmed by the passkey over its challenge, still no_match; ' +
      'the TESTSANCTION payee refused 403 and not listed')
    expect(verdict.pass).toBe(true)
    expect(evidence.find((e) => e.note?.includes('with the passkey'))?.answer).toMatch(/^200 .*"needs_confirmation":false/)
  })

  it('FAILs when Lens confirms a no-match payee without an assertion', async () => {
    const { verdict } = await runAgainstStub('payee-confirm-unsigned')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^confirming a no-match payee with no assertion must be refused 403; Lens answered 200 /)
  })
}, 60_000)
