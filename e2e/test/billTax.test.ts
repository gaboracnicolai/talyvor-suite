import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { marketBillTax } from '../src/billTax.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.93 — market-bill-tax against the stub Lens (selftest/stub-tax.ts, stub-bank.ts): it passes on a Lens that taxes a GB
// consumer's per-use buy at 20% and reverse charges a DE business's, totals each bill net plus tax, and takes the paid use's
// tax to tax:GB on its clear entry; it FAILs when the reverse charge is ignored, when a bill's gross leaves the tax out, and
// when the clear entry drops the tax.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'tax-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'tax-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens, judgeModel: 'claude-haiku-4-5', fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await marketBillTax(1).run(ctx), evidence }
}

describe('market-bill-tax (B32.93)', () => {
  it('passes on a Lens that taxes each buyer by its treatment and clears the paid use\'s tax to tax:GB', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^the GB consumer standard at 2000 bps, 200000 µUSD; the DE business reverse_charge at 0 µUSD \("Reverse charge: [^"]+"\); each bill's gross = net \+ tax; the GB bill paid, the seller's 850000 µUSD share released and 200000 µUSD VAT collected from its clear entry in \d{4}-W\d{2}\./)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a business abroad with a valid VAT number is charged VAT', async () => {
    const { verdict } = await runAgainstStub('tax-reverse-charged')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the DE business, with a valid VAT number, is taxed standard at 1900 bps, 190000 µUSD in DE/)
  })

  it('FAILs when a bill\'s gross leaves its tax out', async () => {
    const { verdict } = await runAgainstStub('bill-gross-untaxed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe("the GB consumer's bill reads net 1000000, tax 200000, gross 1000000 µUSD; its one use is net 1000000, tax 200000, gross 1200000")
  })

  it('FAILs when the paid use\'s clear entry drops its tax', async () => {
    const { verdict } = await runAgainstStub('clear-tax-dropped')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the GB consumer's paid use should be the seller's one sale of \d{4}-W\d{2}, 1000000 µUSD, its clear entry taking its 200000 µUSD tax to tax:GB; the week reads 1 sale\(s\) of 1000000 µUSD and 0 µUSD VAT collected$/)
  })
}, 60_000)
