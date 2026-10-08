import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { sellerTaxDetails } from '../src/sellerTax.ts'

// B32.95 — seller-tax-details against the stub Lens (selftest/stub-tax.ts): it passes on a Lens that masks the TINs, the
// date of birth and the account, keeps them when a save leaves them out and checks the VAT number, and FAILs when the
// read returns a TIN as it was given, when such a save removes them, and when a never-issued VAT number reads complete.

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
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await sellerTaxDetails().run(ctx), evidence }
}

describe('seller-tax-details (B32.95)', () => {
  it('passes on a Lens that masks the sealed values, keeps them when a save leaves them out, and checks the VAT number', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toBe('before any were given, incomplete (missing ["seller_type"]), 0 reminders, no hold; saved in full, complete with tins ' +
      '[{"jurisdiction":"GB","number":"••••7890"}], date_of_birth ••••-••-•• and account_identifier ••••5555, read back the same; saved again from DE with ' +
      'DE999999999 and without them, the three kept masked and incomplete, missing ["vat_number"] (test mode: this number is on the list of numbers no ' +
      'authority issued); no answer carried the TIN, the date of birth or the IBAN')
    expect(verdict.pass).toBe(true)
    expect(evidence).toHaveLength(5)
  })

  it('FAILs when the read returns a TIN as it was given', async () => {
    const { verdict } = await runAgainstStub('seller-tax-unmasked')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('the details read back after: the seller saves their details in full: the answer carries the TIN 1234567890 unmasked')
  })

  it('FAILs when a save that leaves the sealed values out removes them', async () => {
    const { verdict } = await runAgainstStub('seller-tax-forgets')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('the seller moves to DE with VAT number DE999999999, leaving the TIN, date of birth and account out, the answer: the TIN, date of birth ' +
      'and account read {"tins":[],"date_of_birth":"","account_identifier":""}; given once, they should read ' +
      '{"tins":[{"jurisdiction":"GB","number":"••••7890"}],"date_of_birth":"••••-••-••","account_identifier":"••••5555"}')
  })

  it('FAILs when a never-issued VAT number reads complete', async () => {
    const { verdict } = await runAgainstStub('seller-vat-unchecked')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('the seller moves to DE with VAT number DE999999999, leaving the TIN, date of birth and account out, the answer: they read complete ' +
      'true, missing []; they should be incomplete, missing ["vat_number"]')
  })
}, 60_000)
