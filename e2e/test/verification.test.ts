import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { verificationLevels } from '../src/verification.ts'

// B30.117 — verification-levels against the stub Lens (selftest/stub-verification.ts): it passes on a Lens that reaches
// the levels in order and counts a Test pass for test money only, and FAILs when an identity check before L1 is accepted,
// when a Test pass counts live, and when payments_out is listed as needing L0.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'kyc-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'kyc-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await verificationLevels().run(ctx), evidence }
}

describe('verification-levels (B30.117)', () => {
  it('passes on a Lens that reaches the levels in order and counts a Test pass for test money only', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^the identity check before L1 refused 409 naming L1; email and phone 201 at L1 and identity 201 at L2, each a Test check \(kyc_\S+, kyc_\S+\) with the live level L0; the record holds both, as answered; payments_out needs L2 and b2b_credit L3$/)
    expect(verdict.pass).toBe(true)
    expect(evidence[0]?.answer).toMatch(/^refused 409: .*needs L1/)
  })

  it('FAILs when Lens stops refusing an identity check before L1', async () => {
    const { verdict } = await runAgainstStub('verification-unordered')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^an identity check \(L2\) before the email and phone check \(L1\) must be refused 409 naming L1; Lens answered 201 /)
  })

  it('FAILs when a Test pass counts for live money', async () => {
    const { verdict } = await runAgainstStub('test-pass-live')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('after two Test checks the live level is L2, not L0: a Test pass must count for test money only')
  })

  it('FAILs when payments_out is listed as needing less than L2', async () => {
    const { verdict } = await runAgainstStub('level-needed-wrong')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe("payments_out's live money needs L2; the capabilities list says level_needed L0")
  })
}, 60_000)
