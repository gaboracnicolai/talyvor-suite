import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { selfBilledInvoice } from '../src/selfBill.ts'

// B32.97 — self-billed-invoice against the stub Lens (selftest/stub-bank.ts): it passes on a Lens whose self-billing seller's
// paid week carries its invoice under review, at no VAT, with the payout's figures, and whose other seller gets none; it FAILs
// when the invoice is missing, when its VAT is not the payout's, when the week's lines do not sum to its net, when VAT is paid
// while under review, and when a seller who never agreed is self-billed.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'self-bill-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'self-bill-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens, catalog: [{ id: 'gpt-4o-mini' }], fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await selfBilledInvoice(6).run(ctx), evidence }
}

describe('self-billed-invoice (B32.97)', () => {
  it("passes on a Lens whose self-billing seller's paid week carries its invoice under review, and whose other seller's carries none", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^the agreement draft-2026-10 and VAT number GB123456789 were saved and kept, and the unpaid \d{4}-W\d{2} carried no invoice; paid mpo_\w+ \(25500000 µUSD gross, 0 VAT, 23190000 net\), \d{4}-W\d{2} carried TEST-SB-000001 from Nightly Seller to TALYVOR LTD: net 25500000, VAT 0 \(under_review\), gross 25500000, the lines summing to the payout's net; the seller without the agreement, paid mpo_\w+, had none$/)
    expect(verdict.pass).toBe(true)
  })

  it("FAILs when a self-billing seller's payout issues no invoice", async () => {
    const { verdict } = await runAgainstStub('self-bill-missing')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the seller agreed to self-billing \(draft-2026-10\) and was paid mpo_\w+ in \d{4}-W\d{2}, but the statement of \d{4}-W\d{2} carries no self-billed invoice$/)
  })

  it("FAILs when the payout pays VAT its invoice does not charge", async () => {
    const { verdict } = await runAgainstStub('self-bill-vat-differs')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the self-billed invoice TEST-SB-000001 must be net the payout's gross 25500000, VAT the payout's 5100000 and gross their sum; it reads net 25500000, VAT 0, gross 25500000$/)
  })

  it("FAILs when the week's lines do not sum to its net", async () => {
    const { verdict } = await runAgainstStub('statement-unsummed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the lines of \d{4}-W\d{2} sum to 25500000, its net is 23190000 and the payout's 23190000/)
  })

  it('FAILs when VAT is paid while self-billing VAT is under review', async () => {
    const { verdict } = await runAgainstStub('self-bill-vat-paid')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^self-billing VAT is under review \(vat_enabled false\), so no VAT is paid; the invoice TEST-SB-000001 charges 5100000 µUSD and the payout mpo_\w+ paid 5100000$/)
  })

  it('FAILs when a seller who never agreed to self-billing is self-billed', async () => {
    const { verdict } = await runAgainstStub('self-bill-unagreed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the seller without the agreement was paid mpo_\w+, and its statement of \d{4}-W\d{2} carries a self-billed invoice: \{"id":"msb_/)
  })
}, 60_000)
