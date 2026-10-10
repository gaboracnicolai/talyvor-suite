import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { compliance } from '../src/compliance.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.109 — compliance against the stub Lens (selftest/stub-payees.ts), which opens a blocked case for a TESTSANCTION name, holds a
// TESTPENDING one on its own case and refuses live money: it passes with both cases on the operator's view, and FAILs when Lens
// pays a live payment on an uncleared capability.

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

async function runAgainstStub(broken: string, operatorReadKey = 'operator-read-key'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'compliance-key', STUB_OPERATOR_READ_KEY: 'operator-read-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'compliance-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens, operatorReadKey }, evidence } as unknown as ScenarioCtx
  return { verdict: await compliance().run(ctx), evidence }
}

describe('compliance (B30.109)', () => {
  it('passes on a Lens that blocks a sanctioned name on a case, holds one under review and refuses live money, posting nothing', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toBe('a TESTSANCTION payee refused 403 by screening on a blocked compliance case; a TESTPENDING payee saved and held on its case, and a £10.00 ' +
      'payment to it refused 403 naming that case; a live £10.00 payment refused naming live money and a live EUR account refused 403 naming its class, ' +
      "test money only; the GBP account still 0 test and 0 live, no EUR account and no payment row; both cases on the operator's screening view, blocked and held")
    expect(verdict.pass).toBe(true)
    expect(evidence.find((e) => e.note?.includes('TESTSANCTION'))?.answer).toMatch(/^refused 403: .*\(compliance case cc_/)
    expect(evidence.find((e) => e.note?.includes('blocked cases'))?.answer).toMatch(/^200 .*"status":"blocked"/)
  })

  it('FAILs when Lens pays a live payment on an uncleared capability', async () => {
    const { verdict } = await runAgainstStub('compliance-live-paid')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a live payment on an uncleared capability must be refused 403 or 409; Lens answered 201 /)
  })

  it("passes without the operator read key, saying the operator's view was not read", async () => {
    const { verdict } = await runAgainstStub('', '')
    expect(verdict.pass).toBe(true)
    expect(verdict.detail).toMatch(/; the operator's view not read: no LENS_OPERATOR_READ_KEY$/)
  })
}, 60_000)
