import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { isoWeek, taxAndPayouts } from '../src/taxPayouts.ts'

// B32.66 — tax-and-payouts against the stub Lens (selftest/stub-tax.ts, stub-bank.ts): it passes on a Lens that taxes a GB
// consumer's rent at 20%, reverse charges a DE business's and charges a US buyer's nothing, gives each paid bill a receipt
// totalling its net plus its tax, withholds a seller without tax details from the payout run and pays them once they are
// complete; it FAILs when the reverse charge is ignored, when a receipt's total leaves the tax out, and when the payout run
// pays a seller who gave no tax details.

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
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens, catalog: [{ id: 'gpt-4o-mini' }], fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await taxAndPayouts(3).run(ctx), evidence }
}

describe('tax-and-payouts (B32.66)', () => {
  it('names the ISO week as Lens does', () => {
    expect(isoWeek(new Date('2026-10-08T12:00:00Z'))).toBe('2026-W41')
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53')
  })

  it('passes on a Lens that taxes each buyer by its treatment, receipts each paid bill, and withholds then pays the seller', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^the GB consumer standard at 2000000 µUSD, the DE business reverse_charge at 0 µUSD, the US buyer not_registered at 0 µUSD; each paid bill's receipt is its line, gross = net \+ tax, the DE business's reverse charged; the seller's week: 3 sales, 25500000 µUSD released, 2000000 µUSD VAT collected; the seller, with no tax details, was withheld by the payout run with nothing moved; completed, the next run paid mpo_\w+: 25500000 µUSD gross, 23190000 net after Stripe's 2000000 \+ 310000, the journal's available 25500000 → 0/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a business abroad with a valid VAT number is charged VAT', async () => {
    const { verdict } = await runAgainstStub('tax-reverse-charged')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the DE business, with a valid VAT number, is taxed standard at 1900 bps, 1900000 µUSD in DE with the note "Tax at 19% in DE": it is reverse_charge at 0/)
  })

  it("FAILs when a receipt's total leaves its tax out", async () => {
    const { verdict } = await runAgainstStub('receipt-total-off')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the GB consumer's receipt totals net 10000000, tax 2000000, gross 10000000 µUSD \(1000¢\); its bill is net 10000000, tax 2000000, gross 12000000/)
  })

  it('FAILs when the payout run pays a seller who gave no tax details', async () => {
    const { verdict } = await runAgainstStub('payout-hold-ignored')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the seller gave no tax details, so the payout run must withhold them and move nothing; it answered \{"withheld":false,"payout":\{"id":"mpo_/)
  })
}, 60_000)
