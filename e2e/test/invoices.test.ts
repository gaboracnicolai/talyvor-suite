import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { invoicePayLink } from '../src/invoices.ts'

// B30.130 — invoice-pay-link against the stub Lens (selftest/stub-payees.ts), which pays an invoice from an agent's account
// only when it holds what is due: it passes when the unfunded payer is refused 409 and nothing moves, and FAILs when Lens
// marks the invoice paid without moving the money.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'invoice-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'invoice-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await invoicePayLink().run(ctx), evidence }
}

describe('invoice-pay-link (B30.130)', () => {
  it('passes on a Lens that sends the invoice, serves its pay page to anyone and refuses an unfunded payer, moving nothing', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toBe("a GBP invoice of £145.00 (two lines, 20% VAT on one) issued from the agent's account and sent, with a number, a reference and a pay link; " +
      "its pay page read with no credential, test money only, offering a transfer quoting the agent's payment reference and the invoice's, naming no issuer id; " +
      "another company's agent holding £0.00 refused 409; the invoice still sent with £145.00 due and no payment, both agents' accounts still 0; " +
      'the paid path waits on payments in (B30.15)')
    expect(verdict.pass).toBe(true)
    expect(evidence.find((e) => e.note?.includes('issues and sends'))?.answer).toMatch(/^201 .*"number":"INV-000001"/)
    expect(evidence.find((e) => e.note?.includes('no credential'))?.answer).toMatch(/^200 .*Preview — test money only/)
    expect(evidence.find((e) => e.note?.includes('empty GBP account'))?.answer).toMatch(/^refused 409: .*holds GBP 0\.00/)
  })

  it('FAILs when Lens marks an invoice paid without moving the money', async () => {
    const { verdict } = await runAgainstStub('invoice-paid-unmoved')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^paying an invoice from an account holding 0 must be refused 409; Lens answered 200 /)
  })
}, 60_000)
