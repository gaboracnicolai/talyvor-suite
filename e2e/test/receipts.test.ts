import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { marketReceipts } from '../src/receipts.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.94 — market-receipts against the stub Lens (selftest/stub-tax.ts, stub-bank.ts): it passes on a Lens that receipts each
// paid bill in turn with the bill's lines and totals, as a page and a PDF, refused to an agent key, and reverse charges a DE
// business's; it FAILs when a paid bill gets no receipt, a receipt's gross leaves its tax out, the DE business is charged VAT,
// every receipt is numbered the year's first, and an agent key reads a receipt.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'receipt-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'receipt-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens, judgeModel: 'claude-haiku-4-5', fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await marketReceipts(5).run(ctx), evidence }
}

describe('market-receipts (B32.94)', () => {
  it('passes on a Lens that receipts each paid bill in turn, as the bill, and reverse charges the DE business', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^the GB buyer's bill of 2 uses paid: receipt TEST-\d{4}-000001, its lines and totals the bill's \(net 2000000, tax 400000, gross 2400000 µUSD\), a page and a PDF, a Preview, Talyvor's VAT number "VAT registration pending"; its agent key refused 403; the DE business's bill paid next: receipt TEST-\d{4}-000002, in turn, reverse charged at 0 VAT \("Reverse charge: [^"]+"\)$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when a paid bill gets no receipt', async () => {
    const { verdict } = await runAgainstStub('receipt-unissued')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the GB buyer's paid bill in_synthetic_\w+ should have one receipt; Lens lists \[\]$/)
  })

  it("FAILs when a receipt's gross leaves its tax out", async () => {
    const { verdict } = await runAgainstStub('receipt-total-off')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the GB buyer's receipt TEST-\d{4}-000001 reads net 2000000, tax 400000, gross 2000000 µUSD; its bill's lines are net 2000000, tax 400000, gross 2400000$/)
  })

  it('FAILs when the DE business with a valid VAT number is charged VAT', async () => {
    const { verdict } = await runAgainstStub('tax-reverse-charged')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the DE business, with a valid VAT number, should have a reverse-charged receipt with no VAT and a note naming the reverse charge; TEST-\d{4}-000002 reads reverse_charge false, VAT 190000 µUSD, notes \[\]$/)
  })

  it('FAILs when every receipt is numbered the year\'s first', async () => {
    const { verdict } = await runAgainstStub('receipt-sequence-stuck')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the DE business's bill was paid after the GB buyer's, so its receipt TEST-\d{4}-000001 should come after TEST-\d{4}-000001 in the run \(sequence 1 \+ 1 or later\); it is sequence 1 of \d{4}$/)
  })

  it('FAILs when an agent key reads its workspace\'s receipts', async () => {
    const { verdict } = await runAgainstStub('receipt-agent')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the GB buyer's agent key must be refused 403 reading \/v1\/workspaces\/[^/]+\/marketplace\/receipts \(the buyer's legal name, address and VAT number\); Lens answered 200 /)
  })
}, 60_000)
