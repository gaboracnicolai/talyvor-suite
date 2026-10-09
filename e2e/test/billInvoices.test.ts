import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { marketBillInvoices } from '../src/billInvoices.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B28.385 — market-bill-invoices against the stub Lens (selftest/stub-bank.ts): it passes on a Lens that lists the bill's
// Stripe invoices with their periods and PDFs and reads each invoice's own uses, the refunded one refunded, its total the
// invoice's less refunds; it FAILs when a refunded use reads paid, when ?invoice= reads the calendar month, and when an
// invoice's gross leaves its tax out.

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
  const ctx = { env: { lens, judgeModel: 'claude-haiku-4-5', fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await marketBillInvoices(3).run(ctx), evidence }
}

describe('market-bill-invoices (B28.385)', () => {
  it('passes on a Lens that bills by Stripe invoice: each its own uses, the refunded one refunded, its total the invoice less refunds', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^two bills paid and a use left unpaid: Lens lists the period in progress, B and A, each paid one with its billing period and a Stripe PDF; A's bill holds its one use, refunded, total 0 \(1200000 charged, 1200000 refunded\); B's its one use, paid, total 1200000 µUSD, as receipt TEST-\d{4}-\d{6} collected; the period in progress holds the unpaid use, 1200000 µUSD so far$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when an invoice\'s refunded use reads paid', async () => {
    const { verdict } = await runAgainstStub('invoice-refund-paid')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^invoice A was refunded, and its use \w+ reads paid on its bill, not refunded$/)
  })

  it('FAILs when the bill read for an invoice is the calendar month', async () => {
    const { verdict } = await runAgainstStub('invoice-by-month')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the bill read for invoice A should hold the use\(s\) that invoice carried, \w+, grouped by its billing period; it holds \w+, \w+, \w+$/)
  })

  it('FAILs when an invoice\'s gross leaves its tax out', async () => {
    const { verdict } = await runAgainstStub('invoice-total-off')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('invoice A charged its one use\'s 1200000 µUSD with tax and refunded all of it, B charged 1200000 and refunded none; Lens lists A 1000000 refunded 1000000, B 1000000 refunded 0')
  })
}, 60_000)
